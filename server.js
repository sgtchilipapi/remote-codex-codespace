const express = require("express");
const { spawn } = require("node:child_process");

const app = express();

app.use(express.json());
app.use(express.static("public"));

function authorize(req, res, next) {
  if (!process.env.API_TOKEN || req.get("authorization") !== `Bearer ${process.env.API_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function run(command) {
  return spawn("gh", ["codespace", "ssh", "-c", process.env.CODESPACE, "--", command], {
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function codexInfo() {
  return new Promise((resolve, reject) => {
    const child = run("codex app-server --stdio");
    const results = {};
    let buffer = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.error) return reject(new Error(message.error.message));
        if (message.id === 1) {
          child.stdin.write('{"method":"initialized"}\n');
          child.stdin.write('{"id":2,"method":"model/list","params":{"limit":100}}\n');
          child.stdin.write('{"id":3,"method":"account/rateLimits/read"}\n');
        }
        if (message.id === 2) results.models = message.result.data;
        if (message.id === 3) results.rateLimits = message.result.rateLimits;
        if (results.models && results.rateLimits) {
          child.kill();
          resolve(results);
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      if (!results.models || !results.rateLimits) reject(new Error(stderr || "Codex info unavailable"));
    });
    child.stdin.write('{"id":1,"method":"initialize","params":{"clientInfo":{"name":"relay","version":"1"}}}\n');
  });
}

app.get("/info", authorize, async (_req, res) => {
  try {
    const { models, rateLimits } = await codexInfo();
    res.json({
      models: models.map((item) => ({
        id: item.id,
        name: item.displayName,
        isDefault: item.isDefault,
        defaultReasoning: item.defaultReasoningEffort,
        reasoning: item.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort),
      })),
      rateLimits,
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/test", authorize, (_req, res) => {
  const child = run("hostname && pwd");
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => res.status(502).json({ error: error.message }));
  child.on("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0) return res.status(502).json({ error: stderr || `gh exited with ${code}` });
    res.type("text/plain").send(stdout);
  });
  child.stdin.end();
});

app.post("/turn", authorize, (req, res) => {
  const { prompt, threadId, model, reasoning, permissions } = req.body;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }
  if (threadId && !/^[0-9a-f-]+$/i.test(threadId)) {
    return res.status(400).json({ error: "threadId is invalid" });
  }
  if (model && !/^[A-Za-z0-9._-]+$/.test(model)) {
    return res.status(400).json({ error: "model is invalid" });
  }
  if (reasoning && !["low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoning)) {
    return res.status(400).json({ error: "reasoning is invalid" });
  }
  if (permissions && !["read-only", "workspace-write"].includes(permissions)) {
    return res.status(400).json({ error: "permissions is invalid" });
  }

  const workdir = process.env.CODESPACE_WORKDIR || "/workspaces/remote-codex-codespace";
  const options = [
    model && `--model ${model}`,
    reasoning && `-c model_reasoning_effort=\"${reasoning}\"`,
    permissions && `-c sandbox_mode=\"${permissions}\"`,
  ].filter(Boolean).join(" ");
  const action = threadId
    ? `codex exec resume --json ${options} ${threadId} -`
    : `codex exec --json ${options} -`;
  const child = run(`cd ${workdir} && ${action}`);

  res.type("application/x-ndjson");
  res.set("Cache-Control", "no-cache, no-transform");
  res.set("X-Accel-Buffering", "no");
  res.flushHeaders();

  child.stdout.pipe(res, { end: false });
  child.stderr.pipe(process.stderr);
  child.on("error", (error) => res.end(`${JSON.stringify({ type: "error", message: error.message })}\n`));
  child.on("close", (code) => {
    if (code !== 0) res.write(`${JSON.stringify({ type: "error", message: `Codex exited with ${code}` })}\n`);
    res.end();
  });
  res.on("close", () => child.kill());
  child.stdin.end(prompt);
});

if (require.main === module) {
  app.listen(process.env.PORT || 3000, "0.0.0.0");
}

module.exports = app;
