# Specify Thread scrolling and composer behavior

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Choose the compact Mobile Client layout](02-choose-compact-layout.md)
Parent: [Make the Mobile Client work well on narrow screens](../map.md)

## Question

What precise responsive contract should govern available Thread height, sticky composer growth and overflow, virtual-keyboard and safe-area changes, near-bottom detection, streaming auto-scroll, focus restoration, long ordinary text, and horizontally scrollable preformatted content?

## Resolution

Resolved with the human on 2026-09-09 by accepting the recommendations for the complete decision tree. Use this contract:

### App shell and available Thread height

- When Configuration is closed, the visible Mobile Client is one app shell ordered as top bar, Thread, status, and composer. The shell occupies the current visual viewport, does not grow with Thread content, and is capped at the existing 720px desktop width. The document itself must not become a vertical or horizontal scroll surface.
- The top bar, status, and composer take only their intrinsic height. The Thread receives all remaining height, has `min-height: 0` and `min-width: 0`, and is the sole vertical scrolling region. If the viewport becomes too short to show useful Thread content, controls remain reachable and the Thread may shrink to zero rather than pushing the composer outside the viewport.
- Use `viewport-fit=cover`, dynamic viewport units, and safe-area padding. Top-bar padding includes `env(safe-area-inset-top)`; composer bottom padding includes `env(safe-area-inset-bottom)`; left and right shell padding include the corresponding safe-area insets, including in landscape.
- Treat the visual viewport as authoritative while a software keyboard is open. On `visualViewport` resize or scroll, keep the shell within the visible area and the focused composer above the keyboard; use a measured visual-viewport height/offset fallback only where dynamic viewport units do not do so reliably. Do not pan or scale the page as a substitute.

### Composer sizing and submission

- The prompt has an explicit semantic label, a one-line minimum height of approximately 46px, and no user resize handle. On initial render, input, paste, cut, programmatic clearing, and viewport resize, reset its content height and then size it to its `scrollHeight`, clamped between the minimum and `min(160px, 30% of the current visual-viewport height)`.
- Below the cap the prompt grows and the Thread yields the same amount of height. At the cap the prompt stops growing and scrolls internally. The Send control stays aligned to the composer's bottom, remains approximately 44px high, and never narrows the prompt enough to create page overflow at 320px.
- Submitting a non-empty prompt appends the new Turn at the bottom, enters follow mode, scrolls the Thread to its bottom without animation, clears and remeasures the prompt, and leaves focus in the prompt if it already had focus. This deliberately keeps the mobile keyboard open for consecutive prompts. An empty or whitespace-only submission changes nothing.
- A Turn disables Send but leaves the prompt readable; Turn completion or failure re-enables Send without moving focus. No asynchronous status or streaming event may steal focus. Starting a new Thread empties the Thread, resets its scroll position and composer height, and moves focus to the prompt. Configuration's own open/close focus behavior remains governed by [Specify Configuration panel state and validation](03-specify-configuration-panel.md).

### Reader position and streaming

- Define **near the bottom** as `scrollHeight - clientHeight - scrollTop <= 80px`, with sub-pixel values tolerated. Evaluate that condition immediately before each batch of DOM changes.
- The Thread has a follow-mode flag. It starts enabled for an empty or newly opened Thread. Appending the user's submitted prompt explicitly enables it. While enabled, each streamed agent-message update scrolls to the bottom after layout; batch updates to at most once per animation frame.
- User scrolling that leaves the 80px zone disables follow mode immediately. Streaming then preserves the reader's viewport and does not call `scrollIntoView`, change `scrollTop`, or restore the previous bottom distance. Returning to the 80px zone re-enables follow mode, whether by user scroll or an explicit jump-to-latest control if one is later added.
- Preserve the same follow-mode state through keyboard opening/closing, browser chrome changes, orientation changes, and composer growth. If follow mode is enabled, settle at the new bottom after the resize; if disabled, preserve the top visible message and its pixel offset as the scroll anchor as closely as the browser permits.
- Initial restoration of a persisted Thread starts at its bottom. New message content and errors are announced through the existing status/live-region treatment, not by moving focus or forcing a reader who has scrolled up to the bottom. Scrolling is immediate when reduced motion is requested; this cleanup adds no required animation.

### Message wrapping and preformatted content

- Every message and descendant can shrink within the Thread (`min-width: 0; max-width: 100%`). Ordinary text preserves authored line breaks, wraps at normal opportunities, and may break an otherwise unbreakable token (`white-space: pre-wrap; overflow-wrap: anywhere`). No message may increase the document or Thread's horizontal scroll width.
- Recognize triple-backtick fenced blocks in agent text as the one narrow exception to plain-text rendering. Render ordinary segments with `textContent`; render the literal fenced body as semantic `pre > code` content. This is not general Markdown rendering: inline backticks and every other Markdown construct remain ordinary text, and an unmatched fence remains ordinary text.
- A preformatted block uses `white-space: pre`, `max-width: 100%`, and its own `overflow-x: auto`; it preserves indentation and long lines instead of wrapping them. Horizontal overscroll is contained inside the block, touch momentum scrolling is supported, and keyboard users can reach and scroll an overflowing block. Fences themselves are not displayed.
- Construct all segments with DOM text nodes/`textContent`, never HTML interpolation. The Relay payload remains unchanged; no Relay API accommodation is required.

### Boundaries exposed by the decision

- The same shell mechanics may improve desktop scrolling, but the existing desktop width, colors, hierarchy, and control appearance remain the regression boundary; this is responsive behavior, not a visual redesign.
- The 80px threshold, composer limits, scroll anchoring, fenced-block segmentation, safe-area behavior, and keyboard behavior are observable requirements for [Define the responsive acceptance contract](05-define-acceptance-contract.md), which will select automated and manual checks.
- No browser-specific workaround is justified yet. Manual iOS Safari and Android Chrome verification remains the point at which a reproducible engine-specific failure should graduate from the map's fog into its own ticket.
