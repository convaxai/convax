# P2P v10 Canvas cross-architecture review

Status: **REJECT UNTIL BLOCKING OBJECTIONS ARE CLOSED**

Reviewer: `/root/canvas_intent_runtime`

Scope: independent adjudication of the Canvas schema, causal kernel, and
service/Peer API drafts dated 2026-08-01. This review is normative only as an
architecture-gate vote. It does not authorize implementation and does not modify
any draft.

The three drafts do not currently describe one protocol. The largest conflicts
are substantive, not naming differences: they assign different trust to
checkpoints, different authority to offline edits, different revocation fences,
different sequence origins, different epoch scopes, and different protocol
majors. Implementing the union would create peers that accept different histories.

## C1. Offline durable signed replica versus provisional fork/replay

- **Choice:** an offline edit is immediately one final, actor-signed causal frame
  after the local object/outbox/journal/head durability barrier. It enters the
  local `replicaDoc`; it is not a provisional `workingDoc` or local fork and is
  never re-executed merely because a peer later appears.
- **Reason:** a per-device actor chain already supplies final identity, causal
  provenance, idempotency, and equivocation evidence. Replaying an offline intent
  against a later base changes guards, derived identities, placement, and external
  resource proofs, so the replayed operation is not the operation the user saved.
  Replication state belongs to an outbox/ACK projection, not a second document.
- **Flaw type found:** the provisional-fork proposal contains a hidden assumption
  that replay is semantics-preserving; for guarded and identity-deriving Canvas
  intents that assumption is false.
- **Strongest rebuttal:** a frame accepted before revocation may later be outside a
  cutoff and therefore cannot be promised as permanent team state. That is real,
  but it requires an explicit `saved-locally` versus `replicated` versus
  `excluded-to-recovery` status model; it does not justify changing the frame's
  identity by replay.
- **Falsifiable test:** edit 100 nodes while service and all peers are offline,
  restart, then connect two peers. Every peer must receive the exact original frame
  digests and operation/entity ids; any reducer re-execution, new actor sequence,
  or changed placement falsifies this choice.
- **Canvas-draft clause to delete:** none; the Canvas draft already treats the
  durable local frame as part of `replicaDoc` and the outbox as replication state.

## C2. Checkpoint content attestation versus unverified header catalog

- **Choice:** use a low-frequency, stateless content attester. It transiently
  receives the bounded checkpoint, parents, suffix, causal witnesses, and frozen
  validation artifacts; reconstructs every exact base; validates schema, intent,
  delta, invariants, and final hashes; then signs a content certificate. Durable
  service storage contains only the certificate, frontier/DAG metadata, holders,
  and audit counters, never payload bytes.
- **Reason:** unverified publication metadata cannot justify safe history pruning.
  After all peers delete the causal material, a new peer can verify a snapshot hash
  but cannot prove that the snapshot was produced by legal typed intents. Treating
  an editor signature as sufficient silently changes the threat model to “any one
  editor is a snapshot authority.”
- **Flaw type found:** the header-only proposal makes a logical jump from
  provenance and hash integrity to semantic validity. Those are different
  properties.
- **Strongest rebuttal:** the attester is a costly central trust and privacy edge;
  a compromised signer can certify bad state, and a 320 MiB validation carrier is
  hostile to a lightweight API deployment. The mitigation is a separately
  deployable deterministic verifier, purpose-separated keys, payload-zero durable
  audits, strict rate/size limits, and cross-runtime golden vectors. Removing the
  attester is not an equivalent mitigation.
- **Falsifiable test:** submit a correctly hashed and actor-signed checkpoint whose
  suffix contains a hidden Y.Map or an illegal creation-group orphan. If the
  service signs it, or if any durable service/log/trace store retains its content,
  this choice is falsified.
- **Canvas-draft clause to delete:** delete the opening claim that this Canvas
  proposal “does not change ... checkpoint ... protocols.” Its exact-base safety
  depends on the content-certified checkpoint contract selected here.

## C3. Revocation fence and honest uncheckpointed work

