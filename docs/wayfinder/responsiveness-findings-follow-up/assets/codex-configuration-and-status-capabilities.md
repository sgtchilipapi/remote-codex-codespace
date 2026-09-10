# Codex configuration and Status capabilities

Research date: 2026-09-10  
Installed CLI inspected: `codex-cli 0.153.4`

## Conclusion

The Relay can support the proposed Configuration and Status surfaces without speculative values, provided it preserves more of the app-server protocol than it does today. Model, reasoning, and Fast-tier availability should be loaded only after authentication from `model/list`. Effective settings for an actual Thread should come from `thread/start` or `thread/resume`, then be kept current from `thread/settings/updated`. Context consumption is available only from live `thread/tokenUsage/updated` notifications. ChatGPT quota usage and reset times come from `account/rateLimits/read` and rolling `account/rateLimits/updated` notifications.

No protocol field literally says “five-hour remaining” or “weekly remaining.” A client must identify windows from `windowDurationMins`, calculate remaining as `100 - usedPercent`, and display a reset only when `resetsAt` is non-null. Likewise, the protocol exposes effective sandbox policy, not the Mobile Client's simplified `default` / `read-only` / `workspace-write` selection provenance.

## Capability matrix

| Need | Authoritative app-server source | Interpretation and limitations |
| --- | --- | --- |
| Available models | `model/list` → `data[]` | Use picker-visible entries (the default behavior), with `id`, `displayName`, `isDefault`, and `hidden`. The official app-server documentation explicitly says to call this before rendering selectors. |
| Reasoning availability | `model/list` → each model's `supportedReasoningEfforts[]`; suggested catalog default in `defaultReasoningEffort` | This is model-specific availability. `defaultReasoningEffort` is a catalog suggestion, not proof of a Thread's effective effort. |
| Fast/service-tier availability | `model/list` → each model's `serviceTiers[]` (`id`, `name`, `description`) and `defaultServiceTier` | Offer Fast only when the selected model advertises the applicable tier. Do not hard-code model support. The installed schema marks `additionalSpeedTiers` deprecated in favor of `serviceTiers`. |
| Account/config defaults | read-only `config/read` → `config.model`, `model_reasoning_effort`, `sandbox_mode`, `service_tier`, plus origin metadata | These are layered defaults before a Thread resolves them. They should not be presented as effective Thread values. `config/read` is useful if the UI needs to preview Codex defaults before the first Turn, but the model catalog remains the availability authority. |
| Effective model/reasoning/tier on Thread creation or resume | `thread/start` and `thread/resume` response top-level `model`, nullable `reasoningEffort`, nullable `serviceTier` | These responses resolve defaults and overrides. They are more authoritative than the nested `thread.model` / `thread.reasoningEffort`, especially because unloaded persisted Thread fields can be unavailable. |
| Effective permissions | `thread/start` / `thread/resume` response `sandbox` and `approvalPolicy`; then `thread/settings/updated` → `threadSettings.sandboxPolicy`, `approvalPolicy`, and nullable `activePermissionProfile` | Report the effective policy shape. A simplified label can be derived from the sandbox type, but “Default” provenance is unavailable from these effective fields. `activePermissionProfile`, when present, is the better profile-provenance source; the schema calls the response's `sandbox` field legacy. |
| Keep effective settings current | `thread/settings/updated` → `threadSettings.model`, nullable `effort`, `sandboxPolicy`, nullable `serviceTier`, and approval/profile fields | Turn overrides persist for later Turns, so snapshotting only the resume response becomes stale. The Relay must subscribe and retain this notification for the current Thread. |
| Context-window consumption | `thread/tokenUsage/updated` → `tokenUsage.modelContextWindow`, `tokenUsage.last`, and `tokenUsage.total` | `last` is the latest model-call usage and `total` is cumulative Thread usage. For “current context used,” use `last.totalTokens / modelContextWindow` when both are available; cumulative `total.totalTokens` is not current context occupancy and can exceed a context window over many Turns. Both the context window and updates may be absent before the first model call or after reconnect unless a fresh notification is emitted. There is no read request in this installed schema for current Thread context occupancy. |
| Five-hour and weekly limits | `account/rateLimits/read` → `rateLimits` or `rateLimitsByLimitId`; each snapshot's nullable `primary` / `secondary` windows contain `usedPercent`, nullable `windowDurationMins`, nullable `resetsAt` | Identify the five-hour window by `windowDurationMins === 300` and weekly by `10080`, regardless of primary/secondary position. Remaining percentage is a client calculation, clamped to `0..100`. If duration, window, or reset is absent, label that value unavailable instead of guessing. |
| Live rate-limit changes | `account/rateLimits/updated` | Updates are sparse. Merge provided values into the last full read or refetch; null account metadata in a rolling update does not erase a prior value. |

