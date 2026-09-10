# Remote Codex Relay

A minimal mobile web UI for controlling Codex in one existing GitHub Codespace through Railway.

## Railway variables

- `GH_TOKEN`: GitHub token with access to the Codespace
- `CODESPACE`: Codespace name from `gh codespace list`
- `API_TOKEN`: secret entered in the mobile UI
- `CODESPACE_WORKDIR`: repository path inside the Codespace (optional; defaults to `/workspaces/remote-codex-codespace`)

Deploy the repository to Railway, open its public URL on your phone, enter `API_TOKEN`, and send a prompt. The model and its supported reasoning levels come from Codex inside the Codespace. The browser retains the active Codex Thread, displayed messages, model, reasoning effort, and permissions in local storage. **New** starts another Thread; **Resume** lists recent interactive Threads from the configured Codespace working directory; **Status** shows the current selections, Thread ID, plan, and live usage limits. Cached Threads are revalidated against Codex persistence when the Mobile Client reloads.

To verify SSH independently:

```sh
curl -H "Authorization: Bearer $API_TOKEN" https://YOUR-SERVICE/test
```

Codex must already be installed and authenticated in the Codespace, which must run an SSH server.

## Verification

Run the automated Chromium behavior and responsive-layout suite with:

```sh
npm test
```

Before releasing Mobile Client layout changes, record the required iPhone Safari and Android Chrome smoke pass with:

```sh
./scripts/verify-mobile-client.sh
```
