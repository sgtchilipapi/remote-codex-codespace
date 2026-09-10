const express = require("express");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ELIGIBLE_SOURCES = new Set(["vscode", "appServer"]);
const ELIGIBLE_SOURCE_KINDS = [...ELIGIBLE_SOURCES];
const TURN_RETENTION_MS = 15 * 60 * 1000;
const MAX_BUFFERED_BYTES = 5 * 1024 * 1024;
const CONTROL_EVENT_RESERVE_BYTES = 2048;

class RelayError extends Error { constructor(status, message) { super(message); this.status = status; } }

class AppServerConnection extends EventEmitter {
  constructor({ run, timeout = 30_000 } = {}) { super(); this.run = run; this.timeout = timeout; this.child = null; this.pending = new Map(); this.nextId = 1; this.connecting = null; }
  async connect() {
    if (this.child) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const child = this.run("codex app-server --stdio"); this.child = child; const decoder = new StringDecoder("utf8"); let buffer = "";
      child.stdout.on("data", (chunk) => { buffer += decoder.write(chunk); const lines = buffer.split("\n"); buffer = lines.pop(); for (const line of lines) { if (!line.trim()) continue; try { this.handle(JSON.parse(line)); } catch { this.fail(new Error("Invalid app-server response"), child); } } });
      child.on("error", (error) => this.fail(error, child)); child.on("close", () => this.fail(new Error("Codex app-server unavailable"), child));
      const id = this.nextId++; const timer = setTimeout(() => { const error = new RelayError(504, "Codex timed out"); this.fail(error, child); child.kill(); }, this.timeout);
      this.pending.set(id, { resolve: (result) => { clearTimeout(timer); child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      child.stdin.write(`${JSON.stringify({ id, method: "initialize", params: { clientInfo: { name: "relay", version: "1" } } })}\n`);
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  handle(message) { if (message.id != null) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); return message.error ? pending.reject(new Error("Codex request failed")) : pending.resolve(message.result); } if (message.method) this.emit("notification", message); }
  fail(error, child = this.child) { if (child && this.child !== child) return; this.child = null; const pending = [...this.pending.values()]; this.pending.clear(); for (const request of pending) request.reject(error); this.emit("disconnect", error); }
  async request(method, params = {}, { timeout = this.timeout } = {}) {
    await this.connect(); if (this.pending.size >= 32) throw new RelayError(503, "Relay capacity unavailable");
    return new Promise((resolve, reject) => { const id = this.nextId++; const timer = setTimeout(() => { this.pending.delete(id); reject(new RelayError(504, "Codex timed out")); }, timeout); this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); });
  }
  close() { const child = this.child; if (!child) return; this.fail(new Error("Codex app-server unavailable"), child); child.kill(); }
}

function createRun(env) { return (command) => spawn("gh", ["codespace", "ssh", "-c", env.CODESPACE, "--", command], { env: { ...env, GH_PROMPT_DISABLED: "1" }, stdio: ["pipe", "pipe", "pipe"] }); }
function sourceKind(thread) { return typeof thread.source === "string" ? thread.source : thread.sourceKind || Object.keys(thread.source || {})[0]; }
function recognizable(thread) { return String(thread.name || thread.preview || "").trim().length > 0; }
function eligible(thread, workdir) { return thread && thread.cwd === workdir && !thread.archived && ELIGIBLE_SOURCES.has(sourceKind(thread)) && recognizable(thread); }
function publicThread(thread, currentThreadId) { const preview = String(thread.preview || "").trim(); return { id: thread.id, title: String(thread.name || preview).trim(), preview, lastActive: thread.recencyAt ?? thread.updatedAt ?? thread.createdAt, model: thread.model || "", current: thread.id === currentThreadId }; }
function itemText(item) { if (typeof item.text === "string") return item.text; if (typeof item.message === "string") return item.message; if (Array.isArray(item.content)) return item.content.filter((part) => ["text", "input_text", "output_text"].includes(part.type)).map((part) => part.text || "").join(""); return ""; }
function normalizeItems(turns, anchorId) { const output = []; for (const turn of [...turns].reverse()) for (const item of turn.items || []) { if (!item.id || item.id === anchorId) continue; const type = String(item.type || "").toLowerCase(); let role; if (["usermessage", "user_message"].includes(type)) role = "user"; else if (["agentmessage", "agent_message", "error"].includes(type)) role = "assistant"; else continue; const text = itemText(item); if (text) output.push({ id: item.id, role, text: type === "error" ? `Error: ${text}` : text }); } return output; }
function effectiveConfiguration(resumed) {
  const serviceTier = resumed.serviceTier ?? null;
  return {
    model: resumed.model ?? null,
    reasoning: resumed.reasoningEffort ?? null,
    permissions: {
      sandboxPolicy: resumed.sandboxPolicy ?? resumed.sandbox ?? null,
      approvalPolicy: resumed.approvalPolicy ?? null,
      profile: null,
    },
    fastMode: serviceTier == null ? null : {
      enabled: serviceTier === "priority" ? true : null,
      serviceTier,
    },
  };
}
function validateCursor(value, required = false) { if ((required && !value) || (value != null && (typeof value !== "string" || !value || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)))) throw new RelayError(400, "Invalid cursor"); }
function applyTurnPermissions(params, permissions) {
  if (!permissions) return;
  params.sandboxPolicy = permissions;
  params.approvalPolicy = permissions === "read-only" ? "untrusted" : "on-request";
}