- **Choice:** ordinary member/device revoke or downgrade rotates only the affected
  member/replica authorization epoch and publishes an exact **content-certified
  checkpoint-set cutoff**. It does not roll every shard's `docEpoch`. Frames by the
  target that are in the cutoff closure survive; target frames outside it become a
  read-only recovery branch. Independent frames from still-authorized actors may
  survive, while frames whose base depends on excluded target work are blocked and
  require explicit semantic re-application.
- **Reason:** whole-project document-epoch rollover turns an authorization change
  into a data-universe reset and forces every unrelated shard/device to restart its
  chain. Conversely, accepting target frames merely because their credential once
  existed cannot distinguish honest pre-revoke work from post-revoke signing.
  Causal inclusion in the cutoff is the only observable boundary without a trusted
  per-edit timestamp/order.
- **Flaw type found:** the whole-epoch proposal conflates authorization and data
  identity; the header-only cutoff assumes that metadata availability implies
  rebuildable content.
- **Strongest rebuttal:** this deliberately loses honest target work that missed
  the cutoff. No offline-first protocol can both accept arbitrary old-key frames
  and enforce revocation without a trusted edit timestamp/order. The product must
  expose the recovery branch and never call the loss a merge conflict.
- **Falsifiable test:** revoke replica A while A has one checkpointed and one
  uncheckpointed edit; replica B has an independent edit and another edit depending
  on A's excluded frame. The first A edit and independent B edit must survive, the
  second A edit must be recovery-only, and dependent B edit must be blocked. Any
  blanket doc reset or automatic acceptance of the second A edit falsifies this
  choice.
- **Canvas-draft clause to delete:** none; revocation and authorization cutoff are
  outer-protocol concerns, provided all generic “epoch rollover clears Undo” text is
  interpreted as a real `docEpoch`/reset rebuild rather than ordinary revocation.

Authorization revocation MAY close sessions immediately. Until a certified cutoff
set is available from at least one non-target durable holder, affected documents
are `cutoff-material-unavailable` and fail closed; they are not team-ready and do
not accept target frames. The target's cooperation is never required.

## C4. Causal stability, compaction, and a long-offline actor

- **Choice:** add a signed per-actor **base-floor receipt**. A frame payload is
  prunable only below a content-certified checkpoint frontier that every currently
  authorized offline-capable actor has acknowledged as a lower bound for all its
  future frames, or after a cutoff removes the non-acknowledging actor. The receipt
  binds actor-chain head/next sequence, checkpoint certificate set, frontier, and
  document epoch. Pending, outbox, recovery, equivocation, and unacknowledged
  replication references remain additional prune blockers.
- **Reason:** “checkpoint has one remote durable ACK” is replication, not causal
  stability. An active actor can remain offline with a valid frame based before
  that checkpoint. A newer snapshot cannot reconstruct the older semantic guard.
  The only honest options are to retain a reconstructable lower checkpoint plus
  suffix, obtain a monotonic actor floor, or cut the actor off.
- **Flaw type found:** both drafts hide an availability assumption that all future
  writers have observed the pruned checkpoint. One remote ACK does not prove it.
- **Strongest rebuttal:** waiting for every active actor can retain history without
  bound when a laptop stays offline. That is unavoidable if indefinite transparent
  merge is promised. The bounded product escape hatch is an explicit stale-device
  revoke/cutoff that preserves its old work as recovery, not silent pruning.
- **Falsifiable test:** keep actor A offline at checkpoint C0 while B produces and
  certifies C1. Without A's base-floor receipt, deleting all material needed to
  reconstruct an A frame based on C0 must be rejected. After A signs a floor at C1,
  any newly presented A frame whose base does not dominate C1 must be recovery-only
  or protocol-invalid. Accepting it on top of C1 falsifies this choice.
- **Canvas-draft clause to delete:** none; add the outer base-floor prerequisite,
  but retain Canvas exact-causal-base validation unchanged.

## C5. Device actor key lifetime

- **Choice:** use a long-lived, Project-scoped device replica signing key held by an
  OS-vault adapter. Rotate it by enrolling a new actor and applying C3 cutoff.
  Short-lived session keys authenticate PeerJS handshakes, channels, holder claims,
  and service calls only; they never sign portable edit frames.
