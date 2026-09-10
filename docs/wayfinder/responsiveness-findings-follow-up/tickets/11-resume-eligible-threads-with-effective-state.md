# Resume Eligible Threads with canonical effective state

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: [Separate Settings and establish the authenticated entry gate](08-separate-settings-and-authenticated-entry.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Limit the picker to Eligible Threads from allowed source kinds and make Resume atomically install canonical ID-bearing history plus Codex-confirmed effective configuration. Revalidate metadata without probing resumability and preserve the prior Mobile Client view whenever Resume fails.

- [x] Listing requests and metadata revalidation allow only `vscode` and `appServer` sources in addition to all existing eligibility rules, excluding known `cli` and `exec` Threads without a resume probe.
- [x] Successful Resume returns chronological item-ID-bearing history and available effective model, reasoning, permissions, and Fast state; unavailable fields are not inferred.
- [x] Relay and Chromium tests cover source filtering, canonical history, success and failure atomicity, pagination, and accessibility of the picker.

## Resolution

Implemented on 2026-09-10. The Relay now applies the explicit `vscode`/`appServer` allowlist to `thread/list` and to metadata revalidation, returns canonical item-ID-bearing history with a separately normalized effective configuration sourced only from `thread/resume`, and leaves unreported values unavailable. The Mobile Client validates the complete Resume envelope before atomically replacing its persisted Thread view. Focused Relay and Chromium coverage verifies filtering, canonical ordering, non-inference, success/failure atomicity, pagination, and accessible picker controls.
