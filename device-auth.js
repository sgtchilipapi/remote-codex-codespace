const { randomUUID } = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const APPROVED_HOSTS = new Set(["auth.openai.com"]);
const URL_PATTERN = /https:\/\/[^\s<>"']+/g;
const CODE_VALUE = "([A-Z0-9](?:[A-Z0-9-]{1,30}[A-Z0-9]))(?![A-Z0-9-])";
const INSTALLED_CODE = new RegExp(`Enter this one-time code[^\\r\\n]*[\\r\\n]+\\s*${CODE_VALUE}`, "i");
const COMPACT_CODE = new RegExp(`\\b(?:enter(?:\\s+(?:this\\s+)?code)?|code(?:\\s+is)?)[^A-Z0-9-]*${CODE_VALUE}`, "gi");

function parseDeviceAuthOutput(output) {
  const normalized = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  let verificationUrl = null;
  for (const candidate of normalized.match(URL_PATTERN) || []) {
    try {
      const parsed = new URL(candidate.replace(/[),.;]+$/, ""));
      if (parsed.protocol === "https:" && APPROVED_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password) {
        verificationUrl = parsed.href;
        break;
      }
    } catch {}
  }
  const installedMatch = normalized.match(INSTALLED_CODE);
  const userCode = installedMatch?.[1]
    || [...normalized.matchAll(COMPACT_CODE)].map((match) => match[1]).find((value) => /^[A-Z0-9-]+$/.test(value))
    || null;
  if (!verificationUrl || !userCode || userCode.length > 32 || !/^[A-Z0-9-]+$/.test(userCode)) return null;
  return { verificationUrl, userCode };
}

class DeviceAuthError extends Error {
  constructor(kind, status = 502) {
    super(kind);
    this.kind = kind;
    this.status = status;
  }
}

class DeviceAuthManager {
  constructor({ run, timeoutMs = DEFAULT_TIMEOUT_MS, retentionMs = DEFAULT_RETENTION_MS, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES }) {
    this.run = run;
    this.timeoutMs = timeoutMs;
    this.retentionMs = retentionMs;
    this.maxOutputBytes = maxOutputBytes;
    this.attempts = new Map();
    this.active = null;
  }

  start() {
    if (this.active && this.active.status === "pending") return this.active.ready;
    const attempt = { id: randomUUID(), status: "pending", child: null, output: "", bytes: 0, settled: false };
    attempt.ready = new Promise((resolve, reject) => { attempt.resolveReady = resolve; attempt.rejectReady = reject; });
    this.attempts.set(attempt.id, attempt);
    this.active = attempt;

    const failBeforeReady = (error) => {
      if (attempt.settled) return;
      attempt.settled = true;
      attempt.status = "failed";
      this.active = null;
      clearTimeout(attempt.timeout);
      attempt.rejectReady(error);
      this.retain(attempt);
    };
    const consume = (chunk) => {
      if (attempt.status !== "pending") return;
      attempt.bytes += Buffer.byteLength(chunk);
      if (attempt.bytes > this.maxOutputBytes) {
        attempt.child?.kill();
        return failBeforeReady(new DeviceAuthError("output_limit_exceeded"));
      }
      attempt.output += chunk.toString("utf8");
      const parsed = parseDeviceAuthOutput(attempt.output);
      if (parsed && !attempt.settled) {
        attempt.settled = true;
        Object.assign(attempt, parsed);
        attempt.output = "";
        attempt.resolveReady(this.publicStart(attempt));
      }
    };

    try {
      attempt.child = this.run("codex login --device-auth");
    } catch {
      failBeforeReady(new DeviceAuthError("dependency_missing"));
      return attempt.ready;
    }
    attempt.child.stdout?.on("data", consume);
    attempt.child.stderr?.on("data", consume);
    attempt.child.once("error", () => failBeforeReady(new DeviceAuthError("dependency_missing")));
    attempt.child.once("close", (exitCode) => {
      if (!attempt.settled) return failBeforeReady(new DeviceAuthError("malformed_response"));
      if (attempt.status !== "pending") return;
      clearTimeout(attempt.timeout);
      attempt.status = exitCode === 0 ? "succeeded" : "failed";
      this.active = null;
      this.retain(attempt);
    });
    attempt.timeout = setTimeout(() => {
      if (attempt.status !== "pending") return;
      attempt.child?.kill();
      if (!attempt.settled) return failBeforeReady(new DeviceAuthError("upstream_timeout", 504));
      attempt.status = "expired";
      this.active = null;
      this.retain(attempt);
    }, this.timeoutMs);
    attempt.timeout.unref?.();
    return attempt.ready;
  }

  get(id) {
    const attempt = this.attempts.get(id);
    if (!attempt) return null;
    return { attemptId: attempt.id, status: attempt.status };
  }

  publicStart(attempt) {
    return { attemptId: attempt.id, status: "pending", verificationUrl: attempt.verificationUrl, userCode: attempt.userCode };
  }

  retain(attempt) {
    attempt.output = "";
    const timer = setTimeout(() => this.attempts.delete(attempt.id), this.retentionMs);
    timer.unref?.();
  }
}

module.exports = { DeviceAuthManager, DeviceAuthError, parseDeviceAuthOutput };