- **Reason:** offline edits and history verification must survive process restart,
  expired rendezvous sessions, and transport-key rotation. A session key cannot be
  both short-lived and the durable author of offline history.
- **Flaw type found:** treating session identity as document identity is a fact
  error about the two credentials' lifetimes and authorities.
- **Strongest rebuttal:** theft of a long-lived device key allows signed forks and
  offline abuse until cutoff. Vault isolation, one local writer lock, chain
  equivocation detection, actor caps, and rapid rotation limit but do not eliminate
  this risk.
- **Falsifiable test:** create a frame offline, restart after the prior session TTL,
  establish a new session, and verify/replicate the old frame without resigning it.
  If the old session key is required, this choice is falsified.
- **Canvas-draft clause to delete:** none; its durable `replicaActorId` context is
  compatible with a long-lived device key.

## C6. Actor sequence origin

- **Choice:** the first frame in an actor/document-epoch chain is sequence `"1"`
  with a null predecessor. Sequence `"0"` is reserved to mean no frame/genesis in
  vector and boundary codecs.
- **Reason:** reserving zero removes an unnecessary three-way ambiguity between an
  absent actor head, a genesis boundary, and a real first frame. It also makes
  “next sequence” arithmetic and checkpoint actor-head summaries easier to audit.
- **Flaw type found:** this is a protocol inconsistency rather than a conceptual
  flaw; leaving both origins documented guarantees cross-peer rejection.
- **Strongest rebuttal:** starting at zero is mathematically valid and saves no
  bytes either way. The decision is therefore conventional, but convention must be
  singular across frame, checkpoint, test vector, and store codecs.
- **Falsifiable test:** a first frame at sequence 0 must be rejected; sequence 1
  with a non-null predecessor must be rejected; sequence 1/null followed by
  sequence 2/exact-digest must pass in every runtime.
- **Canvas-draft clause to delete:** none; its operation context does not currently
  assign a genesis value, but the generated `/2` type must document start-at-one.

## C7. `docEpoch` existence and rollover

- **Choice:** keep `docEpoch` in every document/frame/checkpoint scope, but roll it
  only for an explicit destructive document reset, an incompatible document-schema
  cutover, unrecoverable document corruption/equivocation recovery, or Lamport
  exhaustion. Checkpointing and ordinary membership/replica changes never roll it.
- **Reason:** `projectEpoch` is too broad for a single damaged Canvas, while
  `shardEpoch` identifies a route incarnation rather than a collaboration-history
  universe. A narrowly governed `docEpoch` allows a fail-closed new genesis without
  pretending old frames belong to it.
- **Flaw type found:** the kernel overuses `docEpoch` as authorization state; the
  service draft removes a useful failure-containment boundary as if `shardEpoch`
  and document history were identical.
- **Strongest rebuttal:** three epochs increase wire and operator complexity and can
  be misused as a reset escape hatch. The response is a closed rollover reason,
  signed cutover receipt, preserved old bytes, and an explicit user-visible reset,
  not deletion of the scope.
- **Falsifiable test:** revoking a device must leave all document epochs unchanged.
  Explicitly resetting one Canvas must change only that Canvas `docEpoch`, reject
  old-epoch frames, preserve their recovery bytes, and leave sibling Canvases
  writable.
- **Canvas-draft clause to delete:** replace the imprecise “current Project/shard
  epoch” authority wording with exact `{projectEpoch, shardEpoch, docEpoch}` scope;
  no other Canvas semantic clause needs deletion.

## C8. Hard caps

- **Choice:** freeze these limits: typed-intent canonical JCS 512 KiB; complete
  causal-edit envelope 2 MiB; full checkpoint Yjs snapshot 32 MiB; checkpoint
  direct parents 8; service maximum valid checkpoint/certificate antichain 8;
  causal frontier heads 256; validation carrier 320 MiB. Individual section caps
  do not waive the 2 MiB total-envelope cap.
- **Reason:** Canvas legitimately batches up to 512 bounded results and can carry a
  large validated Plugin state, so 256 KiB makes currently specified legal intents
  unreachable. The 2 MiB outer cap remains the actual network/parse DoS boundary.
  An eight-tip antichain bounds bootstrap while still permitting a deterministic
  merge checkpoint; 32 parents/tips multiplies holder and validation work without
  a demonstrated product need.
