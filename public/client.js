const shell = document.querySelector("#app-shell");
const newThread = document.querySelector("#new");
const resumeThread = document.querySelector("#resume");
const resumePicker = document.querySelector("#resume-picker");
const resumeHeading = document.querySelector("#resume-heading");
const cancelResume = document.querySelector("#cancel-resume");
const resumeStatus = document.querySelector("#resume-status");
const resumeError = document.querySelector("#resume-error");
const resumeResults = document.querySelector("#resume-results");
const loadMoreThreads = document.querySelector("#load-more-threads");
const showStatus = document.querySelector("#show-status");
const configure = document.querySelector("#configure");
const settingsTrigger = document.querySelector("#settings-trigger");
const settings = document.querySelector("#settings");
const settingsHeading = document.querySelector("#settings-heading");
const settingsError = document.querySelector("#settings-error");
const settingsProgress = document.querySelector("#settings-progress");
const cancelSettings = document.querySelector("#cancel-settings");
const applySettings = document.querySelector("#apply-settings");
const configuration = document.querySelector("#configuration");
const configurationHeading = document.querySelector("#configuration-heading");
const configurationError = document.querySelector("#configuration-error");
const configurationProgress = document.querySelector("#configuration-progress");
const cancelConfiguration = document.querySelector("#cancel-configuration");
const applyConfiguration = document.querySelector("#apply-configuration");
const token = document.querySelector("#token");
const tokenError = document.querySelector("#token-error");
const model = document.querySelector("#model");
const modelHint = document.querySelector("#model-hint");
const modelError = document.querySelector("#model-error");
const reasoning = document.querySelector("#reasoning");
const reasoningHint = document.querySelector("#reasoning-hint");
const reasoningError = document.querySelector("#reasoning-error");
const permissions = document.querySelector("#permissions");
const permissionsError = document.querySelector("#permissions-error");
const fastMode = document.querySelector("#fast-mode");
const fastModeHint = document.querySelector("#fast-mode-hint");
const fastModeError = document.querySelector("#fast-mode-error");
const preTurnAnnouncement = document.querySelector("#pre-turn-configuration");
const messages = document.querySelector("#messages");
const loadOlderHistory = document.querySelector("#load-older-history");
const historyError = document.querySelector("#history-error");
const status = document.querySelector("#status");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");

const configurationFields = new Map([
  ["model", { control: model, error: modelError }],
  ["reasoning", { control: reasoning, error: reasoningError }],
  ["permissions", { control: permissions, error: permissionsError }],
  ["fastMode", { control: fastMode, error: fastModeError }],
]);

const emptyConfiguration = { token: "", model: "", reasoning: "", permissions: "", fastMode: null };
let state = readJson("relay", { threadId: null, messages: [], activeTurn: null });
state.activeTurn ||= null;
let appliedConfiguration = readAppliedConfiguration();
let configurationDraft = { ...(appliedConfiguration || emptyConfiguration) };
let tokenDraft = appliedConfiguration?.token || "";
let configurationCatalog = null;
let ready = false;
let checking = false;
let activeTurn = Boolean(state.activeTurn);
let hydrating = false;
let resumeCursor = null;
let retryThreadPage = false;
let olderCursor = null;
let persistedThreadConfiguration = Boolean(state.threadId);
let followThread = true;
let followFrame = 0;
let programmaticFollowPending = false;
let userScrollIntent = false;
let readingAnchor = null;
let lastAnnouncedActivity = null;
let lastStatusSnapshot = null;
let threadRecoveryLocked = false;
const announcedFailureIds = new Set();

const FAILURE_VERSION = window.FailureCatalog.version;
const FAILURE_CATALOG = window.FailureCatalog.sources;
const FAILURE_ACTIONS = new Set(window.FailureCatalog.actions);
const SOURCE_LABELS = window.FailureCatalog.sourceLabels;
const RECOVERY_TARGETS = window.FailureCatalog.recoveryTargets;

function localFailure(source, code, operation, message, action = "none", retryable = false) {
  return { version: FAILURE_VERSION, source, code, operation, retryable, message, action };
}

function malformedFailure(operation) {
  return localFailure("relay", "malformed_response", operation, "Relay returned an invalid response. Retry the operation.", "retry", true);
}

function normalizeFailure(candidate, operation) {
  if (!candidate || candidate.version !== FAILURE_VERSION || typeof candidate.source !== "string" || typeof candidate.code !== "string"
      || typeof candidate.operation !== "string" || typeof candidate.retryable !== "boolean" || typeof candidate.message !== "string"
      || !FAILURE_ACTIONS.has(candidate.action)) return malformedFailure(operation);
  const known = Boolean(FAILURE_CATALOG[candidate.source]?.[candidate.code]);
  return {
    version: FAILURE_VERSION,
    source: known ? candidate.source : "unknown",
    code: candidate.code,
    operation: candidate.operation,
    retryable: candidate.retryable,
    message: known ? candidate.message : `The ${operation.replace(".", " ")} operation could not be completed.`,
    action: candidate.action,
    ...(typeof candidate.diagnosticId === "string" && /^[0-9a-f-]{36}$/i.test(candidate.diagnosticId) ? { diagnosticId: candidate.diagnosticId } : {}),
    ...(candidate.fieldErrors && typeof candidate.fieldErrors === "object" && !Array.isArray(candidate.fieldErrors) ? { fieldErrors: candidate.fieldErrors } : {}),
  };
}

function failureText(failure) {
  return `${SOURCE_LABELS[failure.source] || "Unknown"} · ${failure.message}`;
}

function actionLabel(action) {
  return ({
    retry: "Retry", reconnect: "Reconnect", open_settings: "Open Settings", change_configuration: "Change Configuration",
    start_codespace: "Start Codespace", authenticate_github: "Authenticate GitHub", authenticate_codex: "Authenticate Codex",
    start_new_thread: "New Thread",
  })[action] || "";
}

function validDeviceAuthStart(value) {
  if (!value || value.status !== "pending" || typeof value.attemptId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.attemptId)
      || typeof value.verificationUrl !== "string" || typeof value.userCode !== "string" || !/^[A-Z0-9-]{1,32}$/.test(value.userCode)) return false;
  try { const url = new URL(value.verificationUrl); return url.protocol === "https:" && url.hostname === "auth.openai.com" && !url.username && !url.password; }
  catch { return false; }
}

async function startCodexAuthentication(container) {
  const trigger = container.querySelector(".failure-action");
  if (trigger) trigger.disabled = true;
  try {
    const response = await fetch("/codex/device-auth", { method: "POST", headers: authorization() });
    if (!response.ok) throw await responseError(response, "codex.authenticate");
    const attempt = await response.json().catch(() => { throw failureError(malformedFailure("codex.authenticate")); });
    if (!validDeviceAuthStart(attempt)) throw failureError(malformedFailure("codex.authenticate"));
    const card = document.createElement("div"); card.className = "device-auth-card";
    const progress = document.createElement("p"); progress.className = "device-auth-progress"; progress.setAttribute("role", "status"); progress.setAttribute("aria-live", "polite"); progress.textContent = "Codex authentication pending.";
    const link = document.createElement("a"); link.href = attempt.verificationUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open login page";
    const code = document.createElement("code"); code.textContent = attempt.userCode;
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy code";
    copy.addEventListener("click", async () => { await navigator.clipboard.writeText(attempt.userCode); copy.textContent = "Code copied"; });
    card.append(progress, link, code, copy); container.append(card);
    while (card.isConnected) {
      await wait(1000);
      const polled = await fetch(`/codex/device-auth/${attempt.attemptId}`, { headers: authorization() });
      if (!polled.ok) throw await responseError(polled, "codex.authenticate");
      const result = await polled.json().catch(() => { throw failureError(malformedFailure("codex.authenticate")); });
      if (!result || result.attemptId !== attempt.attemptId || !["pending", "succeeded", "expired", "failed"].includes(result.status)) throw failureError(malformedFailure("codex.authenticate"));
      if (result.status === "pending") continue;
      progress.textContent = result.status === "succeeded" ? "Codex authentication succeeded." : result.status === "expired" ? "Codex authentication expired." : "Codex authentication failed.";
      if (result.status === "failed") {
        const failure = normalizeFailure(result.failure, "codex.authenticate");
        const details = document.createElement("div"); details.className = "device-auth-failure";
        renderFailure(details, failure, { retry: () => startCodexAuthentication(container), announce: false });
        card.append(details);
      }
      if (result.status === "succeeded" && state.activeTurn?.awaitingRecovery) void followActiveTurn();
      return;
    }
  } catch (error) {
    renderFailure(container, error.failure || connectionFailure("codex.authenticate"), { retry: () => startCodexAuthentication(container) });
  } finally { if (trigger?.isConnected) trigger.disabled = false; }
}

