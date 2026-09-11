# Define diagnostics and redaction boundaries

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Define the failure taxonomy and attribution rules](02-define-failure-taxonomy-and-attribution.md), [Specify the Relay failure envelope](03-specify-relay-failure-envelope.md)
Parent: [Specify actionable failure feedback](../map.md)

## Question

What diagnostic identity, structured Relay logging, upstream-cause chaining, retention expectation, and redaction rules are required to investigate a reported failure while ensuring the Mobile Client never receives secrets, credential material, raw stderr, internal paths, or arbitrary protocol content?

## Resolution

Give every Relay-observed failure a fresh opaque UUID and log its timestamp, operation, public pair, context, safe correlations, structured upstream type/code, retry and terminal signals, child exit/signal, and a redacted cause chain. Never send or log raw authorization values, credentials, prompts, responses, commands, stderr, internal paths, JSON-RPC data, additional details, or unsanitized messages.
