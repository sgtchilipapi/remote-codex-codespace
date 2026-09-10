# Define the findings acceptance contract

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Determine whether incompatible CLI Threads can be filtered](02-determine-cli-thread-filtering.md), [Specify Settings, Configuration, and Thread-entry states](03-specify-settings-configuration-and-thread-entry.md), [Specify assistant item grouping](04-specify-assistant-item-grouping.md), [Specify effective Status presentation](05-specify-effective-status-presentation.md), [Specify the Relay configuration and Status contract](07-specify-relay-configuration-and-status-contract.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Which observable Relay and Mobile Client acceptance criteria, automated tests, and focused manual checks are sufficient to implement every finding without regressing responsive layout, reconnectable Turns, Thread resume, accessibility, or desktop behavior?

## Resolution

Resolved on 2026-09-10. Acceptance is entirely automated: `npm test` is the single release gate and must run deterministic Node Relay contract tests followed by Chromium Playwright tests. The gate must require no live Codex process, Codespace, credentials, external network, screenshots, WebKit, or physical device. App-server behavior is represented by protocol fixtures in Relay tests; Relay routes and event streams are stubbed in browser tests.

Test every distinct externally observable outcome below, including its specified error or unavailable state, but do not multiply equivalent cases across every possible field combination.

### Relay contract tests

- **Configuration:** authenticated `GET /configuration` projects only picker-visible live models, their model-specific reasoning efforts and service tiers, Relay permission choices, and resolvable defaults. `POST /configuration/resolve` validates explicit and Default choices, returns one concrete Pre-Turn configuration and opaque revision, rejects unsupported combinations with stable field errors, and never starts or resumes a Thread.
- **Turn mapping and revision safety:** the first Turn uses exactly the resolved configuration revision and maps model, reasoning, permissions, and persistent Fast mode to the correct app-server fields. An obsolete revision returns `409` without starting a Turn. Explicit defaults, unsupported Fast mode, malformed IDs, authentication failures, capacity failures, and timeouts retain their specified status and sanitized envelopes.
- **Status scoping:** Status before a Turn is read-only and cannot create a Thread. Thread Status accepts only the Relay's eligible current Thread and distinguishes malformed (`400`), non-current (`409`), and missing or ineligible (`404`) identities without leaking another Thread's state.
- **Status data:** effective settings are initialized from start or resume, updated field-by-field by sparse settings notifications, and cleared on app-server disconnect. Context uses current-model-call usage rather than cumulative Thread usage. Five-hour and weekly limits are selected by 300- and 10080-minute duration, return independently nullable remaining/reset components, clamp remaining percentages, and merge sparse notifications into the last full read.
- **Partial failure and freshness:** independently sourced fields retain their own observation and stale state. A refresh failure preserves confirmed values and emits one sanitized retryable nonfatal error; never-confirmed fields remain unavailable. A partial useful snapshot returns `200`, while an upstream failure with no useful snapshot returns `502`.
- **Eligible Threads:** listing requests only `vscode` and `appServer` source kinds and revalidates the returned source plus all existing eligibility rules during list and resume. Known `cli` and `exec` Threads are excluded without probing; an allowed source is not treated as a guarantee that resume succeeds.
- **Resume and history:** a successful Resume returns chronological, ID-bearing canonical history and available effective settings. Item IDs survive live events and reconnect replay, Relay sequence deduplication remains intact, and existing bounded retention, concurrency, safe-error, and Turn-recovery tests continue to pass.
- **Compatibility removal:** repository clients and tests use `/configuration`, `/configuration/resolve`, and `/status`; an automated assertion or equivalent repository-level check prevents `/info` from remaining as a runtime dependency before that facade is removed.

### Chromium Mobile Client tests

- **Authentication and entry state:** first use automatically opens non-cancellable gear-triggered Settings. New, Resume, Configuration, and the composer remain disabled until authentication and live availability succeed. Later Settings edits are transactional and cancellable; pending, failure, cancellation, and successful token replacement preserve or reset exactly the state specified by [Specify Settings, Configuration, and Thread-entry states](03-specify-settings-configuration-and-thread-entry.md).
- **Focused views and accessibility:** Settings, Configuration, Resume, and expanded Status obey their mutual-exclusion rules; icon buttons have accessible names, focus enters and returns predictably, validation is associated with its control, status output remains a live region, interactive targets retain their established sizes and focus indicators, and no asynchronous update steals focus.
- **Configuration:** the AI-star action remains unavailable until capabilities load. Model changes constrain reasoning and Fast choices from the live catalog; Apply commits the whole draft atomically, Cancel discards it, invalid combinations retain the draft, and duplicate submission is prevented. An active Turn locks conflicting actions while leaving Status available.
- **New and reload:** New immediately creates only a local empty Thread view, never calls start or resume, enables the composer and Configuration, and shows and announces the concrete Pre-Turn configuration without a Thread ID. The first Turn uses that same revision. Reload restores an untouched local New view, while a persisted Thread locks input until rehydration and falls back safely when unavailable.
- **Resume:** the picker presents only Relay-returned Eligible Threads. Successful Resume atomically installs canonical history and reported effective settings; failures preserve the prior view. Resumed history never includes Activity bubbles, interrupted partial output, or Relay recovery artifacts.
- **Assistant and activity bubbles:** each `agentMessage` item ID owns exactly one provisional/completed assistant bubble. Multiple completed items never merge. Sequence replay and item reconciliation do not duplicate bubbles or text. Empty items render nothing; interrupted partial output remains labelled separately from its error and is not persisted. Activity categories render as one transient non-transcript bubble, transition only on normalized category changes, expose stable accessible labels without raw reasoning, and become a static ellipsis under reduced motion.
- **Status presentation:** before a first Turn, Status shows the resolved concrete Model, Reasoning, Fast mode, and Permissions plus `Context usage: Not started`. A real Thread shows confirmed effective values. Tests cover independently unavailable fields, live context occupancy, duration-matched remaining limits and reset times, local-time formatting, stale retained values, one unobtrusive retryable error, and refresh during an active Turn without interruption.
- **Reconnect and reader position:** dropped subscriptions replay each event once, reconcile item IDs, and preserve accumulated output and canonical ordering. Every delta, completion, replay, error, Activity transition, and older-history insertion follows only within 80 pixels of the bottom and otherwise retains the visible-message anchor.

### Viewport and regression matrix

Run geometry and overflow assertions at 320×568, 360×800, 390×844, 430×932, and 844×390, plus one desktop viewport at least 720 pixels wide. Width-independent behaviors may use one representative viewport.

Across the matrix, retain the existing Thread scroll ownership, visible composer, compact focused-view replacement, no page-level horizontal overflow, capped growing composer, safe-area behavior, reduced-motion behavior, semantic safe rendering of prose and code, and 720-pixel desktop content cap. The newly separated Settings and Configuration controls, Pre-Turn announcement, individual assistant bubbles, Activity bubble, and expanded Status content must fit these same contracts. Existing reconnectable-Turn, Thread-resume, accessibility, and desktop tests remain mandatory.

### Completion boundary

There is no manual acceptance gate. Cross-browser and real-device checks are deferred to [Validate the Mobile Client on iOS Safari and Android Chrome](../../../issues/validate-mobile-client-on-ios-safari-and-android-chrome.md), which remains on hold until implementation is complete. A browser-specific failure found later receives its own narrow regression coverage.

This decision adds no domain term and makes no architectural choice that requires an ADR; `CONTEXT.md` remains unchanged.