function failureAction(failure, retry, container) {
  if (["retry", "reconnect"].includes(failure.action)) return retry;
  if (failure.action === "open_settings") return () => setSettingsOpen(true, settingsHeading);
  if (failure.action === "change_configuration") return openConfiguration;
  if (failure.action === "start_new_thread") return () => newThread.click();
  if (failure.action === "authenticate_codex") return () => startCodexAuthentication(container);
  if (RECOVERY_TARGETS[failure.action]) return () => window.open(RECOVERY_TARGETS[failure.action], "_blank", "noopener,noreferrer");
  return null;
}

function renderFailure(container, failure, { retry = null, announce = true } = {}) {
  const normalized = normalizeFailure(failure, failure?.operation || "unknown");
  container.replaceChildren();
  const message = document.createElement("span");
  message.className = "failure-message";
  message.textContent = failureText(normalized);
  container.append(message);
  const action = failureAction(normalized, retry, container);
  if (action && actionLabel(normalized.action)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "failure-action";
    button.textContent = actionLabel(normalized.action);
    button.addEventListener("click", action);
    container.append(button);
  }
  if (normalized.diagnosticId) {
    const details = document.createElement("details");
    const summary = document.createElement("summary"); summary.textContent = "Details";
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "failure-copy"; copy.textContent = `Copy diagnostic ID ${normalized.diagnosticId}`;
    copy.addEventListener("click", async () => { await navigator.clipboard.writeText(normalized.diagnosticId); copy.textContent = "Diagnostic ID copied"; });
    details.append(summary, copy); container.append(details);
  }
  const identity = normalized.diagnosticId || `${normalized.operation}:${normalized.source}:${normalized.code}`;
  if (announce && !announcedFailureIds.has(identity)) {
    container.setAttribute("role", "alert");
    announcedFailureIds.add(identity);
  } else container.removeAttribute("role");
  return normalized;
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function readAppliedConfiguration() {
  const stored = readJson("relayConfiguration", null);
  if (stored && typeof stored.token === "string") {
    return {
      token: stored.token,
      model: typeof stored.model === "string" ? stored.model : "",
      reasoning: typeof stored.reasoning === "string" ? stored.reasoning : "",
      permissions: typeof stored.permissions === "string" ? stored.permissions : "",
      fastMode: typeof stored.fastMode === "boolean" ? stored.fastMode : null,
      ...(typeof stored.configurationRevision === "string" ? { configurationRevision: stored.configurationRevision } : {}),
    };
  }

  const legacyToken = localStorage.getItem("token");
  if (!legacyToken) return null;
  const migrated = {
    token: legacyToken,
    model: localStorage.getItem("model") || "",
    reasoning: localStorage.getItem("reasoning") || "",
    permissions: localStorage.getItem("permissions") || "",
    fastMode: null,
  };
  localStorage.setItem("relayConfiguration", JSON.stringify(migrated));
  return migrated;
}

function saveState() {
  const persisted = state.activeTurn ? state : {
    ...state,
    messages: state.messages.filter((message) => (!message.interrupted || message.retainInterrupted) && !message.provisional),
  };
  localStorage.setItem("relay", JSON.stringify(persisted));
}
function saveAppliedConfiguration() {
  localStorage.setItem("relayConfiguration", JSON.stringify(appliedConfiguration));
}

function setStatus(message) { status.textContent = message; }

function showStatusFailure(failure, retry = null, allowNew = false) {
  status.replaceChildren();
  const feedback = document.createElement("div");
  feedback.className = "status-details failure-feedback";
  renderFailure(feedback, failure, { retry });
  status.append(feedback);
  if (allowNew && failure.action !== "start_new_thread") {
    const button = document.createElement("button");
    button.type = "button"; button.className = "failure-action"; button.textContent = "New Thread";
    button.addEventListener("click", () => newThread.click());
    status.append(button);
  }
}

function statusField(field, format = (value) => String(value)) {
  return field && Object.hasOwn(field, "value") ? format(field.value) : "Unavailable";
}

function readablePermissions(value) {
  if (typeof value === "string") return configurationName(configurationCatalog?.permissions, value);
  if (!value || typeof value !== "object") return "Unavailable";
  const sandbox = typeof value.sandboxPolicy === "string" ? value.sandboxPolicy : value.sandboxPolicy?.type;
  return [sandbox?.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(), value.approvalPolicy, value.profile].filter(Boolean).join(" · ") || "Unavailable";
}

function localReset(value) {
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  if (Number.isNaN(date.valueOf())) return { text: "Unavailable", label: "Unavailable", dateTime: "" };
  const text = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" }).formatToParts(date).find(({ type }) => type === "timeZoneName")?.value || "local time";
  return { text, label: `${text}, ${zone}`, dateTime: date.toISOString() };
}

function renderStatusSnapshot(snapshot, forceStale = false) {
  status.replaceChildren();
  const lines = document.createElement("div");
  lines.className = "status-details";
  const add = (label, value) => { const line = document.createElement("div"); line.textContent = `${label}: ${value}`; lines.append(line); };
  add("Model", statusField(snapshot.configuration?.model, (value) => configurationName(configurationCatalog?.models, value)));
  add("Reasoning", statusField(snapshot.configuration?.reasoning));
  add("Permissions", statusField(snapshot.configuration?.permissions, readablePermissions));
  add("Fast mode", statusField(snapshot.configuration?.fastMode, (value) => value?.enabled === true ? "On" : value?.enabled === false ? "Off" : `Unavailable${value?.serviceTier ? ` (${value.serviceTier})` : ""}`));
  add("Context usage", snapshot.context?.reason === "not_started" ? "Not started" : statusField(snapshot.context, (value) => `${Number(value.usedTokens).toLocaleString()} / ${Number(value.windowTokens).toLocaleString()} (${Number(value.percentage).toLocaleString(undefined, { maximumFractionDigits: 1 })}%)`));
  for (const [key, label] of [["fiveHour", "5-hour"], ["weekly", "Weekly"]]) {
    const window = snapshot.rateLimits?.[key] || {};
    const line = document.createElement("div");
    const remaining = statusField(window.remainingPercent, (value) => `${value}%`);
    line.append(`${label}: ${remaining} remaining · Resets `);
    if (window.resetsAt && Object.hasOwn(window.resetsAt, "value")) {
      const reset = localReset(window.resetsAt.value); const time = document.createElement("time"); time.dateTime = reset.dateTime; time.setAttribute("aria-label", reset.label); time.textContent = reset.text; line.append(time);
    } else line.append("Unavailable");
    lines.append(line);
  }
  const fields = [snapshot.context, ...Object.values(snapshot.configuration || {}), ...Object.values(snapshot.rateLimits || {}).flatMap((window) => Object.values(window || {}))];
  const stale = forceStale || fields.some((field) => field?.stale) || Boolean(snapshot.errors?.length);
  if (stale) {
    const observed = fields.filter((field) => field?.observedAt).map((field) => new Date(field.observedAt).valueOf()).filter(Number.isFinite);
    const updated = observed.length ? new Date(Math.max(...observed)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "unknown";
    add("Last updated", updated);
    const warning = document.createElement("div"); warning.className = "status-warning";
    if (snapshot.errors?.[0]) {
      const failure = normalizeFailure(snapshot.errors[0], "status.read");
      renderFailure(warning, { ...failure, message: `May be outdated. ${failure.message}` }, { retry: refreshStatus, announce: false });
    } else warning.textContent = "May be outdated · Status refresh failed.";
    lines.append(warning);
  }
  status.append(lines);
  if (stale && !snapshot.errors?.length) {
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "status-retry"; retry.textContent = "Retry"; retry.setAttribute("aria-label", "Retry status"); retry.addEventListener("click", refreshStatus); status.append(retry);
  }
}

async function refreshStatus() {
  setStatus("Loading status…");
  const expectedThreadId = state.threadId || null;
  try {
    const query = state.threadId ? `?threadId=${encodeURIComponent(state.threadId)}` : "";
    const response = await fetch(`/status${query}`, { headers: authorization() });
    if (!response.ok) throw await responseError(response, "status.read");
    const snapshot = await response.json().catch(() => { throw failureError(malformedFailure("status.read")); });
    if (snapshot?.scope?.threadId !== expectedThreadId || !snapshot.configuration || !snapshot.rateLimits) throw failureError(malformedFailure("status.read"));
    snapshot.errors = (snapshot.errors || []).map((failure) => normalizeFailure(failure, "status.read"));
    lastStatusSnapshot = snapshot;
    renderStatusSnapshot(snapshot);
  } catch (error) {
    if (lastStatusSnapshot?.scope?.threadId === expectedThreadId) renderStatusSnapshot(lastStatusSnapshot, true);
    else renderStatusSnapshot({
      scope: { threadId: expectedThreadId },
      configuration: { model: {}, reasoning: {}, permissions: {}, fastMode: {} },
      context: expectedThreadId ? {} : { reason: "not_started" },
      rateLimits: { fiveHour: { remainingPercent: {}, resetsAt: {} }, weekly: { remainingPercent: {}, resetsAt: {} } },
      errors: [error.failure || connectionFailure("status.read")],
    }, true);
  }
}

function configurationName(collection, id) {
  return collection?.find((item) => item.id === id)?.name || id;
}

function renderPreTurnConfiguration() {
  const resolved = state.localNew && state.preTurnConfiguration?.configuration;
  preTurnAnnouncement.hidden = !resolved;
  if (!resolved) {
    preTurnAnnouncement.textContent = "";
    return;
  }
  const announcement = [
    `Model: ${configurationName(configurationCatalog?.models, resolved.model)}`,
    `Reasoning: ${resolved.reasoning}`,
    `Permissions: ${configurationName(configurationCatalog?.permissions, resolved.permissions)}`,
    `Fast mode: ${resolved.fastMode ? "On" : "Off"}`,
  ].join(" · ");
  if (preTurnAnnouncement.textContent !== announcement) preTurnAnnouncement.textContent = announcement;
}

function resolutionRequest(candidate) {
  return {
    model: candidate.model || "default",
    reasoning: candidate.reasoning || "default",
    permissions: candidate.permissions || "default",
    fastMode: candidate.fastMode == null ? "default" : candidate.fastMode,
  };
}

async function resolvePreTurnConfiguration() {
  let response;
  try {
    response = await fetch("/configuration/resolve", {
      method: "POST",
      headers: { ...authorization(), "Content-Type": "application/json" },
      body: JSON.stringify(resolutionRequest(appliedConfiguration)),
    });
  } catch { throw failureError(connectionFailure("configuration.resolve")); }
  if (!response.ok) throw await responseError(response, "configuration.resolve");
  const resolved = await response.json().catch(() => { throw failureError(malformedFailure("configuration.resolve")); });
  if (!resolved?.configuration || typeof resolved.configurationRevision !== "string") throw failureError(malformedFailure("configuration.resolve"));
  state.preTurnConfiguration = resolved;
  saveState();
  renderPreTurnConfiguration();
  return resolved;
}

function setConfigurationOpen(open, focusTarget = null) {
  configuration.hidden = !open;
  shell.classList.toggle("configuration-open", open);
  configure.hidden = open && !appliedConfiguration;
  configure.textContent = open ? "Cancel" : "Configure";
  configure.setAttribute("aria-expanded", String(open));
  configure.setAttribute("aria-controls", "configuration");
  if (open) renderConfigurationDraft();
  setThreadControls();
  if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
}

function setSettingsOpen(open, focusTarget = null) {
  settings.hidden = !open;
  shell.classList.toggle("settings-open", open);
  settingsTrigger.setAttribute("aria-expanded", String(open));
  settingsTrigger.setAttribute("aria-controls", "settings");
  if (open) {
    setConfigurationOpen(false);
    setResumeOpen(false, false);
    tokenDraft = appliedConfiguration?.token || "";
    token.value = tokenDraft;
    clearSettingsError();
  }
  setThreadControls();
  if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
}

function setThreadControls() {
  const locked = checking || activeTurn || hydrating;
  const focusedView = !settings.hidden || !configuration.hidden || !resumePicker.hidden;
  newThread.disabled = locked || !ready || focusedView;
  resumeThread.disabled = locked || threadRecoveryLocked || !ready || focusedView;
  showStatus.disabled = checking || hydrating || !ready;
  configure.disabled = locked || threadRecoveryLocked || !ready || !settings.hidden || !resumePicker.hidden;
  settingsTrigger.disabled = activeTurn || checking || hydrating;
  send.disabled = activeTurn || hydrating || threadRecoveryLocked || !ready || focusedView;
  prompt.disabled = hydrating || threadRecoveryLocked || !ready || focusedView;
}

function authorization() { return { "Authorization": `Bearer ${appliedConfiguration.token}` }; }
function allowedPermissions() { return ["", ...(configurationCatalog?.permissions || []).map(({ id }) => id)]; }

function setResumeOpen(open, restoreFocus = true) {
  resumePicker.hidden = !open;
  shell.classList.toggle("resume-open", open);
  setThreadControls();
  if (open) requestAnimationFrame(() => resumeHeading.focus());
  else if (restoreFocus) requestAnimationFrame(() => resumeThread.focus());
}

function displayResumeError(failure, retry = null) {
  const normalized = typeof failure === "string"
    ? localFailure("unknown", "upstream_failure", "thread.list", failure, "retry", true)
    : failure;
  renderFailure(resumeError, normalized, { retry });
  resumeError.hidden = false;
  requestAnimationFrame(() => resumeError.focus());
}

function canonicalResumeState(result) {
  if (!result?.thread || typeof result.thread.id !== "string" || !Array.isArray(result.messages) || !result.effectiveConfiguration) {
    throw new Error("Thread could not be resumed. Try again.");
  }
  return {
    threadId: result.thread.id,
    messages: result.messages,
    effectiveConfiguration: result.effectiveConfiguration,
  };
}

function renderThreadRows(rows, append = false) {
  const nodes = rows.map((thread) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "resume-row"; button.dataset.threadId = thread.id;
    button.disabled = thread.current; button.setAttribute("aria-label", `${thread.title}${thread.current ? ", Current" : ""}; ${thread.preview}; ${thread.model}`);
    const title = document.createElement("span"); title.className = "resume-title"; title.textContent = `${thread.title}${thread.current ? " · Current" : ""}`;
    const preview = document.createElement("span"); preview.className = "resume-preview"; preview.textContent = thread.preview;
    const meta = document.createElement("span"); meta.className = "resume-meta"; meta.textContent = `${new Date(thread.lastActive).toLocaleString()} · ${thread.model}`;
    button.append(title, preview, meta); button.addEventListener("click", () => selectThread(thread.id, button)); return button;
  });
  if (append) resumeResults.append(...nodes); else resumeResults.replaceChildren(...nodes);
}

async function loadThreads(append = false) {
  retryThreadPage = append;
  hydrating = true; setThreadControls(); resumeStatus.textContent = append ? "Loading more Threads…" : "Loading Threads…"; resumeError.hidden = true;
  try {
    const query = new URLSearchParams(); if (append && resumeCursor) query.set("cursor", resumeCursor); if (state.threadId) query.set("currentThreadId", state.threadId);
    const response = await fetch(`/threads?${query}`, { headers: authorization() }); if (!response.ok) throw await responseError(response, "thread.list");
    const result = await response.json().catch(() => { throw failureError(malformedFailure("thread.list")); });
    if (!Array.isArray(result?.threads)) throw failureError(malformedFailure("thread.list"));
    renderThreadRows(result.threads, append); resumeCursor = result.nextCursor;
    resumeStatus.textContent = !append && !result.threads.length ? "No Threads to resume" : ""; loadMoreThreads.textContent = "Load more"; loadMoreThreads.dataset.retry = ""; loadMoreThreads.hidden = !resumeCursor;
  } catch (error) { displayResumeError(error.failure || connectionFailure("thread.list"), () => loadThreads(append)); resumeStatus.textContent = ""; loadMoreThreads.textContent = "Retry"; loadMoreThreads.dataset.retry = "true"; loadMoreThreads.hidden = false; }
  finally { hydrating = false; setThreadControls(); }
}

async function selectThread(id, row) {
  hydrating = true; setThreadControls(); for (const button of resumeResults.querySelectorAll("button")) button.disabled = true; resumeStatus.textContent = "Loading Thread…"; resumeError.hidden = true;
  try {
    const response = await fetch(`/threads/${id}/resume`, { method: "POST", headers: authorization() }); if (!response.ok) throw await responseError(response, "thread.resume");
    const result = await response.json().catch(() => { throw failureError(malformedFailure("thread.resume")); }); const resumedState = canonicalResumeState(result); state = resumedState; olderCursor = result.olderCursor; persistedThreadConfiguration = true; threadRecoveryLocked = false; saveState(); followThread = true; renderPreTurnConfiguration(); drawMessages({ forceFollow: true });
    setResumeOpen(false); requestAnimationFrame(() => prompt.focus()); setStatus(resumedState.effectiveConfiguration.model ? `Resumed · ${resumedState.effectiveConfiguration.model}` : "Resumed");
  } catch (error) { const failure = error.failure || connectionFailure("thread.resume"); displayResumeError(failure, () => selectThread(id, row)); if (failure.action === "start_new_thread") row.remove(); }
  finally { hydrating = false; setThreadControls(); for (const button of resumeResults.querySelectorAll("button")) button.disabled = button.textContent.includes("Current"); }
}

resumeThread.addEventListener("click", () => { if (!ready || checking || activeTurn || hydrating) return; setResumeOpen(true); loadThreads(); });
cancelResume.addEventListener("click", () => { if (!hydrating) setResumeOpen(false); });
loadMoreThreads.addEventListener("click", () => loadThreads(loadMoreThreads.dataset.retry === "true" ? retryThreadPage : true));

function setConfigurationBusy(busy) {
  checking = busy;
  for (const control of [permissions, fastMode, cancelConfiguration, applyConfiguration]) control.disabled = busy;
  model.disabled = busy || !configurationCatalog;
  reasoning.disabled = busy || !selectedCapabilityModel();
  cancelConfiguration.hidden = !appliedConfiguration;
  configurationProgress.hidden = !busy;
  configurationProgress.textContent = busy ? "Checking configuration…" : "";
  setThreadControls();
}

function setSettingsBusy(busy) {
  checking = busy;
  token.disabled = busy;
  cancelSettings.disabled = busy;
  applySettings.disabled = busy;
  cancelSettings.hidden = !ready;
  settingsProgress.hidden = !busy;
  settingsProgress.textContent = busy ? "Checking Settings…" : "";
  setThreadControls();
}

function clearSettingsError() {
  settingsError.hidden = true;
  settingsError.textContent = "";
  tokenError.textContent = "";
  token.removeAttribute("aria-invalid");
}

function showSettingsError(failure, retry = null) {
  const normalized = typeof failure === "string"
    ? localFailure("unknown", "upstream_failure", "settings.check", failure, "retry", true)
    : failure;
  renderFailure(settingsError, normalized, { retry });
  settingsError.hidden = false;
  tokenError.textContent = normalized.message;
  token.setAttribute("aria-invalid", "true");
  requestAnimationFrame(() => settingsError.focus());
}

function clearConfigurationError() {
  configurationError.hidden = true;
  configurationError.textContent = "";
  for (const { control, error } of configurationFields.values()) {
    error.textContent = "";
    control.removeAttribute("aria-invalid");
  }
}

function showConfigurationError(failure, field = null, retry = null) {
  const normalized = typeof failure === "string"
    ? localFailure("unknown", "upstream_failure", "configuration.resolve", failure, "retry", true)
    : failure;
  renderFailure(configurationError, normalized, { retry });
  configurationError.hidden = false;
  const fieldError = [...configurationFields.values()].find(({ control }) => control === field);
  if (fieldError) {
    if (!fieldError.error.textContent) fieldError.error.textContent = normalized.message;
    field.setAttribute("aria-invalid", "true");
  }
  requestAnimationFrame(() => (field || configurationError).focus());
}

function renderConfigurationDraft() {
  const permissionChoices = [option("Default", ""), ...(configurationCatalog?.permissions || []).map((item) => option(item.name, item.id))];
  permissions.replaceChildren(...permissionChoices);
  permissions.value = allowedPermissions().includes(configurationDraft.permissions)
    ? configurationDraft.permissions
    : "";
  renderModelOptions();
  clearConfigurationError();
  cancelConfiguration.hidden = !appliedConfiguration;
}

function option(label, value) { return new Option(label, value); }

function renderModelOptions() {
  const choices = [option("Default", "")];
  if (configurationCatalog) {
    for (const item of configurationCatalog.models) choices.push(option(item.name, item.id));
    if (configurationDraft.model && !configurationCatalog.models.some((item) => item.id === configurationDraft.model)) {
      choices.push(option(`${configurationDraft.model} (unavailable)`, configurationDraft.model));
    }
  } else if (configurationDraft.model) {
    choices.push(option(configurationDraft.model, configurationDraft.model));
  }
  model.replaceChildren(...choices);
  model.value = configurationDraft.model;
  model.disabled = checking || !configurationCatalog;
  modelHint.hidden = Boolean(configurationCatalog);
  renderReasoningOptions();
}

function renderReasoningOptions() {
  const selected = selectedCapabilityModel();
  const choices = [option("Default", "")];
  if (selected) {
    for (const effort of selected.reasoning) choices.push(option(effort, effort));
    if (configurationDraft.reasoning && !selected.reasoning.includes(configurationDraft.reasoning)) {
      choices.push(option(`${configurationDraft.reasoning} (unsupported)`, configurationDraft.reasoning));
    }
  } else if (configurationDraft.reasoning) {
    choices.push(option(configurationDraft.reasoning, configurationDraft.reasoning));
  }
  reasoning.replaceChildren(...choices);
  reasoning.value = configurationDraft.reasoning;
  reasoning.disabled = checking || !configurationCatalog || !selected;
  reasoningHint.hidden = Boolean(selected);
  reasoningHint.textContent = configurationCatalog
    ? "Reasoning choices follow the selected model."
    : "Apply an API token to load reasoning efforts.";
  renderFastMode();
}

function selectedCapabilityModel() {
  const selectedId = configurationDraft.model || configurationCatalog?.defaults?.model;
  return configurationCatalog?.models.find((item) => item.id === selectedId);
}

function renderFastMode() {
  const supported = Boolean(selectedCapabilityModel()?.serviceTiers.some(({ id }) => id === "priority"));
  if (!supported && configurationDraft.fastMode === true) configurationDraft.fastMode = null;
  fastMode.value = configurationDraft.fastMode == null ? "" : configurationDraft.fastMode ? "on" : "off";
  fastMode.disabled = checking || !supported;
  fastModeHint.textContent = supported ? "Uses the model's advertised Fast service tier." : "Fast mode is unavailable for this model.";
}

function normalizeConfiguration(candidate, modelInfo) {
  const normalized = { ...candidate };
  const selected = modelInfo.models.find((item) => item.id === normalized.model);
  if (normalized.model && !selected) {
    normalized.model = "";
    normalized.reasoning = "";
    normalized.fastMode = null;
    return normalized;
  }
  const effectiveSelected = selectedCapabilityFor(modelInfo, normalized);
  if (normalized.reasoning && !effectiveSelected?.reasoning.includes(normalized.reasoning)) {
    normalized.reasoning = "";
  }
  if (normalized.fastMode === true && !selectedCapabilityFor(modelInfo, normalized)?.serviceTiers.some(({ id }) => id === "priority")) normalized.fastMode = null;
  return normalized;
}

function selectedCapabilityFor(modelInfo, candidate) {
  return modelInfo.models.find((item) => item.id === (candidate.model || modelInfo.defaults?.model));
}

function validateDraft(candidate, modelInfo) {
  const selected = selectedCapabilityFor(modelInfo, candidate);
  if (candidate.model && !selected) {
    return { message: "The selected model is no longer available.", field: model };
  }
  if (candidate.reasoning && (!selected || !selected.reasoning.includes(candidate.reasoning))) {
    return { message: "The selected reasoning effort is not supported by this model.", field: reasoning };
  }
  if (!allowedPermissions().includes(candidate.permissions)) {
    return { message: "The selected permissions are invalid.", field: permissions };
  }
  return null;
}

async function fetchConfigurationCatalog(configurationToken) {
  let response;
  try {
    response = await fetch("/configuration", { headers: { "Authorization": `Bearer ${configurationToken}` } });
  } catch {
    throw failureError(connectionFailure("settings.check"));
  }

  if (!response.ok) throw await responseError(response, "settings.check");

  try {
    const result = await response.json();
    if (!Array.isArray(result.models)) throw new Error();
    return result;
  } catch {
    throw failureError(malformedFailure("settings.check"));
  }
}

async function checkPersistedConfiguration() {
  if (!appliedConfiguration) {
    ready = false;
    setSettingsOpen(true, settingsHeading);
    setSettingsBusy(false);
    setThreadControls();
    return;
  }

  setStatus("Checking Settings…");
  setSettingsBusy(true);
  try {
    configurationCatalog = await fetchConfigurationCatalog(appliedConfiguration.token);
    const normalized = normalizeConfiguration(appliedConfiguration, configurationCatalog);
    const changed = JSON.stringify(normalized) !== JSON.stringify(appliedConfiguration);
    appliedConfiguration = normalized;
    configurationDraft = { ...normalized };
    renderPreTurnConfiguration();
    if (changed) {
      saveAppliedConfiguration();
      setStatus("Configuration checked; unavailable model choices were reset to Default.");
    } else {
      setStatus("");
    }
    ready = true;
    setSettingsOpen(false);
    if (state.activeTurn) void followActiveTurn();
    else await revalidateCachedThread();
  } catch (error) {
    ready = false;
    tokenDraft = appliedConfiguration.token;
    setSettingsOpen(true);
    showSettingsError(error.failure || connectionFailure("settings.check"), () => checkPersistedConfiguration());
    setStatus("Settings need attention.");
  } finally {
    setSettingsBusy(false);
    setThreadControls();
  }
}

async function revalidateCachedThread() {
  if (!state.threadId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(state.threadId)) return;
  hydrating = true; setThreadControls(); setStatus("Restoring Thread…");
  try {
    const response = await fetch(`/threads/${state.threadId}/resume`, { method: "POST", headers: authorization() });
    if (!response.ok) throw await responseError(response, "thread.revalidate");
    const result = await response.json().catch(() => { throw failureError(malformedFailure("thread.revalidate")); });
    state = canonicalResumeState(result); olderCursor = result.olderCursor; persistedThreadConfiguration = true; threadRecoveryLocked = false; saveState(); renderPreTurnConfiguration(); drawMessages({ forceFollow: true }); setStatus("");
  } catch (error) {
    const failure = error.failure || connectionFailure("thread.revalidate");
    if (failure.action === "start_new_thread") {
      state = { threadId: null, messages: [], localNew: true, preTurnConfiguration: null };
      olderCursor = null;
      persistedThreadConfiguration = false;
      threadRecoveryLocked = false;
      saveState();
      drawMessages({ forceFollow: true });
      setStatus(`${failureText(failure)} Returned to a new view.`);
      try {
        await resolvePreTurnConfiguration();
      } catch {
        // The composer remains available; the first Turn will retry resolution.
      }
    } else {
      threadRecoveryLocked = true;
      showStatusFailure(failure, revalidateCachedThread, true);
    }
  } finally { hydrating = false; setThreadControls(); }
}

function openConfiguration() {
  if (checking || activeTurn || !ready) return;
  setSettingsOpen(false);
  setResumeOpen(false, false);
  configurationDraft = { ...(appliedConfiguration || emptyConfiguration) };
  setConfigurationOpen(true, configurationHeading);
}

function closeConfiguration() {
  if (!appliedConfiguration || checking) return;
  configurationDraft = { ...appliedConfiguration };
  setConfigurationOpen(false, configure);
}

configure.addEventListener("click", () => {
  if (configuration.hidden) openConfiguration();
  else closeConfiguration();
});
cancelConfiguration.addEventListener("click", closeConfiguration);

settingsTrigger.addEventListener("click", () => {
  if (settings.hidden) setSettingsOpen(true, settingsHeading);
});
cancelSettings.addEventListener("click", () => {
  if (!appliedConfiguration || checking) return;
  tokenDraft = appliedConfiguration.token;
  setSettingsOpen(false, settingsTrigger);
});
token.addEventListener("input", () => { tokenDraft = token.value; });

applySettings.addEventListener("click", async () => {
  if (checking) return;
  clearSettingsError();
  tokenDraft = token.value.trim();
  token.value = tokenDraft;
  if (!tokenDraft) {
    showSettingsError(localFailure("mobile_client", "validation_failed", "settings.check", "Enter an API token."));
    return;
  }

  const previousConfiguration = appliedConfiguration;
  setSettingsBusy(true);
  try {
    const checkedCatalog = await fetchConfigurationCatalog(tokenDraft);
    const tokenChanged = tokenDraft !== previousConfiguration?.token;
    configurationCatalog = checkedCatalog;
    appliedConfiguration = tokenChanged
      ? { token: tokenDraft, model: "", reasoning: "", permissions: "", fastMode: null }
      : normalizeConfiguration(previousConfiguration, checkedCatalog);
    if (tokenChanged && !state.threadId) {
      state.localNew = true;
      state.preTurnConfiguration = null;
      saveState();
      renderPreTurnConfiguration();
    }
    configurationDraft = { ...appliedConfiguration };
    saveAppliedConfiguration();
    ready = true;
    setSettingsOpen(false);
    setStatus("");
    if (tokenChanged && !state.threadId) await resolvePreTurnConfiguration();
    if (state.activeTurn) void followActiveTurn();
  } catch (error) {
    appliedConfiguration = previousConfiguration;
    tokenDraft = previousConfiguration?.token || "";
    token.value = tokenDraft;
    showSettingsError(error.failure || connectionFailure("settings.check"), () => applySettings.click());
  } finally {
    setSettingsBusy(false);
    setThreadControls();
    if (settings.hidden && ready) requestAnimationFrame(() => settingsTrigger.focus());
  }
});

permissions.addEventListener("change", () => { configurationDraft.permissions = permissions.value; });
fastMode.addEventListener("change", () => { configurationDraft.fastMode = fastMode.value === "" ? null : fastMode.value === "on"; });
model.addEventListener("change", () => {
  configurationDraft.model = model.value;
  const selected = selectedCapabilityModel();
  if (!selected || !selected.reasoning.includes(configurationDraft.reasoning)) {
    configurationDraft.reasoning = "";
  }
  renderReasoningOptions();
});
reasoning.addEventListener("change", () => { configurationDraft.reasoning = reasoning.value; });

applyConfiguration.addEventListener("click", async () => {
  if (checking) return;
  clearConfigurationError();
  configurationDraft = {
    token: appliedConfiguration.token,
    model: model.value,
    reasoning: reasoning.value,
    permissions: permissions.value,
    fastMode: fastMode.value === "" ? null : fastMode.value === "on",
  };
  setConfigurationBusy(true);
  try {
    const validationFailure = validateDraft(configurationDraft, configurationCatalog);
    if (validationFailure) {
      renderModelOptions();
      showConfigurationError(localFailure("mobile_client", "validation_failed", "configuration.resolve", validationFailure.message), validationFailure.field);
      return;
    }

    const response = await fetch("/configuration/resolve", { method: "POST", headers: { ...authorization(), "Content-Type": "application/json" }, body: JSON.stringify(resolutionRequest(configurationDraft)) });
    if (!response.ok) {
      const error = await responseError(response, "configuration.resolve");
      for (const [name, message] of Object.entries(error.failure.fieldErrors || {})) {
        const field = configurationFields.get(name);
        if (field) { field.control.setAttribute("aria-invalid", "true"); field.error.textContent = message; }
      }
      const firstInvalid = Object.keys(error.failure.fieldErrors || {}).map((name) => configurationFields.get(name)?.control).find(Boolean);
      if (firstInvalid) error.field = firstInvalid;
      throw error;
    }
    const resolved = await response.json().catch(() => { throw failureError(malformedFailure("configuration.resolve")); });
    if (!resolved?.configuration || typeof resolved.configurationRevision !== "string") throw failureError(malformedFailure("configuration.resolve"));
    appliedConfiguration = { ...configurationDraft, configurationRevision: resolved.configurationRevision };
    if (state.threadId) persistedThreadConfiguration = false;
    else {
      state.localNew = true;
      state.preTurnConfiguration = resolved;
      saveState();
      renderPreTurnConfiguration();
    }
    saveAppliedConfiguration();
    ready = true;
    setConfigurationOpen(false, configure);
    setStatus("");
  } catch (error) {
    showConfigurationError(error.failure || connectionFailure("configuration.resolve"), error.field, () => applyConfiguration.click());
  } finally {
    setConfigurationBusy(false);
    setThreadControls();
  }
});

function appendMessageContent(node, role, text) {
  if (role !== "assistant") {
    node.textContent = text;
    return;
  }

  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    node.append(document.createTextNode(text.slice(cursor, match.index)));
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = match[1];
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", "Code block");
    pre.append(code);
    node.append(pre);
    cursor = match.index + match[0].length;
  }
  node.append(document.createTextNode(text.slice(cursor)));
}

