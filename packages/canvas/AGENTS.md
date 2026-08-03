# Canvas Package Contract

Canvas owns document and editor semantics independently of Project and Agent.

## Layers

- `core`: pure schema and document primitives; no host I/O and no global shard
  renderer history.
- `collaboration`: exact v2 eleven-root Yjs schema, canonical projection, closed `/2`
  typed intents, pure reducer/write-evidence validation, and owner ports into the
  generic replica/candidate kernel.
- `application`: business/primitive commands, queries, semantic guards, resource
  orchestration, and host-neutral document/view ports. Its `application/errors`
  export is the lightweight browser-safe error contract for sandbox adapters that
  must not load the Yjs-bearing collaboration entry.
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
- Renderer and public callers submit frozen, bounded typed intents to the owning
  Main application service. They must not transport `CanvasDocument` patches,
  expected revisions, raw Yjs updates, caller-selected identities, or private
  application commands. Missing intent mappings fail closed until the exact v2
  owner reducer owns them.
- `CanvasDocument` has no global revision counter. Internal durable storage tokens,
  accepted causal frontiers, entity incarnation guards, content digests,
  and operation receipts are separate concepts and must not leak back into a global
  renderer version.
- Whole-Canvas tidy uses the Canvas-owned size-aware directed-cluster business
  operation, including component packing, cycles, groups and isolates. Directed
  strategies compact otherwise unrelated nodes into a deterministic shelf;
  conservative component packing may explicitly preserve their mental map. Primitive
  grid/horizontal/vertical layout requires explicit node ids. Host or Plugin layout
  engines may only return a host-neutral geometry-digest-bound plan; Canvas validates
  it and submits one bounded typed intent atomically.
- View effects are valid capabilities but cannot turn a committed domain mutation
  into a failed mutation.
- Fit and reveal derive world bounds from the authoritative Canvas document, including
  parent coordinates. Do not wait for or trust stale mounted renderer geometry.
- Hosts may provide only edge-inset geometry for unavailable viewport space. Canvas
  owns the resulting safe rectangle, camera avoidance, and Canvas overlay clamping;
  host product/utility identity never enters this package.
- Domain mutation commits before any camera behavior. Canvas may own an optional
  post-mutation safe reveal for the current mounted view when newly affected nodes
  are outside its host-provided safe viewport; stale scope, remount, background
  refresh/restore, or intervening user navigation cancels it. View failure never
  reverses the mutation, and reduced motion uses zero duration while retaining the
  required final position. Eligible flows are batch picker import and new pending
  generation. Pointer drops, ordinary paste, duplicate, and duplicate-drag do not
  move the viewport unless a separate explicit view command requests it.
- Pending generated resources are a persisted resource business lifecycle, not
  renderer-only state. Canvas owns node-id creation, pending/error validation and
  guarded in-place replacement semantics; hosts own external execution and supply
  only bounded user-safe failure text.
- A file-card generation model override belongs to its owning Canvas node as a
  versioned namespaced metadata value containing only an opaque host tool id. Missing
  means inherit the host preference; Canvas never owns the concrete model catalog.
  Only an image/video replacement owner persists this override. A text owner may
  offer image/video output choices, but remains a relation anchor and never stores
  one cross-output model choice or becomes an implicit generation input.
- Canvas owns the separate versioned node-generation run namespace, its bounded
  parser and legal transitions. Keep the next-run preference separate from the
  resolved historical tool, admit only bounded host-authored terminal failure text,
  never persist raw diagnostics or vendor state, and mark generated resource
  replacement plus `succeeded` in one guarded Canvas command.
- A host-created pending generation node and its `submitting` run are one Canvas
  business command/CAS. Pending owners use the same transitions, target guard,
  terminal presentation and restart interruption as existing replacement targets.
- Generation target guards may omit only the Canvas-owned current-run and next-run
  preference namespaces. They must still protect real resource content and every
  other metadata namespace. Generated
  replacement preserves only explicitly admitted node-local namespaces rather than
  blindly merging old metadata.
- Model-generation text selections are prompt-context node ids, not typed model
  references. Hosts read their authoritative text and compose the final prompt;
  media selections alone participate in `acceptedInputs` compatibility.
- Public node roles remain `file` and `agent`; structural grouping is an internal file
  rendering kind. A new Canvas document is empty.
- Folder-resource browsing enters a transient read-only focus projection supplied
  through a host-neutral service. Opaque folder-entry ids may be passed back only to
  that service; projected entries never enter the Canvas document, selection,
  relationships, history, persistence, or Agent capabilities.
- Every card has one fixed left input and one fixed right output. `edge.source` is
  the right/output card and `edge.target` is the left/input card; moving cards must
  never adapt ports to top/bottom or reverse their roles. Structural Groups are
  connectable whole-Group endpoints. Their edges never fan out to descendants, and
  focus projection hides cross-scope Group edges without rewriting them. Focused
  resource creation and parentage are one application command/CAS. Groups remain
  expanded unless an explicit persisted Fold state projects them as compact folders;
  Unfold restores the durable child-container presentation without moving children
  or rewriting relationships. File-input
  inference remains direct and file-only.
- Plugins are disposable, deterministic and failure-isolated.
- Canvas owns only host-neutral renderer and toolbar contracts. Installed Web
  packages, permissions, iframe transport, Project/Agent calls and package storage
  belong to the host. A Web Plugin renderer still produces a `file` node and must
  mutate the document through the same editor/application APIs as built-in UI.
- Main's `replicaDoc` is the sole local durable Canvas authority. Every command
  clones it into one isolated `candidateDoc`, applies one closed typed intent, and
  can affect authority only through the exact final replica-signed frame after the
  durable head barrier. `initialDocument` and renderer state are immutable/read-only
  projections, never editable or persistent fallbacks.
- Undo/redo is session-only selection in the collaboration-owned
  `SessionUndoCoordinatorV2`; Canvas materializes a fresh closed semantic
  inverse/forward intent against the latest `replicaDoc`. Remote/bootstrap/recovery
  frames and projection rebuilds never enter or reorder the stack, and raw
  Y.UndoManager updates never cross the authoritative boundary.
- React Flow selection, hover, measured size, camera, drag preview, menus and
  Awareness are transient Canvas-owned view state. `onNodesChange`/`onEdgesChange`
  must not mutate the canonical projection. Drag stop resolves entity incarnations
  and submits exactly one `canvas.nodes.set-geometry/2` typed intent for the complete
  gesture. Desktop must not own a competing React Flow document store, gesture
  reducer, incarnation resolver, or view-command policy.
- Canvas identity is the Project-derived `cv_<64 lowercase hex>` carried
  byte-identically by route, shared `DocumentScopeV2`, and Canvas genesis. The
  Project-owned route `shardEpoch` is outside Canvas content and Canvas never creates
  a `docEpoch`.
- This package consumes only the selector-installed R5 Canvas artifact and the
  Kernel-created runtime admitted from the matching four-artifact protocol bundle.
  The Canvas owner schema digest is the bundle's domain-separated artifact digest,
  never the annex file SHA. Missing selector members, digest mismatch, or a
  cross-artifact runtime fails closed; revision-4 drafts and live implementation
  never provide fallback semantics.
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
