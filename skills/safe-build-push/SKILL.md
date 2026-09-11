---
name: safe-build-push
description: Gate a Git branch push on a clean, deployment-style build. Use when the user asks to safely build and push, verify a branch as a hosting platform would, or catch packaging, production-dependency, Docker, and startup failures before pushing. This is a build/deployability gate, not a standards or specification review.
---

# Safe Build and Push

Push one exact commit through a two-phase transaction: **build gate**, then **push**. The commit pushed must be the commit that passed the gate.

## Establish the target

1. Read repository instructions and inspect the current branch, `git status`, HEAD SHA, remotes, upstream, lockfiles, build scripts, deployment manifests, and container files.
2. Resolve the intended remote and branch from the user's request and Git configuration. Ask when the target is ambiguous. Use a named branch; do not push from detached HEAD.
3. Treat uncommitted or untracked files as outside the push unless the user separately authorizes committing them. Explain this boundary before proceeding when those files appear relevant.
4. Record the candidate SHA. Phase 1 verifies that immutable candidate, preferably in a temporary detached worktree or equivalent clean checkout. Preserve the user's working tree.

## Phase 1: deployment build gate

Infer the production build contract from checked-in configuration and the hosting target the user named. Exercise every applicable layer below; mark inapplicable layers explicitly in the result.

### Clean inputs

- Start without existing dependency directories, caches, ignored build output, or local environment files. Use the committed lockfile and the ecosystem's frozen/clean install mode.
- Fail on a missing or inconsistent lockfile when the deployment configuration expects one.
- Do not expose secrets or copy local credentials into the isolated build.

### Build and package

- Run the production build or packaging command used by deployment, not a development server.
- Inspect deployment manifests and copy/include rules. Confirm required source, generated artifacts, workspace packages, static assets, migrations, and runtime configuration templates enter the artifact or image.
- For Node projects, specifically check dependencies imported at runtime are declared in production dependencies and survive the production install/prune. A successful local build with an undeclared or dev-only runtime module is a failed gate.
- When a Dockerfile or container deployment is in scope, build the actual image from the repository context with the same Dockerfile, target, build arguments, and architecture that can be reproduced safely. Dockerfile parsing or static inspection alone does not pass this layer.

### Runtime smoke

- Exercise the built artifact in its production form: run the packaged entry point or start the built container with safe placeholder configuration.
- Wait for a deterministic readiness signal such as a health check, listening socket, successful command, or expected configuration error that occurs only after module loading. Probe a health/root endpoint when available, then stop the process or container cleanly.
- Check logs for missing modules/files, module-format mismatches, native-library or architecture failures, bad entry points, permissions, and startup crashes.

Generic unit, integration, lint, formatting, standards, and specification suites are outside this skill. Run a command from those categories only when it is inseparable from the repository's production build command; label that fact rather than expanding the gate into a general test run.

### Gate decision

Phase 1 passes only when every applicable build layer exits successfully and the runtime smoke signal is observed. Report the exact candidate SHA, commands, artifact/image tested, passed layers, skipped layers with reasons, and sanitized failure output.

On failure, stop before any push. Give the first actionable failure, the likely deployment impact, and the command needed to reproduce it. Editing or committing a fix requires the user's request; after any fix, restart Phase 1 for the new SHA.

## Phase 2: push the verified commit

1. Immediately before pushing, re-read HEAD and working-tree state. Stop if HEAD differs from the verified SHA. New working-tree changes may remain only when they cannot affect the committed SHA being pushed; call them out.
2. Show the resolved remote, destination branch, verified SHA, and whether the push is a new branch or fast-forward. Obtain direction if this differs from the user's stated target or would rewrite history.
3. Push the verified SHA without force, using an explicit refspec such as `git push <remote> <verified-sha>:refs/heads/<branch>`. Never add `--force`, `--force-with-lease`, tags, or other branches to this workflow.
4. Verify the remote branch resolves to the verified SHA. Report the branch and commit, along with the Phase 1 evidence. If authentication, branch protection, or the remote rejects the push, leave the local repository unchanged and report the recovery step.

## Portability

Use repository configuration as the source of truth; do not bake commands or provider assumptions into the skill. To export it, copy the whole `safe-build-push` directory so `SKILL.md` and `agents/openai.yaml` remain together.
