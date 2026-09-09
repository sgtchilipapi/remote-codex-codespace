# Make the Mobile Client work well on narrow screens

Label: `wayfinder:map`

## Destination

An implementation-ready specification for a focused responsive cleanup of the Mobile Client on modern iPhone and Android browsers, including widths from 320px upward, while preserving its current desktop behavior and visual character.

## Notes

- Domain: Remote Codex Relay. Use the vocabulary in [`CONTEXT.md`](../../../CONTEXT.md).
- Consult the `grilling`, `domain-modeling`, and `prototype` skills when their ticket types require them.
- This map plans the work; it does not implement the responsive cleanup.
- Mobile is the primary target. Desktop remains supported but is secondary.
- Use width-based responsive behavior and verify at 320px, 360px, 390px, and 430px, plus landscape phone layouts.
- The Configuration panel stages API token, model, reasoning effort, and permissions. It starts open until valid configuration exists, then starts collapsed. **Apply and close** commits all staged values; validation failure keeps it open and visible.
- Keep the composer sticky above the mobile keyboard and safe area. Let it grow to a capped height, then scroll internally.
- Auto-scroll streaming output only while the reader is near the bottom.
- Wrap ordinary message text; horizontally scroll preformatted/code content inside its message. Never introduce page-level horizontal scrolling.
- Disable Configuration panel changes and **New** while a Turn is active.
- Preserve visible focus, semantic labels, contrast, and reduced-motion compatibility, with approximately 44px touch targets.
- Verification must combine lightweight automated layout/interaction checks with manual iOS Safari and Android Chrome checks. The implementation plan will select the automation tool.

## Decisions so far

- [Audit the Mobile Client at target viewport widths](tickets/01-audit-target-viewports.md): Baseline captures identify portrait navigation overflow, undersized controls, non-sticky and fixed-height composer behavior, unconditional bottom scrolling, missing safe-area handling, and undifferentiated message wrapping as the compact layout's concrete failure set.
- [Choose the compact Mobile Client layout](tickets/02-choose-compact-layout.md): Use focus mode—Configuration replaces the compact content area while open, then disappears completely so the Thread and sticky composer retain the viewport, with **Configure** as its only entry point.

## Not yet specified

- Any browser-specific accommodations revealed by the baseline audit or prototype need to be classified and ticketed when known.
- Any Relay API change needed to support the agreed Mobile Client behavior must be isolated and assessed if the prototype reveals one.

## Out of scope

- New product capabilities such as Markdown rendering, Turn interruption, reconnect controls, or richer Thread management.
- A broad visual redesign or equal-priority tablet/desktop redesign.
- Changes to the Relay or Codespace unless required to realize an agreed responsive Mobile Client behavior.

## Open child tickets

1. [Specify Configuration panel state and validation](tickets/03-specify-configuration-panel.md)
2. [Specify Thread scrolling and composer behavior](tickets/04-specify-thread-and-composer.md)
3. [Define the responsive acceptance contract](tickets/05-define-acceptance-contract.md)
