const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function serve(client) {
  const server = createApp({
    appServer: client,
    apiToken: "secret",
    workdir: "/workspaces/project",
  }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("lists only recognizable Eligible Threads through the authenticated Relay", async () => {
  const calls = [];
  const base = await serve({
    request: async (method, params) => {
      calls.push({ method, params });
      return {
        data: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Fix login", preview: "Investigate auth", updatedAt: 10, model: "gpt-5" },
          { id: "22222222-2222-4222-8222-222222222222", name: " ", preview: "" },
        ],
        nextCursor: "next-page",
      };
    },
  });

  const unauthorized = await fetch(`${base}/threads`);
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${base}/threads?currentThreadId=11111111-1111-4111-8111-111111111111`, {
    headers: { authorization: "Bearer secret" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    threads: [{
      id: "11111111-1111-4111-8111-111111111111",
      title: "Fix login",
      preview: "Investigate auth",
      lastActive: 10,
      model: "gpt-5",
      current: true,
    }],
    nextCursor: "next-page",
  });
  assert.deepEqual(calls, [{
    method: "thread/list",
    params: {
      archived: false,
      cwd: "/workspaces/project",
      cursor: undefined,
      limit: 20,
      sortKey: "recency_at",
      sourceKinds: ["interactive"],
    },
  }]);
});
