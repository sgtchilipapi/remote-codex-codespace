const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createRelay, AppServerConnection } = require("../server");

const relayTurnId = "11111111-1111-4111-8111-111111111111";
const threadId = "01a086a1-a1b5-7f52-bc60-a9db59b03804";

function fakeAppServer() {
  const appServer = new EventEmitter();
  appServer.calls = [];
  appServer.request = async (method, params) => {
    appServer.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: threadId } };
    if (method === "thread/resume") return { thread: { id: threadId } };
    if (method === "turn/start") return { turn: { id: "codex-turn" } };
    return {};
  };
  return appServer;
}

async function serve(appServer, options = {}) {
  const app = createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" }, ...options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { app, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function authorized(init = {}) {
  return { ...init, headers: { Authorization: "Bearer secret", ...init.headers } };
}

async function start(base, body = { turnId: relayTurnId, prompt: "Keep working" }) {
  return fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function emit(appServer, method, params = {}) {
  appServer.emit("notification", { method, params: { threadId, ...params } });
}

test("Settings authentication loads live Codex availability without exposing it to unauthorized callers", async (t) => {
  const appServer = fakeAppServer();
  appServer.request = async (method, params) => {
    appServer.calls.push({ method, params });
    if (method === "model/list") return { data: [{ id: "codex-1", displayName: "Codex 1", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }] };
    if (method === "account/rateLimits/read") return { rateLimits: { planType: "test" } };
    return {};
  };
  const relay = await serve(appServer); t.after(relay.close);

  assert.equal((await fetch(`${relay.base}/info`)).status, 401);
  const response = await fetch(`${relay.base}/info`, authorized());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    models: [{ id: "codex-1", name: "Codex 1", isDefault: true, defaultReasoning: "medium", reasoning: ["medium"] }],
    rateLimits: { planType: "test" },
  });
  assert.deepEqual(appServer.calls.map(({ method }) => method), ["model/list", "account/rateLimits/read"]);
});

test("Configuration projects live model, reasoning, Fast, permissions, and Codex defaults", async (t) => {
  const appServer = fakeAppServer();
  appServer.request = async (method, params) => {
    appServer.calls.push({ method, params });
    if (method === "model/list") return { data: [
      { id: "codex-1", displayName: "Codex 1", isDefault: true, hidden: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }], serviceTiers: [{ id: "priority", name: "Fast" }], defaultServiceTier: "flex" },
      { id: "hidden", displayName: "Hidden", hidden: true, supportedReasoningEfforts: [] },
    ] };
    if (method === "config/read") return { config: { model: "codex-1", model_reasoning_effort: "medium", sandbox_mode: "workspace-write", service_tier: "flex" } };
    return {};
  };
  const relay = await serve(appServer); t.after(relay.close);

  assert.equal((await fetch(`${relay.base}/configuration`)).status, 401);
  const response = await fetch(`${relay.base}/configuration`, authorized());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    models: [{ id: "codex-1", name: "Codex 1", isDefault: true, reasoning: ["low", "medium"], defaultReasoning: "medium", serviceTiers: [{ id: "priority", name: "Fast" }], defaultServiceTier: "flex" }],
    permissions: [{ id: "read-only", name: "read only" }, { id: "workspace-write", name: "workspace write" }],
    defaults: { model: "codex-1", reasoning: "medium", permissions: "workspace-write", fastMode: false },
  });
  assert.deepEqual(appServer.calls.map(({ method }) => method), ["model/list", "config/read"]);
});

test("Configuration resolution validates a whole draft with stable field errors", async (t) => {
  const appServer = fakeAppServer();
  appServer.request = async (method, params) => {
    appServer.calls.push({ method, params });
    if (method === "model/list") return { data: [{ id: "codex-mini", displayName: "Mini", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }], serviceTiers: [], defaultServiceTier: null }] };
    if (method === "config/read") return { config: { model: "codex-mini", model_reasoning_effort: "low", sandbox_mode: "read-only", service_tier: null } };
    return {};
  };
  const relay = await serve(appServer); t.after(relay.close);
  const response = await fetch(`${relay.base}/configuration/resolve`, authorized({
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "codex-mini", reasoning: "high", permissions: "dangerous", fastMode: true }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Configuration is unsupported", fieldErrors: {
    reasoning: "Reasoning effort is not supported by the selected model.",
    permissions: "Permissions choice is not supported.",
    fastMode: "Fast mode is not supported by the selected model.",
  } });
});

