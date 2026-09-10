# Make Codex Turns survive Mobile Client disconnects

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

## Problem Statement

The Relay still makes an active Turn depend on one long-lived `POST /turn` response. When iOS/WebKit drops that streaming fetch because the Mobile Client is backgrounded, locked, or changes networks, Express emits `close` and the Relay sends `turn/interrupt` to the Codex app-server.

The reusable app-server connection and persisted Thread survive, but the in-progress Turn is cancelled. The Mobile Client then replaces the pending assistant response with a connection error and has no way to reattach or recover output produced while disconnected. Thread resume therefore does not solve Turn survival.

A local HTTP regression harness reproduced the current behavior: aborting the response after `turn/start` caused the Relay to issue `turn/interrupt` for that Turn.

## Solution

Make accepted Turns owned by the Relay process rather than by an individual Mobile Client connection. Separate Turn creation from output subscription, retain ordered output for a bounded period, and let the Mobile Client reconnect and replay only the events it missed.

## User Stories

1. As a mobile user, I want an accepted Turn to continue when Safari drops its fetch, so that backgrounding or changing networks does not cancel useful work.
2. As a reconnecting user, I want to resume following the same Turn and replay missed output without duplicating the prompt.
3. As a reader, I want partial assistant output preserved when connectivity fails instead of being replaced by `Error: Load failed`.
4. As an operator, I want active and completed Turn buffers to have explicit limits and retention, so that disconnect recovery cannot grow Relay memory without bound.

## Acceptance Criteria

- Closing or aborting a Mobile Client response does not send `turn/interrupt` and does not stop the underlying Codex Turn.
- Turn creation is idempotent under Mobile Client retries and cannot start the same prompt twice.
- The Relay returns a stable Turn identifier and exposes an authenticated way to subscribe to its ordered events.
- A subscriber can reconnect from its last received event position and receive every missed event once, in order, followed by live output when the Turn is still active.
- The Mobile Client persists enough active-Turn state to reconnect after a transient fetch failure or page reload.
- Existing assistant output remains visible during a disconnect; connection state is reported separately from Codex Turn failure.
- Only one active Turn is allowed where required by the current Relay concurrency contract, including across disconnected subscribers.
- Buffered output, completed-Turn retention, subscriber count, and other process-local resources are bounded. Overflow produces a safe terminal failure and cleans up the Codex Turn.
- App-server or SSH failure produces a safe terminal event and releases active-Turn state.
- Recovery is guaranteed only while the same Relay process remains alive; durable recovery across Railway restarts is out of scope.

## Regression Coverage

- An authenticated Relay HTTP test starts a Turn, consumes one event, disconnects, lets Codex produce more output, reconnects from the last event position, and verifies that the Turn was not interrupted and missed output is replayed exactly once.
- A retry test verifies that repeating Turn creation with the same identifier does not call `turn/start` twice.
- Tests cover malformed replay positions, unknown or expired Turns, buffer overflow, UTF-8 split across chunks, app-server failure, and retention cleanup.
- A Mobile Client test simulates a dropped `/turn` event stream and verifies reconnection without replacing accumulated assistant output.

## Prior Work

Commit `b259c83` previously implemented process-local Turn ownership, buffering, replay, and reconnect behavior, but commit `0f279b2` reverted it. The current app-server architecture introduced by the Thread resume work should be retained; the disconnect-safe Turn lifecycle must be reconciled with it rather than restoring per-Turn `codex exec` child processes.

## Resolution

Implemented on 2026-09-10. The Relay now owns accepted Turns in a bounded process-local registry, separates idempotent creation from authenticated event subscription, replays ordered events from a sequence position, and retains completed Turns for a limited period. Subscriber disconnects no longer interrupt Codex; buffer overflow and app-server failure produce safe terminal events and release concurrency.

The Mobile Client persists active-Turn creation and replay state, reconnects with backoff after transient stream failures or reloads, and preserves partial assistant output while reporting connection state separately. Relay HTTP, app-server UTF-8 framing, retention, failure, and Mobile Client disconnect regressions are covered by automated tests.
