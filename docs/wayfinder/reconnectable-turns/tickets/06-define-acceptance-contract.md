# Define the reconnectable Turn acceptance contract

Label: `wayfinder:grilling`
Status: open
Assignee: unclaimed
Blocked by: [Reconcile reconnectable Turns with the reusable Codex app-server](02-reconcile-app-server-lifecycle.md), [Prototype Mobile Client disconnect and recovery behavior](04-prototype-recovery-behavior.md), [Set Turn retention, cleanup, and concurrency limits](05-set-resource-bounds.md)
Parent: [Make Turns reconnectable across Mobile Client disconnects](../map.md)

## Question

Which automated and real-device scenarios prove that a Turn survives transient disconnects, replays each event without corrupting visible output, reports terminal outcomes correctly, respects resource bounds, integrates with resumed Threads, and fails honestly when the Relay process itself is lost?
