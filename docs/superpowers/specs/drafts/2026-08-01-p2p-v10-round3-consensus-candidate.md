# P2P v10 round-3 consensus candidate

Status: revision 4 semantic candidate only; not canonical or implementation authority.
Unchanged unanimous round-2 clauses remain outside this document.

## Revision 1 -> 2

- R3-1 fixes aggregate carrier arithmetic; R3-2 narrows epoch reset authority.
- R3-3 makes registry absence non-denying, adds abandonment and immutable paged cutoff coverage.
- R3-4 makes recovery proof canonical and single-key, fixes dependency direction, and defines dismissal fallback.

## Revision 2 -> 3

- R3-1 separates section ceilings from the encoded-whole carrier fixture.
- R3-3 freezes retry identity/order/fold and cutoff target/signature/page semantics.

## Revision 3 -> 4

- R3-3 closes replica/member cutoff targets and actions; v2 unlisted-empty requires every page.

## R3-1. Checkpoint trust and threat model

### Normative clause

A checkpoint progresses through `candidate -> content-certified -> prunable`.

1. An actor-signed candidate is discovery metadata and has no bootstrap/prune
   authority.
2. A purpose-separated stateless service attester streams and transiently validates
   the exact checkpoint, certified parents, suffix DAG, signatures, exact bases,
   typed intents, closed Yjs writes, Project/Canvas/Plugin schemas, invariants and
   final hashes. `CheckpointContentCertificateV2` binds exact scope/checkpoint/parents, computed frontier/heads,
   state-vector/canonical/full-update and protocol/schema/artifact/trust digests plus service signature; payload bytes never persist or enter logs/traces/retries.
3. Every active editor replica in one exact membership snapshot independently
   validates and fsyncs the certified checkpoint set, includes all its durable local
   heads, installs a monotonic causal floor, and signs
   `ReplicaCausalFloorAckV2` with its long-lived replica key.
4. Only after exact all-active-editor coverage may service sign
   `PrunableCheckpointSetCertificateV2`. Only this dual-gated object authorizes
   payload pruning and post-prune bootstrap. Service CAS orders this GC metadata,
   never edits or business projection.

If content attestation is disabled for privacy, unavailable, over cap, or fails its
determinism spike, edits/checkpoint candidates/Peer sync continue but full genesis
history is retained. There is no metadata-only pruning fallback.

### Owner and wire/state objects

- `@convax/canvas` and `@convax/project` own their pure validators and artifacts.
- `@convax/collaboration` owns generic carrier/checkpoint/floor cores and exact-base
  validation ports, but no membership policy.
- `@convax/project/collaboration-protocol` owns Project-scoped certificate/coverage
  DTOs and the browser-safe composite verifier export.
- `@convax/project/node` owns local checkpoint/floor durability.
- isolated API attester and membership services consume public exports only; they
  never import private Canvas/Project source or execute Plugin JavaScript/WASM.
  Executable-only Plugin validation makes the candidate `attestation-unavailable`.

```ts
interface StableCheckpointSetCoreV2 {
  format: "convax.stable-checkpoint-set-core/2"; scope: DocumentScopeV2; priorSetDigest: string | null
  contentCertificateDigests: string[] // sorted unique, 1..8
  mergedFrontierDigest: string; actorHeadBoundaryDigest: string
  membershipSnapshotDigest: string; protocolDigest: string
  validationArtifactSetDigest: string
}
interface ReplicaCausalFloorAckV2 {
  format: "convax.replica-causal-floor-ack/2"; coreDigest: string; replicaId: string; actorId: string
  actorHeadAtAck: CausalHeadRefV2 | null
  durableCheckpoint: true; validatedExactClosure: true
  installedMonotonicFloor: true
  replicaSignature: string
}
interface PrunableCheckpointSetCertificateV2 {
  format: "convax.prunable-checkpoint-set-certificate/2"; core: StableCheckpointSetCoreV2
  floorAckDigests: string[] // exact active-editor coverage, max 256
  contentStatus: "service-validated-and-all-editors-acknowledged"
  serviceSignature: string
}
```

