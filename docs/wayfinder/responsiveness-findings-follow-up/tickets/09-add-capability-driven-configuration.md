# Add capability-driven Configuration with Fast mode

Label: `wayfinder:task`
Status: open
Assignee: unclaimed
Blocked by: [Separate Settings and establish the authenticated entry gate](08-separate-settings-and-authenticated-entry.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Implement the AI-star-triggered Configuration view so an authenticated user can stage and atomically apply model, reasoning effort, permissions, and Fast mode choices derived from live Codex capabilities. Keep the Configuration draft distinct from Applied configuration and from Codex-confirmed effective values.

- [ ] Model changes constrain reasoning and Fast choices from the live catalog, Default remains an explicit choice, and unsupported combinations return stable field-level errors without discarding the draft.
- [ ] Apply commits the whole draft once, Cancel discards it, focused views remain mutually exclusive, and an active Turn locks configuration changes.
- [ ] Relay and Chromium tests cover capability projection, validation, accessibility, duplicate-submission prevention, and responsive behavior.