- **Flaw type found:** the 256 KiB kernel cap conflicts with the Canvas union; the
  32-parent service cap ignores the checkpoint bootstrap cost. This is a cross-layer
  bounds mismatch.
- **Strongest rebuttal:** 512 KiB canonical JSON is still large for hostile input
  and can expand during parsing/materialization. Decoders must check byte counts
  before allocation, use depth/value caps, and enforce both per-section and total
  frame limits before Yjs parsing.
- **Falsifiable test:** exact-boundary fixtures must accept a valid 512 KiB intent
  in a sub-2 MiB frame and reject 512 KiB + 1; reject any frame at 2 MiB + 1,
  snapshot at 32 MiB + 1, checkpoint with 9 parents, or anchor that would retain a
  ninth incomparable valid tip before allocating the large payload.
- **Canvas-draft clause to delete:** none; retain its 512 KiB intent limit, but make
  the 2 MiB complete-frame limit an additional outer rejection condition.

## C9. Checkpoint maximum frontier and invalid children

- **Choice:** the attester recomputes a checkpoint's causal closure, maximal
  frontier, actor heads, and dominance from validated content. The service anchor
  is the deterministic `Max` union of **certified valid** checkpoint frontiers and
  retains every incomparable certified checkpoint up to C8. Caller-declared parent
  links are structural hints only and cannot establish dominance.
- **Reason:** a parent list proves neither causal reachability nor that the child
  snapshot contains its parents. If declared DAG tips drive discovery, one invalid
  child can mask valid parents and make a valid project unavailable even though no
  valid state changed.
- **Flaw type found:** relying on declared parents substitutes untrusted metadata
  for computed causality and creates an invalid-child availability attack.
- **Strongest rebuttal:** recomputation increases attester CPU and requires the
  service validator to track Canvas/Project validation artifacts. That cost is the
  price of allowing certified checkpoints to authorize pruning; if unacceptable,
  checkpoint certificates must lose that authority and history cannot be safely
  bounded.
- **Falsifiable test:** publish valid incomparable A and B, then an invalid C that
  declares both as parents. Across every publication order the certified anchor
  must remain A+B, C must never hide either parent, and a later valid merge D must
  reduce the anchor to D.
- **Canvas-draft clause to delete:** none; checkpoint dominance is outside Canvas,
  while Canvas supplies the canonical-state validator used by the attester.

## C10. Service document discovery without ProjectIndex authority

- **Choice:** maintain an append-only service document registry as discovery and
  cutoff-coverage metadata, not route truth. ProjectIndex is registered at Project
  creation. The isolated C2 attester may transiently validate ProjectIndex bytes,
  but the registry/API process receives only its signed certificate and never those
  bytes. In one registry publication transaction for the first certified Canvas
  genesis, service inserts the exact scope idempotently, advances
  `documentRegistrySequence`, recomputes/signs `documentRegistryDigest`, and binds
  the staged ProjectIndex dependency digest carried by certificate metadata.
  Closing/tombstoning a route does not delete the entry. Clients persist
  sequence/digest high-water and fail closed on rollback or same-sequence digest
  equivocation. Only peers reconstructing ProjectIndex decide
  `staged/live/closed`.
- **Reason:** asking the service registry to parse current ProjectIndex makes it a
  second Project catalog and creates circular bootstrap. Registering from certified
  genesis metadata gives the service the bounded document set needed for discovery
  and revocation coverage without giving it Canvas route semantics.
- **Flaw type found:** deriving service routes by reading ProjectIndex would violate
  ownership; deriving them from arbitrary unverified headers would make fake
  documents a durable service DoS. Certified genesis is the missing alternative.
- **Strongest rebuttal:** an offline-created Canvas is not discoverable through the
  service until a genesis is attested. Existing peers that already have ProjectIndex
  can still sync it directly; new-device discovery correctly waits rather than
  inventing an unverified route.
