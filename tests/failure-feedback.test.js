const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createRelay, AppServerConnection } = require("../server");

const relayTurnId = "11111111-1111-4111-8111-111111111111";
const threadId = "01a086a1-a1b5-7f52-bc60-a9db59b03804";

function fakeAppServer() {
  const appServer = new EventEmitter();
  appServer.request = async (method) => {
    if (method === "thread/start") return { thread: { id: threadId } };
    if (method === "turn/start") return { turn: { id: "codex-turn" } };
    return {};
  };
  return appServer;
}

async function serve(appServer = fakeAppServer(), options = {}) {
  const diagnostics = [];
  const app = createRelay({
    appServer,
    env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" },
    logger: { error: (entry) => diagnostics.push(entry) },
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    appServer,
    diagnostics,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function authorized(options = {}) {
  return { ...options, headers: { Authorization: "Bearer secret", ...options.headers } };
}

test("Relay validation failures expose a safe, versioned failure contract", async (t) => {
  const relay = await serve();
  t.after(relay.close);

  const response = await fetch(`${relay.base}/turn`, authorized({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId: relayTurnId, prompt: "" }),
  }));

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "Enter a prompt before starting this Turn.");
  assert.deepEqual(body.failure, {
    version: 1,
    source: "relay",
    code: "request_invalid",
    operation: "turn.create",
    retryable: false,
    message: "Enter a prompt before starting this Turn.",
    action: "none",
    diagnosticId: body.failure.diagnosticId,
  });
  assert.match(body.failure.diagnosticId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(relay.diagnostics[0], {
    diagnosticId: body.failure.diagnosticId,
    timestamp: relay.diagnostics[0].timestamp,
    operation: "turn.create",
    source: "relay",
    code: "request_invalid",
    context: "http",
    causeChain: [{ type: "RelayError", status: 400 }],
  });
});

test("an obsolete Configuration revision is classified by an explicit stable code", async (t) => {
  const relay = await serve();
  t.after(relay.close);

  const response = await fetch(`${relay.base}/turn`, authorized({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId: relayTurnId, prompt: "Continue", configurationRevision: "not-retained" }),
  }));

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.failure.source, "relay");
  assert.equal(body.failure.code, "configuration_obsolete");
  assert.equal(body.failure.operation, "turn.create");
});

test("Codex JSON-RPC errors preserve structured attribution without exposing upstream detail", async (t) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  child.stdin.on("data", (chunk) => {
    const request = JSON.parse(chunk.toString());
    if (request.id == null) return;
    if (request.method === "initialize") {
      child.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
      return;
    }
    child.stdout.write(`${JSON.stringify({
      id: request.id,
      error: { code: -32001, message: "secret upstream overload", data: { token: "do-not-expose" } },
    })}\n`);
  });
  const relay = await serve(new AppServerConnection({ run: () => child }));
  t.after(relay.close);

  const response = await fetch(`${relay.base}/configuration`, authorized());
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.failure.source, "codex");
  assert.equal(body.failure.code, "server_overloaded");
  assert.equal(body.failure.operation, "configuration.load");
  assert.equal(body.failure.action, "retry");
  assert.equal(body.failure.retryable, true);
  assert.equal(JSON.stringify(body).includes("secret upstream overload"), false);
  assert.equal(JSON.stringify(body).includes("do-not-expose"), false);
  assert.equal(relay.diagnostics[0].jsonRpcCode, -32001);
  assert.ok(["model/list", "config/read"].includes(relay.diagnostics[0].requestMethod));
  assert.deepEqual(relay.diagnostics[0].causeChain, [
    {
      type: "BoundaryError",
      kind: "codex_request",
      structuredCause: {
        code: -32001,
        message: "[redacted]",
        data: { token: "[redacted]" },
      },
    },
  ]);
  assert.equal(JSON.stringify(relay.diagnostics).includes("secret upstream overload"), false);
  assert.equal(JSON.stringify(relay.diagnostics).includes("do-not-expose"), false);
});

