# Issue tracker: local Markdown

Issues and planning maps live as Markdown files in this repository. Filesystem paths are their stable identities; use relative Markdown links whenever one issue refers to another. Tracker work requires no remote service or authentication.

## General issues

Store standalone issues in `docs/issues/`. Use a short kebab-case filename derived from the title, adding a numeric suffix only when a path already exists.

Each issue starts with this metadata and body:

```markdown
# <Title>

Label: `<label>`
Status: open
Assignee: unclaimed

## Description

<problem, request, or specification>
```

- **Create**: add the Markdown file with `Status: open` and `Assignee: unclaimed`.
- **Read/list**: use `rg --files docs/issues docs/wayfinder`, then inspect metadata and headings in matching files.
- **Claim**: before doing any issue work, replace `Assignee: unclaimed` with `Assignee: codex`.
- **Comment**: append a dated entry under `## Comments`; keep evidence and discussion in the issue that owns it.
- **Label**: replace the `Label:` value. Multiple labels are a comma-separated list of backticked names.
- **Resolve**: append the outcome under `## Resolution`, then set `Status: closed`. A closed issue remains at its original path so inbound links stay valid.

## Pull requests as a triage surface

Pull requests are not a request surface. Triage only the local Markdown issues.

## Skill translations

- When a skill says **publish to the issue tracker**, create a local Markdown issue.
- When a skill says **fetch the relevant ticket**, open the named Markdown file and follow its local links as needed.
- Treat filesystem edits as concurrent tracker edits: re-read a file immediately before changing it and preserve unrelated changes.

## Wayfinding operations

Each Wayfinder effort lives in `docs/wayfinder/<map-slug>/`:

```text
docs/wayfinder/<map-slug>/
├── map.md
├── assets/
└── tickets/
    ├── 01-<ticket-slug>.md
    └── 02-<ticket-slug>.md
```

The `assets/` directory is optional and created only when a ticket produces an artifact.

- **Map**: `map.md` carries `Label: wayfinder:map` and the standard Destination, Notes, Decisions so far, Not yet specified, and Out of scope sections. Its ordered `## Open child tickets` list defines child membership and frontier order.
- **Child ticket**: create a numbered file under `tickets/` and link it from the map. Give it exactly one `wayfinder:<type>` label: `research`, `prototype`, `grilling`, or `task`.
- **Ticket metadata**: every ticket records `Status`, `Assignee`, `Blocked by`, and `Parent` before `## Question`. Use `none` for no blockers and relative Markdown links for blockers and parent.
- **Blocking**: `Blocked by` is the canonical dependency relation. A ticket is unblocked only when every linked blocker says `Status: closed`.
- **Frontier**: walk the map's Open child tickets in order and select open tickets whose blockers are closed and whose assignee is `unclaimed`.
- **Claim**: the session's first tracker write replaces `Assignee: unclaimed` with `Assignee: codex`.
- **Resolve**: append the answer under `## Resolution`, set `Status: closed`, remove the ticket from Open child tickets, and append one linked gist to the map's Decisions so far. Preserve the ticket file as the single source of detail.
- **Newly surfaced work**: create all new ticket files first, then add their `Blocked by` links in a second pass. Remove each graduated topic from Not yet specified when its ticket is created.
- **Out of scope**: close a ticket that proves beyond the Destination, remove it from Open child tickets, and add a linked one-line explanation to Out of scope rather than Decisions so far.
- **Research artifacts**: store local findings under the map's `assets/` directory and link them from the research ticket. A branch is optional; the tracker does not depend on branches.