test("a resolved Configuration carries Fast mode into the first Turn exactly once", async (t) => {
  const appServer = fakeAppServer();
  const originalRequest = appServer.request;
  appServer.request = async (method, params) => {
    if (method === "model/list") return { data: [{ id: "codex-1", displayName: "Codex 1", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "high" }], serviceTiers: [{ id: "priority", name: "Fast" }] }] };
    if (method === "config/read") return { config: { model: "codex-1", model_reasoning_effort: "high", sandbox_mode: "read-only" } };
    return originalRequest(method, params);
  };
  const relay = await serve(appServer); t.after(relay.close);
  const resolved = await fetch(`${relay.base}/configuration/resolve`, authorized({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "codex-1", reasoning: "high", permissions: "read-only", fastMode: true }) }));
  const { configurationRevision } = await resolved.json();
  const created = await start(relay.base, { turnId: relayTurnId, prompt: "Go fast", model: "codex-1", reasoning: "high", permissions: "read-only", fastMode: true, configurationRevision });
  assert.equal(created.status, 202);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(appServer.calls.find(({ method }) => method === "thread/start").params, { cwd: "/repo", model: "codex-1", sandbox: "read-only" });
  assert.deepEqual(appServer.calls.find(({ method }) => method === "turn/start").params, { threadId, input: [{ type: "text", text: "Go fast" }], effort: "high", serviceTier: "priority" });
});

test("a Turn survives disconnect and replays every missed event once", async (t) => {
  const appServer = fakeAppServer();
  const relay = await serve(appServer); t.after(relay.close);
  const created = await start(relay.base);
  assert.equal(created.status, 202);
  assert.deepEqual(await created.json(), { turnId: relayTurnId, eventsUrl: `/turn/${relayTurnId}/events` });

  const firstConnection = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  emit(appServer, "item/completed", { item: { type: "agentMessage", text: "first" } });
  const reader = firstConnection.body.getReader();
  const firstBatch = new TextDecoder().decode((await reader.read()).value).trim().split("\n").map(JSON.parse);
  let lastSequence = firstBatch.at(-1).sequence;
  if (!firstBatch.some((event) => event.item?.text === "first")) {
    const next = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
    assert.equal(next.item.text, "first"); lastSequence = next.sequence;
  }
  await reader.cancel();

  emit(appServer, "item/completed", { item: { type: "agentMessage", text: " second" } });
  emit(appServer, "turn/completed", { turn: { id: "codex-turn" } });
  const replay = await fetch(`${relay.base}/turn/${relayTurnId}/events?after=${lastSequence}`, authorized());
  const events = (await replay.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(({ sequence, type, status, item }) => ({ sequence, type, status, text: item?.text })), [
    { sequence: lastSequence + 1, type: "item.completed", status: undefined, text: " second" },
    { sequence: lastSequence + 2, type: "relay.turn.finished", status: "completed", text: undefined },
  ]);
  assert.equal(appServer.calls.some(({ method }) => method === "turn/interrupt"), false);
});

