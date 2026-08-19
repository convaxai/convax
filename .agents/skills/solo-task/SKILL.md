---
name: solo-task
description: Create and own an isolated Git worktree for a feature, bug fix, refactor, or other bounded implementation task; for bug fixes, search the repository issue tracker and claim a matching unowned issue before implementation; copy local `.env*` files, install lockfile-pinned dependencies, implement and validate only inside that worktree, launch repository-specific applications with an isolated runtime identity, then commit, push, and create or update a pull request without merging it. Use when a request asks Codex to implement or fix something independently, mentions a solo task or worktree, or otherwise benefits from protecting the current checkout; this repository skill may trigger implicitly. For Convax Desktop tasks, also use the bundled Convax adapter to isolate Electron userData and display the task label in application chrome.
---

# Solo Task

Own one task in one repository and one worktree from preparation through a reviewable pull request.

## Establish scope

1. Read the repository and closest path-specific `AGENTS.md` files before planning or editing.
2. Inspect the current checkout without modifying it. Preserve dirty, staged, conflicted, and untracked user work.
3. Resolve the task type:
   - feature: `feat/`
   - bug fix: `fix/`
   - maintenance or refactor: `chore/`
4. Reuse an issue supplied by the user. Create an issue before implementation only when the user requests one.
5. For every bug fix, complete the issue claim gate below before creating a branch or worktree.
6. Keep one session bound to one Git repository. Coordinate multiple repositories as separate explicit sessions.

## Claim a matching bug issue

Use the issue tracker attached to the repository's canonical remote and the current authenticated account.

1. Inspect an issue supplied by the user. Otherwise, search open issues with several task-specific combinations of the symptom, failing behavior or error, affected component, and reproduction context.
2. Read plausible issue bodies and linked pull requests. Confirm scope from concrete behavior and affected ownership; do not treat title or keyword overlap alone as a match.
3. If no open issue clearly owns the bug, record the searches and continue without creating one. Closed issues are historical evidence, not claimable work; do not reopen one unless the user requests it.
4. If exactly one open issue owns the bug and it is unassigned, assign the current authenticated account before implementation. If it is already assigned only to that account, reuse the existing claim.
5. Immediately re-read the issue and verify that the current account is its sole assignee. Inspect linked active pull requests and remote repair branches; resume the current account's existing task instead of creating a second branch or worktree.
6. Stop before creating the worktree when another assignee or active repair owns the issue, several issues plausibly own the bug, repository identity cannot be established, the search cannot be completed, the assignment fails, or post-assignment verification is inconclusive. Report the conflicting ownership or failed gate instead of starting duplicate work.

Issue assignment is the ownership claim. Do not substitute a comment, label, local branch, or proposed pull request for a verified assignment.

## Prepare the isolated worktree

Run the preparation helper from the invoking checkout:

```bash
python3 .agents/skills/solo-task/scripts/prepare_worktree.py \
  --kind feature \
  --task "short task summary"
```

The helper must:

- resolve the default branch from `origin`'s current advertisement instead of trusting a cached `origin/HEAD` or assuming `main` or `master`;
- fetch that exact `origin` branch before creating anything, resolve its fetched tip to an immutable commit, and create the worktree from that commit;
- create a unique branch and worktree without switching the invoking checkout;
- place the default worktree outside the repository under its parent's `.worktrees/<repo>` directory;
- refuse existing branches and paths rather than taking them over;
- copy untracked or ignored regular `.env*` files by relative path without reading or printing their contents;
- exclude Git metadata, dependency trees, nested worktrees, and build caches;
- record a private session manifest under the new worktree's Git administrative directory;
- roll back the just-created branch and worktree when environment copying or manifest creation fails;
- print bounded JSON containing the session id, branch, base ref, base commit, path, label, and copied environment filenames.

After creation, run every read, edit, build, test, Git, and launch command with the returned worktree as its working directory. Do not return to the invoking checkout for task changes.

## Install dependencies independently

Never symlink or directly reuse another worktree's `node_modules`; workspace links can resolve source from the wrong checkout. Reuse only the package manager's content-addressed/global cache.

Follow the closest `AGENTS.md` and the root manifest's `packageManager` first, then choose the matching repository-native frozen install:

- `bun.lock`: `bun install --frozen-lockfile`
- `pnpm-lock.yaml`: `pnpm install --frozen-lockfile`
- `package-lock.json`: `npm ci`
- Yarn immutable lock: `yarn install --immutable`

Do not rewrite a lockfile merely to make the worktree installable. Stop and report a real lockfile/package mismatch.
If multiple root lockfiles remain plausible or conflict with `packageManager`, stop instead of running more than one installer.

## Implement and validate

1. Name the owning package or module before editing.
2. Trace the current public capability and callers; do not copy logic into an edge adapter.
3. Make only task-owned changes and add tests at the ownership boundary.
4. Run focused checks during iteration, then the repository-required checks.
5. Start the application from the worktree when the task affects runtime behavior. Verify both behavior and environment identity before delivery.

For Convax, read [references/convax.md](references/convax.md) and use `scripts/run-convax.sh`.

## Deliver the pull request

Push only after required task verification passes. A proven unrelated baseline failure may produce a draft pull request with explicit evidence; a task-related failure, failed independent launch, or failed environment-identity check must remain local.

Before the first push:

1. Recheck `git status`, the current branch, worktree path, and diff against the resolved base.
2. Fetch the base again. Rebase an unpublished task branch only when it applies cleanly; stop on conflict.
3. Read `copiedEnvFiles` from the private session manifest. Never run `git add .` or `git add -A`; stage explicit task-owned paths and fail if any copied environment path enters the index.
4. Push with upstream tracking. Never force-push or bypass hooks.
5. Create a ready pull request when checks pass, or a draft only for a proven baseline-only blocker.
6. Add `Closes #<issue>` when an issue owns the task. If the branch already has an open pull request, update it instead of creating a duplicate.
7. Never merge, release, publish, or delete the worktree automatically.

## Handoff

Report:

```text
Issue: <url and verified assignment, or no matching open issue plus search summary>
Worktree: <absolute path>
Environment: <id and label>
Branch: <branch>
Commit: <sha and subject>
Remote: <remote branch>
PR: <url, ready/draft, checks>
Runtime: <command, userData path, identity evidence>
Verification: <command and result for every check>
Remaining risk: <explicit blockers or none>
```

Do not describe the task as complete when the promised issue, push, pull request, application launch, or required verification is missing.