Caps: intent 512 KiB; frame 2 MiB; snapshot 32 MiB; direct parents/stable set 8;
frontier heads 256. Proposal snapshot plus all parent snapshots is <=256 MiB;
suffix is <=64 MiB/4,096 frames; encoded whole carrier, including framing,
certificates, indexes and artifacts, is <=320 MiB. Independent ceilings need not be
simultaneously attainable. Reject before allocation/decompression.

### Failure states

`checkpoint-candidate`, `attestation-unavailable`, `attestation-rejected`,
`awaiting-editor-floors`, `history-retention-required`, `floor-membership-stale`,
and `checkpoint-payload-unavailable`. None authorizes pruning; only missing
bootstrap-required payload makes that fresh replica not team-ready.

### Threat-model limit

Invalid prunable history requires both a bad/compromised attester and every covered
editor to sign it, except a common deterministic-validator defect may fool both
trust domains. End-to-end secrecy from the attester is not promised. One offline
editor blocks pruning until ACK or explicit revoke/cutoff.

### Falsifiable test

An invalid hidden-Y.Map candidate must be rejected by attester and an honest editor.
With a malicious attester but one missing/refusing editor ACK, pruning must remain
forbidden. A valid maximum carrier must produce identical hashes across Bun,
Chromium and attester, survive crash injection without payload persistence, and
remain unprunable until all editor floors are durable. A 256 MiB snapshot aggregate
or 64 MiB/4,096-frame suffix passes only if all other sections keep encoded whole
bytes <=320 MiB; neither fixture requires both maxima. One legal fixture is exactly
320 MiB encoded with every section in cap. Any section or encoded-whole limit plus
one byte fails preallocation.

### Replaced round-2 clauses

Replaces Canvas/kernel R2-1 and R2-6 peer-only pruning authority, and service R2-1
and R2-6 attester-only pruning authority. R2-2 active-editor-only floor coverage is
retained but now references the content certificate and dual-gated set.

## R3-2. Epoch ownership

### Normative clause

There is no `docEpoch`. Exact document scope is
`{projectId, projectEpoch, docKind, docId, shardEpoch}`.

- `projectEpoch` is owned by `@convax/project` and changes only on explicit
  destructive reset of the complete Project collaboration universe.
- `shardEpoch` is owned by `@convax/project` and is the sole incarnation of one
  ProjectIndex/Canvas collaboration history. Checkpoint, compaction, membership,
  revoke, Plugin update and session renewal never change it.
- An incompatible Canvas schema, document-wide Lamport exhaustion, or corruption/
  equivocation unrecoverable from every trusted checkpoint uses a staged Project
  route transition to a random new `shardEpoch` and preserves old bytes. Actor
  sequence exhaustion rotates actorId; ordinary forks use quarantine/revoke.
- ProjectIndex corruption/incompatible reset changes `projectEpoch`, because
  ProjectIndex owns every route. Canvas delete/recreate uses a new Canvas id; reset
  never revives a tombstone.

### Owner and wire/state objects

`DocumentScopeV2` and `DocumentShardResetClaimV2` belong to
`@convax/project/collaboration-protocol`; generic frame codecs consume the scope
opaquely. A reset claim binds old/new scope, closed reason, old/new schema/protocol
digests, staged genesis digest, ProjectIndex operation digest, actor/admin identity,
and explicit confirmation receipt. Claim JCS is capped at 64 KiB.

### Failure states

`shard-reset-staged`, `shard-reset-awaiting-route-cas`,
`shard-reset-recovery-required`, `unsupported-old-shard`, and
`project-reset-required`. Before route CAS the old shard remains sole current route;
after CAS the new shard is sole current route and old bytes are recovery-only.
Recovery resumes the same reset claim; only a pre-CAS staged shard may be abandoned.

### Threat-model limit

