# Collaboration v10 R5.6 cross-review docket

Status: root-formatted, non-authoritative architecture review input.

This docket records all independent rejections of the frozen 40,990-byte candidate
with ordinary SHA-256
`ac03cf17facb40e82427735a46f84fa57e848edb5fe13921dcc9f835546c2b81`.
It grants no implementation or promotion permission. The three architecture owners
must cross-review every item and converge on one unconditional correction before a
new candidate is formatted.

## A. Bind ACK authority through owner installation

Origin: collaboration Kernel/Control owner.

The selected port's `A extends RemoteIngressAckAuthorityV2` is not carried through
`RemoteIngressOwnerAckBindingV2`, install evidence, result or receipt. A checkpoint
port can therefore return a null or carrier ACK binding.

Proposed unique correction:

- make `RemoteIngressOwnerAckBindingV2<A>` a conditional mapping from exact `A`;
- parameterize install evidence, result and receipt as `<K, A>`;
- both definition and selected port return
  `RemoteIngressOwnerInstallResultV2<K, A>`;
- before minting the receipt, Kernel compares evidence kind, immutable-object
  digest and ACK-binding kind with the private selected port, object receipt and
  `ackAuthority`;
- add a dedicated mismatch rejection with zero receipt and zero ACK;
- add compile-negative and runtime mismatch falsifiers.

## B. Bind the overlay to an exact valid authority base

Origin: Project/store/URI owner.

The rejected candidate names only rejected R5.4 bytes and therefore has no valid
source for omitted Project, Blob or cutover rules.

Proposed unique correction: declare this correction to be an overlay only on the
exact frozen v10 revision-4 authority set:

```text
main:
5f6a69af82cf71e0f2a2aa609c75e2054e73f556ac72a2aa9154aaa8c1c2165f

Canvas annex:
4a1d7b2362349826ab7df488af7be4d66ed48f49df3aa39f07552235a2fcd530

collaboration-kernel annex:
fc40e646aae952b731450c4b60d2213219be130b4bd90115223afbb74f421691

control-plane annex:
1506c4834295d9d1dfeffc07c0dd2666661af74a659d9271b77b43e5214ecca4

Project-persistence annex:
6c29fefdf52b63f97199e44fb8f7328b85d98be9f15e884c1aff5727bc34d0b6
```

No byte or rule is inherited from rejected R5.4. Every R4 clause not explicitly
replaced remains normative until a complete new five-file authority is generated
and signed.

The overlay must explicitly retain:

- ProjectIndexYDoc is the sole Project catalog, route, tombstone, shardEpoch and
  current blob-reference authority; each CanvasYDoc is sole authority for one
  Canvas; no Project-wide revision, JSON authority or renderer document store;
- Project/node is the only Project-private collaboration-store reader/writer;
- Blob finalization is `prepared -> blob-published -> index-published -> complete`,
  and only complete can ACK;
- unsupported legacy bytes are not dual-read or silently migrated;
- explicit twice-confirmed reset preserves ordinary Project files and stable
  projectId, rotates projectEpoch, atomically replaces the private `.convax` tree,
  creates an empty ProjectIndexYDoc/Canvas catalog and rejects the old epoch;
- ambiguous reset crash recovery is recovery-required.

## C. Add the Project/node sequential-cursor bridge

Origin: Project/store/URI owner.

Kernel owns the branded cursor but cannot read Project-private staging through the
current persistence port.

Proposed unique correction:

```ts
export interface RemoteIngressSequentialCursorPortHandleV2 {
  nextPersistedChunk(): Promise<RemoteIngressByteCursorReadV2>
  closePersistedCursor(): void
}

export type OpenRemoteIngressSequentialCursorPortResultV2 =
  | Readonly<{
      status: "opened"
      handle: RemoteIngressSequentialCursorPortHandleV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "staging-not-complete"
        | "staging-head-stale"
        | "cursor-already-open"
        | "store-corrupt"
    }>
```

`RemoteIngressStagingPersistencePortV2` adds
`openRemoteIngressSequentialCursor(evidence)`. The exact Project/node adapter alone
returns an unbranded handle. Kernel binds its identity to one completed capability,
wraps it and alone mints the cursor brand. Project/node enforces one live handle per
final staging head and exact progression; both sides close on every terminal path.

## D. Make immutable promotion and reservation plain-evidence ports

Origin: Project/store/URI owner.

Project/node currently returns Kernel-owned branded immutable and reservation
receipts.

Proposed unique correction:

- Project/node immutable promotion returns plain
  `RemoteImmutableIngressObjectPortEvidenceV2<K>` containing the stable key,
  manifest and closure digests, reservation and final chunk-set heads, chunk-set
  digest, kind, scope, subject, SHA, length and immutable-object digest;
- Kernel compares all those mirrors with completed, validated and manifest facts,
  then alone registers and mints `RemoteImmutableIngressObjectReceiptV2`;
- the reservation port likewise returns plain durable reservation evidence, and
  Kernel validates before minting the reservation brand;
- mirror mismatch, stale staging, durability failure and corruption reject with no
  receipt or ACK.

## E. Make stale-head quarantine a plain-evidence port

Origin: Project/store/URI owner.

Project/node performs the durable quarantine but must not mint the Kernel-owned
brand.

