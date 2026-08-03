---
name: govern-convax-architecture
description: Audit, design, change, and review Convax architecture across package ownership, dependency direction, canonical state, persistence, Electron IPC, Agent capabilities, Plugin ABI and lifecycle, Marketplace, delivery surfaces, and cross-repository boundaries. Use before any change that may alter an owner, public port, package edge, protocol, durable state, trust boundary, runtime composition, or the architecture diagram in docs/architecture.md, and when preparing architecture-affecting commits or pull requests.
---

# Govern Convax Architecture

Keep the repository contract, implementation, and review evidence synchronized.
Treat documentation as part of an architecture change, not as follow-up work.

## Establish the current contract

Read these files completely before designing or editing:

1. [`AGENTS.md`](../../../AGENTS.md)
2. [`docs/architecture.md`](../../../docs/architecture.md)
3. Every affected package or app `AGENTS.md`
4. The affected public exports, manifests, IPC contracts, persistence adapters, and
   boundary checks

Inspect the live branch and manifests. Do not rely on an older diagram, prior task,
or prose that conflicts with source.

## Classify the change

Name the sole owning package before writing code. Treat a change as
architecture-affecting when it alters any of these:

- package or repository ownership;
- an internal dependency or public package subpath;
- canonical state, lifecycle, persistence, migration, or recovery;
- Electron Main, preload, renderer, native-path, or IPC authority;
- UI, Agent, Plugin, Tool, Hook, MCP, or Marketplace capability routing;
- Plugin ABI, Host API Catalog, grant, lease, ActiveSet, or executable boundary;
- Cloudflare, Web, Docs, or future API delivery composition.

When classification is uncertain, assume architecture impact until source evidence
proves otherwise. Do not infer that a small diff has a small architectural blast
radius.

## Freeze ownership and the contract

Record:

- current owner and canonical source of truth;
- callers, projections, adapters, and persistence locations;
- accepted public port or protocol;
- failure, cancellation, stale-result, migration, and platform behavior;
- alternatives rejected and the boundary each would violate;
- concrete evidence that would falsify the design.

Reuse an existing public capability or add the smallest typed port to the owner.
Never solve a boundary problem with a private import, duplicate writer, service
locator, raw IPC, concrete Plugin-id branch, or generated-artifact edit.

## Update architecture documentation in the same change

Every architecture-affecting change must update
[`docs/architecture.md`](../../../docs/architecture.md) in the same commit or pull
request:

1. Update the owning prose, tables, state map, persistence map, and flow description.
2. Update the embedded Mermaid architecture map when a node, dependency, runtime
   route, trust boundary, persistence target, or delivery surface changes.
3. Update the root and affected local `AGENTS.md` contracts.
4. Update `scripts/package-boundary-check.ts` and tests when the dependency or
   admission policy changes.

Keep the diagram as reviewable Mermaid source in Markdown. Do not commit generated
PNG, SVG, JSON, or other duplicate architecture renderings.

If a reviewed change touches a listed architecture surface but does not modify the
canonical document, stop and provide file-level evidence that the contract and map
remain accurate. “Implementation only” is not evidence.

## Implement and verify

Keep domain logic headless and adapters at explicit edges. Route UI, Agent, and
Plugin callers through the same owner operation. Recheck scope, revision, identity,
and cancellation after awaited edges and immediately before side effects.

Run focused package checks first:

```bash
bun --cwd <affected-package-or-app> typecheck
bun --cwd <affected-package-or-app> test
bun run package:boundaries
```

Run `bun run pack:check` for public exports or package-boundary changes. Run
`bun check` for persistence, IPC, Desktop composition, Agent capability, Plugin
runtime, or final cross-package integration changes. Validate the Skill with the
bundled Skill Creator `quick_validate.py`, and run `git diff --check`.

Before handoff, report:

- owner and dependency direction;
- updated architecture document and Mermaid map;
- tests and gates run;
- falsifiable acceptance evidence;
- remaining risk and every skipped or blocked check.

Reject a pull request that changes architecture without the canonical documentation
update required above.
