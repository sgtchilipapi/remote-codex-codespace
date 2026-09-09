# Remote Codex Relay

A minimal mobile web UI for controlling Codex in one existing GitHub Codespace through Railway.

## Railway variables

- `GH_TOKEN`: GitHub token with access to the Codespace
- `CODESPACE`: Codespace name from `gh codespace list`
- `API_TOKEN`: secret entered in the mobile UI
- `CODESPACE_WORKDIR`: repository path inside the Codespace (optional; defaults to `/workspaces/remote-codex-codespace`)

Deploy the repository to Railway, open its public URL on your phone, enter `API_TOKEN`, and send a prompt. The model and its supported reasoning levels come from Codex inside the Codespace. The browser retains the active Codex thread, displayed messages, model, reasoning effort, and permissions in local storage. **New** starts another thread; **Status** shows the current selections, Thread ID, plan, and live usage limits.

An accepted Turn belongs to the Relay rather than to one streaming HTTP connection. If the browser is backgrounded or changes networks, the Mobile Client reconnects with the persisted Turn ID and replays only the output it missed. Active Turns and their buffered output remain process-local, so a Railway restart still ends recovery.

To verify SSH independently:

```sh
curl -H "Authorization: Bearer $API_TOKEN" https://YOUR-SERVICE/test
```

Codex must already be installed and authenticated in the Codespace, which must run an SSH server.
