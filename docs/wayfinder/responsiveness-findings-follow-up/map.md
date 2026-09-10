# Resolve the post-responsive Mobile Client findings

Label: `wayfinder:map`

## Destination

An implementation-ready specification that resolves every finding in [`responsiveness-ticket-findings.md`](../../issues/responsiveness-ticket-findings.md), including the required Mobile Client state transitions, Relay/app-server data contracts, and regression coverage.

## Notes

- Domain: Remote Codex Relay. Use the vocabulary in [`CONTEXT.md`](../../../CONTEXT.md); call retained Codex interactions **Threads**, not sessions.
- Consult the `grilling`, `domain-modeling`, and `prototype` skills when their ticket types require them.
- This map plans the work; it does not implement the findings.
- Preserve the responsive behavior established by [Make the Mobile Client work well on narrow screens](../mobile-friendly-client/map.md).
- Split Relay authentication from Codex behavior: **Settings** owns only the API token and uses a gear icon; **Configuration** owns model, reasoning effort, permissions, and Fast mode and uses an AI-star icon.
- On first use, Settings opens automatically and cannot be cancelled. Later Settings edits are transactional and cancellable. Successful authentication enables **New** and **Resume**.
- **New** remains a local reset and does not create an empty Codex Thread. It enables the composer and Configuration, and briefly announces only the selected model configuration before the first Turn. Never announce a Thread ID.
- Configuration remains unavailable until Codex model and reasoning availability has been loaded. A successful **New** or **Resume** enables it in the resulting Thread view.
- Each completed Codex `agentMessage` item becomes its own assistant bubble.
- Status reports effective runtime values where available: model, reasoning, Fast mode, context window, remaining five-hour and weekly limits, and each reset time. Unknown values are labelled unavailable rather than inferred.
- Prefer metadata-only filtering of CLI or `codex exec` Threads that the Relay cannot resume. Do not probe by resuming them; if metadata cannot distinguish them reliably, keep them in the picker.

## Decisions so far

- [Determine Codex configuration and Status capabilities](tickets/01-determine-codex-configuration-and-status-capabilities.md): Live model data governs model/reasoning/Fast availability; effective settings require start/resume plus settings notifications, context is notification-only, and quota windows must be matched by duration.
- [Determine whether incompatible CLI Threads can be filtered](tickets/02-determine-cli-thread-filtering.md): Explicitly allow only `vscode` and `appServer` sources during listing and metadata revalidation, excluding known-incompatible `cli` and `exec` Threads without probing.
- [Specify Settings, Configuration, and Thread-entry states](tickets/03-specify-settings-configuration-and-thread-entry.md): Separate transactional authentication, requested configuration, and effective Thread state; New is a resumable local reset, Resume adopts reported settings, and active Turns lock conflicting controls.
- [Specify assistant item grouping](tickets/04-specify-assistant-item-grouping.md): Reconcile each agent item into its own ID-keyed bubble, keep replay idempotent and resumed history canonical, and show token-free transient activity without sacrificing partial-output or reader-position behavior.
- [Specify effective Status presentation](tickets/05-specify-effective-status-presentation.md): Preserve the existing Status action, show concrete pre-Turn configuration without creating a Thread, then prefer confirmed effective settings, live context occupancy, duration-matched remaining limits, and explicit freshness states.
- [Specify the Relay configuration and Status contract](tickets/07-specify-relay-configuration-and-status-contract.md): Separate catalog, read-only pre-Turn resolution, and scoped Status routes; validate live combinations, retain notification-derived effective state in memory, and return independently fresh or unavailable fields through sanitized partial-success envelopes.
- [Define the findings acceptance contract](tickets/06-define-findings-acceptance-contract.md): Make deterministic Node Relay and Chromium Playwright coverage under `npm test` the sole gate, exercising every distinct observable outcome across the established responsive viewport matrix.
- [Separate Settings and establish the authenticated entry gate](tickets/08-separate-settings-and-authenticated-entry.md): Isolate token authentication in non-cancellable first-use and transactional later Settings, gating Thread entry on live availability while preserving Thread state across token edits.
- [Add capability-driven Configuration with Fast mode](tickets/09-add-capability-driven-configuration.md): Project live Codex capabilities into a transactional Configuration draft, validate one atomic revision, and carry advertised Fast mode into the first Turn.
- [Make New a revision-safe local Thread entry](tickets/10-make-new-revision-safe-local-entry.md): Persist and announce one concrete local Pre-Turn snapshot, bind it to the first Turn, and safely re-resolve obsolete revisions before Codex starts.
- [Resume Eligible Threads with canonical effective state](tickets/11-resume-eligible-threads-with-effective-state.md): Filter listing and revalidation to allowed sources, and atomically install canonical ID-bearing history with only Codex-reported effective settings.

## Not yet specified

None.

## Out of scope

- Creating empty Codex Threads when **New** is tapped.
- Displaying or announcing Thread IDs to the user.
- Probing Thread resumability by attempting `thread/resume` during list loading.
- Reopening the completed responsive layout redesign or changing its viewport, scrolling, keyboard, safe-area, and accessibility boundaries except where these findings require new controls or content.
- [Cross-browser checks on iOS Safari and Android Chrome](../../issues/validate-mobile-client-on-ios-safari-and-android-chrome.md) are deferred until implementation and do not gate this Chromium-only specification.

## Open child tickets

1. [Render item-owned assistant and Activity bubbles](tickets/12-render-item-owned-assistant-and-activity-bubbles.md)
2. [Rehydrate persisted Thread and local-New views safely](tickets/13-rehydrate-persisted-thread-views.md)
3. [Expose and present effective Status end to end](tickets/14-expose-and-present-effective-status.md)
4. [Retire the compatibility facade and enforce the release matrix](tickets/15-retire-info-and-enforce-release-matrix.md)
