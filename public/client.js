const shell = document.querySelector("#app-shell");
const newThread = document.querySelector("#new");
const showStatus = document.querySelector("#show-status");
const configure = document.querySelector("#configure");
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
const messages = document.querySelector("#messages");
const status = document.querySelector("#status");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");

const emptyConfiguration = { token: "", model: "", reasoning: "", permissions: "" };
const allowedPermissions = ["", "read-only", "workspace-write"];
let state = readJson("relay", { threadId: null, messages: [] });
let appliedConfiguration = readAppliedConfiguration();
let configurationDraft = { ...(appliedConfiguration || emptyConfiguration) };
let info = null;
let ready = false;
let checking = false;
let activeTurn = false;
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
    };
  }

  const legacyToken = localStorage.getItem("token");
  if (!legacyToken) return null;
  const migrated = {
    token: legacyToken,
    model: localStorage.getItem("model") || "",
    reasoning: localStorage.getItem("reasoning") || "",
    permissions: localStorage.getItem("permissions") || "",
  };
  localStorage.setItem("relayConfiguration", JSON.stringify(migrated));
  return migrated;
}

function saveState() { localStorage.setItem("relay", JSON.stringify(state)); }
function saveAppliedConfiguration() {
  localStorage.setItem("relayConfiguration", JSON.stringify(appliedConfiguration));
}

function setStatus(message) { status.textContent = message; }

function setConfigurationOpen(open, focusTarget = null) {
  configuration.hidden = !open;
  shell.classList.toggle("configuration-open", open);
  configure.hidden = open && !appliedConfiguration;
  configure.textContent = open ? "Cancel" : "Configure";
  configure.setAttribute("aria-expanded", String(open));
  configure.setAttribute("aria-controls", "configuration");
  if (open) renderConfigurationDraft();
  if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
}

function setThreadControls() {
  const locked = checking || activeTurn;
  newThread.disabled = locked || !ready;
  showStatus.disabled = locked || !ready;
  configure.disabled = locked;
  send.disabled = activeTurn || !ready;
  prompt.disabled = !ready;
}

function setConfigurationBusy(busy) {
  checking = busy;
  for (const control of [token, permissions, cancelConfiguration, applyConfiguration]) control.disabled = busy;
  model.disabled = busy || !info;
  const selectedModel = info?.models.find((item) => item.id === configurationDraft.model);
  reasoning.disabled = busy || !selectedModel;
  cancelConfiguration.hidden = !appliedConfiguration;
  configurationProgress.hidden = !busy;
  configurationProgress.textContent = busy ? "Checking configuration…" : "";
  setThreadControls();
}

function clearConfigurationError() {
  configurationError.hidden = true;
  configurationError.textContent = "";
  for (const [field, fieldError] of [
    [token, tokenError],
    [model, modelError],
    [reasoning, reasoningError],
    [permissions, permissionsError],
  ]) {
    fieldError.textContent = "";
    field.removeAttribute("aria-invalid");
  }
}

function showConfigurationError(message, field = null) {
  configurationError.textContent = message;
  configurationError.hidden = false;
  const fieldError = new Map([
    [token, tokenError],
    [model, modelError],
    [reasoning, reasoningError],
    [permissions, permissionsError],
  ]).get(field);
  if (fieldError) {
    fieldError.textContent = message;
    field.setAttribute("aria-invalid", "true");
  }
  requestAnimationFrame(() => configurationError.focus());
}

function renderConfigurationDraft() {
  token.value = configurationDraft.token;
  permissions.value = allowedPermissions.includes(configurationDraft.permissions)
    ? configurationDraft.permissions
    : "";
  renderModelOptions();
  clearConfigurationError();
  cancelConfiguration.hidden = !appliedConfiguration;
}

function option(label, value) { return new Option(label, value); }

function renderModelOptions() {
  const choices = [option("Default", "")];
  if (info) {
    for (const item of info.models) choices.push(option(item.name, item.id));
    if (configurationDraft.model && !info.models.some((item) => item.id === configurationDraft.model)) {
      choices.push(option(`${configurationDraft.model} (unavailable)`, configurationDraft.model));
    }
  } else if (configurationDraft.model) {
    choices.push(option(configurationDraft.model, configurationDraft.model));
  }
  model.replaceChildren(...choices);
  model.value = configurationDraft.model;
  model.disabled = checking || !info;
  modelHint.hidden = Boolean(info);
  renderReasoningOptions();
}

function renderReasoningOptions() {
  const selected = info?.models.find((item) => item.id === configurationDraft.model);
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
  reasoning.disabled = checking || !info || !selected;
  reasoningHint.hidden = Boolean(selected);
  reasoningHint.textContent = info
    ? "Choose a model to select an explicit reasoning effort."
    : "Apply an API token to load reasoning efforts.";
}

function normalizeConfiguration(candidate, modelInfo) {
  const normalized = { ...candidate };
  const selected = modelInfo.models.find((item) => item.id === normalized.model);
  if (normalized.model && !selected) {
    normalized.model = "";
    normalized.reasoning = "";
    return normalized;
  }
  if (!normalized.model) normalized.reasoning = "";
  if (normalized.reasoning && !selected.reasoning.includes(normalized.reasoning)) {
    normalized.reasoning = "";
  }
  return normalized;
}

