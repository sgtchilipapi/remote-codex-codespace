const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRelay } = require("../server");

const uuid = "01a086a1-a1b5-7f52-bc60-a9db59b03804";
const otherUuid = "01a086a1-a5fd-7fd1-80d7-a7b607508df4";

async function request(app, path, options = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      ...options,
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json", ...options.headers },
    });
  } finally {
    server.close();
  }
}

test("lists only recognizable Threads from allowed source kinds", async () => {
  const calls = [];
  const appServer = { request: async (method, params) => {
    calls.push({ method, params });
    return { data: [
      { id: uuid, name: "  Release prep ", preview: "ship it", updatedAt: 20, model: "gpt-5", cwd: "/repo", archived: false, source: "appServer" },
      { id: otherUuid, name: "CLI Thread", preview: "do not probe", updatedAt: 19, model: "gpt-5", cwd: "/repo", archived: false, source: "cli" },
      { id: otherUuid, name: " ", preview: "  " },
    ], nextCursor: "next" };
  } };
  const response = await request(createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } }), `/threads?cursor=opaque&currentThreadId=${uuid}`);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ method: "thread/list", params: {
    archived: false, cursor: "opaque", cwd: "/repo", limit: 20,
    sortDirection: "desc", sortKey: "recency_at", sourceKinds: ["vscode", "appServer"],
  } }]);
  assert.deepEqual(await response.json(), { threads: [{
    id: uuid, title: "Release prep", preview: "ship it", lastActive: 20, model: "gpt-5", current: true,
  }], nextCursor: "next" });
});

test("resume revalidates eligibility and returns canonical history with reported effective state", async () => {
  const calls = [];
  const thread = { id: uuid, cwd: "/repo", archived: false, source: "appServer", preview: "hello", model: "gpt-5" };
  const appServer = { request: async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread };
    if (method === "thread/resume") return {
      thread,
      model: "gpt-5.2",
      reasoningEffort: "high",
      serviceTier: "priority",
      sandbox: { type: "workspaceWrite" },
      approvalPolicy: "on-request",
    };
    return { data: [{ id: "turn-2", items: [{ id: "a2", type: "agentMessage", text: "answer" }] }, { id: "turn-1", items: [{ id: "u1", type: "userMessage", content: [{ type: "text", text: "question" }] }, { id: "tool", type: "commandExecution", command: "secret" }] }], nextCursor: "older" };
  } };
  const response = await request(createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } }), `/threads/${uuid}/resume`, { method: "POST" });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ method, params }) => ({ method, params })), [
    { method: "thread/read", params: { threadId: uuid, includeTurns: false } },
    { method: "thread/resume", params: { threadId: uuid, excludeTurns: true } },
    { method: "thread/turns/list", params: { threadId: uuid, cursor: null, limit: 20, sortDirection: "desc", itemsView: "full" } },
  ]);
  assert.deepEqual(await response.json(), { thread: { id: uuid }, effectiveConfiguration: {
    model: "gpt-5.2",
    reasoning: "high",
    permissions: {
      sandboxPolicy: { type: "workspaceWrite" },
      approvalPolicy: "on-request",
      profile: null,
    },
    fastMode: { enabled: true, serviceTier: "priority" },
  }, messages: [
    { id: "u1", role: "user", text: "question" }, { id: "a2", role: "assistant", text: "answer" },
  ], olderCursor: "older" });
});

test("resume leaves unreported effective fields unavailable instead of inferring persisted metadata", async () => {
  const thread = { id: uuid, cwd: "/repo", archived: false, source: "vscode", preview: "hello", model: "persisted-model" };
  const appServer = { request: async (method) => {
    if (method === "thread/read") return { thread };
    if (method === "thread/resume") return { thread };
    return { data: [], nextCursor: null };
  } };

  const response = await request(createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } }), `/threads/${uuid}/resume`, { method: "POST" });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).effectiveConfiguration, {
    model: null,
    reasoning: null,
    permissions: { sandboxPolicy: null, approvalPolicy: null, profile: null },
    fastMode: null,
  });
});

test("ineligible, malformed, and oversized inputs fail without disclosure", async () => {
  const appServer = { request: async () => ({ thread: { id: uuid, cwd: "/other", source: "appServer", preview: "x" } }) };
  const app = createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } });
  assert.equal((await request(app, "/threads/not-a-uuid/resume", { method: "POST" })).status, 400);
  const unavailable = await request(app, `/threads/${uuid}/resume`, { method: "POST" });
  assert.equal(unavailable.status, 404);
  assert.deepEqual(await unavailable.json(), { error: "Thread not found" });
  assert.equal((await request(app, `/threads?cursor=${"x".repeat(4097)}`)).status, 400);
});

test("metadata revalidation rejects known CLI and exec Threads without probing resume", async () => {
  for (const source of ["cli", "exec"]) {
    const calls = [];
    const appServer = { request: async (method) => {
      calls.push(method);
      return { thread: { id: uuid, cwd: "/repo", archived: false, source, preview: "known" } };
    } };
    const response = await request(createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } }), `/threads/${uuid}/resume`, { method: "POST" });
    assert.equal(response.status, 404);
    assert.deepEqual(calls, ["thread/read"]);
  }
});

test("history de-duplicates inclusive anchors and keeps errors safe", async () => {
  const thread = { id: uuid, cwd: "/repo", archived: false, source: "appServer", name: "Known" };
  const appServer = { request: async (method) => method === "thread/read" ? { thread } : {
    data: [{ id: "turn-1", items: [{ id: "anchor", type: "userMessage", content: [{ type: "text", text: "repeat" }] }, { id: "err", type: "error", message: "safe failure", details: "/secret/path" }] }],
    nextCursor: null,
  } };
  const response = await request(createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } }), `/threads/${uuid}/history?cursor=cursor&anchorId=anchor`);
  assert.deepEqual(await response.json(), { messages: [{ id: "err", role: "assistant", text: "Error: safe failure", error: true }], olderCursor: null });
});

test("an explicit configuration overrides a resumed Thread on its next Turn", async () => {
  const calls = [];
  const appServer = new EventEmitter();
  appServer.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/resume") return { thread: { id: uuid } };
    if (method === "turn/start") {
      setImmediate(() => appServer.emit("notification", { method: "turn/completed", params: { threadId: uuid, turn: { id: "turn" } } }));
      return { turn: { id: "turn" } };
    }
  };
  const response = await request(createRelay({ appServer, env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" } }), "/turn", {
    method: "POST", body: JSON.stringify({ prompt: "continue", threadId: uuid, model: "gpt-5", reasoning: "high", permissions: "read-only" }),
  });
  await response.text();
  assert.deepEqual(calls.at(-1), { method: "turn/start", params: {
    threadId: uuid, input: [{ type: "text", text: "continue" }], model: "gpt-5", effort: "high", sandboxPolicy: "read-only", approvalPolicy: "untrusted",
  } });
});