- **Falsifiable test:** create a staged Canvas offline, sync it to an existing peer,
  then bring the service back. It must enter the registry only after certified
  genesis publication; the service must not mark it live by inspecting ProjectIndex.
  A fake unsigned/invalid genesis must not consume a registry slot. Replaying the
  same genesis is idempotent; presenting lower registry sequence or same sequence
  with another digest must fail closed.
- **Canvas-draft clause to delete:** delete the opening claim that the proposal does
  not change ProjectIndex protocols; staged-route dependency, certified genesis,
  and registry publication are one cross-shard creation protocol even though the
  service never becomes route authority.

## C11. Resource proof and blob replication authority

- **Choice:** remove `localDurableIndexDigest` and every native persistence digest
  from portable intents/frames. Split the rule into: (1) before local signing,
  `@convax/project/node` verifies the file/blob and ProjectIndex record are locally
  durable; (2) the portable proof binds canonical URI, Project/file/version ids,
  blob hash, byte length, and exact ProjectIndex causal dependency; (3) a structural
  frame durable ACK and a blob verified-durable ACK are separate receipts.
- **Reason:** a machine-local index digest has no meaning on another peer and makes
  a legal frame unverifiable remotely. Conversely, a portable blob hash does not
  prove that the author or receiver has fsynced the bytes. Those are different
  authorities and must not be collapsed into one guard.
- **Flaw type found:** the current proof confuses a local persistence prerequisite
  with a portable semantic fact; treating a Yjs ACK as a blob ACK is another logic
  error.
- **Strongest rebuttal:** removing the local digest from the frame appears to weaken
  evidence that the author possessed durable content. It does not: local admission
  is enforced by the native port and remote peers accept the reference only against
  ProjectIndex/hash; “replicated with assets” is withheld until a remote blob ACK.
- **Falsifiable test:** peers with different native store digests but identical
  Project/file/version/blob tuple must accept the same frame. After only the frame
  ACK, UI must not show asset-replicated; after hash verification, file fsync, blob
  index fsync, and signed blob ACK, it may.
- **Canvas-draft clause to delete:** delete
  `CurrentResourceAdmissionProofV1.durable: ProjectResourceDurableGuardV1` and every
  portable dependency on `localDurableIndexDigest`; replace them with the C11
  portable ProjectIndex/resource tuple.

## C12. Protocol major

- **Choice:** this cutover is `/2` everywhere: binary magic/major, frame/header and
  checkpoint formats, typed-intent format, Canvas root/schema digest, Peer channel
  contract, collaboration API path/catalog, and generated fixtures. `/1` is rejected
  and preserved only as unsupported bytes until explicit reset; no dual read/write
  or aliasing is allowed.
- **Reason:** offline final frames, causal DAG, checkpoint attestation, new epochs,
  resource proofs, containment layout, and semantic history all change validation
  meaning. Reusing `/1` would let two incompatible validators claim protocol
  compatibility.
- **Flaw type found:** keeping `/1` is a factual versioning error, not an additive
  evolution. The wire meaning is breaking.
- **Strongest rebuttal:** a global `/2` increases cutover work and makes old projects
  unopenable. The project is in development and explicitly permits destructive
  reset; preserving unsupported bytes until user confirmation is safer than false
  compatibility.
- **Falsifiable test:** feed every `/1` frame, header, checkpoint, root name, API
  body, and channel handshake to a `/2` implementation. Each must fail closed before
  semantic parsing and trigger only the explicit reset/recovery path.
- **Canvas-draft clause to delete:** delete every `V1`, `/1`, and
  `convax.canvas.v1` wire/schema token from the proposal; regenerate them as `/2`
  rather than retaining aliases. Domain names that are not wire tokens may keep
  normal source-level names.

## C13. Exact causal-base verification and prune witness

- **Choice:** validate every remote frame against a `CausalBaseWitnessV2` consisting
  of exact certified checkpoint bytes whose closure is a subset of the declared
  base, its certificate and actor-head boundary, every exact suffix frame needed to
  reach the base frontier, the exact base state-vector bytes, owner canonical-state
  hash, ProjectIndex dependency witness, and frozen validation artifacts. Clone the
  checkpoint, replay the suffix topologically, and require byte-exact state-vector
  plus canonical hash equality before reducing the intent.
