const express = require("express");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { DeviceAuthManager } = require("./device-auth");
const {
  version: FAILURE_VERSION,
  sources: FAILURE_COPY,
  codexErrorCodes: CODEX_ERROR_CODES,
} = require("./public/failure-catalog");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ELIGIBLE_SOURCES = new Set(["vscode", "appServer"]);
const ELIGIBLE_SOURCE_KINDS = [...ELIGIBLE_SOURCES];
const TURN_RETENTION_MS = 15 * 60 * 1000;
const MAX_BUFFERED_BYTES = 5 * 1024 * 1024;
const CONTROL_EVENT_RESERVE_BYTES = 2048;

function codexErrorKind(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return value.type || value.kind || Object.keys(value)[0] || null;
}

function redactStructuredCause(value, depth = 0) {
  if (depth > 5) return "[redacted]";
  if (typeof value === "string") return "[redacted]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactStructuredCause(item, depth + 1));
  if (typeof value !== "object") return "[redacted]";
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, redactStructuredCause(item, depth + 1)]));
}

function redactedCauseChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current instanceof Error && !seen.has(current) && chain.length < 5) {
    seen.add(current);
    const entry = { type: current.constructor?.name || "Error" };
    if (typeof current.kind === "string") entry.kind = current.kind;
    if (Number.isInteger(current.status)) entry.status = current.status;
    if (current.details?.upstreamError && typeof current.details.upstreamError === "object") {
      entry.structuredCause = redactStructuredCause(current.details.upstreamError);
    }
    chain.push(entry);
    current = current.cause;
  }
  return chain;
}

function failureFeedback(source, code, operation, overrides = {}) {
  const [defaultMessage, defaultAction, defaultRetryable] = FAILURE_COPY[source]?.[code]
    || FAILURE_COPY.relay.malformed_response;
  return {
    version: FAILURE_VERSION,
    source,
    code,
    operation,
    retryable: overrides.retryable ?? defaultRetryable,
    message: overrides.message || defaultMessage,
    action: overrides.action || defaultAction,
    ...(overrides.diagnosticId ? { diagnosticId: overrides.diagnosticId } : {}),
    ...(overrides.fieldErrors && Object.keys(overrides.fieldErrors).length ? { fieldErrors: overrides.fieldErrors } : {}),
  };
}

class RelayError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.status = status;
    this.failureOptions = options;
  }
}

class BoundaryError extends Error {
  constructor(kind, details = {}) {
    super(kind);
    this.kind = kind;
    this.details = details;
  }
}

