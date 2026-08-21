---
name: find-simplifications
description: Audit Convax for evidence-backed simplifications and safely implement bounded cleanup or refactors. Use for dead or unused APIs, duplicate representations or lifecycle state, speculative surfaces, test-only production hooks, unnecessary package/config/event/tool surface, dependency substitutions, cleanup surveys, dead-code work, or requests to make the repository simpler without adding a product capability.
---

# Find Simplifications

Find reductions in owned behavior and maintenance surface without weakening Convax's public, durable, dynamic, or security-sensitive contracts. Prefer a few closed candidates over a long list of guesses.

## Establish the governing scope

1. Read the root [`AGENTS.md`](../../../AGENTS.md), the closest instructions for every candidate, and the relevant sections of [`docs/architecture.md`](../../../docs/architecture.md).
2. If the task changes code or documentation, use [`solo-task`](../solo-task/SKILL.md) for worktree and PR delivery. If it can alter ownership, package edges, public ports, protocols, durable state, IPC, Plugin surfaces, Marketplace, Agent capabilities, or runtime composition, also use [`govern-convax-architecture`](../govern-convax-architecture/SKILL.md).
3. Name the current owner and source of truth before calling anything duplicate. Do not treat a second implementation as accidental until its role is understood.
4. Read all six local references before deciding or implementing a candidate:
   - [Candidate taxonomy](references/candidate-taxonomy.md)
   - [Evidence and consumer classification](references/evidence-and-consumers.md)
   - [Trust and lifecycle audit](references/trust-and-lifecycle.md)
   - [Net complexity and dependency substitution](references/net-complexity-and-dependencies.md)
   - [Proposal and decision recording](references/decision-recording.md)
   - [Validation and PR hygiene](references/validation-and-pr-hygiene.md)

This Skill is a contributor workflow, not a shipped Convax capability. It never creates a task database, control plane, lease, receipt, CAS, archive manifest, or second decision store.

## Survey before selecting

Search broadly enough to compare candidates across the requested scope. Cover production source, public exports, package manifests, config and contribution declarations, runtime loaders, IPC and event strings, tests, documentation, and generated artifacts. Use exact symbol, method, event, wire, config, and package searches; read the callers rather than counting matches.

For each candidate, record:

- candidate class and current owner;
- exact production, non-production, and ambiguous or dynamic consumers;
- the canonical value or lifecycle it may duplicate;
- public, persisted, wire, IPC, process, worker, Plugin, or Marketplace boundaries crossed;
- behavior and compatibility intentionally retained;
- deletable implementation, dedicated tests, docs, and maintenance surface;
- glue, tests, docs, migrations, and residual semantics that remain;
- the evidence that would reject the candidate.

Do not stop at the first unused symbol. Large maintenance costs often sit in duplicated state, teardown, persistence, validation, or adapter orchestration rather than a leaf helper.

## Prove, defer, or reject

Classify every candidate as one of:

- **eligible**: no unresolved production or dynamic consumer, no protected compatibility obligation, positive net complexity reduction, and a bounded validation plan;
- **defer**: likely useful, but consumer ownership, runtime evidence, migration, or dependency health is incomplete;
- **reject**: a real consumer or recorded design rationale remains, the change is a feature decision, or the result only relocates complexity.

Treat these surfaces as high risk until disproved with owner-specific evidence: published Plugin Manifest and Host API contracts, immutable Plugin closures and ActiveSet leases, dynamic registrations, Canvas causal state, Project persistence, collaboration frames and descriptors, generation/service/LRO recovery, managed-stdio execution, Agent Runtime/OpenCode migration, packaged resources, and consumers in the sibling Plugin repository. A static zero-reference result cannot close those boundaries.

Tests and documentation are evidence, not automatic authority and not automatic dead weight. A production API used only by tests may be removable, but first prove the tests are not expressing a compatibility, failure, or real-entry-path obligation.

## Implement the smallest closure

When implementation is authorized, remove the complete obsolete surface in one coherent closure: implementation, public export, config or event declaration, dedicated tests, fixtures, documentation, generated inputs, and stale decision text. Preserve unrelated test coverage and update the current owner rather than leaving a compatibility wrapper that keeps the same complexity.

Do not broaden the task into a runtime migration or adjacent architecture rewrite. In particular, a simplification audit may evaluate Agent Runtime/OpenCode seams but does not authorize replacing the harness.

If no candidate meets the evidence bar, make no production deletion. Record representative rejected candidates and the evidence that kept them; a truthful no-change result is better than a demonstration cleanup.

## Record and validate the decision

Use the existing Convax documentation and Git/PR workflow described in the references. Local mechanical cleanup may live only in the diff and PR; durable or contested decisions belong in `docs/superpowers/specs`, and architecture changes also update the canonical architecture contract and map.

Select checks from the changed surface. Report exact commands and distinguish local pass, local skip, remote pending or not run, and actual failure. Never equate a focused test or local pass with packaged runtime, remote CI, release, or merge success.
