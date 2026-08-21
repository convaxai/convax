# Validation and PR hygiene

Select evidence from the changed surface. A cleanup is complete only when the removed behavior, its public and dynamic entrypoints, and the retained owner behavior are all covered.

## Validation selection

| Changed surface                                                             | Minimum relevant evidence                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Repository Skill or validator                                               | Skill Creator `quick_validate.py`, repository `skills:check`, focused validator tests, relative-link check, `git diff --check` |
| One package's internal behavior                                             | Focused owning tests, package `typecheck`, and package `build` when its contract requires it                                   |
| Public exports or package manifests                                         | Package tests/typecheck/build, `bun run pack:check`, and an external-consumer or real-tarball smoke when applicable            |
| Package ownership or dependency direction                                   | `bun run package:boundaries`, affected package checks, canonical architecture update, and `bun run pack:check`                 |
| Desktop Main, preload, renderer, or IPC                                     | Focused tests, Desktop `typecheck`, Desktop `build`, and the relevant open-project or packaged runtime smoke                   |
| Persistence, migration, collaboration, recovery                             | Failure/restart/migration tests, owner package checks, Desktop integration, package boundaries, and the applicable smoke       |
| UI-visible behavior                                                         | Focused component tests plus a real launched UI or packaged smoke when the task changes runtime behavior                       |
| Dynamic Plugin, Marketplace, generation, service, or managed-stdio behavior | Exact manifest/catalog/lease/runtime tests, transition or recovery coverage, package boundaries, and packaged/runtime evidence |

Run `bun run lint`, broader typecheck/build, or root `bun check` when the outgoing diff or repository contract requires them. Do not run a smaller command with a filter that accidentally skips the changed path and call it coverage.

## Report evidence precisely

Use distinct statuses:

- **local passed:** command ran in this worktree and exited successfully;
- **local skipped:** command was not selected or could not run, with reason;
- **remote pending/not run:** GitHub Actions has not completed or did not start;
- **failed:** command or CI ran and failed, with the relevant error;
- **baseline failure:** only after reproducing the same failure on the verified base or otherwise proving it is unrelated.

Local passing checks do not imply remote CI, packaged runtime, release, merge, or production success. A GitHub billing or spending-limit failure is remote CI not run, not a code pass.

## PR ownership

`find-simplifications` owns evidence and decision quality. `solo-task` owns worktree creation, explicit staging, commit, push, and PR delivery. Repository hooks and GitHub workflows remain the validation entrypoints; do not copy them into another pre-push Skill.

Before push, inspect the complete diff against the fetched base, confirm the worktree and branch, stage only task-owned paths, and run `git diff --check`. Do not bypass hooks, force-push, merge, auto-merge, publish, or release through this workflow.

The PR summary should list surveyed areas, eligible/deferred/rejected candidates, production/non-production/ambiguous consumer evidence, net complexity, checks actually run, remote CI state, and remaining gates. Keep a PR draft while task-related validation is incomplete or a proven repository-level CI gate cannot run.