const PERMISSIONS = [{ id: "read-only", name: "read only" }, { id: "workspace-write", name: "workspace write" }];
function configurationModel(item) {
  return {
    id: item.id,
    name: item.displayName,
    isDefault: Boolean(item.isDefault),
    reasoning: (item.supportedReasoningEfforts || []).map(({ reasoningEffort }) => reasoningEffort),
    defaultReasoning: item.defaultReasoningEffort || null,
    serviceTiers: (item.serviceTiers || []).map(({ id, name }) => ({ id, name })),
    defaultServiceTier: item.defaultServiceTier || null,
  };
}
async function readConfiguration(codex) {
  const [catalog, configured] = await Promise.all([
    codex.request("model/list", { limit: 100 }),
    codex.request("config/read", {}),
  ]);
  const models = (catalog.data || []).filter((item) => !item.hidden).map(configurationModel);
  const config = configured.config || {};
  const defaultModel = models.find((item) => item.id === config.model) || models.find((item) => item.isDefault);
  return {
    models,
    permissions: PERMISSIONS,
    defaults: {
      model: defaultModel?.id || null,
      reasoning: defaultModel?.reasoning.includes(config.model_reasoning_effort) ? config.model_reasoning_effort : defaultModel?.defaultReasoning || null,
      permissions: PERMISSIONS.some(({ id }) => id === config.sandbox_mode) ? config.sandbox_mode : null,
      fastMode: config.service_tier === "priority" && Boolean(defaultModel?.serviceTiers.some(({ id }) => id === "priority")),
    },
  };
}

