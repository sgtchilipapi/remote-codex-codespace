# Remote Codex Codespace Relay

## Goal

Build a minimal server that lets a mobile client remotely control Codex running inside an existing GitHub Codespace.

The intended flow is:

```text
iPhone PWA
   ↓ HTTPS / streaming
Express server on Railway
   ↓
gh codespace ssh
   ↓
GitHub Codespace
   ↓
Codex CLI
   ↓
Repository
```

## Why

Codex already works correctly inside the Codespace.

The current mobile workflow requires manually operating a VPS terminal:

```text
iPhone
→ Termius
→ VPS
→ gh codespace ssh
→ Codespace
→ Codex CLI
```

The project replaces the VPS terminal with a small programmatic relay.

## Responsibilities

### Codespace

Owns:

* repository
* Codex CLI
* development tools
* command execution
* Codex thread state

### Railway Express Server

Owns:

* GitHub authentication
* connecting to the Codespace
* invoking remote commands
* forwarding Codex input/output to the client

### Mobile PWA

Owns:

* conversation UI
* prompt input
* streaming output
* reconnect/resume controls

## Phase 1: Prove Railway → Codespace

The first milestone is intentionally minimal.

Expose:

```text
GET /test
```

The Express server should execute the equivalent of:

```bash
gh codespace ssh -c "$CODESPACE" -- "hostname && pwd"
```

and return the remote stdout.

Success means Railway can:

1. authenticate with GitHub
2. find the Codespace
3. SSH into it
4. execute a command
5. return its output over HTTP

Nothing involving Codex should be added until this works reliably.

## Phase 2: Prove Railway → Codex

Once SSH works, add:

```text
POST /turn
```

Example request:

```json
{
  "prompt": "Create hello.txt containing hello"
}
```

The server should remotely execute something similar to:

```bash
cd /workspaces/PROJECT &&
codex exec --json "Create hello.txt containing hello"
```

The test succeeds when the file is actually created inside the Codespace.

## Phase 3: Streaming

Instead of waiting for Codex to finish, stream its JSONL events back to the client using SSE or WebSocket.

## Phase 4: Thread Continuation

Capture the Codex thread ID from the first turn and resume the same thread for later prompts.

```text
Fix login
   ↓
thread abc

Add tests
   ↓
resume abc

Refactor it
   ↓
resume abc
```

## Phase 5: Minimal Mobile UI

The first PWA only needs:

* conversation history
* prompt box
* send
* streaming status/output
* reconnect/resume
* interrupt, if practical

Voice input can use normal iOS dictation.

## Non-Goals

Do not add:

* Codex installation on Railway
* repository synchronization
* remote filesystem management
* terminal emulation
* VPS infrastructure
* Codex app-server
* complex orchestration

The relay should remain as thin as possible.

## Current Status

GitHub authentication from Railway is confirmed because:

```bash
gh codespace list
```

successfully returns the available Codespaces.

The current unresolved issue is establishing the actual `gh codespace ssh` connection from Railway.

That is the only infrastructure problem that needs to be solved before moving on to Codex.
