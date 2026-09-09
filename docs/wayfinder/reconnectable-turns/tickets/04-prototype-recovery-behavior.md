# Prototype Mobile Client disconnect and recovery behavior

Label: `wayfinder:prototype`
Status: open
Assignee: unclaimed
Blocked by: [Define the replayable Turn event contract](03-define-replay-contract.md)
Parent: [Make Turns reconnectable across Mobile Client disconnects](../map.md)

## Question

What minimal Mobile Client state model and visible behavior should preserve partial output, communicate connection loss without misreporting Turn failure, retry safely, catch up from the last applied event, and recover after reload while the Relay still retains the Turn?
