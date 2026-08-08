# Project Files Package Contract

This package owns the renderer-safe, Project-scoped file capability.

## Allowed

- Opaque `ProjectEntryId`, `ProjectFileId`, `ProjectDirectoryId`, and
  `ProjectVersionId` (`pv_<64 lowercase hex>`) types plus their strict codecs.
  Allocation belongs to the Project collaboration application service; callers
  never choose these ids.
- Contracts using stable entry identity plus a normalized project-relative path
  projection/hint.
- Exact source/target relocation receipts for move and rename; callers must never
  infer correspondence from a basename or array search.
- Directory listings, expansion/loading state, preview/selection state, file CRUD,
  import/copy/move/open/reveal clients and controller behavior.
- Separate renderer-safe media presentation contracts: bounded thumbnail results
  and purpose-tagged opaque sender-scoped media leases. A video-cover lease is
  short-lived and independent from the delayed full-preview lease. Full media bytes
  and native paths never cross this contract; Desktop Main owns range streaming,
  caps, and lease revocation.
- Serializable drag payloads that retain Project scope.
- Stale-request and filesystem-change reconciliation in the controller.

## Forbidden

- Project registry, binding, identity, Canvas catalog/document, Workbench, Agent, or
  Electron semantics.
- Node `fs`/`path`, native absolute paths, DOM/React state, or browser persistence.
- Exposing `.convax` as ordinary user content or permitting general mutation of
  private Project metadata.
- Allocating Project entry/version identities, resolving global URIs, or treating
  a path as durable identity.
- Adding file methods back to `ProjectController` or new production use of the
  deprecated aggregate `ProjectClient` compatibility type.

The native adapter may be implemented by `@convax/project/node` because that edge
resolves Project bindings and real paths, but this package remains the contract and
controller owner.

Run `bun typecheck && bun test`. For contract/export changes also run root
`bun run pack:check`.
