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

function saveState() { localStorage.setItem("relay", JSON.stringify(state)); }
function saveAppliedConfiguration() {
  localStorage.setItem("relayConfiguration", JSON.stringify(appliedConfiguration));
}

function setStatus(message) { status.textContent = message; }

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
  const response = await fetch("/configuration/resolve", {
    method: "POST",
    headers: { ...authorization(), "Content-Type": "application/json" },
    body: JSON.stringify(resolutionRequest(appliedConfiguration)),
  });
  if (!response.ok) throw await responseError(response);
  const resolved = await response.json();
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
  resumeThread.disabled = locked || !ready || focusedView;
  showStatus.disabled = checking || hydrating || !ready;
  configure.disabled = locked || !ready || !settings.hidden || !resumePicker.hidden;
  settingsTrigger.disabled = activeTurn || checking || hydrating;
  send.disabled = activeTurn || !ready || focusedView;
  prompt.disabled = !ready || focusedView;
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

function displayResumeError(message) {
  resumeError.textContent = message;
  resumeError.hidden = false;
  requestAnimationFrame(() => resumeError.focus());
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
    const response = await fetch(`/threads?${query}`, { headers: authorization() }); if (!response.ok) throw new Error("Threads could not be loaded. Try again.");
    const result = await response.json(); renderThreadRows(result.threads, append); resumeCursor = result.nextCursor;
    resumeStatus.textContent = !append && !result.threads.length ? "No Threads to resume" : ""; loadMoreThreads.textContent = "Load more"; loadMoreThreads.dataset.retry = ""; loadMoreThreads.hidden = !resumeCursor;
  } catch (error) { displayResumeError(error.message); resumeStatus.textContent = ""; loadMoreThreads.textContent = "Retry"; loadMoreThreads.dataset.retry = "true"; loadMoreThreads.hidden = false; }
  finally { hydrating = false; setThreadControls(); }
}

async function selectThread(id, row) {
  hydrating = true; setThreadControls(); for (const button of resumeResults.querySelectorAll("button")) button.disabled = true; resumeStatus.textContent = "Loading Thread…"; resumeError.hidden = true;
  try {
    const response = await fetch(`/threads/${id}/resume`, { method: "POST", headers: authorization() }); if (!response.ok) throw new Error(response.status === 404 ? "That Thread is no longer available." : "Thread could not be resumed. Try again.");
    const result = await response.json(); state = { threadId: result.thread.id, messages: result.messages }; olderCursor = result.olderCursor; persistedThreadConfiguration = true; saveState(); followThread = true; renderPreTurnConfiguration(); drawMessages({ forceFollow: true });
    setResumeOpen(false); requestAnimationFrame(() => prompt.focus()); setStatus(result.thread.model ? `Resumed · ${result.thread.model}` : "Resumed");
  } catch (error) { displayResumeError(error.message); if (/no longer/.test(error.message)) row.remove(); }
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

function showSettingsError(message) {
  settingsError.textContent = message;
  settingsError.hidden = false;
  tokenError.textContent = message;
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

function showConfigurationError(message, field = null) {
  configurationError.textContent = message;
  configurationError.hidden = false;
  const fieldError = [...configurationFields.values()].find(({ control }) => control === field);
  if (fieldError) {
    fieldError.error.textContent = message;
    field.setAttribute("aria-invalid", "true");
  }
  requestAnimationFrame(() => configurationError.focus());
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

function configurationFailure(message, field = null) {
  const error = new Error(message);
  error.field = field;
  return error;
}

async function fetchConfigurationCatalog(configurationToken) {
  let response;
  try {
    response = await fetch("/configuration", { headers: { "Authorization": `Bearer ${configurationToken}` } });
  } catch {
    throw configurationFailure("Relay or Codespace information is unavailable. Try again.");
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw configurationFailure("The API token was rejected. Check it and try again.", token);
    }
    if (response.status === 502) {
      throw configurationFailure("Relay or Codespace information is unavailable. Try again.");
    }
    throw configurationFailure("Configuration could not be checked. Try again.");
  }

  try {
    const result = await response.json();
    if (!Array.isArray(result.models)) throw new Error();
    return result;
  } catch {
    throw configurationFailure("Configuration could not be checked. Try again.");
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
    showSettingsError(error.message);
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
    if (!response.ok) throw new Error();
    const result = await response.json(); state = { threadId: result.thread.id, messages: result.messages }; olderCursor = result.olderCursor; persistedThreadConfiguration = true; saveState(); renderPreTurnConfiguration(); drawMessages({ forceFollow: true }); setStatus("");
  } catch {
    state = { threadId: null, messages: [] }; olderCursor = null; persistedThreadConfiguration = false; saveState(); drawMessages({ forceFollow: true }); setStatus("The saved Thread is unavailable; started a new Thread.");
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
    showSettingsError("Enter an API token.");
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
    setSettingsOpen(false, settingsTrigger);
    setStatus("");
    if (tokenChanged && !state.threadId) await resolvePreTurnConfiguration();
  } catch (error) {
    appliedConfiguration = previousConfiguration;
    tokenDraft = previousConfiguration?.token || "";
    token.value = tokenDraft;
    showSettingsError(error.message);
  } finally {
    setSettingsBusy(false);
    setThreadControls();
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
      showConfigurationError(validationFailure.message, validationFailure.field);
      return;
    }

    const response = await fetch("/configuration/resolve", { method: "POST", headers: { ...authorization(), "Content-Type": "application/json" }, body: JSON.stringify(resolutionRequest(configurationDraft)) });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      for (const [name, message] of Object.entries(failure.fieldErrors || {})) {
        const field = configurationFields.get(name);
        if (field) { field.control.setAttribute("aria-invalid", "true"); field.error.textContent = message; }
      }
      throw configurationFailure(failure.error || "Configuration could not be applied. Try again.");
    }
    const resolved = await response.json();
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
    showConfigurationError(error.message, error.field);
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
  const nodes = state.messages.map(({ role, text }) => {
    const node = document.createElement("div");
    node.className = `message ${role}`;
    appendMessageContent(node, role, text);
    return node;
  });
  messages.replaceChildren(loadOlderHistory, ...nodes);
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
    const response = await fetch(`/threads/${state.threadId}/history?${query}`, { headers: authorization() }); if (!response.ok) throw new Error();
    const result = await response.json(); const known = new Set(state.messages.map((message) => message.id)); state.messages = [...result.messages.filter((message) => !known.has(message.id)), ...state.messages]; olderCursor = result.olderCursor; saveState(); drawMessages();
    const replacement = messages.children[result.messages.length + 1]; if (replacement && offset != null) messages.scrollTop += replacement.getBoundingClientRect().top - offset;
  } catch { loadOlderHistory.hidden = false; loadOlderHistory.textContent = "Retry loading older history"; }
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
    setStatus(`Configuration could not be resolved: ${error.message}`);
  }
});

