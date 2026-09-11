# Specify actionable failure feedback

Label: `wayfinder:map`

## Destination

An implementation-ready contract for every user-visible failure path that distinguishes Mobile Client, connection, Relay, Codespace, Codex, and genuinely unknown failures using stable conditions, safe messages, recovery actions, and acceptance scenarios.

## Notes

- Domain: Remote Codex Relay. Use the vocabulary in [`CONTEXT.md`](../../../CONTEXT.md), especially **Relay**, **Mobile Client**, **Codespace**, **Turn**, **Thread**, and **Failure feedback**.
- Consult the `grilling` and `domain-modeling` skills for decision tickets and the `prototype` skill for the feedback prototype.
- This map produces an implementation-ready specification; implementation remains outside the map.
- Cover Settings and authentication, Configuration, Thread listing/resume/history and reload revalidation, Turn start/stream/recovery, Status, and the Codespace diagnostic.
- Model each failure as source, stable condition, operation, retryability, user-safe message, recovery action, and diagnostic identity where applicable.
- Attribute a failure only as deeply as the available evidence supports. Include `connection`, `mobile_client`, and `unknown` rather than falsely blaming Relay, Codespace, or Codex.
- Automatic retry is reserved for interruption-safe operations already designed for replay. Other retryable failures expose an explicit action and preserve applicable Thread, draft, transcript, and Turn state.
- Keep raw process, SSH, filesystem, protocol, account, token, and credential details out of the Mobile Client.
- Stable machine-readable codes form the compatibility contract; user-facing wording may improve independently.

## Decisions so far

- [Determine observable failure signals](tickets/01-determine-observable-failure-signals.md): Attribute only from preserved structured boundary evidence; Codex Turn errors are typed, while generic `gh codespace ssh` exits remain unknown without a separate Codespace probe or Codex signal.
- [Define the failure taxonomy and attribution rules](tickets/02-define-failure-taxonomy-and-attribution.md): Use six canonical sources and stable source/code pairs; keep operation, retryability, copy, action, diagnostics, and field errors on each instance.
- [Specify the Relay failure envelope](tickets/03-specify-relay-failure-envelope.md): Carry the versioned failure object consistently through HTTP, Turn streams, and Status, retaining safe legacy strings and generic handling for future pairs.
- [Map operations to recovery semantics](tickets/04-map-operations-to-recovery-semantics.md): Preserve valid user and Turn state, expose operation-specific actions, and auto-retry only idempotent creation and retained replay.
- [Prototype Mobile Client failure feedback](tickets/05-prototype-mobile-client-failure-feedback.md): Place concise source-labelled feedback beside the affected surface with one primary action, optional diagnostic details, narrow-screen wrapping, and one announcement.
- [Define diagnostics and redaction boundaries](tickets/06-define-diagnostics-and-redaction-boundaries.md): Correlate public failures to opaque, structured, redacted records without exposing prompts, credentials, raw process output, protocol bodies, or internal paths.
- [Lock the failure-feedback acceptance contract](tickets/07-lock-failure-feedback-acceptance-contract.md): The parent issue is the authoritative contract, covered at Relay HTTP/stream and Chromium behavior seams with compatibility, recovery, accessibility, and redaction assertions.

## Not yet specified

None.

## Out of scope

- Implementing the contract or changing the existing production behavior during this map.
- Changing GitHub Codespaces, the GitHub CLI, or Codex app-server behavior.
- Exposing raw upstream errors, secrets, internal filesystem paths, or credential material to the Mobile Client.
- General multi-user observability, alerting, or incident-management design beyond diagnostics needed to support this single-user Relay.

## Open child tickets

None.