function isNearBottom() {
  return messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 80.5;
}

function captureReadingAnchor() {
  if (followThread) return null;
  const containerTop = messages.getBoundingClientRect().top;
  for (const message of messages.children) {
    const rect = message.getBoundingClientRect();
    if (rect.bottom >= containerTop) return { message, offset: rect.top - containerTop };
  }
  return null;
}

function restoreReadingAnchor(anchor) {
  if (!anchor?.message?.isConnected) return;
  const containerTop = messages.getBoundingClientRect().top;
  const currentOffset = anchor.message.getBoundingClientRect().top - containerTop;
  messages.scrollTop += currentOffset - anchor.offset;
}

function scheduleFollow() {
  if (!followThread || followFrame) return;
  programmaticFollowPending = true;
  followFrame = requestAnimationFrame(() => {
    followFrame = 0;
    if (followThread) messages.scrollTop = messages.scrollHeight;
    setTimeout(() => { programmaticFollowPending = false; }, 0);
  });
}

function drawMessages({ forceFollow = false } = {}) {
  const wasFollowing = forceFollow || (followThread && isNearBottom());
  const anchor = wasFollowing ? null : captureReadingAnchor();
  const existingActivity = messages.querySelector(".activity");
  const existingFailures = new Map([...messages.querySelectorAll(".message.error[data-item-id]")].map((node) => [node.dataset.itemId, node]));
  const nodes = state.messages.map(({ id, role, text, error, interrupted, failure, retryPrompt }) => {
    if (failure && id && existingFailures.has(id)) return existingFailures.get(id);
    const node = document.createElement("div");
    node.className = `message ${role}${error ? " error" : ""}${interrupted ? " interrupted" : ""}`;
    if (id) node.dataset.itemId = id;
    if (failure) {
      renderFailure(node, failure, {
        retry: retryPrompt ? () => {
          prompt.value = retryPrompt;
          resizePrompt();
          composer.requestSubmit();
        } : null,
        announce: true,
      });
    } else appendMessageContent(node, role, text);
    if (interrupted) {
      const metadata = document.createElement("small");
      metadata.className = "message-metadata";
      metadata.textContent = "Interrupted";
      node.append(metadata);
    }
    return node;
  });
  if (state.activeTurn?.activity) {
    const activity = existingActivity || document.createElement("div");
    if (!existingActivity) {
      activity.className = "message assistant activity";
      const decoration = document.createElement("span");
      decoration.className = "activity-decoration";
      decoration.setAttribute("aria-hidden", "true");
      decoration.textContent = matchMedia("(prefers-reduced-motion: reduce)").matches ? "…" : "···";
      activity.append(decoration);
    }
    const changed = lastAnnouncedActivity !== state.activeTurn.activity;
    activity.toggleAttribute("role", changed);
    activity.toggleAttribute("aria-live", changed);
    if (changed) {
      activity.setAttribute("role", "status");
      activity.setAttribute("aria-live", "polite");
      activity.setAttribute("aria-label", state.activeTurn.activity);
      lastAnnouncedActivity = state.activeTurn.activity;
    }
    nodes.push(activity);
  } else lastAnnouncedActivity = null;
  messages.replaceChildren(loadOlderHistory, ...(historyError.hidden ? [] : [historyError]), ...nodes);
  loadOlderHistory.hidden = !olderCursor;
  if (wasFollowing) {
    followThread = true;
    scheduleFollow();
  } else {
    restoreReadingAnchor(anchor);
  }
}

