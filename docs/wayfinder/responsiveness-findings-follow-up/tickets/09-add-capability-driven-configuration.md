# Add capability-driven Configuration with Fast mode

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: [Separate Settings and establish the authenticated entry gate](08-separate-settings-and-authenticated-entry.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Implement the AI-star-triggered Configuration view so an authenticated user can stage and atomically apply model, reasoning effort, permissions, and Fast mode choices derived from live Codex capabilities. Keep the Configuration draft distinct from Applied configuration and from Codex-confirmed effective values.

- [x] Model changes constrain reasoning and Fast choices from the live catalog, Default remains an explicit choice, and unsupported combinations return stable field-level errors without discarding the draft.
- [x] Apply commits the whole draft once, Cancel discards it, focused views remain mutually exclusive, and an active Turn locks configuration changes.
- [x] Relay and Chromium tests cover capability projection, validation, accessibility, duplicate-submission prevention, and responsive behavior.

## Resolution

Added authenticated Configuration catalog and resolution routes backed by live Codex model and config reads. The Mobile Client now stages model-specific reasoning, Relay-projected permissions, and explicit Default/On/Off Fast choices; Apply validates and commits one revision atomically while Cancel retains the prior Applied configuration. The first Turn carries that revision and maps Fast mode to the advertised `priority` service tier. Relay and Chromium coverage verifies capability projection, stable field errors, duplicate-submit prevention, active-Turn locking, accessibility, and the established responsive viewport matrix.
