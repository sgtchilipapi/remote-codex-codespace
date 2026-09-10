# Expose and present effective Status end to end

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: [Make New a revision-safe local Thread entry](10-make-new-revision-safe-local-entry.md), [Resume Eligible Threads with canonical effective state](11-resume-eligible-threads-with-effective-state.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Implement scoped Status snapshots from Relay notification and account data through the existing Mobile Client Status action. Show concrete pre-Turn or Codex-confirmed configuration, current-model-call context occupancy, duration-matched five-hour and weekly limits, localized resets, and independent freshness without interrupting an active Turn.

- [x] Relay snapshots remain scoped to the current Eligible Thread, merge sparse settings, token-usage, and rate-limit updates, clear on disconnect, and return safe partial-success or unavailable envelopes.
- [x] The Mobile Client presents each field independently, retains confirmed values as stale after refresh failure, formats reset times locally, and offers one unobtrusive retry action.
- [x] Relay and Chromium tests cover pre-Turn read-only Status, effective updates, malformed and conflicting identities, partial failures, active-Turn refresh, accessibility, and responsive layout.

## Resolution

Implemented authenticated, Thread-scoped Status snapshots backed by pre-Turn resolution, Codex-confirmed start/resume state, sparse settings and token-usage notifications, and duration-matched account limits. The existing Mobile Client Status action now renders independently available fields, local reset times with accessible timezone labels, stale data, and a single retry action while remaining usable during active Turns. Relay and Chromium coverage is included in the repository's passing `npm test` gate.