showStatus.addEventListener("click", async () => {
  if (!ready || activeTurn) return;
  setStatus("Loading status…");
  let statusInfo;
  try {
    const response = await fetch("/info", { headers: authorization() });
    if (!response.ok) throw configurationFailure("Status is unavailable. Try again.");
    statusInfo = await response.json();
  }
  catch (error) { setStatus(error.message); return; }
  const limits = statusInfo.rateLimits || {};
  setStatus([
    `Thread: ${state.threadId || "new"}`,
    `Model: ${appliedConfiguration.model || "default"}`,
    `Reasoning: ${appliedConfiguration.reasoning || "default"}`,
    `Permissions: ${appliedConfiguration.permissions || "default"}`,
    limits.primary && `5h: ${limits.primary.usedPercent}% used`,
    limits.secondary && `Weekly: ${limits.secondary.usedPercent}% used`,
    limits.planType && `Plan: ${limits.planType}`,
  ].filter(Boolean).join(" · "));
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
      setStatus(`Configuration could not be resolved: ${error.message}`);
      return;
    }
  }
  state.messages.push({ role: "user", text }, { role: "assistant", text: "" });
  state.activeTurn = {
    id: crypto.randomUUID(),
    stage: "starting",
    lastSequence: 0,
    messageIndex: state.messages.length - 1,
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

async function responseError(response) {
  let message = `${response.status} ${response.statusText}`.trim();
  try { message = (await response.json()).error || message; } catch {}
  const error = new Error(message); error.status = response.status; error.retryable = response.status >= 500; return error;
}

function finishActiveTurn(statusMessage = "") {
  state.activeTurn = null; activeTurn = false; setStatus(statusMessage); setThreadControls(); saveState(); drawMessages();
}

function applyTurnEvent(turnEvent) {
  const turn = state.activeTurn;
  if (!turn || !Number.isSafeInteger(turnEvent.sequence) || turnEvent.sequence <= turn.lastSequence) return false;
  turn.lastSequence = turnEvent.sequence;
  if (turnEvent.type === "thread.started") {
    state.threadId = turnEvent.thread_id;
    state.localNew = false;
    renderPreTurnConfiguration();
  }
  if (turnEvent.type === "item.completed" && turnEvent.item?.type === "agent_message") {
    state.messages[turn.messageIndex].text += turnEvent.item.text; setStatus("Codex response updated.");
  }
  if (turnEvent.type === "error") turn.error = turnEvent.message;
  if (turnEvent.type !== "relay.turn.finished") return false;
  if (turnEvent.status === "failed") {
    const assistant = state.messages[turn.messageIndex];
    if (!assistant.text && turn.error) assistant.text = `Error: ${turn.error}`;
    finishActiveTurn(turn.error ? `Codex failed: ${turn.error}` : "Codex failed");
  } else finishActiveTurn();
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
            const error = await responseError(created);
            if (error.status === 409 && !turn.request.threadId && /revision is obsolete/i.test(error.message)) {
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
        if (!response.ok) throw await responseError(response);
        setStatus("Codex is working…"); retryDelay = 500;
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (state.activeTurn) {
          const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n"); buffer = lines.pop();
          for (const line of lines) if (line && applyTurnEvent(JSON.parse(line))) return;
          saveState(); drawMessages();
          if (done) throw new Error("Turn stream ended before completion");
        }
      } catch (error) {
        if (error.retryable === false) { finishActiveTurn(`Turn recovery unavailable: ${error.message}`); return; }
        setStatus("Connection lost. Reconnecting…"); saveState(); drawMessages(); await wait(retryDelay); retryDelay = Math.min(retryDelay * 2, 10_000);
      }
    }
  } finally { followingTurn = false; }
}

drawMessages({ forceFollow: true });
updateVisualViewport();
setThreadControls();
checkPersistedConfiguration();
