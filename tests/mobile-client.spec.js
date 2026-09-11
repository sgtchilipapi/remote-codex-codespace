const { test, expect } = require("@playwright/test");

const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
];

const appliedConfiguration = {
  token: "valid-token",
  model: "",
  reasoning: "",
  permissions: "",
  fastMode: null,
};

const modelInfo = {
  models: [
    {
      id: "codex-1",
      name: "Codex 1",
      isDefault: true,
      defaultReasoning: "medium",
      reasoning: ["low", "medium", "high"],
      serviceTiers: [{ id: "priority", name: "Fast" }],
      defaultServiceTier: null,
    },
    {
      id: "codex-mini",
      name: "Codex Mini",
      isDefault: false,
      defaultReasoning: "low",
      reasoning: ["low"],
      serviceTiers: [],
      defaultServiceTier: null,
    },
  ],
  permissions: [{ id: "read-only", name: "read only" }, { id: "workspace-write", name: "workspace write" }],
  defaults: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false },
};

async function openConfiguredClient(page) {
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
}

async function installStreamingTurn(page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let sequence = 0;
    window.fetch = async (input, init) => {
      const url = new URL(input, location.href);
      if (url.pathname === "/configuration/resolve") {
        return Response.json({ configuration: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false, serviceTier: null }, configurationRevision: "stream-revision" });
      }
      if (url.pathname === "/turn") {
        window.__turnRequest = JSON.parse(init.body);
        return Response.json({ turnId: window.__turnRequest.turnId, eventsUrl: `/turn/${window.__turnRequest.turnId}/events` }, { status: 202 });
      }
      if (!/\/turn\/[^/]+\/events$/.test(url.pathname)) return originalFetch(input, init);
      if (window.__turnRecoveryFailure) {
        const failure = window.__turnRecoveryFailure;
        window.__turnRecoveryFailure = null;
        return Response.json({ error: failure.message, failure }, { status: failure.httpStatus || 502 });
      }
      if (window.__rejectTurnRecovery) return Response.json({ error: "Turn not found" }, { status: 404 });
      const stream = new ReadableStream({
        start(controller) {
          window.__pushTurnEvent = (event) => {
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ ...event, sequence: ++sequence })}\n`));
            if (event.type === "error") {
              controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "relay.turn.finished", status: "failed", sequence: ++sequence })}\n`));
              controller.close();
            }
          };
          window.__finishTurn = () => {
            controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "relay.turn.finished", status: "completed", sequence: ++sequence })}\n`));
            controller.close();
          };
          window.__dropTurn = () => controller.error(new TypeError("Load failed"));
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    };
  });
}

const resumableThreadId = "01a086a1-a1b5-7f52-bc60-a9db59b03804";

async function stubResumeList(page) {
  await page.route("**/threads?*", (route) => route.fulfill({ json: {
    threads: [{ id: resumableThreadId, title: "Thread resume", preview: "Continue the picker", lastActive: "2026-09-10T12:00:00Z", model: "gpt-5", current: false }],
    nextCursor: null,
  } }));
}

test("Resume is a focus view that cancels without changing the current Thread", async ({ page }) => {
  await stubResumeList(page);
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { name: "Resume a Thread" })).toBeFocused();
  await expect(page.getByLabel("Prompt")).toBeHidden();
  await expect(page.getByRole("button", { name: /Thread resume/ })).toContainText("Continue the picker");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("relay") || '{"threadId":null}').threadId)).toBeNull();
});

test("Resume pagination appends accessible Thread choices", async ({ page }) => {
  const cursors = [];
  await page.route("**/threads?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    await route.fulfill({ json: cursor
      ? { threads: [{ id: "01a086a1-a5fd-7fd1-80d7-a7b607508df4", title: "Older Thread", preview: "Earlier work", lastActive: "2026-09-09T12:00:00Z", model: "gpt-5", current: false }], nextCursor: null }
      : { threads: [{ id: resumableThreadId, title: "Recent Thread", preview: "Latest work", lastActive: "2026-09-10T12:00:00Z", model: "gpt-5.2", current: false }], nextCursor: "older-page" } });
  });
  await openConfiguredClient(page);

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: /Recent Thread; Latest work; gpt-5.2/ })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();

  await expect(page.getByRole("button", { name: /Recent Thread/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Older Thread; Earlier work; gpt-5/ })).toBeVisible();
  expect(cursors).toEqual([null, "older-page"]);
});

test("selecting an Eligible Thread atomically installs history without starting a Turn", async ({ page }) => {
  let turnRequests = 0;
  await stubResumeList(page);
  await page.route(`**/threads/${resumableThreadId}/resume`, (route) => route.fulfill({ json: {
    thread: { id: resumableThreadId },
    effectiveConfiguration: {
      model: "gpt-5",
      reasoning: "high",
      permissions: { sandboxPolicy: { type: "workspaceWrite" }, approvalPolicy: "on-request", profile: null },
      fastMode: { enabled: true, serviceTier: "priority" },
    },
    messages: [{ id: "u1", role: "user", text: "Earlier prompt" }, { id: "a1", role: "assistant", text: "Earlier answer" }],
    olderCursor: null,
  } }));
  await page.route("**/turn", (route) => { turnRequests += 1; return route.abort(); });
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: /Thread resume/ }).click();

  await expect(page.getByText("Earlier answer", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeFocused();
  expect(turnRequests).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.relay))).toEqual({
    threadId: resumableThreadId,
    messages: [{ id: "u1", role: "user", text: "Earlier prompt" }, { id: "a1", role: "assistant", text: "Earlier answer" }],
    effectiveConfiguration: {
      model: "gpt-5",
      reasoning: "high",
      permissions: { sandboxPolicy: { type: "workspaceWrite" }, approvalPolicy: "on-request", profile: null },
      fastMode: { enabled: true, serviceTier: "priority" },
    },
  });
});

test("a failed Resume preserves the prior Thread, history, and effective state", async ({ page }) => {
  await page.addInitScript(({ configuration, threadId }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({
      threadId,
      messages: [{ id: "old", role: "assistant", text: "Keep this view" }],
      effectiveConfiguration: { model: "old-model", reasoning: null, permissions: null, fastMode: null },
    }));
  }, { configuration: appliedConfiguration, threadId: "01a086a1-a5fd-7fd1-80d7-a7b607508df4" });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.route("**/threads/01a086a1-a5fd-7fd1-80d7-a7b607508df4/resume", (route) => route.fulfill({ json: {
    thread: { id: "01a086a1-a5fd-7fd1-80d7-a7b607508df4" },
    messages: [{ id: "old", role: "assistant", text: "Keep this view" }],
    effectiveConfiguration: { model: "old-model", reasoning: null, permissions: null, fastMode: null },
    olderCursor: null,
  } }));
  await stubResumeList(page);
  await page.route(`**/threads/${resumableThreadId}/resume`, (route) => route.fulfill({ status: 502, json: { error: "Codex unavailable" } }));
  await page.goto("/");
  await expect(page.getByText("Keep this view", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: /Thread resume/ }).click();

  await expect(page.getByRole("alert")).toContainText("Thread could not be resumed");
  await expect(page.getByText("Keep this view", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.relay))).toEqual({
    threadId: "01a086a1-a5fd-7fd1-80d7-a7b607508df4",
    messages: [{ id: "old", role: "assistant", text: "Keep this view" }],
    effectiveConfiguration: { model: "old-model", reasoning: null, permissions: null, fastMode: null },
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Keep this view", { exact: true })).toBeVisible();
});

test("New resolves and announces a concrete local configuration without creating a Thread", async ({ page }) => {
  const mutations = [];
  await page.route("**/configuration/resolve", async (route) => {
    mutations.push(JSON.parse(route.request().postData()));
    await route.fulfill({ json: { configuration: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false, serviceTier: null }, configurationRevision: "new-revision" } });
  });
  await page.route("**/threads/*/resume", (route) => { mutations.push("resume"); return route.abort(); });
  await page.route("**/turn", (route) => { mutations.push("turn"); return route.abort(); });
  await openConfiguredClient(page);

  await page.getByRole("button", { name: "New" }).click();

  await expect(page.getByLabel("Prompt")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await expect(page.getByRole("status", { name: "Pre-Turn configuration" })).toHaveText("Model: Codex 1 · Reasoning: medium · Permissions: workspace write · Fast mode: Off");
  expect(mutations).toEqual([{ model: "default", reasoning: "default", permissions: "default", fastMode: "default" }]);
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).preTurnConfiguration)).toEqual({
    configuration: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false, serviceTier: null },
    configurationRevision: "new-revision",
  });
});

test("an untouched local New view and its concrete announcement survive reload", async ({ page }) => {
  await page.addInitScript(({ configuration, preTurnConfiguration }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId: null, messages: [], localNew: true, preTurnConfiguration }));
  }, {
    configuration: appliedConfiguration,
    preTurnConfiguration: { configuration: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false, serviceTier: null }, configurationRevision: "persisted-revision" },
  });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");

  await expect(page.getByLabel("Prompt")).toBeEnabled();
  await expect(page.getByRole("status", { name: "Pre-Turn configuration" })).toContainText("Model: Codex 1");
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).preTurnConfiguration.configurationRevision)).toBe("persisted-revision");
});

test("a persisted Thread stays locked until reload installs canonical history and effective state", async ({ page }) => {
  let releaseResume;
  await page.addInitScript(({ configuration, threadId }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({
      threadId,
      messages: [
        { id: "cached", role: "assistant", text: "Cached answer" },
        { id: "partial", role: "assistant", text: "Interrupted draft", interrupted: true },
        { id: "recovery", role: "assistant", text: "Turn recovery unavailable", error: true },
      ],
      effectiveConfiguration: { model: "cached-model", reasoning: "low", permissions: null, fastMode: null },
    }));
  }, { configuration: appliedConfiguration, threadId: resumableThreadId });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.route(`**/threads/${resumableThreadId}/resume`, async (route) => {
    await new Promise((resolve) => { releaseResume = resolve; });
    await route.fulfill({ json: {
      thread: { id: resumableThreadId },
      messages: [{ id: "canonical", role: "assistant", text: "Canonical answer" }],
      effectiveConfiguration: { model: "codex-1", reasoning: "high", permissions: null, fastMode: { enabled: true, serviceTier: "priority" } },
      olderCursor: "older-cursor",
    } });
  });

  await page.goto("/");
  await expect.poll(() => typeof releaseResume).toBe("function");
  await expect(page.getByLabel("Prompt")).toBeDisabled();
  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Restoring Thread" })).toBeVisible();

  releaseResume();
  await expect(page.getByLabel("Prompt")).toBeEnabled();
  await expect(page.getByText("Canonical answer", { exact: true })).toBeVisible();
  await expect(page.getByText("Cached answer", { exact: true })).toBeHidden();
  await expect(page.getByText("Interrupted draft", { exact: true })).toBeHidden();
  await expect(page.getByText("Turn recovery unavailable", { exact: true })).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.relay))).toEqual({
    threadId: resumableThreadId,
    messages: [{ id: "canonical", role: "assistant", text: "Canonical answer" }],
    effectiveConfiguration: { model: "codex-1", reasoning: "high", permissions: null, fastMode: { enabled: true, serviceTier: "priority" } },
  });
});

test("an unavailable persisted Thread recovers to a composer-enabled local New view", async ({ page }) => {
  const mutations = [];
  await page.addInitScript(({ configuration, threadId }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId, messages: [{ id: "cached", role: "assistant", text: "Cached answer" }] }));
  }, { configuration: appliedConfiguration, threadId: resumableThreadId });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.route(`**/threads/${resumableThreadId}/resume`, (route) => {
    mutations.push("resume");
    return route.fulfill({ status: 404, json: { error: "Thread not found" } });
  });
  await page.route("**/configuration/resolve", (route) => {
    mutations.push("resolve");
    return route.fulfill({ json: {
      configuration: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false, serviceTier: null },
      configurationRevision: "recovery-revision",
    } });
  });
  await page.route("**/turn", (route) => {
    mutations.push("turn");
    return route.abort();
  });

  await page.goto("/");

  await expect(page.getByLabel("Prompt")).toBeEnabled();
  await expect(page.getByText("Cached answer", { exact: true })).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "saved Thread is unavailable" })).toContainText("Returned to a new view");
  await expect(page.getByRole("status", { name: "Pre-Turn configuration" })).toContainText("Model: Codex 1");
  expect(mutations).toEqual(["resume", "resolve"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.relay))).toEqual({
    threadId: null,
    messages: [],
    localNew: true,
    preTurnConfiguration: {
      configuration: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false, serviceTier: null },
      configurationRevision: "recovery-revision",
    },
  });
});

test("the first local Turn retries an obsolete revision with a newly resolved snapshot", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.__turnAttempts = 0;
    window.fetch = async (input, init) => {
      const url = new URL(input, location.href);
      if (url.pathname === "/turn" && window.__turnAttempts++ === 0) return Response.json({
        error: "Configuration options changed. Refresh them and try again.",
        failure: {
          version: 1, source: "relay", code: "configuration_obsolete", operation: "turn.create",
          retryable: true, message: "Configuration options changed. Refresh them and try again.", action: "change_configuration",
          diagnosticId: "baae26b1-655a-4842-b2cd-64e54a2f5207",
        },
      }, { status: 409 });
      return originalFetch(input, init);
    };
  });
  await page.getByRole("button", { name: "New" }).click();
  await page.getByLabel("Prompt").fill("Start safely");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());

  await expect.poll(() => page.evaluate(() => window.__turnAttempts)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__turnRequest.configurationRevision)).toBe("stream-revision");
  await expect(page.getByRole("status", { name: "Pre-Turn configuration" })).toBeVisible();
  await page.evaluate(() => window.__pushTurnEvent({ type: "thread.started", thread_id: "abc-123" }));
  await expect(page.getByRole("status", { name: "Pre-Turn configuration" })).toBeHidden();
});

test("startup checking locks every Thread entry action until live availability loads", async ({ page }) => {
  const obsoleteConfiguration = {
    token: "valid-token",
    model: "retired-model",
    reasoning: "high",
    permissions: "workspace-write",
  };
  let releaseInfo;
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, obsoleteConfiguration);
  await page.route("**/configuration", async (route) => {
    await new Promise((resolve) => { releaseInfo = resolve; });
    await route.fulfill({ json: modelInfo });
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Show status" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume" })).toBeDisabled();
  await expect(page.getByLabel("Prompt")).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Checking Settings");
  releaseInfo();

  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual({
    token: "valid-token",
    model: "",
    reasoning: "",
    permissions: "workspace-write",
    fastMode: null,
  });
  await expect(page.getByRole("status")).toContainText("reset to Default");
});

test("failed startup checking opens Settings with the committed token and no cancellation", async ({ page }) => {
  const persistedConfiguration = {
    token: "persisted-secret",
    model: "codex-1",
    reasoning: "high",
    permissions: "read-only",
  };
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, persistedConfiguration);
  await page.route("**/configuration", (route) => route.fulfill({ status: 401, json: { error: "Unauthorized" } }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("API token")).toHaveValue("persisted-secret");
  await expect(page.getByRole("alert")).not.toContainText("persisted-secret");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
});

test("successful token replacement preserves the Thread and resets requested Configuration", async ({ page }) => {
  const authorizations = [];
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId: null, messages: [{ role: "assistant", text: "Kept transcript" }] }));
  }, { token: "valid-token", model: "codex-1", reasoning: "high", permissions: "read-only" });
  await page.route("**/configuration", (route) => {
    authorizations.push(route.request().headers().authorization);
    return route.fulfill({ json: modelInfo });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  authorizations.length = 0;

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("API token").fill("  replacement-token  ");
  await page.getByRole("button", { name: "Save and connect" }).click();

  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await expect(page.getByText("Kept transcript")).toBeVisible();
  expect(authorizations).toEqual(["Bearer replacement-token"]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual({
    token: "replacement-token",
    model: "",
    reasoning: "",
    permissions: "",
    fastMode: null,
  });
});

test("pending Settings validation locks conflicting actions and cannot submit twice", async ({ page }) => {
  let requestCount = 0;
  let releaseInfo;
  await page.goto("/");
  await page.route("**/configuration", async (route) => {
    requestCount += 1;
    await new Promise((resolve) => { releaseInfo = resolve; });
    await route.fulfill({ json: modelInfo });
  });
  await page.getByLabel("API token").fill("valid-token");
  await page.getByRole("button", { name: "Save and connect" }).click();

  await expect(page.getByLabel("API token")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save and connect" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
  await page.getByRole("button", { name: "Save and connect" }).evaluate((button) => button.click());
  expect(requestCount).toBe(1);
  releaseInfo();
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  expect(requestCount).toBe(1);
});

test("Cancel discards a later Settings token draft", async ({ page }) => {
  await openConfiguredClient(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("API token").fill("abandoned-token");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByLabel("API token")).toHaveValue("valid-token");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("failed token replacement restores its committed token and authenticated state", async ({ page }) => {
  let requestCount = 0;
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/configuration", (route) => {
    requestCount += 1;
    if (requestCount === 1) return route.fulfill({ json: modelInfo });
    return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("API token").fill("secret-rejected-token");
  await page.getByRole("button", { name: "Save and connect" }).click();

  const error = page.getByRole("alert");
  await expect(error).toBeFocused();
  await expect(error).toContainText("rejected");
  await expect(error).not.toContainText("secret-rejected-token");
  await expect(page.getByLabel("API token")).toHaveValue("valid-token");
  await expect(page.getByLabel("API token")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#token-error")).toContainText("rejected");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

for (const [name, responseStatus, expected] of [
  ["upstream unavailability", 502, "unavailable"],
  ["an unexpected response", 500, "could not be checked"],
]) {
  test(`failed Settings validation handles ${name} without changing authenticated state`, async ({ page }) => {
    let requestCount = 0;
    await page.addInitScript((configuration) => {
      localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    }, appliedConfiguration);
    await page.route("**/configuration", (route) => {
      requestCount += 1;
      if (requestCount === 1) return route.fulfill({ json: modelInfo });
      return route.fulfill({ status: responseStatus, json: { error: "private detail" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("API token").fill("rejected-draft");
    await page.getByRole("button", { name: "Save and connect" }).click();

    await expect(page.getByRole("alert")).toContainText(expected);
    await expect(page.getByRole("alert")).not.toContainText("private detail");
    await expect(page.getByLabel("API token")).toHaveValue("valid-token");
    expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
  });
}

test("failed Settings validation handles a network failure without changing authenticated state", async ({ page }) => {
  let requestCount = 0;
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/configuration", (route) => {
    requestCount += 1;
    return requestCount === 1 ? route.fulfill({ json: modelInfo }) : route.abort("failed");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("API token").fill("rejected-draft");
  await page.getByRole("button", { name: "Save and connect" }).click();

  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await expect(page.getByLabel("API token")).toHaveValue("valid-token");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("structured Settings feedback exposes source, recovery, and diagnostic identity without losing authenticated state", async ({ page }) => {
  let requestCount = 0;
  await page.addInitScript((configuration) => localStorage.setItem("relayConfiguration", JSON.stringify(configuration)), appliedConfiguration);
  await page.route("**/configuration", (route) => {
    requestCount += 1;
    if (requestCount === 1) return route.fulfill({ json: modelInfo });
    return route.fulfill({ status: 401, json: {
      error: "The API token was rejected. Check it and try again.",
      failure: {
        version: 1, source: "relay", code: "authentication_rejected", operation: "settings.check",
        retryable: false, message: "The API token was rejected. Check it and try again.", action: "open_settings",
        diagnosticId: "f7f24e7c-fca4-4516-ae1d-2b8203818fb1",
      },
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("API token").fill("rejected-draft");
  await page.getByRole("button", { name: "Save and connect" }).click();

  const feedback = page.locator("#settings-error");
  await expect(feedback).toContainText("Relay · The API token was rejected");
  await expect(feedback.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await feedback.getByText("Details").click();
  await expect(feedback.getByRole("button", { name: /Copy diagnostic ID f7f24/ })).toBeVisible();
  await expect(page.getByLabel("API token")).toHaveValue("valid-token");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("transient reload revalidation keeps the cached Thread locked with Retry and New actions", async ({ page }) => {
  await page.addInitScript(({ configuration, threadId }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId, messages: [{ id: "cached", role: "assistant", text: "Cached answer" }] }));
  }, { configuration: appliedConfiguration, threadId: resumableThreadId });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.route(`**/threads/${resumableThreadId}/resume`, (route) => route.fulfill({ status: 504, json: {
    error: "Relay timed out waiting for the upstream operation. Retry it.",
    failure: {
      version: 1, source: "relay", code: "upstream_timeout", operation: "thread.revalidate",
      retryable: true, message: "Relay timed out waiting for the upstream operation. Retry it.", action: "retry",
      diagnosticId: "179836c0-155c-4d23-9b7f-d16ac1d4a99b",
    },
  } }));

  await page.goto("/");

  await expect(page.getByText("Cached answer", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeDisabled();
  await expect(page.locator("#status")).toContainText("Relay · Relay timed out");
  await expect(page.locator("#status").getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator("#status").getByRole("button", { name: "New Thread" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.relay))).toEqual({
    threadId: resumableThreadId,
    messages: [{ id: "cached", role: "assistant", text: "Cached answer" }],
  });
});

test("Configuration retains field validation after authentication moves to Settings", async ({ page }) => {
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Permissions").evaluate((select) => {
    select.add(new Option("dangerous", "dangerous"));
    select.value = "dangerous";
  });
  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByLabel("Permissions")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#permissions-error")).toContainText("permissions are invalid");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("Configuration still normalizes reasoning when its model changes", async ({ page }) => {
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, { token: "valid-token", model: "codex-1", reasoning: "high", permissions: "read-only" });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("codex-mini");

  await expect(page.getByLabel("Reasoning effort")).toHaveValue("");
  await expect(page.getByLabel("Permissions")).toHaveValue("read-only");
});

test("Configuration constrains Fast mode and atomically applies a live-validated draft once", async ({ page }) => {
  let resolveRequests = 0;
  let releaseResolve;
  await page.route("**/configuration/resolve", async (route) => {
    resolveRequests += 1;
    await new Promise((resolve) => { releaseResolve = resolve; });
    await route.fulfill({ json: { configuration: { model: "codex-1", reasoning: "high", permissions: "read-only", fastMode: true, serviceTier: "priority" }, configurationRevision: "revision-1" } });
  });
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("codex-1");
  await page.getByLabel("Reasoning effort").selectOption("high");
  await page.getByLabel("Permissions").selectOption("read-only");
  await page.getByLabel("Fast mode").selectOption("on");
  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByRole("button", { name: "Apply and close" })).toBeDisabled();
  await page.getByRole("button", { name: "Apply and close" }).evaluate((button) => button.click());
  expect(resolveRequests).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
  releaseResolve();
  await expect(page.getByRole("button", { name: "Configure" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual({ token: "valid-token", model: "codex-1", reasoning: "high", permissions: "read-only", fastMode: true, configurationRevision: "revision-1" });
});

test("Configuration keeps an unsupported draft and shows stable server field errors", async ({ page }) => {
  await page.route("**/configuration/resolve", (route) => route.fulfill({ status: 400, json: { error: "Configuration is unsupported", fieldErrors: { fastMode: "Fast mode is not supported by the selected model." } } }));
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("codex-1");
  await page.getByLabel("Fast mode").selectOption("on");
  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByLabel("Fast mode")).toHaveValue("on");
  await expect(page.getByLabel("Fast mode")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Fast mode")).toBeFocused();
  await expect(page.locator("#fast-mode-error")).toContainText("not supported");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("changing to a model without Fast support clears and disables the Fast draft", async ({ page }) => {
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("codex-1");
  await page.getByLabel("Fast mode").selectOption("on");
  await page.getByLabel("Model", { exact: true }).selectOption("codex-mini");
  await expect(page.getByLabel("Fast mode")).toHaveValue("");
  await expect(page.getByLabel("Fast mode")).toBeDisabled();
});

test("an active Turn locks actions, keeps prompt focus, and uses Applied configuration", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  const prompt = page.getByLabel("Prompt");
  await prompt.fill("Ship it");
  await prompt.focus();
  await page.locator("#composer").evaluate((form) => form.requestSubmit());

  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Show status" })).toBeEnabled();
  await expect(prompt).toBeEnabled();
  await expect(prompt).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__turnRequest)).toEqual(expect.objectContaining({
    prompt: "Ship it",
    threadId: null,
    turnId: expect.any(String),
  }));

  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "thread.started", thread_id: "abc-123" });
    window.__pushTurnEvent({ type: "item.completed", item: { type: "agent_message", text: "Done" } });
    window.__finishTurn();
  });
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await expect(prompt).toBeFocused();
});

test("Show status presents independent effective fields and locally formatted limits", async ({ page }) => {
  await page.route("**/status", (route) => route.fulfill({ json: {
    generatedAt: "2026-09-10T12:00:00.000Z",
    scope: { threadId: null },
    configuration: {
      model: { value: "codex-1", observedAt: "2026-09-10T12:00:00.000Z", stale: false },
      reasoning: { value: "medium", observedAt: "2026-09-10T12:00:00.000Z", stale: false },
      permissions: { value: "workspace-write", observedAt: "2026-09-10T12:00:00.000Z", stale: false },
      fastMode: { value: { enabled: true, serviceTier: "priority" }, observedAt: "2026-09-10T12:00:00.000Z", stale: false },
    },
    context: { unavailable: true, reason: "not_started" },
    rateLimits: {
      fiveHour: { remainingPercent: { value: 73, observedAt: "2026-09-10T12:00:00.000Z", stale: false }, resetsAt: { value: 1789057800, observedAt: "2026-09-10T12:00:00.000Z", stale: false } },
      weekly: { remainingPercent: { unavailable: true, reason: "not_reported" }, resetsAt: { unavailable: true, reason: "not_reported" } },
    },
    errors: [],
  } }));
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Show status" }).click();

  const liveStatus = page.locator("#status");
  await expect(liveStatus).toContainText("Model: Codex 1");
  await expect(liveStatus).toContainText("Reasoning: medium");
  await expect(liveStatus).toContainText("Permissions: workspace write");
  await expect(liveStatus).toContainText("Fast mode: On");
  await expect(liveStatus).toContainText("Context usage: Not started");
  await expect(liveStatus).toContainText("5-hour: 73% remaining");
  await expect(liveStatus).toContainText("Weekly: Unavailable remaining · Resets Unavailable");
  await expect(liveStatus.locator("time")).toHaveAttribute("aria-label", /[A-Z]{2,5}|Coordinated Universal Time|UTC/);
});

test("Show status refreshes during an active Turn without interrupting it", async ({ page }) => {
  let statusRequests = 0;
  await installStreamingTurn(page);
  await page.route("**/status?*", (route) => { statusRequests += 1; return route.fulfill({ json: {
    generatedAt: new Date().toISOString(), scope: { threadId: "abc-123" },
    configuration: { model: { value: "codex-1", observedAt: new Date().toISOString(), stale: false }, reasoning: { unavailable: true, reason: "not_reported" }, permissions: { unavailable: true, reason: "not_reported" }, fastMode: { unavailable: true, reason: "not_reported" } },
    context: { value: { usedTokens: 50000, windowTokens: 200000, percentage: 25 }, observedAt: new Date().toISOString(), stale: false },
    rateLimits: { fiveHour: { remainingPercent: { unavailable: true, reason: "not_reported" }, resetsAt: { unavailable: true, reason: "not_reported" } }, weekly: { remainingPercent: { unavailable: true, reason: "not_reported" }, resetsAt: { unavailable: true, reason: "not_reported" } } }, errors: [],
  } }); });
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("Keep working");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  await page.evaluate(() => window.__pushTurnEvent({ type: "thread.started", thread_id: "abc-123" }));

  await page.getByRole("button", { name: "Show status" }).click();
  await expect(page.locator("#status")).toContainText("Context usage: 50,000 / 200,000 (25%)");
  expect(statusRequests).toBe(1);
  expect(await page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
});

test("a failed Status refresh retains values as stale and offers one Retry action", async ({ page }) => {
  let attempts = 0;
  await page.route("**/status", (route) => {
    attempts += 1;
    if (attempts > 1) return route.fulfill({ status: 502, json: { error: "private detail" } });
    return route.fulfill({ json: {
      generatedAt: "2026-09-10T12:00:00.000Z", scope: { threadId: null },
      configuration: { model: { value: "codex-1", observedAt: "2026-09-10T12:00:00.000Z", stale: false }, reasoning: { unavailable: true, reason: "not_reported" }, permissions: { unavailable: true, reason: "not_reported" }, fastMode: { unavailable: true, reason: "not_reported" } },
      context: { unavailable: true, reason: "not_started" },
      rateLimits: { fiveHour: { remainingPercent: { unavailable: true, reason: "not_reported" }, resetsAt: { unavailable: true, reason: "not_reported" } }, weekly: { remainingPercent: { unavailable: true, reason: "not_reported" }, resetsAt: { unavailable: true, reason: "not_reported" } } }, errors: [],
    } });
  });
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Show status" }).click();
  await page.getByRole("button", { name: "Show status" }).click();

  await expect(page.locator("#status")).toContainText("Model: Codex 1");
  await expect(page.locator("#status")).toContainText("May be outdated");
  await expect(page.locator("#status")).not.toContainText("private detail");
  await expect(page.getByRole("button", { name: "Retry status" })).toHaveCount(1);
});

test("an initial Status failure shows unavailable fields and one Retry action", async ({ page }) => {
  await page.route("**/status", (route) => route.fulfill({ status: 502, json: { error: "private detail" } }));
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Show status" }).click();

  await expect(page.locator("#status")).toContainText("Model: Unavailable");
  await expect(page.locator("#status")).toContainText("May be outdated");
  await expect(page.locator("#status")).not.toContainText("private detail");
  await expect(page.locator("#status").getByRole("button", { name: "Retry" })).toHaveCount(1);
});

test("a failed Turn restores locked actions without stealing prompt focus", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  const prompt = page.getByLabel("Prompt");
  await prompt.fill("Try this");
  await prompt.focus();
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => window.__pushTurnEvent({ type: "error", message: "Turn failed" }));

  await expect(page.locator(".message.error")).toContainText("Unknown · The Turn failed");
  await expect(page.getByRole("button", { name: "New" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await expect(prompt).toBeFocused();
});

test("a dropped Turn subscription reconnects without replacing accumulated output", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("Keep going");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "thread.started", thread_id: "abc-123" });
    window.__pushTurnEvent({ type: "item.delta", item: { id: "assistant-1", type: "agent_message", delta: "Already here" } });
  });
  await expect(page.getByText("Already here", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__dropTurn());
  await expect(page.getByRole("status")).toContainText("Reconnecting");
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "item.delta", item: { id: "assistant-1", type: "agent_message", delta: " and recovered" } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "assistant-1", type: "agent_message", text: "Already here and recovered" } });
    window.__finishTurn();
  });

  await expect(page.getByText("Already here and recovered", { exact: true })).toBeVisible();
  await expect(page.getByText(/Error: Load failed/)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).activeTurn)).toBeNull();
});

test("assistant items reconcile deltas and authoritative completion by item ID", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("Explain it");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "item.delta", item: { id: "a1", type: "agent_message", delta: "Dra" } });
    window.__pushTurnEvent({ type: "item.delta", item: { id: "a1", type: "agent_message", delta: "ft" } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "a1", type: "agent_message", text: "First final" } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "a1", type: "agent_message", text: "Must not replace final" } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "a2", type: "agent_message", text: "Second final" } });
    window.__pushTurnEvent({ type: "item.delta", item: { id: "empty", type: "agent_message", delta: "Discarded draft" } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "empty", type: "agent_message", text: "" } });
    window.__finishTurn();
  });

  await expect(page.locator(".message.assistant")).toHaveCount(2);
  await expect(page.locator(".message.assistant").nth(0)).toHaveText("First final");
  await expect(page.locator(".message.assistant").nth(1)).toHaveText("Second final");
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).messages.filter(({ role }) => role === "assistant"))).toEqual([
    { id: "a1", role: "assistant", text: "First final" },
    { id: "a2", role: "assistant", text: "Second final" },
  ]);
});

test("activity is one accessible transient bubble with reduced-motion decoration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("Work");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => window.__pushTurnEvent({ type: "activity", category: "Thinking" }));
  const activity = page.locator(".activity");
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute("aria-label", "Thinking");
  await expect(activity.locator("[aria-hidden=true]")).toHaveText("…");
  await page.evaluate(() => window.__pushTurnEvent({ type: "thread.started", thread_id: "abc-123" }));
  await expect(activity).not.toHaveAttribute("role", "status");
  await page.evaluate(() => window.__pushTurnEvent({ type: "activity", category: "Running" }));
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute("role", "status");
  await expect(activity).toHaveAttribute("aria-label", "Running");
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "activity", category: null });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "a1", type: "agent_message", text: "Done" } });
    window.__finishTurn();
  });
  await expect(activity).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).messages.some(({ role }) => role === "activity"))).toBe(false);
});

test("a failed Turn keeps interrupted output and a separate replay-safe error", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("Try");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "item.delta", item: { id: "a1", type: "agent_message", delta: "Partial" } });
    window.__pushTurnEvent({ type: "error", id: "relay:turn:error", message: "Disconnected" });
  });

  await expect(page.locator(".message.interrupted")).toContainText("PartialInterrupted");
  await expect(page.locator(".message.error")).toContainText("Unknown · The Turn failed");
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).messages.map(({ text }) => text))).toEqual(["Try", "Unknown · The Turn failed."]);
});

test("a structured terminal Turn failure is actionable, private-detail free, and announced once", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("A prompt that must be preserved");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  await page.evaluate(() => window.__pushTurnEvent({
    type: "error",
    id: "relay:turn:error",
    message: "The context window is full. This Turn stopped. Start a new Thread or shorten the prompt.",
    failure: {
      version: 1, source: "codex", code: "context_window_exceeded", operation: "turn.stream",
      retryable: false, message: "The context window is full. This Turn stopped. Start a new Thread or shorten the prompt.",
      action: "start_new_thread", diagnosticId: "77b0aed7-3d61-4542-af60-e2248fb078aa",
    },
    privateCause: "token=/secret path=/workspaces/private",
  }));

  const feedback = page.locator('.message.error[data-item-id="relay:turn:error"]');
  await expect(feedback).toContainText("Codex · The context window is full");
  await expect(feedback.getByRole("button", { name: "New Thread" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.locator("#status")).toHaveText("Turn failed.");
  await expect(page.locator("#status")).not.toContainText("context window is full");
  await expect(feedback).not.toContainText("/secret");
  expect(await feedback.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("an invalid source and code pair uses safe fallback copy", async ({ page }) => {
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/configuration", (route) => route.fulfill({ status: 502, json: {
    error: "private legacy detail",
    failure: {
      version: 1, source: "connection", code: "turn_failed", operation: "settings.check",
      retryable: true, message: "Attacker-controlled failure prose", action: "retry",
    },
  } }));

  await page.goto("/");

  await expect(page.locator("#settings-error")).toContainText("Unknown · The settings check operation could not be completed.");
  await expect(page.locator("body")).not.toContainText("Attacker-controlled failure prose");
});

test("Codex authentication shows safe Open and Copy actions and preserves client state", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value) => { window.__copiedCode = value; } } });
  });
  let polls = 0;
  await page.route("**/codex/device-auth", (route) => route.fulfill({ status: 202, json: {
    attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending",
    verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EF12",
  } }));
  await page.route("**/codex/device-auth/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", (route) => {
    polls += 1;
    return route.fulfill({ json: { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "succeeded" } });
  });
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  const configurationBefore = await page.evaluate(() => localStorage.relayConfiguration);
  await page.getByLabel("Prompt").fill("Authenticate");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  await page.evaluate(() => window.__pushTurnEvent({
    type: "error",
    id: "relay:turn:auth-error",
    failure: {
      version: 1, source: "codex", code: "authentication_rejected", operation: "turn.stream",
      retryable: false, message: "Codex authentication was rejected. Authenticate Codex, then retry.",
      action: "authenticate_codex",
    },
  }));

  const stateBeforeAuthentication = await page.evaluate(() => localStorage.relay);
  await page.getByRole("button", { name: "Authenticate Codex" }).click();
  await expect(page.getByRole("link", { name: "Open login page" })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  await expect(page.getByText("ABCD-EF12", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy code" }).click();
  expect(await page.evaluate(() => window.__copiedCode)).toBe("ABCD-EF12");
  await expect(page.locator(".device-auth-progress")).toContainText("Codex authentication succeeded.");
  expect(polls).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.relayConfiguration)).toBe(configurationBefore);
  expect(await page.evaluate(() => localStorage.relay)).toBe(stateBeforeAuthentication);
  expect(await page.evaluate(() => document.querySelector(".device-auth-card").scrollWidth <= document.querySelector(".device-auth-card").clientWidth)).toBe(true);
});

for (const terminalStatus of ["expired", "failed"]) {
  test(`Codex authentication polling announces ${terminalStatus}`, async ({ page }) => {
    const attemptId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await page.route("**/codex/device-auth", (route) => route.fulfill({ status: 202, json: {
      attemptId, status: "pending", verificationUrl: "https://auth.openai.com/codex/device", userCode: "SAFE-CODE",
    } }));
    await page.route(`**/codex/device-auth/${attemptId}`, (route) => route.fulfill({ json: {
      attemptId, status: terminalStatus,
      ...(terminalStatus === "failed" ? { failure: {
        version: 1, source: "unknown", code: "upstream_failure", operation: "codex.authenticate", retryable: true,
        message: "An upstream operation failed. Retry it.", action: "retry", diagnosticId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      } } : {}),
    } }));
    await installStreamingTurn(page);
    await openConfiguredClient(page);
    await page.getByLabel("Prompt").fill("Authenticate");
    await page.locator("#composer").evaluate((form) => form.requestSubmit());
    await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
    await page.evaluate(() => window.__pushTurnEvent({ type: "error", id: "relay:auth", failure: {
      version: 1, source: "codex", code: "authentication_rejected", operation: "turn.stream", retryable: false,
      message: "Codex authentication was rejected. Authenticate Codex, then retry.", action: "authenticate_codex",
    } }));
    await page.getByRole("button", { name: "Authenticate Codex" }).click();
    await expect(page.locator(".device-auth-progress")).toHaveText(`Codex authentication ${terminalStatus}.`);
    if (terminalStatus === "failed") await expect(page.locator(".device-auth-failure")).toContainText("Unknown · An upstream operation failed.");
  });
}

test("repairable subscription failure preserves the accepted Turn for replay", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.evaluate(() => {
    window.__turnRecoveryFailure = {
      version: 1, source: "relay", code: "authentication_rejected", operation: "turn.recover",
      retryable: false, message: "The API token was rejected. Check it and try again.",
      action: "open_settings", httpStatus: 401,
    };
  });
  await page.getByLabel("Prompt").fill("Preserve this accepted Turn");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());

  await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
  const acceptedTurnId = await page.evaluate(() => JSON.parse(localStorage.relay).activeTurn.id);
  await page.getByRole("button", { name: "Open Settings" }).click();
  await page.getByRole("button", { name: "Save and connect" }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).activeTurn.id)).toBe(acceptedTurnId);
  await page.evaluate(() => window.__finishTurn());
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.relay).activeTurn)).toBeNull();
});

test("significant partial output remains interrupted when Turn recovery is unavailable", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  await page.getByLabel("Prompt").fill("Try");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "item.delta", item: { id: "a1", type: "agent_message", delta: "Temporary" } });
    window.__rejectTurnRecovery = true;
    window.__dropTurn();
  });

  await expect(page.locator(".message.interrupted")).toContainText("TemporaryInterrupted");
  await expect(page.getByRole("status")).toContainText("This Turn is no longer retained");
  expect(await page.evaluate(() => JSON.parse(localStorage.relay).messages.map(({ text, interrupted }) => ({ text, interrupted: Boolean(interrupted) })))).toEqual([
    { text: "Try", interrupted: false },
    { text: "Temporary", interrupted: true },
  ]);
});

test("the composer grows to its viewport cap and New resets it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await openConfiguredClient(page);
  const prompt = page.getByLabel("Prompt");
  const initialHeight = await prompt.evaluate((element) => element.getBoundingClientRect().height);

  await prompt.fill("   ");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(prompt).toHaveValue("   ");

  await prompt.fill(Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"));
  const grown = await prompt.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));

  expect(initialHeight).toBeGreaterThanOrEqual(46);
  expect(grown.height).toBeGreaterThan(initialHeight);
  expect(grown.height).toBeLessThanOrEqual(126);
  expect(grown.scrollHeight).toBeGreaterThan(grown.clientHeight);
  expect(grown.overflowY).toBe("auto");

  await page.getByRole("button", { name: "New" }).click();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue("");
  await expect.poll(() => prompt.evaluate((element) => element.getBoundingClientRect().height)).toBe(initialHeight);
});

test("agent fenced code is safe and owns horizontal overflow", async ({ page }) => {
  const longCode = `const value = "${"x".repeat(220)}";`;
  const longToken = "y".repeat(220);
  await page.addInitScript(({ configuration, code, ordinaryToken }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({
      threadId: null,
      messages: [{
        role: "assistant",
        text: `ordinary ${ordinaryToken} <script>window.__executed = true</script> and \`inline\`\n\n\`\`\`js\n${code}\n\`\`\`\n\nunmatched \`\`\` fence`,
      }],
    }));
  }, { configuration: appliedConfiguration, code: longCode, ordinaryToken: longToken });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();

  const code = page.locator(".message pre > code");
  await expect(code).toHaveText(`${longCode}\n`);
  await expect(code.locator("..")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".message")).toContainText(longToken);
  await expect(page.locator(".message")).toContainText("<script>window.__executed = true</script>");
  await expect(page.locator(".message")).toContainText("`inline`");
  await expect(page.locator(".message")).toContainText("unmatched ``` fence");
  expect(await page.evaluate(() => window.__executed)).toBeUndefined();
  const overflow = await page.locator(".message pre").evaluate((element) => ({
    own: element.scrollWidth > element.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.own).toBe(true);
  expect(overflow.documentWidth).toBe(overflow.viewportWidth);
});

