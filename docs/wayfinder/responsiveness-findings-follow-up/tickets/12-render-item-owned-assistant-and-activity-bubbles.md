# Render item-owned assistant and Activity bubbles

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: [Resume Eligible Threads with canonical effective state](11-resume-eligible-threads-with-effective-state.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Carry Codex item identities and structured lifecycle categories through live and replayed Relay events so every assistant item owns one bubble and each active Turn has at most one transient Activity bubble. Preserve ordering, interrupted partial output, separate errors, accessibility, and the established reader-position contract.

- [x] Delta, completion, reconnect replay, and resumed history reconcile by Relay sequence and item ID without merging completed assistant items or duplicating content.
- [x] Interrupted partial output, Codex errors, Relay recovery errors, empty items, and normalized Activity transitions follow the specified persistence and rendering rules.
- [x] Chromium tests verify accessible activity labels, reduced motion, canonical ordering, and the 80-pixel auto-follow/visible-anchor behavior across every update type.

## Resolution

Implemented on 2026-09-10. The Relay now preserves assistant and error item IDs, streams assistant deltas, replaces provisional text with authoritative completion, and publishes only normalized Activity category changes without raw operational content. The Mobile Client reconciles sequence then item identity into immutable per-item bubbles, keeps errors separate, handles interrupted partials according to recovery availability, and renders one accessible transient Activity bubble with reduced-motion behavior. Relay and Chromium coverage exercises replay, canonical errors, empty items, every activity category, accessibility, and the established reader-position contract.