test("typed Codex retry and terminal status remain distinct replay-safe Turn events", async (t) => {
  const relay = await serve();
  t.after(relay.close);
  await fetch(`${relay.base}/turn`, authorized({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId: relayTurnId, prompt: "Continue" }),
  }));
  await new Promise((resolve) => setImmediate(resolve));

  relay.appServer.emit("notification", { method: "error", params: {
    threadId,
    turnId: "codex-turn",
    willRetry: true,
    error: { message: "private retry detail", codexErrorInfo: "serverOverloaded", additionalDetails: "private" },
  } });
  relay.appServer.emit("notification", { method: "error", params: {
    threadId,
    turnId: "codex-turn",
    willRetry: false,
    error: { message: "private non-retry detail", codexErrorInfo: "requestRejected", additionalDetails: "private" },
  } });
  relay.appServer.emit("notification", { method: "turn/completed", params: {
    threadId,
    turn: {
      id: "codex-turn",
      status: "failed",
      error: { message: "private terminal detail", codexErrorInfo: "contextWindowExceeded" },
    },
  } });

  const response = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  const retrying = events.find(({ type }) => type === "turn.retrying");
  assert.equal(retrying.failure.source, "codex");
  assert.equal(retrying.failure.code, "server_overloaded");
  assert.equal(retrying.failure.operation, "turn.stream");
  assert.equal(retrying.failure.retryable, false);
  assert.equal(retrying.failure.action, "none");
  const terminal = events.find(({ type }) => type === "error");
  assert.equal(terminal.message, terminal.failure.message);
  assert.equal(terminal.failure.code, "context_window_exceeded");
  assert.equal(terminal.failure.operation, "turn.stream");
  assert.equal(events.at(-1).type, "relay.turn.finished");
  assert.equal(events.at(-1).status, "failed");
  assert.equal(JSON.stringify(events).includes("private"), false);
  assert.deepEqual(relay.diagnostics.map(({ upstreamWireValue, willRetry, terminalStatus }) => ({ upstreamWireValue, willRetry, terminalStatus })), [
    { upstreamWireValue: "serverOverloaded", willRetry: true, terminalStatus: undefined },
    { upstreamWireValue: "contextWindowExceeded", willRetry: false, terminalStatus: "failed" },
  ]);
  assert.deepEqual(relay.diagnostics[0].causeChain, [{ type: "RelayError", status: 502 }]);
});

test("Codespace attribution requires a structured diagnostic probe", async (t) => {
  const failedRun = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    setImmediate(() => child.emit("close", 1, null));
    return child;
  };

  await t.test("a confirmed stopped state is attributed to the Codespace", async (t) => {
    const relay = await serve(fakeAppServer(), { run: failedRun, codespaceProbe: async () => ({ state: "Shutdown" }) });
    t.after(relay.close);
    const response = await fetch(`${relay.base}/test`, authorized());
    const body = await response.json();
    assert.equal(body.failure.source, "codespace");
    assert.equal(body.failure.code, "not_running");
    assert.equal(body.failure.action, "start_codespace");
  });

  await t.test("a running state leaves the composite command failure unknown", async (t) => {
    const relay = await serve(fakeAppServer(), { run: failedRun, codespaceProbe: async () => ({ state: "Available" }) });
    t.after(relay.close);
    const response = await fetch(`${relay.base}/test`, authorized());
    const body = await response.json();
    assert.equal(body.failure.source, "unknown");
    assert.equal(body.failure.code, "upstream_failure");
    assert.equal(JSON.stringify(body).includes("SSH"), false);
  });
});

test("every typed Codex Turn condition maps to its stable public code", async (t) => {
  const mappings = {
    contextWindowExceeded: "context_window_exceeded",
    sessionBudgetExceeded: "thread_budget_exceeded",
    usageLimitExceeded: "usage_limit_exceeded",
    rateLimitExceeded: "rate_limit_exceeded",
    serverOverloaded: "server_overloaded",
    unauthorized: "authentication_rejected",
    badRequest: "request_rejected",
    httpConnectionFailed: "upstream_connection_failed",
    responseStreamConnectionFailed: "upstream_stream_failed",
    responseStreamDisconnected: "upstream_stream_disconnected",
    responseTooManyFailedAttempts: "retry_exhausted",
    activeTurnNotSteerable: "turn_not_steerable",
    sandboxError: "sandbox_failed",
    threadRollbackFailed: "thread_rollback_failed",
    cyberPolicy: "policy_blocked",
    misalignmentPolicyViolation: "policy_blocked",
    internalServerError: "internal_failure",
    other: "turn_failed",
  };
  const relay = await serve();
  t.after(relay.close);
  await fetch(`${relay.base}/turn`, authorized({
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId: relayTurnId, prompt: "Continue" }),
  }));
  await new Promise((resolve) => setImmediate(resolve));
  for (const codexErrorInfo of Object.keys(mappings)) {
    relay.appServer.emit("notification", { method: "error", params: {
      threadId, turnId: "codex-turn", willRetry: true,
      error: { codexErrorInfo, message: `private ${codexErrorInfo}` },
    } });
  }
  relay.appServer.emit("notification", { method: "turn/completed", params: {
    threadId, turn: { id: "codex-turn", status: "interrupted" },
  } });

  const response = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  const retryCodes = events.filter(({ type }) => type === "turn.retrying").map(({ failure }) => failure.code);
  assert.deepEqual(retryCodes, Object.values(mappings));
  assert.equal(events.at(-1).status, "interrupted");
  assert.equal(JSON.stringify(events).includes("private"), false);
});
