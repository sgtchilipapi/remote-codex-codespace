# Audit the Mobile Client at target viewport widths

Label: `wayfinder:task`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Make the Mobile Client work well on narrow screens](../map.md)

## Question

Capture the current Mobile Client at 320px, 360px, 390px, and 430px widths and in a representative landscape phone viewport. What concrete overflow, wrapping, keyboard, safe-area, touch-target, focus, message-reading, status, and composer failures must the compact-layout decision account for? Record reproducible observations and link any screenshots as ticket assets.

## Resolution

Audited the current `public/index.html` in headless Chromium with touch/mobile emulation at 320×568, 360×800, 390×844, 430×932, and a representative 844×390 landscape viewport. Each viewport was captured empty and with a seeded long Thread and status. A 390×420 reduced-height capture approximates the visual viewport after a keyboard opens; it is not a substitute for the manual iOS Safari and Android Chrome checks required by the map.

Evidence:

- [320px empty](../assets/baseline-audit/320-empty.png) and [320px populated Thread](../assets/baseline-audit/320-thread.png)
- [360px empty](../assets/baseline-audit/360-empty.png) and [360px populated Thread](../assets/baseline-audit/360-thread.png)
- [390px empty](../assets/baseline-audit/390-empty.png) and [390px populated Thread](../assets/baseline-audit/390-thread.png)
- [430px empty](../assets/baseline-audit/430-empty.png) and [430px populated Thread](../assets/baseline-audit/430-thread.png)
- [844×390 landscape empty](../assets/baseline-audit/landscape-844x390-empty.png) and [844×390 landscape populated Thread](../assets/baseline-audit/landscape-844x390-thread.png)
- [390×420 keyboard-height simulation](../assets/baseline-audit/390x420-keyboard-simulation.png)
- [Raw measured geometry and computed styles](../assets/baseline-audit/metrics.json)

Reproduction: start the Relay, set the browser viewport to each size above, and load `/`. For the populated state, seed `localStorage.relay` with a user message and a multiline assistant message containing a long unbroken token, reload, then set a long status string. Inspect `document.documentElement.clientWidth` and `scrollWidth`, control bounding boxes, focused-control styles, and the form's computed position. Scroll away from the bottom while output is appended to observe redraw behavior.

Concrete baseline failures and constraints for the compact-layout decision:

- **Portrait overflow:** all four portrait targets have a 443px document scroll width (123px, 83px, 53px, and 13px wider than the respective layout viewport). The unwrapped `nav` row is the source: its intrinsic-width controls do not fit. Content is clipped off the right edge or requires page-level horizontal scrolling. At every portrait width, `#model` is squeezed to 2px and becomes effectively invisible/unusable while reasoning and permissions retain their intrinsic widths. The empty and populated states both fail.
- **Landscape density:** 844×390 avoids horizontal overflow, but configuration consumes two 39px rows plus gaps before the Thread. A populated Thread is 1,196px tall, so the static header and composer cannot coexist with useful reading space in the short viewport.
- **Touch targets:** API token, New, Status, model, reasoning, and permissions are all 39px tall, below the map's approximately 44px target. The collapsed 2px model control is also far below the width target in portrait. The 77px composer controls meet the height target.
- **Message reading and wrapping:** ordinary prose remains inside message cards, and `white-space: pre-wrap` plus `overflow-wrap: anywhere` prevents the seeded unbroken token from widening the message. However, all message content is plain text with one wrapping policy: command/code-like content is forcibly broken character-by-character instead of scrolling horizontally inside its message, so its spacing and scanability are lost. There is no separate preformatted/code treatment.
- **Thread scrolling:** `#messages` is not a scroll region; the whole document scrolls. Every `draw()` calls `window.scrollTo(0, document.body.scrollHeight)`, including each streamed agent-message completion, so a reader who has scrolled upward is forced back to the bottom. The header, status, and composer leave the viewport with document scrolling.
- **Composer and keyboard:** the form's computed position is `static`, not sticky or fixed. It happens to sit near the bottom in an empty 390×420 reduced-height simulation because `main` is a `min-height: 100dvh` flex column, but in a long Thread it is only reachable at the document bottom. Focusing it can make the browser scroll it into view, but there is no deliberate visual-viewport/keyboard handling or guarantee that it remains available as the viewport changes.
- **Composer growth:** the textarea is fixed at `rows="3"`, has `resize: none`, and has no input-driven height calculation or overflow cap. Long prompts scroll within the fixed 77px field immediately rather than growing to a defined cap.
- **Safe areas:** the viewport declares `viewport-fit` nowhere, and the layout uses fixed 16px padding with no `env(safe-area-inset-*)`. Controls and content therefore have no explicit protection from notches, rounded corners, or the home indicator, especially in landscape and when the composer reaches the bottom edge.
- **Status:** status is low-contrast secondary text and wraps rather than causing additional horizontal overflow, but it sits in normal document flow between Thread and composer. A long status consumes scarce vertical space and scrolls off-screen; it has no live-region semantics, so asynchronous status changes are not guaranteed to be announced.
- **Focus and labels:** native keyboard focus is present (`outline: auto 1px`) on the tested Send button, but there is no explicit `:focus-visible` treatment to preserve a robust visible indicator across browsers. Token and selects have `aria-label`s and buttons have visible text; the prompt relies on placeholder text rather than an explicit semantic label. Device/browser verification must check focus visibility rather than assuming Chromium's native outline is consistent.
- **Active Turn controls:** only Send is disabled during a Turn. New, token, model, reasoning, and permissions remain operable, conflicting with the map's requirement to disable New and Configuration panel changes while a Turn is active.
- **Reduced motion and contrast:** there is currently no animation, so reduced-motion settings expose no immediate failure. The compact layout should preserve that compatibility and verify text/control contrast as styles evolve.

No browser-specific workaround or Relay API dependency became concrete enough to add a new ticket. The existing [Choose the compact Mobile Client layout](02-choose-compact-layout.md), [Specify Configuration panel state and validation](03-specify-configuration-panel.md), [Specify Thread scrolling and composer behavior](04-specify-thread-and-composer.md), and [Define the responsive acceptance contract](05-define-acceptance-contract.md) tickets cover every decision surfaced by this audit.
