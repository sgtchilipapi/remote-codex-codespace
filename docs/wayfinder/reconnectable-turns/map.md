# Make Turns reconnectable across Mobile Client disconnects

Label: `wayfinder:map`

## Destination

An implementation-ready specification, captured in [Make Turns survive Mobile Client disconnects](../../issues/make-turns-survive-mobile-disconnects.md), for a Turn to continue within one Relay process lifetime when the Mobile Client disconnects and to be resumed without losing or misreporting output.

## Notes

- Domain: Remote Codex Relay. Use the vocabulary in [`CONTEXT.md`](../../../CONTEXT.md).
- Consult the `grilling`, `domain-modeling`, and `prototype` skills when their ticket types require them.
- This map plans the remaining work. The Turn-lifecycle ticket was implemented in place at the user's explicit direction; that implementation does not pre-decide the still-open app-server, final replay-contract, resource-policy, or acceptance decisions.
- The Relay owns an accepted Turn independently of any one Mobile Client HTTP connection.
- The first version guarantees recovery only while the same Relay process remains alive; persistence through Railway restarts or redeployments is out of scope.
- Preserve partial assistant output and distinguish transport disconnection from terminal Turn failure.
- Reconcile this specification with [Resume existing Codex Threads from the Mobile Client](../resume-codex-threads/map.md), which already chooses one lazy, reusable Codex app-server connection per Relay process.
- Prefer replayable HTTP streaming over adding WebSockets unless a later decision demonstrates a concrete need.
- The user pre-accepts the agent's minimal recommendations for this specification; ask only when no safe minimal default exists.

## Decisions so far

- [Define ownership and terminal states for a reconnectable Turn](tickets/01-define-turn-lifecycle.md): The Relay owns one process-local Active Turn independently of subscribers, with idempotent client-chosen identity, ordered replay, explicit terminal events, bounded retention, and process loss as the durability boundary.

## Not yet specified

- The final migration and release sequence cannot be fixed until the Turn owner and reusable app-server lifecycle are reconciled.
- The exact implementation issue structure may change if the chosen lifecycle exposes a separately deployable mitigation that is safe on its own.

## Out of scope

- Persisting or recovering active Turns across Relay process restarts, Railway redeployments, or multiple Relay instances.
- Switching to WebSockets without a requirement that replayable HTTP streaming cannot meet.
- Standalone caching or optimization of `/info`, except where shared app-server ownership makes it inseparable from the chosen Turn lifecycle.
- General offline support, background execution in the Mobile Client, push notifications, or richer Thread administration.

## Open child tickets

1. [Reconcile reconnectable Turns with the reusable Codex app-server](tickets/02-reconcile-app-server-lifecycle.md)
2. [Define the replayable Turn event contract](tickets/03-define-replay-contract.md)
3. [Prototype Mobile Client disconnect and recovery behavior](tickets/04-prototype-recovery-behavior.md)
4. [Set Turn retention, cleanup, and concurrency limits](tickets/05-set-resource-bounds.md)
5. [Define the reconnectable Turn acceptance contract](tickets/06-define-acceptance-contract.md)
6. [Prepare the reconnectable Turn implementation handoff](tickets/07-prepare-implementation-handoff.md)
