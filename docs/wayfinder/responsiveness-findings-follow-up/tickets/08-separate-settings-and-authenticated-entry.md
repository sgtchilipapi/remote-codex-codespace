# Separate Settings and establish the authenticated entry gate

Label: `wayfinder:task`
Status: open
Assignee: unclaimed
Blocked by: none
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Implement the authenticated Mobile Client entry path so Settings owns only the Relay API token and live Codex availability must load before the user can enter a Thread view. First use opens the gear-triggered Settings view without cancellation; later token edits are transactional and cancellable without disturbing the current Thread or transcript.

- [ ] First use disables New, Resume, Configuration, and the composer until token authentication and live availability loading succeed, with accessible focus and validation behavior.
- [ ] Later Settings validation, cancellation, failure, and successful token replacement preserve or reset state exactly as specified, without exposing the token.
- [ ] Deterministic Relay and Chromium coverage verifies the successful, pending, failure, cancellation, and replacement paths.
