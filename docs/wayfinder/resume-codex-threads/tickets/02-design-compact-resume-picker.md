# Complete the minimal Thread resume specification

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Define useful parity with Codex CLI resume](01-define-resume-parity.md)
Parent: [Resume existing Codex Threads from the Mobile Client](../map.md)

## Question

What is the smallest implementation-ready specification that completes the agreed Thread-resume capability, covering the compact picker, Relay/app-server access, pagination, state transitions, failure recovery, and proportionate acceptance checks while inheriting existing Mobile Client conventions wherever possible?

## Resolution

Resolved on 2026-09-09 under the user's standing instruction to accept the smallest safe recommendations. Implement the following contract without adding Thread administration, search, or a separate navigation system.

### Codex lifecycle

- Maintain one lazy, reusable `codex app-server --stdio` process through one Codespace SSH child per Relay process. Initialize it once, correlate JSON-RPC responses with monotonically increasing IDs, and keep a bounded pending-request map.
- Use app-server `thread/start` and `turn/start` for new Threads and subsequent Turns. Before continuing a Thread not loaded in the current app-server process, resume it by ID without overrides. Preserve the Mobile Client's existing `POST /turn` request and NDJSON streaming response externally. This migration is required because today's `codex exec` creates non-interactive Threads, which the agreed picker correctly excludes.
- On app-server or SSH exit, reject pending operations, discard the connection, and reconnect on the next request. Never replay a mutating request automatically. Terminate the child during Relay shutdown.
- Existing non-interactive `codex exec` Threads remain excluded and are not migrated. Threads created after this change are interactive and therefore discoverable.

### Authenticated Relay API

All routes use the existing bearer authorization. The Relay owns every eligibility filter; the Mobile Client cannot provide a working directory, source kind, archived flag, sort key, search term, or page size.

- `GET /threads?cursor=<opaque>&currentThreadId=<uuid>` calls `thread/list` with the exact resolved `CODESPACE_WORKDIR`, `archived: false`, the app-server's declared interactive-source default, `sortKey: recency_at`, descending order, and a fixed limit of 20. Drop results with neither a nonblank name nor preview. Return `{ threads, nextCursor }`, where each row is `{ id, title, preview, lastActive, model, current }`; `title` is the name or preview fallback, and `current` is computed only against the validated optional `currentThreadId`.
- `POST /threads/:id/resume` validates the UUID, uses `thread/read` with `includeTurns: false` to verify eligibility before resuming, then calls `thread/resume` with `excludeTurns: true` and no model, reasoning, permission, cwd, or other overrides. Recheck the canonical working directory returned by resume. A missing, guessed, cross-working-directory, archived, non-interactive, or unrecognizable ID returns the same `404` without disclosing why. Fetch the newest 20 Turns with full item data, sanitize them, reverse them into chronological display order, and return `{ thread, messages, olderCursor }`. This operation starts no Turn.
- `GET /threads/:id/history?cursor=<opaque>` revalidates eligibility, fetches the next 20 older Turns, de-duplicates inclusive cursor anchors by stable Turn/item ID, and returns `{ messages, olderCursor }` in chronological order for prepending.
- List cursors and history cursors are opaque and non-interchangeable. Reject absent required cursors, malformed UUIDs, or cursors over 4 KiB with `400`. Use a 30-second metadata timeout, cap concurrent pending metadata calls at 32, and return `503` when saturated.
- Normalize non-streaming failures to the existing `{ error }` envelope: `400` invalid input, `401` failed bearer authentication, indistinguishable `404` absent/ineligible Thread, `409` conflicting active operation, `502` Codespace/app-server/protocol failure, `503` capacity unavailable, and `504` timeout. Messages never expose tokens, commands, raw protocol data, stderr, or Codespace paths.
- Allow only one active Turn per Thread. Resume and Thread-changing actions conflict with an active Turn. A client disconnect cancels its Turn through app-server rather than killing the shared process.

History normalization retains user prompts, Codex responses, and material errors as safe text with stable IDs. Skip operational items unless their omission would make the visible sequence misleading. Preserve the existing safe plain-text and fenced-code rendering contract.

### Compact Mobile Client

- Add **Resume** to the top bar beside **New** and **Configure**. Disable all Thread-changing controls during startup configuration checking, Configuration Apply, Thread hydration, or an active Turn.
- **Resume** opens a focus-mode view that replaces the Thread, status, and composer, just as Configuration does. It has the heading **Resume a Thread** and **Cancel**. Opening focuses the heading; Cancel changes no state, returns to the Thread, and restores focus to **Resume**.
- Load the newest Eligible Threads on open. Each result is one full-width button with a minimum 44px target showing title, concise preview, localized last-active date/time, and model. Keep the current Thread in order, label it **Current** in its accessible name, and disable it. Show **No Threads to resume** when empty.
- Do not add search or infinite scrolling to the picker. When `nextCursor` exists, show one **Load more** button that appends results. Initial and paging failures are inline and retryable; Cancel remains available and loaded results remain intact.
- Selecting a result disables picker actions and announces loading. Keep the current Thread and its browser cache untouched until resume metadata and the newest history page both succeed. Success atomically installs the new Thread ID and authoritative messages, closes the picker, renders at the bottom in follow mode, and focuses the composer without starting a Turn. Failure leaves the previous Thread untouched and the picker open; remove or disable a row that has become unavailable.
- At the top of restored history, automatically request one older page at a time. Prepend it without duplicates and preserve the prior top-visible message and pixel offset. Show a retry control at the top on failure; already loaded history remains usable. Stop when `olderCursor` is null.
- Browser storage may cache the selected ID and rendered messages only as presentation state. On reload, rehydrate a cached ID from the Relay before treating it as current. If it is stale or ineligible, start a new empty Thread and announce the fallback without rendering stale cached history as authoritative.

### Configuration and continuation

- Relay authentication always uses the token from the applied configuration.
- A resumed Thread initially uses its persisted Codex configuration: subsequent `/turn` requests omit model, reasoning, and permissions overrides. Display only persisted values the app-server actually reports; never infer a permission value from the Mobile Client.
- The applied configuration remains the default for new Threads and is not silently mutated by selection. If the user explicitly opens and successfully applies Configuration while viewing a resumed Thread, announce that the applied values will override that Thread on later Turns and include those overrides from then on. Selecting or reselecting a persisted Thread resets it to persisted-configuration mode.

### Acceptance boundary

- Server tests with a stub app-server prove fixed eligibility filters and recency ordering, opaque cursor forwarding, blank-row removal, read-time eligibility revalidation, indistinguishable cross-working-directory `404`, history normalization/de-duplication, no resume overrides, no Turn on selection, authentication, input bounds, concurrency, timeouts, and safe upstream errors. A Thread created through the Mobile Client must appear on the next eligible listing.
- Playwright tests with stubbed Relay responses prove Resume locking, focus and Cancel behavior, row content, Current and empty states, **Load more**, atomic selection, no implicit Turn, failure preservation/retry, chronological newest history at the bottom, anchored upward pagination, safe rendering, reload revalidation, persisted-configuration continuation, and unchanged **New** and Configuration behavior.
- Run new browser cases at one representative 320px viewport and one desktop viewport. Reuse the existing responsive suite for broader regression coverage; add no screenshot framework or device matrix. Add one short iPhone Safari and Android Chrome smoke check: open Resume, select a Thread, load older history, and send a continuation.

No new domain term or durable cross-system architectural commitment is needed beyond **Eligible Thread**, so this decision adds no glossary entry or ADR. The specification reaches the map's Destination; implementation is the next activity, outside this planning map.
