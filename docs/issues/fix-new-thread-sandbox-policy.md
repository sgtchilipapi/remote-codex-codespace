# Fix new Thread sandbox policy serialization

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

Creating a new Thread succeeds at `thread/start`, but its first `turn/start` fails because the Relay serializes the selected permission as a string-valued `sandboxPolicy`. Codex app-server 0.153.4 expects the internally tagged `SandboxPolicy` object, so it rejects `"workspace-write"` with JSON-RPC error `-32600`. The Relay then masks that protocol error as `Codex unavailable`.

Implement the protocol-correct mapping for both supported permission choices at the public `POST /turn` seam. Preserve the existing approval-policy mapping and resumed-Thread override behavior. Add regression coverage that proves a new Thread's first Turn and a resumed Thread override send the correct app-server parameters, and keep upstream failures sanitized for Mobile Client users.

## Acceptance criteria

- A new Thread configured with workspace-write permissions sends the structured workspace-write sandbox policy accepted by Codex.
- Read-only and workspace-write permission choices both map to their protocol-valid sandbox-policy shapes and retain their existing approval policies.
- Explicit configuration overrides on resumed Threads use the same correct mapping.
- Relay regression tests cover the public `POST /turn` behavior.
- The focused Relay tests pass and the full automated suite is run, with any unrelated baseline failure recorded.

## Resolution

Implemented on 2026-09-10. The Relay now translates its `read-only` and `workspace-write` permission choices into the app-server's structured `{ type: "readOnly" }` and `{ type: "workspaceWrite" }` sandbox policies for `turn/start`, while retaining the established approval-policy mapping. Public Relay regression coverage verifies both a new Thread's first Turn and an explicit resumed-Thread override.

The two focused Relay files pass all 25 tests. The full run passed all 25 Node tests and 42 of 43 Playwright tests; the unrelated, pre-existing `successful token replacement preserves the Thread and resets requested Configuration` focus assertion failed deterministically and is outside this Relay protocol fix.
