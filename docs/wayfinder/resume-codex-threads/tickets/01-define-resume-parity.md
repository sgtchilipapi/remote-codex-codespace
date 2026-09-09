# Define useful parity with Codex CLI resume

Label: `wayfinder:grilling`
Status: closed
Assignee: codex
Blocked by: none
Parent: [Resume existing Codex Threads from the Mobile Client](../map.md)

## Question

Which Codex CLI `/resume` behaviors must the Mobile Client reproduce—Thread eligibility and working-directory scope, ordering, search, metadata preview, history restoration, selection, and continuation—and which CLI behaviors can be omitted while still satisfying the user's need to resume previous Threads?

## Resolution

Useful parity is a focused picker for recognizing and continuing an **Eligible Thread**, not a reproduction of every CLI entry path or option.

- List only persisted, non-archived, interactive Threads whose working directory exactly matches the Relay's configured Codespace working directory and which contain enough user-facing content to recognize. Never offer Threads from another working directory or non-interactive sources.
- Order by most recent activity, newest first. Do not provide search; the user browses the ordered list.
- Identify each result with its user-facing name when present, otherwise its first-user-message preview; also show preview text, last-active date and time, and model. Omit Thread IDs, token usage, Git metadata, CLI version, status, and working directory from the normal row.
- Keep the currently displayed Thread visible in its correct position, mark it **Current**, and disable its selection. Omit empty or otherwise unrecognizable Threads.
- Selecting a Thread opens it without starting a Turn. Restore the persisted Thread configuration rather than silently overriding it with the Mobile Client's applied configuration; the user reviews the restored context and explicitly sends the next prompt.
- Hydrate the newest history page immediately, position the Thread at the bottom, and load older Turns on demand as the user scrolls upward. Codex's persisted record is authoritative rather than browser-cached presentation history.
- Restored visible history includes user prompts, Codex responses, and errors that materially explain the Thread's state. Rich operational items such as tool calls, command output, reasoning summaries, and plans are omitted unless their absence would make the visible history misleading.
- Omit direct Thread-ID/name entry, automatic “resume latest,” cross-working-directory browsing, non-interactive inclusion, full-history search, and resume-time configuration controls. These CLI affordances are not required for the Mobile Client's resume job.

The installed app-server can support this contract through filtered Thread listing, metadata reads, and cursor-paginated Turn/item history. The exact Relay lifecycle and protocol remain follow-on decisions.