- **Reason:** validating a semantic guard on the receiver's current superset is not
  equivalent to validating it on the author's base. A checkpoint newer than the
  base cannot prove the old state, even if it contains the frame's entities and has
  a valid service signature.
- **Flaw type found:** accepting a digest-only or newer-checkpoint shortcut is a
  logical jump from state inclusion to historical state reconstruction.
- **Strongest rebuttal:** exact witness retrieval is expensive and may be impossible
  after aggressive compaction. C4 deliberately prevents that compaction for an
  authorized actor; otherwise the honest result is `base-pruned` plus recovery or a
  newly authored intent, not weaker verification.
- **Falsifiable test:** construct an intent whose guard is valid at base B0 but
  invalid at later B1. Remove B0's witness and provide a valid B1 checkpoint. The
  receiver must return `base-pruned`, never accept or reject by running the guard on
  B1. Restoring the exact witness must reproduce the author's state vector and
  deterministic decision.
- **Canvas-draft clause to delete:** none; retain its requirement to reconstruct the
  exact authored base, and add `base-pruned` as the mandatory outer failure state.

## C14. Generation and containment schema

- **Choice:** accept the flat containment actor-slot schema and deterministic
  maximum-cycle-edge breaker as written. Reject the generation schema until `/2`
  adds one exact cross-device recovery operation: a grow-only
  `generationDismissals[generationId][actorId]` claim plus
  `canvas.generation.dismiss`. It requires the exact observed begin, is causally
  after that begin, and suppresses that generation's lifecycle/output; a terminal
  whose base already contains a dismissal is invalid, and concurrent dismissal
  wins. Owner-only immutable terminals and begin-time output priority remain.
- **Reason:** flat containment preserves every concurrent actor choice and avoids
  the nested-Y.Map first-write race. Generation output ordering is also sound, but
  owner-only terminal authority leaves a permanently lost device's generation
  active forever. A different actor must be able to suppress, but not forge, the
  missing actor's tool result.
- **Flaw type found:** containment fixes the prior structural race. Generation has
  an omitted failure case: durable actor identity was incorrectly treated as
  permanently available execution ownership.
- **Strongest rebuttal:** any editor dismissal can hide a legitimate late success.
  That is preferable to allowing any editor to fabricate a terminal; the terminal
  remains retained history, dismissal is explicit/auditable, and every editor could
  already delete or supersede the node.
- **Falsifiable test:** three peers concurrently create A->B, B->C, C->A and must
  produce one identical acyclic projection while retaining all choices. Separately,
  lose the begin owner's device, dismiss from another editor, then deliver a
  concurrent owner success in both orders; both peers must keep the result
  suppressed and retain both immutable facts.
- **Canvas-draft clause to delete:** delete the “root contains exactly these keys”
  and closed-intent-union clauses in their current form, because they omit
  `generationDismissals` and `canvas.generation.dismiss`. Replace them in `/2`;
  retain flat containment and owner-only terminal clauses.

## C15. Semantic undo and remote frames

- **Choice:** accept semantic inverse/forward intents and the rule that remote
  transactions neither enter nor clear local session history. However, a
  collaboration-owned `SessionUndoCoordinator` is the sole owner of the session
  operation-id cursor. `Y.UndoManager` MAY capture/group local origins and attach
  stack metadata, but its raw undo update and private stack mutation are never the
  authority. A selected root moves between undo/redo cursors only after the new
  semantic frame crosses the durable barrier; stale-guard failure leaves both
  cursors unchanged.
- **Reason:** a remote verifier does not possess the author's local UndoManager
  stack, and Yjs offers no transactional “peek, validate candidate, persist, then
  commit stack movement” protocol. Applying raw undo to the live authority before
  persistence violates the candidate barrier; mutating UndoManager internals binds
  the protocol to undocumented library details.
- **Flaw type found:** the draft's statement that UndoManager “chooses” a root while
  its raw update is unused skips the required stack-transition mechanism. This is a
  hidden implementation assumption.
- **Strongest rebuttal:** a separate semantic cursor sounds like a second source of
  truth and weakens the preference to let Yjs own undo. It is session-transient
  selection state, not document state; Yjs remains the sole durable Canvas source,
  while semantic history receipts make the undo itself portable and verifiable.
