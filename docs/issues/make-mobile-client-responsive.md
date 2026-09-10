# Make the Mobile Client responsive

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

## Problem Statement

The Mobile Client overflows and loses important controls on narrow screens. Its Thread, Configuration panel, and composer also do not behave reliably around small viewports, streaming output, safe areas, or the mobile keyboard.

## Solution

Implement the responsive contract from [the completed planning map](../wayfinder/mobile-friendly-client/map.md): compact focus-mode Configuration, a viewport-filling Thread, and an accessible sticky composer, while preserving desktop behavior.

## User Stories

1. As a mobile user, I want every control to remain usable from 320px upward, so that I can operate Codex without page-level horizontal scrolling.
2. As a mobile user, I want Configuration to open as a focused view and apply atomically, so that editing settings does not crowd or partially alter my Thread.
3. As a reader, I want streaming to follow only when I am near the bottom, so that it does not pull me away from earlier content.
4. As a mobile user, I want the composer to remain usable above the keyboard and safe area, so that I can write and send prompts in portrait or landscape.
5. As an accessibility user, I want labelled controls, visible focus, announced status, reduced-motion support, and approximately 44px targets, so that the Mobile Client remains operable.

## Implementation Decisions

- Reuse the current single-page Mobile Client and Relay API; do not redesign the Relay.
- On narrow screens, Configuration replaces the Thread and composer while open. **Configure** is its single entry point.
- Keep applied configuration separate from the configuration draft. Apply validates through `/info` and commits atomically; Cancel discards the draft.
- Lock **New** and Configuration changes during an active Turn.
- Give the Thread its own vertical scrolling. Follow streamed output only within 80px of the bottom and preserve reader position otherwise.
- Auto-grow the composer to `min(160px, 30% of viewport height)`, then scroll it internally.
- Wrap prose and long tokens; render complete fenced agent code blocks as safe text in horizontally scrollable code regions.
- Use dynamic viewport and safe-area insets without changing the existing desktop visual character.

## Testing Decisions

- Use the browser-visible Mobile Client as the primary seam; assert behavior and geometry rather than CSS implementation details.
- Cover configuration transitions, active-Turn locking, composer growth, scroll-follow behavior, safe rendering, focus, and absence of page overflow in Chromium at representative compact and desktop widths.
- Follow the map's lightweight manual smoke pass in iPhone Safari and Android Chrome. The repository has no existing automated test files, so add only the smallest browser harness needed.

## Out of Scope

Markdown beyond fenced code, Turn interruption or reconnect controls, richer Thread management, a desktop redesign, and Relay or Codespace changes.

## Further Notes

The planning map is the detailed acceptance reference if an edge case is unclear.

## Comments

### 2026-09-10 — Implementation candidate

Implemented the responsive Mobile Client contract without changing the Relay API. The Chromium behavior/geometry suite and static syntax checks pass. Added [`scripts/verify-mobile-client.sh`](../../scripts/verify-mobile-client.sh) to guide and record the required iPhone Safari and Android Chrome smoke passes.

The issue remains open until those two real-device browser passes are recorded, as required by the acceptance contract.

## Resolution

Implemented the responsive Mobile Client contract and the follow-up fix that keeps the Status action reachable beside **Send** on compact screens. The full 30-test Chromium behavior and geometry suite passes across the target viewport matrix, and real-device mobile re-verification was reported all green on 2026-09-10. No Relay or Codespace changes were required.
