# Project Package Contract

This package owns the durable Project aggregate and native Project adapters.

## Entry-point boundaries

- Root/browser entry: Project lifecycle contracts/controller and injected Project UI.
- `@convax/project/canvas`: Project Canvas catalog, relationships, drag protocol,
  ProjectIndex route/catalog projections, typed-intent adapters, resource references,
  and catalog controller only.
- `@convax/project/node`: native registry, root resolution, private storage,
  Project Files implementation, the sole ProjectIndex/per-Canvas collaboration
  writer, immutable objects/outboxes/journals/heads/checkpoints/floors, managed
  assets/blob replication, reset/prune/GC, and unsupported-schema rejection.
- `@convax/project/collaboration-protocol`: browser-safe Project-scoped membership,
  checkpoint, cutoff, registry, reset, resource-proof, and composite verifier DTOs;
  no service or native adapter.

## Invariants

- `ProjectController` contains lifecycle/activation only; it does not absorb file
  CRUD, Canvas catalog state, Canvas documents, or Workbench navigation.
- Create/Open results are selection candidates, not completed activation. The
  controller publishes the returned binding list, runs the renderer leave guard,
  and issues exactly one `touchProject` only after that guard succeeds. Cancellation
  retains the prior active Project and never touches the candidate.
- When the active Project is forgotten, Main quiesces it before returning. The
  controller immediately publishes no active Project and must touch an available
  fallback before publishing it as active. A failed fallback touch leaves no active
  Project instead of restoring or projecting the removed one.
- `ProjectCanvasController` never owns `activeCanvasId`. Legacy active selection may
  be exposed only as a transient migration hint for a user-side Workbench preference.
- Every Project is a local durable aggregate first. Sharing is an optional capability,
  not a Project kind and not a prerequisite for opening the Project shell. A missing
  local mutation authority is reported as `local-authority-unavailable`; Project
  code must not translate that condition into Team creation, invitation, membership,
  or control-plane bootstrap.
- ProjectIndexYDoc is the sole Project catalog, file identity/location/content,
  Canvas route/tombstone, and current `shardEpoch` authority. A service registry,
  JSON catalog, filesystem enumeration, or controller projection cannot add, remove,
  revive, hide, or replace a ProjectIndex route.
- Root and `/canvas` are independently compiled package entrypoints. Their
  process-local ProjectIndex owner-state projection uses one schema-digest-bound
  stable marker and must not depend on a bundle-local constructor identity. That
  marker is never serialized, persisted, or treated as portable authority.
- Canvas document schema/commands remain in `@convax/canvas`; Project composes its
  public validators/resource proofs and native ports rather than duplicating the
  Canvas reducer or editing Canvas through Project-local commands.
- `ProjectSidebar` composes injected controllers and owns only Project-specific UI,
  including its internal Canvases/Files vertical split.
- `ProjectSidebar` requests bounded row covers independently from full previews.
  Mounted video rows use a bounded-concurrency thumbnail-purpose lease, capture one
  small Chromium frame, and immediately release it; they never wait for hover. A
  delayed hover owns its own disposable full-preview handle. Unmount cancels queued
  cover work, and rows never retain complete-media data URLs.
- Browser-safe entry points never import Node modules. Native I/O stays under
  `src/node/**` and performs real-path/containment validation.
- Browser creation requests carry only a Project name. The host injects a trusted
  parent directory; the Node adapter creates the child root, initializes identity,
  and publishes the registry binding without adopting an existing directory.
- Files inside the Project are referenced directly. Only files admitted from outside
  the Project are copied to deterministic content-addressed paths below
  `.convax/assets/blobs/`; duplicate bytes share one blob. Before Canvas can reference
  one, Project/node streams it through a process-local admission capability into the
  durable Project blob store and ProjectIndex commits one immutable, unlocated
  `managed-blob` identity with `managed-admission` provenance. Do not replace this
  path with a renderer-provided digest, a whole-file memory buffer, or a generic
  caller-selectable provenance.
- Project Canvas media inspection addresses the admitted portable resource
  reference, not the original external path. Project/node opens the exact stable
  Project file or verified managed blob; a Desktop-supplied decoder may inspect
  those bytes before the Canvas resource command is constructed. Never persist the
  decoder result as Project authority or accept renderer dimensions as proof.