test("retrying creation with the same ID starts the prompt only once", async (t) => {
  const appServer = fakeAppServer();
  const relay = await serve(appServer); t.after(relay.close);
  assert.equal((await start(relay.base)).status, 202);
  assert.equal((await start(relay.base)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(appServer.calls.filter(({ method }) => method === "turn/start").length, 1);
  const mismatch = await start(relay.base, { turnId: relayTurnId, prompt: "Different" });
  assert.equal(mismatch.status, 409);
});

test("replay positions and process-local resources are bounded", async (t) => {
  const appServer = fakeAppServer();
  const relay = await serve(appServer, { maxSubscribersPerTurn: 1 }); t.after(relay.close);
  await start(relay.base);
  assert.equal((await fetch(`${relay.base}/turn/${relayTurnId}/events?after=-1`, authorized())).status, 400);
  assert.equal((await fetch(`${relay.base}/turn/${relayTurnId}/events?after=2`, authorized())).status, 400);
  assert.equal((await fetch(`${relay.base}/turn/missing/events`, authorized())).status, 404);
  const subscriber = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  assert.equal((await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized())).status, 429);
  await subscriber.body.cancel();
});

test("buffer overflow interrupts Codex and leaves a safe terminal replay", async (t) => {
  const appServer = fakeAppServer();
  const relay = await serve(appServer, { maxBufferedBytes: 4096 }); t.after(relay.close);
  await start(relay.base);
  emit(appServer, "item/completed", { item: { type: "agentMessage", text: "x".repeat(4096) } });
  await new Promise((resolve) => setImmediate(resolve));
  const replay = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  assert.deepEqual((await replay.text()).trim().split("\n").map(JSON.parse), [
    { type: "thread.started", thread_id: threadId, sequence: 1 },
    { type: "error", message: "Turn output exceeded the Relay buffer limit", sequence: 2 },
    { type: "relay.turn.finished", status: "failed", sequence: 3 },
  ]);
  assert.equal(appServer.calls.some(({ method }) => method === "turn/interrupt"), true);
});

test("app-server failure terminates the Turn and releases concurrency", async (t) => {
  const appServer = fakeAppServer();
  const relay = await serve(appServer); t.after(relay.close);
  await start(relay.base);
  appServer.emit("disconnect", new Error("private SSH detail"));
  let replay = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  assert.deepEqual((await replay.text()).trim().split("\n").map(JSON.parse), [
    { type: "thread.started", thread_id: threadId, sequence: 1 },
    { type: "error", message: "Codex unavailable", sequence: 2 },
    { type: "relay.turn.finished", status: "failed", sequence: 3 },
  ]);
  assert.equal((await start(relay.base, { turnId: "22222222-2222-4222-8222-222222222222", prompt: "Retry" })).status, 202);
});

test("completed Turns expire after their retention period", async (t) => {
  const appServer = fakeAppServer();
  const relay = await serve(appServer, { turnRetentionMs: 20 }); t.after(relay.close);
  await start(relay.base);
  emit(appServer, "turn/completed", { turn: { id: "codex-turn" } });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal((await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized())).status, 404);
});

test("app-server framing preserves UTF-8 split across stdout chunks", async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
  const connection = new AppServerConnection({ run: () => child });
  const connected = connection.connect();
  child.stdout.write('{"id":1,"result":{}}\n');
  await connected;
  const received = new Promise((resolve) => connection.once("notification", resolve));
  const message = Buffer.from('{"method":"item/completed","params":{"item":{"text":"hello 👋"}}}\n');
  const split = message.indexOf(Buffer.from("👋")) + 2;
  child.stdout.write(message.subarray(0, split)); child.stdout.write(message.subarray(split));
  assert.equal((await received).params.item.text, "hello 👋");
});

test("a delayed completion from another Turn cannot finish a starting Turn", async (t) => {
  const appServer = fakeAppServer(); let resolveStart;
  appServer.request = async (method, params) => {
    appServer.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: threadId } };
    if (method === "turn/start") return new Promise((resolve) => { resolveStart = resolve; });
    return {};
  };
  const relay = await serve(appServer); t.after(relay.close);
  await start(relay.base);
  await new Promise((resolve) => setImmediate(resolve));
  emit(appServer, "turn/completed", { turn: { id: "previous-turn" } });
  resolveStart({ turn: { id: "codex-turn" } });
  emit(appServer, "item/completed", { turnId: "codex-turn", item: { type: "agentMessage", text: "actual output" } });
  emit(appServer, "turn/completed", { turn: { id: "codex-turn" } });

  const replay = await fetch(`${relay.base}/turn/${relayTurnId}/events`, authorized());
  const events = (await replay.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events.filter((event) => event.type === "relay.turn.finished").length, 1);
  assert.equal(events.find((event) => event.item)?.item.text, "actual output");
});