function createRelay({ appServer, env = process.env, turnRetentionMs = TURN_RETENTION_MS, maxBufferedBytes = MAX_BUFFERED_BYTES, maxSubscribersPerTurn = 8, maxRetainedTurns = 100 } = {}) {
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < CONTROL_EVENT_RESERVE_BYTES) throw new Error(`maxBufferedBytes must be at least ${CONTROL_EVENT_RESERVE_BYTES}`);
  if (!Number.isSafeInteger(maxSubscribersPerTurn) || maxSubscribersPerTurn < 1) throw new Error("maxSubscribersPerTurn must be positive");
  if (!Number.isSafeInteger(maxRetainedTurns) || maxRetainedTurns < 1) throw new Error("maxRetainedTurns must be positive");
  const app = express(); const workdir = env.CODESPACE_WORKDIR || "/workspaces/remote-codex-codespace"; const run = createRun(env); const codex = appServer || new AppServerConnection({ run }); const turns = new Map(); const configurationRevisions = new Map(); let currentAvailabilityRevision = null; app.locals.appServer = codex;
  codex.on?.("disconnect", () => { configurationRevisions.clear(); currentAvailabilityRevision = null; });
  app.use(express.json()); app.use(express.static("public"));
  const authorize = (req, res, next) => { if (!env.API_TOKEN || req.get("authorization") !== `Bearer ${env.API_TOKEN}`) return res.status(401).json({ error: "Unauthorized" }); next(); };
  const route = (handler) => async (req, res) => { try { await handler(req, res); } catch (error) { const status = error.status || 502; const message = [400, 404, 409, 429].includes(status) ? error.message : status === 503 ? "Relay capacity unavailable" : status === 504 ? "Codex timed out" : "Codex unavailable"; if (!res.headersSent) res.status(status).json({ error: message }); else res.end(`${JSON.stringify({ type: "error", message })}\n`); } };
  app.get("/configuration", authorize, route(async (_req, res) => res.json(await readConfiguration(codex))));
  app.post("/configuration/resolve", authorize, route(async (req, res) => {
    const availability = await readConfiguration(codex);
    const draft = req.body || {};
    const requestedModel = draft.model === "default" ? availability.defaults.model : draft.model;
    const selected = availability.models.find(({ id }) => id === requestedModel);
    const fieldErrors = {};
    if (!selected) fieldErrors.model = "Model is not available.";
    const resolvedReasoning = draft.reasoning === "default" ? (selected?.defaultReasoning || availability.defaults.reasoning) : draft.reasoning;
    if (draft.reasoning !== "default" && (!selected || !selected.reasoning.includes(draft.reasoning))) fieldErrors.reasoning = "Reasoning effort is not supported by the selected model.";
    const resolvedPermissions = draft.permissions === "default" ? availability.defaults.permissions : draft.permissions;
    if (draft.permissions !== "default" && !PERMISSIONS.some(({ id }) => id === draft.permissions)) fieldErrors.permissions = "Permissions choice is not supported.";
    const resolvedFastMode = draft.fastMode === "default" ? availability.defaults.fastMode : draft.fastMode;
    if ((typeof draft.fastMode !== "boolean" && draft.fastMode !== "default") || (resolvedFastMode && !selected?.serviceTiers.some(({ id }) => id === "priority"))) fieldErrors.fastMode = "Fast mode is not supported by the selected model.";
    if (Object.keys(fieldErrors).length) return res.status(400).json({ error: "Configuration is unsupported", fieldErrors });
    const resolved = { model: selected.id, reasoning: resolvedReasoning, permissions: resolvedPermissions, fastMode: resolvedFastMode, serviceTier: resolvedFastMode ? "priority" : selected.defaultServiceTier };
    const availabilityRevision = createHash("sha256").update(JSON.stringify(availability)).digest("hex");
    const configurationRevision = createHash("sha256").update(JSON.stringify({ availabilityRevision, resolved })).digest("hex");
    currentAvailabilityRevision = availabilityRevision;
    configurationRevisions.set(configurationRevision, { availabilityRevision, resolved });
    while (configurationRevisions.size > 32) configurationRevisions.delete(configurationRevisions.keys().next().value);
    res.json({ configuration: resolved, configurationRevision });
  }));
  app.get("/info", authorize, route(async (_req, res) => { const [models, limits] = await Promise.all([codex.request("model/list", { limit: 100 }), codex.request("account/rateLimits/read", {})]); res.json({ models: models.data.map((item) => ({ id: item.id, name: item.displayName, isDefault: item.isDefault, defaultReasoning: item.defaultReasoningEffort, reasoning: item.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort) })), rateLimits: limits.rateLimits }); }));
  app.get("/threads", authorize, route(async (req, res) => { validateCursor(req.query.cursor); if (req.query.currentThreadId && !UUID.test(req.query.currentThreadId)) throw new RelayError(400, "Invalid Thread ID"); const params = { archived: false, cwd: workdir, limit: 20, sortDirection: "desc", sortKey: "recency_at", sourceKinds: ELIGIBLE_SOURCE_KINDS }; if (req.query.cursor) params.cursor = req.query.cursor; const result = await codex.request("thread/list", params); res.json({ threads: result.data.filter((thread) => eligible(thread, workdir)).map((thread) => publicThread(thread, req.query.currentThreadId)), nextCursor: result.nextCursor || null }); }));
  async function readEligible(threadId) { const result = await codex.request("thread/read", { threadId, includeTurns: false }); if (!eligible(result.thread, workdir)) throw new RelayError(404, "Thread not found"); return result.thread; }
  const hasActiveTurn = () => [...turns.values()].some((turn) => turn.status === "running");
  app.post("/threads/:id/resume", authorize, route(async (req, res) => { if (!UUID.test(req.params.id)) throw new RelayError(400, "Invalid Thread ID"); if (hasActiveTurn()) throw new RelayError(409, "A Turn is active"); await readEligible(req.params.id); const resumed = await codex.request("thread/resume", { threadId: req.params.id, excludeTurns: true }); if (!eligible(resumed.thread, workdir)) throw new RelayError(404, "Thread not found"); const history = await codex.request("thread/turns/list", { threadId: req.params.id, cursor: null, limit: 20, sortDirection: "desc", itemsView: "full" }); res.json({ thread: { id: resumed.thread.id }, effectiveConfiguration: effectiveConfiguration(resumed), messages: normalizeItems(history.data || [], null), olderCursor: history.nextCursor || null }); }));
  app.get("/threads/:id/history", authorize, route(async (req, res) => { if (!UUID.test(req.params.id)) throw new RelayError(400, "Invalid Thread ID"); validateCursor(req.query.cursor, true); await readEligible(req.params.id); const history = await codex.request("thread/turns/list", { threadId: req.params.id, cursor: req.query.cursor, limit: 20, sortDirection: "desc", itemsView: "full" }); res.json({ messages: normalizeItems(history.data || [], req.query.anchorId), olderCursor: history.nextCursor || null }); }));
  app.get("/test", authorize, (_req, res) => { const child = run("hostname && pwd"); let stdout = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.on("error", () => { if (!res.headersSent) res.status(502).json({ error: "Codespace unavailable" }); }); child.on("close", (code) => { if (res.headersSent) return; if (code !== 0) return res.status(502).json({ error: "Codespace unavailable" }); res.type("text/plain").send(stdout); }); child.stdin.end(); });
  function appendTurnEvent(turn, event, control = false) {
    const record = { ...event, sequence: turn.nextSequence };
    const encoded = `${JSON.stringify(record)}\n`;
    const limit = control ? maxBufferedBytes : maxBufferedBytes - CONTROL_EVENT_RESERVE_BYTES;
    if (turn.bufferedBytes + Buffer.byteLength(encoded) > limit) return false;
    turn.nextSequence += 1; turn.bufferedBytes += Buffer.byteLength(encoded); turn.events.push({ record, encoded });
    for (const subscriber of turn.subscribers) subscriber.write(encoded);
    return true;
  }
  function finishTurn(turn, status) {
    if (turn.status !== "running") return;
    turn.status = status; codex.off?.("notification", turn.onNotification); codex.off?.("disconnect", turn.onDisconnect);
    for (const subscriber of turn.subscribers) subscriber.end(); turn.subscribers.clear();
    turn.retentionTimer = setTimeout(() => turns.delete(turn.id), turnRetentionMs); turn.retentionTimer.unref?.();
  }
  function failTurn(turn, message, interrupt = false) {
    if (turn.status !== "running") return;
    appendTurnEvent(turn, { type: "error", message: String(message).slice(0, 512) }, true);
    appendTurnEvent(turn, { type: "relay.turn.finished", status: "failed" }, true);
    if (interrupt && turn.threadId) codex.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.codexTurnId }).catch(() => {});
    finishTurn(turn, "failed");
  }
  function publishTurnEvent(turn, event) {
    if (turn.status !== "running") return;
    if (!appendTurnEvent(turn, event)) failTurn(turn, "Turn output exceeded the Relay buffer limit", true);
  }
  function evictCompletedTurns() {
    const completed = [...turns.values()].filter((turn) => turn.status !== "running");
    while (completed.length >= maxRetainedTurns) { const oldest = completed.shift(); clearTimeout(oldest.retentionTimer); turns.delete(oldest.id); }
  }
  async function startOwnedTurn(turn, request) {
    try {
      if (request.threadId) { await codex.request("thread/resume", { threadId: request.threadId, excludeTurns: true }); turn.threadId = request.threadId; }
      else { const params = { cwd: workdir }; if (request.model) params.model = request.model; if (request.reasoning && !request.configurationRevision) params.effort = request.reasoning; if (request.permissions) params.sandbox = request.permissions; turn.threadId = (await codex.request("thread/start", params)).thread.id; }
      publishTurnEvent(turn, { type: "thread.started", thread_id: turn.threadId });
      const params = { threadId: turn.threadId, input: [{ type: "text", text: request.prompt }] }; if (request.threadId && request.model) params.model = request.model; if (request.threadId && request.reasoning) params.effort = request.reasoning;
      if (!request.threadId && request.configurationRevision && request.reasoning) params.effort = request.reasoning;
      if (request.threadId || request.configurationRevision) applyTurnPermissions(params, request.permissions);
      if (request.fastMode) params.serviceTier = "priority";
      turn.codexTurnId = (await codex.request("turn/start", params)).turn.id;
      if (turn.status !== "running") { codex.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.codexTurnId }).catch(() => {}); return; }
      for (const notification of turn.pendingNotifications.splice(0)) turn.processNotification(notification);
    } catch { failTurn(turn, "Codex unavailable"); }
  }
  app.post("/turn", authorize, route(async (req, res) => {
    const { turnId: requestedId, prompt, threadId, model, reasoning, permissions, fastMode = false, configurationRevision } = req.body;
    if (typeof prompt !== "string" || !prompt.trim()) throw new RelayError(400, "prompt is required");
    if (threadId && !UUID.test(threadId)) throw new RelayError(400, "threadId is invalid");
    if (requestedId && !UUID.test(requestedId)) throw new RelayError(400, "turnId is invalid");
    const revision = configurationRevision && configurationRevisions.get(configurationRevision);
    if (configurationRevision && (!revision || revision.availabilityRevision !== currentAvailabilityRevision)) throw new RelayError(409, "Configuration revision is obsolete");
    if (fastMode && revision?.resolved.serviceTier !== "priority") throw new RelayError(400, "Fast mode is unsupported");
    const boundConfiguration = revision ? revision.resolved : { model, reasoning, permissions, fastMode };
    const id = requestedId || randomUUID(); const request = { prompt, threadId, ...boundConfiguration, configurationRevision }; const requestKey = JSON.stringify(request);
    const existing = turns.get(id); if (existing) { if (existing.requestKey !== requestKey) throw new RelayError(409, "turnId already belongs to a different Turn"); return res.status(202).json({ turnId: id, eventsUrl: `/turn/${id}/events` }); }
    if (hasActiveTurn()) throw new RelayError(409, "A Turn is active"); evictCompletedTurns();
    const turn = { id, requestKey, status: "running", threadId: null, codexTurnId: null, events: [], subscribers: new Set(), nextSequence: 1, bufferedBytes: 0, pendingNotifications: [], pendingNotificationBytes: 0 };
    turn.processNotification = ({ method, params }) => { if (params?.turnId && params.turnId !== turn.codexTurnId) return; if (method === "item/completed" && params.item?.type === "agentMessage") publishTurnEvent(turn, { type: "item.completed", item: { type: "agent_message", text: itemText(params.item) } }); if (method === "item/completed" && params.item?.type === "error") publishTurnEvent(turn, { type: "error", message: itemText(params.item) || "Turn failed" }); if (method === "turn/completed" && params.turn?.id === turn.codexTurnId) { const status = params.turn?.status === "failed" ? "failed" : "completed"; appendTurnEvent(turn, { type: "relay.turn.finished", status }, true); finishTurn(turn, status); } };
    turn.onNotification = (notification) => { if (notification.params?.threadId !== turn.threadId) return; if (!turn.codexTurnId) { turn.pendingNotificationBytes += Buffer.byteLength(JSON.stringify(notification)); if (turn.pendingNotificationBytes > maxBufferedBytes - CONTROL_EVENT_RESERVE_BYTES) failTurn(turn, "Turn output exceeded the Relay buffer limit"); else turn.pendingNotifications.push(notification); } else turn.processNotification(notification); };
    turn.onDisconnect = () => failTurn(turn, "Codex unavailable"); codex.on?.("notification", turn.onNotification); codex.on?.("disconnect", turn.onDisconnect); turns.set(id, turn); void startOwnedTurn(turn, request);
    res.status(202).json({ turnId: id, eventsUrl: `/turn/${id}/events` });
  }));
  app.get("/turn/:turnId/events", authorize, route(async (req, res) => {
    const rawAfter = req.query.after ?? "0"; if (!/^\d+$/.test(rawAfter)) throw new RelayError(400, "after must be a non-negative event sequence");
    const after = Number(rawAfter); const turn = turns.get(req.params.turnId); if (!turn) throw new RelayError(404, "Turn not found");
    if (!Number.isSafeInteger(after) || after >= turn.nextSequence) throw new RelayError(400, "after exceeds available events");
    if (turn.status === "running" && turn.subscribers.size >= maxSubscribersPerTurn) return res.status(429).json({ error: "Too many Turn subscribers" });
    res.type("application/x-ndjson"); res.set("Cache-Control", "no-cache, no-transform"); res.set("X-Accel-Buffering", "no"); res.flushHeaders();
    for (const event of turn.events) if (event.record.sequence > after) res.write(event.encoded);
    if (turn.status !== "running") return res.end(); turn.subscribers.add(res); res.on("close", () => turn.subscribers.delete(res));
  }));
  return app;
}

const app = createRelay();
if (require.main === module) { const server = app.listen(process.env.PORT || 3000, "0.0.0.0"); const close = () => { app.locals.appServer.close?.(); server.close(); }; process.once("SIGTERM", close); process.once("SIGINT", close); }
module.exports = app; module.exports.createRelay = createRelay; module.exports.AppServerConnection = AppServerConnection;
