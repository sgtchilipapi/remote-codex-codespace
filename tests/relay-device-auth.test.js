const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createRelay } = require("../server");

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = 0;
  child.kill = () => { child.killCalls += 1; };
  return child;
}

async function serve(options = {}) {
  const calls = [];
  const children = [];
  const run = (command) => {
    calls.push(command);
    const child = childProcess();
    children.push(child);
    return child;
  };
  const appServer = new EventEmitter();
  appServer.request = async () => ({});
  const app = createRelay({
    appServer,
    env: { API_TOKEN: "secret", CODESPACE_WORKDIR: "/repo" },
    run,
    deviceAuthTimeoutMs: 100,
    deviceAuthRetentionMs: 200,
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    calls,
    children,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const authorized = (init = {}) => ({ ...init, headers: { Authorization: "Bearer secret", ...init.headers } });
async function waitForChild(relay, index = 0) {
  while (!relay.children[index]) await new Promise((resolve) => setTimeout(resolve, 5));
  return relay.children[index];
}

test("device authentication parses chunked CLI output and reuses one active process", async (t) => {
  const relay = await serve(); t.after(relay.close);
  const first = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(relay);
  const second = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  relay.children[0].stdout.write("Open https://auth.openai.com/codex/de");
  relay.children[0].stdout.write("vice and enter ABCD-");
  relay.children[0].stderr.write("EF12\n");

  const responses = await Promise.all([first, second]);
  assert.deepEqual(relay.calls, ["codex login --device-auth"]);
  for (const response of responses) {
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, "pending");
    assert.equal(body.verificationUrl, "https://auth.openai.com/codex/device");
    assert.equal(body.userCode, "ABCD-EF12");
    assert.match(body.attemptId, /^[0-9a-f-]{36}$/i);
  }
});

test("device authentication recognizes the installed CLI prompt including ANSI styling", async (t) => {
  const relay = await serve(); t.after(relay.close);
  const started = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(relay);
  relay.children[0].stdout.write("1. Open this link in your browser\n \u001b[34mhttps://auth.openai.com/codex/de");
  relay.children[0].stdout.write("vice\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n \u001b[34mWXYZ-");
  relay.children[0].stdout.write("9876\u001b[0m\n");
  const body = await (await started).json();
  assert.equal(body.verificationUrl, "https://auth.openai.com/codex/device");
  assert.equal(body.userCode, "WXYZ-9876");
});

test("device authentication reports success without returning captured output", async (t) => {
  const relay = await serve(); t.after(relay.close);
  const started = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(relay);
  relay.children[0].stdout.write("https://auth.openai.com/codex/device Code: CODE-1234 secret-fixture");
  const startBody = await (await started).json();
  relay.children[0].emit("close", 0, null);

  const response = await fetch(`${relay.base}/codex/device-auth/${startBody.attemptId}`, authorized());
  assert.deepEqual(await response.json(), { attemptId: startBody.attemptId, status: "succeeded" });
  assert.doesNotMatch(JSON.stringify(startBody), /secret-fixture/);
});

test("device authentication exposes failed and expired terminal states and stops expiry", async (t) => {
  const failedRelay = await serve(); t.after(failedRelay.close);
  const failedStart = fetch(`${failedRelay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(failedRelay);
  failedRelay.children[0].stdout.write("https://auth.openai.com/codex/device Enter code FAIL-1234");
  const failedAttempt = await (await failedStart).json();
  failedRelay.children[0].emit("close", 7, null);
  assert.deepEqual(await (await fetch(`${failedRelay.base}/codex/device-auth/${failedAttempt.attemptId}`, authorized())).json(), {
    attemptId: failedAttempt.attemptId, status: "failed",
  });

  const expiredRelay = await serve({ deviceAuthTimeoutMs: 20 }); t.after(expiredRelay.close);
  const expiredStart = fetch(`${expiredRelay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(expiredRelay);
  expiredRelay.children[0].stdout.write("https://auth.openai.com/codex/device Enter code WAIT-1234");
  const expiredAttempt = await (await expiredStart).json();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(await (await fetch(`${expiredRelay.base}/codex/device-auth/${expiredAttempt.attemptId}`, authorized())).json(), {
    attemptId: expiredAttempt.attemptId, status: "expired",
  });
  assert.equal(expiredRelay.children[0].killCalls, 1);
});

test("malformed, overflowing, timed-out, spawn, and ambiguous exit failures stay safe", async (t) => {
  const diagnostics = [];
  const relay = await serve({ logger: { error: (entry) => diagnostics.push(entry) }, deviceAuthMaxOutputBytes: 64 });
  t.after(relay.close);

  const malformed = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(relay);
  relay.children[0].stdout.write("SECRET unmatched output");
  relay.children[0].emit("close", 1, null);
  const malformedResponse = await malformed;
  assert.equal(malformedResponse.status, 502);
  const malformedBody = await malformedResponse.json();
  assert.equal(malformedBody.failure.operation, "codex.authenticate");
  assert.equal(malformedBody.failure.code, "malformed_response");
  assert.doesNotMatch(JSON.stringify(malformedBody), /SECRET|unmatched/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /SECRET|unmatched|codex login/);

  const overflow = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(relay, 1);
  relay.children[1].stdout.write("x".repeat(65));
  const overflowBody = await (await overflow).json();
  assert.equal(overflowBody.failure.code, "output_limit_exceeded");
  assert.equal(relay.children[1].killCalls, 1);

  const timeout = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  const timeoutResponse = await timeout;
  assert.equal(timeoutResponse.status, 504);
  assert.equal((await timeoutResponse.json()).failure.code, "upstream_timeout");

  const failedRelay = await serve({ run: () => { throw new Error("SECRET spawn path"); } });
  t.after(failedRelay.close);
  const spawnResponse = await fetch(`${failedRelay.base}/codex/device-auth`, authorized({ method: "POST" }));
  assert.equal((await spawnResponse.json()).failure.code, "dependency_missing");
});

test("unapproved URLs and invalid codes are rejected", async (t) => {
  const relay = await serve(); t.after(relay.close);
  const started = fetch(`${relay.base}/codex/device-auth`, authorized({ method: "POST" }));
  await waitForChild(relay);
  relay.children[0].stdout.write("https://evil.example/device lower_secret SECRET-TOO-LONG-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  relay.children[0].emit("close", 0, null);
  const body = await (await started).json();
  assert.equal(body.failure.code, "malformed_response");
});
