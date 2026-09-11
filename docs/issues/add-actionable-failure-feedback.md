# Add actionable failure feedback across Relay boundaries

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

Replace user-visible catch-all failures with a structured, safe Failure feedback contract that identifies only the source supported by evidence, explains the affected operation, and offers the correct recovery without losing valid Mobile Client state.

## Problem Statement

The Mobile Client currently reports materially different failures as “Codex unavailable,” “Codex failed,” “Codespace unavailable,” or another screen-specific catch-all. The Relay discards Codex JSON-RPC error codes, typed Turn error information, retry state, child-process lifecycle detail, and terminal Turn outcomes before the Mobile Client can act on them. The Mobile Client then infers retryability from HTTP status or catches unrelated transport, decoding, Relay, Codespace, and Codex failures in the same branch.

As a result, the user cannot tell whether to retry, reconnect, correct Configuration, authenticate Codex, start the Codespace, choose a new Thread, or wait. Some failures are attributed to Codex or Codespace without evidence. Thread revalidation can destructively fall back to a new view after a transient failure, and English error prose has become an implicit machine-readable contract. Raw upstream detail cannot simply be forwarded because it may contain secrets, internal paths, commands, protocol data, or other unsafe content.

## Solution

Introduce one versioned Failure feedback model across Relay HTTP responses, streamed Turn events, and partial-success Status responses. Each failure carries a stable source-and-condition identity, affected operation, explicit retryability, a safe fallback message, an action, and an opaque diagnostic identity where applicable. The Mobile Client renders that structure in the surface where the operation occurred and preserves the user's valid state.

Classify failures only from structured evidence at the boundary that owns it. Distinguish Mobile Client, connection, Relay, Codespace, Codex, and unknown sources. Preserve Codex JSON-RPC errors, typed Turn error information, `willRetry`, and terminal status. A generic nonzero exit from the composite GitHub CLI, SSH, remote-shell, and Codex command remains unknown unless a separate structured Codespace state probe or Codex message establishes a narrower source. Never parse stderr or human-readable upstream prose to choose a public code.

The Relay owns normalization, safe redaction, and diagnostic correlation. The Mobile Client owns presentation and recovery behavior. Existing idempotent Turn creation and retained event replay remain the only automatic client retries; all other retryable failures present an explicit action.

## User Stories

