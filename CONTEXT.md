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

**Configuration panel**:
The collapsible area of the Mobile Client where the user stages the API token, model, reasoning effort, and permissions for subsequent Turns.
_Avoid_: Settings page, navigation drawer

**Applied configuration**:
The Mobile Client configuration most recently authenticated and committed for subsequent Turns.
_Avoid_: Saved settings, active settings

**Configuration draft**:
The editable copy of the applied configuration held while the Configuration panel is open.
_Avoid_: Temporary settings, pending settings
