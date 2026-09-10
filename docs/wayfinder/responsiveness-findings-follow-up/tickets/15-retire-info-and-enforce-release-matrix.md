# Retire the compatibility facade and enforce the release matrix

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: [Separate Settings and establish the authenticated entry gate](08-separate-settings-and-authenticated-entry.md), [Add capability-driven Configuration with Fast mode](09-add-capability-driven-configuration.md), [Make New a revision-safe local Thread entry](10-make-new-revision-safe-local-entry.md), [Resume Eligible Threads with canonical effective state](11-resume-eligible-threads-with-effective-state.md), [Render item-owned assistant and Activity bubbles](12-render-item-owned-assistant-and-activity-bubbles.md), [Rehydrate persisted Thread and local-New views safely](13-rehydrate-persisted-thread-views.md), [Expose and present effective Status end to end](14-expose-and-present-effective-status.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Remove the temporary `/info` compatibility facade after every runtime caller uses the explicit Configuration, resolution, and Status contracts, then make the repository's single test command enforce the complete deterministic acceptance contract across Relay behavior and the required Chromium viewport matrix.

- [x] No runtime client or test depends on `/info`, and an automated repository-level assertion prevents the facade from returning as a dependency.
- [x] The release gate covers every distinct success, error, unavailable, stale, reconnect, resume, accessibility, and responsive outcome specified by the findings without external services or credentials.
- [x] Geometry and overflow assertions pass at 320×568, 360×800, 390×844, 430×932, 844×390, and a desktop viewport of at least 720 pixels while all prior regressions remain green.

## Resolution

Resolved on 2026-09-10. Removed the Relay's temporary `/info` route after confirming the Mobile Client uses the explicit `/configuration`, `/configuration/resolve`, and `/status` contracts. Replaced the obsolete compatibility test with a repository-level regression that requires `/info` to return `404` without contacting Codex. The existing `npm test` release gate now passes all 30 deterministic Relay contract tests and all 49 Chromium acceptance tests, including the five required compact/landscape viewport geometries and the 1024×768 desktop cap check.
