# Canvas Package Contract

Canvas owns document and editor semantics independently of Project and Agent.

## Layers

- `core`: pure schema, history and document primitives; no host I/O.
- `application`: business/primitive commands, queries, revision/conflict handling,
  resource orchestration, and repository ports.
- `view`: explicitly scoped selection, reveal, viewport, animation and notification.
- root/components: editor, registries, plugins and React rendering.

## Invariants

- Use host-neutral `scopeId`; Canvas must not know Project roots, `.convax`, Electron,
  Workbench, OpenCode, or native persistence.
- Add product behavior as a business operation first. UI handlers and Agent adapters
  call the same operation; do not duplicate sizing, placement, relationship, save, or
  validation logic at either edge.
- Primitive commands are explicit low-level operations and still pass through actor,
  command-id, revision and persistence rules.
- View effects are valid capabilities but cannot turn a committed domain mutation
  into a failed mutation.
- Public node roles remain `file` and `agent`; structural grouping is an internal file
  rendering kind. A new Canvas document is empty.
- Plugins are disposable, deterministic and failure-isolated.

Run `bun typecheck && bun test`. For public command, plugin or export changes also
run root `bun run pack:check`.