## Thread state versus Turn overrides

`thread/start` accepts nullable `model`, `sandbox`, and `serviceTier`; in the generated v2 schema it does not have a first-class reasoning-effort field. A new Thread's reasoning choice can instead be applied when its first `turn/start` is sent. `turn/start` accepts `model`, `effort`, `sandboxPolicy`, `approvalPolicy`, and `serviceTier`; the schema and official docs state that these override the current Turn **and subsequent Turns**. `serviceTierForTurn` is the exception: it affects only the newly started Turn and does not change the Thread tier.

Therefore Fast mode should be modeled according to the desired persistence:

- For the proposed applied Thread configuration, send `serviceTier` on `turn/start`; use the advertised tier id. The config reference says `fast` maps to the request value `priority`, while the model catalog is the source of advertised tiers.
- Do not use `serviceTierForTurn` unless the product deliberately wants a one-Turn-only speed choice.
- After any override, consume `thread/settings/updated` to display what Codex now considers effective.

The first-Turn “new Thread” status can safely show the selected catalog-backed model/reasoning/permissions/Fast choices before submission, but they are requested choices, not resolved runtime settings. It should not imply that a real Codex Thread exists yet. After `thread/start` and the first `turn/start`, replace staged values with the effective response/notification values when Status is next requested.

## Repository gap analysis

The current Relay's [`/info`](../../../../server.js) already calls `model/list` and `account/rateLimits/read`, but discards `serviceTiers`, `defaultServiceTier`, `windowDurationMins`, and `resetsAt`, and returns only the backward-compatible single rate-limit bucket. It also does not forward `thread/tokenUsage/updated` or `thread/settings/updated`.

The current new-Thread path passes reasoning as `effort` to `thread/start`, although the installed v2 `ThreadStartParams` schema has no `effort` field. It passes resumed-Thread permissions as `permissions` to `turn/start`, while the installed schema names the field `sandboxPolicy`. The implementation specification should correct these protocol mappings and preserve the effective start/resume response fields.

The current Mobile Client's [`Status` handler](../../../../public/client.js) displays locally applied choices and hard-labels `primary` as `5h` and `secondary` as `Weekly`; it neither shows resets nor distinguishes staged/account defaults from effective Thread state.

## Unavailable or unsafe-to-infer values

- There is no universal “Fast enabled” boolean. Availability is a per-model catalog tier; effective state is nullable `serviceTier`.
- There is no protocol guarantee that `primary` means five hours and `secondary` means a week. Use durations.
- There is no direct remaining-percent field. Derive it from `usedPercent`.
- There is no direct read endpoint for live current-context occupancy in the inspected schema. It is notification-derived and can be unavailable.
- There is no reliable “Default permissions” marker after defaults resolve. The effective sandbox and approval policy are available, but their origin is not carried on the effective Thread settings (except optional permission-profile provenance).
- Nested `Thread.model` and `Thread.reasoningEffort` are explicitly persisted/current configuration metadata, not per-Turn execution telemetry. They can be null when unavailable and should not be upgraded into stronger claims.

## Sources

- [Official Codex App Server documentation](https://developers.openai.com/codex/app-server/): model discovery, persistent Turn overrides, event streams, token-usage notification, and ChatGPT rate-limit request/notification semantics.
- [Official Codex configuration reference](https://developers.openai.com/codex/config-reference/): `service_tier`, Fast-to-`priority` mapping, and layered new-Thread defaults.
- Installed generated v2 schema, produced read-only with `codex app-server generate-json-schema --out <temporary-directory>` under Codex CLI 0.153.4: `ModelListResponse.json`, `GetAccountRateLimitsResponse.json`, `ThreadTokenUsageUpdatedNotification.json`, `ThreadStartParams.json`, `ThreadStartResponse.json`, `ThreadResumeResponse.json`, `TurnStartParams.json`, `ThreadSettingsUpdatedNotification.json`, and `ConfigReadResponse.json`.
- Repository implementation: [`server.js`](../../../../server.js) and [`public/client.js`](../../../../public/client.js).
