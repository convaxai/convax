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
- Ordinary document mutations such as adding, importing, duplicating, or generating
  nodes preserve the mounted viewport. Fit, center, zoom, and reveal movement require
  an explicit user action or view command.
- A file-card generation model override belongs to its owning Canvas node as a
  versioned namespaced metadata value containing only an opaque host tool id. Missing
  means inherit the host preference; Canvas never owns the concrete model catalog.
- Public node roles remain `file` and `agent`; structural grouping is an internal file
  rendering kind. A new Canvas document is empty.
- Plugins are disposable, deterministic and failure-isolated.
- Canvas owns only host-neutral renderer and toolbar contracts. Installed Web
  packages, permissions, iframe transport, Project/Agent calls and package storage
  belong to the host. A Web Plugin renderer still produces a `file` node and must
  mutate the document through the same editor/application APIs as built-in UI.
- Selection action surfaces accept only explicit host-owned actions over an immutable
  document/selection snapshot. Canvas may render them in the multi-selection toolbar
  and an eligible single-node toolbar. Canvas owns visibility isolation,
  duplicate-click prevention and pending state, and aborts the action signal when
  that snapshot is replaced or its surface unmounts. It does not know which Plugin
  or native integration supplied an action. Hosts crossing IPC must translate cancellation
  into their own cloneable protocol and cancel safely interruptible external work;
  Canvas must not own an operation-id registry.

Run `bun typecheck && bun test`. For public command, plugin or export changes also
run root `bun run pack:check`.