1. As a mobile Codex user, I want a failed operation to identify the responsible source when it is known, so that I know which system needs attention.
2. As a mobile Codex user, I want uncertain failures labelled honestly as connection or unknown, so that I am not sent toward the wrong fix.
3. As a mobile Codex user, I want failure feedback to name the operation that failed, so that I know what did and did not change.
4. As a mobile Codex user, I want each failure to explain its immediate consequence, so that I can judge whether my Thread, Turn, transcript, or Configuration is intact.
5. As a mobile Codex user, I want a concrete recovery action when one is available, so that I can continue without guessing.
6. As a mobile Codex user, I want retry actions shown only when repeating the operation is safe, so that I do not accidentally duplicate a Turn.
7. As a mobile Codex user, I want the client to reconnect to an accepted Turn using its existing identity and event position, so that a network interruption does not restart my work.
8. As a mobile Codex user, I want to see when Codex itself is already retrying a Turn, so that I do not submit a duplicate retry.
9. As a mobile Codex user, I want terminal Codex failure, interruption, and completion to remain distinct, so that the displayed outcome matches the actual Turn lifecycle.
10. As a mobile Codex user, I want Codex context-window, Thread-budget, usage-limit, rate-limit, overload, authentication, sandbox, policy, and internal failures distinguished when Codex supplies a typed condition, so that the recovery advice fits the problem.
11. As a mobile Codex user, I want a generic Codex failure when Codex reports no stable subtype, so that speculative details are not presented as fact.
12. As a mobile Codex user, I want a stopped, missing, or inaccessible Codespace identified only after a structured state check confirms it, so that Codespace advice is trustworthy.
13. As a mobile Codex user, I want an ambiguous GitHub CLI, SSH, remote command, or pre-handshake process exit kept unknown, so that it is not falsely called a Codex or Codespace failure.
14. As a mobile Codex user, I want a browser fetch rejection described as a connection failure, so that DNS, TLS, CORS, Railway, and device connectivity are not falsely distinguished.
15. As a mobile Codex user, I want a missing or rejected Relay API token explained in the Settings panel, so that I can correct it in place.
16. As a returning user, I want a failed replacement token check to preserve my previously authenticated token, Thread, transcript, and Applied configuration, so that a typo does not destroy working state.
17. As a mobile Codex user, I want Configuration validation tied to the specific invalid field, so that I can repair the draft without re-entering valid choices.
18. As a mobile Codex user, I want an obsolete configuration revision refreshed through a stable code rather than English-message matching, so that first-Turn recovery remains reliable when wording changes.
19. As a mobile Codex user, I want Thread-list failures to keep the Resume view open with a Retry action, so that my current Thread remains untouched.
20. As a mobile Codex user, I want a failed explicit Resume to preserve the current Thread and transcript, so that selecting another Thread is atomic.
21. As a returning user, I want a transient reload revalidation failure to keep my cached Thread locked and recoverable, so that it is not erased merely because an upstream dependency is temporarily unavailable.
22. As a returning user, I want fallback to a local New view only when the saved Thread is definitively missing or ineligible, so that destructive recovery follows evidence.
23. As a mobile Codex user, I want older-history failures to leave loaded history and my reading position intact, so that I can retry pagination safely.
24. As a mobile Codex user, I want a rejected Turn creation to preserve the submitted prompt and explain whether I can edit, retry, or change Settings, so that my input is not lost.
25. As a mobile Codex user, I want an interrupted partial answer retained and marked according to the existing Turn recovery contract, so that useful output is not confused with completed output.
26. As a mobile Codex user, I want a Relay output-buffer failure identified as a Relay limit rather than a Codex failure, so that the reported source is accurate.
27. As a mobile Codex user, I want an expired retained Turn or invalid replay position distinguished from a connection interruption, so that the client stops reconnecting when recovery is no longer possible.
28. As a mobile Codex user, I want Status to retain confirmed values as stale when only refresh fails, so that one unavailable upstream field does not erase useful information.
29. As a mobile Codex user, I want unavailable Status fields kept distinct from operation failures, so that “not reported” is not presented as an incident.
30. As a mobile Codex user, I want failure feedback placed beside the control or content it affects, so that I do not have to search the interface for context.
31. As a screen-reader user, I want new failure feedback and recovery state announced once with the correct urgency, so that I receive the same actionable information without duplicate announcements.
32. As a narrow-screen user, I want the source, consequence, and primary action visible without horizontal scrolling, so that failure recovery works on a phone.
33. As a privacy-conscious user, I want raw stderr, commands, paths, tokens, credentials, protocol data, and arbitrary upstream messages excluded from the Mobile Client, so that diagnostics cannot leak sensitive information.
34. As a user asking for support, I want an opaque diagnostic identity I can copy, so that an operator can locate the corresponding safe server-side record.
35. As a Relay operator, I want diagnostic records to retain the original structured cause chain under redaction, so that I can investigate without weakening the public contract.
36. As a Relay operator, I want the same stable source-and-code pair across every operation, so that failures can be counted and compared consistently.
37. As a maintainer, I want unknown future failure codes to degrade to safe generic feedback, so that client and Relay deployments remain compatible.
38. As a maintainer, I want message wording decoupled from branching logic, so that copy can improve without changing behavior.
39. As a maintainer, I want every stable failure mapping documented and covered at the Relay boundary, so that catch-all regressions are detected.
40. As a maintainer, I want representative Mobile Client tests for each presentation and recovery pattern, so that coverage is complete without multiplying every code across every screen.

## Implementation Decisions

- Use six canonical sources: `mobile_client`, `connection`, `relay`, `codespace`, `codex`, and `unknown`. The source describes the deepest component established by structured evidence, not the component the user happened to be interacting with when the error surfaced.
- Treat `(source, code)` as the stable public identity. Codes are lower-snake-case conditions and do not contain operation names or user-facing prose. The initial catalog is:

  | Source | Stable conditions |
  | --- | --- |
  | Mobile Client | `validation_failed`, `unsupported_local_state` |
  | Connection | `relay_unreachable`, `stream_interrupted` |
  | Relay | `authentication_rejected`, `request_invalid`, `configuration_unsupported`, `configuration_obsolete`, `state_conflict`, `capacity_exceeded`, `retained_turn_unavailable`, `replay_position_invalid`, `output_limit_exceeded`, `upstream_timeout`, `dependency_missing`, `malformed_response`, `internal_failure` |
  | Codespace | `github_authentication_required`, `not_found`, `access_denied`, `not_running`, `github_service_unavailable` |
  | Codex | `protocol_rejected`, `context_window_exceeded`, `thread_budget_exceeded`, `usage_limit_exceeded`, `rate_limit_exceeded`, `server_overloaded`, `authentication_rejected`, `request_rejected`, `upstream_connection_failed`, `upstream_stream_failed`, `upstream_stream_disconnected`, `retry_exhausted`, `turn_not_steerable`, `sandbox_failed`, `thread_rollback_failed`, `policy_blocked`, `internal_failure`, `turn_failed` |
  | Unknown | `upstream_disconnected`, `upstream_failure` |