for (const eventName of ["wheel", "touchstart", "pointerdown", "keydown"]) {
  messages.addEventListener(eventName, () => { userScrollIntent = true; }, { passive: true });
}

messages.addEventListener("scroll", () => {
  if (programmaticFollowPending && !userScrollIntent) return;
  programmaticFollowPending = false;
  userScrollIntent = false;
  followThread = isNearBottom();
  readingAnchor = captureReadingAnchor();
  if (messages.scrollTop <= 1 && olderCursor && !hydrating) loadHistory();
}, { passive: true });

async function loadHistory() {
  const cursor = olderCursor; const firstMessage = state.messages[0]; const anchor = messages.children[1]; const offset = anchor?.getBoundingClientRect().top;
  hydrating = true; setThreadControls(); loadOlderHistory.hidden = true;
  try {
    const query = new URLSearchParams({ cursor }); if (firstMessage?.id) query.set("anchorId", firstMessage.id);
    historyError.hidden = true;
    const response = await fetch(`/threads/${state.threadId}/history?${query}`, { headers: authorization() }); if (!response.ok) throw await responseError(response, "thread.history");
    const result = await response.json().catch(() => { throw failureError(malformedFailure("thread.history")); });
    if (!Array.isArray(result?.messages)) throw failureError(malformedFailure("thread.history"));
    const known = new Set(state.messages.map((message) => message.id)); state.messages = [...result.messages.filter((message) => !known.has(message.id)), ...state.messages]; olderCursor = result.olderCursor; saveState(); drawMessages();
    const replacement = messages.children[result.messages.length + 1]; if (replacement && offset != null) messages.scrollTop += replacement.getBoundingClientRect().top - offset;
  } catch (error) {
    const failure = error.failure || connectionFailure("thread.history");
    renderFailure(historyError, failure, { retry: loadHistory });
    historyError.hidden = false;
    loadOlderHistory.after(historyError);
    loadOlderHistory.hidden = false;
    loadOlderHistory.textContent = "Retry loading older history";
  }
  finally { hydrating = false; setThreadControls(); }
}
loadOlderHistory.addEventListener("click", loadHistory);