Replacing a Canvas requires cross-shard ProjectIndex coordination and may be
unavailable while its route authority is corrupt. An independent `docEpoch` would
avoid that wait only by creating a second route/reset authority, which is forbidden.

### Falsifiable test

Revoke/checkpoint/session rotation must leave scope unchanged. Inject crashes before
new genesis, before route CAS and after CAS: never expose two live shards or lose old
bytes. Reset Canvas A without changing Canvas B; any remaining `docEpoch` wire/path
dependency or reset outside Project ownership fails the candidate. Actor sequence
exhaustion must rotate actorId; only document-wide Lamport exhaustion may reset.

### Replaced round-2 clauses

Retains Canvas/kernel R2-4 no-`docEpoch` semantics. Replaces service R2-4 and every
service round-2 object/signature field that retained `docEpoch`.

## R3-3. Service collaboration-scope registry

### Normative clause

Service owns a grow-only registered-scope discovery index that may lag ProjectIndex;
it is never a complete scope set or Project route catalog. Entry absence never
denies a scope proved by exact ProjectIndex and causal evidence. Entry state is
`registered-candidate -> dual-validated | abandoned`.

1. A current editor signs `DocumentRegistrationClaimV2` binding exact scope,
   genesis header digest and opaque ProjectIndex route-dependency digest. Service
   verifies identity/signature/bounds/idempotency only and creates candidate state.
2. Promotion requires R3-1 content certification plus all-editor floors for Canvas
   genesis and its exact staged ProjectIndex dependency. It caches immutable genesis
   proof only; it is never a route/edit/bootstrap acceptance gate or current pointer.
3. Registry never stores or decides title, URI, location, active Canvas, or
   `staged/live/closed`. Only reconstructed ProjectIndex decides visibility/current
   shard. Tombstone/reset never deletes prior registry entries.
4. Original registrar or Project admin may sign
   `DocumentRegistrationAbandonmentV2`; abandonment is retained/auditable, releases
   the outstanding slot and cannot undo promotion. A retry uses a new claim revision.
5. Target revocation uses the bound coverage below. Registered candidate/abandoned
   leaves and every unlisted/never-registered scope default to
   `empty-target-frontier`; only an explicit certified leaf preserves target frames.
   Independent surviving actors may later validate the scope normally.

### Owner and wire/state objects

`@convax/project/collaboration-protocol` owns
`DocumentRegistrationClaimV2`, `CollaborationScopeEntryV2` and canonical registry
digest. API owns transactional sequence/high-water, signature checks, quotas and
storage. `@convax/project` remains sole route owner.

Entry states bind registration claim digest and, after promotion, ProjectIndex
content certificate, Canvas genesis certificate and prunable-set digests. Registry
responses are service-signed `{projectEpoch, sequence, priorDigest, entriesDigest}`;
same sequence/different digest or rollback fails closed.

Entry identity is exact `{scopeKey, registrarReplicaId, claimRevision}`, where
`scopeKey` is canonical JCS `DocumentScopeV2` and revision is a canonical uint64
decimal string starting at `"1"` per scope/registrar and incrementing exactly by one
after abandonment. Abandoned entries stay terminal; duplicate, gap or conflicting
exact identities fail closed. Leaves bind exact entry digests and order strictly by
`(UTF8(scopeKey), registrarReplicaId bytes, claimRevision unsigned)`.

For each scope/registrar only its highest authenticated contiguous legal revision
participates. Per scope, participating dual-validated leaves dominate candidate and
abandoned empty leaves; the scope value is deterministic `Max` union of every such
certified target frontier. With no participating dual-validated leaf it is
`empty-target-frontier`. Every retained revision still counts toward caps/coverage.

`RegistryCutoffTargetV2` is a closed union. Replica target is `{kind: "replica",
action: "revoke", memberId, priorMemberAuthorizationEpoch, replicaId, actorId,
priorReplicaAuthorizationEpoch}`. Member target is `{kind: "member", action:
"revoke" | "downgrade-to-viewer", memberId, priorMemberAuthorizationEpoch,
targetedReplicaActorSet}`. That set is the complete pre-mutation active-editor set,
sorted uniquely by replicaId bytes, max 8; each item binds exact
`{replicaId, actorId, priorReplicaAuthorizationEpoch}`.

