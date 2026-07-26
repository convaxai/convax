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
- Version persisted schema changes and provide migration tests by default. A breaking
  cutover requires an explicit canonical architecture decision and rejection tests;
  unknown or unsupported documents never become partially hydrated live state.
- Add product behavior as a business operation first. UI handlers and Agent adapters
  call the same operation; do not duplicate sizing, placement, relationship, save, or
  validation logic at either edge.
- Primitive commands are explicit low-level operations and still pass through actor,
  command-id, revision and persistence rules.
- Ordered application transactions execute against one starting revision, advance
  the document at most once, and persist with one repository CAS. Transaction
  idempotency is owned here, not by Desktop transports. Reject empty transport
  transactions and bound retained replay results by aggregate document size rather
  than only by receipt count.
- Whole-Canvas tidy uses the Canvas-owned size-aware directed-cluster business
  operation, including component packing, cycles, groups and isolates. Directed
  strategies compact otherwise unrelated nodes into a deterministic shelf;
  conservative component packing may explicitly preserve their mental map. Primitive
  grid/horizontal/vertical layout requires explicit node ids. Host or Plugin layout
  engines may only return a host-neutral revision-bound geometry plan; Canvas
  validates and applies it atomically.
- View effects are valid capabilities but cannot turn a committed domain mutation
  into a failed mutation.
- Fit and reveal derive world bounds from the authoritative Canvas document, including
  parent coordinates. Do not wait for or trust stale mounted renderer geometry.
- Ordinary document mutations such as adding, importing, duplicating, or generating
  nodes preserve the mounted viewport. Fit, center, zoom, and reveal movement require
  an explicit user action or view command.
- Pending generated resources are a persisted resource business lifecycle, not
  renderer-only state. Canvas owns node-id creation, pending/error validation and
  guarded in-place replacement semantics; hosts own external execution and supply
  only bounded user-safe failure text.
- A file-card generation model override belongs to its owning Canvas node as a
  versioned namespaced metadata value containing only an opaque host tool id. Missing
  means inherit the host preference; Canvas never owns the concrete model catalog.
- Canvas owns the separate versioned node-generation run namespace, its bounded
  parser and legal transitions. Keep the next-run preference separate from the
  resolved historical tool, never persist raw diagnostics or vendor state, and mark
  generated resource replacement plus `succeeded` in one guarded Canvas command.
- A host-created pending generation node and its `submitting` run are one Canvas
  business command/CAS. Pending owners use the same transitions, target guard,
  terminal presentation and restart interruption as existing replacement targets.
- Generation target guards may omit only the Canvas-owned current-run and next-run
  preference namespaces. They must still protect real resource content and every
  other metadata namespace. Generated
  replacement preserves only explicitly admitted node-local namespaces rather than
  blindly merging old metadata.
- Public node roles remain `file` and `agent`; structural grouping is an internal file
  rendering kind. A new Canvas document is empty.
- Plugins are disposable, deterministic and failure-isolated.
- Canvas owns only host-neutral renderer and toolbar contracts. Installed Web
  packages, permissions, iframe transport, Project/Agent calls and package storage
  belong to the host. A Web Plugin renderer still produces a `file` node and must
  mutate the document through the same editor/application APIs as built-in UI.
- Main's application/repository is the sole authoritative document writer. The
  editor may keep gesture state and an optimistic projection, but persistence emits
  revision-bound element commands and accepts Main's committed result. An
  authoritative reload never saves the stale renderer projection first.
- Application and resource requests may carry `AbortSignal`. Check it after every
  awaited preparation/load/conflict step and immediately before persistence; caller
  cancellation must never become a late durable write.
- Selection action surfaces accept only explicit host-owned actions over an immutable
  document/selection snapshot. Canvas may render them in the multi-selection toolbar
  and an eligible single-node toolbar. Canvas owns visibility isolation,
  duplicate-click prevention and pending state, and aborts the action signal when
  that snapshot is replaced or its surface unmounts. It does not know which Plugin
  or native integration supplied an action. Hosts crossing IPC must translate cancellation
  into their own cloneable protocol and cancel safely interruptible external work;
  Canvas must not own an operation-id registry.
- A host-neutral selection drag source may expose a persistent drag-out mode. Canvas
  owns its top-level mode UI and interaction semantics: selection, pan and zoom stay
  available, in-Canvas node movement is disabled, and each completed native drag
  rearms the current immutable selection. Host/native paths and ticket publication
  remain outside Canvas.

Run `bun typecheck && bun test`. For public command, plugin or export changes also
run root `bun run pack:check`.
