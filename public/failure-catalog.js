(function publishFailureCatalog(root, factory) {
  const catalog = factory();
  if (typeof module === "object" && module.exports) module.exports = catalog;
  if (root) root.FailureCatalog = catalog;
})(typeof window === "object" ? window : null, () => {
  const sources = {
    mobile_client: {
      validation_failed: ["Check the highlighted value and try again.", "none", false],
      unsupported_local_state: ["This saved state is not supported. Start a new Thread.", "start_new_thread", false],
    },
    connection: {
      relay_unreachable: ["Relay could not be reached. Check your connection and retry.", "retry", true],
      stream_interrupted: ["The Turn connection was interrupted. Reconnecting to the existing Turn.", "reconnect", true],
    },
    relay: {
      authentication_rejected: ["The API token was rejected. Check it and try again.", "open_settings", false],
      request_invalid: ["The request could not be accepted. Check it and try again.", "none", false],
      configuration_unsupported: ["The Configuration is not supported. Check the highlighted values.", "change_configuration", false],
      configuration_obsolete: ["Configuration options changed. Refresh them and try again.", "change_configuration", true],
      state_conflict: ["The operation conflicts with the current Relay state. Try again when it is idle.", "retry", true],
      capacity_exceeded: ["Relay is busy. Retry in a moment.", "retry", true],
      retained_turn_unavailable: ["This Turn is no longer retained. Start a new Thread or resume its Thread.", "start_new_thread", false],
      replay_position_invalid: ["Turn recovery can no longer continue from this position.", "start_new_thread", false],
      output_limit_exceeded: ["This Turn exceeded the Relay output limit and was stopped.", "none", false],
      upstream_timeout: ["Relay timed out waiting for the upstream operation. Retry it.", "retry", true],
      dependency_missing: ["Relay could not start a required dependency.", "none", false],
      malformed_response: ["Relay received a malformed upstream response. Retry the operation.", "retry", true],
      internal_failure: ["Relay could not complete the operation. Retry it.", "retry", true],
    },
    codespace: {
      github_authentication_required: ["GitHub authentication is required before this Codespace can be reached.", "authenticate_github", false],
      not_found: ["The Codespace was not found. Check Settings before trying again.", "open_settings", false],
      access_denied: ["Access to the Codespace was denied. Check GitHub access.", "authenticate_github", false],
      not_running: ["The Codespace is stopped. Start it, then retry.", "start_codespace", false],
      github_service_unavailable: ["GitHub could not report the Codespace state. Retry in a moment.", "retry", true],
    },
    codex: {
      protocol_rejected: ["Codex rejected the protocol request. Retry the operation.", "retry", true],
      context_window_exceeded: ["The context window is full. This Turn stopped. Start a new Thread or shorten the prompt.", "start_new_thread", false],
      thread_budget_exceeded: ["This Thread reached its budget. Start a new Thread.", "start_new_thread", false],
      usage_limit_exceeded: ["The Codex usage limit was reached. Wait for it to reset before trying again.", "none", false],
      rate_limit_exceeded: ["Codex is rate limited. Wait before trying again.", "none", false],
      server_overloaded: ["Codex is overloaded. Retry in a moment.", "retry", true],
      authentication_rejected: ["Codex authentication was rejected. Authenticate Codex, then retry.", "authenticate_codex", false],
      request_rejected: ["Codex rejected this Turn. Check the prompt and Configuration.", "change_configuration", false],
      upstream_connection_failed: ["Codex could not reach its upstream service.", "retry", true],
      upstream_stream_failed: ["Codex could not open its response stream.", "retry", true],
      upstream_stream_disconnected: ["Codex lost its response stream.", "retry", true],
      retry_exhausted: ["Codex exhausted its retry attempts. Retry when the service recovers.", "retry", true],
      turn_not_steerable: ["This Turn cannot accept that input.", "none", false],
      sandbox_failed: ["Codex could not apply the requested sandbox. Change Configuration and retry.", "change_configuration", false],
      thread_rollback_failed: ["Codex could not restore the Thread after the failed Turn. Start a new Thread.", "start_new_thread", false],
      policy_blocked: ["Codex policy blocked this Turn.", "none", false],
      internal_failure: ["Codex encountered an internal failure. Retry the Turn.", "retry", true],
      turn_failed: ["Codex could not complete this Turn. Retry when ready.", "retry", true],
    },
    unknown: {
      upstream_disconnected: ["The upstream connection ended unexpectedly. Reconnect to the existing Turn.", "reconnect", true],
      upstream_failure: ["An upstream operation failed. Retry it.", "retry", true],
    },
  };

  return {
    version: 1,
    sources,
    actions: ["retry", "reconnect", "open_settings", "change_configuration", "start_codespace", "authenticate_github", "authenticate_codex", "start_new_thread", "none"],
    sourceLabels: { mobile_client: "Mobile Client", connection: "Connection", relay: "Relay", codespace: "Codespace", codex: "Codex", unknown: "Unknown" },
    recoveryTargets: {
      start_codespace: "https://github.com/codespaces",
      authenticate_github: "https://github.com/login",
      authenticate_codex: "https://chatgpt.com/codex",
    },
    codexErrorCodes: {
      contextWindowExceeded: "context_window_exceeded",
      sessionBudgetExceeded: "thread_budget_exceeded",
      usageLimitExceeded: "usage_limit_exceeded",
      rateLimitExceeded: "rate_limit_exceeded",
      serverOverloaded: "server_overloaded",
      unauthorized: "authentication_rejected",
      badRequest: "request_rejected",
      httpConnectionFailed: "upstream_connection_failed",
      responseStreamConnectionFailed: "upstream_stream_failed",
      responseStreamDisconnected: "upstream_stream_disconnected",
      responseTooManyFailedAttempts: "retry_exhausted",
      activeTurnNotSteerable: "turn_not_steerable",
      sandboxError: "sandbox_failed",
      threadRollbackFailed: "thread_rollback_failed",
      cyberPolicy: "policy_blocked",
      misalignmentPolicyViolation: "policy_blocked",
      internalServerError: "internal_failure",
      other: "turn_failed",
    },
  };
});
