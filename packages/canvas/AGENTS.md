# Canvas Package Contract

Canvas owns document and editor semantics independently of Project and Agent.

## Layers

- `core`: pure schema and document primitives; no host I/O and no global shard
  renderer history.
- `collaboration`: the current eleven-root Yjs schema, canonical projection, closed
  unversioned typed intents, one pure reducer plus write-evidence validation, and
  owner ports into the generic replica/candidate kernel.
- `application`: business/primitive commands, queries, semantic guards, resource
  orchestration, and host-neutral document/view ports. Its `application/errors`
  export is the lightweight browser-safe error contract for sandbox adapters that
  must not load the Yjs-bearing collaboration entry.
- `view`: explicitly scoped selection, reveal, viewport, animation and notification.
- root/components: editor, registries, plugins and React rendering.

## Invariants

- Use host-neutral `scopeId`; Canvas must not know Project roots, `.convax`, Electron,
  Workbench, Agent runtime implementation, or native persistence.
- Canvas owns editable-text draft semantics and the transient write-behind store
  keyed by scope/document/node. Stage each edit immediately, autosave through the
  injected text-resource port, keep failures for retry across remounts, and let an
  ordinary document switch start or join that save without prompting or waiting.
  Host composition may drain the store before its scope is torn down.
- Version persisted schema changes and provide migration tests by default. A breaking
  cutover requires an explicit canonical architecture decision and rejection tests;
  unknown or unsupported documents never become partially hydrated live state.
- Add product behavior as a business operation first. UI handlers and Agent adapters
  call the same operation; do not duplicate sizing, placement, relationship, save, or
  validation logic at either edge.
- Renderer and public callers submit frozen, bounded typed intents to the owning
  Main application service. They must not transport `CanvasDocument` patches,
  expected revisions, raw Yjs updates, caller-selected identities, or private
  application commands. Missing intent mappings fail closed until the one current
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
- Immediate mutation feedback is an independent Canvas view overlay. Overlay types
  never reuse `CanvasDocument`, `CanvasNode` or `CanvasEdge`, never allocate
  canonical identity, and never enter projection/query, selection, clipboard,
  commands, IPC, Y.Doc or persistence. The React Flow adapter alone materializes
  non-interactive ghost presentation. Guarded hide/replace records require the exact
  live incarnation; a mismatch retains authority. Keep each session bounded to 32
  pending operations and 512 ghost entities and coalesce authority/overlay changes
  into one presentation snapshot.
- Visual undo/redo history stores only bounded complete presentation snapshots with
  exact node/edge incarnation guards. Every local mutation may reserve an opaque
  provisional root before Main's durable lane; Renderer must not execute the business
  command or construct a candidate document to predict it. Typed geometry may attach
  its already-known presentation result, while every other root is filled only from
  Main's accepted before/after projection. Owner-derived creations retain only their
  operation-specific forward ghost and never guess identities. The visual cursor does
  not select Main's root, cache Y.Doc, or send its provisional id as a command.
  Reconcile only against the actual Main `historyTransition`; mismatch/failure clears
  the speculative suffix and suppresses any inverse queued only for a rejected root.
  A successful transition replaces that direction's saved endpoint with Main's exact
  accepted projection so a recreated id/incarnation guards the next immediate inverse.
  A geometry-only history prediction overlays only position and size; it must preserve
  the mounted node data identity so live text and media runtime state cannot reload.
  Combined presentation scheduling must invoke browser scheduling APIs with their
  required receiver and must never strand its coalescing latch after a scheduling error.
- Fit and reveal derive world bounds from the authoritative Canvas document, including
  parent coordinates. Do not wait for or trust stale mounted renderer geometry.
- Hosts may provide only edge-inset geometry for unavailable viewport space. Canvas
  owns the resulting safe rectangle, camera avoidance, and Canvas overlay clamping;
  host product/utility identity never enters this package.
- Canvas owns typed shortcut-command semantics that call its existing editor, view
  and business operations, but never owns product chord mapping, focus routing,
  conflict arbitration or a global keyboard listener. A host calls the narrow
  `canRunShortcut`/`runShortcut` editor port and projects Space/native-drag holds
  through dedicated held-state ports. Those values are transient gesture state and
  never enter the Canvas document, typed intents, history, persistence, or IPC.
  Native copy/paste remains on Canvas's browser
  clipboard handlers so the system `DataTransfer` path is preserved.
