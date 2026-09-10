# Rehydrate persisted Thread and local-New views safely

Label: `wayfinder:task`
Status: open
Assignee: unclaimed
Blocked by: [Make New a revision-safe local Thread entry](10-make-new-revision-safe-local-entry.md), [Resume Eligible Threads with canonical effective state](11-resume-eligible-threads-with-effective-state.md), [Render item-owned assistant and Activity bubbles](12-render-item-owned-assistant-and-activity-bubbles.md)
Parent: [Resolve the post-responsive Mobile Client findings](../map.md)

## Question

Restore authenticated Mobile Client state across reloads while distinguishing an untouched local New view from a persisted real Thread. Lock input until a persisted Thread is revalidated, reconcile restored transcript entries by item ID, and recover to a fresh local view when the Thread is unavailable.

- [ ] An untouched local New view reloads composer-enabled without creating a Codex Thread, while a persisted Thread remains input-locked until rehydration completes.
- [ ] Successful rehydration preserves canonical completed history and effective state without restoring transient Activity, interrupted partial, or recovery artifacts.
- [ ] Unavailable-Thread recovery explains the fallback, enters a composer-enabled local New view without starting Codex, and is covered by deterministic Chromium tests.