test("streaming follows within 80px and preserves a reader who scrolls away", async ({ page }) => {
  const seededMessages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    text: `message ${index}\n${"content ".repeat(12)}`,
  }));
  await page.addInitScript(({ configuration, messages }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId: "abc-123", messages }));
  }, { configuration: appliedConfiguration, messages: seededMessages });
  await installStreamingTurn(page);
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await page.getByLabel("Prompt").fill("continue");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => window.__pushTurnEvent({ type: "activity", category: "Thinking" }));
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "activity", category: null });
    window.__pushTurnEvent({ type: "item.delta", item: { id: "first", type: "agent_message", delta: "draft" } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "first", type: "agent_message", text: "first\n".repeat(30) } });
  });
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);

  await page.locator("#messages").evaluate(async (element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 60;
    element.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "activity", category: "Running" });
    window.__pushTurnEvent({ type: "activity", category: null });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "near", type: "agent_message", text: "near\n".repeat(10) } });
  });
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);

  await page.locator("#messages").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const readingPosition = await page.locator("#messages").evaluate((element) => element.scrollTop);
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "item.delta", item: { id: "second", type: "agent_message", delta: "second\n".repeat(30) } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "second", type: "agent_message", text: "second\n".repeat(30) } });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "error-position", type: "error", text: "Nonfatal" } });
    window.__pushTurnEvent({ type: "activity", category: "Researching" });
  });
  await expect(page.locator('.message[data-item-id="second"]')).toContainText("second");
  await page.waitForTimeout(50);
  expect(await page.locator("#messages").evaluate((element) => element.scrollTop)).toBe(readingPosition);

  await page.locator("#messages").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(() => {
    window.__pushTurnEvent({ type: "activity", category: null });
    window.__pushTurnEvent({ type: "item.completed", item: { id: "third", type: "agent_message", text: "third\n".repeat(30) } });
  });
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.__finishTurn());
});