- Map the installed Codex `codexErrorInfo` values into the stable Codex conditions. Preserve the upstream wire value, JSON-RPC code, request method, `willRetry`, terminal status, and sanitized cause internally for diagnostics. Do not expose JSON-RPC `data`, `additionalDetails`, or raw message text by default.
- Preserve valid JSON-RPC error objects instead of replacing them with a generic exception. A correlated JSON-RPC error establishes Codex request rejection, but its broad numeric code alone does not establish a missing Thread, bad model, invalid Configuration, or authentication failure.
- Preserve terminal Codex Turn statuses exactly: `completed`, `failed`, and `interrupted`. An item-level error remains transcript content; it does not determine the Turn outcome. A Codex error notification with `willRetry: true` is a nonterminal “Codex is retrying” state for the existing Turn.
- Do not derive source from HTTP status, attempted operation, elapsed time, or upstream prose. A timer enforced by the Relay is `relay/upstream_timeout`; it does not prove which upstream component was slow.
- Treat any nonzero exit from the composite GitHub CLI, SSH, remote-shell, and Codex command as ambiguous. Do not parse stderr or assume any composite exit code has command-specific meaning. When useful, run a bounded read-only Codespace state probe after the failure. Attribute a Codespace condition only from that probe's structured result; otherwise retain `unknown/upstream_disconnected` or `unknown/upstream_failure`.
- Attribute failure to Codex after receiving a structured Codex error or Turn notification. A prior successful app-server handshake establishes that the connection reached Codex at that moment, but a later silent child exit can still be caused by SSH, Codespace lifecycle, or Codex and therefore remains unknown unless another structured signal narrows it.
- Replace message-only internal Relay errors with a failure object that separates public fields from a private cause. Every Relay-created failure receives a fresh opaque diagnostic identity and structured log record. Mobile Client-only and connection failures may omit the diagnostic identity when the Relay did not observe them.
- Use a versioned public failure object with `version`, `source`, `code`, `operation`, `retryable`, `message`, `action`, and optional `diagnosticId` and `fieldErrors`. `retryable` means the user may safely repeat the named operation now; it does not independently authorize automatic replay. `action` is a stable action kind, not display prose.
- Use stable operation identifiers for `settings.check`, `configuration.load`, `configuration.resolve`, `thread.list`, `thread.resume`, `thread.history`, `thread.revalidate`, `turn.create`, `turn.stream`, `turn.recover`, `status.read`, and `codespace.diagnostic`.
- Use stable action kinds for `retry`, `reconnect`, `open_settings`, `change_configuration`, `start_codespace`, `authenticate_github`, `authenticate_codex`, `start_new_thread`, and `none`. The Mobile Client supplies the visible action label and invokes the operation-specific behavior; it does not branch on the message.
- Preserve the legacy safe `error` string beside the structured `failure` object in non-success HTTP bodies for cached-client compatibility. Stream errors likewise retain a safe `message` beside `failure`. New Mobile Clients prefer `failure` and fall back to the legacy string only when talking to an older Relay. Do not add new behavior that depends on the legacy prose.
- Carry the same failure object in terminal Relay Turn error events. Keep replay-safe event identity and sequence semantics. A terminal failure event is followed by the authoritative Relay Turn-finished event; reconnecting subscribers receive both once.
- Use the same failure shape in the `errors` collection of partial-success Status snapshots. A Status field marked unavailable remains field state, not Failure feedback. A refresh failure preserves independently confirmed values as stale, reports one nonfatal failure, and offers Retry.
- Keep HTTP status meaningful for generic clients but secondary to the structured failure: `400` for malformed or unsupported input, `401` for Relay authentication rejection, `404` for confirmed missing/ineligible Thread or retained Turn, `409` for state or revision conflicts, `429` or `503` for the applicable Relay capacity boundary, `504` for Relay-enforced timeout, and `502` for a failed upstream operation with no useful response. Do not infer retryability from these statuses in the Mobile Client.
- The Mobile Client validates the failure envelope before using it. A fulfilled Relay response with invalid JSON, invalid NDJSON, missing required fields, or invalid event sequencing becomes `relay/malformed_response`. A rejected fetch becomes `connection/relay_unreachable`; an early event-stream failure becomes `connection/stream_interrupted` until replay establishes a terminal result.
- Render the source as a short visible label followed by a concise consequence and instruction. Representative forms are: “Codex · Context window full. This Turn stopped. Start a new Thread or shorten the prompt.”; “Codespace · Codespace is stopped. This Turn did not start. Start the Codespace, then retry.”; “Relay · Busy. This Turn did not start. Retry in a moment.”; and “Connection · Relay could not be reached. Check your connection and retry.”
- Keep diagnostic identity and technical-safe secondary context behind an optional details affordance or copy action. The primary message must remain understandable without expanding details. Never render raw causes.
- Place Settings and Configuration failures inside their respective panels and focus the invalid field when applicable. A failed later Settings check restores the previously committed authenticated state. Configuration failures retain the complete draft and its valid field values.
- Keep Thread-list failures inside the Resume view with an explicit Retry. Failed explicit Resume and history pagination preserve the prior Thread, transcript, effective state, loaded history, picker state, and reading anchor.
- During reload revalidation, fall back to a local New view only for a confirmed missing or ineligible Thread. Connection, unknown, Codespace, Codex, timeout, and malformed-response failures retain the cached Thread in a locked recovery state with Retry and New actions; they do not silently clear it.
- Preserve a submitted prompt and its Turn identity across uncertain Turn-creation failures. Retry idempotent creation with the same identity only for connection interruption or a failure explicitly approved for automatic retry. Definitive validation, authentication, conflict, and unsupported-Configuration failures stop automatic retry and show the corresponding repair action.
- Continue an accepted Turn exclusively through event subscription and replay from the last sequence. Never repeat `turn/start` because Codex reports an error, because `willRetry` is false, or because the stream disconnects. Stop reconnecting when the Relay reports a definitive retained-Turn or replay-position failure.
- Preserve existing interrupted-partial behavior: retain and mark partial assistant output while Relay recovery remains possible, keep terminal Failure feedback in a separate replay-safe error bubble, and discard only the insignificant provisional artifact when recovery is definitively unavailable and canonical history cannot reconstruct it.
- Treat Relay capacity, subscriber, retention, replay-position, and output-buffer failures as Relay conditions. They must never be rewritten as Codex failures.
- Use polite, direct copy that states what happened, what was preserved, and what to do next. Avoid “whatsoever,” stack terminology, blame without evidence, and repeated “unavailable” when a narrower confirmed condition exists.
- Announce blocking failures with an alert semantic once. Announce reconnecting, Codex retrying, stale Status, and successful recovery as status updates. Do not duplicate the same feedback in both the transcript and global status unless one is a short lifecycle summary and the other is the persistent Turn record.
- Log diagnostic identity, timestamp, operation, public source and code, HTTP or stream context, request/Turn/Thread correlation identifiers where safe, upstream structured code/type, child exit and signal, and a redacted cause chain. Never log Relay API tokens, GitHub tokens, prompt or response content merely to diagnose transport, raw authorization headers, or unsanitized upstream bodies.
- Unknown future source/code pairs render a safe operation-based fallback, preserve state according to the explicit `retryable` and `action` fields, and expose the diagnostic identity. Clients ignore unknown optional fields. Unsupported envelope versions fall back to a safe Relay-response failure without showing raw payload content.

