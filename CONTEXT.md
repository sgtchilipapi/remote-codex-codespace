# Remote Codex Relay

A thin bridge through which one mobile user controls Codex inside one existing GitHub Codespace.

## Language

**Relay**:
The Railway-hosted HTTP service that carries input and output between the Mobile Client and the Codespace.
_Avoid_: Server, orchestrator, jump box

**Mobile Client**:
The browser interface used to send prompts and read Codex output.
_Avoid_: Terminal, console

**Codespace**:
The existing GitHub Codespace that owns the repository, development tools, and Codex process.
_Avoid_: Worker, VPS

**Turn**:
One prompt sent to Codex and the resulting streamed output.
_Avoid_: Command, job, request

**Thread**:
A sequence of related Turns whose context is retained by Codex.
_Avoid_: Session, conversation

**Eligible Thread**:
A persisted, non-archived interactive Thread with recognizable user content whose working directory exactly matches the Relay's configured Codespace working directory.
_Avoid_: Resumable session, cross-workspace Thread

**Configuration panel**:
The collapsible area of the Mobile Client where the user stages model, reasoning effort, permissions, and Fast mode for subsequent Turns.
_Avoid_: Settings page, navigation drawer

**Settings panel**:
The collapsible area of the Mobile Client where the user stages and validates the Relay API token.
_Avoid_: Configuration panel, settings page, navigation drawer

**Applied configuration**:
The Mobile Client's most recently committed model, reasoning effort, permissions, and Fast mode choices for subsequent Turns.
_Avoid_: Saved settings, active settings

**Configuration draft**:
The editable copy of the applied configuration held while the Configuration panel is open.
_Avoid_: Temporary settings, pending settings

**Pre-Turn configuration**:
The concrete model, reasoning effort, permissions, and Fast mode values a new local Thread view will use for its first Turn, resolved from Codex defaults and the Applied configuration before a real Codex Thread exists.
_Avoid_: Effective Thread settings, requested configuration, default configuration

**Assistant bubble**:
One visible Mobile Client transcript entry owned by one Codex assistant item; completed items never share or append to the same bubble.
_Avoid_: Response stream, combined answer

**Activity bubble**:
The temporary, non-transcript Mobile Client indicator of the current Turn activity, derived from structured Codex lifecycle events and removed when the activity ends.
_Avoid_: Thinking trace, reasoning bubble, status message
