const express = require("express");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERACTIVE_SOURCES = new Set(["cli", "vscode", "appServer"]);

class RelayError extends Error { constructor(status, message) { super(message); this.status = status; } }

class AppServerConnection extends EventEmitter {
  constructor({ run, timeout = 30_000 } = {}) { super(); this.run = run; this.timeout = timeout; this.child = null; this.pending = new Map(); this.nextId = 1; this.connecting = null; }
  async connect() {
    if (this.child) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const child = this.run("codex app-server --stdio"); this.child = child; let buffer = "";
      child.stdout.on("data", (chunk) => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop(); for (const line of lines) { if (!line.trim()) continue; try { this.handle(JSON.parse(line)); } catch { this.fail(new Error("Invalid app-server response")); } } });
      child.on("error", (error) => this.fail(error)); child.on("close", () => this.fail(new Error("Codex app-server unavailable")));
      const id = this.nextId++; const timer = setTimeout(() => reject(new RelayError(504, "Codex timed out")), this.timeout);
      this.pending.set(id, { resolve: (result) => { clearTimeout(timer); child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`); resolve(result); }, reject });
      child.stdin.write(`${JSON.stringify({ id, method: "initialize", params: { clientInfo: { name: "relay", version: "1" } } })}\n`);
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  handle(message) { if (message.id != null) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); return message.error ? pending.reject(new Error("Codex request failed")) : pending.resolve(message.result); } if (message.method) this.emit("notification", message); }
  fail(error) { this.child = null; for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); this.emit("disconnect", error); }
  async request(method, params = {}, { timeout = this.timeout } = {}) {
    await this.connect(); if (this.pending.size >= 32) throw new RelayError(503, "Relay capacity unavailable");
    return new Promise((resolve, reject) => { const id = this.nextId++; const timer = setTimeout(() => { this.pending.delete(id); reject(new RelayError(504, "Codex timed out")); }, timeout); this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); });
  }
  close() { this.child?.kill(); this.child = null; }
}

function createRun(env) { return (command) => spawn("gh", ["codespace", "ssh", "-c", env.CODESPACE, "--", command], { env: { ...env, GH_PROMPT_DISABLED: "1" }, stdio: ["pipe", "pipe", "pipe"] }); }
function sourceKind(thread) { return typeof thread.source === "string" ? thread.source : thread.sourceKind || Object.keys(thread.source || {})[0]; }
function recognizable(thread) { return String(thread.name || thread.preview || "").trim().length > 0; }
function eligible(thread, workdir) { return thread && thread.cwd === workdir && !thread.archived && INTERACTIVE_SOURCES.has(sourceKind(thread)) && recognizable(thread); }
function publicThread(thread, currentThreadId) { const preview = String(thread.preview || "").trim(); return { id: thread.id, title: String(thread.name || preview).trim(), preview, lastActive: thread.recencyAt ?? thread.updatedAt ?? thread.createdAt, model: thread.model || "", current: thread.id === currentThreadId }; }
function itemText(item) { if (typeof item.text === "string") return item.text; if (typeof item.message === "string") return item.message; if (Array.isArray(item.content)) return item.content.filter((part) => ["text", "input_text", "output_text"].includes(part.type)).map((part) => part.text || "").join(""); return ""; }
function normalizeItems(turns, anchorId) { const output = []; for (const turn of [...turns].reverse()) for (const item of turn.items || []) { if (!item.id || item.id === anchorId) continue; const type = String(item.type || "").toLowerCase(); let role; if (["usermessage", "user_message"].includes(type)) role = "user"; else if (["agentmessage", "agent_message", "error"].includes(type)) role = "assistant"; else continue; const text = itemText(item); if (text) output.push({ id: item.id, role, text: type === "error" ? `Error: ${text}` : text }); } return output; }
function validateCursor(value, required = false) { if ((required && !value) || (value != null && (typeof value !== "string" || !value || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)))) throw new RelayError(400, "Invalid cursor"); }

function createRelay({ appServer, env = process.env } = {}) {
  const app = express(); const workdir = env.CODESPACE_WORKDIR || "/workspaces/remote-codex-codespace"; const run = createRun(env); const codex = appServer || new AppServerConnection({ run }); const activeTurns = new Set(); app.locals.appServer = codex;
  app.use(express.json()); app.use(express.static("public"));
  const authorize = (req, res, next) => { if (!env.API_TOKEN || req.get("authorization") !== `Bearer ${env.API_TOKEN}`) return res.status(401).json({ error: "Unauthorized" }); next(); };
  const route = (handler) => async (req, res) => { try { await handler(req, res); } catch (error) { const status = error.status || 502; const message = status === 404 ? "Thread not found" : status === 400 ? error.message : status === 409 ? error.message : status === 503 ? "Relay capacity unavailable" : status === 504 ? "Codex timed out" : "Codex unavailable"; if (!res.headersSent) res.status(status).json({ error: message }); else res.end(`${JSON.stringify({ type: "error", message })}\n`); } };
  app.get("/info", authorize, route(async (_req, res) => { const [models, limits] = await Promise.all([codex.request("model/list", { limit: 100 }), codex.request("account/rateLimits/read", {})]); res.json({ models: models.data.map((item) => ({ id: item.id, name: item.displayName, isDefault: item.isDefault, defaultReasoning: item.defaultReasoningEffort, reasoning: item.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort) })), rateLimits: limits.rateLimits }); }));
  app.get("/threads", authorize, route(async (req, res) => { validateCursor(req.query.cursor); if (req.query.currentThreadId && !UUID.test(req.query.currentThreadId)) throw new RelayError(400, "Invalid Thread ID"); const params = { archived: false, cwd: workdir, limit: 20, sortDirection: "desc", sortKey: "recency_at" }; if (req.query.cursor) params.cursor = req.query.cursor; const result = await codex.request("thread/list", params); res.json({ threads: result.data.filter((thread) => eligible(thread, workdir)).map((thread) => publicThread(thread, req.query.currentThreadId)), nextCursor: result.nextCursor || null }); }));
  async function readEligible(threadId) { const result = await codex.request("thread/read", { threadId, includeTurns: false }); if (!eligible(result.thread, workdir)) throw new RelayError(404, "Thread not found"); return result.thread; }
  app.post("/threads/:id/resume", authorize, route(async (req, res) => { if (!UUID.test(req.params.id)) throw new RelayError(400, "Invalid Thread ID"); if (activeTurns.size) throw new RelayError(409, "A Turn is active"); await readEligible(req.params.id); const resumed = await codex.request("thread/resume", { threadId: req.params.id, excludeTurns: true }); if (!eligible(resumed.thread, workdir)) throw new RelayError(404, "Thread not found"); const history = await codex.request("thread/turns/list", { threadId: req.params.id, cursor: null, limit: 20, sortDirection: "desc", itemsView: "full" }); res.json({ thread: { id: resumed.thread.id, model: resumed.thread.model || "" }, messages: normalizeItems(history.data || [], null), olderCursor: history.nextCursor || null }); }));
  app.get("/threads/:id/history", authorize, route(async (req, res) => { if (!UUID.test(req.params.id)) throw new RelayError(400, "Invalid Thread ID"); validateCursor(req.query.cursor, true); await readEligible(req.params.id); const history = await codex.request("thread/turns/list", { threadId: req.params.id, cursor: req.query.cursor, limit: 20, sortDirection: "desc", itemsView: "full" }); res.json({ messages: normalizeItems(history.data || [], req.query.anchorId), olderCursor: history.nextCursor || null }); }));
  app.get("/test", authorize, (_req, res) => { const child = run("hostname && pwd"); let stdout = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.on("error", () => { if (!res.headersSent) res.status(502).json({ error: "Codespace unavailable" }); }); child.on("close", (code) => { if (res.headersSent) return; if (code !== 0) return res.status(502).json({ error: "Codespace unavailable" }); res.type("text/plain").send(stdout); }); child.stdin.end(); });
  app.post("/turn", authorize, route(async (req, res) => {
    const { prompt, threadId, model, reasoning, permissions } = req.body; if (typeof prompt !== "string" || !prompt.trim()) throw new RelayError(400, "prompt is required"); if (threadId && !UUID.test(threadId)) throw new RelayError(400, "threadId is invalid"); if (threadId && activeTurns.has(threadId)) throw new RelayError(409, "A Turn is active"); let activeThreadId = threadId; if (activeThreadId) activeTurns.add(activeThreadId);
    try { if (activeThreadId) await codex.request("thread/resume", { threadId: activeThreadId, excludeTurns: true }); else { const params = { cwd: workdir }; if (model) params.model = model; if (reasoning) params.effort = reasoning; if (permissions) params.sandbox = permissions; activeThreadId = (await codex.request("thread/start", params)).thread.id; activeTurns.add(activeThreadId); } } catch (error) { if (activeThreadId) activeTurns.delete(activeThreadId); throw error; }
    res.type("application/x-ndjson"); res.set("Cache-Control", "no-cache, no-transform"); res.set("X-Accel-Buffering", "no"); res.flushHeaders(); res.write(`${JSON.stringify({ type: "thread.started", thread_id: activeThreadId })}\n`); let turnId;
    const cleanup = () => { activeTurns.delete(activeThreadId); codex.off?.("notification", onNotification); codex.off?.("disconnect", onDisconnect); };
    const onDisconnect = () => { if (!res.writableEnded) { res.write(`${JSON.stringify({ type: "error", message: "Codex unavailable" })}\n`); res.end(); } cleanup(); };
    const onNotification = ({ method, params }) => { if (params?.threadId !== activeThreadId) return; if (method === "item/completed" && ["agentMessage", "error"].includes(params.item?.type)) res.write(`${JSON.stringify({ type: "item.completed", item: { type: params.item.type === "agentMessage" ? "agent_message" : "error", text: itemText(params.item) } })}\n`); if (method === "turn/completed" && (!turnId || params.turn?.id === turnId)) { cleanup(); res.end(); } };
    codex.on?.("notification", onNotification); codex.on?.("disconnect", onDisconnect); res.on("close", async () => { if (!res.writableEnded) { try { await codex.request("turn/interrupt", { threadId: activeThreadId, turnId }); } catch {} } cleanup(); });
    try { const params = { threadId: activeThreadId, input: [{ type: "text", text: prompt }] }; if (threadId && model) params.model = model; if (threadId && reasoning) params.effort = reasoning; if (threadId && permissions) params.permissions = permissions; const started = await codex.request("turn/start", params); turnId = started.turn.id; } catch { cleanup(); res.write(`${JSON.stringify({ type: "error", message: "Turn failed" })}\n`); res.end(); }
  }));
  return app;
}

const app = createRelay();
if (require.main === module) { const server = app.listen(process.env.PORT || 3000, "0.0.0.0"); const close = () => { app.locals.appServer.close?.(); server.close(); }; process.once("SIGTERM", close); process.once("SIGINT", close); }
module.exports = app; module.exports.createRelay = createRelay; module.exports.AppServerConnection = AppServerConnection;