## Testing Decisions

- Test external behavior rather than classifier helper implementation. A good test sends a request or drives the Mobile Client, supplies one authoritative boundary signal, and asserts the public source/code, safe message/action, retry behavior, state preservation, and absence of private detail.
- Keep two established high-level seams. Relay contract tests call the authenticated HTTP and streamed-Turn APIs with stubbed app-server and injected child-process behavior. Chromium behavior tests drive the Mobile Client while stubbing complete Relay responses and streams. No new lower-level seam is required unless a child lifecycle condition cannot be produced through the existing Relay fixture.
- Extend Relay contract coverage with one authoritative case for every stable source/code mapping, including Codex JSON-RPC errors, every supported typed Codex Turn condition, `willRetry`, terminal failed/interrupted/completed status, Relay validation/conflict/capacity/retention/buffer/timeout failures, ambiguous composite child exit, structured Codespace probe outcomes, malformed upstream framing, and unknown fallback.
- Assert that generic composite command exits remain unknown and that stderr or upstream message changes cannot alter the public taxonomy. Assert that Relay-enforced timeout is not labelled Codex timeout.
- Assert HTTP and stream envelope compatibility: structured fields, legacy safe string, diagnostic identity, HTTP status, Turn event sequence and identity, partial-success Status errors, unknown fields, unknown codes, and unsupported versions.
- Assert redaction with adversarial secrets, tokens, authorization headers, internal paths, commands, prompts, upstream bodies, JSON-RPC data, additional details, and stderr. Public responses and browser-visible state must contain none of them; diagnostic logs must contain only the explicitly allowed redacted structure.
- Extend Chromium behavior tests with representative patterns rather than every code on every screen: inline Settings authentication, field-level Configuration correction, Resume Retry, atomic Resume preservation, locked revalidation recovery versus definitive New fallback, history Retry with reading-anchor preservation, Turn creation repair, Codex-retrying state, terminal Turn error bubble, replay reconnect, retained-Turn terminal recovery, stale Status, unknown-code fallback, and copyable diagnostic identity.
- For every representative Mobile Client pattern, assert visible source/consequence/action, correct action target, preserved local state, focus placement, one screen-reader announcement, absence of duplicated alerts, and usable narrow-screen wrapping. Continue the established responsive viewport coverage.
- Assert that automatic retry occurs only for idempotent Turn creation with the same identity and retained Turn event replay. HTTP status alone, a typed Codex condition, and `willRetry: false` must not cause client replay.
- Assert compatibility in both directions: the new Mobile Client safely consumes the legacy message-only Relay response, and a legacy-style consumer still receives a safe string from the new Relay response.
- Keep the existing full Node Relay and Chromium suite as the release gate. Existing tests for safe history errors, disconnect survival, replay deduplication, output bounds, Settings transactions, Configuration revisions, atomic Resume, cached Thread revalidation, interrupted output, Status freshness, accessibility, focus, and responsive layout are prior art and must remain passing.