function visualViewportHeight() { return window.visualViewport?.height || window.innerHeight; }

function resizePrompt() {
  const minimum = 46;
  const maximum = Math.max(minimum, Math.min(160, visualViewportHeight() * .3));
  prompt.style.height = "auto";
  const height = Math.max(minimum, Math.min(prompt.scrollHeight, maximum));
  prompt.style.height = `${height}px`;
  prompt.style.overflowY = prompt.scrollHeight > height + 1 ? "auto" : "hidden";
}

prompt.addEventListener("input", () => {
  const anchor = captureReadingAnchor();
  resizePrompt();
  if (followThread) scheduleFollow();
  else restoreReadingAnchor(anchor);
});

function updateVisualViewport() {
  const anchor = readingAnchor || captureReadingAnchor();
  if (window.visualViewport) {
    shell.style.setProperty("--visual-viewport-height", `${window.visualViewport.height}px`);
    shell.style.setProperty("--visual-viewport-top", `${window.visualViewport.offsetTop}px`);
  }
  resizePrompt();
  requestAnimationFrame(() => {
    if (followThread) scheduleFollow();
    else restoreReadingAnchor(anchor);
  });
}

window.addEventListener("resize", updateVisualViewport);
window.visualViewport?.addEventListener("resize", updateVisualViewport);
window.visualViewport?.addEventListener("scroll", updateVisualViewport);