- **Falsifiable test:** A commits two roots, B sends a remote frame between them, and
  A requests undo while a guard is first stale and then valid. B's frame must not
  clear/reorder A's cursor; the failed attempt must not move either cursor; the
  successful attempt must move exactly one root only after fsync and must replicate
  as one typed semantic frame.
- **Canvas-draft clause to delete:** delete “UndoManager chooses a local root
  operation only” as an authority statement. Replace it with the
  `SessionUndoCoordinator` selection/commit rule; UndoManager remains optional
  capture metadata and remote transactions remain untracked.

## C16. Old work, checkpoint advancement, and no-holder bootstrap

- **Choice:** checkpoint publication alone never invalidates old work. An
  authorized actor's old-base frame remains team-admissible while C4 requires its
  reconstruction witness to be retained. After that actor signs a higher base floor
  or is cut off, below-floor work is recovery-only. A new device with no online
  holder enters `waiting-for-holder` and cannot open an empty shard, edit it, or call
  it synchronized. An existing device with a full durable replica continues
  offline editing normally.
- **Reason:** “offline editing works” applies to a device that already has the
  replica; it does not create bytes on a new device. The service stores certificates
  and routes, not snapshots/blobs, so there is no safe bootstrap source when every
  holder is absent.
- **Flaw type found:** equating an existing offline replica with a new unseeded
  device is a hidden data-availability assumption. Equating a checkpoint with an
  edit cutoff is a separate logic error.
- **Strongest rebuttal:** a user may regard `waiting-for-holder` as unacceptable
  team reliability. Then the product needs a service/object-store replica seed or a
  designated always-on team seed; PeerJS rendezvous cannot solve data absence.
- **Falsifiable test:** with every holder offline, an existing seeded device must
  accept local edits while a newly enrolled device remains read-only/waiting and
  never fabricates genesis. When one holder returns it must bootstrap from certified
  bytes. If no holder ever returns, only an explicit destructive `docEpoch` or
  `projectEpoch` reset may create new empty state.
- **Canvas-draft clause to delete:** none; its `replicaDoc` authority remains valid
  for already seeded devices, while bootstrap availability is an outer protocol
  state.

## Blocking objections

Implementation must not begin until all of these are closed in one rewritten
protocol set:

1. **Checkpoint authority conflict:** the causal kernel specifies full content
   attestation while the service draft explicitly forbids content validation. C2
   selects attestation; all service DTOs, stores, deployment boundaries, and privacy
   language must be rewritten consistently.
2. **Revocation/compaction gap:** neither draft defines the actor base-floor needed
   to distinguish safe pruning from destruction of still-authorized offline work.
   C3/C4 must become frozen wire objects, service transactions, recovery states, and
   golden tests.
3. **Protocol identity split:** Canvas and service still publish multiple `/1`
   formats while the kernel claims breaking `/2`; sequence origin and epoch scope
   also disagree. C6/C7/C12 require one generated contract and no aliases.
4. **Non-portable resource proof:** `localDurableIndexDigest` is still embedded in
   Canvas/Project portable guards. It must be removed from wire state and replaced
   by the C11 split before any peer validator is implemented.
5. **Generation recovery and Undo mechanics:** owner loss leaves generation active
   forever, and the proposed UndoManager prose has no safe stack-commit mechanism.
   C14/C15 must be represented in schema and executable failure fixtures.
6. **Bounds mismatch:** 256/512 KiB intents and 8/32 checkpoint parents currently
   produce different valid languages. C8 must be generated from one source into
   browser, Main, service, and golden codecs.

## Strongest three objections to the adjudicated design

1. **It is not purely P2P trust.** The checkpoint attester is a central semantic
   signer. A compromised or drifting attester can certify bad state, and transient
   content exposure may violate a future end-to-end privacy requirement. If that
   requirement exists, this design must be rejected or replaced by a materially
   different proof/quorum model.
2. **Offline-first, immediate revocation, and bounded history cannot all be lossless.**
   Base floors and cutoffs make the loss boundary explicit, but stale devices can
   force retained history or recovery. Any product promise of indefinite automatic
   merge after arbitrary absence falsifies this architecture.
