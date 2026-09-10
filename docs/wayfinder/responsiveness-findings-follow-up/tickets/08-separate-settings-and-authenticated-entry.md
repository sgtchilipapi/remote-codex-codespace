# Separate Settings and establish the authenticated entry gate

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Implement the authenticated Mobile Client entry path so Settings owns only the Relay API token and live Codex availability must load before the user can enter a Thread view. First use opens the gear-triggered Settings view without cancellation; later token edits are transactional and cancellable without disturbing the current Thread or transcript.

- [x] First use disables New, Resume, Configuration, and the composer until token authentication and live availability loading succeed, with accessible focus and validation behavior.
- [x] Later Settings validation, cancellation, failure, and successful token replacement preserve or reset state exactly as specified, without exposing the token.
- [x] Deterministic Relay and Chromium coverage verifies the successful, pending, failure, cancellation, and replacement paths.

## Resolution

Resolved on 2026-09-10. The Mobile Client now gives the Relay API token an isolated gear-triggered Settings view, gates Thread entry on authenticated live availability, keeps first use non-cancellable, and makes later edits transactional. Successful token replacement preserves the current Thread/transcript while resetting requested Configuration to Default; failure and cancellation retain the authenticated state. Relay and Chromium tests cover authorization, availability, pending, failure, cancellation, and replacement behavior.