function validateDraft(candidate, modelInfo) {
  const selected = modelInfo.models.find((item) => item.id === candidate.model);
  if (candidate.model && !selected) {
    return { message: "The selected model is no longer available.", field: model };
  }
  if (candidate.reasoning && (!selected || !selected.reasoning.includes(candidate.reasoning))) {
    return { message: "The selected reasoning effort is not supported by this model.", field: reasoning };
  }
  if (!allowedPermissions.includes(candidate.permissions)) {
    return { message: "The selected permissions are invalid.", field: permissions };
  }
  return null;
}

function configurationFailure(message, field = null) {
  const error = new Error(message);
  error.field = field;
  return error;
}

async function fetchInfo(configurationToken) {
  let response;
  try {
    response = await fetch("/info", { headers: { "Authorization": `Bearer ${configurationToken}` } });
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
    setConfigurationOpen(true, configurationHeading);
    setConfigurationBusy(false);
    setThreadControls();
    return;
  }

  setStatus("Checking configuration…");
  setConfigurationBusy(true);
  try {
    info = await fetchInfo(appliedConfiguration.token);
    const normalized = normalizeConfiguration(appliedConfiguration, info);
    const changed = JSON.stringify(normalized) !== JSON.stringify(appliedConfiguration);
    appliedConfiguration = normalized;
    configurationDraft = { ...normalized };
    if (changed) {
      saveAppliedConfiguration();
      setStatus("Configuration checked; unavailable model choices were reset to Default.");
    } else {
      setStatus("");
    }
    ready = true;
    setConfigurationOpen(false);
  } catch (error) {
    ready = false;
    configurationDraft = { ...appliedConfiguration };
    setConfigurationOpen(true);
    showConfigurationError(error.message, error.field);
    setStatus("Configuration needs attention.");
  } finally {
    setConfigurationBusy(false);
    setThreadControls();
  }
}

function openConfiguration() {
  if (checking || activeTurn) return;
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

token.addEventListener("input", () => { configurationDraft.token = token.value; });
permissions.addEventListener("change", () => { configurationDraft.permissions = permissions.value; });
model.addEventListener("change", () => {
  configurationDraft.model = model.value;
  const selected = info?.models.find((item) => item.id === model.value);
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
    token: token.value.trim(),
    model: model.value,
    reasoning: reasoning.value,
    permissions: permissions.value,
  };
  token.value = configurationDraft.token;
  if (!configurationDraft.token) {
    showConfigurationError("Enter an API token.", token);
    return;
  }

  setConfigurationBusy(true);
  try {
    const checkedInfo = await fetchInfo(configurationDraft.token);
    const validationFailure = validateDraft(configurationDraft, checkedInfo);
    if (validationFailure) {
      info = checkedInfo;
      renderModelOptions();
      showConfigurationError(validationFailure.message, validationFailure.field);
      return;
    }

    info = checkedInfo;
    appliedConfiguration = { ...configurationDraft };
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
  messages.replaceChildren(...nodes);
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
}, { passive: true });

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

newThread.addEventListener("click", () => {
  if (activeTurn || !ready) return;
  state = { threadId: null, messages: [] };
  followThread = true;
  saveState();
  drawMessages({ forceFollow: true });
  prompt.value = "";
  resizePrompt();
  messages.scrollTop = 0;
  prompt.focus();
  setStatus("");
});

showStatus.addEventListener("click", async () => {
  if (!ready || activeTurn) return;
  setStatus("Loading status…");
  try { info = await fetchInfo(appliedConfiguration.token); }
  catch (error) { setStatus(error.message); return; }
  const limits = info.rateLimits || {};
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
  state.messages.push({ role: "user", text }, { role: "assistant", text: "" });
  followThread = true;
  prompt.value = "";
  resizePrompt();
  activeTurn = true;
  setThreadControls();
  setStatus("Codex is working…");
  drawMessages({ forceFollow: true });
  if (keepFocus) prompt.focus();

  try {
    const response = await fetch("/turn", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${turnConfiguration.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: text,
        threadId: state.threadId,
        model: turnConfiguration.model || undefined,
        reasoning: turnConfiguration.reasoning || undefined,
        permissions: turnConfiguration.permissions || undefined,
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const turnEvent = JSON.parse(line);
        if (turnEvent.type === "thread.started") state.threadId = turnEvent.thread_id;
        if (turnEvent.type === "item.completed" && turnEvent.item?.type === "agent_message") {
          state.messages.at(-1).text += turnEvent.item.text;
          drawMessages();
          setStatus("Codex response updated.");
        }
        if (turnEvent.type === "error") throw new Error(turnEvent.message);
      }
      if (done) break;
    }
    setStatus("");
  } catch (error) {
    state.messages.at(-1).text = `Error: ${error.message}`;
    setStatus("Disconnected");
    drawMessages();
  } finally {
    activeTurn = false;
    setThreadControls();
    saveState();
    if (keepFocus) prompt.focus();
  }
});

drawMessages({ forceFollow: true });
updateVisualViewport();
setThreadControls();
checkPersistedConfiguration();