- Managed-asset admission, reference admission and GC use one Desktop-composed
  `ProjectManagedAssetStore` and its Project-scoped in-process asset mutex. GC derives
  liveness from the validated ProjectIndex current-resource projection, waits
  through one seven-day grace period, atomically persists timing state before deleting
  due blobs, and fails safe when that owner projection is unavailable. `gc.json` is
  rebuildable timing state, not a catalog.
- ProjectIndex current-resource projection is the sole portable blob-currentness
  authority. Native GC calls the browser-safe
  `ProjectIndexCurrentBlobReferencePortV2`; each resource projection carries the
  exact reference, storage class, and optional materialized path. Desktop must
  delegate that query to the live ProjectIndex owner session and must not infer
  managed-vs-project-file identity by subtracting the file materialization plan.
  Project Canvas hydration may attach a concrete Project reference transiently, but
  must restore canonical Canvas metadata before returning. External-tool staging uses
  the same Project-owned exact-proof resolver and never infers a path or managed-blob
  class outside this owner boundary. `ProjectBlobReplicationStoreV2`
  may cache exact bytes and rebuild a
  local presence index, but it cannot choose a version. Receive is one resumable
  contiguous transfer prefix; full length/SHA-256, create-new publication, file and
  directory fsync, then presence-index fsync must all finish before blob durability
  evidence can be signed. A remote blob ACK is audit/status evidence only and marks
  a new reference replicated only together with a frame ACK from that same current
  credential-bound replica.
- Project may expose exact local blob availability by digest and byte length for a
  retained-history verifier. That answer is material presence only: it never selects
  a ProjectIndex winner, proves currentness, or grants Canvas history authority.
- Durable collaboration publication is supported by the current Project/node
  adapter on macOS and Linux only. Ordinary Node/Bun directory `fsync` reports
  `EPERM` on Windows and is normalized solely to
  `NodeDirectoryDurabilityUnavailableErrorV2`; it is never success, never a durable
  ACK, and never a materialization conflict. Windows collaboration mutation remains
  fail-closed until a reviewed native write-through adapter satisfies the frozen
  barriers or a later authority revision defines another equivalent primitive.
- Structural durable ACKs are exact immutable objects. Project/node journals the
  verified ACK and advances the sole durable head before retiring the frame outbox;
  retry must match the accepted exact ACK. Reopen treats an ACK journal with a
  missing object as store corruption rather than claiming replication.
- Materialized accepted-head, operation-recovery, reachable-outbox and outbox-usage
  caches are process-local rebuildable projections only. A materialized head cache
  is bound to the exact hashed durable-head record, checkpoint base, journal tail
  and reachable frame set; every use rechecks the durable-head digest and any
  mismatch/recovery/quarantine/checkpoint transition clears or rebuilds it. An
  immutable operation sidecar must be fsynced before the all-Project index learns
  it, and reopen reconstructs every derived index.
- Replication-cache GC consumes only a complete injected Project root scan, retains
  active transfers, uses a seven-day/two-store-generation delay and a second complete
  scan, and deletes nothing on unreadable ProjectIndex/Canvas state, invalid timing,
  clock rollback, symlink/digest mismatch or any incomplete root evidence.
- Publishing user-visible `Notes/` or `Generated/` files is file-first and no-clobber.
  If the later Canvas commit fails, retain the file and report partial success. Do not
  add a cross-file WAL or delete a user file to simulate atomicity.
- Project file moves and renames do not rewrite Canvas references in v1. Missing
  references remain visible until the user relinks them.
- ProjectIndex exposes the sole stable-entry/current-resource materialization plan.
  Project/node subscribes to accepted ProjectIndex invalidation and durable blob
  publication, stages/fsyncs exact bytes, and replaces or removes only a prior
  `{entryId,path,digest}` match. Native untracked edits fail closed instead of being
  silently overwritten; watcher notifications remain invalidation hints.
- Native move/rename receipts carry exact source/target correspondence; Desktop must
  not recover it by basename. Explicit delete commits ProjectIndex tombstones before
  idempotent native removal.
