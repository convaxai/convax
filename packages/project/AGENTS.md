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
- ProjectIndex cold validation builds the exact owner state commitment once.
  Accepted directory/file create applies only its fixed inserted collection-key
  mutations to that commitment and path-copies the package-private canonical
  collection index; it never enumerates or copies historical entries. Flat
  restricted-JCS canonical bytes remain an explicitly accounted audit/export
  serialization and are never a frame-digest fallback on the mutation path.
- Canvas document schema/commands remain in `@convax/canvas`; Project composes its
  public validators/resource proofs and native ports rather than duplicating the
  Canvas reducer or editing Canvas through Project-local commands.
- `ProjectSidebar` composes injected controllers and owns only Project-specific UI,
  including its internal Canvases/Files vertical split.
- `ProjectSidebar` requests bounded row covers independently from full previews.
  Mounted image and video rows use a bounded-concurrency thumbnail-purpose lease,
  capture one small Chromium cover, and immediately release it; they never wait for
  hover. A delayed hover owns its own disposable full-preview handle. Unmount cancels queued
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
  Project file or verified managed blob once, without routing those bytes through a
  renderer-facing data URL. A stable Project-file read carries the SHA-256 it
  verified while reading; the process-local ProjectIndex file application may reuse
  that optional digest without copying or hashing the complete bytes again, while
  callers without it retain the defensive copy-and-hash path and the durable blob
  publisher always verifies bytes against the resulting reference. Proof publication and a Desktop-supplied bounded
  image/video header inspector may consume that same exact-byte identity
  concurrently before the Canvas
  resource command is constructed; `media-read` and `media-inspect` diagnostics
  cover those stages. Never persist the inspection result as Project authority or
  accept renderer dimensions as proof.
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
  Project resolves ordinary reachable paths through one bulk path-claim index and
  reserves complete counterfactual location evidence for exceptional conflict,
  orphan, cycle, or missing states. A current-resource read must not construct that
  evidence for managed blobs or ordinary rooted winners.
  Project Canvas hydration may attach a concrete Project reference transiently, but
  must restore canonical Canvas metadata before returning. External-tool staging uses
  the same Project-owned exact-proof resolver and never infers a path or managed-blob
  class outside this owner boundary. Project/canvas is the sole owner that classifies
  a projected node as Project-hydratable: it accepts either one valid legacy concrete
  reference or one valid canonical Canvas resource reference, enforces file/folder
  kind compatibility, and resolves the canonical form through current ProjectIndex
  state. A targeted stale projection must honor the caller's exact node-id predicate,
  leave unrelated resources unchanged, tolerate already-ready or concurrently deleted
  targets, and reject an existing target whose host-owned resource metadata is invalid.
  `ProjectBlobReplicationStoreV2`
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
- Every new document precreates `journals/accepted-frames.wal`. A normal accepted
  frame appends one closed record containing the exact signed frame, the plain
  validated durable delta, outbox/journal/head logical metadata, prior-record
  digest and checksum, then performs exactly one sync on that already-created
  regular file. It never persists issuer-bound evidence, reconstructs or clones a
  full update, writes the legacy frame/outbox/journal/head stages, or syncs a
  directory on the hot path. ACK, checkpoint and prune are explicit maintenance
  records with zero exact-frame/state-vector binary payload in the same logical
  head chain; an ACK's exact credential-bound bytes remain inside its closed JCS
  header. Cold scan/recovery rebuilds
  all derived indexes and exact frame-delta replay state; a reader ignores an
  incomplete tail and a writer repairs only that tail before append. Complete
  post-sync response loss for normal accepted-frame and ACK records is an
  idempotent retry of the same record and evidence. Checkpoint/prune maintenance
  does not claim that recovery contract.
  Native opens use no-follow flags and verify the open handle remains the expected
  linked regular file.
- Structural durable ACKs retain their exact bytes inside a closed WAL maintenance
  record. Project/node advances the logical durable head before retiring the frame
  outbox projection, and an exact retry must match that accepted ACK. Reopen treats
  a missing, corrupt or mismatched ACK record as store corruption rather than
  claiming replication.
- Prune advances the logical checkpoint base and rebuildable reachability indexes;
  it does not yet physically compact prior accepted-frame bytes from the WAL.
  Checkpoint-driven WAL rotation/compaction is a separate future maintenance step.