class AppServerConnection extends EventEmitter {
  constructor({ run, timeout = 30_000 } = {}) { super(); this.run = run; this.timeout = timeout; this.child = null; this.pending = new Map(); this.nextId = 1; this.connecting = null; }
  async connect() {
    if (this.child) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const child = this.run("codex app-server --stdio"); this.child = child; const decoder = new StringDecoder("utf8"); let buffer = "";
      child.stdout.on("data", (chunk) => { buffer += decoder.write(chunk); const lines = buffer.split("\n"); buffer = lines.pop(); for (const line of lines) { if (!line.trim()) continue; try { this.handle(JSON.parse(line)); } catch { this.fail(new BoundaryError("malformed_response"), child); } } });
      child.on("error", () => this.fail(new BoundaryError("dependency_missing"), child));
      child.on("close", (exitCode, signal) => this.fail(new BoundaryError("upstream_disconnected", { exitCode, signal }), child));
      const id = this.nextId++; const timer = setTimeout(() => { const error = new BoundaryError("upstream_timeout"); error.status = 504; this.fail(error, child); child.kill(); }, this.timeout);
      this.pending.set(id, { requestMethod: "initialize", resolve: (result) => { clearTimeout(timer); child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      child.stdin.write(`${JSON.stringify({ id, method: "initialize", params: { clientInfo: { name: "relay", version: "1" } } })}\n`);
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  handle(message) { if (message.id != null) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); return message.error ? pending.reject(new BoundaryError("codex_request", { jsonRpcCode: message.error.code, requestMethod: pending.requestMethod, upstreamError: message.error })) : pending.resolve(message.result); } if (message.method) this.emit("notification", message); }
  fail(error, child = this.child) { if (child && this.child !== child) return; this.child = null; const pending = [...this.pending.values()]; this.pending.clear(); for (const request of pending) request.reject(error); this.emit("disconnect", error); }
  async request(method, params = {}, { timeout = this.timeout } = {}) {
    await this.connect(); if (this.pending.size >= 32) throw new RelayError(503, "Relay capacity unavailable");
    return new Promise((resolve, reject) => { const id = this.nextId++; const timer = setTimeout(() => { this.pending.delete(id); const error = new BoundaryError("upstream_timeout", { requestMethod: method }); error.status = 504; reject(error); }, timeout); this.pending.set(id, { requestMethod: method, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); });
  }
  close() { const child = this.child; if (!child) return; this.fail(new BoundaryError("upstream_disconnected"), child); child.kill(); }
}

function createRun(env) { return (command) => spawn("gh", ["codespace", "ssh", "-c", env.CODESPACE, "--", command], { env: { ...env, GH_PROMPT_DISABLED: "1" }, stdio: ["pipe", "pipe", "pipe"] }); }
function createCodespaceProbe(env) {
  return () => new Promise((resolve, reject) => {
    const child = spawn("gh", ["codespace", "view", "-c", env.CODESPACE, "--json", "state"], { env: { ...env, GH_PROMPT_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => reject(new BoundaryError("dependency_missing")));
    child.on("close", (exitCode, signal) => {
      if (exitCode !== 0) return reject(new BoundaryError("upstream_failure", { exitCode, signal }));
      try {
        const result = JSON.parse(stdout);
        if (typeof result.state !== "string") throw new Error();
        resolve(result);
      } catch { reject(new BoundaryError("malformed_response")); }
    });
  });
}
function sourceKind(thread) { return typeof thread.source === "string" ? thread.source : thread.sourceKind || Object.keys(thread.source || {})[0]; }
function recognizable(thread) { return String(thread.name || thread.preview || "").trim().length > 0; }
function eligible(thread, workdir) { return thread && thread.cwd === workdir && !thread.archived && ELIGIBLE_SOURCES.has(sourceKind(thread)) && recognizable(thread); }
function publicThread(thread, currentThreadId) { const preview = String(thread.preview || "").trim(); return { id: thread.id, title: String(thread.name || preview).trim(), preview, lastActive: thread.recencyAt ?? thread.updatedAt ?? thread.createdAt, model: thread.model || "", current: thread.id === currentThreadId }; }
function itemText(item) { if (typeof item.text === "string") return item.text; if (typeof item.message === "string") return item.message; if (Array.isArray(item.content)) return item.content.filter((part) => ["text", "input_text", "output_text"].includes(part.type)).map((part) => part.text || "").join(""); return ""; }
function activityCategory(type) {
  const normalized = String(type || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (["reasoning", "plan", "planning"].includes(normalized)) return "Thinking";
  if (["commandexecution", "command", "terminal"].includes(normalized)) return "Running";
  if (["filechange", "filechanges", "fileedit"].includes(normalized)) return "Editing";
  if (["websearch", "web", "mcptoolcall", "dynamictoolcall"].includes(normalized)) return "Researching";
  if (["collaboration", "collaborationtoolcall", "subagent", "subagenttoolcall"].includes(normalized)) return "Delegating";
  if (["imageview", "viewimage"].includes(normalized)) return "Inspecting image";
  if (["imagegeneration", "imagegen"].includes(normalized)) return "Generating image";
  if (["sleep", "wait", "waiting"].includes(normalized)) return "Waiting";
  return "Working";
}
function normalizeItems(turns, anchorId) { const output = []; for (const turn of [...turns].reverse()) for (const item of turn.items || []) { if (!item.id || item.id === anchorId) continue; const type = String(item.type || "").toLowerCase(); let role; if (["usermessage", "user_message"].includes(type)) role = "user"; else if (["agentmessage", "agent_message", "error"].includes(type)) role = "assistant"; else continue; const text = type === "error" ? "Codex reported an item error." : itemText(item); if (text) output.push({ id: item.id, role, text, ...(type === "error" ? { error: true } : {}) }); } return output; }
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
function unavailable(reason) { return { unavailable: true, reason }; }
function confirmed(value, observedAt, stale = false) { return { value, observedAt, stale }; }
function mergeObject(previous, update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) return previous;
  const merged = { ...(previous || {}) };
  for (const [key, value] of Object.entries(update)) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeObject(merged[key], value)
      : value;
  }
  return merged;
}
function mergeObservedAt(previous, update, observedAt) {
  if (!update || typeof update !== "object" || Array.isArray(update)) return observedAt;
  const merged = { ...(previous && typeof previous === "object" ? previous : {}) };
  for (const [key, value] of Object.entries(update)) merged[key] = mergeObservedAt(merged[key], value, observedAt);
  return merged;
}
function statusConfiguration(configuration, observedAt, preTurn = false) {
  const observed = (field) => typeof observedAt === "string" ? observedAt : observedAt?.[field];
  const permissionValue = preTurn
    ? configuration?.permissions
    : configuration?.permissions && Object.values(configuration.permissions).some((value) => value != null) ? configuration.permissions : null;
  const fastValue = preTurn
    ? { enabled: Boolean(configuration?.fastMode), serviceTier: configuration?.serviceTier ?? null }
    : configuration?.fastMode;
  return {
    model: configuration?.model != null ? confirmed(configuration.model, observed("model")) : unavailable("not_reported"),
    reasoning: configuration?.reasoning != null ? confirmed(configuration.reasoning, observed("reasoning")) : unavailable("not_reported"),
    permissions: permissionValue != null ? confirmed(permissionValue, observed("permissions")) : unavailable("not_reported"),
    fastMode: fastValue != null ? confirmed(fastValue, observed("fastMode")) : unavailable("not_reported"),
  };
}
function rateLimitStatus(raw, observedAt, stale = false) {
  const windows = [];
  const collect = (snapshot, observations) => {
    if (!snapshot || typeof snapshot !== "object") return;
    for (const key of ["primary", "secondary"]) if (snapshot[key] && typeof snapshot[key] === "object") windows.push({ value: snapshot[key], observedAt: observations?.[key] });
  };
  collect(raw?.rateLimits, observedAt?.rateLimits);
  for (const [limitId, snapshot] of Object.entries(raw?.rateLimitsByLimitId || {})) collect(snapshot, observedAt?.rateLimitsByLimitId?.[limitId]);
  const project = (duration) => {
    const matched = windows.find(({ value }) => value.windowDurationMins === duration);
    const window = matched?.value;
    if (!window) return { remainingPercent: unavailable("not_reported"), resetsAt: unavailable("not_reported") };
    const remaining = Number.isFinite(window.usedPercent) ? Math.min(100, Math.max(0, 100 - window.usedPercent)) : null;
    return {
      remainingPercent: remaining == null ? unavailable("not_reported") : confirmed(remaining, matched.observedAt?.usedPercent, stale),
      resetsAt: window.resetsAt == null ? unavailable("not_reported") : confirmed(window.resetsAt, matched.observedAt?.resetsAt, stale),
    };
  };
  return { fiveHour: project(300), weekly: project(10080) };
}
function validateCursor(value, required = false) { if ((required && !value) || (value != null && (typeof value !== "string" || !value || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)))) throw new RelayError(400, "Invalid cursor"); }
const TURN_PERMISSION_POLICIES = {
  "read-only": { sandboxPolicy: { type: "readOnly" }, approvalPolicy: "untrusted" },
  "workspace-write": { sandboxPolicy: { type: "workspaceWrite" }, approvalPolicy: "on-request" },
};
function applyTurnPermissions(params, permissions) {
  if (!permissions) return;
  Object.assign(params, TURN_PERMISSION_POLICIES[permissions]);
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
  if (!catalog || !Array.isArray(catalog.data) || !configured || typeof configured.config !== "object") throw new BoundaryError("malformed_response");
  const models = catalog.data.filter((item) => !item.hidden).map(configurationModel);
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

function createRelay({ appServer, env = process.env, turnRetentionMs = TURN_RETENTION_MS, maxBufferedBytes = MAX_BUFFERED_BYTES, maxSubscribersPerTurn = 8, maxRetainedTurns = 100, logger = null, codespaceProbe, run: relayRun, deviceAuthTimeoutMs, deviceAuthRetentionMs, deviceAuthMaxOutputBytes } = {}) {
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < CONTROL_EVENT_RESERVE_BYTES) throw new Error(`maxBufferedBytes must be at least ${CONTROL_EVENT_RESERVE_BYTES}`);
  if (!Number.isSafeInteger(maxSubscribersPerTurn) || maxSubscribersPerTurn < 1) throw new Error("maxSubscribersPerTurn must be positive");
  if (!Number.isSafeInteger(maxRetainedTurns) || maxRetainedTurns < 1) throw new Error("maxRetainedTurns must be positive");
  const app = express(); const workdir = env.CODESPACE_WORKDIR || "/workspaces/remote-codex-codespace"; const run = relayRun || createRun(env); const probeCodespace = codespaceProbe || createCodespaceProbe(env); const codex = appServer || new AppServerConnection({ run }); const deviceAuth = new DeviceAuthManager({ run, timeoutMs: deviceAuthTimeoutMs, retentionMs: deviceAuthRetentionMs, maxOutputBytes: deviceAuthMaxOutputBytes }); const turns = new Map(); const configurationRevisions = new Map(); const threadSnapshots = new Map(); let currentAvailabilityRevision = null; let selectedThreadId = null; let preTurnSnapshot = null; let accountSnapshot = null; app.locals.appServer = codex;
  const onRelayNotification = ({ method, params = {} }) => {
    const observedAt = new Date().toISOString();
    if (method === "account/rateLimits/updated") {
      accountSnapshot = { value: mergeObject(accountSnapshot?.value, params), observedAt: mergeObservedAt(accountSnapshot?.observedAt, params, observedAt) };
      return;
    }
    if (!selectedThreadId || params.threadId !== selectedThreadId) return;
    const snapshot = threadSnapshots.get(selectedThreadId) || {};
    if (method === "thread/settings/updated") {
      const settings = params.threadSettings || {};
      const update = {};
      if (Object.hasOwn(settings, "model")) update.model = settings.model;
      if (Object.hasOwn(settings, "effort")) update.reasoning = settings.effort;
      if (Object.hasOwn(settings, "sandboxPolicy")) update.permissions = { ...(snapshot.configuration?.permissions || {}), sandboxPolicy: settings.sandboxPolicy };
      if (Object.hasOwn(settings, "approvalPolicy")) update.permissions = { ...(update.permissions || snapshot.configuration?.permissions || {}), approvalPolicy: settings.approvalPolicy };
      if (Object.hasOwn(settings, "activePermissionProfile")) update.permissions = { ...(update.permissions || snapshot.configuration?.permissions || {}), profile: settings.activePermissionProfile };
      if (Object.hasOwn(settings, "serviceTier")) update.fastMode = settings.serviceTier == null ? null : { enabled: settings.serviceTier === "priority" ? true : null, serviceTier: settings.serviceTier };
      snapshot.configuration = { ...(snapshot.configuration || {}), ...update };
      snapshot.configurationObservedAt = { ...(snapshot.configurationObservedAt || {}) };
      for (const field of Object.keys(update)) snapshot.configurationObservedAt[field] = observedAt;
    }
    if (method === "thread/tokenUsage/updated") {
      const tokenUsageUpdate = params.tokenUsage || {};
      const refreshesContext = Object.hasOwn(tokenUsageUpdate, "modelContextWindow") || Object.hasOwn(tokenUsageUpdate.last || {}, "totalTokens");
      snapshot.tokenUsage = mergeObject(snapshot.tokenUsage, tokenUsageUpdate);
      const usage = snapshot.tokenUsage;
      const usedTokens = usage.last?.totalTokens;
      const windowTokens = usage.modelContextWindow;
      if (refreshesContext && Number.isFinite(usedTokens) && Number.isFinite(windowTokens) && windowTokens > 0) {
        snapshot.context = { usedTokens, windowTokens, percentage: Math.min(100, Math.max(0, usedTokens / windowTokens * 100)) };
        snapshot.contextObservedAt = observedAt;
      }
    }
    threadSnapshots.set(selectedThreadId, snapshot);
  };
  codex.on?.("notification", onRelayNotification);
  codex.on?.("disconnect", () => { configurationRevisions.clear(); threadSnapshots.clear(); currentAvailabilityRevision = null; selectedThreadId = null; preTurnSnapshot = null; accountSnapshot = null; });
  function classifyFailure(error, operation, overrides = {}) {
    const options = error?.failureOptions || {};
    let source = options.source || (error instanceof RelayError ? "relay" : "unknown");
    let code = options.code || "upstream_failure";
    if (error?.kind === "dependency_missing") { source = "relay"; code = "dependency_missing"; }
    else if (error?.kind === "malformed_response") { source = "relay"; code = "malformed_response"; }
    else if (error?.kind === "output_limit_exceeded") { source = "relay"; code = "output_limit_exceeded"; }
    else if (error?.kind === "upstream_timeout" || error?.status === 504) { source = "relay"; code = "upstream_timeout"; }
    else if (error?.kind === "upstream_disconnected") { source = "unknown"; code = "upstream_disconnected"; }
    else if (error?.kind === "codex_request") { source = "codex"; code = error.details?.jsonRpcCode === -32001 ? "server_overloaded" : "protocol_rejected"; }
    else if (error instanceof RelayError && !options.source && !options.code) {
      source = "relay";
      if (error.status === 400) code = "request_invalid";
      else if (error.status === 404) code = operation === "turn.recover" ? "retained_turn_unavailable" : "state_conflict";
      else if (error.status === 409) code = "state_conflict";
      else if ([429, 503].includes(error.status)) code = "capacity_exceeded";
      else code = "internal_failure";
    }
    const diagnosticId = randomUUID();
    const feedback = failureFeedback(source, code, operation, {
      ...options,
      ...overrides,
      diagnosticId,
    });
    const diagnostic = {
      diagnosticId,
      timestamp: new Date().toISOString(),
      operation,
      source: feedback.source,
      code: feedback.code,
      context: overrides.context || "http",
      ...(Number.isInteger(error?.details?.jsonRpcCode) ? { jsonRpcCode: error.details.jsonRpcCode } : {}),
      ...(typeof error?.details?.requestMethod === "string" ? { requestMethod: error.details.requestMethod } : {}),
      ...(Number.isInteger(error?.details?.exitCode) ? { childExitCode: error.details.exitCode } : {}),
      ...(typeof error?.details?.signal === "string" ? { childSignal: error.details.signal } : {}),
      ...(typeof overrides.diagnostic?.upstreamWireValue === "string" ? { upstreamWireValue: overrides.diagnostic.upstreamWireValue } : {}),
      ...(typeof overrides.diagnostic?.willRetry === "boolean" ? { willRetry: overrides.diagnostic.willRetry } : {}),
      ...(["completed", "failed", "interrupted"].includes(overrides.diagnostic?.terminalStatus) ? { terminalStatus: overrides.diagnostic.terminalStatus } : {}),
      causeChain: redactedCauseChain(error),
    };
    try { logger?.error?.(diagnostic); } catch {}
    return feedback;
  }
  function sendFailure(res, statusCode, failure) {
    const body = { error: failure.message, failure };
    if (failure.fieldErrors) body.fieldErrors = failure.fieldErrors;
    return res.status(statusCode).json(body);
  }
  function codexTurnFailure(raw, operation = "turn.stream", overrides = {}) {
    const kind = codexErrorKind(raw?.codexErrorInfo);
    const code = CODEX_ERROR_CODES[kind] || "turn_failed";
    return classifyFailure(new RelayError(502, "Codex Turn failed", { source: "codex", code }), operation, {
      context: "stream",
      ...overrides,
      diagnostic: {
        ...(kind ? { upstreamWireValue: kind } : {}),
        ...overrides.diagnostic,
      },
    });
  }
  async function diagnosticFailure(originalError) {
    try {
      const result = await probeCodespace();
      if (!new Set(["Available", "Running"]).has(result?.state)) {
        return classifyFailure(new RelayError(502, "Codespace is not running", { source: "codespace", code: "not_running" }), "codespace.diagnostic");
      }
    } catch (probeError) {
      if (probeError?.codespaceCondition && FAILURE_COPY.codespace[probeError.codespaceCondition]) {
        return classifyFailure(new RelayError(502, "Codespace probe failed", { source: "codespace", code: probeError.codespaceCondition }), "codespace.diagnostic");
      }
    }
    return classifyFailure(originalError, "codespace.diagnostic");
  }
  function requestOperation(req) {
    if (req.path === "/configuration") return "settings.check";
    if (req.path === "/configuration/resolve") return "configuration.resolve";
    if (req.path === "/status") return "status.read";
    if (req.path === "/codex/device-auth" || req.path.startsWith("/codex/device-auth/")) return "codex.authenticate";
    if (req.path === "/threads") return "thread.list";
    if (/\/history$/.test(req.path)) return "thread.history";
    if (/\/resume$/.test(req.path)) return "thread.resume";
    if (req.path === "/turn") return "turn.create";
    if (/\/events$/.test(req.path)) return "turn.recover";
    if (req.path === "/test") return "codespace.diagnostic";
    return "settings.check";
  }
  app.use(express.json()); app.use(express.static("public"));
  const authorize = (req, res, next) => {
    if (!env.API_TOKEN || req.get("authorization") !== `Bearer ${env.API_TOKEN}`) {
      const failure = classifyFailure(new RelayError(401, "Unauthorized", { source: "relay", code: "authentication_rejected" }), requestOperation(req));
      return sendFailure(res, 401, failure);
    }
    next();
  };
  const route = (operation, handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      const statusCode = error.status || (error?.kind === "upstream_timeout" ? 504 : error?.kind === "codex_request" ? 502 : 502);
      const failure = classifyFailure(error, operation, { context: res.headersSent ? "stream" : "http" });
      if (!res.headersSent) sendFailure(res, statusCode, failure);
      else res.end(`${JSON.stringify({ type: "error", message: failure.message, failure })}\n`);
    }
  };
  app.get("/configuration", authorize, route("configuration.load", async (_req, res) => res.json(await readConfiguration(codex))));
  app.post("/codex/device-auth", authorize, route("codex.authenticate", async (_req, res) => {
    res.status(202).json(await deviceAuth.start());
  }));
  app.get("/codex/device-auth/:attemptId", authorize, route("codex.authenticate", async (req, res) => {
    if (!UUID.test(req.params.attemptId)) throw new RelayError(400, "Invalid device authentication attempt ID");
    const attempt = deviceAuth.get(req.params.attemptId);
    if (!attempt) throw new RelayError(404, "Device authentication attempt not found", { code: "state_conflict" });
    res.json(attempt);
  }));
  app.post("/configuration/resolve", authorize, route("configuration.resolve", async (req, res) => {
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
    if (Object.keys(fieldErrors).length) throw new RelayError(400, "Configuration is unsupported", {
      source: "relay",
      code: "configuration_unsupported",
      message: "The Configuration is not supported. Check the highlighted values.",
      action: "change_configuration",
      fieldErrors,
    });
    const resolved = { model: selected.id, reasoning: resolvedReasoning, permissions: resolvedPermissions, fastMode: resolvedFastMode, serviceTier: resolvedFastMode ? "priority" : selected.defaultServiceTier };
    const availabilityRevision = createHash("sha256").update(JSON.stringify(availability)).digest("hex");
    const configurationRevision = createHash("sha256").update(JSON.stringify({ availabilityRevision, resolved })).digest("hex");
    currentAvailabilityRevision = availabilityRevision;
    configurationRevisions.set(configurationRevision, { availabilityRevision, resolved });
    while (configurationRevisions.size > 32) configurationRevisions.delete(configurationRevisions.keys().next().value);
    selectedThreadId = null;
    preTurnSnapshot = { configuration: resolved, observedAt: new Date().toISOString() };
    res.json({ configuration: resolved, configurationRevision });
  }));
  app.get("/status", authorize, route("status.read", async (req, res) => {
    const requestedThreadId = req.query.threadId;
    if (requestedThreadId != null && !UUID.test(requestedThreadId)) throw new RelayError(400, "Invalid Thread ID");
    if (requestedThreadId && requestedThreadId !== selectedThreadId) {
      await readEligible(requestedThreadId);
      throw new RelayError(409, "Thread is not current");
    }
    const errors = [];
    let refreshError = null;
    try {
      const refreshed = await codex.request("account/rateLimits/read", {});
      const observedAt = new Date().toISOString();
      accountSnapshot = { value: mergeObject(accountSnapshot?.value, refreshed), observedAt: mergeObservedAt(accountSnapshot?.observedAt, refreshed, observedAt) };
    } catch (error) {
      refreshError = error;
    }
    const generatedAt = new Date().toISOString();
    const threadSnapshot = requestedThreadId ? threadSnapshots.get(requestedThreadId) : null;
    const projectedRates = accountSnapshot ? rateLimitStatus(accountSnapshot.value, accountSnapshot.observedAt, Boolean(refreshError)) : null;
    const hasConfirmedRate = projectedRates && Object.values(projectedRates).some((window) => Object.values(window).some((field) => Object.hasOwn(field, "value")));
    const hasStatusSnapshot = Boolean(threadSnapshot?.configuration || preTurnSnapshot?.configuration || hasConfirmedRate);
    if (!hasStatusSnapshot) throw refreshError || new RelayError(502, "Status unavailable", { source: "relay", code: "internal_failure" });
    if (refreshError) errors.push(classifyFailure(refreshError, "status.read", { context: "status" }));
    const configuration = requestedThreadId
      ? statusConfiguration(threadSnapshot?.configuration, threadSnapshot?.configurationObservedAt)
      : statusConfiguration(preTurnSnapshot?.configuration, preTurnSnapshot?.observedAt, true);
    const context = requestedThreadId
      ? threadSnapshot?.context ? confirmed(threadSnapshot.context, threadSnapshot.contextObservedAt) : unavailable("not_reported")
      : unavailable("not_started");
    const rates = projectedRates
      ? projectedRates
      : { fiveHour: { remainingPercent: unavailable("upstream_unavailable"), resetsAt: unavailable("upstream_unavailable") }, weekly: { remainingPercent: unavailable("upstream_unavailable"), resetsAt: unavailable("upstream_unavailable") } };
    res.json({ generatedAt, scope: { threadId: requestedThreadId || null }, configuration, context, rateLimits: rates, errors });
  }));
  app.get("/threads", authorize, route("thread.list", async (req, res) => { validateCursor(req.query.cursor); if (req.query.currentThreadId && !UUID.test(req.query.currentThreadId)) throw new RelayError(400, "Invalid Thread ID"); const params = { archived: false, cwd: workdir, limit: 20, sortDirection: "desc", sortKey: "recency_at", sourceKinds: ELIGIBLE_SOURCE_KINDS }; if (req.query.cursor) params.cursor = req.query.cursor; const result = await codex.request("thread/list", params); res.json({ threads: result.data.filter((thread) => eligible(thread, workdir)).map((thread) => publicThread(thread, req.query.currentThreadId)), nextCursor: result.nextCursor || null }); }));
  async function readEligible(threadId) { const result = await codex.request("thread/read", { threadId, includeTurns: false }); if (!eligible(result.thread, workdir)) throw new RelayError(404, "Thread not found", { message: "That Thread is no longer available.", action: "start_new_thread", retryable: false }); return result.thread; }
  const hasActiveTurn = () => [...turns.values()].some((turn) => turn.status === "running");
  app.post("/threads/:id/resume", authorize, route("thread.resume", async (req, res) => { if (!UUID.test(req.params.id)) throw new RelayError(400, "Invalid Thread ID"); if (hasActiveTurn()) throw new RelayError(409, "A Turn is active"); await readEligible(req.params.id); const resumed = await codex.request("thread/resume", { threadId: req.params.id, excludeTurns: true }); if (!eligible(resumed.thread, workdir)) throw new RelayError(404, "Thread not found"); const history = await codex.request("thread/turns/list", { threadId: req.params.id, cursor: null, limit: 20, sortDirection: "desc", itemsView: "full" }); const effective = effectiveConfiguration(resumed); const observedAt = new Date().toISOString(); selectedThreadId = resumed.thread.id; threadSnapshots.clear(); threadSnapshots.set(selectedThreadId, { configuration: effective, configurationObservedAt: { model: observedAt, reasoning: observedAt, permissions: observedAt, fastMode: observedAt } }); res.json({ thread: { id: resumed.thread.id }, effectiveConfiguration: effective, messages: normalizeItems(history.data || [], null), olderCursor: history.nextCursor || null }); }));
  app.get("/threads/:id/history", authorize, route("thread.history", async (req, res) => { if (!UUID.test(req.params.id)) throw new RelayError(400, "Invalid Thread ID"); validateCursor(req.query.cursor, true); await readEligible(req.params.id); const history = await codex.request("thread/turns/list", { threadId: req.params.id, cursor: req.query.cursor, limit: 20, sortDirection: "desc", itemsView: "full" }); res.json({ messages: normalizeItems(history.data || [], req.query.anchorId), olderCursor: history.nextCursor || null }); }));
  app.get("/test", authorize, (_req, res) => {
    const child = run("hostname && pwd"); let stdout = ""; let completed = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", async () => {
      if (completed || res.headersSent) return;
      completed = true;
      sendFailure(res, 502, await diagnosticFailure(new BoundaryError("dependency_missing")));
    });
    child.on("close", async (code, signal) => {
      if (completed || res.headersSent) return;
      completed = true;
      if (code !== 0) return sendFailure(res, 502, await diagnosticFailure(new BoundaryError("upstream_failure", { exitCode: code, signal })));
      res.type("text/plain").send(stdout);
    });
    child.stdin.end();
  });
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
  function failTurn(turn, error, interrupt = false, operation = "turn.stream") {
    if (turn.status !== "running") return;
    setTurnActivity(turn, null, true);
    const failure = error?.version === FAILURE_VERSION
      ? error
      : classifyFailure(error instanceof Error ? error : new BoundaryError("upstream_failure"), operation, { context: "stream" });
    appendTurnEvent(turn, { type: "error", id: `relay:${turn.id}:error`, message: failure.message, failure }, true);
    appendTurnEvent(turn, { type: "relay.turn.finished", status: "failed" }, true);
    if (interrupt && turn.threadId) codex.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.codexTurnId }).catch(() => {});
    finishTurn(turn, "failed");
  }
  function publishTurnEvent(turn, event) {
    if (turn.status !== "running") return;
    if (!appendTurnEvent(turn, event)) {
      const failure = classifyFailure(new RelayError(502, "Turn output exceeded the Relay buffer limit", {
        source: "relay", code: "output_limit_exceeded",
      }), "turn.stream", { context: "stream" });
      failTurn(turn, failure, true);
    }
  }
  function setTurnActivity(turn, category, control = false) {
    if (turn.activity === category) return;
    turn.activity = category;
    if (control) appendTurnEvent(turn, { type: "activity", category }, true);
    else publishTurnEvent(turn, { type: "activity", category });
  }
  function evictCompletedTurns() {
    const completed = [...turns.values()].filter((turn) => turn.status !== "running");
    while (completed.length >= maxRetainedTurns) { const oldest = completed.shift(); clearTimeout(oldest.retentionTimer); turns.delete(oldest.id); }
  }
  async function startOwnedTurn(turn, request) {
    try {
      let opened;
      if (request.threadId) { opened = await codex.request("thread/resume", { threadId: request.threadId, excludeTurns: true }); turn.threadId = request.threadId; }
      else { const params = { cwd: workdir }; if (request.model) params.model = request.model; if (request.reasoning && !request.configurationRevision) params.effort = request.reasoning; if (request.permissions) params.sandbox = request.permissions; opened = await codex.request("thread/start", params); turn.threadId = opened.thread.id; }
      selectedThreadId = turn.threadId;
      const observedAt = new Date().toISOString();
      threadSnapshots.clear();
      threadSnapshots.set(turn.threadId, { configuration: effectiveConfiguration(opened), configurationObservedAt: { model: observedAt, reasoning: observedAt, permissions: observedAt, fastMode: observedAt } });
      publishTurnEvent(turn, { type: "thread.started", thread_id: turn.threadId });
      const params = { threadId: turn.threadId, input: [{ type: "text", text: request.prompt }] }; if (request.threadId && request.model) params.model = request.model; if (request.threadId && request.reasoning) params.effort = request.reasoning;
      if (!request.threadId && request.configurationRevision && request.reasoning) params.effort = request.reasoning;
      if (request.threadId || request.configurationRevision) applyTurnPermissions(params, request.permissions);
      if (request.fastMode) params.serviceTier = "priority";
      turn.codexTurnId = (await codex.request("turn/start", params)).turn.id;
      if (turn.status !== "running") { codex.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.codexTurnId }).catch(() => {}); return; }
      for (const notification of turn.pendingNotifications.splice(0)) turn.processNotification(notification);
    } catch (error) { failTurn(turn, error, false, "turn.create"); }
  }
  app.post("/turn", authorize, route("turn.create", async (req, res) => {
    const { turnId: requestedId, prompt, threadId, model, reasoning, permissions, fastMode = false, configurationRevision } = req.body;
    if (typeof prompt !== "string" || !prompt.trim()) throw new RelayError(400, "prompt is required", { message: "Enter a prompt before starting this Turn." });
    if (threadId && !UUID.test(threadId)) throw new RelayError(400, "threadId is invalid");
    if (requestedId && !UUID.test(requestedId)) throw new RelayError(400, "turnId is invalid");
    const revision = configurationRevision && configurationRevisions.get(configurationRevision);
    if (configurationRevision && (!revision || revision.availabilityRevision !== currentAvailabilityRevision)) {
      throw new RelayError(409, "Selected configuration expired", { source: "relay", code: "configuration_obsolete" });
    }
    if (fastMode && revision?.resolved.serviceTier !== "priority") throw new RelayError(400, "Fast mode is unsupported");
    const boundConfiguration = revision ? revision.resolved : { model, reasoning, permissions, fastMode };
    const id = requestedId || randomUUID(); const request = { prompt, threadId, ...boundConfiguration, configurationRevision }; const requestKey = JSON.stringify(request);
    const existing = turns.get(id); if (existing) { if (existing.requestKey !== requestKey) throw new RelayError(409, "turnId already belongs to a different Turn"); return res.status(202).json({ turnId: id, eventsUrl: `/turn/${id}/events` }); }
    if (hasActiveTurn()) throw new RelayError(409, "A Turn is active"); evictCompletedTurns();
    const turn = { id, requestKey, status: "running", threadId: null, codexTurnId: null, activity: null, events: [], subscribers: new Set(), nextSequence: 1, bufferedBytes: 0, pendingNotifications: [], pendingNotificationBytes: 0 };
    turn.processNotification = ({ method, params }) => {
      if (params?.turnId && params.turnId !== turn.codexTurnId) return;
      if (method === "item/started" && params.item?.type === "agentMessage") setTurnActivity(turn, null);
      else if (method === "item/started") setTurnActivity(turn, activityCategory(params.item?.type));
      if (method === "item/agentMessage/delta" && params.itemId) {
        setTurnActivity(turn, null);
        publishTurnEvent(turn, { type: "item.delta", item: { id: params.itemId, type: "agent_message", delta: String(params.delta || "") } });
      }
      if (method === "item/completed" && params.item?.type === "agentMessage" && params.item.id) {
        setTurnActivity(turn, null);
        publishTurnEvent(turn, { type: "item.completed", item: { id: params.item.id, type: "agent_message", text: itemText(params.item) } });
      }
      if (method === "item/completed" && params.item?.type === "error" && params.item.id) publishTurnEvent(turn, { type: "item.completed", item: { id: params.item.id, type: "error", text: "Codex reported an item error." } });
      if (method === "error") {
        turn.codexFailure = params.error || null;
        if (typeof params.willRetry === "boolean") turn.codexWillRetry = params.willRetry;
        if (params.willRetry === true) {
          const failure = codexTurnFailure(params.error, "turn.stream", {
            retryable: false,
            action: "none",
            message: "Codex is retrying this Turn.",
            diagnostic: { willRetry: true },
          });
          publishTurnEvent(turn, { type: "turn.retrying", willRetry: true, failure });
        }
      }
      if (method === "turn/completed" && params.turn?.id === turn.codexTurnId) {
        const status = ["completed", "failed", "interrupted"].includes(params.turn?.status) ? params.turn.status : "completed";
        setTurnActivity(turn, null, true);
        if (status === "failed") {
          const failure = codexTurnFailure(params.turn?.error || turn.codexFailure, "turn.stream", {
            diagnostic: { terminalStatus: status, ...(typeof turn.codexWillRetry === "boolean" ? { willRetry: turn.codexWillRetry } : {}) },
          });
          appendTurnEvent(turn, { type: "error", id: `relay:${turn.id}:error`, message: failure.message, failure }, true);
        }
        appendTurnEvent(turn, { type: "relay.turn.finished", status }, true);
        finishTurn(turn, status);
      }
    };
    turn.onNotification = (notification) => { if (notification.params?.threadId !== turn.threadId) return; if (!turn.codexTurnId) { turn.pendingNotificationBytes += Buffer.byteLength(JSON.stringify(notification)); if (turn.pendingNotificationBytes > maxBufferedBytes - CONTROL_EVENT_RESERVE_BYTES) failTurn(turn, classifyFailure(new RelayError(502, "Turn output exceeded", { source: "relay", code: "output_limit_exceeded" }), "turn.stream", { context: "stream" })); else turn.pendingNotifications.push(notification); } else turn.processNotification(notification); };
    turn.onDisconnect = (error) => {
      const failure = classifyFailure(error?.kind ? error : new BoundaryError("upstream_disconnected"), "turn.stream", {
        context: "stream", retryable: false, action: "none",
      });
      failTurn(turn, failure);
    }; codex.on?.("notification", turn.onNotification); codex.on?.("disconnect", turn.onDisconnect); turns.set(id, turn); void startOwnedTurn(turn, request);
    res.status(202).json({ turnId: id, eventsUrl: `/turn/${id}/events` });
  }));
  app.get("/turn/:turnId/events", authorize, route("turn.recover", async (req, res) => {
    const rawAfter = req.query.after ?? "0"; if (!/^\d+$/.test(rawAfter)) throw new RelayError(400, "after must be a non-negative event sequence");
    const after = Number(rawAfter); const turn = turns.get(req.params.turnId); if (!turn) throw new RelayError(404, "Turn not found", { code: "retained_turn_unavailable" });
    if (!Number.isSafeInteger(after) || after >= turn.nextSequence) throw new RelayError(400, "after exceeds available events", { code: "replay_position_invalid" });
    if (turn.status === "running" && turn.subscribers.size >= maxSubscribersPerTurn) throw new RelayError(429, "Too many Turn subscribers", { code: "capacity_exceeded" });
    res.type("application/x-ndjson"); res.set("Cache-Control", "no-cache, no-transform"); res.set("X-Accel-Buffering", "no"); res.flushHeaders();
    for (const event of turn.events) if (event.record.sequence > after) res.write(event.encoded);
    if (turn.status !== "running") return res.end(); turn.subscribers.add(res); res.on("close", () => turn.subscribers.delete(res));
  }));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return res.end();
    const failure = classifyFailure(new RelayError(400, "Invalid JSON", {
      source: "relay",
      code: "request_invalid",
      message: "The request body is invalid.",
    }), requestOperation(req));
    return sendFailure(res, 400, failure);
  });
  return app;
}

const app = createRelay({ logger: console });
if (require.main === module) { const server = app.listen(process.env.PORT || 3000, "0.0.0.0"); const close = () => { app.locals.appServer.close?.(); server.close(); }; process.once("SIGTERM", close); process.once("SIGINT", close); }
module.exports = app; module.exports.createRelay = createRelay; module.exports.AppServerConnection = AppServerConnection;
