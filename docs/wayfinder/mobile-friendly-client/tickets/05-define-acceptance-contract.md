# Define the responsive acceptance contract

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Specify Configuration panel state and validation](03-specify-configuration-panel.md), [Specify Thread scrolling and composer behavior](04-specify-thread-and-composer.md)
Parent: [Make the Mobile Client work well on narrow screens](../map.md)

## Question

Which observable acceptance criteria, automated checks, manual device/browser checks, and regression boundaries are sufficient to hand this responsive cleanup to implementation with no remaining product or interaction decisions?

## Resolution

Resolved on 2026-09-09 with the human's instruction to accept the simplest recommendations. The implementation is accepted when all checks below pass.

### Automated contract

Use Playwright with its Chromium project and the existing `npm test` entry point. Keep this as a small behavior-and-geometry suite; do not add screenshot-diff infrastructure, a component-test framework, or automated WebKit/device-farm coverage for this cleanup. Stub `/info` and `/turn` in the browser so the suite is deterministic and does not require a Codespace, credentials, or Relay changes.

Run the compact-layout cases at 320×568, 360×800, 390×844, and 430×932, and one landscape case at 844×390. Run one desktop regression case at 720px or wider. Assertions may use a representative viewport where behavior is width-independent; geometry and overflow assertions run across the full matrix.

The suite proves:

- The document has no horizontal or vertical overflow. In the closed, ready state, the app shell fits the viewport, the Thread is the vertical scroll owner, and the composer remains visible. In Configuration, the Configuration panel replaces the compact Thread, status, and composer rather than sharing their space.
- Top-bar, Configuration, Send, and other interactive controls have visible labels, reachable focus, a visible `:focus-visible` indicator, and a minimum 44×44px hit box except where a native text/select control's width is deliberately fluid. The prompt has a programmatic label and status/error output is a live region. Automated color checks are limited to asserting the intended style tokens; the real-device pass judges legibility.
- With no applied configuration, Configuration opens and cannot be cancelled. With a persisted applied configuration, startup checking locks Thread actions; successful checking closes Configuration; failed checking opens it with values intact. Configure opens a fresh draft; Cancel discards it. Apply trims the token, makes one `/info` request, prevents duplicate submission, and atomically commits only a completely valid draft. Every specified failure keeps the panel and draft visible, leaves the applied configuration unchanged, focuses/associates the error, and never exposes the token.
- Explicit model changes reset only an unsupported reasoning choice to **Default**. Default model, reasoning, and permissions are omitted from `/turn`. During a Turn, **New** and **Configure** are disabled and the Turn uses the applied-configuration snapshot; both controls recover on success and failure.
- The prompt grows from approximately 46px to `min(160px, 30% of the viewport height)`, then scrolls internally. Submit rejects whitespace-only input; a valid submit clears and remeasures the prompt, keeps existing prompt focus, enables follow mode, and disables Send until success or failure. **New** clears the Thread, resets its scroll and composer height, and focuses the prompt.
- Streaming follows the bottom when the pre-update bottom distance is at most 80px and batches scrolling to at most once per animation frame. Scrolling beyond 80px disables following and preserves the reader's position; returning to the zone restores it. Resize tests cover both states: follow mode settles at the new bottom, while reading mode retains the top visible message and offset within reasonable rounding tolerance. No asynchronous event steals focus.
- Ordinary message text preserves line breaks, wraps without widening the Thread, and breaks a long unspaced token. Complete triple-backtick agent blocks render as semantic `pre > code`, hide the fences, preserve whitespace, and own their horizontal overflow; unmatched fences and inline backticks remain text. Content is inserted as text, demonstrated with an HTML/script-shaped payload that remains inert.
- `viewport-fit=cover`, dynamic-viewport sizing, safe-area inset usage on all four relevant edges, and reduced-motion-compatible immediate scrolling are present. A reduced-height viewport test approximates keyboard pressure but does not count as keyboard acceptance.
- The desktop case preserves the existing 720px content cap, order, colors, hierarchy, control appearance, and all current Relay request/stream behavior. Pixel identity and desktop layout redesign are not required.

### Manual device/browser contract

Before release, run the same short smoke script on one currently supported iPhone in Safari and one currently supported Android phone in Chrome. Use portrait and landscape; on at least one device also inspect a 320px-wide layout through browser responsive mode or an available small device. Record device model, OS version, browser version, orientation, and pass/fail notes. Physical devices are preferred; a simulator/emulator is acceptable only when a physical device is unavailable and must be recorded as such.

On each browser:

1. Open Configuration, edit and Cancel, then reopen and Apply valid values. Confirm focus movement, readable validation, approximately 44px targets, and that a rejected token leaves the draft visible without revealing it.
2. Start a Turn, confirm **New** and **Configure** lock, and type/paste enough text to reach the composer cap. Open and close the software keyboard and rotate once; the focused composer stays above the keyboard and safe areas, while the Thread remains usable and the page never pans, scales, or scrolls horizontally.
3. While a long response streams, first remain at the bottom, then scroll upward, then return to the bottom. Confirm following, reader-position preservation, and resumption match the 80px contract without visible jumping or focus theft.
4. Inspect ordinary prose, a long unbroken token, and a long fenced code line. Only the code block scrolls horizontally. Check controls and text for obvious contrast/legibility problems, enable reduced motion, and complete the flow with keyboard-only navigation where the mobile environment supports it.
5. In landscape, confirm notch/rounded-corner insets protect the top bar and content and the home-indicator inset protects the composer.

A reproducible Safari- or Chrome-specific failure blocks acceptance and becomes a narrowly scoped follow-up ticket; do not pre-emptively add browser workarounds. The manual pass is required because desktop Chromium emulation cannot establish software-keyboard, browser-chrome, safe-area, touch, or mobile-engine behavior.

### Completion boundary

Acceptance requires the automated suite, both manual browser passes, and an implementation review confirming no Relay or Codespace change was introduced. Existing desktop behavior may benefit from the new scroll shell, but visual redesign, general Markdown, new Thread controls, interruption/reconnect behavior, screenshot-perfect parity, and broader device certification remain out of scope.

No new domain term or hard-to-reverse architectural decision was introduced, so `CONTEXT.md` and an ADR do not need changes. No currently known browser accommodation or Relay API dependency remains in the map's fog.