- Accepted-head, operation-recovery, reachable-outbox and outbox-usage caches are
  process-local rebuildable projections only. The accepted-head cache binds one
  exact logical identity to a materialized checkpoint base and a persistent chain
  of fixed-size accepted frame references. Issuer-bound accepted-head evidence
  advances that chain without reconstructing, encoding, hashing or cloning a full
  update and without visiting historical entries; only cold load, recovery and
  checkpoint/prune may fold it into a new materialized base. Every cache use
  rechecks the exact hashed durable-head record, checkpoint base, journal tail and
  reachable frame set; any mismatch/recovery/quarantine transition clears or
  rebuilds it. The current atomic path installs operation recovery only after the
  WAL file sync; reopen reconstructs that and every other derived index from the
  closed WAL records. Immutable operation sidecars remain only for the legacy
  staged adapter and never add a second accepted-head authority.
  Writer open is the cold boundary for rebuilding both the operation-recovery
  index and bounded outbox-usage projection from the same scanned WAL. Project
  activation completes that work before accepting commands; the first user
  mutation must not enumerate the retained logical outbox.
- Replication-cache GC consumes only a complete injected Project root scan, retains
  active transfers, uses a seven-day/two-store-generation delay and a second complete
  scan, and deletes nothing on unreadable ProjectIndex/Canvas state, invalid timing,
  clock rollback, symlink/digest mismatch or any incomplete root evidence.
- Publishing user-visible `Notes/` or `Generated/` files is file-first and no-clobber.
  If the later Canvas commit fails, retain the file and report partial success. Do not
  add a cross-file WAL or delete a user file to simulate atomicity.
- A verified internal no-clobber publication may register one bounded, process-local,
  one-shot coverage token for its exact `{projectId,path}` watcher event. Consumption
  must remove the token before asynchronously re-verifying the published file
  identity, size and digest. Mismatch, error, duplicate, unknown-path and external
  events fail open to invalidation; coverage is never a durable receipt or time
  window that suppresses another path. A debounce batch emits one uncovered exact
  path only when that is the batch's sole external path. Multiple uncovered paths,
  unknown filenames and path-capacity overflow emit one pathless full invalidation;
  they must not multiply a Canvas-wide scan by the number of watcher events.
- Project file moves and renames do not rewrite Canvas references in v1. Missing
  references remain visible until the user relinks them.
- ProjectIndex exposes the sole stable-entry/current-resource materialization plan.
  Resource publication may additionally request only exact target/ancestor entries
  from the same live owner snapshot; a directory-only exact query must not enumerate
  unrelated content families. Immutable path indexes may be weakly cached only by
  exact validated snapshot identity and never become authority.
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
- Schema changes include migration and rejection tests by default. Project/node owns
  one sealed pre-open migrator for the code-pinned exact immediate predecessor only.
  It validates the predecessor's complete signed causal closure, imports semantic
  ProjectIndex and Canvas state into fresh current owner documents, verifies the
  staged current store by reopening it, and performs a crash-recoverable same-volume
  switch before discovery, touch, or first registration can expose the Project.
  Successful migration removes its transient rollback tree. Unknown identities,
  legacy JSON, retired experiments, corruption, and unavailable Team authority stay
  unchanged and closed; no helper guesses a format, creates an empty replacement,
  retains a selectable predecessor runtime, or falls back to local-owner authority.
- Project discovery, add/open classification, touch, and ProjectIndex first
  registration all invoke the same idempotent pre-open migration gate before reading
  current-only metadata or creating owner/collaboration bytes. Recovery may classify
  an already-published local bootstrap as unteamed only after Project/node proves its
  exact manifest-bound genesis and closed native inventory. A predecessor Team
  Project migrates only with matching predecessor authority and a valid current Team
  authorization path; missing, rejected, or contradictory Team state leaves the old
  tree untouched and never becomes a local-owner Project.
- Explicit Open may first publish only the canonical `projectId`/root registry
  binding outside the selected Project so the authority adapter can prove the root.
  That reservation does not create a key, owner binding, manifest, asset directory,
  or collaboration byte inside the Project; migration remains the first
  writer-facing action there, and a failed gate leaves a registered recovery entry.
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
- One open Project collaboration runtime exposes an opaque process-local identity,
  a live guard, and an explicit release lifecycle so Main may reuse already-verified
  static owner material only within that exact runtime. Quiesce, release, reset, or
  disposal revokes the identity; it is never a durable Project id, a TTL cache key,
  or permission to bypass the current Team-state gate.
- Node Project registry lookup keeps one manager-owned id index populated only by an
  exact durable registry read or successful manager write. Ordinary active-Project
  root resolution performs an exact id lookup and revalidates the native root; it
  never rescans unrelated Project bindings. Rename, rebind, forget, and creation
  replace that index from the newly durable registry state.
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