test("streaming batches bottom-follow scrolling to one animation frame", async ({ page }) => {
  const seededMessages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    text: `message ${index}\n${"content ".repeat(12)}`,
  }));
  await page.addInitScript(({ configuration, messages }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId: "abc-123", messages }));
  }, { configuration: appliedConfiguration, messages: seededMessages });
  await installStreamingTurn(page);
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await page.getByLabel("Prompt").fill("continue");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__threadScrolls = 0;
    document.querySelector("#messages").addEventListener("scroll", () => { window.__threadScrolls += 1; });
    window.__pushTurnEvent({ type: "item.completed", item: { type: "agent_message", text: "one\n".repeat(8) } });
    window.__pushTurnEvent({ type: "item.completed", item: { type: "agent_message", text: "two\n".repeat(8) } });
    window.__pushTurnEvent({ type: "item.completed", item: { type: "agent_message", text: "three\n".repeat(8) } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  expect(await page.evaluate(() => window.__threadScrolls)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.__finishTurn());
});

test("viewport resize follows the bottom or preserves the visible reading anchor", async ({ page }) => {
  const seededMessages = Array.from({ length: 32 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    text: `anchor message ${index}\n${"content ".repeat(16)}`,
  }));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(({ configuration, messages }) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    localStorage.setItem("relay", JSON.stringify({ threadId: "abc-123", messages }));
  }, { configuration: appliedConfiguration, messages: seededMessages });
  await page.route("**/configuration", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await page.locator("#messages").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });

  await page.setViewportSize({ width: 390, height: 600 });
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);

  await page.locator("#messages").evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel"));
    element.scrollTop = 320;
    element.dispatchEvent(new Event("scroll"));
  });
  const before = await page.locator("#messages").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const visible = [...element.children].find((child) => child.getBoundingClientRect().bottom >= top);
    return { text: visible.textContent, offset: visible.getBoundingClientRect().top - top };
  });

  await page.setViewportSize({ width: 390, height: 500 });
  const after = await page.locator("#messages").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const visible = [...element.children].find((child) => child.getBoundingClientRect().bottom >= top);
    return { text: visible.textContent, offset: visible.getBoundingClientRect().top - top };
  });
  expect(after.text).toBe(before.text);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
});

