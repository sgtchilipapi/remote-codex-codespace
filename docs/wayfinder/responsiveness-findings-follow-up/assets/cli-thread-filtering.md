# CLI Thread filtering research

Research performed 2026-09-10 against Codex CLI `0.153.4`. No Thread was resumed, started, or otherwise mutated.

## Decision

The Relay can non-mutatingly exclude the two known-incompatible origins. Request `thread/list` with:

```json
{ "sourceKinds": ["vscode", "appServer"] }
```

and require the returned `thread.source` classification to be `vscode` or `appServer` again after `thread/read`. Continue applying the existing working-directory, archived-state, and recognizability checks.

Do not use the app-server's omitted/empty `sourceKinds` default. That default means the interactive set `cli` and `vscode`, so it includes the incompatible interactive CLI Threads and excludes `appServer` Threads. Do not use `originator`: it exists in rollout `session_meta`, but is not part of the public `Thread` returned by `thread/list` or `thread/read`.

This is a source-class filter, not a proof that every retained Thread will resume. Per the agreed fallback, a retained candidate may still fail normally at selection; the Relay must not probe it in advance.

There is no general persisted `resumable` capability to tighten this further. In particular, `canAcceptDirectInput` is nullable and explicitly unavailable for unloaded stored Threads, so it cannot decide picker eligibility. `status`, `path`, `historyMode`, and `threadSource` likewise carry no documented cross-client resumability guarantee. Although `codex exec resume` can resume recorded sessions through the exec command itself, that says nothing about whether this Relay's app-server lifecycle can resume them.

## Evidence

- The official app-server documentation says `thread/list` accepts `sourceKinds`; omitted or empty means only interactive `cli` and `vscode`, while explicit kinds can include `exec` and `appServer`. It also defines `thread/read` as a non-resuming metadata read. [OpenAI Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#list-threads-with-pagination--filters)
- The official generated protocol schema defines the distinct stable `ThreadSourceKind` values `cli`, `vscode`, `exec`, and `appServer`, and documents the server-side `sourceKinds` filter. [OpenAI `ThreadListParams` schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadListParams.json)
- The official TUI source uses the same classifications: its normal resume picker explicitly requests `cli` and `vscode`, and its opt-in non-interactive mode adds `exec` and `appServer`. This confirms that `exec` is independently identifiable and that relying on the interactive default would retain CLI Threads. [OpenAI Codex TUI source](https://github.com/openai/codex/blob/main/codex-rs/tui/src/lib.rs#L3430-L3445)
- Locally generated schemas from `codex app-server generate-json-schema --experimental` show that every returned `Thread` has a required `source` described as its origin, and that both list and read responses return that same `Thread` shape. The installed `ThreadListParams` schema contains the same source-kind enum and filter semantics. These generated files were inspected in a temporary directory and are intentionally not committed.
- Read-only inspection of the first `session_meta` record in local persisted rollouts found ordinary TUI sessions classified as `source: "cli"` / `originator: "codex-tui"`, `codex exec` sessions as `source: "exec"` / `originator: "codex_exec"`, and Relay-created sessions as `source: "vscode"` / `originator: "relay"`. This matters because filtering only for `appServer` would remove the Relay's own current Threads; the compatible allowlist must retain `vscode` as well. The local evidence is machine-specific corroboration, not the contract.
- The existing Relay currently calls `thread/list` without `sourceKinds` and accepts `cli`, `vscode`, and `appServer` in `INTERACTIVE_SOURCES`; consequently, it admits CLI Threads today. See [`server.js`](../../../server.js) and [`tests/relay-threads.test.js`](../../../tests/relay-threads.test.js).

## Implementation consequence

Replace the current accepted-source set with `vscode` and `appServer`, pass that exact pair as `sourceKinds` in `GET /threads`, and enforce the same pair after `thread/read` and `thread/resume`. Add contract tests proving the list request includes the explicit pair and that both `cli` and `exec` rows/IDs are rejected without calling `thread/resume`.

Because `source` is a protocol classification rather than a Relay-specific provenance token, this deliberately does not claim exclusive Relay ownership of every retained `vscode` or `appServer` Thread. It only supplies the requested safe exclusion of known-incompatible CLI and exec classes.
