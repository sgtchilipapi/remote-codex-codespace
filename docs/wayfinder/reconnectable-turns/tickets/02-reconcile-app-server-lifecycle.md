# Reconcile reconnectable Turns with the reusable Codex app-server

Label: `wayfinder:grilling`
Status: open
Assignee: unclaimed
Blocked by: [Define ownership and terminal states for a reconnectable Turn](01-define-turn-lifecycle.md)
Parent: [Make Turns reconnectable across Mobile Client disconnects](../map.md)

## Question

How should reconnectable Turn ownership use the reusable Codex app-server already selected by the Thread-resume specification, including request correlation, app-server loss, cancellation, and responsibility for `/info`, without preserving a competing per-Turn `codex exec` lifecycle?
