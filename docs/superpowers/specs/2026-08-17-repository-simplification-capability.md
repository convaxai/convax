# Repository simplification capability

Status: current contributor-workflow decision.

## Problem

Convax had architecture governance and isolated delivery Skills, but no canonical method for deciding whether apparent dead code, duplicate state, speculative APIs, package boundaries, or hand-rolled infrastructure were safe to remove. Static references alone are insufficient because Convax has published Plugin contracts, generated catalogs, string-dispatched IPC and tool surfaces, dynamic registration, persisted formats, immutable closures, and consumers outside this repository.

A copied workflow from another repository would also import incompatible policy: Convax cannot assume that pre-release code has no external consumers, and it does not use bilingual lifecycle notes, frozen note archives, stacked-PR commands, or a dedicated pre-push Skill.

## Decision

The repository-local [`find-simplifications`](../../../.agents/skills/find-simplifications/SKILL.md) Skill is the canonical simplification entrypoint. It owns candidate taxonomy, consumer evidence, trust/lifecycle review, net-complexity judgment, decision recording, and validation selection. It is a contributor workflow under `.agents/skills`, not a product-installed Skill or runtime capability.

The workflow composes with existing owners:

- [`solo-task`](../../../.agents/skills/solo-task/SKILL.md) remains the sole worktree, commit, push, and pull-request workflow.
- [`govern-convax-architecture`](../../../.agents/skills/govern-convax-architecture/SKILL.md) remains the owner for package, public port, canonical state, persistence, trust, and architecture-map changes.
- Root `AGENTS.md`, Husky, package scripts, and GitHub Actions remain the validation and PR gates.
- `docs/superpowers/specs` records durable or contested simplification decisions; small mechanical changes need only code, tests, and PR evidence.

No task database, status lifecycle tree, control plane, CAS, lease, receipt, archive manifest, or second decision store is introduced.

## Local reference set

The Skill links every reference directly so an Agent can run it from a Convax-only checkout:

1. candidate taxonomy;
2. evidence and consumer classification;
3. trust and lifecycle audit;
4. net complexity and dependency substitution;
5. proposal and decision recording;
6. validation and PR hygiene.

The repository Skill validator requires frontmatter limited to `name` and `description`, folder/name agreement, UI metadata, root-index discovery, resolvable local Markdown links, and direct discovery of every reference from `SKILL.md`. It also rejects checkout-specific user paths. The quality workflow executes this validator before package boundaries.

## Source-workflow adaptation decisions

| Source capability                                     | Convax decision                                  | Reason                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broad simplification discovery                        | Adapt as `find-simplifications`                  | Candidate breadth, exact consumer classification, lifecycle ownership, and net-complexity accounting are repository-independent and useful.                                                                                                  |
| Agent-note archive workflow                           | Do not copy                                      | Convax uses current specs, plans, canonical architecture, Git history, and PR review. Collaboration authority archives are sealed protocol evidence, not a general note lifecycle.                                                           |
| Repository prose standard                             | Fold only relevant rules into decision recording | Complete propositions, owner-first prose, and avoiding reasoning transcripts matter; a second global prose-governance Skill would overlap existing documentation and architecture ownership.                                                 |
| Dedicated pre-push selection Skill                    | Do not copy                                      | `solo-task`, root validation rules, Husky typecheck, and GitHub quality workflows already own delivery. The simplification Skill links a validation matrix without creating another push entrypoint.                                         |
| Pre-release compatibility freedom                     | Reject                                           | Plugin Manifest/Host API, published packages, immutable closures, persisted Canvas/Project/collaboration state, generation/LRO recovery, managed-stdio, and external Plugin consumers require current owner-specific compatibility evidence. |
| Bilingual proposal triplets and lifecycle directories | Do not copy                                      | Convax has no such document contract; adding it would create process and archive machinery unrelated to simplification quality.                                                                                                              |
| Stacked-PR and repository-specific commands           | Do not copy                                      | Convax uses its existing GitHub branch, PR, hook, and CI workflow.                                                                                                                                                                           |

