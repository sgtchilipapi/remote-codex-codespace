# Specify effective Status presentation

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Determine Codex configuration and Status capabilities](01-determine-codex-configuration-and-status-capabilities.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Given the app-server data that is actually available, what should the detailed Status action display for effective model, reasoning, Fast mode, context window, five-hour and weekly remaining limits, and reset times across a new local Thread view, a resumed Thread, an active Turn, stale data, and upstream failure?

## Resolution

Keep the existing **Show status** icon action and single live status region; do not introduce a separate panel or change its established responsive placement. Status remains available during an active Turn. Its detailed output follows this contract:

- In a new local Thread view before the first Turn, resolve the **Pre-Turn configuration** from the current Codex configuration plus any Applied configuration and show the concrete `Model`, `Reasoning`, `Fast mode`, and `Permissions` values without `Default`, `requested`, or `Will use` qualifiers. The first Turn must use the same snapshot unless the user changes Configuration. Show `Context usage: Not started`. Invoking Status remains read-only and must not create a real empty Codex Thread.
- Once a real Thread starts or resumes, replace the pre-Turn snapshot with Codex-confirmed effective model, reasoning, Fast mode, and permissions values. Settings notifications supersede the start or resume snapshot. A missing field is independently `Unavailable`; never fill it from stale Mobile Client selections or hide other known fields.
- During an active Turn, tapping Status fetches and displays a fresh snapshot without interrupting the Turn. Subsequent lifecycle messages such as `Codex is working…` may replace the detailed output in the existing live region. Tapping Status again refreshes it.
- Show context occupancy as `<current-context tokens> / <model context window> (<percentage>%)`, using the latest model-call usage rather than cumulative Thread tokens. Update it from live token-usage notifications during a Turn and retain the last confirmed value afterward. If the required usage or window value is missing, show `Unavailable` rather than infer it.
- Identify the five-hour and weekly rate-limit windows by their reported durations, never by primary/secondary position. Display each as remaining percentage plus reset, for example `5-hour: 73% remaining · Resets Sep 10, 4:30 PM` and `Weekly: 41% remaining · Resets Sep 15, 12:00 AM`. Clamp calculated remaining percentages to `0..100`. Format resets in the browser's local timezone and expose the timezone abbreviation to assistive technology. If either component is absent, mark only that component `Unavailable`.
- Retain last-confirmed values when refresh or upstream access fails, add `Last updated <time>` and `May be outdated`, and present one unobtrusive error with a Retry action. A value never received is `Unavailable`; a failed refresh must not erase confirmed data.
