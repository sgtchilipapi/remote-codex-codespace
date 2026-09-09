const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function fakeCodex() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

async function serve(startTurn) {
  const server = createApp({ apiToken: "secret", startTurn }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function authorized(init = {}) {
  return {
    ...init,
    headers: { authorization: "Bearer secret", ...init.headers },
  };
}

test("a Turn continues and replays missed events after its Mobile Client disconnects", async () => {
  const child = fakeCodex();
  const base = await serve(() => child);

  const started = await fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Keep working" }),
  }));
  assert.equal(started.status, 202);
  const { turnId } = await started.json();

  const firstConnection = await fetch(`${base}/turn/${turnId}/events`, authorized());
  child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\n');
  const reader = firstConnection.body.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
  assert.equal(first.sequence, 1);
  await reader.cancel();

  child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":" second"}}\n');
  child.stdout.end();
  child.emit("close", 0);

  assert.equal(child.killed, false);
  const replay = await fetch(`${base}/turn/${turnId}/events?after=1`, authorized());
  assert.equal(replay.status, 200);
  const events = (await replay.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(({ sequence, type, status, item }) => ({ sequence, type, status, text: item?.text })), [
    { sequence: 2, type: "item.completed", status: undefined, text: " second" },
    { sequence: 3, type: "relay.turn.finished", status: "completed", text: undefined },
  ]);
});

test("retrying Turn creation with the same ID does not start Codex twice", async () => {
  const child = fakeCodex();
  let starts = 0;
  const base = await serve(() => {
    starts += 1;
    return child;
  });
  const body = JSON.stringify({
    turnId: "11111111-1111-4111-8111-111111111111",
    prompt: "Start exactly once",
  });

  const first = await fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
  const retry = await fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));

  assert.equal(first.status, 202);
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).turnId, "11111111-1111-4111-8111-111111111111");
  assert.equal(starts, 1);

  const mismatch = await fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnId: "11111111-1111-4111-8111-111111111111",
      prompt: "A different request",
    }),
  }));
  assert.equal(mismatch.status, 409);
  assert.deepEqual(await mismatch.json(), { error: "turnId already belongs to a different Turn" });
  child.emit("close", 0);
});

test("a newline-free output cannot grow beyond the replay buffer", async () => {
  const child = fakeCodex();
  const server = createApp({
    apiToken: "secret",
    startTurn: () => child,
    maxBufferedBytes: 4096,
  }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const started = await fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Bound this output" }),
  }));
  const { turnId } = await started.json();

  child.stdout.write("x".repeat(4097));

  assert.equal(child.killed, true);
  const response = await fetch(`${base}/turn/${turnId}/events`, authorized());
  assert.deepEqual((await response.text()).trim().split("\n").map(JSON.parse), [
    { type: "error", message: "Turn output exceeded the Relay buffer limit", sequence: 1 },
    { type: "relay.turn.finished", status: "failed", sequence: 2 },
  ]);
});

test("a Turn preserves UTF-8 characters split across stdout chunks", async () => {
  const child = fakeCodex();
  const base = await serve(() => child);
  const started = await fetch(`${base}/turn`, authorized({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Stream Unicode" }),
  }));
  const { turnId } = await started.json();
  const output = Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"hello 👋"}}\n');
  const split = output.indexOf(Buffer.from("👋")) + 2;

  child.stdout.write(output.subarray(0, split));
  child.stdout.write(output.subarray(split));
  child.emit("close", 0);

  const response = await fetch(`${base}/turn/${turnId}/events`, authorized());
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events[0].item.text, "hello 👋");
  assert.equal(events[1].type, "relay.turn.finished");
});

test("the replay buffer reserves enough room for terminal events", () => {
  assert.throws(
    () => createApp({ apiToken: "secret", maxBufferedBytes: 1024 }),
    /maxBufferedBytes must be at least 2048/,
  );
});

test("the Relay rejects concurrent Turns and records a failed terminal state", async () => {
  const child = fakeCodex();
  const base = await serve(() => child);
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "First Turn" }),
  };

  const first = await fetch(`${base}/turn`, authorized(request));
  const second = await fetch(`${base}/turn`, authorized({
    ...request,
    body: JSON.stringify({ prompt: "Competing Turn" }),
  }));
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: "A Turn is already running" });

  child.emit("close", 7);
  const { turnId } = await first.json();
  const events = await fetch(`${base}/turn/${turnId}/events`, authorized());
  assert.deepEqual((await events.text()).trim().split("\n").map(JSON.parse), [
    { type: "error", message: "Codex exited with 7", sequence: 1 },
    { type: "relay.turn.finished", status: "failed", sequence: 2 },
  ]);
});

test("Turn event replay rejects invalid cursors and unknown process-local Turns", async () => {
  const base = await serve(() => fakeCodex());

  const invalid = await fetch(`${base}/turn/missing/events?after=-1`, authorized());
  assert.equal(invalid.status, 400);

  const missing = await fetch(`${base}/turn/missing/events?after=0`, authorized());
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Turn is no longer available" });
});
