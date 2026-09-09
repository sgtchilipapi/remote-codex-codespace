# Resume existing Codex Threads from the Mobile Client

Label: `wayfinder:map`

## Destination

An implementation-ready specification for discovering, inspecting, selecting, and continuing Codex Threads persisted in the configured Codespace, providing the Mobile Client with the useful capability of Codex CLI `/resume`.

## Notes

- Domain: Remote Codex Relay. Use the vocabulary in [`CONTEXT.md`](../../../CONTEXT.md); call retained Codex interactions **Threads**, not sessions.
- Consult the `grilling`, `domain-modeling`, and `prototype` skills when their ticket types require them.
- This map plans the capability; it does not implement it.
- Codex's persisted Thread records in the Codespace are the source of truth. Browser storage may cache presentation state but must not define which Threads exist.
- The installed Codex app-server exposes `thread/list`, `thread/read`, and paginated Turn/item operations; the existing Relay already continues a known Thread ID through `codex exec resume`.
- Preserve the responsive and interaction contract decided by [Make the Mobile Client work well on narrow screens](../mobile-friendly-client/map.md).
- Prefer the smallest useful parity with Codex CLI `/resume`; do not broaden this into general Thread administration without an explicit decision.
- The user pre-accepts the agent's minimal recommendations for the remaining specification; ask only when no safe minimal default exists.

## Decisions so far

- [Define useful parity with Codex CLI resume](tickets/01-define-resume-parity.md): Provide a working-directory-scoped, recency-ordered picker for recognizable interactive Threads, with authoritative paginated history and explicit continuation, while omitting search and terminal-oriented CLI affordances.
- [Complete the minimal Thread resume specification](tickets/02-design-compact-resume-picker.md): Reuse compact focus mode around a three-route, app-server-backed resume flow with atomic selection, bounded pagination, persisted configuration, safe recovery, and proportionate acceptance coverage.

## Not yet specified

None.

## Out of scope

- Synchronizing Threads between Codespaces or recreating Threads whose Codex records no longer exist.
- Editing, deleting, archiving, renaming, forking, exporting, or sharing Threads unless later required for the agreed resume flow.
- Replacing Codex's persistence with a Relay-owned or browser-owned Thread database.

## Open child tickets

None.
