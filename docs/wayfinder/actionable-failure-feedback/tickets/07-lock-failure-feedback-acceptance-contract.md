# Lock the failure-feedback acceptance contract

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Map operations to recovery semantics](04-map-operations-to-recovery-semantics.md), [Prototype Mobile Client failure feedback](05-prototype-mobile-client-failure-feedback.md), [Define diagnostics and redaction boundaries](06-define-diagnostics-and-redaction-boundaries.md)
Parent: [Specify actionable failure feedback](../map.md)

## Question

What final acceptance and rollout contract makes the taxonomy implementation-ready: authoritative source-to-code mappings, compatibility and migration behavior, Relay contract coverage, representative Mobile Client behavior and state-preservation coverage, accessibility assertions, safe-redaction checks, and treatment of unmapped future failures?

## Resolution

The parent issue is the authoritative acceptance and rollout contract. Lock mappings and envelope compatibility with authenticated Relay HTTP and stream tests, and cover representative placement, action targets, state preservation, auto-retry boundaries, accessibility, narrow-screen behavior, unknown-pair fallback, and diagnostic redaction through Chromium behavior tests. The full Node and Chromium suites remain the release gate.