- Domain mutation commits before any camera behavior. Canvas may own an optional
  post-mutation safe reveal for the current mounted view when newly affected nodes
  are outside its host-provided safe viewport; stale scope, remount, background
  refresh/restore, or intervening user navigation cancels it. View failure never
  reverses the mutation, and reduced motion uses zero duration while retaining the
  required final position. Eligible flows are batch picker import and new pending
  generation. A user-launched pending-generation path may also request Canvas's
  existing scoped `nodes.reveal` command with selection and centered fit so the new
  result becomes the active focus; the same scope, navigation, failure, and reduced
  motion rules apply. Pointer drops, ordinary paste, duplicate, and duplicate-drag
  do not move the viewport unless a separate explicit view command requests it.
- Duplicate accepts only live source node ids plus a bounded offset. Canvas resolves
  source content against the latest snapshot, derives clone node/edge identities,
  preserves Group containment, and commits one guarded `canvas.nodes.duplicate`
  typed intent atomically. Same-Canvas paste uses internal-edge scope.
- Group fold state is canonical optional Group node data; UI Fold creates or marks a
  compact Group, while UI Unfold atomically ungroups that folded container. All
  grouping/layout actions submit owner-defined application commands. Optional Fit
  runs only after the authoritative layout commit succeeds.
- Group drop/reparent atomically commits parentage with local geometry, and Alt-drag
  duplicate commits only after its transient preview ends. Title, Group appearance,
  generation-tool preference, mention edge, and intrinsic-media geometry edits use
  closed application commands; Renderer code must not submit a general node patch.
- Canvas owns one resource presentation-size policy. A prepared image's trusted
  intrinsic dimensions must determine the first `canvas.resources.add` geometry;
  renderer ghosts may use independently decoded hints through that same policy but
  those hints never enter an intent. Normal media load must not create a second
  geometry write when the committed size already matches the intrinsic fit.
- A pointer drop carries one explicit center-origin anchor already projected into
  Canvas coordinates. Canvas uses the first prepared resource's final presentation
  size to normalize it once to the durable top-left placement; non-pointer callers
  retain the top-left default and Renderer never guesses the authoritative size.
- Pending generated resources are a persisted resource business lifecycle, not
  renderer-only state. Canvas owns node-id creation, pending/error validation and
  guarded in-place replacement semantics; hosts own external execution and supply
  only bounded user-safe failure text. A host may supply one authoritative initial
  presentation size derived from a same-modality visual reference; Canvas commits
  that frame with the pending node and preserves it through generated replacement.
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
  replacement plus `succeeded` in one guarded Canvas command. Every terminal
  failure projects as the same read-only modality icon plus `生成失败`; selecting a
  failed card must not restore its prompt or expose upload, retry, or detail actions.
- A host-created pending generation node and its `submitting` run are one Canvas
  business command/CAS. Pending owners use the same transitions, target guard,
  terminal presentation and restart interruption as existing replacement targets.
- Multi-result admission remains a Host scheduler concern: Canvas commits one
  independent pending node/run command per step and does not own a batch terminal
  state. Host-resolved prior-result relations may name only already committed
  Canvas-owned ids, and no external step starts until the Host's admission gate has
  observed every required pending commit.
- The collaboration application adapter must close pending creation, start,
  running/task receipt, failure/interruption, and proof-backed generated replacement.
  Portable run-only transitions use the non-undoable
  `canvas.generation.runs.update` typed intent; generated replacement binds the same
  intent to the exact current Project resource proof. These commands must never
  fall back to a generic node patch or remain in the adapter's rejected set.
- Generation target guards may omit only the Canvas-owned current-run, next-run
  preference, and their projected `status`/`error` presentation. They must still
  protect real resource content and every other metadata namespace. Generated
  replacement preserves only explicitly admitted node-local namespaces rather than
  blindly merging old metadata.
- Model-generation text selections are prompt-context node ids, not typed model
  references. Hosts read their authoritative text and compose the final prompt;
  media selections alone participate in `acceptedInputs` compatibility.
- Public node roles remain `file` and `agent`; structural grouping and the generic
  Plugin surface are internal file data kinds. A new Canvas document is empty.
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
  Unfold removes the folded Group through the existing atomic Ungroup command while
  preserving child world positions and removing Group relationships. File-input
  inference remains direct and file-only.
