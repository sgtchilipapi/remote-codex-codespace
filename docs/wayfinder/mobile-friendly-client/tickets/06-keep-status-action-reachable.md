# Keep the Status action reachable on small screens

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Make the Mobile Client work well on narrow screens](../map.md)

## Question

Manual mobile verification found that the **Status** action disappears on small screens. Move it out of the compact top bar and place it as an accessible icon button immediately to the right of **Send**, while preserving its existing behavior and approximately 44px touch target.

## Resolution

Moved the existing Status action from the top bar into the composer immediately after **Send**. It is now a 44×44px information icon button with the accessible name and tooltip **Show status**; its existing loading, status-fetching, disabled-state, and live-region behavior is unchanged.

Added a compact Playwright regression assertion that the action is visible at 320px, follows **Send** in DOM order, has no visible text label, and retains its 44×44px target. The focused regression test and the full 30-test Chromium suite pass across the existing viewport matrix. Real-device verification should recheck the new placement before the parent implementation issue closes.
