# Specify Settings, Configuration, and Thread-entry states

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Determine Codex configuration and Status capabilities](01-determine-codex-configuration-and-status-capabilities.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

What complete Mobile Client state contract should govern first-use Settings, later token edits, Codex availability loading, the separate AI-star Configuration panel, **New**, **Resume**, composer locking, Applied configuration, Fast mode, and the one-time pre-Turn model-configuration announcement?

## Resolution

Treat Relay authentication, requested Codex configuration, and effective Thread settings as separate state.

- On first use, open the gear-triggered **Settings** panel automatically and do not offer cancellation. Until its API token authenticates and live Codex availability loads, disable **New**, **Resume**, the AI-star-triggered **Configuration** panel, and the composer.
- Later Settings edits are transactional and cancellable. While validation is pending, retain the previously authenticated state underneath but prevent conflicting actions. Cancellation or failure restores the prior token, availability, Applied configuration, current Thread, and transcript unchanged. A successful token change commits the token, reloads availability, preserves the current Thread and transcript, and resets every Applied configuration field to Default.
- Settings and Configuration are mutually exclusive focused views. Opening either closes the other, the Resume picker, and expanded Status details and makes the composer unavailable. Closing returns focus to the corresponding icon trigger without changing Thread state.
- Configuration becomes available only after live model data loads. It owns model, reasoning effort, permissions, and Fast mode. Model-specific reasoning choices and Fast availability come from that live catalog; never offer Fast for a model that does not advertise the applicable service tier.
- An Applied configuration is the last committed set of Mobile Client choices. Default means no explicit Mobile Client override, including on an existing Thread; it does not force global defaults onto that Thread. Applying Configuration to an existing Thread stages overrides for its next and subsequent Turns without creating a Thread or changing its transcript. Requested values remain distinct from effective runtime values until Codex confirms them.
- **New** immediately resets to a fresh local Thread view without creating a Codex Thread. It never asks for confirmation when leaving an idle Thread because that Thread remains resumable, but it is unavailable during an active Turn. New enables the composer and Configuration, reuses the last valid Applied configuration normalized against current capabilities, and uses all-Default choices on first use or after a successful token change.
- Before the first Turn, the New view displays a configuration announcement containing only requested Model, Reasoning, Permissions, and Fast mode, with unresolved choices labelled `Default`. It never includes a Thread ID or presents requested values as effective. It remains visible until the first Turn starts; assistive technology announces it once after New and again only when the pre-Turn Applied configuration changes.
- A successful **Resume** preserves the transcript and replaces Applied configuration with each effective model, reasoning, permissions, and Fast value Codex reports for that Thread. Missing effective values remain `Unavailable`; do not fill them from unrelated requested choices. Resume is unavailable during an active Turn.
- Persist authentication, Applied configuration, the current Thread reference and transcript, and whether the user is in an untouched local New view across reloads. A local New view reloads composer-enabled. A persisted Thread reload keeps input disabled until rehydration completes. If rehydration proves the Thread unavailable, enter a fresh composer-enabled local New view and explain the recovery without creating a Codex Thread.
- During an active Turn, prevent New, Resume, Settings edits, and Configuration edits. Keep Status available.
