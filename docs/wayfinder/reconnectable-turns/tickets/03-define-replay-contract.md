# Define the replayable Turn event contract

Label: `wayfinder:grilling`
Status: open
Assignee: unclaimed
Blocked by: [Define ownership and terminal states for a reconnectable Turn](01-define-turn-lifecycle.md), [Reconcile reconnectable Turns with the reusable Codex app-server](02-reconcile-app-server-lifecycle.md)
Parent: [Make Turns reconnectable across Mobile Client disconnects](../map.md)

## Question

What authenticated HTTP contract starts a Turn, identifies and orders its replayable events, resumes after a known event, represents terminal outcomes, handles duplicate or stale reconnects, and preserves compatibility only where that is worth its cost?