3. **Portable validation is a distributed consensus surface even without edit
   order.** A single difference in canonical JSON, Yjs schema traversal, Plugin
   artifact, URI codec, reducer, or cycle projection partitions the team. Frozen
   artifacts, cross-runtime byte fixtures, differential fuzzing, and fail-closed
   upgrade gates are release prerequisites, not later hardening.

## Named argument flaws across the drafts

- **Fact error:** PeerJS identity/session and Yjs convergence do not establish
  membership authority, durable replication, semantic validity, or business
  convergence.
- **Hidden assumptions:** at least one holder is online; every writer observed the
  compacted checkpoint; a durable device actor remains available to terminate its
  generation; UndoManager can move a stack without mutating live state.
- **Logical jumps:** a signed header is treated as valid content; declared parentage
  is treated as causal dominance; current-superset validation is treated as exact
  base validation; a local durability digest is treated as portable proof.
- **Ignored alternatives:** actor base-floor receipts, certified-genesis registry,
  session semantic cursor, and cross-device generation dismissal.
- **Sample bias:** happy-path two-peer online merges do not exercise long-offline
  actors, revoked sole holders, malicious invalid children, lost generation owners,
  or compaction after partial ACK.

## Total score

**6.4/10.** The core direction—final signed P2P frames, exact candidate validation,
flat containment, deterministic projection, sharded Y.Docs, separate blob channel,
and portable typed intents—is coherent. The deduction is large because the three
documents currently define incompatible trust and wire protocols, and because
revocation plus compaction is not safe for long-offline actors. This is not an
implementation-ready score. Reaching 8/10 requires closing all six blockers with
one generated `/2` contract and passing the falsifiable tests above.

## Reviewer-signed normative clause summary

The reviewer signs the following architecture vote as one indivisible set:

The normative-clause digest input is the exact UTF-8 bytes beginning with the
`N1` list line and ending with the blank line after `N16`, including the final LF.

1. `N1`: offline local durability creates a final signed replica frame; no replay
   fork is canonical.
2. `N2`: only transient full-content validation may produce a pruning-authoritative
   checkpoint certificate; service durable storage is payload-free.
3. `N3`: authorization epoch plus certified checkpoint-set cutoff handles revoke;
   ordinary revoke does not roll `docEpoch`.
4. `N4`: pruning requires certified coverage and every active offline-capable
   actor's signed base floor, or a cutoff.
5. `N5`: durable device keys sign edits; session keys sign transport/service
   transcripts.
6. `N6`: actor frame sequences start at one; zero is reserved.
7. `N7`: `docEpoch` exists only for explicit document-universe rollover.
8. `N8`: intent/frame/snapshot/parent/tip limits are 512 KiB, 2 MiB, 32 MiB, 8,
   and 8 respectively.
9. `N9`: service frontier is computed only from content-certified causal closure;
   invalid children cannot mask valid parents.
10. `N10`: service discovery uses certified genesis registry metadata; ProjectIndex
    remains sole route truth.
11. `N11`: native durability proof is local-only; portable resource proof and blob
    durable ACK are separate.
12. `N12`: the complete cutover is `/2`; `/1` is unsupported, never aliased.
13. `N13`: remote intent validation reconstructs the exact authored causal base or
    returns `base-pruned`.
14. `N14`: containment is accepted; generation requires deterministic cross-device
    dismissal without cross-device terminal forgery.
15. `N15`: undo/redo are durable semantic intents; remote frames do not clear local
    session selection, and raw UndoManager updates are not authority.
16. `N16`: existing replicas edit offline; new devices without a holder wait and
    never fabricate empty synchronized state.

Attestation:

```text
reviewer = /root/canvas_intent_runtime
decision = REJECT_UNTIL_BLOCKERS_CLOSED
scope = C1..C16 as written in this file
signature_kind = reviewer-identity assertion; not a cryptographic key signature
normative_clause_sha256 = e6d6f77317b42563f13f6f534a898e71c5613a4044b48a382e55b5f919d229ae
```

The whole-file SHA-256 is intentionally reported as a detached handoff value: a
file cannot contain its own stable cryptographic hash without defining a special
exclusion rule.
