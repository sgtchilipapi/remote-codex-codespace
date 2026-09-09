# Choose the compact Mobile Client layout

Label: `wayfinder:prototype`
Status: closed
Assignee: codex
Blocked by: [Audit the Mobile Client at target viewport widths](01-audit-target-viewports.md)
Parent: [Make the Mobile Client work well on narrow screens](../map.md)

## Question

Using a cheap interactive prototype, which concrete narrow-screen arrangement best preserves readable Thread content and immediate access to the sticky composer while placing token, model, reasoning, and permissions in the collapsible Configuration panel? Validate expanded, collapsed, first-use, configured, streaming, keyboard-open, error, and landscape states with the human.

## Resolution

Use the prototype's **C · Focus mode** arrangement on narrow screens. The compact Mobile Client has a small top bar with the product name, **New**, and a single **Configure** control. When Configuration is closed, it contributes no extra summary rail or duplicate **Edit** action: the Thread receives all remaining height above the sticky composer. When Configuration is open, it replaces the Thread, status, and composer in the content area so token, model, reasoning effort, permissions, validation feedback, and **Apply and close** can use the constrained viewport without competing with the active Thread.

The human selected C after comparing three structurally different arrangements. Their confusion about C's initial collapsed summary rail exposed that it duplicated the top-bar **Configure** control, so that rail was removed and the single-entry-point version was validated as the winner. The prototype exposes first-use, configured, streaming, and error states, Configuration expanded/collapsed states, and can be resized for keyboard-open and landscape review. During a Turn, **New** and Configuration inputs are disabled.

Prototype: [compact Mobile Client layout variants](../../../../public/mobile-layout-prototype.html) (throwaway; run with `npm start` and open `/mobile-layout-prototype.html?variant=C`).

This settles arrangement and hierarchy only. [Specify Configuration panel state and validation](03-specify-configuration-panel.md) owns the exact Configuration state contract; [Specify Thread scrolling and composer behavior](04-specify-thread-and-composer.md) owns precise dimensions, keyboard/safe-area behavior, scrolling, and content overflow.
