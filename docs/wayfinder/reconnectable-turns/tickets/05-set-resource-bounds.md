# Set Turn retention, cleanup, and concurrency limits

Label: `wayfinder:grilling`
Status: open
Assignee: unclaimed
Blocked by: [Define ownership and terminal states for a reconnectable Turn](01-define-turn-lifecycle.md), [Define the replayable Turn event contract](03-define-replay-contract.md)
Parent: [Make Turns reconnectable across Mobile Client disconnects](../map.md)

## Question

What bounded retention, event-buffer, timeout, cleanup, and concurrency policy keeps reconnectable Turns safe for this single-user Relay, and what deterministic response should the Relay give when a bound is reached?
