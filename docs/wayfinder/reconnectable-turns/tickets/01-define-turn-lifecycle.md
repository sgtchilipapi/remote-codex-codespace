# Define ownership and terminal states for a reconnectable Turn

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Make Turns reconnectable across Mobile Client disconnects](../map.md)

## Question

Once the Relay accepts a prompt, what owns the Turn, which identifiers and states make its lifecycle observable, and under exactly which terminal conditions may the Relay stop its Codex work independently of Mobile Client connection churn?

## Resolution

The Relay owns an Active Turn in a process-local registry from acceptance until a terminal `completed` or `failed` state. The Mobile Client supplies a UUID before creation so retrying an uncertain `POST /turn` is idempotent; the Relay returns that ID and retains ordered events for reconnection.

Closing an event response removes only that subscriber. It never terminates Codex. Codex exit code zero completes the Turn; spawn errors, malformed or incomplete output, nonzero exit, or exhaustion of the bounded replay buffer fail it. Every terminal path publishes an ordered `relay.turn.finished` event before ending subscribers. The Relay permits one Active Turn for its single user and retains terminal Turns for a bounded replay window. Relay process loss remains the explicit durability boundary.
