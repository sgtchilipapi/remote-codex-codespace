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

## Decisions so far

None.

## Not yet specified

- How the resume picker should fit the compact Mobile Client and coexist with **New**, Configuration, and the active Thread.
- Which Codex Thread metadata and history are necessary to recognize a Thread before selecting it and to hydrate it after selection.
- The Relay/app-server lifecycle, API surface, pagination, caching, and failure behavior needed to expose Codespace-persisted Threads safely.
- What happens when a Thread is missing, corrupt, already active, from another working directory, or cannot be resumed by the installed Codex version.
- The automated and real-device acceptance contract, including parity boundaries with the CLI and regression coverage for creating new Threads.

## Out of scope

- Synchronizing Threads between Codespaces or recreating Threads whose Codex records no longer exist.
- Editing, deleting, archiving, renaming, forking, exporting, or sharing Threads unless later required for the agreed resume flow.
- Replacing Codex's persistence with a Relay-owned or browser-owned Thread database.

## Open child tickets

1. [Define useful parity with Codex CLI resume](tickets/01-define-resume-parity.md)