- Plugins are disposable, deterministic and failure-isolated.
- Canvas owns only host-neutral renderer and toolbar contracts. Installed Web
  packages, permissions, iframe transport, Project/Agent calls and package storage
  belong to the host. A Web Plugin renderer renders an existing `file` node and
  mutates the document through the same editor/application APIs as built-in UI; it
  never registers a local node factory or creates a Plugin surface in the renderer.
- Canvas owns the generic host-neutral plugin-surface capability: one `plugin-surface`
  `file` data kind, one business command, and one atomic typed intent. That intent
  creates exactly one independent top-level node with a Canvas-derived id and
  incarnation, a Canvas-computed deterministic position, one candidate transaction,
  one durable frame, and one semantic history root. It carries no source, edge,
  parent, creation group, caller-selected id, raw Yjs, actor, or digest, and the
  generic connected-materialization command must not create this root instead.
- The host supplies the Plugin requirement and initial state envelope bound to one
  exact Plugin snapshot, schema digest, and validation artifact. A missing artifact or
  invalid state writes nothing. Adding another Plugin changes only a validated
  manifest and schema-valid state; Canvas never gains a Plugin-specific intent, node
  kind, role, or reducer branch and never learns a concrete Plugin id.
- Uninstalling or unloading a Plugin retains its node and portable state. Projection
  falls back to the unknown-file presentation and never resets that data.
- Main's `replicaDoc` is the sole local durable Canvas authority. Every command
  clones it into one isolated `candidateDoc`, applies one closed typed intent, and
  can affect authority only through the exact final replica-signed frame after the
  durable head barrier. `initialDocument` and renderer state are immutable/read-only
  projections, never editable or persistent fallbacks.
- Undo/redo is session-only selection in the collaboration-owned session undo
  coordinator; Canvas materializes a fresh closed semantic
  inverse/forward intent against the latest `replicaDoc`. Remote/bootstrap/recovery
  frames and projection rebuilds never enter or reorder the stack, and raw
  Y.UndoManager updates never cross the authoritative boundary.
- Semantic-history retained resources are sorted and unique by their complete
  canonical resource reference, not by content digest alone. Different Project
  resource identities may legitimately name the same exact bytes and must remain
  separately restorable; equal content digests still require equal byte lengths,
  and every restored reference requires its own exact retained-material proof.
- React Flow selection, hover, measured size, camera, drag preview, menus and
  Awareness are transient Canvas-owned view state. `onNodesChange`/`onEdgesChange`
  must not mutate the canonical projection. Drag stop resolves entity incarnations
  and submits exactly one `canvas.nodes.set-geometry` typed intent for the complete
  gesture. Desktop must not own a competing React Flow document store, gesture
  reducer, incarnation resolver, or view-command policy.
- Canvas identity is the Project-derived `cv_<64 lowercase hex>` carried
  byte-identically by route, the shared document scope, and Canvas genesis. The
  Project-owned route `shardEpoch` is outside Canvas content and Canvas never creates
  a `docEpoch`. A new Canvas writes its current genesis once; there is no earlier
  genesis followed by a promotion.
- The one current Canvas genesis carrier has a typed generic author-authority
  section. It accepts a verified local Project owner for unshared Projects or a
  verified Team replica for shared Projects; it must not hard-code Team membership,
  reservation, or trust sections as the only possible genesis authority.
- This package consumes only the one current protocol descriptor and the Canvas owner
  artifact it names. The Canvas owner schema digest is that descriptor's
  domain-separated artifact digest. A missing artifact, digest mismatch, or
  cross-artifact runtime fails closed as unsupported data; archived authority
  releases, drafts, and live implementation bytes never provide fallback semantics,
  and Canvas never selects a second schema, codec, or reducer.
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
  rearms the current immutable selection. Modifier-only compatibility gestures must
  be explicit host opt-ins. The host focus router owns key listeners, scope/conflict
  arbitration, and held-key release, and forwards only held/released state through
  the Canvas editor handle. The host must synchronously project activation before
  its activating keydown returns. While source preparation is pending, Canvas
  immediately disables in-Canvas movement for the armed selection and exposes the
  preparing state; native `dragstart` remains gated on a ready source. Canvas must
  not infer activation from window/document events. React Flow modifier behavior is derived from the initiating
  pointer event, and Space panning is scoped to a focused Canvas with an exact
  unmodified key. Host/native paths and ticket publication remain outside Canvas.

Run `bun typecheck && bun test`. For public command, plugin or export changes also
run root `bun run pack:check`.
