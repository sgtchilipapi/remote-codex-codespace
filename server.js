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
  const { prompt, threadId } = req.body;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }
  if (threadId && !/^[0-9a-f-]+$/i.test(threadId)) {
    return res.status(400).json({ error: "threadId is invalid" });
  }

  const workdir = process.env.CODESPACE_WORKDIR || "/workspaces/remote-codex-codespace";
  const action = threadId
    ? `codex exec resume --json ${threadId} -`
    : "codex exec --json -";
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