`RegistryCutoffCoverageV2` binds the exact current registry sequence/root and has one
strictly identity-sorted `TargetCutoffLeafV2` per retained entry: <=1 KiB, entry state, and
either certified target frontier digest or `empty-target-frontier`. Leaves split
deterministically into immutable content-addressed pages of <=512 leaves/512 KiB;
there are <=8 pages/4,096 leaves/4 MiB. A <=64 KiB `RegistryCutoffCoverageRootV2` binds ordered page
digests/leaf count plus exact `projectId`, `projectEpoch`, unique `cutoffId`, closed
target above, `beforeMembershipSnapshotDigest/afterMembershipSnapshotDigest`, registry sequence/root and fixed
`unlistedScopePolicy: "empty-target-frontier"`. The authorization mutation binds the
same closed target/action and coverage-root digest. A member leaf frontier covers the
union of listed actors; empty excludes all of them. Service verifies the set exactly
matches the before snapshot. Wrong kind, omission, duplicate actor, epoch mismatch,
stale root or cross-target replay fails; service atomically stores/signs mutation,
root and pages. A scope is unlisted only after every ordered page verifies. Any
missing page is `cutoff-coverage-incomplete`; until complete no target frame is
accepted/excluded and no team-ready rebuild is claimed. Current registry is no substitute.

Caps: 64 KiB claim; 4 outstanding candidates per active replica; 1,024 retained
entries/member; 4,096/Project; all retained claim payload <=64 MiB, plus the bounded
coverage above. Promotion/abandonment frees an outstanding slot, never an entry.

### Failure states

`scope-candidate`, `scope-awaiting-dual-validation`, `scope-abandoned`,
`scope-capacity-exceeded`, `scope-reset-claim-required`,
`registry-rollback-quarantine`, and `cutoff-coverage-incomplete`. `scope-unroutable` is only a ProjectIndex client
projection. Capacity never blocks seeded-peer sync outside service discovery.

### Threat-model limit

An authorized editor can consume bounded candidate metadata with fake scopes.
Quotas, audit and revoke bound but cannot eliminate that DoS without content-aware
registration or admin-only Canvas creation. Candidate metadata never creates a
visible Canvas or survival frontier.

### Falsifiable test

Register fake and real staged scopes concurrently: neither is visible without
ProjectIndex; only the real joint proof promotes. Tombstone the real route: entry
remains while Canvas closes. Registry absence must not reject an offline valid scope.
Abandon one of four candidates and reuse its slot without deleting audit bytes.
Retry the same scope and permute pages: exact entry order and highest-legal-revision
fold must match; dual validation dominates empty, otherwise scope value is empty.
At 4,096 entries, pages/root/mutation commit atomically; swap target/epoch, omit/
reorder a leaf, rollback root, or exceed caps and fail. A missing page stays
incomplete; only all verified pages permit unlisted empty. Revoke one replica without
affecting siblings; member revoke/downgrade covers its exact complete actor set.

### Replaced round-2 clauses

Replaces Canvas R2-7's cutoff coverage only for peer-validated entries, kernel
R2-7's single-state registry, and service R2-7's attester-only inventory with no
candidate registration. It retains ProjectIndex as sole route truth.

## R3-4. Generation owner loss

### Normative clause

Canvas exposes two distinct monotonic facts; neither impersonates an owner terminal:

1. `canvas.generation.dismiss/2` is an explicit editor action after observing the
   exact begin. It writes the same immutable dismissal marker for all actors.
   Dismissal removes that begin lifecycle and every terminal output claim for that
   generation from effective data competition; it does not delete any claim, mean
   failed/cancelled/refunded, or stop external work.
