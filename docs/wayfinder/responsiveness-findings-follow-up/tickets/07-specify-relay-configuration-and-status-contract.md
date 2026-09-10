# Specify the Relay configuration and Status contract

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Specify Settings, Configuration, and Thread-entry states](03-specify-settings-configuration-and-thread-entry.md), [Specify effective Status presentation](05-specify-effective-status-presentation.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Given the decided Settings, Configuration, Thread-entry, and Status behavior, what authenticated Relay routes, request/response fields, notification state, validation, freshness rules, and safe failure envelopes should expose model/reasoning/Fast availability, requested pre-Turn configuration, effective Thread settings, context occupancy, and duration-matched rate-limit windows to the Mobile Client?

## Resolution

Expose Configuration capabilities, exact pre-Turn resolution, and Status as separate authenticated Relay concerns. Preserve `/info` only as a temporary compatibility facade while callers migrate; it is not the final contract.

### Routes and ownership

- `GET /configuration` loads the live catalog and Codex defaults. Return picker-visible models with `id`, `name`, `isDefault`, supported reasoning efforts, the suggested default reasoning effort, advertised service tiers, and the default service tier. Also return the Relay permissions choices and the concrete Codex defaults that are currently resolvable. Do not return rate limits here.
- `POST /configuration/resolve` is read-only despite using POST. It accepts `{ model, reasoning, permissions, fastMode }`, where each field may explicitly request `default`, validates the combination against the same live catalog, and returns the concrete **Pre-Turn configuration** plus an opaque `configurationRevision`. It must not start or resume a Thread.
- `GET /status` without a `threadId` returns the last Pre-Turn configuration resolved for the authenticated Mobile Client, `Context usage: Not started`, rate-limit windows, and freshness metadata. It must not create a Thread.
- `GET /status?threadId=<uuid>` returns only the snapshot belonging to that eligible, Relay-current Thread. Reject malformed IDs with `400`, an eligible but non-current ID with `409`, and missing or ineligible Threads with `404`; never fall back to another Thread's cached values.
- Continue to use `POST /threads/:id/resume` and `POST /turn` for mutation. A successful resume response must include the Codex-confirmed effective model, reasoning, service tier/Fast state, sandbox policy, approval policy, and permission-profile data that are available. `/turn` accepts the four Applied configuration fields and resolves them server-side; the first Turn must use the same `configurationRevision` snapshot Status displayed, or reject an obsolete revision with `409` so the client can resolve again.

### Canonical fields

- Represent model and reasoning with protocol IDs, permissions as `{ sandboxPolicy, approvalPolicy, profile }` when effective and as the Mobile Client's allowed choice ID before a Turn, and Fast mode as `{ enabled, serviceTier }`. `enabled` is true only for the advertised Fast tier (currently protocol tier `priority`); an unknown non-Fast tier is not silently called off.
- Each Status field is independent. A confirmed field is `{ value, observedAt, stale }`; a field never confirmed is `{ unavailable: true, reason }`. Reasons are a small safe enum such as `not_started`, `not_reported`, `unsupported`, or `upstream_unavailable`, never raw app-server, SSH, filesystem, account, or token details.
- Return context as current-model-call tokens, model context-window tokens, and the derived percentage. Never substitute cumulative Thread tokens. Before a first model call, or when either operand was not reported, context is unavailable (and the Mobile Client renders the previously decided `Not started` only for a local New view).
- Return rate limits as named `fiveHour` and `weekly` values, each containing independently nullable `remainingPercent` and `resetsAt`, plus observation/freshness data. Select windows by `windowDurationMins === 300` and `10080`, calculate and clamp `100 - usedPercent`, and never expose primary/secondary positioning as meaning.

### Validation and app-server mapping

- Validate model existence and visibility, reasoning support for the selected model, Fast-tier support for that model, the Relay permissions allowlist, UUIDs, and the configuration revision before starting a Turn. Reject invalid combinations with `400` and stable field errors; never let unsupported values drift through to Codex.
- Resolve defaults with `config/read` plus `model/list`, but treat the catalog as the availability authority. Send new-Thread model and sandbox values to `thread/start`; send reasoning as `effort`, permissions as `sandboxPolicy` plus the corresponding approval policy, and persistent Fast selection as `serviceTier` on the first `turn/start`. Do not send the currently invalid `effort` field to `thread/start`, `permissions` to `turn/start`, or one-Turn-only `serviceTierForTurn` for Applied configuration.
- Capture effective model, reasoning, service tier, sandbox, and approval values from `thread/start` or `thread/resume`, then supersede individual fields from `thread/settings/updated`. Missing later fields do not erase earlier confirmed fields unless the protocol explicitly reports a null value whose meaning is known.

### Notification and freshness state

- Install one Relay-level notification listener for the lifetime of the app-server connection, not a listener scoped only to an active Turn. Maintain bounded in-memory snapshots keyed by Thread ID for `thread/settings/updated` and `thread/tokenUsage/updated`, and merge sparse `account/rateLimits/updated` notifications into the last full account read.
- A Thread snapshot is current only for the Relay's selected Thread. Clear all notification-derived snapshots and configuration revisions when the app-server disconnects or restarts; clear selected-Thread identity when the Mobile Client enters New, and replace it only after a successful resume or Thread start. Never persist context occupancy in browser storage.
- Each Status request attempts a fresh `account/rateLimits/read` without interrupting an active Turn. Effective settings and context use the latest captured notifications because the installed protocol has no equivalent read request. Return `observedAt` per independently sourced value and a response `generatedAt`; the browser owns local-time reset formatting.

### Failure envelope

- Return partial `200` responses whenever at least one useful, correctly scoped value exists. If refreshing a source fails, retain its last confirmed values, mark them stale, and add one sanitized nonfatal error with `retryable: true`; never erase unrelated known fields.
- Use `401` for authentication failure, `400` for malformed or unsupported input, `404` for missing/ineligible Threads, `409` for selected-Thread or configuration-revision conflicts, `503` for Relay capacity, and `504` for timeout. Return `502` only when no useful snapshot can be produced from an upstream failure.
- The compatibility `/info` facade may project the new Configuration and rate-limit shapes for old clients, but new behavior must depend only on the three explicit read contracts above. Remove it after the client migration and regression suite no longer exercise it.
