# Add Relay-managed Codex device authentication

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

Replace the Mobile Client's static “Authenticate Codex” link with a Relay-managed device-login flow for the target Codespace. When Failure feedback has action `authenticate_codex`, the Relay should run `codex login --device-auth` inside that Codespace and the Mobile Client should present the resulting verification link and one-time code without requiring terminal access.

This is a focused follow-up to [Add actionable failure feedback across Relay boundaries](add-actionable-failure-feedback.md). Do not redesign general authentication, Failure feedback, or Turn lifecycle behavior.

## Implementation

- Add authenticated Relay endpoints for one process-local Codex device-auth attempt:
  - `POST /codex/device-auth` starts `codex login --device-auth` through the existing Codespace command boundary. Only one attempt may run at a time. Wait only until the verification URL and user code are available, then return `202` with an opaque attempt ID, `status: "pending"`, `verificationUrl`, and `userCode`.
  - `GET /codex/device-auth/:attemptId` returns `pending`, `succeeded`, `expired`, or `failed`. Attempts expire after five minutes and are discarded after a bounded retention period.
- Add the stable operation `codex.authenticate`. Use the existing versioned Failure feedback envelope for endpoint failures. Preserve structured evidence when available; keep an ambiguous Codespace/SSH/process exit `unknown`.
- Keep the child process alive after returning the code so it can observe completion. Bound captured output to 64 KiB, terminate timed-out or overflowing attempts, and clean up the process when the attempt expires.
- Put parsing behind a small device-auth adapter. It may recognize only the installed CLI's expected device-auth output and must validate:
  - an HTTPS verification URL on an approved OpenAI authentication host;
  - a one-time code containing only uppercase ASCII letters, digits, and hyphens, with a maximum length of 32 characters.
- Never return or log raw stdout, stderr, commands, credentials, tokens, internal paths, or unmatched output. Unexpected output becomes safe `relay/malformed_response` Failure feedback with a diagnostic ID.
- Replace the current `authenticate_codex` behavior in the Mobile Client:
  - start the Relay attempt instead of opening `https://chatgpt.com/codex` directly;
  - show the verification URL as an “Open login page” link;
  - show the user code with a “Copy code” button;
  - poll the attempt while the authentication card is visible;
  - announce pending, success, expiry, and failure once using the existing alert/status conventions.
- Preserve the current Thread, transcript, Configuration, draft, and any retained accepted-Turn recovery state throughout the flow. Authentication success must not automatically create a replacement Turn. If an accepted Turn is still recoverable, resume its existing event subscription; otherwise leave the user in the existing view to retry explicitly.
- A page reload may discard the in-browser presentation. The Relay attempt may remain alive until its normal expiry; durable or multi-user attempt storage is out of scope.

## Acceptance Criteria

1. Selecting “Authenticate Codex” starts exactly one `codex login --device-auth` command in the configured Codespace and does not navigate directly to the generic Codex webpage.
2. The Mobile Client displays a validated OpenAI verification link and one-time code, with separate usable Open and Copy actions on a 320-pixel-wide viewport.
3. Copy copies only the device code. Neither the response, DOM, browser storage, nor diagnostic logs contain unmatched command output or secret fixture values.
4. Chunked output is handled correctly when the URL or code spans process-output chunks.
5. Polling reports success, expiry, and safe failure without starting a Turn or losing valid Mobile Client state.
6. Concurrent start requests reuse the active attempt or return a stable Relay conflict; they never spawn two login processes.
7. Timeout, output overflow, malformed output, child spawn failure, and ambiguous nonzero exit are bounded and use the existing structured Failure feedback contract.
8. Relay contract tests use an injected child process to cover parsing, bounds, lifecycle, classification, and redaction. Chromium tests cover the action, link, copy control, polling states, accessibility announcement, narrow-screen layout, and state preservation.

## Out of Scope

- Implementing OpenAI OAuth or device authorization directly instead of invoking the installed Codex CLI.
- Returning arbitrary terminal output to the Mobile Client.
- Persisting login attempts across Relay restarts or supporting multiple simultaneous users.
- Automatically replaying a terminally failed Turn after authentication.

## Resolution

Implemented Relay-managed Codex device authentication through the existing Codespace command boundary. The Relay now validates and safely exposes the installed CLI's verification URL and device code, bounds process lifetime/output/retention, reuses an active attempt, and reports terminal status through authenticated endpoints. The Mobile Client presents accessible Open and Copy actions, polls visible attempts, preserves existing client state, and resumes only a still-recoverable accepted Turn after success. Relay contract and Chromium coverage exercise parsing, lifecycle, redaction, polling states, narrow layout, and state preservation.
