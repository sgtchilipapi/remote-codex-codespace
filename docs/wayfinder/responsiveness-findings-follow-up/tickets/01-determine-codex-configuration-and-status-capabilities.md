# Determine Codex configuration and Status capabilities

Label: `wayfinder:research`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Using current official Codex documentation, the installed app-server protocol schema, and read-only inspection of this repository, which app-server requests and fields expose model and reasoning availability, effective model/reasoning/permissions, Fast mode or service tier, context-window usage, remaining five-hour and weekly limits, and their reset timestamps? Identify unavailable data explicitly and distinguish account defaults, Thread state, and Turn overrides.

## Resolution

Use live `model/list` data for model, reasoning, and service-tier availability; use start/resume responses plus `thread/settings/updated` for effective Thread configuration; derive live context occupancy from `thread/tokenUsage/updated`; and identify quota windows by reported duration from `account/rateLimits/read`, never by primary/secondary position. Missing context, reset, duration, tier, or default-provenance data must remain explicitly unavailable. The full capability matrix, protocol caveats, and current Relay gaps are recorded in [Codex configuration and Status capabilities](../assets/codex-configuration-and-status-capabilities.md).
