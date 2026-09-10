# Determine whether incompatible CLI Threads can be filtered

Label: `wayfinder:research`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Using current official Codex documentation, the installed app-server protocol schema, persisted Thread metadata where safely readable, and the existing Relay implementation, can `thread/list` or `thread/read` metadata reliably distinguish Threads created by `codex app-server` from incompatible Threads created by interactive `codex` CLI or `codex exec`? Define a non-mutating filter if one is reliable; otherwise document why the picker must include indistinguishable candidates without probing resumability.

## Resolution

The protocol exposes reliable source classifications for the two known-incompatible classes. Request `thread/list` with explicit `sourceKinds: ["vscode", "appServer"]`, then require the same allowlist on the `Thread.source` returned by the non-resuming `thread/read`; this excludes `cli` and `exec` without probing. `vscode` must remain allowed because the installed app-server records current Relay-created Threads with that source classification. This is a safe class filter, not a guarantee that every retained candidate resumes; selection may still fail normally. Full evidence and implementation consequences are in [CLI Thread filtering research](../assets/cli-thread-filtering.md).
