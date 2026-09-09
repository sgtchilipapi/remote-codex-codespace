# Make Turns survive Mobile Client disconnects

Label: `needs-info`
Status: open
Assignee: codex

## Description

## Problem Statement

The Relay currently treats the HTTP response carrying a Turn as the Turn's lifetime. When the Mobile Client loses its streaming `fetch`, the response closes and the Relay kills the Codex process. Mobile Safari can therefore terminate useful work when the phone is backgrounded, locked, or changes networks.

The Mobile Client also replaces accumulated assistant output with `Error: Load failed`, which can hide useful output that arrived before the disconnect.

## Direction

Separate the lifetime of a Turn from any one Mobile Client connection. Keep ordered Turn output on the Relay so a disconnected Mobile Client can reconnect, replay missed output, and continue following the same Turn while the Relay process remains alive.

The implementation-ready specification is being developed in [Make Turns reconnectable across Mobile Client disconnects](../wayfinder/reconnectable-turns/map.md). This issue remains `needs-info` until that map resolves the lifecycle, replay, recovery, resource, integration, and verification decisions.

## Scope Boundary

- Guarantee disconnect survival only within one Relay process lifetime.
- Preserve partial output and distinguish connection loss from Turn failure.
- Reconcile the design with the reusable Codex app-server connection specified by the Thread-resume effort.
- Do not introduce persistence across Relay restarts or standalone `/info` caching in this effort.

## Comments

### 2026-09-09 — Turn lifecycle implemented

The process-local lifecycle is implemented: idempotent Turn creation, Relay ownership independent of event-stream subscribers, ordered replay, explicit terminal states, bounded retention, one-Active-Turn enforcement, and Mobile Client reconnection without overwriting partial output. The issue remains open because the map's reusable app-server reconciliation and final acceptance contract are still unresolved.
