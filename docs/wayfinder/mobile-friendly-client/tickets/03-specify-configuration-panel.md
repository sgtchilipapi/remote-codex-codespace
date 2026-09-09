# Specify Configuration panel state and validation

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: [Choose the compact Mobile Client layout](02-choose-compact-layout.md)
Parent: [Make the Mobile Client work well on narrow screens](../map.md)

## Question

What complete state-transition and validation contract should govern opening, staging, applying, cancelling, failing, and re-opening the Configuration panel, including initial configuration, persisted values, loading model information, and the disabled state during an active Turn?

## Resolution

Resolved with the human on 2026-09-09. Use separate **applied configuration** and **configuration draft** state, governed by this contract:

### Validity and persistence

- A configuration is valid when its API token is non-empty and a `/info` request made with that token succeeds. Model, reasoning effort, and permissions may each be **Default**; they are not required for validity.
- The applied configuration is the last complete draft that passed authentication and consistency checks. Persist it in local storage, including the token, for future visits. Do not log, display, or include the token in error text.
- Configuration controls edit only the configuration draft. Field changes never mutate the applied configuration or local storage.
- Opening Configuration creates a fresh draft from the applied configuration. A previously abandoned or failed draft is not resurrected after the panel has been cancelled and reopened.
- Successful Apply atomically replaces and persists the whole applied configuration. A failed Apply leaves both the applied configuration and its persisted representation untouched.

### Startup

- With no persisted applied configuration, start with Configuration open, empty/default draft values, and no usable Thread controls. Omit or disable every cancellation route until an applied configuration exists.
- With persisted applied configuration, start with Configuration collapsed and show a brief **Checking configuration…** state while `/info` reauthenticates the token and loads model information. Disable Send, **New**, and **Configure** during this check.
- On successful startup checking, enter the ready state and enable the Thread controls. If a persisted explicit model no longer exists, reset model and reasoning to **Default**; if only its reasoning effort is no longer supported, reset reasoning to **Default**. Persist that normalization and announce it non-modally.
- On failed startup checking, open Configuration with a draft copied from the persisted applied configuration, retain all values, and show the appropriate inline error. The user may Cancel because an applied configuration exists, but returning to the Thread does not enable Send until a later configuration check succeeds.

### Editing, Apply, Cancel, and reopening

- **Configure** is the sole entry point from a ready Thread. Opening it replaces the compact Thread/content area and moves focus to the Configuration heading (or first invalid field when reopening for a validation error).
- Both the panel action and the open-state top-bar action are labelled **Cancel**. Cancel discards the complete draft and closes Configuration. Neither route is available when there is no applied configuration.
- **Apply and close** first rejects an empty or whitespace-only token. Normalize accidental surrounding token whitespace before authentication and persistence.
- Apply disables all Configuration controls and both actions, exposes an in-panel busy status, and makes exactly one `/info` request with the draft token. Duplicate submissions are impossible while it is pending.
- A successful response loads the available models and supported reasoning efforts. Validate every explicit draft choice against that response and validate permissions against **Default**, `read-only`, or `workspace-write`. Only a completely consistent draft commits; success closes Configuration, returns focus to **Configure**, and enables the Thread.
- Applying reauthenticates even an unchanged token, so **Apply and close** always means “authenticate and atomically commit this complete draft.”
- Reopening after a successful Apply starts from the newly applied values. Reopening after Cancel starts from the unchanged applied values.

### Model-dependent controls

- Model, Reasoning, and Permissions each expose an explicit **Default** option. Default values are omitted from the subsequent Turn payload so Codex or the Relay supplies its default.
- Until model information has loaded, Model and Reasoning are unavailable and communicate that loading is required; Permissions remains locally selectable.
- Choosing an explicit model restricts Reasoning to **Default** plus that model's supported efforts. Changing model immediately resets an unsupported explicit reasoning effort to **Default** in the draft.

### Failures

- Any Apply failure keeps Configuration open with the entire draft intact, restores its controls, and leaves the applied configuration unchanged.
- Show an inline error summary above the actions, focus it when the asynchronous attempt fails, and connect field-specific messages to their fields. Messages distinguish: missing token, rejected token (`401`), Relay/Codespace or model-information unavailability (`502` or network failure), invalid model/reasoning pairing, invalid permissions, and unexpected failure.
- Never clear or echo the token, silently substitute a choice during Apply, close the panel, or fall back to the failed draft. The user corrects and retries, or Cancels when a prior applied configuration exists.

### Active Turn

- A Turn can begin only from the closed, ready Configuration state and uses a snapshot of the applied configuration.
- For the entire active Turn, disable **New** and **Configure**; Configuration cannot be opened and therefore cannot affect the Turn in progress. Restore them when the Turn ends, whether successfully or with an error.

The existing Relay API already distinguishes rejected authentication (`401`) from unavailable Codex information (`502`), returns the model/reasoning catalog needed for consistency checks, and accepts omitted default selections. No Relay API change or browser-specific accommodation is exposed by this decision.