2. `canvas.generation.fail-recovery/2` writes a fixed recovery-failure marker only
   after the unique canonical first-loss receipt for exact `{projectId,
   projectEpoch, beginActorId, beginAuthorizationEpoch}` proves owner revocation or
   replacement, cutoff retention of the exact begin, no surviving owner terminal,
   and a current editor claimant. It means `generation-owner-unavailable` and can
   never contain output or an actor-authored message.

Owner `succeeded/failed` terminal remains immutable and owner-only. Projection
precedence is node tombstone, dismissal, surviving owner terminal, recovery failure,
then active begin. After dismissal, an existing node recomputes the portable max over
remaining non-dismissed prior/manual claims; a pending-generation node falls back to
its retained generation placeholder with the lifecycle dismissed. Suppressed success
resources remain retained history roots, and recovery markers are dormant audit data.
Dismissal and recovery are not semantic Undo roots; a new generation continues work.

### Owner and wire/state objects

`@convax/canvas` owns intents, fixed markers and projection. Flat keys avoid nested
map races:

```text
generationTerminals/<generationId>/owner/<beginActorId>
generationDismissals/<generationId>              // identical marker value
generationRecoveryFailures/<generationId>         // one fixed marker
```

`@convax/canvas` owns the headless `GenerationExternalFactContext` port.
`@convax/project/collaboration-protocol` verifies authorization/cutoff and the
canonical receipt; Project implements/injects that port and keeps its non-serializable
`VerifiedGenerationRecoveryPermitV2` in Project-local call context. It never enters
Canvas public types, intents, Y.Doc or frames; wire/marker state binds only
`proofDigest`. Remote peers missing the proof remain pending. All operations remain
under the 512 KiB intent/2 MiB frame caps; exactly one dismissal and one recovery
marker exist per generation, so marker storage is O(1).

### Failure states

Projection states are `active`, `succeeded`, `failed`, `dismissed`, and
`failed-recovery`. Command failures include `generation-not-observed`,
`generation-owner-still-authorized`, `recovery-proof-unavailable`,
`recovery-proof-noncanonical`, `owner-terminal-survived-cutoff`, and
`stale-generation-scope`.

### Threat-model limit

Any editor can intentionally hide a legitimate late result, just as an editor can
delete/supersede its node. The action is explicit and auditable but does not cancel
or refund external work. Formal owner-loss failure remains unavailable offline
until revoke/cutoff proof exists.

### Falsifiable test

Deliver dismissal and owner success in every order: projection is dismissed while
terminal/resource bytes remain; existing nodes choose the same remaining portable
winner and pending nodes show the retained placeholder. Without dismissal, recovery
must reject noncanonical/second receipts, active owner, absent begin or surviving
terminal; after valid revoke all peers write the same single-key marker. A remote
without proof stays pending. Canvas never queries membership or accepts non-owner success.

### Replaced round-2 clauses

Combines, while semantically separating, kernel R2-8 dismissal and Canvas/service
R2-8 cutoff-proof recovery. It replaces any clause making either mechanism the sole
owner-loss state or describing dismissal as failure/cancellation.

## Candidate decision

**SIGN**, score **8.9/10**, for these four clauses as one set. This is not a vote to
implement before all reviewers sign one canonical digest.

Strongest rebuttals:

1. Dual checkpoint gates add a central content/privacy boundary and all-editor
   availability barrier; privacy mode therefore forfeits pruning.
2. Removing `docEpoch` makes Canvas reset depend on ProjectIndex route coordination;
   that is deliberate single ownership but increases recovery latency.
3. Candidate scopes and editor dismissal remain bounded authorized-editor abuse
   surfaces; eliminating them requires stricter admin/content authority.

The score remains above 7 because every residual risk has an explicit threat-model
limit, owner, cap and fail-closed degradation; none creates arrival-order business
state, silent LWW overwrite, or a second Project route authority. The decision
becomes **REJECT** if service content secrecy is mandatory while bounded pruning is
also mandatory, if Canvas may reset outside Project ownership, or if editors are
not allowed to dismiss team-visible generation results.

The detached whole-file SHA-256 is reported in the reviewer handoff.