test("first use opens non-cancellable Settings as a focused view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Save and connect" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeHidden();
  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeDisabled();
  await expect(page.locator("#messages")).toBeHidden();
  await expect(page.locator("#prompt")).toBeHidden();
});

test("missing token is rejected without contacting the Relay", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/configuration", (route) => {
    requestCount += 1;
    return route.fulfill({ json: modelInfo });
  });
  await page.goto("/");
  await page.getByLabel("API token").fill("   ");

  await page.getByRole("button", { name: "Save and connect" }).click();

  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("API token")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(requestCount).toBe(0);
});

test("compact controls expose labels, visible focus, live status, and usable targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openConfiguredClient(page);

  const targetSizes = await page.locator("button, input, select, textarea").evaluateAll((controls) =>
    controls
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((control) => ({ tag: control.tagName, width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height })),
  );
  for (const target of targetSizes) {
    expect(target.height, target.tag).toBeGreaterThanOrEqual(44);
    if (target.tag === "BUTTON") expect(target.width, target.tag).toBeGreaterThanOrEqual(44);
  }

  const configure = page.getByRole("button", { name: "Configure" });
  await configure.focus();
  expect(await configure.evaluate((button) => ({
    style: getComputedStyle(button).outlineStyle,
    width: parseFloat(getComputedStyle(button).outlineWidth),
  }))).toEqual({ style: "solid", width: 3 });
  await expect(page.getByLabel("Prompt")).toBeVisible();
  await expect(page.locator("#status")).toHaveAttribute("aria-live", "polite");

  const showStatus = page.getByRole("button", { name: "Show status" });
  await expect(showStatus).toBeVisible();
  await expect(showStatus).toHaveAttribute("title", "Show status");
  expect(await showStatus.evaluate((button) => ({
    previousId: button.previousElementSibling?.id,
    text: button.textContent.trim(),
    width: button.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
  }))).toEqual({ previousId: "send", text: "", width: 44, height: 44 });

  await configure.click();
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeFocused();
  await expect(page.getByLabel("API token")).toBeHidden();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Reasoning effort")).toBeVisible();
  await expect(page.getByLabel("Permissions")).toBeVisible();
});

