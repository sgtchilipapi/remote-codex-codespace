# Prototype Mobile Client failure feedback

Label: `wayfinder:prototype`
Status: closed
Assignee: codex
Blocked by: [Specify the Relay failure envelope](03-specify-relay-failure-envelope.md), [Map operations to recovery semantics](04-map-operations-to-recovery-semantics.md)
Parent: [Specify actionable failure feedback](../map.md)

## Question

What concrete Mobile Client presentation makes each representative Failure feedback instance understandable and actionable without overwhelming the transcript: source label, concise consequence, recovery instruction, primary action, optional diagnostic details, placement, persistence, accessibility announcement, and behavior on narrow mobile screens?

## Resolution

Render a visible source label followed by concise consequence-and-recovery copy beside the affected control or content. Show one primary operation-specific action and keep the diagnostic identity behind Details with a copy control. Blocking feedback is announced once as an alert; lifecycle updates remain polite status messages. Feedback and controls wrap without horizontal scrolling on narrow screens.
