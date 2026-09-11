# Define the failure taxonomy and attribution rules

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Determine observable failure signals](01-determine-observable-failure-signals.md)
Parent: [Specify actionable failure feedback](../map.md)

## Question

Given the observable signals, what canonical sources and stable condition codes should define Failure feedback, how should cascading failures be attributed to the deepest confidently established source, when must the source remain connection, Mobile Client, or unknown, and which attributes belong to the error instance rather than the taxonomy?

## Resolution

Use Mobile Client, connection, Relay, Codespace, Codex, and unknown as the canonical sources. Codes are valid only as source/code pairs. Attribute the deepest source established by structured evidence; otherwise retain connection, Mobile Client, or unknown. Operation, retryability, safe message, recovery action, diagnostic identity, and field errors belong to the failure instance.
