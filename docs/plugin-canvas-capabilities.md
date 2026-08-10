# Plugin Canvas Capabilities

Convax accepts only `convax.plugin/8`. The portable manifest and strict parser are
owned by `@convax/plugin-sdk`; Host API ids, `since`, audience, grants, scope,
effects and stable errors are owned by the code-generated
`@convax/plugin-api` catalog. This document explains ownership and transport. It is
not a second API reference.

## Ownership and call path

```text
sandboxed Web Plugin
  -> convax.plugin-host/8 MessagePort
  -> renderer transport only
  -> convax.plugin-capability/3 sender connection
  -> Desktop Main Host API service
  -> Project / Canvas application services

verified Tool companion
  -> fixed reverse MCP method derived from the companion Catalog audience
  -> thin transport adapter
  -> the same Desktop Main Host API service
  -> Project / Canvas application services
```

Canvas document semantics, revisions, transactions and persistence belong to
`@convax/canvas` and `@convax/project/node`. Desktop owns installed Plugin identity,
ActiveSet membership, manifest grants, sender binding and cancellation. Renderer
owns no permission decision and never persists a document.

## Exact principal

Every connection is bound to:

```ts
interface PluginPrincipal {
  pluginId: string
  pluginVersion: string
  activeRevision: number
  activeSetDigest: string
  snapshotDigest: string
  manifestDigest: string
}
```

Main additionally binds the frame, Project, Canvas and owning node. A same-version
update with a different snapshot is a different principal. Update, uninstall,
scope change, frame destruction and cancellation prevent queued work from crossing
the next side-effect checkpoint.

## Host APIs

The current API ids are generated from
[`packages/plugin-api/src/catalog.ts`](../packages/plugin-api/src/catalog.ts).
Plugins declare required and optional ids in `hostApi`, call
`host.context.get` to negotiate availability, and still pass Main authorization on
every call. Notable Canvas families are:

- `host.locale.get` for the exact Web connection's current application locale;
- `canvas.node.*` for the owning node;
- `canvas.inputs.*` for direct-incoming metadata and admitted media sessions;
- `canvas.catalog.*`, `canvas.document.*`, `canvas.nodes.*` and
  `canvas.transaction.*` for explicitly granted Project/Canvas operations;
- `canvas.resource.image.create` for Host-owned image publication and Canvas
  admission;
- `canvas.events.*` for bounded revision invalidation subscriptions.

The generated catalog is authoritative. A missing API is a publication blocker and
a human-reviewed Host capability request, never permission to add an undeclared
method or edit the Host repository from Plugin work.

The companion reverse-MCP edge does not maintain another method allowlist,
parameter parser, authorization table, irreversible-operation list or Canvas
dispatcher. Its method names are derived from Catalog entries whose audience
includes `companion`, then filtered by the installed manifest declaration, Catalog
grant and Main connection availability. A completeness test rejects every new
companion Catalog API that has neither a generated generic route nor an explicit
machine-readable exclusion. Subscription notifications remain a fixed transport
edge; subscription ownership and lifecycle remain in the Main Host API service.

## Main-only mutation

All reads and mutations route through Main. Document transactions are non-empty,
command-bounded, revision-bound and atomic. Resource bytes and admission are
separate capabilities; document writes cannot forge file references. For image
creation, stale identity or cancellation before publication produces no user file.
A legitimate no-clobber publication followed by Canvas failure retains the file and
reports partial success.

## UI contributions

Plugin nodes reuse the Canvas `file` renderer registry. A command owns its localized
title, Host icon token and bounded `renderer-message` target. Toolbar and node
overflow-menu placements only reference command ids. Plugins cannot contribute
arbitrary callbacks, SVG/HTML icon bytes, global menus or new node roles.
Host-rendered titles and Plugin metadata resolve SDK-owned message keys through the
manifest resource. Mounted Web surfaces receive locale changes on their existing
MessagePort and are not re-created merely because the application language changed.
The fallback and authoring rules live in
[`plugin-internationalization.md`](plugin-internationalization.md).

## Plugin-to-Plugin calls

Plugin capability imports/exports are orthogonal to Host APIs. They use the
Host-mediated capability broker, exact caller/provider pair leases and closed
schemas. They never use direct objects, Plugin-to-Plugin MessageChannels, renderer
authority or inherited grants.

## Verification

Contract changes must pass:

```sh
bun --cwd packages/plugin-api test
bun --cwd packages/plugin-sdk test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun scripts/package-boundary-check.ts
```

Production scans must contain no `convax.plugin/1` through `/7`,
`convax.plugin-host/1` through `/7`, `convax.plugin-capability/1` or `/2`, protocol
alias or `trustedBuiltin` authority branch.
