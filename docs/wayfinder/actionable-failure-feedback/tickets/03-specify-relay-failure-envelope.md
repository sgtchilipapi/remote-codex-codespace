# Specify the Relay failure envelope

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Define the failure taxonomy and attribution rules](02-define-failure-taxonomy-and-attribution.md)
Parent: [Specify actionable failure feedback](../map.md)

## Question

What versionable, machine-readable failure envelope should the Relay use across HTTP responses, streamed Turn events, and partial-success Status responses, including source, code, operation, retryability, safe message, action, diagnostic identity, validation details, and forward-compatible handling of unknown fields or codes?

## Resolution

Use the version-1 object defined by the parent issue across non-success HTTP bodies, terminal Turn error events, and Status `errors`. Keep the safe legacy `error` or `message` string for compatibility. Ignore unknown optional fields, render unknown future source/code pairs with safe operation-based copy, and reject unsupported versions as malformed Relay responses.
