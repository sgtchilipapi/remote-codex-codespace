# Specify assistant item grouping

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

What exact rendering and persistence contract should turn each completed Codex `agentMessage` item into its own assistant bubble across live output, reconnect replay, page reload, resumed history, partial output, Codex errors, and reader-position preservation?

## Resolution

Model the visible tail of an active Turn separately from the persisted transcript.

- Every Codex `agentMessage` item owns one assistant bubble, keyed by its Codex item ID. `item/agentMessage/delta` events build a provisional bubble for that item; `item/completed` replaces its accumulated text with the authoritative completed text and makes the bubble immutable. Never append one completed item to another item's bubble.
- Carry the item ID on live and replayed Relay events. Apply Relay sequence deduplication first and item-ID reconciliation second, so reconnect replay cannot duplicate text or bubbles. Empty completed items still mark their ID consumed but render no bubble.
- Preserve event order among user messages, completed assistant items, Codex error items, and Relay recovery errors. An error always owns a separate assistant-styled error bubble; it is never appended to response text. A Codex error item uses its item ID, while a Relay recovery error uses a deterministic identity scoped to the Relay Turn so retries cannot duplicate it.
- If a Turn fails after producing deltas but before completing their item, retain the provisional bubble in the current view, label it with subdued `Interrupted` metadata, and append the separate error bubble after it. Keep the response text itself unchanged. Do not persist that insignificant interrupted partial as transcript history: it may be reconstructed by active-Turn replay while the Relay still retains the Turn, but it disappears when recovery is unavailable or the view is rebuilt.
- Treat explicit **Resume** as a canonical rebuild from Codex Thread history. Render each persisted user, assistant, or error item once by item ID; do not merge cached activity, provisional, interrupted-partial, or Relay recovery-error artifacts. An ordinary reload may restore completed transcript entries and errors from local state, then reconcile them by item ID during rehydration.
- While a Turn is active, render exactly one non-transcript **Activity bubble** at the tail. Derive its label without a model call or additional token processing from structured Codex `item/started` lifecycle data: map reasoning or planning to `Thinking`, command execution to `Running`, file changes to `Editing`, web/MCP/dynamic tool work to `Researching`, collaboration or subagent work to `Delegating`, image viewing to `Inspecting image`, image generation to `Generating image`, sleep to `Waiting`, and unknown types to `Working`. The Relay must not forward raw reasoning or manufacture a more specific description.
- Publish an activity replay event only when the normalized category changes. Remove the Activity bubble when an assistant item begins, show a fresh one only if later non-message activity continues, and remove it permanently on Turn completion or failure. Activity events may reconstruct the live tail during reconnect but never enter completed or resumed Thread history.
- Give the Activity bubble a simple decorative character play. Its accessible label contains only the stable activity category, announced politely once when that category changes; decorative characters are hidden from assistive technology. Under `prefers-reduced-motion`, display a static ellipsis.
- Preserve the responsive reader-position contract for every provisional update, completed bubble, replay, error, and Activity-bubble transition: auto-follow only while the reader remains within 80 pixels of the bottom; otherwise retain the current visible-message anchor. Loading older history likewise retains its existing anchor.
