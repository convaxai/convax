# Proposal and decision recording

Use Git, the current documentation owner, the PR, and CI as the governance carriers. Do not create a simplification database, status directory, archive manifest, receipt system, or parallel source of truth.

## Choose the smallest durable record

- **Local mechanical cleanup:** the code diff, focused tests, and PR explanation are enough when no behavior, compatibility, ownership, or reusable rationale changes.
- **Contested or reusable simplification decision:** add or update one current document under `docs/superpowers/specs/` when future maintainers need the consumer proof, alternatives, compatibility limits, or reintroduction condition.
- **Architecture-affecting change:** update `docs/architecture.md`, its Mermaid map when applicable, root and local `AGENTS.md`, boundary policy, and tests in the same change, following `govern-convax-architecture`.
- **Implementation sequence:** add a bounded plan under `docs/superpowers/plans/` only when the work is large enough to need a separately reviewable execution sequence.

Convax does not use a bilingual decision-note triplet, lifecycle directory, frozen-note archive, or generated decision index. Do not introduce those mechanics for simplification work. A superseded current spec may be updated or replaced through ordinary reviewed Git history; sealed collaboration authority archives remain untouched historical evidence and are never a general documentation pattern.

## Proposal content

A durable simplification proposal should contain:

1. **Problem:** exact current surface and why its maintenance cost is real.
2. **Owner and consumers:** production, non-production, and ambiguous/dynamic evidence.
3. **Decision or proposal:** complete removal, fold, demotion, or dependency substitution.
4. **Retained semantics:** behavior, compatibility, security, migration, and recovery that remain.
5. **Alternatives:** strongest keep, narrower, and defer options and why they lost.
6. **Net complexity:** removed surface minus remaining glue.
7. **Validation:** focused and broader gates with explicit runtime/CI limits.
8. **Reintroduction condition:** concrete future evidence that would justify restoring the capability.

State whether the document records a proposed or current decision. Do not preserve implementation narration that source already makes obvious.

## Supersession and cleanup

Search for older specs, plans, architecture prose, README/JSDoc, and inbound links that describe the same surface. Consolidate only when the new owner preserves every still-useful rationale, negative guarantee, compatibility obligation, and named validation gap. Keep partial supersessions linked and current. Never edit sealed authority archives or use them as runtime input.

For a rejected candidate, a compact table in the current task's spec or PR is sufficient: candidate, consumer classification, rejection evidence, and what new evidence would reopen it.