test("the shell declares dynamic viewport, safe-area, and reduced-motion support", async ({ page }) => {
  await openConfiguredClient(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  const styles = await page.evaluate(() => [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
    .join("\n"));
  expect(styles).toContain("100dvh");
  expect(styles).toContain("safe-area-inset-top");
  expect(styles).toContain("safe-area-inset-right");
  expect(styles).toContain("safe-area-inset-bottom");
  expect(styles).toContain("safe-area-inset-left");
  expect(styles).toContain("prefers-reduced-motion: reduce");
});

test("desktop keeps the 720px cap and established visual hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openConfiguredClient(page);

  const desktop = await page.evaluate(() => {
    const shell = document.querySelector("main");
    const visibleChildren = [...shell.children]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => element.id || element.tagName);
    return {
      shellWidth: shell.getBoundingClientRect().width,
      background: getComputedStyle(document.body).backgroundColor,
      visibleChildren,
      statusVisible: getComputedStyle(document.querySelector("#show-status")).display !== "none",
    };
  });

  expect(desktop.shellWidth).toBe(720);
  expect(desktop.background).toBe("rgb(17, 24, 39)");
  expect(desktop.visibleChildren).toEqual(["HEADER", "messages", "status", "composer"]);
  expect(desktop.statusVisible).toBe(true);

  await page.getByRole("button", { name: "Configure" }).click();
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
  await expect(page.locator("#messages")).toBeVisible();
  await expect(page.locator("#composer")).toBeVisible();
});