## Out of Scope

- Changing GitHub Codespaces, GitHub CLI, SSH, Railway, or Codex app-server behavior.
- Reliably distinguishing DNS, TCP, TLS, CORS, Railway routing, browser offline state, or Relay process outage after a rejected fetch.
- Inferring Codespace, SSH, remote-shell, missing-Codex, or Codex-crash causes from a generic composite command exit or stderr wording.
- Exposing raw upstream errors, secrets, credential material, prompts, response content, commands, internal paths, JSON-RPC data, or arbitrary protocol content to the Mobile Client.
- Automatically replaying non-idempotent Codex operations or creating a replacement Turn after a failure.
- A general multi-user observability, telemetry, alerting, or incident-management platform.
- Redesigning unrelated Mobile Client layout, transcript grouping, Configuration behavior, Status data, or Thread eligibility.
- Changing the meaning of existing Status field-level unavailable and stale states except to carry structured refresh Failure feedback.

## Further Notes

- This specification synthesizes the accepted direction in [Specify actionable failure feedback](../wayfinder/actionable-failure-feedback/map.md).
- The evidence and uncertainty rules come from [Observable failure signals](../wayfinder/actionable-failure-feedback/assets/observable-failure-signals.md), researched against primary Codex, GitHub, Fetch, and Node sources plus the installed Codex schema.
- The highest test seams were already accepted in the design conversation: authoritative Relay contract coverage for every mapping and representative Mobile Client behavior coverage for presentation, recovery, state preservation, accessibility, and redaction.
- The research corrected an important attribution temptation: even though the GitHub CLI documents general exit codes, the composite `gh codespace ssh` remote-command path has no command-specific structured exit contract. Treat every nonzero composite exit as ambiguous unless a separate structured probe narrows it.

## Resolution

Implemented on 2026-09-11. The Relay now emits a shared versioned Failure feedback contract across HTTP, Turn streams, and Status; preserves structured Codex and process-boundary evidence in redacted diagnostics; and retains legacy safe strings. The Mobile Client validates source/code pairs, presents contextual recovery actions and diagnostic IDs, preserves valid Settings, Configuration, Thread, transcript, prompt, and accepted-Turn state, and limits automatic recovery to idempotent creation and retained replay. The Wayfinder decisions were closed into the accepted map. The complete `npm test` release gate passed with 38 Node tests and 55 Chromium tests.
