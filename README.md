# remote-codex-codespace

A minimal HTTP bridge that runs Codex in an existing GitHub Codespace and streams its JSONL events to a mobile client.

## Railway configuration

Set these environment variables:

- `CODESPACE`: the Codespace name shown by `gh codespace list`
- `GH_TOKEN`: a GitHub token that can connect to that Codespace
- `API_TOKEN`: a long random secret shared with the mobile client
- `CODESPACE_WORKDIR` (optional): the repository directory inside the Codespace, such as `/workspaces/my-repo`
- `CONNECTION_TIMEOUT_MS` (optional): SSH probe timeout; defaults to 30 seconds
- `CODEX_TIMEOUT_MS` (optional): maximum Codex run time; defaults to 30 minutes

Codex must already be installed and authenticated inside the Codespace. The Codespace also needs an SSH server.

## Endpoints

`GET /health` reports whether required server configuration exists.

`GET /test` runs a short remote command and returns `codespace connected`. It fails after 30 seconds instead of leaving the HTTP request open forever.

`POST /codex` starts `codex exec --json` in the Codespace. It requires `Authorization: Bearer <API_TOKEN>` and a JSON body containing `prompt`. The response is newline-delimited JSON and begins streaming immediately.

```sh
curl -N \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"prompt":"Summarize this repository"}' \
  https://remote-codex-codespace-production.up.railway.app/codex
```

The client should read the response stream line by line. Each complete line is one JSON object. Codex events pass through unchanged; `connection.started`, `connection.closed`, and `error` events come from this bridge.
