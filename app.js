const express = require("express");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

const DEFAULT_WORKDIR = "/workspaces/remote-codex-codespace";
const TURN_RETENTION_MS = 15 * 60 * 1000;
const MAX_BUFFERED_BYTES = 5 * 1024 * 1024;
const CONTROL_EVENT_RESERVE_BYTES = 2048;

function run(command) {
  return spawn("gh", ["codespace", "ssh", "-c", process.env.CODESPACE, "--", command], {
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function codexInfo(runCommand) {
  return new Promise((resolve, reject) => {
    const child = runCommand("codex app-server --stdio");
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

function createApp(options = {}) {
  const app = express();
  const apiToken = options.apiToken ?? process.env.API_TOKEN;
  const workdir = options.workdir ?? process.env.CODESPACE_WORKDIR ?? DEFAULT_WORKDIR;
  const runCommand = options.runCommand ?? run;
  const retentionMs = options.turnRetentionMs ?? TURN_RETENTION_MS;
  const maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < CONTROL_EVENT_RESERVE_BYTES) {
    throw new Error(`maxBufferedBytes must be at least ${CONTROL_EVENT_RESERVE_BYTES}`);
  }
  const turns = new Map();

  app.use(express.json());
  app.use(express.static("public"));

  function authorize(req, res, next) {
    if (!apiToken || req.get("authorization") !== `Bearer ${apiToken}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  function finish(turn, status) {
    if (turn.status !== "running") return;
    turn.status = status;
    for (const response of turn.subscribers) response.end();
    turn.subscribers.clear();
    const timer = setTimeout(() => turns.delete(turn.id), retentionMs);
    timer.unref?.();
  }

  function append(turn, event, control = false) {
    const record = { ...event, sequence: turn.nextSequence };
    const encoded = `${JSON.stringify(record)}\n`;
    const limit = control ? maxBufferedBytes : maxBufferedBytes - CONTROL_EVENT_RESERVE_BYTES;
    const bytes = Buffer.byteLength(encoded);
    if (turn.bufferedBytes + bytes > limit) return false;
    turn.nextSequence += 1;
    turn.events.push({ record, encoded });
    turn.bufferedBytes += bytes;
    for (const response of turn.subscribers) response.write(encoded);
    return true;
  }

  function fail(turn, message, kill = false) {
    if (turn.status !== "running") return;
    append(turn, { type: "error", message: String(message).slice(0, 512) }, true);
    append(turn, { type: "relay.turn.finished", status: "failed" }, true);
    if (kill) turn.child.kill();
    finish(turn, "failed");
  }

  function publish(turn, event) {
    if (turn.status !== "running") return;
    if (!append(turn, event)) fail(turn, "Turn output exceeded the Relay buffer limit", true);
  }

  function consumeOutput(turn, chunk, final = false) {
    turn.outputBuffer += final ? turn.decoder.end() : turn.decoder.write(chunk);
    const lines = turn.outputBuffer.split("\n");
    turn.outputBuffer = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      try {
        publish(turn, JSON.parse(line));
      } catch {
        fail(turn, "Codex returned malformed output", true);
      }
    }
    if (turn.status === "running" && Buffer.byteLength(turn.outputBuffer) > maxBufferedBytes - CONTROL_EVENT_RESERVE_BYTES - turn.bufferedBytes) {
      fail(turn, "Turn output exceeded the Relay buffer limit", true);
    }
  }

  function defaultStartTurn({ threadId, model, reasoning, permissions }) {
    const commandOptions = [
      model && `--model ${model}`,
      reasoning && `-c model_reasoning_effort=\"${reasoning}\"`,
      permissions && `-c sandbox_mode=\"${permissions}\"`,
    ].filter(Boolean).join(" ");
    const action = threadId
      ? `codex exec resume --json ${commandOptions} ${threadId} -`
      : `codex exec --json ${commandOptions} -`;
    return runCommand(`cd ${workdir} && ${action}`);
  }

  const startTurn = options.startTurn ?? defaultStartTurn;

  app.get("/info", authorize, async (_req, res) => {
    try {
      const { models, rateLimits } = await codexInfo(runCommand);
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
    const child = runCommand("hostname && pwd");
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
    const { turnId, prompt, threadId, model, reasoning, permissions } = req.body;
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
    if (turnId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(turnId)) {
      return res.status(400).json({ error: "turnId is invalid" });
    }
    const id = turnId || randomUUID();
    const requestKey = JSON.stringify({ prompt, threadId, model, reasoning, permissions });
    if (turns.has(id)) {
      if (turns.get(id).requestKey !== requestKey) {
        return res.status(409).json({ error: "turnId already belongs to a different Turn" });
      }
      return res.status(202).json({ turnId: id, eventsUrl: `/turn/${id}/events` });
    }
    if ([...turns.values()].some((turn) => turn.status === "running")) {
      return res.status(409).json({ error: "A Turn is already running" });
    }

    let child;
    try {
      child = startTurn({ prompt, threadId, model, reasoning, permissions });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
    const turn = {
      id,
      requestKey,
      child,
      status: "running",
      events: [],
      subscribers: new Set(),
      nextSequence: 1,
      bufferedBytes: 0,
      outputBuffer: "",
      decoder: new StringDecoder("utf8"),
    };
    turns.set(id, turn);

    child.stdout.on("data", (chunk) => consumeOutput(turn, chunk));
    child.stderr.pipe(process.stderr);
    child.on("error", (error) => {
      fail(turn, error.message);
    });
    child.on("close", (code) => {
      if (turn.status !== "running") return;
      consumeOutput(turn, null, true);
      if (turn.status !== "running") return;
      if (turn.outputBuffer.trim()) {
        return fail(turn, "Codex returned incomplete output");
      }
      if (code !== 0) return fail(turn, `Codex exited with ${code}`);
      append(turn, { type: "relay.turn.finished", status: "completed" }, true);
      finish(turn, "completed");
    });
    child.stdin.end(prompt);

    res.status(202).json({ turnId: id, eventsUrl: `/turn/${id}/events` });
  });

  app.get("/turn/:turnId/events", authorize, (req, res) => {
    if (!/^\d+$/.test(req.query.after ?? "0")) {
      return res.status(400).json({ error: "after must be a non-negative event sequence" });
    }
    const after = Number(req.query.after ?? 0);
    const turn = turns.get(req.params.turnId);
    if (!turn) return res.status(404).json({ error: "Turn is no longer available" });

    res.type("application/x-ndjson");
    res.set("Cache-Control", "no-cache, no-transform");
    res.set("X-Accel-Buffering", "no");
    res.flushHeaders();
    for (const event of turn.events) {
      if (event.record.sequence > after) res.write(event.encoded);
    }
    if (turn.status !== "running") return res.end();

    turn.subscribers.add(res);
    res.on("close", () => turn.subscribers.delete(res));
  });

  return app;
}

module.exports = { createApp };
