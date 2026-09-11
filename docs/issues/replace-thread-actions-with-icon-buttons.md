# Replace Thread action labels with icon buttons

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

The **New**, **Resume**, and **Configure** actions in the Mobile Client header currently use text buttons. Replace them with compact, recognizable icon buttons while preserving their existing behavior, focus handling, and disabled states.

Use these icons:

- **New:** plus sign.
- **Resume:** history icon (a counterclockwise arrow around a clock).
- **Configure:** horizontal sliders icon, distinct from the existing **Settings** gear.

The **New** control must use the inverted header treatment: no background or border, with the plus rendered in the header's foreground color. Resume and Configure may retain the standard button surface, but all three controls should share consistent dimensions, spacing, stroke weight, and interaction states.

## Acceptance Criteria

- The visible text labels for New, Resume, and Configure are replaced by the specified icons.
- New has a transparent background in its default state and uses the header foreground color for its plus icon.
- Each control retains an approximately 44 by 44 CSS-pixel touch target at all supported viewport sizes, including 320px wide screens.
- Each button has an accessible name matching its action (`New`, `Resume`, and `Configure`), even though its visible contents are icon-only; decorative SVG content is hidden from assistive technology.
- A pointer-hover tooltip identifies each action, using `title` or an equivalent accessible tooltip implementation.
- Existing keyboard focus indication, disabled styling, click behavior, and active-Turn locking remain intact.
- Configure continues to open and close the Configuration focus view without replacing or removing its SVG icon. Its accessible state communicates whether the panel is open (for example, with `aria-expanded`), and its accessible name remains meaningful when the action will close the panel.
- Resume continues to open the Resume focus view and focus its heading; cancelling that view returns focus to the Resume icon button.
- Automated Mobile Client coverage addresses the icon-only accessible names, Configure open/closed state, disabled states, focus restoration, and the absence of header overflow at compact and desktop widths.

## Out of Scope

Changing the actions themselves, redesigning the Configuration or Resume views, changing the existing Settings icon, or introducing a third-party icon library.

## Resolution

Implemented on 2026-09-11. The Mobile Client header now uses an inverted plus for New, a history/clock-arrow for Resume, and sliders for Configure. All three retain 44px touch targets, accessible names, tooltips, focus and disabled behavior, while Configure exposes its expanded state without replacing its icon. Browser coverage verifies the icon-only contract and compact layout behavior.