## Architecture impact

This change adds contributor instructions and a repository validator only. It does not change package ownership, dependency direction, runtime routing, canonical state, persistence, wire/IPC formats, Plugin ABI, Marketplace behavior, or the architecture map. `docs/architecture.md` therefore remains current and is intentionally unchanged.

## Alternatives considered

**Copy every adjacent workflow.** Rejected because it would create overlapping documentation, archive, pre-push, and PR authorities.

**Add only a checklist to root instructions.** Rejected because the required consumer, lifecycle, dependency, and validation methods are too detailed for the repository-wide contract and need progressive disclosure.

**Build a continuous simplification service.** Rejected because Git, current specs, PRs, and CI already carry the state and review evidence; a scheduler or task store would add more surface than the capability removes.

## Consequences

Agents gain one independently runnable simplification workflow with mechanically complete local references and no dependency on another checkout. The cost is a small repository validator and its tests. Simplification work still requires judgment: dynamic and external consumers cannot be proven absent by the validator, and high-risk runtime candidates remain deferred until owner-specific evidence closes them.

## Dogfood record

The Skill was applied to current `origin/main` across repository scripts and package manifests, production exports with low static reference counts, test-only production helpers, compatibility aliases, large lifecycle owners, and dynamic Plugin/Agent surfaces. Exact repository searches, public-package status, local contracts, and call-site reads were used; no static tool result was treated as removal proof.

| Candidate                                                                                        | Production consumers                                                                                      | Non-production consumers                                                 | Ambiguous or dynamic consumers                                                                                                                   | Decision                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Main `projectRegistryPackagePluginCategories` and `projectRegistryPackageRuntimeSurface` | None beyond their definitions. Both only unpack one field from `projectRegistryPackageRuntimeProjection`. | `marketplace-runtime-surface.test.ts` only.                              | None: the Desktop package is private, the file is not a package export, and the names are not IPC, wire, manifest, config, or registration keys. | **Eligible and removed.** Tests call the canonical projection directly; runtime behavior and Marketplace ownership are unchanged. |
| `OpenCodeAgentRuntime.refreshProviders` compatibility alias                                      | Definition only in repository production source.                                                          | None.                                                                    | `@convax/agent-runtime` is published, and the method is explicitly a backward-compatible name across an active Agent Runtime migration seam.     | **Rejected.** External consumers are unresolved and harness migration is outside this task.                                       |
| `scripts/architecture-test-coverage-check.ts` and `check:test-coverage`                          | Contributor validation script and package command.                                                        | Referenced by the canonical coverage matrix and its implementation plan. | Manual validation use is not statically enumerable; the plan deliberately left CI adoption optional.                                             | **Rejected.** Removal would weaken recorded validation rather than delete obsolete behavior.                                      |
| `canvas-application-test-fixtures.ts` under Desktop Main source                                  | No runtime importer.                                                                                      | Four Main test files.                                                    | It remains inside the package TypeScript program, preserving typechecked fixtures; moving or inlining it would not delete its semantics.         | **Rejected.** Directory movement would relocate equal complexity and could reduce typecheck coverage.                             |
| Low-reference collaboration and Project codec exports                                            | Some symbols have no internal production call site.                                                       | Contract tests cover several of them.                                    | Publishable package exports, persisted/wire formats, recovery, and external API consumers.                                                       | **Rejected as a class.** Static reachability cannot close public protocol and persistence compatibility.                          |

The selected closure deletes two test-only production wrappers without changing the canonical `MarketplaceCatalogRuntimeProjection`, Plugin category derivation, manifest parsing, runtime-surface semantics, package edges, IPC, persistence, or architecture map. Reintroduction is justified only if a real production caller needs a narrower typed projection and cannot consume the canonical result.
