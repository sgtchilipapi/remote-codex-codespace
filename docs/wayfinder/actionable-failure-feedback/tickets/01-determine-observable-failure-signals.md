# Determine observable failure signals

Label: `wayfinder:research`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Specify actionable failure feedback](../map.md)

## Question

Using current primary documentation, upstream schemas or source, and the repository implementation, which signals can the Relay and Mobile Client reliably observe for connection, Relay, GitHub Codespace and SSH, and Codex app-server failures? Inventory the current catch-all collapse points; distinguish startup, authentication, transport, timeout, capacity, protocol, validation, account or quota, model, Thread, Turn, malformed-response, and disconnect conditions; and state where attribution or retryability cannot be established safely.

## Resolution

Resolved 2026-09-10. Attribute only from a structured signal at the boundary that owns it: Mobile Client validation and Relay HTTP/envelope failures are distinguishable; Relay policy, timeout, capacity, retention, and buffer failures are distinguishable; and Codex exposes structured JSON-RPC errors plus typed Turn errors and `willRetry`. A generic `gh codespace ssh` child exit conflates GitHub, Codespace, SSH, remote-shell, and Codex startup/disconnect causes, so it must remain unknown unless a separate Codespace state probe, a successful app-server handshake, or a structured Codex message establishes a narrower source. The complete matrix, Codex condition inventory, current collapse points, and uncertainty rules are in [Observable failure signals](../assets/observable-failure-signals.md).
