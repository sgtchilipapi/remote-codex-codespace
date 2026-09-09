const express = require("express");
const { spawn } = require("node:child_process");
const { timingSafeEqual } = require("node:crypto");

const app = express();
const port = process.env.PORT || 3000;
const connectionTimeoutMs = Number(process.env.CONNECTION_TIMEOUT_MS || 30_000);
const codexTimeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 30 * 60_000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function settings() {
  return {
    codespace: process.env.CODESPACE,
    apiToken: process.env.API_TOKEN,
    workdir: process.env.CODESPACE_WORKDIR,
  };
}

function missingConfiguration(res, values, names) {
  const missing = names.filter((name) => !values[name]);
  if (missing.length === 0) return false;
  res.status(503).json({ error: `Missing environment variable(s): ${missing.join(", ")}` });
  return true;
}

function authorized(req, expectedToken) {
  const prefix = "Bearer ";
  const header = req.get("authorization") || "";
  if (!header.startsWith(prefix) || !expectedToken) return false;
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function startRemoteCommand(codespace, command) {
  return spawn("gh", ["codespace", "ssh", "-c", codespace, "--", command], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
}

app.get("/health", (_req, res) => {
  const config = settings();
  res.status(config.codespace && config.apiToken ? 200 : 503).json({
    ok: Boolean(config.codespace && config.apiToken),
    codespaceConfigured: Boolean(config.codespace),
    apiTokenConfigured: Boolean(config.apiToken),
  });
});

app.get("/test", (_req, res) => {
  const config = settings();
  if (missingConfiguration(res, config, ["codespace"])) return;

  const child = startRemoteCommand(config.codespace, "printf 'codespace connected\\n'");
  let stdout = "";
  let stderr = "";
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill("SIGTERM");
    res.status(504).json({ error: "Timed out connecting to the codespace" });
  }, connectionTimeoutMs);

  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    res.status(502).json({ error: error.message });
  });
  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code !== 0) {
      return res.status(502).json({ error: "SSH command failed", code, signal, stderr });
    }
    res.type("text/plain").send(stdout);
  });
  child.stdin.end();
});

app.post("/codex", (req, res) => {
  const config = settings();
  if (missingConfiguration(res, config, ["codespace", "apiToken"])) return;
  if (!authorized(req, config.apiToken)) return res.status(401).json({ error: "Unauthorized" });

  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return res.status(400).json({ error: "Body must contain a non-empty string field named prompt" });
  }
  if (config.workdir && !/^\/[A-Za-z0-9._/-]+$/.test(config.workdir)) {
    return res.status(503).json({ error: "CODESPACE_WORKDIR must be an absolute path" });
  }

  const codexArgs = ["codex", "exec", "--json"];
  if (config.workdir) codexArgs.push("--cd", config.workdir);
  codexArgs.push("-");
  const child = startRemoteCommand(config.codespace, codexArgs.join(" "));
  let finished = false;
  let stderr = "";

  res.status(200);
  res.set({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`${JSON.stringify({ type: "connection.started" })}\n`);

  const timer = setTimeout(() => {
    if (finished) return;
    child.kill("SIGTERM");
    res.write(`${JSON.stringify({ type: "error", message: "Codex command timed out" })}\n`);
  }, codexTimeoutMs);

  req.on("aborted", () => child.kill("SIGTERM"));
  res.on("close", () => {
    if (!finished) child.kill("SIGTERM");
  });
  child.stdout.pipe(res, { end: false });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-16_384);
  });
  child.on("error", (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    res.end(`${JSON.stringify({ type: "error", message: error.message })}\n`);
  });
  child.on("close", (code, signal) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    res.end(`${JSON.stringify({ type: "connection.closed", code, signal, stderr: stderr || undefined })}\n`);
  });
  child.stdin.end(prompt);
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON" });
  }
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, "0.0.0.0", () => console.log(`Listening on ${port}`));
