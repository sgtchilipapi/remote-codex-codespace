# Map operations to recovery semantics

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Define the failure taxonomy and attribution rules](02-define-failure-taxonomy-and-attribution.md), [Specify the Relay failure envelope](03-specify-relay-failure-envelope.md)
Parent: [Specify actionable failure feedback](../map.md)

## Question

For Settings authentication, Configuration load and resolution, Thread list/resume/history and reload revalidation, Turn creation/stream/recovery, Status refresh, and the Codespace diagnostic, which failure codes apply, what state is preserved, what is safe to retry automatically or manually, which user action is offered, and when does a failed operation fall back to another view or terminal state?

## Resolution

The parent issue records the per-operation mappings and actions. Preserve the committed Settings, Configuration draft, current Thread, transcript, reading position, submitted prompt, and accepted Turn identity whenever they remain valid. Only idempotent Turn creation after a connection interruption and retained event replay retry automatically; all other safe retries are explicit. Only confirmed missing or ineligible state triggers the documented New fallback.
