# Project Files Package Contract

This package owns the renderer-safe, Project-scoped file capability.

## Allowed

- Contracts using `projectId + normalized project-relative path`.
- Directory listings, expansion/loading state, preview/selection state, file CRUD,
  import/copy/move/open/reveal clients and controller behavior.
- Serializable drag payloads that retain Project scope.
- Stale-request and filesystem-change reconciliation in the controller.

## Forbidden

- Project registry, binding, identity, Canvas catalog/document, Workbench, Agent, or
  Electron semantics.
- Node `fs`/`path`, native absolute paths, DOM/React state, or browser persistence.
- Exposing `.convax` as ordinary user content or permitting general mutation of
  private Project metadata.
- Adding file methods back to `ProjectController` or new production use of the
  deprecated aggregate `ProjectClient` compatibility type.

The native adapter may be implemented by `@convax/project/node` because that edge
resolves Project bindings and real paths, but this package remains the contract and
controller owner.

Run `bun typecheck && bun test`. For contract/export changes also run root
`bun run pack:check`.
