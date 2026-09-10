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
};

const modelInfo = {
  models: [
    {
      id: "codex-1",
      name: "Codex 1",
      isDefault: true,
      defaultReasoning: "medium",
      reasoning: ["low", "medium", "high"],
    },
    {
      id: "codex-mini",
      name: "Codex Mini",
      isDefault: false,
      defaultReasoning: "low",
      reasoning: ["low"],
    },
  ],
  rateLimits: { planType: "test" },
};

async function openConfiguredClient(page) {
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/info", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
}

async function installStreamingTurn(page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (new URL(input, location.href).pathname !== "/turn") return originalFetch(input, init);
      window.__turnRequest = JSON.parse(init.body);
      const stream = new ReadableStream({
        start(controller) {
          window.__pushTurnEvent = (event) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
          window.__finishTurn = () => controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    };
  });
}

test("startup checking locks Thread actions and normalizes obsolete choices", async ({ page }) => {
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
  await page.route("**/info", async (route) => {
    await new Promise((resolve) => { releaseInfo = resolve; });
    await route.fulfill({ json: modelInfo });
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "New" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Checking configuration");
  releaseInfo();

  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual({
    token: "valid-token",
    model: "",
    reasoning: "",
    permissions: "workspace-write",
  });
  await expect(page.getByRole("status")).toContainText("reset to Default");
});

test("failed startup checking opens Configuration with applied values intact", async ({ page }) => {
  const persistedConfiguration = {
    token: "persisted-secret",
    model: "codex-1",
    reasoning: "high",
    permissions: "read-only",
  };
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, persistedConfiguration);
  await page.route("**/info", (route) => route.fulfill({ status: 401, json: { error: "Unauthorized" } }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
  await expect(page.getByLabel("API token")).toHaveValue("persisted-secret");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("codex-1");
  await expect(page.getByLabel("Reasoning effort")).toHaveValue("high");
  await expect(page.getByLabel("Permissions")).toHaveValue("read-only");
  await expect(page.getByRole("alert")).not.toContainText("persisted-secret");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "Cancel", exact: true }).last().click();
  await expect(page.getByLabel("Prompt")).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeDisabled();
});

test("Configuration Apply commits a complete trimmed draft atomically", async ({ page }) => {
  const authorizations = [];
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/info", (route) => {
    authorizations.push(route.request().headers().authorization);
    return route.fulfill({ json: modelInfo });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  authorizations.length = 0;

  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("API token").fill("  replacement-token  ");
  await page.getByLabel("Model", { exact: true }).selectOption("codex-1");
  await page.getByLabel("Reasoning effort").selectOption("high");
  await page.getByLabel("Permissions").selectOption("workspace-write");
  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByRole("button", { name: "Configure" })).toBeFocused();
  expect(authorizations).toEqual(["Bearer replacement-token"]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual({
    token: "replacement-token",
    model: "codex-1",
    reasoning: "high",
    permissions: "workspace-write",
  });
});

test("pending Apply locks Configuration and cannot submit twice", async ({ page }) => {
  let requestCount = 0;
  let releaseInfo;
  await page.goto("/");
  await page.route("**/info", async (route) => {
    requestCount += 1;
    await new Promise((resolve) => { releaseInfo = resolve; });
    await route.fulfill({ json: modelInfo });
  });
  await page.getByLabel("API token").fill("valid-token");
  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByLabel("API token")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Apply and close" })).toBeDisabled();
  await page.getByRole("button", { name: "Apply and close" }).evaluate((button) => button.click());
  expect(requestCount).toBe(1);
  releaseInfo();
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  expect(requestCount).toBe(1);
});

test("Cancel discards the whole Configuration draft", async ({ page }) => {
  await openConfiguredClient(page);

  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("API token").fill("abandoned-token");
  await page.getByLabel("Permissions").selectOption("read-only");
  await page.getByRole("button", { name: "Cancel", exact: true }).last().click();
  await page.getByRole("button", { name: "Configure" }).click();

  await expect(page.getByLabel("API token")).toHaveValue("valid-token");
  await expect(page.getByLabel("Permissions")).toHaveValue("");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("failed Apply preserves the draft and the applied configuration without revealing the token", async ({ page }) => {
  let requestCount = 0;
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, appliedConfiguration);
  await page.route("**/info", (route) => {
    requestCount += 1;
    if (requestCount === 1) return route.fulfill({ json: modelInfo });
    return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("API token").fill("secret-rejected-token");
  await page.getByLabel("Permissions").selectOption("read-only");
  await page.getByRole("button", { name: "Apply and close" }).click();

  const error = page.getByRole("alert");
  await expect(error).toBeFocused();
  await expect(error).toContainText("rejected");
  await expect(error).not.toContainText("secret-rejected-token");
  await expect(page.getByLabel("API token")).toHaveValue("secret-rejected-token");
  await expect(page.getByLabel("API token")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#token-error")).toContainText("rejected");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

for (const failure of [
  { name: "Relay/Codespace unavailability", respond: (route) => route.fulfill({ status: 502, json: { error: "Unavailable" } }), expected: "unavailable" },
  { name: "network failure", respond: (route) => route.abort("failed"), expected: "unavailable" },
  { name: "unexpected response", respond: (route) => route.fulfill({ status: 500, json: { error: "Nope" } }), expected: "could not be checked" },
]) {
  test(`Apply preserves its draft after ${failure.name}`, async ({ page }) => {
    let requestCount = 0;
    await page.addInitScript((configuration) => {
      localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
    }, appliedConfiguration);
    await page.route("**/info", (route) => {
      requestCount += 1;
      if (requestCount === 1) return route.fulfill({ json: modelInfo });
      return failure.respond(route);
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
    await page.getByRole("button", { name: "Configure" }).click();
    await page.getByLabel("API token").fill("draft-token");

    await page.getByRole("button", { name: "Apply and close" }).click();

    await expect(page.getByRole("alert")).toContainText(failure.expected);
    await expect(page.getByLabel("API token")).toHaveValue("draft-token");
    expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
  });
}

test("invalid permissions remain visible and associated with their Apply error", async ({ page }) => {
  await openConfiguredClient(page);
  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Permissions").evaluate((select) => {
    select.add(new Option("dangerous", "dangerous"));
    select.value = "dangerous";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByRole("alert")).toContainText("permissions are invalid");
  await expect(page.getByLabel("Permissions")).toHaveValue("dangerous");
  await expect(page.getByLabel("Permissions")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#permissions-error")).toContainText("permissions are invalid");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(appliedConfiguration);
});

test("changing model resets only an unsupported reasoning draft", async ({ page }) => {
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, { token: "valid-token", model: "codex-1", reasoning: "high", permissions: "read-only" });
  await page.route("**/info", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();

  await page.getByRole("button", { name: "Configure" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("codex-mini");

  await expect(page.getByLabel("Reasoning effort")).toHaveValue("");
  await expect(page.getByLabel("Permissions")).toHaveValue("read-only");
});

test("failed consistency validation keeps every draft choice intact", async ({ page }) => {
  const staleConfiguration = {
    token: "valid-token",
    model: "retired-model",
    reasoning: "high",
    permissions: "read-only",
  };
  let requestCount = 0;
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, staleConfiguration);
  await page.route("**/info", (route) => {
    requestCount += 1;
    if (requestCount === 1) return route.fulfill({ status: 502, json: { error: "Unavailable" } });
    return route.fulfill({ json: modelInfo });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("unavailable");

  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByRole("alert")).toContainText("model is no longer available");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("retired-model");
  await expect(page.getByLabel("Model", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#model-error")).toContainText("model is no longer available");
  await expect(page.getByLabel("Reasoning effort")).toHaveValue("high");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(staleConfiguration);
});

test("unsupported reasoning remains visible and associated with its Apply error", async ({ page }) => {
  const staleConfiguration = {
    token: "valid-token",
    model: "codex-1",
    reasoning: "ultra",
    permissions: "read-only",
  };
  let requestCount = 0;
  await page.addInitScript((configuration) => {
    localStorage.setItem("relayConfiguration", JSON.stringify(configuration));
  }, staleConfiguration);
  await page.route("**/info", (route) => {
    requestCount += 1;
    if (requestCount === 1) return route.fulfill({ status: 502, json: { error: "Unavailable" } });
    return route.fulfill({ json: modelInfo });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByRole("alert")).toContainText("reasoning effort is not supported");
  await expect(page.getByLabel("Reasoning effort")).toHaveValue("ultra");
  await expect(page.getByLabel("Reasoning effort")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#reasoning-error")).toContainText("reasoning effort is not supported");
  expect(await page.evaluate(() => JSON.parse(localStorage.relayConfiguration))).toEqual(staleConfiguration);
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
  await expect(prompt).toBeEnabled();
  await expect(prompt).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__turnRequest)).toEqual({
    prompt: "Ship it",
    threadId: null,
  });

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

test("a failed Turn restores locked actions without stealing prompt focus", async ({ page }) => {
  await installStreamingTurn(page);
  await openConfiguredClient(page);
  const prompt = page.getByLabel("Prompt");
  await prompt.fill("Try this");
  await prompt.focus();
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => window.__pushTurnEvent({ type: "error", message: "Turn failed" }));

  await expect(page.getByText("Error: Turn failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await expect(prompt).toBeFocused();
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
  await page.route("**/info", (route) => route.fulfill({ json: modelInfo }));
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
  await page.route("**/info", (route) => route.fulfill({ json: modelInfo }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure" })).toBeEnabled();
  await page.getByLabel("Prompt").fill("continue");
  await page.locator("#composer").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(() => Boolean(window.__pushTurnEvent))).toBe(true);

  await page.evaluate(() => window.__pushTurnEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "first\n".repeat(30) },
  }));
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);

  await page.locator("#messages").evaluate(async (element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 60;
    element.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.evaluate(() => window.__pushTurnEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "near\n".repeat(10) },
  }));
  await expect.poll(() => page.locator("#messages").evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);

  await page.locator("#messages").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const readingPosition = await page.locator("#messages").evaluate((element) => element.scrollTop);
  await page.evaluate(() => window.__pushTurnEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "second\n".repeat(30) },
  }));
  await expect(page.locator(".message").last()).toContainText("second");
  await page.waitForTimeout(50);
  expect(await page.locator("#messages").evaluate((element) => element.scrollTop)).toBe(readingPosition);

  await page.locator("#messages").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(() => window.__pushTurnEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "third\n".repeat(30) },
  }));
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
  await page.route("**/info", (route) => route.fulfill({ json: modelInfo }));
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
  await page.route("**/info", (route) => route.fulfill({ json: modelInfo }));
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

test("first use opens Configuration as a focused view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Configuration" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Apply and close" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(page.getByLabel("Model", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Reasoning effort")).toBeDisabled();
  await expect(page.locator("#model-hint")).toContainText("Apply an API token");
  await expect(page.locator("#reasoning-hint")).toContainText("Apply an API token");
  await expect(page.locator("#messages")).toBeHidden();
  await expect(page.locator("#prompt")).toBeHidden();
});

test("missing token is rejected without contacting the Relay", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/info", (route) => {
    requestCount += 1;
    return route.fulfill({ json: modelInfo });
  });
  await page.goto("/");
  await page.getByLabel("API token").fill("   ");

  await page.getByRole("button", { name: "Apply and close" }).click();

  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("API token")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();
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
  await expect(page.getByLabel("API token")).toBeVisible();
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
