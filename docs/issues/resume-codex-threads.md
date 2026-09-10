# Resume Codex Threads from the Mobile Client

Label: `ready-for-agent`
Status: closed
Assignee: codex

## Description

## Problem Statement

The Mobile Client can continue only the Thread already stored in that browser. A user cannot discover and resume other useful Threads persisted in the configured Codespace.

## Solution

Implement the minimal resume flow from [the completed planning map](../wayfinder/resume-codex-threads/map.md): list Eligible Threads, select one without starting a Turn, restore its visible history, and continue it.

## User Stories

1. As a mobile user, I want to browse recent Eligible Threads, so that I can recognize work started elsewhere in the same Codespace directory.
2. As a mobile user, I want to select a Thread without sending a prompt, so that I can review its context first.
3. As a mobile user, I want older history to load as I scroll upward, so that long Threads remain usable without an expensive initial load.
4. As a mobile user, I want failures to preserve my current Thread and offer retry, so that resuming cannot destroy my place.
5. As a security-conscious user, I want authentication, eligibility, and error sanitization enforced by the Relay, so that hidden Threads and secrets are not exposed.

## Implementation Decisions

- Replace `codex exec` lifecycle usage with one lazy, reusable Codex app-server connection per Relay process while preserving the external `/turn` streaming contract.
- The Relay lists only non-archived interactive Threads whose working directory exactly matches the configured Codespace directory and which have recognizable user content.
- Add authenticated, fixed-size Relay endpoints for paginated listing, atomic resume, and older history. Revalidate eligibility on reads and use opaque bounded cursors.
- Add **Resume** as a compact focus-mode view. Show recency-ordered rows, mark the current Thread, and use explicit **Load more** rather than search or infinite picker scrolling.
- Install a selection only after resume metadata and newest history both succeed. Selection starts no Turn; history pagination preserves the reader's anchor.
- Treat Codex persistence as authoritative. Browser storage is only a presentation cache and must be revalidated after reload.
- Continue a resumed Thread with its persisted configuration until the user explicitly applies Mobile Client Configuration.

## Testing Decisions

- Use the authenticated Relay HTTP contract with a stub app-server as the primary server seam; verify eligibility, cursors, normalization, lifecycle failure, safe errors, and that selection starts no Turn.
- Use the browser-visible Mobile Client with stubbed Relay responses as the UI seam; verify focus mode, pagination, atomic selection, retry, anchored history, reload revalidation, and continuation.
- Extend the responsive checks at one 320px and one desktop viewport, plus the short Safari and Chrome smoke pass defined by the planning map. The repository currently has no test-file prior art; keep new harnesses narrow.

## Out of Scope

Search; cross-directory Threads; editing, deleting, archiving, renaming, forking, exporting, or sharing Threads; migration of old non-interactive Threads; and a Relay-owned Thread database.

## Further Notes

Implement after the responsive Mobile Client ticket so the resume picker can reuse its focus-mode and interaction contract.

## Resolution

Implemented the Thread resume contract on 2026-09-10. The Relay now maintains a reusable Codex app-server connection, exposes authenticated listing/resume/history routes with eligibility checks and safe errors, and continues Turns through the app-server lifecycle. The Mobile Client provides the compact Resume focus view, atomic selection, authoritative reload hydration, older-history loading, and persisted-configuration continuation. Relay contract tests and the complete Chromium behavior/responsive suite pass; the release smoke checklist still covers physical iPhone Safari and Android Chrome verification.