newThread.addEventListener("click", async () => {
  if (activeTurn || !ready) return;
  threadRecoveryLocked = false;
  state = { threadId: null, messages: [], localNew: true, preTurnConfiguration: null };
  olderCursor = null;
  persistedThreadConfiguration = false;
  followThread = true;
  saveState();
  drawMessages({ forceFollow: true });
  prompt.value = "";
  resizePrompt();
  messages.scrollTop = 0;
  prompt.focus();
  renderPreTurnConfiguration();
  setStatus("Resolving configuration…");
  try {
    await resolvePreTurnConfiguration();
    setStatus("");
  } catch (error) {
    showStatusFailure(error.failure || connectionFailure("configuration.resolve"), () => newThread.click());
  }
});

showStatus.addEventListener("click", async () => {
  if (!ready) return;
  await refreshStatus();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text || activeTurn || !ready) return;

  const keepFocus = document.activeElement === prompt;
  const turnConfiguration = { ...appliedConfiguration };
  let preTurnConfiguration = state.preTurnConfiguration;
  if (!state.threadId && !preTurnConfiguration?.configurationRevision) {
    try {
      setStatus("Resolving configuration…");
      preTurnConfiguration = await resolvePreTurnConfiguration();
    } catch (error) {
      showStatusFailure(error.failure || connectionFailure("configuration.resolve"), () => composer.requestSubmit());
      return;
    }
  }
  state.messages.push({ id: `local:${crypto.randomUUID()}`, role: "user", text });
  state.activeTurn = {
    id: crypto.randomUUID(),
    stage: "starting",
    lastSequence: 0,
    consumedItemIds: [],
    request: {
      prompt: text,
      threadId: state.threadId,
      model: persistedThreadConfiguration ? undefined : preTurnConfiguration?.configuration.model || turnConfiguration.model || undefined,
      reasoning: persistedThreadConfiguration ? undefined : preTurnConfiguration?.configuration.reasoning || turnConfiguration.reasoning || undefined,
      permissions: persistedThreadConfiguration ? undefined : preTurnConfiguration?.configuration.permissions || turnConfiguration.permissions || undefined,
      fastMode: persistedThreadConfiguration ? undefined : preTurnConfiguration?.configuration.fastMode ?? turnConfiguration.fastMode,
      configurationRevision: persistedThreadConfiguration ? undefined : preTurnConfiguration?.configurationRevision,
    },
  };
  followThread = true;
  prompt.value = "";
  resizePrompt();
  activeTurn = true;
  setThreadControls();
  setStatus("Codex is working…");
  drawMessages({ forceFollow: true });
  saveState();
  if (keepFocus) prompt.focus();
  await followActiveTurn();
  if (keepFocus) prompt.focus();
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function failureError(failure, statusCode = 0) {
  const error = new Error(failure.message);
  error.failure = failure;
  error.status = statusCode;
  error.retryable = failure.retryable;
  return error;
}

function connectionFailure(operation, code = "relay_unreachable") {
  return code === "stream_interrupted"
    ? localFailure("connection", code, operation, "The Turn connection was interrupted. Reconnecting to the existing Turn.", "reconnect", true)
    : localFailure("connection", code, operation, "Relay could not be reached. Check your connection and retry.", "retry", true);
}

function legacyFailure(response, body, operation) {
  if (response.status === 401) return localFailure("relay", "authentication_rejected", operation, "The API token was rejected. Check it and try again.", "open_settings", false);
  if (response.status === 404 && operation === "turn.recover") return localFailure("relay", "retained_turn_unavailable", operation, "This Turn is no longer retained.", "start_new_thread", false);
  if (response.status === 404 && ["thread.resume", "thread.revalidate"].includes(operation)) return localFailure("relay", "state_conflict", operation, "The saved Thread is unavailable.", "start_new_thread", false);
  if (response.status === 429 || response.status === 503) return localFailure("relay", "capacity_exceeded", operation, "Relay is busy. Retry in a moment.", "retry", true);
  if ([400, 409].includes(response.status)) return localFailure("relay", response.status === 409 ? "state_conflict" : "request_invalid", operation, "The Relay could not accept this operation.", "none", false);
  const message = operation === "settings.check"
    ? (response.status === 502 ? "Configuration information is unavailable. Try again." : "Configuration could not be checked. Try again.")
    : operation === "thread.list" ? "Threads could not be loaded. Try again."
      : ["thread.resume", "thread.revalidate"].includes(operation) ? "The Thread could not be resumed. Try again."
        : operation === "thread.history" ? "Older history could not be loaded. Try again."
          : operation === "status.read" ? "Status could not be refreshed. Try again."
            : "The Relay operation failed. Try again.";
  return localFailure("unknown", "upstream_failure", operation, message, "retry", operation !== "turn.create");
}

async function responseError(response, operation) {
  let body;
  try { body = await response.json(); }
  catch { return failureError(malformedFailure(operation), response.status); }
  const failure = body?.failure
    ? normalizeFailure(body.failure, operation)
    : legacyFailure(response, body, operation);
  if (!failure.fieldErrors && body?.fieldErrors && typeof body.fieldErrors === "object" && !Array.isArray(body.fieldErrors)) {
    failure.fieldErrors = body.fieldErrors;
  }
  return failureError(failure, response.status);
}

function finishActiveTurn(statusMessage = "") {
  state.activeTurn = null; activeTurn = false; setStatus(statusMessage); setThreadControls(); saveState(); drawMessages();
}

function applyTurnEvent(turnEvent) {
  const turn = state.activeTurn;
  if (!turn || !Number.isSafeInteger(turnEvent.sequence)) throw failureError(malformedFailure("turn.stream"));
  if (turnEvent.sequence <= turn.lastSequence) return false;
  if (turnEvent.sequence !== turn.lastSequence + 1 || ![
    "thread.started", "activity", "item.delta", "item.completed", "turn.retrying", "error", "relay.turn.finished",
  ].includes(turnEvent.type)) throw failureError(malformedFailure("turn.stream"));
  turn.lastSequence = turnEvent.sequence;
  if (turnEvent.type === "thread.started") {
    if (typeof turnEvent.thread_id !== "string") throw failureError(malformedFailure("turn.stream"));
    state.threadId = turnEvent.thread_id;
    state.localNew = false;
    renderPreTurnConfiguration();
  }
  if (turnEvent.type === "activity") turn.activity = typeof turnEvent.category === "string" ? turnEvent.category : null;
  const item = turnEvent.item;
  const itemId = item?.id || `legacy:${turnEvent.sequence}`;
  turn.consumedItemIds ||= [];
  if (turnEvent.type === "item.delta" && item?.type === "agent_message" && !turn.consumedItemIds.includes(itemId)) {
    let message = state.messages.find((entry) => entry.id === itemId);
    if (!message) {
      message = { id: itemId, role: "assistant", text: "", provisional: true };
      state.messages.push(message);
    }
    message.text += String(item.delta || "");
    setStatus("Codex response updated.");
  }
  if (turnEvent.type === "item.completed" && item?.type === "agent_message" && !turn.consumedItemIds.includes(itemId)) {
    let message = state.messages.find((entry) => entry.id === itemId);
    const text = String(item.text || "");
    if (!message && text) { message = { id: itemId, role: "assistant", text }; state.messages.push(message); }
    if (message) {
      message.text = text;
      delete message.provisional;
      delete message.interrupted;
      if (!message.text) state.messages.splice(state.messages.indexOf(message), 1);
    }
    turn.consumedItemIds.push(itemId);
    setStatus("Codex response updated.");
  }
  if (turnEvent.type === "item.completed" && item?.type === "error" && !turn.consumedItemIds.includes(itemId)) {
    state.messages.push({ id: itemId, role: "assistant", text: `Error: ${String(item.text || "Turn failed")}`, error: true });
    turn.consumedItemIds.push(itemId);
  }
  if (turnEvent.type === "turn.retrying") {
    const failure = normalizeFailure(turnEvent.failure, "turn.stream");
    turn.retryingFailure = failure;
    setStatus(failureText(failure));
  }
  if (turnEvent.type === "error") {
    const failure = turnEvent.failure
      ? normalizeFailure(turnEvent.failure, "turn.stream")
      : localFailure("unknown", "upstream_failure", "turn.stream", "The Turn failed.", "retry", true);
    turn.failure = failure;
    const errorId = turnEvent.id || `relay:${turn.id}:error`;
    if (!state.messages.some(({ id }) => id === errorId)) state.messages.push({
      id: errorId,
      role: "assistant",
      text: failureText(failure),
      error: true,
      failure,
      ...(failure.retryable && failure.action === "retry" ? { retryPrompt: turn.request.prompt } : {}),
    });
  }
  if (turnEvent.type !== "relay.turn.finished") return false;
  if (turnEvent.status === "failed") {
    for (const message of state.messages) if (message.provisional) { message.interrupted = true; delete message.provisional; }
    finishActiveTurn("Turn failed.");
  } else if (turnEvent.status === "interrupted") {
    for (const message of state.messages) if (message.provisional) { message.interrupted = true; delete message.provisional; }
    finishActiveTurn("Turn interrupted.");
  } else if (turnEvent.status === "completed") finishActiveTurn();
  else throw failureError(malformedFailure("turn.stream"));
  return true;
}

let followingTurn = false;
async function followActiveTurn() {
  if (followingTurn || !state.activeTurn || !appliedConfiguration?.token) return;
  followingTurn = true; activeTurn = true; setThreadControls(); let retryDelay = 500;
  try {
    while (state.activeTurn) {
      try {
        const turn = state.activeTurn;
        if (turn.stage === "starting") {
          const created = await fetch("/turn", { method: "POST", headers: { ...authorization(), "Content-Type": "application/json" }, body: JSON.stringify({ turnId: turn.id, ...turn.request }) });
          if (!created.ok) {
            const error = await responseError(created, "turn.create");
            if (error.failure.code === "configuration_obsolete" && !turn.request.threadId) {
              const resolved = await resolvePreTurnConfiguration();
              turn.request = {
                ...turn.request,
                model: resolved.configuration.model,
                reasoning: resolved.configuration.reasoning,
                permissions: resolved.configuration.permissions,
                fastMode: resolved.configuration.fastMode,
                configurationRevision: resolved.configurationRevision,
              };
              saveState();
              continue;
            }
            throw error;
          }
          turn.stage = "streaming"; saveState();
        }
        const response = await fetch(`/turn/${turn.id}/events?after=${turn.lastSequence}`, { headers: authorization() });
        if (!response.ok) throw await responseError(response, "turn.recover");
        delete turn.awaitingRecovery;
        setStatus("Codex is working…"); retryDelay = 500;
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (state.activeTurn) {
          const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n"); buffer = lines.pop();
          for (const line of lines) {
            if (!line) continue;
            let turnEvent;
            try { turnEvent = JSON.parse(line); }
            catch { throw failureError(malformedFailure("turn.stream")); }
            if (applyTurnEvent(turnEvent)) return;
          }
          saveState(); drawMessages();
          if (done) throw failureError(connectionFailure("turn.stream", "stream_interrupted"));
        }
      } catch (error) {
        const stage = state.activeTurn?.stage;
        const failure = error.failure || connectionFailure(stage === "starting" ? "turn.create" : "turn.stream", stage === "starting" ? "relay_unreachable" : "stream_interrupted");
        const canAutoRecover = failure.source === "connection"
          && ((stage === "starting" && failure.code === "relay_unreachable") || (stage === "streaming" && failure.code === "stream_interrupted"));
        const definitiveRecoveryFailure = stage === "streaming"
          && failure.source === "relay"
          && ["retained_turn_unavailable", "replay_position_invalid"].includes(failure.code);
        if (!canAutoRecover && stage === "streaming" && !definitiveRecoveryFailure) {
          state.activeTurn.awaitingRecovery = true;
          setStatus(failureText(failure));
          showStatusFailure(failure, failure.retryable ? followActiveTurn : null);
          saveState();
          drawMessages();
          return;
        }
        if (!canAutoRecover) {
          state.messages = state.messages.filter((message) => {
            if (!message.provisional) return true;
            if (!message.text.trim()) return false;
            message.interrupted = true;
            message.retainInterrupted = true;
            delete message.provisional;
            return true;
          });
          if (stage === "starting") {
            prompt.value = state.activeTurn.request.prompt;
            resizePrompt();
          }
          finishActiveTurn(failureText(failure));
          showStatusFailure(failure, null, failure.action !== "start_new_thread");
          return;
        }
        setStatus(failureText(failure)); saveState(); drawMessages(); await wait(retryDelay); retryDelay = Math.min(retryDelay * 2, 10_000);
      }
    }
  } finally { followingTurn = false; }
}

drawMessages({ forceFollow: true });
updateVisualViewport();
setThreadControls();
checkPersistedConfiguration();