for (const viewport of viewports) {
  test(`closed Mobile Client fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openConfiguredClient(page);

    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      threadOverflowY: getComputedStyle(document.querySelector("#messages")).overflowY,
      shellHeight: document.querySelector("main").getBoundingClientRect().height,
      composerBottom: document.querySelector("form").getBoundingClientRect().bottom,
    }));

    expect(geometry.documentWidth).toBe(geometry.viewportWidth);
    expect(geometry.documentHeight).toBe(geometry.viewportHeight);
    expect(geometry.threadOverflowY).toBe("auto");
    expect(geometry.shellHeight).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight);

    await page.getByRole("button", { name: "Configure" }).click();
    if (viewport.width < 600) await expect(page.locator("#messages")).toBeHidden();
    else await expect(page.locator("#messages")).toBeVisible();
    const configurationGeometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      panelBottom: document.querySelector("#configuration").getBoundingClientRect().bottom,
      shellBottom: document.querySelector("main").getBoundingClientRect().bottom,
    }));
    expect(configurationGeometry.documentWidth).toBe(configurationGeometry.viewportWidth);
    expect(configurationGeometry.documentHeight).toBe(configurationGeometry.viewportHeight);
    expect(configurationGeometry.panelBottom).toBeLessThanOrEqual(configurationGeometry.shellBottom);
  });
}