Proposed unique correction:

```ts
export interface HeadCommitQuarantinePortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly observedAcceptedHeadRecordDigest: DigestV2
  readonly quarantineCommitRecordDigest: DigestV2
  readonly shardDispositionHeadRecordDigest: DigestV2
}
```

The persistence result returns plain committed or quarantined evidence. Kernel
checks the input journal, expected head and reloaded disposition head and alone
mints the appropriate receipt. The final persistence step says “return plain
quarantine port evidence to Kernel”, never “mint”.

## F. Keep GC authorization inside Kernel

Origin: Project/store/URI owner.

Project/node cannot validate Kernel's private live registry, so a branded GC
authorization must not cross the persistence boundary.

Proposed unique correction:

```ts
export interface GarbageCollectFrameObjectPersistenceCommandV2 {
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly secondProofRecordDigest: DigestV2
  readonly secondAcceptedHeadRecordDigest: DigestV2
  readonly secondReferenceIndexHeadRecordDigest: DigestV2
  readonly secondReferenceIndexRootRecordDigest: DigestV2
  readonly secondCoverageRecordDigest: DigestV2
}
```

Kernel validates and atomically consumes both proofs and its internal authorization,
then uses its private persistence port to send the plain command. Project/node
reloads both native records and rechecks the accepted head, index, root, coverage,
all eight source heads, zero references and unreachability. The branded
authorization never crosses the Kernel module boundary.

## G. Make evidence admission linearizable at Project-epoch scope

Origin: Canvas/intent/runtime owner.

A stable-key head cannot atomically enforce member and Project quotas across two
different concurrent stable keys.

Proposed unique correction:

- exactly one admission-ledger head pointer exists per Project epoch;
- its generation is `Uint64V2`, transition is reserve/settle/release, and it records
  the transition record, stable key, source member, manifest and all after-values;
- after-values include monotonic stable-key attempt count, stable-key/member/Project
  charged closure counts, and member/Project accounted byte lengths;
- reserve increments charged counts and bytes; settle changes no counter; release
  decrements charged counts and bytes but never attempt count;
- begin request carries both expected prior Project-epoch head and expected prior
  stable-key record;
- each after-value is recomputed from exact prior head before CAS; CAS succeeds
  before any object write; loser writes no object;
- the stable-key current record comes from the bounded Project-epoch head chain;
  attempt count is monotonic and at most two.

Mandatory concurrency falsifier: two stable keys from one member concurrently ask
for charges whose sum exceeds remaining member or Project quota; at most one
Project-epoch head CAS succeeds and the loser writes zero evidence objects.

## H. Move RSA semantic ownership to the Project reset composer

Origin: Canvas/intent/runtime owner.

Control protocol owns RSA DTO and verifier components but cannot own semantic
validation/install because RSA embeds CGP and depends on Project wanted-root and
currentness.

Proposed unique correction:

- Canvas creates the CGP port through the generic factory using selected Canvas
  runtime and no Project import;
- Project collaboration-protocol creates only registry-page owner port and exports
  the RSA Control validator bundle; it creates no RSA owner port;
- Project reset composer captures exact selected Control verifier bundle, selected
  Canvas runtime, Project wanted-root/currentness capability and typed owner-install
  persistence capability;
- that composer creates the RSA port; its authority identity is the exact branded
  reset authority verifier produced from Control bundle and Canvas runtime;
- Kernel creates checkpoint, validation-suffix, causal-frontier, actor-head-set and
  state-vector ports; Desktop only supplies/selects process capabilities;
- CGP and RSA owner-install receipts cannot ACK until Project verifies the live
  wanted root, editor authority, exact owner identity and install head and consumes
  a Project-private carrier receipt;
- RSA additionally verifies embedded CGP, closure and F13/reset bindings;
- neither Canvas nor collaboration-protocol imports the other; Project is their sole
  composition point.

## I. Add a durable scan fence for quiescent GC progress

Origin: Canvas/intent/runtime owner.

Two scans require strictly increasing store/index generations, but a quiescent
Project has no operation that advances them.

Proposed unique correction:

- add plain `DurableReferenceScanFencePortEvidenceV2` binding first proof, expected
  prior index head, fence commit, resulting index head/generation, unchanged root
  and coverage;
- add `publishDurableReferenceScanFence(firstProofDigest, expectedPriorIndexHead)`
  to the persistence port;
- scan evidence adds `precedingScanFenceCommitRecordDigest`;
- first scan requires null prior and null fence;
- the fence fsyncs a commit bound to first proof and publishes the next index
  generation with unchanged root/count/commitment/coverage;
- second scan names first proof and exact fence commit and has greater index
  generation;
- missing/replaced fence, changed root/coverage or a fence bound to another proof
  deletes zero objects.

Mandatory liveness falsifier: a quiescent zero-reference unreachable frame performs
first scan, exactly one fence, second scan and deletion without unrelated mutation.

## Required cross-review output

Each architecture owner must independently review A through I. For each item return
`APPROVE` or `REJECT` with one unique replacement. Then give one unconditional
overall vote on this correction docket. Conditional approval does not count.

Every response must also state:

- strongest three objections;
- flaw types;
- falsifiable tests;
- a 0–10 score with deductions.
