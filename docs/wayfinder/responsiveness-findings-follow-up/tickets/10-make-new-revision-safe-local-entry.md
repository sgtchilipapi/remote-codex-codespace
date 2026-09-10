# Make New a revision-safe local Thread entry

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: [Add capability-driven Configuration with Fast mode](09-add-capability-driven-configuration.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Make New enter a fresh local Thread view without starting Codex, resolve one concrete Pre-Turn configuration and opaque revision, and use that exact snapshot for the first Turn. Present and announce the configuration without a Thread ID, and reject an obsolete revision before any Turn starts.

- [x] New immediately enables the composer and Configuration without calling Thread start or resume, and its announcement contains only concrete Model, Reasoning, Permissions, and Fast mode values.
- [x] The first Turn maps the resolved revision to the correct app-server fields; stale revisions fail safely without starting a Thread and can be resolved again.
- [x] Reload preserves an untouched local New view and automated tests cover read-only resolution, revision safety, Turn mapping, announcements, and active-Turn locking.

## Resolution

New now resets directly into a persisted local Thread view, resolves and announces one concrete Pre-Turn configuration without starting or resuming Codex, and binds its opaque revision to the first Turn. The Mobile Client refreshes an obsolete revision and retries the unchanged Turn identity, while Relay coverage proves the obsolete snapshot is rejected before `thread/start` or `turn/start`. Chromium coverage verifies read-only entry, concrete accessible presentation, reload restoration, exact first-Turn revision use, and the existing active-Turn locks.
