# Render item-owned assistant and Activity bubbles

Label: `wayfinder:task`
Status: open
Assignee: unclaimed
Blocked by: [Resume Eligible Threads with canonical effective state](11-resume-eligible-threads-with-effective-state.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Carry Codex item identities and structured lifecycle categories through live and replayed Relay events so every assistant item owns one bubble and each active Turn has at most one transient Activity bubble. Preserve ordering, interrupted partial output, separate errors, accessibility, and the established reader-position contract.

- [ ] Delta, completion, reconnect replay, and resumed history reconcile by Relay sequence and item ID without merging completed assistant items or duplicating content.
- [ ] Interrupted partial output, Codex errors, Relay recovery errors, empty items, and normalized Activity transitions follow the specified persistence and rendering rules.
- [ ] Chromium tests verify accessible activity labels, reduced motion, canonical ordering, and the 80-pixel auto-follow/visible-anchor behavior across every update type.