- A Project-owned Canvas shard reset is one staged ProjectIndex route CAS to a fresh
  random `shardEpoch`. Before accepted CAS the old route is sole live; afterward the
  new route is sole current and the old shard is recovery-only. Once any durable
  route-frame ref exists, retry only the same claim/operation/frame/genesis; never
  abandon, re-sign, or invent a `docEpoch`.
- `project.json` stores stable `projectId` only. The exact current private tree and
  native-key hashing belong exclusively to `@convax/project/node`; durable head is
  the sole accepted local pointer and directory scans are recovery evidence only.
  Store filenames are literal on-disk names and never select a protocol.
- A registered local Project with no collaboration authority bytes may recreate its
  missing manifest and exact durable-owner current genesis from the canonical
  registry binding. Unsupported, Team-bound, or unknown private data never takes
  this recovery path. Document-root inventory ignores only a regular `.DS_Store`;
  every other non-document entry remains store corruption.
- The pending-editor required floor is the content-certified ProjectIndex scope plus
  every current live route in the exact `ProjectIndexLiveScopeManifestV2`. Registry
  state is advisory anti-rollback/discovery metadata and never grants, denies, adds,
  removes, or blocks a floor scope.
- Schema changes include versioned migration tests by default. The current
  collaboration cutover instead rejects legacy JSON, multi-document promotion stores,
  centralized edit-sequencing stores, Merkle edit logs, global revision-token bytes,
  and every retired experimental collaboration tree. Before the exact user-confirmed
  archive-and-reset operation, preserve them without hydration, rewrite, compaction,
  migration, deletion, or GC; ordinary Project files and stable `projectId` remain.
  A completed reset keeps the previous private tree byte-exact at the inert sibling
  `.convax-archive-<reset-token-suffix>` until the user deletes it, and no migration
  helper may retain an old decoder in production or treat that archive as authority.
- ProjectIndex first registration must repeat the portable-cutover inspection before
  creating owner or collaboration bytes. Recovery may classify an already-published
  local bootstrap as unteamed only after Project/node proves its exact manifest-bound
  empty genesis and closed native inventory; any frame, route, unknown path, Team
  identity, or authority mismatch remains closed and requires rollover authority.
  An explicit user-confirmed unshared-local reset never decodes unsupported private
  bytes or requires an empty bootstrap. It requires exact `missing` from the Desktop
  Team authority store and no Team/control or sharing-handoff namespace in the
  inventoried Project tree, then stages a fresh epoch whose owner binding becomes
  current only after the new tree and old-tree archive are both verified. Any Team
  record, rejected Team state, or Team namespace requires control-plane rollover.
- Consume only the exact Project, control-plane, kernel, and Canvas artifacts named by
  the one current protocol descriptor. A missing or mismatched artifact or genuine
  owner contradiction stops decode, reset, or mutation rather than selecting an
  archived release, an older draft, or current implementation bytes as fallback.
  `docs/superpowers/specs/authorities/**` is non-runtime archive material and is never
  read by this package.
- A new Project creates its current ProjectIndex genesis once and each new Canvas
  creates its current Canvas genesis once. There is no earlier genesis, protocol
  promotion, bridge, historical head, or successor claim, and sharing uses the same
  current Project and Canvas scopes without switching protocol.
- For an unshared Project, ProjectIndex mutation and the atomic Canvas route command
  use the durable local-owner authority. Canvas genesis preflight/staging must be
  available from that same owner; absence of Team state is not a pending enrollment
  condition.
- Local-owner bindings, edit authorizations, genesis evidence, and device-level
  sharing tombstones are durable records of that one protocol. Their presence never
  selects a protocol, downgrades signing authority, or authorizes a downgrade from a
  shared Project.
- The resolver reports only `current`, `unsupported-project-data`, or
  `recovery-required`. There is no legacy, successor, or promoted state and no
  runtime dispatcher that chooses between protocols. Version-suffixed identifiers
  such as `ProjectIndexLiveScopeManifestV2` are legacy names of that one current
  implementation; renaming them is mechanical cleanup and never admits a second
  protocol.

Run `bun typecheck && bun test`. Run root `bun run pack:check` for public/storage
changes and Desktop `bun run smoke:open-project` for creation, migration, or breaking
cutover changes.
