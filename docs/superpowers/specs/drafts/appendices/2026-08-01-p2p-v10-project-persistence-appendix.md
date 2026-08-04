# Convax P2P Collaboration v10 — Project Persistence Appendix

Status: **normative revision-4 appendix candidate**. This file is designed to enter
the v10 canonical digest set as artifact ref `name="project-persistence"`,
`format="convax.project-persistence-protocol-schema/2"`. Its artifact bytes are the
complete UTF-8 file including final LF; its domain-separated artifact digest and
ordinary whole-file SHA-256 are detached to avoid self-reference. It is not
implementation authority until three independent architecture reviewers sign the
same complete authority set.

The words MUST, MUST NOT, SHOULD and MAY are normative.

## 1. Scope, precedence and owners

This appendix closes only the Project-owned portion of collaboration v10:

- exact `ProjectIndexYDoc` roots, keys, records, projection and typed intents;
- stable Project entry, content-version, URI and blob-reference semantics;
- Project-owned Canvas route and shard-reset persistence, but not Canvas content;
- native object/journal/outbox/head durability and deterministic reopen;
- checkpoint installation, pruning, Project/blob GC and breaking Project reset.

It deliberately does not define Canvas node/edge records, PeerJS messages,
membership/session endpoints, checkpoint attester implementation or cutoff service
storage. Those belong to their separately reviewed owners.

Normative precedence for this appendix is the revision-4 indivisible authority set:

1. the canonical main specification for cross-owner composition;
2. this exact Project artifact for ProjectIndex/native semantics;
3. the exact collaboration-kernel artifact for shared scope/stamp/frame/bundle;
4. the exact Canvas and control-plane artifacts for their owner surfaces;
5. the independently versioned global URI specification for URI semantics only.

Older candidates, reviews, live v9 code and persisted formats are non-normative
evidence and cannot fill a field or choose a fallback decoder.

In particular, older `docEpoch`, sequence-zero, central admission,
`certifiedTeamDoc`, `workingDoc`, `localForkJournal`, JSON mirror and document-wide
version rules are superseded. V10 uses no `docEpoch`, actor sequence starts at
`"1"`, and one durable `replicaDoc` is the local document authority.

Ownership is fixed:

| Owner | Owns here | MUST NOT own here |
| --- | --- | --- |
| `@convax/project-files` | opaque entry/version id codecs and renderer-safe file contracts | id allocation, ProjectIndex, URI resolution, native storage |
| `@convax/project` | ProjectIndex schema/reducer/projection/intents, route/reset semantics, resource proof validation | native paths, fsync, PeerJS, Canvas payload schema |
| `@convax/project/collaboration-protocol` | browser-safe `DocumentShardResetClaimV2` and Project proof DTOs | service adapters, native I/O, Canvas reducers |
| `@convax/collaboration` | generic candidate/frame/checkpoint/journal/snapshot ports | Project records, path policy, blob policy |
| `@convax/project/node` | sole native Project writer, materialization, object/journal/head/outbox/checkpoint/blob/reset adapters | portable winner rules or a second Project catalog |
| `@convax/uri` | stateless URI codec/canonicalization/comparison | resolution, authorization or Project state |

No renderer, Agent, Plugin, Desktop helper or service registry may write private
Project stores or construct raw ProjectIndex Yjs updates. All callers submit the
closed intents in section 7 to the Project application service in Main.

## 2. Canonical scalar and encoding rules

This appendix uses the v10 canonical JCS restrictions: UTF-8 RFC 8785 ordering,
NFC scalar strings, plain objects and dense arrays only, finite JSON numbers only,
and no accessor, symbol, `undefined`, cycle, lone surrogate, `NaN` or infinity.
Unknown keys and unknown union tags fail closed.

```ts
type Id128V2 = string       // unpadded base64url of exactly 16 bytes
type ActorIdV2 = string     // unpadded base64url of exactly 32 bytes
type Uint32V2 = string      // canonical decimal 0..2^32-1
type Uint64V2 = string      // canonical decimal 0..2^64-1
type DigestV2 = string      // exactly 64 lowercase SHA-256 hex
type SignatureV2 = string   // unpadded base64url Ed25519 signature, exactly 64 bytes
type ProjectIdV2 = string   // ^[a-z0-9][a-z0-9_-]{0,95}$
type ProjectFileIdV2 = `pf_${string}`       // suffix exactly 64 lowercase hex
type ProjectDirectoryIdV2 = `pd_${string}`  // suffix exactly 64 lowercase hex
type ProjectEntryIdV2 = ProjectFileIdV2 | ProjectDirectoryIdV2
type ProjectVersionIdV2 = `pv_${string}`    // suffix exactly 64 lowercase hex
type ProjectFactIdV2 = `${"pl" | "pt" | "pp" | "pr" | "cr"}_${string}`
type CanvasIdV2 = import("@convax/collaboration").CanvasIdV2
type MemberIdV2 = import("@convax/collaboration").MemberIdV2
type ReplicaIdV2 = import("@convax/collaboration").ReplicaIdV2
type OwnerCanonicalizerDescriptorV2 =
  import("@convax/collaboration").OwnerCanonicalizerDescriptorV2
```

`CanvasIdV2` is the kernel-owned shared codec `cv_<64 lowercase hex>`. Project
derives it; Canvas identity and Canvas-kind `DocumentScopeV2.docId` store the
byte-identical value. No Id128/base64url Canvas-id alternative exists.

`Uint64V2` rejects leading zero except the value `"0"`, sign, whitespace and
overflow. Set-like arrays are sorted by the stated canonical byte codec and are
duplicate-free. `null` represents absence; empty string, zero and a missing key do
not alias absence.

```ts
type DocumentScopeV2 = import("@convax/collaboration").DocumentScopeV2
type PortableStampV2 = import("@convax/collaboration").PortableStampV2

interface ProjectIndexScopeV2 extends DocumentScopeV2 {
  docKind: "project-index"
  docId: "project-index"
}

```

The imported `PortableStampV2` has exact format
`convax.portable-stamp/2` and a decimal-string `Uint32V2.writeOrdinal`. Project
MUST NOT define a package-local stamp shape.

Portable stamps compare ascending by `(lamport uint64, actorId decoded bytes,
operationId decoded bytes, writeOrdinal uint32)` and select maximum where this file
says `Max`. Machine clock, filesystem order, Yjs client id, Peer arrival and service
sequence are never Project business order.

Project-specific digests are exact:

```text
recordDigest = SHA-256(
  "convax.project-index-record-digest/2\0" || UTF8(record.format) || "\0" || JCS(record))
intentDigest = SHA-256("convax.project-index-intent-digest/2\0" || JCS(intent))
resourceReferenceDigest = SHA-256(
  "convax.project-resource-reference-digest/2\0" || JCS(reference))
routeCasCoreDigest = SHA-256(
  "convax.document-shard-reset-route-cas-core-digest/2\0" || JCS(routeCasCore))
resetClaimCoreDigest = SHA-256(
  "convax.document-shard-reset-claim-core-digest/2\0" || JCS(claimCore))
projectIndexLiveScopeManifestDigest = SHA-256(
  "convax.project-index-live-scope-manifest/2\0" || JCS(manifest))
localStoreRecordDigest = SHA-256(
  "convax.local-project-store-record-digest/2\0" || UTF8(record.format) || "\0" || JCS(record))
```

ASCII domain bytes and NUL separators are literal. Digest fields are omitted only
from the preimage of the wrapper that contains that digest; receivers never choose
another reserialization or generic hash domain.

### 2.1 Operation-derived identities

UI, Agent and Plugin callers never choose a Project entry, version, fact, Canvas or
operation identity. Main allocates the operation id and derives every other id from:

```ts
interface ProjectDerivedIdentityCoreV2 {
  format: "convax.project-derived-identity-core/2"
  scope: ProjectIndexScopeV2
  actorId: ActorIdV2
  operationId: Id128V2
  ordinal: Uint32V2
  kind:
    | "file" | "directory" | "version" | "location" | "tombstone"
    | "promotion" | "reservation" | "canvas" | "route-transition"
}
```

The suffix is
`SHA-256("convax.project-derived-identity/2\0" || JCS(core))`; the prefix follows
the declared kind. A typed intent fixes every ordinal it consumes. Skipped,
duplicated, caller-provided or implementation-selected ordinals are invalid. Two
different origins yielding one derived id are equivocation, not an idempotent retry.

### 2.2 Portable names and paths

A basename is NFC, 1..255 UTF-8 bytes, contains no slash, backslash, NUL or control
character, is not `.` or `..`, has no trailing dot/space, and is not a Windows
reserved device name including superscript aliases. The Project root names
`.convax` and `.convax-conflicts` are reserved case-insensitively. Only the Project
projection may synthesize `.convax-conflicts/**`.

Portable paths use normalized POSIX separators, have no empty, dot or dot-dot
segment and are at most 8 KiB. Native adapters additionally reject filesystem case
or Unicode aliases they cannot represent losslessly; they MUST NOT invent `(1)`
suffixes or locale-dependent winners.

## 3. Exact ProjectIndexYDoc topology

The root token is exactly `convax.project-index.v2`. Genesis precreates exactly
nine root `Y.Map` instances:

```ts
interface ProjectIndexRootV2 {
  identity: Y.Map<unknown>
  entries: Y.Map<unknown>
  entryLocations: Y.Map<unknown>
  entryTombstones: Y.Map<unknown>
  contentFamilies: Y.Map<unknown>
  contentPromotions: Y.Map<unknown>
  pathReservations: Y.Map<unknown>
  canvasRoutes: Y.Map<unknown>
  operations: Y.Map<unknown>
}
```

No other root or shared type is legal. Every map value is one deeply frozen plain
JCS object from the closed unions below; arrays and objects inside a value are JSON,
not nested Yjs shared types. Every non-genesis mutation adds immutable facts under
operation-derived keys. It never deletes or overwrites a prior fact. An existing
key with byte-identical JCS is an idempotent duplicate; different bytes are
equivocation and quarantine the frame.

Exact key codecs are:

```text
identity:            "project"
entries:             <ProjectEntryIdV2>
entryLocations:      "l:" <entryId> ":" <pl_factId>
entryTombstones:     "t:" <entryId> ":" <pt_factId>
contentFamilies:     "v:" <primaryFileId> ":" <versionId>
contentPromotions:   "p:" <primaryFileId> ":" <pp_factId>
pathReservations:   "x:" <pr_factId>
canvasRoutes:        "r:" <canvasId> ":" <cr_factId>
operations:          "o:" <actorId> ":" <operationId>
```

Keys are ASCII, <=256 bytes, and their embedded ids MUST equal the corresponding
value fields. Validators reject a value under the wrong map/key even if its record
is otherwise valid.

### 3.1 Identity

`identity` contains exactly one genesis-written key `project`:

```ts
interface ProjectIndexIdentityRecordV2 {
  format: "convax.project-index-identity/2"
  schema: "convax.project-index.v2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  shardEpoch: Id128V2
  rootDirectoryId: ProjectDirectoryIdV2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  uriProtocolDigest: DigestV2
}
```

The root directory entry exists in `entries`, has provenance `project-root`, and has
no location or tombstone. Identity fields never change inside an epoch. ProjectIndex
corruption or incompatible schema therefore requires whole-Project reset and a new
`projectEpoch`, not a hidden second identity record.

`protocolDigest` is the kernel-instantiated `ProtocolSchemaBundleV2.coreDigest`.
`schemaDigest` is the manifest's domain-separated `project-persistence` artifact
digest, not this file's ordinary SHA-256. `uriProtocolDigest` remains the exact
independently versioned URI protocol digest.

### 3.2 Entry, location and tombstone records

```ts
type ProjectContentPolicyV2 =
  | "none"
  | "immutable"
  | "conflict-preserving-text"
  | "overwritable-binary"

type ProjectStorageClassV2 = "project-file" | "managed-blob"

interface ProjectEntryRecordV2 {
  format: "convax.project-entry/2"
  entryId: ProjectEntryIdV2
  kind: "file" | "directory"
  storageClass: ProjectStorageClassV2 | null // null only for directory
  contentPolicy: ProjectContentPolicyV2
  provenance:
    | "project-root" | "user" | "generated" | "managed-admission"
    | "content-conflict-copy"
  conflictSource: null | {
    primaryFileId: ProjectFileIdV2
    sourceVersionId: ProjectVersionIdV2
    promotionId: ProjectFactIdV2
    reservationId: ProjectFactIdV2
  }
  createdByActorId: ActorIdV2
  createdByOperationId: Id128V2
  createdStamp: PortableStampV2
}

interface ProjectEntryLocationClaimV2 {
  format: "convax.project-entry-location/2"
  claimId: ProjectFactIdV2 // pl_...
  entryId: ProjectEntryIdV2
  state: "linked" | "declared-missing"
  parentDirectoryId: ProjectDirectoryIdV2
  basename: string
  reason: "create" | "move" | "rename" | "explicit-relink" | "explicit-missing"
  stamp: PortableStampV2
}

interface ProjectEntryTombstoneV2 {
  format: "convax.project-entry-tombstone/2"
  tombstoneId: ProjectFactIdV2 // pt_...
  entryId: ProjectEntryIdV2
  reason: "explicit-delete"
  observedEntryDigest: DigestV2
  stamp: PortableStampV2
}
```

Directory records require `contentPolicy="none"`, `storageClass=null`; file records
require one non-`none` policy and a storage class. `managed-blob` files have no
normal location claim. A content-conflict-copy is dormant until section 5 promotes
it; it may then receive ordinary explicit location claims.

Tombstones are grow-only and dominate every current or late location/version fact.
Restoration creates a new entry id. External watcher events are invalidation only;
they never create `declared-missing`, relink, tombstone or identity facts.

For a live entry, current explicit location is `Max(stamp)` over its valid claims.
`declared-missing` preserves the stable id and last linked hint but materializes no
file. Missing/non-directory parents project below
`.convax-conflicts/orphans/<entry-id>/content`. Every directory in a cyclic parent
SCC projects below
`.convax-conflicts/directory-cycles/<entry-id>/content`; no relation is deleted.

For each resolved parent and basename, the path-claim winner is maximum by
`(location stamp, entryId ASCII bytes)`. Every loser and its non-conflicting
descendants project below
`.convax-conflicts/path-claims/<entry-id>/content`. This rule uses portable
normalized names; a native-only alias collision makes the Project
`unsupported-native-path/read-only` instead of choosing another winner.

### 3.3 Content, promotion, reservation and resource records

```ts
interface ProjectBlobRefV2 {
  format: "convax.blob-ref/2"
  algorithm: "sha256"
  digest: DigestV2
  byteLength: Uint64V2
  mime: string // lowercase type/subtype, ASCII, 1..255 bytes
}

interface ProjectContentVersionRecordV2 {
  format: "convax.project-content-version/2"
  primaryFileId: ProjectFileIdV2
  versionId: ProjectVersionIdV2
  writeClass: "initial" | "text-write" | "binary-overwrite"
  blob: ProjectBlobRefV2
  canonicalRevisionUri: string
  supersedesVersionIds: ProjectVersionIdV2[] // sorted unique, 0..256
  binaryLogicalCounter: Uint64V2 | null
  creatorActorId: ActorIdV2
  creatorOperationId: Id128V2
  stamp: PortableStampV2
}

interface ProjectContentPromotionRecordV2 {
  format: "convax.project-content-promotion/2"
  promotionId: ProjectFactIdV2 // pp_...
  primaryFileId: ProjectFileIdV2
  versionId: ProjectVersionIdV2
  reservedConflictFileId: ProjectFileIdV2
  reservationId: ProjectFactIdV2
  stamp: PortableStampV2
}

interface ProjectPathReservationRecordV2 {
  format: "convax.project-path-reservation/2"
  reservationId: ProjectFactIdV2 // pr_...
  kind: "content-conflict-copy"
  primaryFileId: ProjectFileIdV2
  versionId: ProjectVersionIdV2
  reservedEntryId: ProjectFileIdV2
  canonicalPath: string // exactly .convax-conflicts/<entry-id>/content
  originalBasenameHint: string
  stamp: PortableStampV2
}

interface ProjectResourceReferenceV2 {
  format: "convax.project-resource-reference/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  entryFileId: ProjectFileIdV2
  familyPrimaryFileId: ProjectFileIdV2
  versionId: ProjectVersionIdV2
  canonicalUri: string
  blob: ProjectBlobRefV2
  versionRecordDigest: DigestV2
}

interface ProjectResourceCausalProofV2 {
  format: "convax.project-resource-causal-proof/2"
  projectIndexScope: ProjectIndexScopeV2
  projectIndexFrontierDigest: DigestV2
  projectIndexStateVectorDigest: DigestV2
  reference: ProjectResourceReferenceV2
  referenceDigest: DigestV2
  proofMode: "current" | "retained-history"
}
```

The URI is the global canonical form:
`convax-project://<projectId>/epochs/<projectEpoch>/entries/<entryFileId>` with an
optional canonical `path` hint and required `blob=sha256:<digest>` for a revision
reference. Its authority remains opaque case-sensitive. URI entry id, epoch and blob
MUST equal the enclosing reference. A reference is one atomic JSON/Yjs value; its
identity, path hint and blob pin are never split into independently writable keys.
Each version record URI names its `primaryFileId` and exact blob. A promoted conflict
reference names the stable conflict-copy `entryFileId` while retaining the same
`familyPrimaryFileId`, `versionId`, blob and version-record digest.

`ProjectResourceCausalProofV2` is portable and binds an exact reconstructible
ProjectIndex base. A Main-only `LocalBlobAdmissionTokenV2` separately proves that
the native bytes, blob index and required directories were hash-verified and fsynced
before the ProjectIndex candidate is signed. That token is process-local,
non-serializable and MUST NOT enter an intent, Y.Doc, frame, URI, ACK or log.

For `proofMode="current"`, validation requires a live entry and exact current
version, or an active conflict-copy entry and its bound source version. For
`proofMode="retained-history"`, the current projection may differ, but the caller
must supply an owner-verified semantic-history, suppressed-generation, recovery or
undo retention root from the causal frame context. This mode cannot authorize an
ordinary new file open/write or bypass current ProjectIndex liveness. Missing exact
frontier, version record, retention root or matching blob leaves the dependent frame
pending; a newer ProjectIndex snapshot is not a substitute.

### 3.4 Content projection

For every primary file, version edges point from a version to the exact live version
ids it superseded in its authored base. A cycle, cross-family edge, missing version,
duplicate edge or policy-incompatible write is invalid.

An `initial` record has empty `supersedesVersionIds`; a text write has 1..256 exact
base live heads and `binaryLogicalCounter=null`. An overwritable-binary initial
record uses counter `"0"`; each overwrite cites the exact observed current version
and increments its observed maximum counter by one. Every other counter shape is
invalid.

- `immutable`: exactly one `initial` version is legal. Updating content creates a
  new file id and family.
- `overwritable-binary`: current is maximum by
  `(binaryLogicalCounter uint64, creatorActorId decoded bytes, versionId ASCII)`.
  A write counter is one plus the maximum observed counter in its exact base.
  Losing versions remain causal receipts but are not file-history or blob-GC roots.
- `conflict-preserving-text`: live heads are versions not superseded by any accepted
  descendant. Primary current is `Max(stamp)` among live heads. Every non-primary
  live head is materialized through its preallocated promotion/reservation. To avoid
  later silent loss, a reserved conflict copy remains active once its source version
  is proven incomparable with a higher-stamped version in the immutable version DAG,
  even after a later version supersedes both. This conservative rule may retain more
  copies but never removes a human branch silently.

Each text write preallocates exactly one conflict-copy file id, entry record,
promotion and reservation in the same transaction. Sequential writes leave that
copy dormant. Projection never invents an id or file after merge. A moved active
conflict copy uses its explicit location; otherwise it uses its fixed reserved path.

### 3.5 Canvas route facts

`canvasRoutes` values use this closed union:

```ts
type CanvasRouteFactV2 =
  | CanvasRouteStageV2
  | CanvasRouteActivationV2
  | CanvasRouteMetadataClaimV2
  | CanvasRouteResetCommitV2
  | CanvasRouteTombstoneV2

interface CanvasRouteStageV2 {
  format: "convax.canvas-route-stage/2"
  transitionId: ProjectFactIdV2 // cr_...
  canvasId: CanvasIdV2
  shardEpoch: Id128V2
  title: string // NFC, 1..512 UTF-8 bytes
  reason: "create"
  stamp: PortableStampV2
}

interface CanvasRouteActivationV2 {
  format: "convax.canvas-route-activation/2"
  transitionId: ProjectFactIdV2
  canvasId: CanvasIdV2
  shardEpoch: Id128V2
  predecessorActivationDigest: null
  stageRecordDigest: DigestV2
  canvasGenesisCheckpointDigest: DigestV2
  stagedProjectIndexFrontierDigest: DigestV2
  stamp: PortableStampV2
}

interface CanvasRouteMetadataClaimV2 {
  format: "convax.canvas-route-metadata/2"
  transitionId: ProjectFactIdV2
  canvasId: CanvasIdV2
  title: string
  observedActivationDigest: DigestV2
  stamp: PortableStampV2
}

interface CanvasRouteResetCommitV2 {
  format: "convax.canvas-route-reset-commit/2"
  transitionId: ProjectFactIdV2
  canvasId: CanvasIdV2
  oldShardEpoch: Id128V2
  newShardEpoch: Id128V2
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointDigest: DigestV2
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  routeCasCoreDigest: DigestV2
  stamp: PortableStampV2
}

interface CanvasRouteTombstoneV2 {
  format: "convax.canvas-route-tombstone/2"
  transitionId: ProjectFactIdV2
  canvasId: CanvasIdV2
  observedActivationDigest: DigestV2 | null
  reason: "explicit-delete"
  stamp: PortableStampV2
}
```

A stage without activation is `staged` and invisible to fresh clients. Initial
activation must bind the exact stage, exact ProjectIndex frontier observed by the
Canvas genesis and exact genesis checkpoint. Reset commits must validate section 8.
Among valid activation/reset facts, current route is `Max(stamp)`; competing reset
claims never expose two live shards, and every losing staged shard remains recovery
bytes. A tombstone fact dominates every stage, activation, reset and late Canvas
frame. Delete/recreate allocates a new Canvas id; it never clears a tombstone.

Current title is `Max(stamp)` among metadata claims whose observed activation is in
the current route ancestry, falling back to the stage title. ProjectIndex never
stores `activeCanvasId`, React state or service registry state.

### 3.6 Content-certified live-scope manifest for pending editors

ProjectIndex, not the service registry, is the sole completeness owner for current
Canvas routes. The Project public verifier derives this exact immutable manifest
from one content-certified ProjectIndex checkpoint:

```ts
interface ProjectIndexLiveCanvasScopeEntryV2 {
  canvasId: CanvasIdV2
  scope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  currentActivationDigest: DigestV2
  routeProjectionDigest: DigestV2
}

interface ProjectIndexLiveScopeManifestV2 {
  format: "convax.project-index-live-scope-manifest/2"
  projectIndexScope: ProjectIndexScopeV2
  projectIndexCheckpointDigest: DigestV2
  projectIndexContentCertificateDigest: DigestV2
  projectIndexCanonicalStateDigest: DigestV2
  projectIndexFrontierDigest: DigestV2
  entries: readonly ProjectIndexLiveCanvasScopeEntryV2[]
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
}
```

Entries are the exact current `live`, non-tombstoned Canvas route projection of the
certified ProjectIndex state. Staged, tombstoned, losing-reset and recovery-only
routes are absent. Entries sort strictly by exact JCS `scope`, are duplicate-free,
number at most 4,095 and require `canvasId === scope.docId`. The activation digest
is the current activation/reset fact digest; the route projection digest binds its
complete owner-canonical projection. Manifest digest uses
`convax.project-index-live-scope-manifest/2`.

For a pending replica, the required Project-wide floor set is exactly:

```text
{ projectIndexScope } union manifest.entries[*].scope
```

The control-owned `ReplicaProjectFloorRootV2` binds the manifest digest and pages
must cover that set byte-for-byte with the target replica's exact floor ACK and
prunable certificate per scope. `registrySequence`/`registryRootDigest` are only an
anti-rollback observation. Registry absence, candidate, abandonment or
dual-validation MUST NOT add/remove a required scope, grant edit authority or block
activation. Registry-only entries MAY be advisory prefetch hints but do not count
toward floor entryCount and missing advisory bytes do not deny activation.

The editor-activation transaction transiently revalidates the exact content
certificate, manifest and current ProjectIndex route projection. Any route
activation, tombstone or reset after the manifest makes the root stale and requires
a new manifest/root. A manifest omitting one current live route or including one
registry-only/tombstoned route as required is invalid. This clause is the 3/3 signed
resolution of the registry-hidden-authority review blocker.

### 3.7 Operation receipts

```ts
interface ProjectOperationReceiptV2 {
  format: "convax.project-operation-receipt/2"
  actorId: ActorIdV2
  operationId: Id128V2
  intentKind: ProjectIndexIntentKindV2
  intentDigest: DigestV2
  allocatedIds: string[] // ASCII sorted unique, 0..8
  firstWriteOrdinal: Uint32V2
  writeCount: Uint32V2 // 1..512
  stampLamport: Uint64V2
}
```

The receipt is written in the same Yjs transaction as its operation and is never a
document-wide revision. Exact duplicate lookup returns the already durable frame;
same `{actorId,operationId}` with another intent/request/id set is equivocation.

## 4. Closed validation and canonical projection

The Project validator checks, before acceptance or ACK:

1. exact root names/shared types and genesis identity;
2. every key/value codec, record digest and operation-derived identity;
3. immutable append-only facts and operation receipt equality;
4. entry kind/policy/storage/provenance constraints;
5. parent validity, reserved namespace and deterministic path projection;
6. version DAG, policy, supersedes, URI and blob equality;
7. route stage/activation/reset/tombstone dependencies;
8. intent guard/body and exact allowed semantic write set;
9. state-vector, owner-canonical pre/post hashes and generic causal-frame proofs.

### 4.1 Project canonicalizer binding

The Project artifact MUST define this constructor, where `schemaDigest` is supplied
from its selected artifact ref after artifact computation:

```ts
function projectIndexCanonicalizerDescriptorV2(
  schemaDigest: DigestV2,
): OwnerCanonicalizerDescriptorV2 {
  return {
    format: "convax.owner-canonicalizer-descriptor/2",
    owner: "project-index",
    ownerSchemaDigest: schemaDigest,
    canonicalStateFormat: "convax.project-index-canonical-state/2",
    canonicalStateCodec: "restricted-jcs-utf8",
    exactBytePolicy: "parse-reencode-byte-equal",
    unknownStatePolicy: "reject",
  }
}
```

The Project owner port's `schemaDigest`, descriptor `ownerSchemaDigest`,
`ProjectIndexIdentityRecordV2.schemaDigest`, selected Project artifact digest and
frame `ownerSchemaDigest` MUST be byte-equal. Its `canonicalizerDigest` MUST be the
collaboration-kernel canonicalizer-descriptor digest of exactly this constructed
descriptor.

This constructor is an artifact-digest template, not executable source identity.
Whitespace, function names and implementation language never enter the digest.

### 4.2 `ProjectCanonicalStateV2` and nine-root byte encoding

#### 4.2.1 Exact closed value

The exact Project owner canonical-state value is:

```ts
type ProjectCanonicalEntryV2<T> = readonly [key: string, value: T]

interface ProjectCanonicalStateV2 {
  format: "convax.project-index-canonical-state/2"
  identity: readonly [
    readonly ["project", ProjectIndexIdentityRecordV2],
  ]
  entries: readonly ProjectCanonicalEntryV2<ProjectEntryRecordV2>[]
  entryLocations: readonly ProjectCanonicalEntryV2<ProjectEntryLocationClaimV2>[]
  entryTombstones: readonly ProjectCanonicalEntryV2<ProjectEntryTombstoneV2>[]
  contentFamilies: readonly ProjectCanonicalEntryV2<ProjectContentVersionRecordV2>[]
  contentPromotions: readonly ProjectCanonicalEntryV2<ProjectContentPromotionRecordV2>[]
  pathReservations: readonly ProjectCanonicalEntryV2<ProjectPathReservationRecordV2>[]
  canvasRoutes: readonly ProjectCanonicalEntryV2<CanvasRouteFactV2>[]
  operations: readonly ProjectCanonicalEntryV2<ProjectOperationReceiptV2>[]
}
```

There are exactly ten top-level fields: `format` and one slot for each of the exact
nine ProjectIndex root maps. No `roots` wrapper, metadata side channel, derived
projection, native path, state vector, Yjs client id or document version is present.

#### 4.2.2 Root/map/slot matrix

The mapping is exact:

| Y.Doc root | Required Yjs type | Canonical slot | Slot key codec | Exact value |
| --- | --- | --- | --- | --- |
| `identity` | `Y.Map` | `identity` | literal `project` | `ProjectIndexIdentityRecordV2` |
| `entries` | `Y.Map` | `entries` | `<ProjectEntryIdV2>` | `ProjectEntryRecordV2` |
| `entryLocations` | `Y.Map` | `entryLocations` | `l:<entryId>:<pl_factId>` | `ProjectEntryLocationClaimV2` |
| `entryTombstones` | `Y.Map` | `entryTombstones` | `t:<entryId>:<pt_factId>` | `ProjectEntryTombstoneV2` |
| `contentFamilies` | `Y.Map` | `contentFamilies` | `v:<primaryFileId>:<versionId>` | `ProjectContentVersionRecordV2` |
| `contentPromotions` | `Y.Map` | `contentPromotions` | `p:<primaryFileId>:<pp_factId>` | `ProjectContentPromotionRecordV2` |
| `pathReservations` | `Y.Map` | `pathReservations` | `x:<pr_factId>` | `ProjectPathReservationRecordV2` |
| `canvasRoutes` | `Y.Map` | `canvasRoutes` | `r:<canvasId>:<cr_factId>` | `CanvasRouteFactV2` |
| `operations` | `Y.Map` | `operations` | `o:<actorId>:<operationId>` | `ProjectOperationReceiptV2` |

Every root exists even when its canonical slot is empty. `identity` has exactly one
entry. `entries` contains at least the exact root-directory record. At genesis all
other slots are `[]`; absence of a root is not an empty map. No nested Yjs shared
type is legal in a value. Objects and arrays inside a record are plain restricted
JCS values.

For every slot:

1. validate the Yjs root type, exact key grammar, key/value embedded-id equality,
   exact closed record and every owner invariant;
2. copy the key as its canonical JSON string and the value as an ordinary deeply
   immutable JSON value;
3. sort tuples strictly by raw UTF-8 bytes of the key string;
4. reject duplicate key bytes, a non-ASCII Project key, a key over 256 bytes, an
   invalid value or an unrepresentable scalar;
5. emit `[]` for an empty map, retain every required `null`, retain dense-array
   order unless the record schema declares a set, and never synthesize a missing
   field or normalize a business value after validation.

`UTF8-key` in the old prose means the ordering codec; the JSON tuple's first item is
the key string, not a byte array, base64 value or implementation object.

#### 4.2.3 Exact bytes and sole canonical digest

```text
projectCanonicalStateBytes = UTF8(JCS(exact ProjectCanonicalStateV2))

projectIndexCanonicalStateDigest = SHA-256(
  UTF8("convax.canonical-state/2") || 0x00 ||
  decoded-32-byte(projectOwnerSchemaDigest) || 0x00 ||
  projectCanonicalStateBytes
)
```

Every field named `projectIndexCanonicalStateDigest` in Project reset manifests,
live-scope manifests, checkpoint certificates or control rollover evidence MUST use
this kernel-owned digest. The private formula
`SHA-256("convax.project-index-canonical-state/2\0" || ...)` is deleted. The string
`convax.project-index-canonical-state/2` remains only the exact JCS `format` and
descriptor value; it is no longer a digest domain.

Two Y.Docs with different Yjs struct order, client ids, deleted internal structs or
update histories but the same nine logical maps MUST yield byte-identical canonical
state. Different accepted map content MUST change the bytes. State vectors and full
update digests remain separately bound and do not enter this value.

#### 4.2.4 Exact genesis identity

V2 defines no parallel `projectGenesisDigest`. An exact ProjectIndex genesis is the
`ProjectCanonicalStateV2` that satisfies all of these predicates:

- `identity` has the one exact `project` record for the new scope and selected
  protocol/schema/URI digests;
- `entries` has exactly the root-directory entry named by identity, with provenance
  `project-root`, directory policy/storage invariants and no other entry;
- the remaining six fact maps and `operations` are empty arrays;
- the root directory has no location or tombstone fact.

The **genesis digest is exactly the section 4.2.3 canonical-state digest of that
value**. `EmptyProjectIndexGenesisAttestationCoreV2.canonicalStateDigest`,
`ProjectResetManifestV2.emptyProjectIndexCanonicalStateDigest` and
`TeamEpochRolloverReceiptCoreV2.emptyProjectIndexCanonicalStateDigest` MUST all equal
it. A separate Project genesis domain or hash alias is forbidden because it would
restore the duplicate-authority defect.

### 4.3 Project derived-digest ledger

This section replaces every undefined phrase such as "projection digest",
"version digest" or "exact value digest". All cores below are closed, restricted
JCS values. Unknown fields/tags reject. Digest arrays sort strictly by decoded
32-byte digest; id arrays sort by the id's existing canonical byte codec. A tuple
array is duplicate-free and sorted by its first item unless explicitly stated
otherwise.

#### 4.3.1 Existing record, intent and reset digests retained

`projectIndexRecordDigest(record)` remains:

```text
SHA-256(
  UTF8("convax.project-index-record-digest/2") || 0x00 ||
  UTF8(record.format) || 0x00 || JCS(exact record)
)
```

Its closed input union is exactly identity, entry, location, tombstone, content
version, promotion, reservation, every `CanvasRouteFactV2`, and operation receipt.
Consequently:

- `entryDigest` and `directory entryDigest` are the record digest of their entry;
- `versionRecordDigest` is the record digest of the exact
  `ProjectContentVersionRecordV2`;
- stage, activation, metadata, reset-commit and route-tombstone record digests use
  the same function;
- `resetCommit.resetClaimCoreDigest`, confirmation/approval digests and route-CAS
  digests remain separate explicit references and never replace the reset-commit
  record digest.

The existing intent, resource-reference, route-CAS core, reset-claim core,
reset-claim signature, live-scope manifest and local-store formulas remain unchanged
except where this revision explicitly changes a field type or canonical-state
value.

#### 4.3.2 Entry-location projection

```ts
type ProjectEntryLocationCauseV2 =
  | "entry-absent"
  | "entry-tombstoned"
  | "project-root"
  | "dormant-content-conflict"
  | "managed-blob"
  | "selected-declared-missing"
  | "linked-ordinary"
  | "linked-orphan"
  | "linked-directory-cycle"
  | "linked-path-claim-loser"
  | "linked-under-path-claim-loser"
  | "active-conflict-reservation-no-explicit"
  | "active-conflict-reservation-after-declared-missing"

interface ProjectEntryLocationOutcomeValueV2 {
  format: "convax.project-entry-location-projection/2"
  entryId: ProjectEntryIdV2
  entryRecordDigest: DigestV2 | null
  tombstoneRecordDigests: readonly DigestV2[]
  selectedLocationRecordDigest: DigestV2 | null
  state:
    | "absent"
    | "dormant-conflict"
    | "live-linked"
    | "live-declared-missing"
    | "live-managed-unlocated"
    | "conflict-path"
    | "tombstoned"
  cause: ProjectEntryLocationCauseV2
  portablePath: string | null
  pathClaimWinnerEntryId: ProjectEntryIdV2 | null
}

interface ProjectEntryLocationProjectionV2
  extends ProjectEntryLocationOutcomeValueV2 {
  resolutionDependencyRecordDigests: readonly DigestV2[]
}

type ProjectEntryLocationCounterfactualOutcomeV2 =
  | {
      format: "convax.project-entry-location-counterfactual-outcome/2"
      status: "valid"
      projection: ProjectEntryLocationOutcomeValueV2
    }
  | {
      format: "convax.project-entry-location-counterfactual-outcome/2"
      status: "invalid"
      entryId: ProjectEntryIdV2
      reason: "accepted-record-removal-invalidated-resolution"
    }
```

`entryRecordDigest` is null exactly for `entry-absent`; otherwise it is the section
6.1 record digest. `tombstoneRecordDigests` contains every accepted tombstone for
this entry, sorted by decoded digest; it is non-empty exactly for
`entry-tombstoned`. A dominant tombstone suppresses selected location and resolution
dependencies, so later location facts cannot perturb the tombstoned projection.

The resolver first selects `Max(stamp)` among this entry's valid explicit location
claims, then evaluates parent liveness/kind, directory SCCs and path claims in that
order. For a path-claim branch it walks root-to-entry and the first losing segment is
the controlling loser; its winning competitor is the controlling winner. Once a
branch has entered that conflict subtree, non-conflicting descendants retain that
same controlling loser/winner and append their normalized relative suffix. A later
losing segment cannot move the branch to another conflict root. This precedence is
part of the total function, not an implementation traversal choice.

The exact state-by-cause table is:

| Cause | Exact precondition | `state` | `selectedLocationRecordDigest` | `portablePath` | `pathClaimWinnerEntryId` |
| --- | --- | --- | --- | --- | --- |
| `entry-absent` | no entry record | `absent` | null | null | null |
| `entry-tombstoned` | entry exists and at least one valid tombstone exists | `tombstoned` | null | null | null |
| `project-root` | the exact identity-named root directory, with no location/tombstone | `live-linked` | null | the empty Project-relative path `""` | null |
| `dormant-content-conflict` | exact preallocated conflict entry exists but its promotion is not active and it has no explicit location | `dormant-conflict` | null | null | null |
| `managed-blob` | live non-conflict file has `storageClass="managed-blob"` and no location | `live-managed-unlocated` | null | null | null |
| `selected-declared-missing` | live ordinary entry's selected explicit claim is `declared-missing` | `live-declared-missing` | selected claim digest | null | null |
| `linked-ordinary` | selected linked claim has a live acyclic directory chain and this entry wins every segment | `live-linked` | selected claim digest | exact ordinary normalized Project-relative path | this `entryId` |
| `linked-orphan` | selected linked chain first reaches an absent, tombstoned or non-directory parent | `conflict-path` | selected claim digest | exact `.convax-conflicts/orphans/<entry-id>/content` path | null |
| `linked-directory-cycle` | selected linked chain enters a directory-parent SCC | `conflict-path` | selected claim digest | exact `.convax-conflicts/directory-cycles/<entry-id>/content` path | null |
| `linked-path-claim-loser` | this entry is the first losing segment | `conflict-path` | selected claim digest | `.convax-conflicts/path-claims/<entry-id>/content` | exact winning competitor entry id |
| `linked-under-path-claim-loser` | an ancestor is the first losing segment | `conflict-path` | selected claim digest | controlling loser's conflict root plus the exact normalized descendant suffix | controlling ancestor's exact winning competitor entry id |
| `active-conflict-reservation-no-explicit` | conflict promotion is active and the reserved entry has no explicit claim | `conflict-path` | null | exact reservation `canonicalPath` | null |
| `active-conflict-reservation-after-declared-missing` | conflict promotion is active and its selected explicit claim is `declared-missing` | `conflict-path` | selected claim digest | exact reservation `canonicalPath` | null |

A live non-root ordinary entry with neither a selected location nor a legal active
conflict reservation is invalid. A dormant conflict entry with an explicit location
is invalid. An active conflict entry with a selected `linked` claim uses one of the
four `linked-*` causes; the conflict projection calls that an explicit path even
when native materialization lies below `.convax-conflicts/**`.

`resolutionDependencyRecordDigests` is selected by one pure counterfactual function,
not by an implementation's trace. Let `F` be the accepted immutable Project record
set. `ResolveCounterfactualOutcome(e,S)` always returns the exact closed,
JCS-serializable tagged union above: `status="valid"` carries the exact projection
value without its dependency array; `status="invalid"` carries exactly the shown
entry id and fixed reason. There is no symbol, exception, omitted value, internal
sentinel or implementation-specific error in the comparison domain. The accepted
base `ResolveCounterfactualOutcome(e,F)` MUST be valid; otherwise the Project record
set is invalid before any dependency digest is computed.

Resolution remains scoped to `e`. A malformed relation in an unrelated branch is
ignored for this comparison, while a relation transitively consulted to resolve `e`
must either produce one valid state-by-cause row or the exact invalid variant. The
counterfactual format is comparison-only schema data: it is not stored in Yjs, is not
a digest preimage domain and adds no domain-registry entry.

Construct `Candidates(e,F)` from every record in `entries`, `entryLocations`,
`entryTombstones`, `contentFamilies`, `contentPromotions` and `pathReservations`,
except `e`'s own entry record and own tombstones because their digests already occupy
dedicated fields. Sort candidates by `(root name UTF-8, root key UTF-8, decoded
record digest)` and reject duplicate record digests. Define exact comparison bytes
and the dependency set as:

```text
CounterfactualBytes(e,S) =
  UTF8(JCS(ResolveCounterfactualOutcome(e,S)))

resolutionDependencyRecordDigests(e,F) = SortDecodedDigestUnique([
  recordDigest(r)
  for r in Candidates(e,F)
  if CounterfactualBytes(e, F without exactly r)
       != CounterfactualBytes(e,F)
])
```

Removal is by exact root/key/value identity, never by digest-wide deletion. The
valid comparison includes `cause`, selected-location digest, state, path and winner
id but not the dependency array being computed, so it is acyclic. Removing an
ancestor entry is evaluated as an absent parent and therefore produces the valid
`linked-orphan` row when that is the first loss; because it differs from the valid
base, that ancestor digest is included. Removing a selected claim first reruns
`Max(stamp)` over the remaining valid claims. A fallback claim produces its exact
valid row; no legal fallback for a live ordinary entry produces the closed invalid
variant. Both differ from the base and include the removed selected-claim digest.
Removing a transitively required ancestor claim, promotion, reservation or version-
DAG record likewise produces either its uniquely determined valid row or the closed
invalid variant; either differing value includes that exact removed digest. A direct
or inherited losing claim and the exact claim that beats it are included when their
individual removal changes the outcome. An unrelated loser, obsolete non-selected
claim or unrelated branch is excluded because its removal leaves the tagged JCS
bytes unchanged. An implementation MUST NOT serialize or compare an invalid value as
`ProjectEntryLocationOutcomeValueV2`.

```text
SHA-256(UTF8("convax.project-entry-location-projection/2") || 0x00 || JCS(value))
```

`ProjectGuardAtomV2.kind="entry-location".projectionDigest` MUST equal this digest.

#### 4.3.3 Conflict and content-family projections

```ts
interface ProjectConflictProjectionV2 {
  format: "convax.project-conflict-projection/2"
  primaryFileId: ProjectFileIdV2
  sourceVersionId: ProjectVersionIdV2
  sourceVersionRecordDigest: DigestV2
  promotionRecordDigest: DigestV2
  reservationRecordDigest: DigestV2
  reservedEntryId: ProjectFileIdV2
  reservedEntryRecordDigest: DigestV2
  reservedEntryLocationProjectionDigest: DigestV2 | null
  state: "dormant" | "active-reserved-path" | "active-explicit-path" | "tombstoned"
  cause:
    | "promotion-dormant"
    | "active-reservation-no-explicit"
    | "active-reservation-after-declared-missing"
    | "active-explicit-location"
    | "reserved-entry-tombstoned"
  materializedPath: string | null
}

interface ProjectContentFamilyProjectionV2 {
  format: "convax.project-content-family-projection/2"
  primaryFileId: ProjectFileIdV2
  primaryEntryRecordDigest: DigestV2 | null
  contentPolicy: ProjectContentPolicyV2 | null
  versions: readonly (readonly [ProjectVersionIdV2, DigestV2])[]
  liveHeadVersionIds: readonly ProjectVersionIdV2[]
  currentVersionId: ProjectVersionIdV2 | null
  activeConflictProjectionDigests: readonly DigestV2[]
}
```

Every `versions` digest is the section 4.3.1 version-record digest. Conflict records
must cross-bind all ids and records. The conflict projection is a total function of
the immutable version DAG, promotion, reservation, reserved entry and the section
6.2 location projection:

| Cause | Exact precondition | `state` | `reservedEntryLocationProjectionDigest` | `materializedPath` |
| --- | --- | --- | --- | --- |
| `promotion-dormant` | the source branch has not met the immutable-DAG activation predicate and the reserved entry is not tombstoned | `dormant` | null | null |
| `active-reservation-no-explicit` | activation predicate holds; reserved entry is live with no explicit location | `active-reserved-path` | digest of the `active-conflict-reservation-no-explicit` location projection | exact reservation `canonicalPath` |
| `active-reservation-after-declared-missing` | activation predicate holds; selected explicit location is `declared-missing` | `active-reserved-path` | digest of the `active-conflict-reservation-after-declared-missing` location projection | exact reservation `canonicalPath` |
| `active-explicit-location` | activation predicate holds; selected explicit location is `linked` | `active-explicit-path` | digest of the exact resulting `linked-*` location projection | that projection's exact non-null `portablePath` |
| `reserved-entry-tombstoned` | any valid reserved-entry tombstone dominates | `tombstoned` | digest of the exact `entry-tombstoned` location projection | null |

An absent/cross-bound reserved entry, wrong reservation path, dormant entry with an
explicit claim, active entry with another location cause, null digest in a non-
dormant row or digest/path mismatch is invalid. This table makes the reserved-entry
location digest null exactly for `dormant`; tombstoned conflict state remains bound
to the exact sorted tombstone set through its non-null location projection. A
primary tombstone leaves retained version/conflict facts in the projection but makes
`currentVersionId` null.

Digests are respectively:

```text
SHA-256(UTF8("convax.project-conflict-projection/2") || 0x00 || JCS(conflict))
SHA-256(UTF8("convax.project-content-family-projection/2") || 0x00 || JCS(family))
```

`ProjectGuardAtomV2.kind="family-live-heads"` MUST carry the exact
`liveHeadVersionIds` from the value and its `projectionDigest` MUST be the
content-family digest. It is invalid to hash only the winner or to use Yjs iteration
order.

#### 4.3.4 File projection

```ts
interface ProjectFileProjectionV2 {
  format: "convax.project-file-projection/2"
  entryFileId: ProjectFileIdV2
  entryRecordDigest: DigestV2 | null
  locationProjectionDigest: DigestV2
  state:
    | "absent"
    | "dormant-conflict"
    | "live-linked"
    | "live-declared-missing"
    | "live-managed-unlocated"
    | "conflict-path"
    | "tombstoned"
  familyPrimaryFileId: ProjectFileIdV2 | null
  contentFamilyProjectionDigest: DigestV2 | null
  currentResourceReferenceDigest: DigestV2 | null
  activeConflictProjectionDigests: readonly DigestV2[]
}
```

The file projection is an aggregate, not a store. It is defined only for a
`ProjectFileIdV2`; resolving a directory or Project root through this type rejects.
A **primary** row has a live non-`content-conflict-copy` file entry. An **active
conflict-copy** row has `provenance="content-conflict-copy"`, byte-equal
`conflictSource` cross-bindings, and exactly one matching conflict projection in
`active-reserved-path` or `active-explicit-path` state. The following table is the
complete `ProjectEntryLocationProjectionV2.state` by admissible file role function;
any unlisted pair rejects:

| Entry-location state | Admissible file role | File `state` | `entryRecordDigest` | `familyPrimaryFileId` | `contentFamilyProjectionDigest` | `currentResourceReferenceDigest` | `activeConflictProjectionDigests` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `absent` | no entry record | `absent` | null | null | null | null | `[]` |
| `dormant-conflict` | dormant conflict-copy only | `dormant-conflict` | exact location `entryRecordDigest` | null | null | null | `[]` |
| `live-linked` | primary | `live-linked` | exact location `entryRecordDigest` | `entryFileId` | exact primary family projection digest | exact current primary resource-reference digest | exact primary family active-conflict digest array |
| `live-linked` | active conflict-copy | `live-linked` | exact location `entryRecordDigest` | exact `conflictSource.primaryFileId` | exact source family projection digest | exact resource-reference digest for the bound source version and this conflict-copy entry id | singleton exact matching conflict-projection digest |
| `live-declared-missing` | primary only | `live-declared-missing` | exact location `entryRecordDigest` | `entryFileId` | exact primary family projection digest | exact current primary resource-reference digest | exact primary family active-conflict digest array |
| `live-managed-unlocated` | primary `managed-blob` only | `live-managed-unlocated` | exact location `entryRecordDigest` | `entryFileId` | exact primary family projection digest | exact current primary resource-reference digest | exact primary family active-conflict digest array |
| `conflict-path` | primary | `conflict-path` | exact location `entryRecordDigest` | `entryFileId` | exact primary family projection digest | exact current primary resource-reference digest | exact primary family active-conflict digest array |
| `conflict-path` | active conflict-copy | `conflict-path` | exact location `entryRecordDigest` | exact `conflictSource.primaryFileId` | exact source family projection digest | exact resource-reference digest for the bound source version and this conflict-copy entry id | singleton exact matching conflict-projection digest |
| `tombstoned` | any previously valid file role | `tombstoned` | exact location `entryRecordDigest` | null | null | null | `[]` |

For every non-null family digest, the referenced
`ProjectContentFamilyProjectionV2.primaryEntryRecordDigest`, ids, policy, versions and
active-conflict set MUST cross-bind the entry role above. A live primary row requires
non-null `currentVersionId`; its resource reference uses that version. A live active
conflict-copy row uses its exact `conflictSource.sourceVersionId`, even when that
version is not the primary current version, and its matching conflict projection's
`reservedEntryLocationProjectionDigest` MUST equal `locationProjectionDigest`.
Arrays are sorted by decoded digest and duplicate-free. A declared-missing row still
has a logical hash-pinned current resource reference; native byte availability is not
encoded in this projection. Dormant and tombstoned rows deliberately suppress family
and resource fields so late family facts cannot revive or perturb the file
projection. `locationProjectionDigest` always hashes the exact same-entry location
projection represented by the row.

The digest is:

```text
SHA-256(UTF8("convax.project-file-projection/2") || 0x00 || JCS(value))
```

File reads, watcher snapshots and current resource proofs MUST bind this digest or
its explicitly named component digests; they MUST NOT invent a path-only revision,
machine-time version or whole-document version.

#### 4.3.5 Canvas-route projection

```ts
interface ProjectCanvasRouteProjectionV2 {
  format: "convax.project-route-projection/2"
  canvasId: CanvasIdV2
  state: "absent" | "staged" | "live" | "tombstoned"
  stageRecordDigest: DigestV2 | null
  ancestryRecordDigests: readonly DigestV2[]
  currentActivationDigest: DigestV2 | null
  currentShardEpoch: Id128V2 | null
  currentTitle: string | null
  currentTitleRecordDigest: DigestV2 | null
  currentTombstoneRecordDigest: DigestV2 | null
}
```

`ancestryRecordDigests` is the unique causal route chain from stage through the
current activation/reset, oldest to newest; it is ordered, not a set. It contains no
losing route fact. `currentActivationDigest` is the final activation/reset record
digest and is the value copied into live-scope manifests. Tombstoned state has only
the selected dominant tombstone digest plus `canvasId/state`; all live fields are
null or empty. The digest is:

```text
SHA-256(UTF8("convax.project-route-projection/2") || 0x00 || JCS(value))
```

`route-state.projectionDigest` and
`ProjectIndexLiveCanvasScopeEntryV2.routeProjectionDigest` MUST equal this digest.
The guard's `state`, `shardEpoch` and `activationDigest` MUST equal the same value's
fields. Arrival order, registry state and non-current staged shards do not enter it.

#### 4.3.6 Actual-write value and wrapper

```ts
type ProjectIndexRootNameV2 =
  | "identity" | "entries" | "entryLocations" | "entryTombstones"
  | "contentFamilies" | "contentPromotions" | "pathReservations"
  | "canvasRoutes" | "operations"

interface ProjectIndexWriteValueV2 {
  format: "convax.project-index-write-value/2"
  root: ProjectIndexRootNameV2
  key: string
  recordFormat: string
  recordDigest: DigestV2
}
```

For every newly inserted immutable root/key/value, the owner derives:

```text
valueDigest = SHA-256(
  UTF8("convax.project-index-write-value/2") || 0x00 ||
  JCS(exact ProjectIndexWriteValueV2)
)

ActualWriteV2 = {
  entityKind: "project-index." + root,
  entityId: key,
  field: "record",
  valueDigest
}

changedPath = root + "/" + key
```

All current Project keys are ASCII and forbid `/`; a future key codec containing
`/` requires a new actual-write path format. `recordFormat` equals the exact value
format and `recordDigest` is section 4.3.1. Writes and paths are strict UTF-8 sorted,
duplicate-free and include the operation receipt plus every domain fact inserted by
the intent. Missing, extra, overwritten, deleted, unchanged-padding or hidden Yjs
writes reject. An existing byte-identical operation is handled as an idempotent
lookup of its original frame; it does not create a second empty-write frame.

The portable wrapper remains kernel-owned `ActualWriteEvidenceV2`. Its `owner` is
`project-index`, `ownerSchemaDigest` is the selected Project artifact digest, and
its `intentDigest` is the exact typed-intent digest. Wrapper digest remains
`convax.actual-write-evidence/2`; an optional owner-internal aggregate remains
`convax.owner-actual-write-evidence/2`. Neither generic domain substitutes for the
per-write `valueDigest` above.

#### 4.3.7 Closed ledger summary

| Semantic identity | Exact value/preimage | Domain |
| --- | --- | --- |
| Canonical state | exact `ProjectCanonicalStateV2` bytes plus decoded owner schema digest | kernel `convax.canonical-state/2` |
| Genesis | canonical-state digest of the exact section 4.2.4 genesis value | no second domain |
| Persistent record / version / reset-commit fact | `record.format`, NUL, exact record JCS | existing `convax.project-index-record-digest/2` |
| Entry location/path | `ProjectEntryLocationProjectionV2` | `convax.project-entry-location-projection/2` |
| Conflict copy | `ProjectConflictProjectionV2` | `convax.project-conflict-projection/2` |
| Content family/live heads | `ProjectContentFamilyProjectionV2` | `convax.project-content-family-projection/2` |
| File/current resource | `ProjectFileProjectionV2` | `convax.project-file-projection/2` |
| Canvas route | `ProjectCanvasRouteProjectionV2` | `convax.project-route-projection/2` |
| Reset route CAS | exact `DocumentShardResetRouteCasCoreV2` | existing `convax.document-shard-reset-route-cas-core-digest/2` |
| Reset claim | exact `DocumentShardResetClaimCoreV2` | existing `convax.document-shard-reset-claim-core-digest/2` |
| Actual inserted root value | `ProjectIndexWriteValueV2` | `convax.project-index-write-value/2` |
| Portable actual-write set | exact `ActualWriteEvidenceV2` | kernel `convax.actual-write-evidence/2` |

No unspecified `hash(projection)`, JSON object enumeration hash, Yjs internal hash,
path-only revision, wall-clock version or document-wide revision remains legal.

#### 4.3.8 Acyclic construction and self-reference prohibition

The Project digest graph is a strict DAG. Implementations and generators MUST use
this topological order and MUST reject an artifact that introduces a back-edge:

```text
closed immutable Project records
  -> projectIndexRecordDigest
  -> ProjectCanonicalStateV2 bytes

projectIndexRecordDigest set
  -> ProjectEntryLocationProjectionV2
  -> ProjectConflictProjectionV2
  -> ProjectContentFamilyProjectionV2
  -> ProjectFileProjectionV2

projectIndexRecordDigest of each newly inserted value
  -> ProjectIndexWriteValueV2.valueDigest
  -> ActualWriteV2[]
  -> kernel ActualWriteEvidenceV2 digest

canonical-state digest + actual-write-evidence digest
  -> causal frame core and frame digest
```

`ProjectCanvasRouteProjectionV2` depends only on route record digests and therefore
sits beside entry-location in the second layer. A conflict projection may contain a
location projection digest; a family may contain conflict projection digests; a file
may contain location, family, conflict and resource-reference digests. None of those
lower layers may contain the digest of a higher layer.

In particular, `ProjectOperationReceiptV2` contains no canonical-state,
projection, per-write `valueDigest`, `ActualWriteEvidenceV2` or frame digest.
`ProjectIndexWriteValueV2` contains only the root value's section 4.3.1 record digest,
never a projection digest. `ProjectResourceReferenceV2` contains its exact version
record digest and blob identity but no file projection digest. Derived projections
are never inserted into a ProjectIndex root. The frame may bind both canonical state
and actual-write evidence because neither is reachable from any stored record.

The operation receipt itself is one actual write: its already-closed record digest
produces its per-write value digest, which enters the evidence. The receipt MUST NOT
gain an evidence-digest back-reference. A schema generator that cannot topologically
sort the graph above, or that needs a placeholder/fixed-point digest, fails bundle
generation as `canonical-authority-conflict`.

### 4.4 Revision-4 domain-registry delta

The kernel bundle applies these exact seven kernel/Project additions, already strict
raw-UTF-8 sorted and duplicate-free:

```text
convax.owner-canonicalizer-descriptor/2
convax.project-conflict-projection/2
convax.project-content-family-projection/2
convax.project-entry-location-projection/2
convax.project-file-projection/2
convax.project-index-write-value/2
convax.project-route-projection/2
```

It removes the former private digest domain:

```text
convax.project-index-canonical-state/2
```

The removed string remains the exact Project canonical-state `format`; it is no
longer a digest domain. The complete four-owner registry is generated atomically by
the collaboration-kernel appendix. These seven values cannot be adopted separately
or combined with a descriptor-less owner port.

Unknown facts are not ignored for forward compatibility. An unavailable schema or
validation artifact yields `dependency-pending` or
`unsupported-portable-version/read-only`; no old decoder may default, down-migrate
or write the state.

## 5. Resource, filesystem and materialization boundary

ProjectIndex is portable logical authority; a native Project tree is a guarded
materialization. A path is never identity and filesystem enumeration is never a
ProjectIndex update log.

For file creation/write, ordering is:

1. allocate ids and validate portable path/content policy;
2. stage bytes and compute SHA-256/length/MIME;
3. for create, publish/fsync the ordinary Project file with no-clobber; for write,
   publish a unique staged version, preserve any still-rooted old bytes in the local
   replication cache, then guarded atomic-replace/fsync the expected user file; a
   managed admission publishes create-new content-addressed bytes;
4. ensure the exact new bytes are available from a durable ordinary-file handle,
   managed object or content-addressed replication-cache object, then fsync the
   rebuildable blob-presence index and issue the nonportable admission token;
5. commit the ProjectIndex typed intent through section 9;
6. only afterward may a separate Canvas intent cite the issued resource proof.

Failure after step 3 but before ProjectIndex commit leaves an unreferenced published
file/blob. Ordinary user-visible files remain and are reported as partial success;
managed bytes enter delayed GC. There is no cross-file WAL and no inverse Canvas or
ProjectIndex update that deletes published user data.

The collaboration blob cache is not a second file authority. It preserves exact
hash-pinned bytes needed by outbox, conflict/history and Peer replication after a
user-visible path advances. Current logical file/version remains ProjectIndex; the
ordinary file remains user-visible materialization. Cache eviction follows section
12 and never changes a ProjectIndex winner.

Move/rename changes stable parent-directory/basename claims and URI path hints, not
entry identity. Native materialization uses no-clobber publication and the canonical
conflict path. It MUST revalidate real path, containment, symlink, case/Unicode,
Windows device/ADS and final opened-handle blob digest before serving bytes.

Deleting a Project entry commits its tombstone first. Native removal is a subsequent
idempotent materialization action. A crash may leave an invisible physical orphan,
but never a live ProjectIndex entry whose only bytes were prematurely deleted.
Ordinary file deletion requires the explicit typed operation; Canvas unreference,
checkpoint pruning and blob GC do not delete ordinary Project files.

## 6. Caps and preallocation gates

All limits are checked before large allocation, decompression, Yjs decode, path
materialization or file publication. An inner limit never relaxes a v10 outer limit.

| Item | Limit |
| --- | ---: |
| ProjectIndex full checkpoint | 32 MiB |
| complete Project intent / guard | 512 KiB / 256 KiB |
| one plain ProjectIndex value / JCS depth | 64 KiB / 16 |
| one key / basename / title / MIME | 256 B / 255 B / 512 B / 255 B |
| records added by one intent | 512 |
| semantic changed paths / logical writes per intent | 512 / 512 |
| guard atoms / ids allocated per operation | 256 / 8 |
| version supersedes ids / projected live heads per family | 256 / 256 |
| current live Canvas routes / pending-editor manifest entries | 4,095 / 4,095 |
| live Project entries / retained entry facts | 100,000 / 1,000,000 |
| retained content versions / operation receipts | 1,000,000 / 1,000,000 |
| retained Canvas route facts | 100,000 |
| one blob | 16 GiB |
| local outbox ref / journal record / durable head | 64 KiB each |
| journal segment | 4,096 records and 64 MiB |
| immutable installed checkpoint set / reset manifest | 64 KiB each |
| local frame outbox per document | 4,096 frames and 512 MiB |
| pending inbox per document / remote actor | 4,096 and 256 MiB / 512 and 32 MiB |
| one recovery branch | 1 GiB |
| quarantine per Project | 1,024 objects and 128 MiB |

The 32 MiB checkpoint and outer causal-frame limits normally bind before retained
record ceilings. At any exact ceiling the Project remains readable and exportable;
a new mutation that would exceed it returns `project-index-capacity-exceeded`.
Implementations MUST NOT silently drop receipts, versions, conflicts or route facts.

## 7. Closed ProjectIndex typed intents

Every intent has `format="convax.typed-intent/2"`, one kind below, one closed guard
array and one closed body. It carries no actor key, native path, local permit,
document version, raw Yjs update or caller-selected identity.

```ts
type ProjectIndexIntentKindV2 =
  | "project.directory.create/2"
  | "project.file.create/2"
  | "project.entry.locate/2"
  | "project.entry.tombstone/2"
  | "project.file.write-text/2"
  | "project.file.overwrite-binary/2"
  | "project.canvas.route.stage/2"
  | "project.canvas.route.activate/2"
  | "project.canvas.route.rename/2"
  | "project.canvas.route.tombstone/2"
  | "project.canvas.route.reset/2"

type ProjectGuardAtomV2 =
  | { kind: "entry-absent"; entryId: ProjectEntryIdV2 }
  | { kind: "entry-live"; entryId: ProjectEntryIdV2; entryDigest: DigestV2 }
  | { kind: "entry-location"; entryId: ProjectEntryIdV2; projectionDigest: DigestV2 }
  | { kind: "directory-live"; directoryId: ProjectDirectoryIdV2; entryDigest: DigestV2 }
  | { kind: "family-live-heads"; primaryFileId: ProjectFileIdV2; versionIds: ProjectVersionIdV2[]; projectionDigest: DigestV2 }
  | { kind: "route-state"; canvasId: CanvasIdV2; state: "absent" | "staged" | "live" | "tombstoned"; shardEpoch: Id128V2 | null; activationDigest: DigestV2 | null; projectionDigest: DigestV2 }
  | { kind: "fact-absent"; map: "entries" | "entryLocations" | "entryTombstones" | "contentFamilies" | "contentPromotions" | "pathReservations" | "canvasRoutes" | "operations"; key: string }
```

The serialized intent union is exactly:

```ts
interface ProjectIndexIntentBaseV2 {
  format: "convax.typed-intent/2"
  kind: ProjectIndexIntentKindV2
  guards: ProjectGuardAtomV2[]
}

type ProjectIndexIntentV2 =
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.directory.create/2"
      body: {
        entry: ProjectEntryRecordV2
        location: ProjectEntryLocationClaimV2
      }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.file.create/2"
      body: {
        entry: ProjectEntryRecordV2
        location: ProjectEntryLocationClaimV2 | null
        initialVersion: ProjectContentVersionRecordV2
      }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.entry.locate/2"
      body: { location: ProjectEntryLocationClaimV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.entry.tombstone/2"
      body: { tombstone: ProjectEntryTombstoneV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.file.write-text/2"
      body: {
        version: ProjectContentVersionRecordV2
        conflictEntry: ProjectEntryRecordV2
        promotion: ProjectContentPromotionRecordV2
        reservation: ProjectPathReservationRecordV2
      }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.file.overwrite-binary/2"
      body: { version: ProjectContentVersionRecordV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.canvas.route.stage/2"
      body: { stage: CanvasRouteStageV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.canvas.route.activate/2"
      body: { activation: CanvasRouteActivationV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.canvas.route.rename/2"
      body: { metadata: CanvasRouteMetadataClaimV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.canvas.route.tombstone/2"
      body: { tombstone: CanvasRouteTombstoneV2 }
    })
  | (ProjectIndexIntentBaseV2 & {
      kind: "project.canvas.route.reset/2"
      body: {
        resetCommit: CanvasRouteResetCommitV2
        routeCasCore: DocumentShardResetRouteCasCoreV2
        resetClaim: DocumentShardResetClaimV2
        confirmation: DocumentShardResetConfirmationV2
        approval: DocumentShardResetApprovalV2
      }
    })
```

The reset types are defined in section 8 and are part of this same schema bundle;
forward references do not make them optional. No body accepts extension fields.

Guard atoms sort by `(kind UTF8, primary id UTF8, JCS bytes)`, are duplicate-free
and are evaluated against the exact authored base. Intent-specific required and
allowed writes are:

| Intent | Exact body | Required guards | Exact added records and fixed ordinals |
| --- | --- | --- | --- |
| `directory.create` | `directoryId,parentDirectoryId,basename,entryRecord,locationRecord` | new entry absent; parent live directory | entry `0`, location `1`, plus receipt |
| `file.create` | `fileId,parent/basename|null,entryRecord,initialVersion` | new entry/version absent; parent live iff project-file; native blob permit | entry `0`, location `1` reserved, version `2`, plus receipt |
| `entry.locate` | `entryId,locationRecord` | exact live entry and current location; destination parent live | location `0`, plus receipt |
| `entry.tombstone` | `entryId,tombstoneRecord` | entry observed live | tombstone `0`, plus receipt |
| `file.write-text` | `primaryFileId,newVersion,conflictEntry,promotion,reservation` | live text file; exact base live heads equal `supersedes`; native blob permit; all allocated keys absent | version `0`, conflict entry `1`, promotion `2`, reservation `3`, plus receipt |
| `file.overwrite-binary` | `primaryFileId,newVersion` | live overwritable file; exact observed current; counter is observed max +1; native blob permit | version `0`, plus receipt |
| `canvas.route.stage` | `stageRecord` | route absent; ids absent | Canvas id `0`, transition `1`, plus receipt |
| `canvas.route.activate` | `activationRecord` | exact staged route, no tombstone, exact genesis/dependency proof | transition `0`, plus receipt |
| `canvas.route.rename` | `metadataRecord` | exact live route/activation | transition `0`, plus receipt |
| `canvas.route.tombstone` | `tombstoneRecord` | route observed staged/live or already tombstoned identically | transition `0`, plus receipt |
| `canvas.route.reset` | `resetCommitRecord,resetClaim` | exact live old activation, no tombstone, section 8 proof | transition `0`, plus receipt |

The table's ordinal column means derived-identity ordinal, not Yjs insertion order.
The operation receipt itself is a logical write but uses no derived id. Optional
location in `file.create` reserves ordinal 1 even for managed-blob creation; skipped
reserved ordinals cannot be reused.

`file.create` allows `initial` only. Generated and managed-admission entries MUST be
immutable; a new result uses a new file id. `write-text` is legal only for
`conflict-preserving-text`; `overwrite-binary` only for `overwritable-binary`.
Generic save, whole-entry replace, JSON patch, raw transaction and expected document
version intents do not exist.

The reducer computes the exact record set above, projects it into the kernel-owned
`ActualWriteEvidenceV2` wrapper and rejects any additional/omitted root/key/field
write. V2 has no bulk Project intent. Multi-file import publishes each file first and
submits independent `project.file.create/2` operations, reporting the exact committed
subset on interruption/failure. It is not atomic across files, and callers MUST NOT
claim atomicity by batching repeated operations or whole-document saves. A future
atomic bulk import requires a new closed intent, id/write/cap budget and architecture
review.

## 8. Project-owned Canvas shard reset

A Canvas shard reset is not a Canvas edit, membership event, checkpoint shortcut or
cache clear. It is a Project-owned route transition. Legal reasons are closed:

```ts
type DocumentShardResetReasonV2 =
  | "incompatible-canvas-schema"
  | "document-lamport-exhaustion"
  | "unrecoverable-certified-history-corruption"

type DocumentShardResetConfirmationV2 =
  import("@convax/project/collaboration-protocol").DocumentShardResetConfirmationV2
type DocumentShardResetApprovalV2 =
  import("@convax/project/collaboration-protocol").DocumentShardResetApprovalV2
```

Actor sequence exhaustion rotates `actorId`. Ordinary equivocation quarantines the
fork, revokes/cuts off the actor and rebuilds from trusted history. Neither condition
alone resets a shard. `unrecoverable-certified-history-corruption` requires proof
that no retained trusted checkpoint can rebuild the document.

### 8.1 Closed claim and route-CAS core

```ts
interface DocumentShardResetRouteCasCoreV2 {
  format: "convax.document-shard-reset-route-cas-core/2"
  operationId: Id128V2
  canvasId: CanvasIdV2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
}

interface DocumentShardResetClaimCoreV2 {
  format: "convax.document-shard-reset-claim-core/2"
  projectIndexScope: ProjectIndexScopeV2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  oldProtocolDigest: DigestV2
  newProtocolDigest: DigestV2
  oldSchemaDigest: DigestV2
  newSchemaDigest: DigestV2
  stagedGenesisCheckpointDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  routeCasCoreDigest: DigestV2
  initiatorMemberId: MemberIdV2
  initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
  adminMemberId: MemberIdV2
  adminAuthorizationDigest: DigestV2
  explicitConfirmationReceiptDigest: DigestV2
}

interface DocumentShardResetClaimV2 {
  format: "convax.document-shard-reset-claim/2"
  core: DocumentShardResetClaimCoreV2
  coreDigest: DigestV2
  initiatorSignature: SignatureV2
  adminApprovalDigest: DigestV2
}
```

The whole claim JCS is <=64 KiB and depth <=16. `oldScope` and `newScope` have the
same Project, epoch, Canvas id and `docKind`; only `shardEpoch` differs, and the new
epoch is fresh random 128-bit. Both Canvas `docId` values equal the enclosing
`canvasId`. ProjectIndex scope has the same Project/epoch. Every corresponding field
in the route-CAS core, reset claim and route commit is byte-equal.

The staged genesis header binds every route-CAS core field except the claim digest,
which avoids a hash cycle. The claim binds the resulting exact genesis and
`routeCasCoreDigest`. The ProjectIndex reset intent contains the whole claim plus
the same route-CAS core; validation recomputes both digests and requires exact field
equality. Signatures use:

```text
"convax.document-shard-reset-claim-signature/2\0" || decoded coreDigest
```

The reset intent carries the exact control-owned confirmation and approval objects.
Validation requires all of these byte equalities:

```text
confirmation.coreDigest == claim.core.explicitConfirmationReceiptDigest
approval.core.resetClaimCoreDigest == claim.coreDigest
approval.core.confirmationCoreDigest == confirmation.coreDigest
approval.core.adminCapabilityCoreDigest == claim.core.adminAuthorizationDigest
approval.coreDigest == claim.adminApprovalDigest
resetCommit.resetClaimCoreDigest == claim.coreDigest
resetCommit.confirmationCoreDigest == confirmation.coreDigest
resetCommit.approvalCoreDigest == approval.coreDigest
```

`DocumentShardResetConfirmationV2` binds Project/epoch, old/new scope, reason,
route-CAS/predecessor, all three staged-genesis digests, initiator identity/actor
credential, the fixed destructive-confirmation statement and `protocolDigest`; its
initiator replica signature is verified. `DocumentShardResetApprovalV2` binds the
claim core, confirmation, exact reset fields and current admin member authorization/
capability with a fixed approval statement and admin signature. The approval is
computed after the claim core, so no digest cycle exists. A renderer boolean,
arbitrary digest, stale admin capability or approval for another claim is invalid.

### 8.2 Nominal reset identity and initiator authority

Section 2 imports the kernel-owned nominal `MemberIdV2` and `ReplicaIdV2`.
`DocumentShardResetClaimCoreV2` uses exactly these nominal fields:

```ts
initiatorMemberId: MemberIdV2
initiatorReplicaId: ReplicaIdV2
initiatorActorId: ActorIdV2
adminMemberId: MemberIdV2
```

Do not change control confirmation to `Id128V2`, split replica identity into a new
field, add a raw-id alternative or accept both codecs. `ReplicaIdV2` is the exact
service-reserved `replica_` plus eight lowercase hexadecimal digits and maps to the
Yjs client id; raw 16-byte base64url cannot represent the same identity.

#### 8.2.1 Initiator tuple and reservation chain

Define the exact initiator tuple:

```ts
interface ResetInitiatorTupleV2 {
  memberId: MemberIdV2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
}
```

The following three tuples MUST be byte-equal after strict scalar decoding and
canonical re-encoding:

```text
claim.core.{initiatorMemberId,initiatorReplicaId,initiatorActorId}
confirmation.core.{initiatorMemberId,initiatorReplicaId,initiatorActorId}
activeReplicaActorCredential.core.{memberId,replicaId,actorId}
```

The exact `ReplicaIdReservationReceiptV2` referenced by
`activeReplicaActorCredential.core.replicaIdReservationReceiptDigest` MUST then
bind the same identity and key:

```text
receipt.coreDigest
  == credential.core.replicaIdReservationReceiptDigest
receipt.core.projectId
  == claim.core.projectIndexScope.projectId
receipt.core.projectEpoch
  == claim.core.projectIndexScope.projectEpoch
receipt.core.targetMemberId
  == claim.core.initiatorMemberId
receipt.core.assignedReplicaId
  == claim.core.initiatorReplicaId
receipt.core.newReplicaSigningPublicKey
  == credential.core.replicaSigningPublicKey
credential.core.projectId/projectEpoch
  == claim Project/projectEpoch
confirmation.core.initiatorActorCredentialCoreDigest
  == credential.coreDigest
```

The receipt has no `actorId`; it authorizes the exact member/replica/signing-key
pair, while the service-signed actor credential extends that pair to the actor.
Claiming four-way triple equality with a nonexistent receipt actor would be a false
schema statement. The complete chain above is the required four-object binding.

The selected 3/3 initiator acceptance set is **one exact current active-editor
replica**, not any active replica. The exact current
`ReplicaEditAuthorizationV2` resolved for that actor MUST additionally satisfy:

```text
editAuthorization.core.projectId/projectEpoch
  == credential.core.projectId/projectEpoch
editAuthorization.core.memberId/replicaId/actorId
  == credential.core.memberId/replicaId/actorId
editAuthorization.core.replicaIdReservationReceiptDigest
  == credential.core.replicaIdReservationReceiptDigest
editAuthorization.core.replicaAuthorizationEpoch
  == credential.core.replicaAuthorizationEpoch
editAuthorization.core.role == "editor"
editAuthorization.core.editState == "active-editor"
editAuthorization.core.membershipSnapshotDigest
  == exact current membership snapshot core digest
editAuthorization.core.memberAuthorizationEpoch
  == exact current member authorization epoch
editAuthorization.core.protocolDigest
  == current instantiated ProtocolSchemaBundleV2.coreDigest
editAuthorization.core.schemaDigest/validationArtifactSetDigest
  == exact ProjectIndex frame schema/artifact authority selected for this reset

membershipMember.memberId == credential.core.memberId
membershipMember.state == "active"
membershipMember.role == "editor"
membershipReplica.replicaId == credential.core.replicaId
membershipReplica.state == "active"
membershipReplica.editState == "active-editor"
```

The installed-floor digest and every remaining identity/epoch/digest field of the
edit authorization MUST validate under the existing Control rules. A viewer replica
has `editState="none"`; a pending editor has no current edit authorization. Both are
rejected even when their actor credential and an admin approval are otherwise
valid. The initiator signatures prove that one current Project writer constructed
and confirmed the exact candidate. Admin approval independently authorizes the
destructive action; `membership-admin` does not grant Project payload mutation and
cannot substitute for edit authority.

The admin chain is also exact:

```text
claim.core.adminMemberId
  == approval.core.adminMemberId
  == currentProjectAdminCapability.core.adminMemberId
claim.core.adminAuthorizationDigest
  == approval.core.adminCapabilityCoreDigest
  == currentProjectAdminCapability.coreDigest
```

The existing approval authorization-epoch and current-capability checks remain
mandatory.

### 8.3 `F13-WITNESS-A+C/1`: one verifier and one Project-private gate

Project defines no reset verification order, first-failure selection or duplicate
failure-code table. The Control artifact's exact composite
`verifyDocumentShardResetAuthorityV2` function, including all thirteen ordered steps,
their within-step order and closed failure codes, is the sole normative authority
algorithm. Both the initial decision and the final gate call that same complete
function through its one-argument `VerifyDocumentShardResetAuthorityInputV2`
declaration. Decision `F13-ABI-CLOSED-SNAPSHOT/1` fixes that declaration and its
closed byte-input helper types in the Control artifact; this appendix references
those exported types and does not reproduce their declaration. There is no shortened
final-currentness verifier, suffix API or Project copy of any verifier step. Section
8.2.1 supplies equality and acceptance predicates to the Control function; it does
not define another execution sequence.

The Control document owns only that pure diagnostic algorithm. It returns only its
closed `verified | pending | rejected` result and owns no witness, permit, registry,
state transition or reducer gate. This Project appendix solely defines the
process-local witness and one-shot reducer-entry coordinator. The Control document
may state that its diagnostic grants no mutation authority and reference this
section; it MUST NOT restate the Project-private algorithm below. Conversely, this
section names the Control function but MUST NOT enumerate, summarize, reorder or
partially reimplement its thirteen steps.

The sole capability owner is the module-private
`ProjectIndexDocumentShardResetCoordinatorV2` in the `@convax/project` application
service that directly invokes the verifier and reducer. Desktop Main may inject its
local accepted-authority-head port adapter, but Desktop, Project Node, API, renderer,
Agent and Plugin code cannot acquire, receive, pass or consume a witness or permit.
The witness/permit types, port handle, constructor, issuer, `WeakMap` registry and
consumer have no package export and are absent from
`@convax/project/collaboration-protocol`.

The sole implementation and public symbol for the pure diagnostic verifier is
`verifyDocumentShardResetAuthorityV2` exported from
`@convax/project/collaboration-protocol`. The module-private coordinator is the only
caller whose result may participate in mutation admission. Project Node and Desktop
may only supply typed adapters to the Project application service. An API or isolated
attester may evaluate the public diagnostic, but its result is not a permit and
cannot enter this coordinator, the reducer or a durable authority record. No other
package may wrap, overload or re-export a second reset-admission verifier.

For each invocation the coordinator constructs one new closed ten-field
`VerifyDocumentShardResetAuthorityInputV2` value with `claim`, `confirmation`,
`approval`, `routeCas`, `resetCommit`, `dependencies`, `candidateBinding`,
`candidateFacts`, `currentReplicaDocHead` and `currentRouteFacts`. It has no format
field, optional field or extension key. The first five fields, all eleven nullable
dependency byte slots and the candidate binding are exact JCS bytes consumed and
freshly decoded only by the Control verifier. Project never passes decoded wrapper
objects or a digest-only candidate assertion in their place.

The candidate facts are freshly assembled as `typedIntentExactJcs`,
`causalContextExactJcs`, `candidateFullUpdateBytes`, `candidateStateVector` and
`candidateCanonicalStateBytes`. The current durable head is freshly assembled as
`currentFrontierExactJcs`, `currentFullUpdateBytes`, `currentStateVector` and
`currentCanonicalStateBytes`. The current route facts are exactly
`currentProjectIndexStateVectorDigest`,
`currentProjectIndexCanonicalStateDigest`, `projectIndexScope`,
`predecessorActivationDigest`, `currentOldRouteActivationDigest`,
`currentOldShardEpoch`, `currentNewRouteState`, `currentStagedGenesisState`,
`currentStagedGenesisCheckpointDigest`, `currentStagedGenesisFullUpdateDigest` and
`currentStagedGenesisStateVectorDigest`. The raw candidate and head material lets the
Control verifier independently reconstruct and compare the candidate binding; the
eleven route facts are derived from that same current ProjectIndex head plus the
coordinator's current staged-genesis state. A second copy of the eleven binding
digests without those raw bytes is forbidden.

The coordinator's private current-authority port returns one
`CurrentDocumentShardResetAuthorityHeadWitnessV2`. Acquisition performs an atomic
current check against the locally accepted membership/cutoff authority head and
binds that exact head, trust bundle, credential, edit authorization/floor,
member/replica authority epochs and states, and current admin capability. The witness
contains a process-local identity, a distinct opaque
`acceptedAuthorityHeadIdentity`, synchronous `assertCurrent()` and exactly-once
`release()`. While held, it is an immutable read lease: the adapter either prevents
publication of a replacement accepted head or makes the next `assertCurrent()` fail.
After the final successful assertion it MUST prevent such publication until reducer
entry or release; invalidation without another observable assertion is insufficient.
The witness and its identities are non-serializable, non-clonable, non-digestible and
MUST NOT cross IPC, structured clone, Yjs, a package client API or a process boundary,
or enter a frame, journal, head, outbox, log, telemetry or durable/service store.

The closed module-private record shape is exactly:

```ts
type ProjectIndexResetPermitStateV2 =
  | "issued"
  | "consuming"
  | "spent"
  | "consumed"

// Closure-owned defensive copies with no caller-mutable alias.
type CanonicalInputBytesV2 = Readonly<Uint8Array>
type ProcessLocalCandidateIdV2 = Readonly<Uint8Array> // exactly 16 random bytes
type ProcessLocalNonce32V2 = Readonly<Uint8Array> // exactly 32 random bytes

interface ProjectIndexResetExactInputBytesV2 {
  claim: CanonicalInputBytesV2
  confirmation: CanonicalInputBytesV2
  approval: CanonicalInputBytesV2
  routeCas: CanonicalInputBytesV2
  resetCommit: CanonicalInputBytesV2
  credential: CanonicalInputBytesV2
  reservationReceipt: CanonicalInputBytesV2
  membershipSnapshot: CanonicalInputBytesV2
  membershipMember: CanonicalInputBytesV2
  membershipReplica: CanonicalInputBytesV2
  editAuthorization: CanonicalInputBytesV2
  floorRoot: CanonicalInputBytesV2
  floorPages: readonly CanonicalInputBytesV2[]
  projectIndexLiveScopeManifest: CanonicalInputBytesV2
  adminCapability: CanonicalInputBytesV2
  trustBundle: CanonicalInputBytesV2
}

interface ProjectIndexResetAuthorityBindingV2 {
  claimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  resetCommitRecordDigest: DigestV2
  routeCasCoreDigest: DigestV2
  membershipSnapshotCoreDigest: DigestV2
  membershipEpoch: MembershipSnapshotV2["core"]["membershipEpoch"]
  membershipSequence: MembershipSnapshotV2["core"]["membershipSequence"]
  memberId: MemberIdV2
  memberAuthorizationEpoch: MembershipMemberV2["memberAuthorizationEpoch"]
  memberState: MembershipMemberV2["state"]
  memberRole: MembershipMemberV2["role"]
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  replicaAuthorizationEpoch: MembershipReplicaV2["replicaAuthorizationEpoch"]
  replicaState: MembershipReplicaV2["state"]
  editState: MembershipReplicaV2["editState"]
  replicaSigningPublicKey: MembershipReplicaV2["replicaSigningPublicKey"]
  credentialCoreDigest: DigestV2
  reservationReceiptCoreDigest: DigestV2
  editAuthorizationCoreDigest: DigestV2
  installedFloorSetDigest: DigestV2
  floorRootCoreDigest: DigestV2
  orderedFloorPageDigests: readonly DigestV2[]
  liveScopeManifestDigest: DigestV2
  trustBundleDigest: DigestV2
  adminCapabilityCoreDigest: DigestV2
  adminMemberId: MemberIdV2
  adminMemberAuthorizationEpoch:
    ProjectAdminCapabilityV2["core"]["adminMemberAuthorizationEpoch"]
  currentProjectIndexStateVectorDigest: DigestV2
  currentProjectIndexCanonicalStateDigest: DigestV2
  predecessorActivationDigest: DigestV2
  projectIndexScope: ProjectIndexScopeV2
  currentOldRouteActivationDigest: DigestV2
  currentOldShardEpoch: Id128V2
  currentNewRouteState: "absent"
  currentStagedGenesisState: "inert"
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  stagedGenesisCheckpointDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
}

interface ProjectIndexResetPermitRecordV2 {
  state: ProjectIndexResetPermitStateV2
  nonce32: ProcessLocalNonce32V2
  candidateId: ProcessLocalCandidateIdV2
  candidateObject: object
  binding: Readonly<DocumentShardResetCandidateBindingV2>
  witnessIdentity: object
  acceptedAuthorityHeadIdentity: object
  exactInputBytes: Readonly<ProjectIndexResetExactInputBytesV2>
  authorityBinding: Readonly<ProjectIndexResetAuthorityBindingV2>
}
```

`binding` is the frozen exact eleven-field
`DocumentShardResetCandidateBindingV2`: `scope`, `routeCasCoreDigest`,
`typedIntentDigest`, `causalContextDigest`, `baseStateVectorDigest`,
`baseCanonicalStateDigest`, `protocolDigest`, `ownerSchemaDigest`,
`validationArtifactSetDigest`, `installedFloorSetDigest` and `signerAuthority`.
Every `exactInputBytes` member is the exact canonical byte encoding of the complete
validated wrapper, including signatures; `floorPages` is in floor-root order. These
are defensive private copies, not decoded object references. The record and both
nested objects are closed: no omitted, additional or implementation-selected field
is permitted. `candidateId` is generated from a secure random-byte port as 128 bits;
`nonce32` uses a separate secure-random call for 256 bits. Neither uses wall clock or
`Math.random`. The frozen empty permit object has no record field; exact `WeakMap`
membership plus the record is the capability.

The complete A+C transition graph is:

```text
issued --A: atomic claim--> consuming
consuming --C: any pre-reducer failure--> spent
consuming --C: A4 passed, immediately before reducer entry--> consumed
```

`spent` and `consumed` are terminal. Besides the four state/identity diagnostics
listed below, the only Project-private failures are
`reset-permit-binding-invalid`, `reset-permit-authority-head-stale` and
`reset-permit-aborted`. They are module-local diagnostics, not Control or portable
protocol values.

All possibly asynchronous byte resolution completes before the Project writer/
route-CAS critical section. One attempt then performs exactly this sequence:

1. enter the exclusive ProjectIndex writer/route-CAS critical section; from this
   point through reducer entry there is no `await`, Promise turn, cancellation
   callback, extension code, event dispatch, IPC, native write or lock release;
2. clone the current durable ProjectIndex `replicaDoc` into one isolated, unmutated
   candidate; allocate `candidateId`; compute the complete candidate `binding` and
   exact canonical input bytes; retain closure-owned defensive copies of the exact
   typed-intent and causal-context JCS bytes needed to reconstruct candidate facts;
3. synchronously acquire the witness. Acquisition's atomic current check is separate
   from four mandatory explicit assertions. Acquisition failure returns dependency-
   pending, releases any partial lease and creates no record;
4. invoke assertion **A1** immediately after acquisition; construct a fresh initial
   ten-field verifier input from the closure-owned exact business/dependency bytes,
   the exact candidate binding, freshly assembled five-field candidate facts, the
   freshly reconstructed four-field durable head and the freshly derived eleven-field
   current route facts; then call the complete Control-owned
   `verifyDocumentShardResetAuthorityV2` for the initial F13 decision. Invoke
   assertion **A2** immediately after its `verified` result. A1 failure, input
   construction failure, verifier pending/rejection/exception or A2 failure releases
   the witness exactly once, discards the candidate and creates no permit record;
5. defensively copy/freeze every closed record field, create the empty permit object
   and insert one `state="issued"` record. The next operation is the synchronous
   consumer; no user code or fallible callback occurs between insertion and claim.
   `nonce32` randomness, canonical-copy or allocation failure before successful insertion
   releases the witness exactly once, discards the candidate and creates no record;
6. require exact `WeakMap` membership and atomically compare-and-swap
   `issued -> consuming` before reading or comparing any candidate/currentness field.
   An absent/copied permit returns `reset-permit-invalid` without locating or changing
   a genuine record; observations of `consuming`, `spent` or `consumed` return only
   module-local `reset-permit-in-use`, `reset-permit-spent` or
   `reset-permit-consumed` and never release the winning attempt's witness;
7. require byte equality for `candidateId`, exact identity equality for
   `candidateObject` and both witness/head identities, complete eleven-field equality
   for `binding`, constant-time equality for every canonical byte/digest/key field,
   and exact scalar/array equality for every remaining `authorityBinding` field;
8. invoke assertion **A3**, then construct a different fresh final ten-field input.
   Its five business fields and eleven dependency slots come only from the permit
   record's defensive `exactInputBytes` copies; the Control verifier makes fresh
   working copies and decodes them again. Canonically encode the frozen eleven-field
   `binding` for `candidateBinding`. Rebuild all five candidate-fact fields after A3:
   make new defensive copies of the retained typed-intent/causal-context JCS and
   freshly derive the candidate full update, state vector and canonical-state bytes
   from the same identity-checked unmutated candidate. Also freshly reconstruct all
   four `currentReplicaDocHead` fields and all eleven `currentRouteFacts` fields,
   including the three `currentStagedGenesis*` digests, while still holding the
   writer lock and witness. Call the same complete Control-owned
   `verifyDocumentShardResetAuthorityV2` for the final F13 decision, then invoke
   assertion **A4** immediately after its `verified` result. Reusing the initial
   top-level input, its current snapshots or decoded dependency objects is forbidden;
9. after A4 succeeds, atomically change `consuming -> consumed`, zero `nonce32`, and
   enter the reducer on the exact candidate in the same synchronous call frame. No
   statement between A4, the transition and reducer invocation may await, call out,
   dispatch or release either lease or writer lock;
10. release the witness exactly once in the reducer-call `finally`, whether the
    synchronous reducer returns or throws. Signing, persistence and durability may
    continue afterward without the witness, but the permit remains `consumed`.

After the `issued -> consuming` winner exists, any field mismatch, A3/A4 failure,
final F13 pending/rejection, cancellation or exception before reducer entry changes
that one record `consuming -> spent`, zeroes `nonce32`, releases the witness exactly
once, discards the untouched candidate and performs zero authoritative write.
`spent` and `consumed` are terminal. A re-entrant/losing call never performs final
F13, never enters the reducer and never releases the winner's lease. A wrapper or
signature mutation between initial and final verification is caught by the exact
canonical-byte comparison or the second complete F13; binding only core digests is
forbidden.

Project-private failure precedence is registry membership, state claim, complete
record comparison (`reset-permit-binding-invalid`), A3
(`reset-permit-authority-head-stale`), the Control function's unchanged F13
first-failure result, then A4 (`reset-permit-authority-head-stale`). Cancellation or
an exception at a Project layer is `reset-permit-aborted`; a Control invocation
returns its exact Control result. The Project layers do not reorder failures inside
F13. Simultaneous record mismatch and stale witness therefore reports
`reset-permit-binding-invalid`; simultaneous A3 staleness and a verifier fault
reports `reset-permit-authority-head-stale`; faults that reach F13 use Control's sole
first-failure order. None of the seven Project-private diagnostics may enter a frame
or store.

F13 runs at most twice per attempt: once before issue and once after the consuming
claim. Both calls are pure, synchronous and in-memory over bytes already admitted by
the existing object/depth/floor-page caps; neither may fetch, perform I/O, mutate or
persist. The worst-case work is bounded by twice one capped verifier execution plus
one closed-record comparison. Shard reset is a destructive, low-frequency operation;
an implementation may not replace the second F13 with a suffix verifier to optimize
this cost. If the maximum admitted corpus violates the synchronous reset budget, the
caps or protocol must be reviewed rather than introducing another authority path.

The verifier ABI input and its candidate/head/route helpers are process-local call
values only. They are not portable records, frame sections, journal objects or hash
preimages, so `F13-ABI-CLOSED-SNAPSHOT/1` introduces no digest domain and does not
change the strict protocol domain-registry cardinality. Changing either owner
artifact's exact prose still rotates the corresponding artifact and bundle
identities through the existing artifact-digest rules.

Durability is never inferred from the permit. The kernel object/outbox/journal/head
barrier and exact route-frame identity are the sole commit/idempotency authority. If
that barrier proves the exact route frame committed, recovery returns that committed
result without rerunning the reducer, re-signing or obtaining a replacement permit.
If any durable ref to the exact route frame exists, recovery may advance only that
same claim/operation/frame/genesis through the existing barrier. If no durable frame
ref exists, retry starts with fresh dependency bytes, witness, candidate,
`candidateId`, `nonce32` and record. Process crash or module reload loses every
witness/permit state; restart consults only the durable barrier and never reconstructs
`issued`, `consuming`, `spent` or `consumed`.

Any changed membership, role, `editState`, edit authorization, installed floor,
accepted authority head, trust bundle, admin capability, route/predecessor,
candidate identity, wrapper bytes or bound value therefore prevents reducer entry.
Project never substitutes a newer credential/reservation, maps authority to a
renderer/session identity, or treats a reusable permit as recovery state.

A reservation receipt validly consumed into the exact active actor credential
remains retained provenance after its short reservation TTL elapses. Post-
consumption expiry does not invalidate that credential; accepting an unconsumed or
already-expired-at-consumption receipt remains forbidden by the Control algorithm.

### 8.4 Durable state machine

`@convax/project/node` persists one reset manifest keyed by claim/core identity:

```ts
interface DocumentShardResetManifestV2 {
  format: "convax.document-shard-reset-manifest/2"
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  routeCasCoreDigest: DigestV2
  oldScopeNativeKey: DigestV2
  newScopeNativeKey: DigestV2
  stagedGenesisCheckpointDigest: DigestV2
  routeCasFrameDigest: DigestV2 | null
  state:
    | "shard-reset-staged"
    | "shard-reset-awaiting-route-cas"
    | "shard-reset-recovery-required"
    | "unsupported-old-shard"
    | "abandoned-pre-cas"
}
```

The only transitions are:

```text
no reset
  -> shard-reset-staged
  -> shard-reset-awaiting-route-cas
     -> unsupported-old-shard
     -> shard-reset-recovery-required -> unsupported-old-shard

shard-reset-staged -> abandoned-pre-cas
```

1. **Stage.** Create/fsync exact new-scope genesis/checkpoint and claim while the
   old activation remains the sole live route. No ProjectIndex fact points to the
   new shard yet.
2. **Await route CAS.** Construct/sign the one exact ProjectIndex route-reset frame,
   persist its object and first durable outbox/journal reference. From this point the
   implementation may only finish/retry this exact claim/frame; it cannot abandon,
   allocate another operation or sign replacement bytes.
3. **Route CAS accepted.** After the ProjectIndex durable head accepts the reset
   frame, the new shard is the sole current route. The old shard is immediately
   recovery-only. If the new local shard cannot be installed, state is
   `shard-reset-recovery-required`; the old route MUST NOT be shown as live.
4. **Complete.** Install and verify the exact staged new genesis, retain the old
   shard under unsupported/recovery roots and write `unsupported-old-shard`.

Only `shard-reset-staged`, with no durable route-frame ref on any local store, may be
abandoned. Abandonment fsyncs its marker before deleting rebuildable staging. Every
retry after a durable route-frame ref uses the same claim, route-CAS core,
operation id, signed frame bytes, new shard epoch and genesis. A newly invented
claim after route acceptance is invalid even if it names identical scopes.

Concurrent valid route-reset frames from the same authored predecessor converge by
the route `Max(stamp)` rule; non-current staged shards remain recovery bytes. A
tombstone still dominates every reset. If ProjectIndex itself cannot be validated,
the state is `project-reset-required`; no Canvas-local reset may bypass it.

## 9. Native frame commit and deterministic reopen

Only `@convax/project/node` implements these barriers. Every file creation uses
create-new/no-follow semantics, verifies the final opened handle, fsyncs the file and
then its containing directory. Atomic replace is same-filesystem and fsyncs the
renamed file plus directory.

### 9.1 Closed local records

```ts
interface LocalReplicationOutboxRefV2 {
  format: "convax.local-replication-outbox-ref/2"
  scope: DocumentScopeV2
  frameDigest: DigestV2
  actorId: ActorIdV2
  actorSequence: Uint64V2
  operationId: Id128V2
  requiredBlobDigests: DigestV2[] // sorted unique, <=256
}

interface LocalJournalRecordV2 {
  format: "convax.local-journal-record/2"
  scope: DocumentScopeV2
  localRecordSequence: Uint64V2 // starts "1"; local recovery order only
  priorJournalRecordDigest: DigestV2 | null
  transition:
    | "accept-local-frame" | "accept-remote-frame"
    | "install-checkpoint-set" | "record-durable-ack"
    | "install-causal-floor" | "quarantine-object"
    | "start-prunable-journal-base"
  objectDigests: DigestV2[] // sorted unique, 1..256
  outboxRefDigest: DigestV2 | null
  resultingFrontierDigest: DigestV2
  operationRef: null | { actorId: ActorIdV2; operationId: Id128V2 }
}

interface LocalDurableHeadV2 {
  format: "convax.local-durable-head/2"
  scope: DocumentScopeV2
  localHeadGeneration: Uint64V2 // local recovery metadata only
  priorHeadDigest: DigestV2 | null
  journalBaseDigest: DigestV2
  journalTailDigest: DigestV2
  installedCheckpointSetDigest: DigestV2 | null
  acceptedFrontierDigest: DigestV2
  acceptedActorHeadsDigest: DigestV2
}
```

These records are local envelopes and never business winner inputs. Journal
sequence, head generation, inode, mtime and directory order do not enter portable
Project/Canvas state or wire proofs.

### 9.2 Local success barrier

Inside the per-shard Main writer mutex, local mutation order is exact:

1. reconstruct latest durable `replicaDoc`; allocate operation/identities/stamps;
2. clone isolated candidate, apply one intent and validate exact delta/write set;
3. sign one final causal frame with the long-lived actor key;
4. create/fsync immutable frame object and object directory;
5. create/fsync replication-outbox ref and outbox directory;
6. append/fsync journal record referencing both object and outbox ref; fsync a new
   segment directory entry when applicable;
7. atomically replace/fsync durable head so it includes that journal tail/frontier;
8. apply the exact accepted delta to in-memory `replicaDoc`, update session undo,
   publish projection invalidation and return `saved-locally`.

Transport MUST ignore every outbox ref whose frame is not reachable from the current
validated durable head. Caller cancellation before step 7 reports not saved;
cancellation after step 7 cannot roll back domain state and only suppresses stale
view effects.

### 9.3 Crash-point reopen matrix

Reopen first locks the Project writer, validates store manifests/digests and then
applies this table. It never reruns a business intent or signs replacement bytes.

| Durable evidence found | Authoritative reopen transition |
| --- | --- |
| no object/ref/journal/head | operation did not commit; return not-found/not-saved |
| frame object only, valid local next-chain signature | prefer completing the same exact frame; explicit abandonment requires proving no durable ref anywhere, quarantining the signed object and rotating actorId before another frame can use that sequence |
| frame object only, corrupt or not locally attributable | quarantine; do not advance head or transmit |
| outbox ref durable, journal absent, head old | transport remains gated; fully revalidate exact frame/base/intent, append the missing journal record and advance head, or enter read-only quarantine |
| journal durable, head old | validate object, outbox and journal chain; advance head to that exact tail, or enter read-only quarantine |
| outbox and journal durable but either counterpart missing | store corruption; read-only recovery, never delete the surviving evidence |
| new head visible after rename but directory-fsync result unknown | validate complete referenced closure; accept it if complete, otherwise keep Project closed; never guess the older/newer winner from mtime |
| head accepts frame, memory/projection absent | replay from installed checkpoint plus causal DAG and publish projection; do not re-sign |
| ACK durable, outbox cleanup missing | rebuild ACK index and idempotently clear only satisfied replica targets; frame remains accepted |
| outbox cleanup visible, ACK object missing | corruption; do not claim replication and retain/re-request exact ACK |

An object-only signed frame is never transmitted. Collecting it is legal only after
a complete durable-reference scan and actor rotation or proof that exact frame was
accepted elsewhere and restored locally. This closes the otherwise hidden
same-sequence double-signature risk.

`lookupLocalOperation({actorId,operationId})` is derived from accepted journal/head
and operation receipts:

- accepted returns the exact original frame/result;
- a durable ref below head first runs the same-frame recovery above;
- object-only returns recovery/not-saved, never re-executes under that id;
- same identity with different request/intent/frame digest is equivocation.

### 9.4 Remote receive and ACK barrier

Remote exact bytes are first create-new/fsynced in `inbox`/object storage. After
bounded structural, authorization/cutoff, exact-base and reducer/write-set
validation, Main appends journal and advances head. Only after the accepted object,
journal and head are all durable may it sign `ReplicaDurableAckV2`.

Crash before head yields no ACK and revalidates the same frame. Crash after head but
before ACK replays accepted state and may sign the ACK. Duplicate frame digest is
idempotent; same operation/sequence with different digest is equivocation. A durable
ACK proves structure only. Blob durability uses its separate hash/fsync/index
barrier and ACK.

## 10. Native store layout and authority

All document directory names are
`SHA-256("convax.native-document-store-key/2\0" || JCS(scope))`; raw Project,
Canvas, actor, operation, URI, path, Plugin or user text never enters a private
native filename. Every `<digest-native-key>` is
`SHA-256("convax.native-object-store-key/2\0" || ASCII(object-kind) || "\0" ||
decoded portable digest)`. Content-addressed blob paths are the sole safe exception:
their validated lowercase SHA-256 digest is the filename.

```text
<project>/.convax/
  project.json                                  stable projectId only
  collaboration/
    manifest-v2.bin                             projectEpoch/schema/store identity
    documents/<document-native-key>/
      objects/
        frames/<digest-native-key>.bin
        checkpoints/<digest-native-key>.bin
        certificates/<digest-native-key>.bin
        acks/<digest-native-key>.bin
        cutoffs/<digest-native-key>.bin
        reset-claims/<digest-native-key>.bin
      snapshots/
        sets/<digest-native-key>.bin             immutable set of 1..8 checkpoints
        staged/<digest-native-key>.ref
      journals/
        bases/<digest-native-key>.bin            immutable checkpoint/prunable base
        segments/<segment-native-key>.bin       chained local recovery records
      heads/
        durable-head.bin                        sole local accepted head pointer
      outbox/
        frames/<digest-native-key>.ref
        checkpoints/<digest-native-key>.ref
      inbox/
        pending/<digest-native-key>.ref
        unsupported/<digest-native-key>.ref
      floors/<digest-native-key>.bin
      prune/
        plans/<digest-native-key>.bin
        active-plan.bin
      recovery/<recovery-native-key>/
        manifest.bin
        refs/
      quarantine/<evidence-native-key>.bin
      reset/<claim-native-key>/manifest.bin
    blob-replication/
      presence-index-v2.bin                     rebuildable verified-holder index
      cache/sha256/<first-two-hex>/<digest>      ordinary-file replication/history bytes
      transfers/                                resumable local transfer metadata
      gc-v2.bin                                 rebuildable cache-GC timing
  assets/
    blobs/sha256/<first-two-hex>/<digest>        immutable verified bytes
    staging/<random-native-key>/
    gc-v2.bin                                    rebuildable delayed-GC timing
  staging/                                       short-lived user-file publication
```

`objects`, snapshot sets, journal bases and blob bytes are immutable/content-addressed.
Same digest with different bytes is corruption. Refs, journal records, durable head,
reset manifest and active prune plan are reachability/control records. Durable head
is the sole accepted checkpoint/journal pointer. Directory scans are recovery
evidence, not authority; every other index is rebuildable.

No package except `@convax/project/node` may access this tree. General Project Files
operations hide and protect `.convax` case-insensitively. Agent tools receive typed
capabilities and never edit collaboration storage.

## 11. Checkpoint install, pruning and object GC

### 11.1 Checkpoint installation

A checkpoint candidate has no prune authority. Installation verifies exact payload,
parents, content certificate, schema/artifact digests and local causal closure. A
post-prune bootstrap base additionally requires the exact
`PrunableCheckpointSetCertificateV2` and checkpoint payload.

Installation order is:

1. create/fsync every checkpoint/certificate object;
2. create/fsync one immutable installed-set object with 1..8 sorted unique checkpoint
   digests and all certificate/prunable-set digests;
3. append/fsync `install-checkpoint-set` journal record;
4. atomically replace/fsync the sole durable head so it references that exact set;
5. reconstruct and compare state-vector/canonical-state/frontier digests;
6. only then expose the checkpoint as a local bootstrap base.

A crash before the head barrier uses the prior installed set. A head referencing a
missing or invalid immutable set closes the shard read-only; it never selects a set
by mtime or directory order. Missing payload yields
`checkpoint-payload-unavailable`, not an empty doc.

### 11.2 Prune plan

Pruning requires the exact dual-gated prunable certificate. Before deleting any
history, Main writes an immutable `PrunePlanV2` binding:

- exact scope, current durable-head and installed-set digests;
- exact prunable-set certificate and floor;
- sorted retained-root digest pages;
- sorted candidate-delete object digest pages;
- a new journal-base descriptor rooted in the retained checkpoint set.

One plan covers <=65,536 refs, <=16 MiB plan/pages, <=4,096 object deletions and
<=512 MiB deleted frame/checkpoint payload. Larger work is split into independent
plans after each new head barrier. Exceeding a cap postpones deletion; it never
truncates the root set.

The plan and immutable new journal-base object are fsynced, then the sole durable
head is atomically advanced to reference that base. Only after that barrier may
listed unreferenced objects move to a private trash batch and be unlinked. A crash
resumes the same plan idempotently. If any root changed, the plan is stale and must
be abandoned without deletion.

Exact retained roots include:

- installed checkpoint payload/certificates/floors and actor sequence boundaries;
- current head/journal base and every frame needed after that base;
- pending inbox/base dependencies, outbox, unsatisfied ACK and active transfers;
- operation/derived-identity receipts and semantic-history requirements;
- cutoff/equivocation/quarantine/recovery/audit evidence;
- staged route/reset/project-reset publications;
- current ProjectIndex resource versions, active conflict copies and every live or
  retained-history Canvas resource proof.

Metadata-only checkpoint, digest-only base witness and newer-snapshot validation are
forbidden. A late below-floor frame is invalid/recovery evidence, not reapplied to a
newer base.

### 11.3 Object collection

Unreferenced immutable objects not named by a legal prune plan may be collected only
when they are local staging/orphans that never obtained a durable ref. Accepted
frame/checkpoint payloads require the dual-gated prune plan. Journal segment ordinal,
old head generation and stale remote ACK do not independently keep business history
alive, but any ambiguity retains bytes and blocks deletion.

## 12. Blob presence, replication and GC

The local blob presence index contains only rebuildable facts: digest, length,
location kind (`ordinary-open-handle`, `managed-object` or `replication-cache`),
verified native object key and last completed verification generation. It is not
portable state and cannot choose current content. Native paths never leave the
adapter.

Blob receive/publish order is:

1. write bounded chunks to a unique no-follow staging object;
2. verify exact total length and full SHA-256 from the opened handle;
3. create-new publish to the content-addressed path, fsync file and directories;
4. atomically update/fsync the local presence index;
5. only then issue the local admission token or sign `BlobDurableAckV2`.

A frame durable ACK and blob ACK are independent. A resource-bearing operation is
`blob-replicated` only when one current remote replica has durably ACKed the frame
and each newly referenced blob. `fully-offline` requires every current local
resource root to pass opened-handle hash/length verification. Missing media never
invalidates structural ProjectIndex state, but playback/open remains unavailable.

Blob roots are the union of:

- current immutable/overwritable/text ProjectIndex projections;
- every active conflict copy;
- live and retained-history Canvas references, including suppressed generation and
  semantic undo material;
- frame/checkpoint/outbox/recovery/quarantine resource proofs;
- conflict reservations whose source branch must be preserved;
- staged publication/reset, active transfer and partial-success reports.

An overwritable-binary loser is not a root merely because its version receipt
remains. A stale remote ACK is not a root. Sequential superseded text bytes cease to
be roots unless conflict/history/Canvas evidence retains them.

Managed or replication-cache bytes with no root enter their `gc-v2.bin`. Deletion
requires a complete root scan,
at least seven days of conservative local elapsed time, and a second complete scan
in a later process/store generation. Clock rollback/jump uncertainty postpones
deletion. GC persists the next timing state before unlinking <=1,024 blobs or
<=16 GiB per batch. A cap excess splits work; unreadable ProjectIndex/Canvas,
unknown schema, symlink/digest mismatch or incomplete scan deletes nothing.

Ordinary Project files, including `Notes/`, `Generated/` and
`.convax-conflicts/**`, are never blob-GC targets. Their deletion requires an
explicit Project file operation. An unreferenced local cache replica may be evicted,
but the device then loses `fully-offline` status until it reacquires the bytes.

## 13. Breaking Project cutover and reset

All `/1` collaboration bytes, path-only Project metadata, legacy JSON Canvas
catalog/documents and v9 accepted/working/local-fork stores are unsupported portable
bytes. Open detects and inventories their exact paths, sizes and digests without
hydrating, rewriting, compacting, migrating, deleting or garbage-collecting them.

The only choices are cancel/close or explicit destructive Project reset. The UI
shows the exact private deletion set and requires a second confirmation. Ordinary
Project files are out of that deletion set unless the user invokes a separately
named filesystem deletion action.

The security objects are imported from the exact control-plane artifact; Project
does not restate, weaken or partially decode them:

```ts
type ProjectResetReasonV2 =
  import("@convax/project/collaboration-protocol").ProjectResetReasonV2
type ProjectResetConfirmationV2 =
  import("@convax/project/collaboration-protocol").ProjectResetConfirmationV2
type ProjectResetApprovalV2 =
  import("@convax/project/collaboration-protocol").ProjectResetApprovalV2
type TeamEpochRolloverReceiptV2 =
  import("@convax/project/collaboration-protocol").TeamEpochRolloverReceiptV2
```

```ts
interface ProjectResetManifestV2 {
  format: "convax.project-reset-manifest/2"
  resetId: Id128V2
  projectId: ProjectIdV2
  oldProjectEpoch: Id128V2 | null
  newProjectEpoch: Id128V2
  newMembershipEpoch: Id128V2 | null
  newProjectIndexShardEpoch: Id128V2
  reason: ProjectResetReasonV2
  observedOldPrivateTreeDigest: DigestV2
  unsupportedInventoryDigest: DigestV2
  privateDeletionSetDigest: DigestV2
  requestedProtocolDigest: DigestV2
  requestedSchemaDigest: DigestV2
  requestedUriProtocolDigest: DigestV2
  emptyProjectIndexCheckpointDigest: DigestV2
  emptyProjectIndexFullUpdateDigest: DigestV2
  emptyProjectIndexStateVectorDigest: DigestV2
  emptyProjectIndexCanonicalStateDigest: DigestV2
  projectResetConfirmationCoreDigest: DigestV2
  projectResetApprovalCoreDigest: DigestV2 | null
  teamEpochRolloverRequestDigest: DigestV2 | null
  emptyProjectIndexGenesisAttestationCoreDigest: DigestV2 | null
  teamEpochRolloverReceiptCoreDigest: DigestV2 | null
  state:
    | "reset-staged" | "reset-authorized" | "reset-publishing"
    | "reset-published" | "reset-retiring-old" | "reset-complete"
}
```

Reset preserves stable `projectId`, allocates a fresh random `projectEpoch` and
ProjectIndex shard epoch, and constructs an empty v2 ProjectIndex with only root
directory and genesis identity. `requestedSchemaDigest` is this exact
project-persistence artifact digest, `requestedProtocolDigest` is the instantiated
bundle core digest and `requestedUriProtocolDigest` is the separately frozen URI
protocol digest.

For every reset, the full `ProjectResetConfirmationV2` is durably stored beside the
manifest and its verified `coreDigest` equals
`projectResetConfirmationCoreDigest`. Its core has the manifest's exact `resetId`,
Project/old epoch, reason, three old-tree/inventory/deletion digests and three
requested protocol digests; its `protocolDigest` and `requestedProtocolDigest` both
equal the manifest's bundle digest. It also fixes stable Project-id preservation,
ordinary Project-file preservation and the exact deletion statement. A team Project
has a non-null old epoch, uses the control-defined `team-replica`
`confirmationPrincipal` and additionally stores the full
`ProjectResetApprovalV2`; its core binds the same reset, confirmation, Project/old
epoch, reason, inventory, deletion and requested protocol digests, and its own
`protocolDigest` equals that bundle digest, while its verified `coreDigest` equals
`projectResetApprovalCoreDigest`. An unteamed Project has null old/membership epoch,
approval, rollover request, genesis attestation and rollover receipt fields and uses
only the control-defined `local-project-owner` principal. Its confirmation key MUST
resolve from the pre-existing durable Project binding named by the principal's
binding digest/key id; reset bytes cannot introduce or authorize that key.

The team rollover receipt is the exact imported `TeamEpochRolloverReceiptV2`, not a
Project-local receipt lookalike. Before publication, Project verifies its service
signature and requires its core to equal the manifest in `resetId`, Project,
old/new Project epoch, new membership epoch, new ProjectIndex shard epoch, reset
confirmation/approval core digests, all four empty ProjectIndex digests and the
requested protocol, schema and URI protocol digests. `teamEpochRolloverRequestDigest`,
`emptyProjectIndexGenesisAttestationCoreDigest` and
`teamEpochRolloverReceiptCoreDigest` equal the receipt core's `requestDigest`,
`emptyProjectIndexGenesisAttestationCoreDigest` and verified receipt `coreDigest`.
The receipt's `newProjectIndexScope` is exactly the staged ProjectIndex scope and its
Project/epoch/shard fields match the manifest. The receipt's trust bundle, service
key, membership snapshot, new credentials, retirement state and reset counter are
verified under the control-plane contract and retained verbatim; Project MUST NOT
infer or reconstruct them.

Service unavailability may stage bytes but cannot report authorization or
completion. No control-plane payload bytes are defined here.

Native order is:

1. acquire exclusive Project writer/reset lock and fence old sessions/writers;
2. fsync unsupported inventory, deletion manifest and the exact reset confirmation;
3. build/verify/fsync a complete new `.convax` tree in same-filesystem staging;
4. for a team Project, persist the exact approval and single-use rollover receipt,
   revalidate every equality above, then fsync `reset-authorized`;
5. fsync `reset-publishing`, atomically rename/swap the complete tree and fsync the
   Project root directory;
6. reopen and verify new manifest/genesis before writing `reset-published`;
7. move the old private tree to a recoverable retirement name, fsync, then delete
   only its approved private set and finish.

Before the atomic publication point the old tree is sole authority. After it, the
new tree is sole authority and old bytes are recovery/retirement only. Reopen resumes
the exact manifest, ids, receipts and staged tree. If filesystem evidence cannot
prove which complete tree won, the Project remains closed as
`reset-recovery-required`; it never assembles a tree from both sides or repeats the
epoch rollover with new ids.

The approved old private set may include old `.convax` ProjectIndex/Canvas stores,
journals, checkpoints, outboxes, recovery, quarantine, managed assets and private
metadata. It MUST preserve the bound root directory's ordinary files,
`.convax-conflicts/**`, `Notes/**`, `Generated/**` and stable `projectId`.

## 14. Failure-state contract

| State/error | Required behavior |
| --- | --- |
| `saved-locally` | exact frame accepted by durable head; offline editing may continue |
| `outbox-backpressure` | freeze new durable mutation; retain/export user work |
| `dependency-pending` | retain bounded exact bytes; do not project or ACK |
| `project-index-capacity-exceeded` | read/export remains; no silent pruning/reset |
| `live-canvas-scope-capacity-exceeded` | keep existing routes readable; reject activation beyond 4,095 live Canvas routes |
| `pending-editor-floor-stale` | ProjectIndex route projection changed; discard root/pages and derive a fresh certified manifest |
| `unsupported-native-path` | read-only; list exact collisions; no invented names |
| `unsupported-portable-version` | preserve every unsupported byte until confirmation |
| `shard-reset-staged` | old route sole live; same staging may continue or be abandoned |
| `shard-reset-awaiting-route-cas` | only exact claim/frame retry; no abandonment |
| `shard-reset-recovery-required` | new route is current if CAS accepted; old stays recovery-only |
| `unsupported-old-shard` | retain old bytes; never route them live |
| `project-reset-required` | ProjectIndex untrusted; no Canvas-local bypass |
| `reset-recovery-required` | ambiguous tree swap; keep complete Project closed |
| `structure-ready-media-missing` | metadata edits allowed; exact resource open blocked |
| `blob-gc-scan-incomplete` | retain all candidate bytes |
| `equivocation-quarantine` | retain both proofs; freeze affected chain/descendants |

No state silently resets a Project, chooses first arrival, rewrites unsupported
bytes, changes Project identity, deletes ordinary files or converts local durability
into a false team-replication promise.

## 15. Mandatory golden, model and crash tests

### 15.1 Cross-runtime golden fixtures

Bun, Chromium and the public Project verifier MUST independently produce identical:

- every scalar/derived id, key codec, record digest and portable stamp order;
- empty ProjectIndex genesis, root topology, canonical state hash/state vector;
- create/move/relink/tombstone, text conflict and binary overwrite intent JCS;
- Project URI entry/revision comparisons and atomic resource reference/proof;
- Canvas stage/activation/tombstone/reset route projection;
- shared `cv_<64hex>` Canvas id across route, Canvas identity and document scope;
- content-certified `ProjectIndexLiveScopeManifestV2` and exact required floor set;
- `DocumentShardResetClaimV2`, route-CAS core and signature preimage;
- local outbox/journal/head record bytes and every exact/over-one cap rejection.

Two clean implementations given only the canonical bundle must accept/reject the
same hostile records without consulting old drafts or repository source.

#### 15.1.1 Exact closure vectors

These fixtures use exact restricted JCS. Hashes were independently reproduced by
two generators. The counterfactual checksum is test-only raw SHA-256 over its JCS
bytes; it is not a protocol digest domain and does not enter the registry.

**Vector P — live managed primary file projection**

```text
domain:
convax.project-file-projection/2

JCS:
{"activeConflictProjectionDigests":["5555555555555555555555555555555555555555555555555555555555555555","6666666666666666666666666666666666666666666666666666666666666666"],"contentFamilyProjectionDigest":"3333333333333333333333333333333333333333333333333333333333333333","currentResourceReferenceDigest":"4444444444444444444444444444444444444444444444444444444444444444","entryFileId":"pf_0000000000000000000000000000000000000000000000000000000000000000","entryRecordDigest":"1111111111111111111111111111111111111111111111111111111111111111","familyPrimaryFileId":"pf_0000000000000000000000000000000000000000000000000000000000000000","format":"convax.project-file-projection/2","locationProjectionDigest":"2222222222222222222222222222222222222222222222222222222222222222","state":"live-managed-unlocated"}

SHA-256(domain || 0x00 || JCS):
28b0249ca91069e3652350afc7c45ecb58793fdf3b15900e33ee39764b556910
```

**Vector Q — closed invalid counterfactual outcome**

```text
JCS:
{"entryId":"pf_0000000000000000000000000000000000000000000000000000000000000000","format":"convax.project-entry-location-counterfactual-outcome/2","reason":"accepted-record-removal-invalidated-resolution","status":"invalid"}

test-only SHA-256(JCS):
9fad350365a248edc61a1fcb64548a01c90418627a1ac4515a6a2d10252bd473
```

### 15.2 Convergence/model fixtures

Message arrival permutations, duplicate delivery and two/three/nine-Peer partitions
MUST prove:

1. concurrent same-path create preserves all stable ids and chooses one portable
   winner plus deterministic path-conflict locations;
2. sequential text writes advance one primary family, while concurrent writes keep
   every branch under preallocated stable conflict ids with no silent LWW;
3. binary overwrites select exact logical-counter/actor winner independent of time;
4. concurrent moves and directory cycles produce identical paths on all platforms;
5. tombstone beats late location/version facts and never resurrects an entry;
6. route activation waits for exact genesis dependency; tombstone beats late Canvas
   frames; concurrent reset claims expose one current route and retain losers;
7. resource proof validates structurally with missing bytes, while open/ACK waits for
   exact local hash/length durability.
8. a ProjectIndex-live Canvas absent from registry remains in the pending editor's
   required floor set; a registry-only tombstoned scope never grants/denies or blocks;
   a route change before activation makes the manifest/root stale.
9. multi-file import commits independent file-create frames, reports the exact
   partial subset after interruption and has no encodable atomic bulk variant.
10. Project reset rejects a reset-byte-introduced local key, a mismatched
    confirmation/approval/proof/receipt core, any staged empty-ProjectIndex digest
    mismatch and every team receipt whose exact service identity or new scope is
    stale; exact retry preserves the same reset and receipt bytes.

### 15.3 Frame crash matrix

Fault injection stops after each create-new, file fsync, directory fsync, outbox
write, journal append, head-temp fsync, head rename and head-directory fsync.

- Object-only bytes are never transmitted and cannot lead to a same-sequence
  replacement signature.
- Outbox/journal durable below head completes the exact signed frame or quarantines;
  it is never abandoned, replayed as a new operation or exposed before head.
- Head accepted/memory absent rebuilds the same ProjectIndex hash.
- ACK-before-crash always has accepted object/journal/head; no durable ACK means the
  sender safely resends exact bytes.
- `{actorId,operationId}` response-loss lookup returns the same frame/result.

### 15.4 Reset, checkpoint and GC crash matrix

Inject crashes before/after staged genesis, claim, first route-frame ref,
ProjectIndex route head, new-shard install and old-shard retirement. Before CAS old
is sole live; after CAS new is sole current; only pure staged state is abandonable;
every retry uses the same claim.

Inject crashes at checkpoint object, installed-set, journal-base, head, prune-plan,
trash move and unlink. No object with an outbox/pending/recovery/history/resource
root may disappear; no metadata-only certificate may authorize pruning.

Inject crashes at blob staging, publish, index, ACK, first GC scan, second scan and
unlink. ACK implies durable verified bytes/index. Unknown schema or incomplete scan
deletes nothing.

For whole-Project reset, snapshot unsupported bytes before every phase. No byte may
change before confirmation. Every reopen selects one complete old/new tree or stays
closed; ordinary Project files and stable projectId remain byte-identical.

### 15.5 Revision-4 closure conformance

This revision closure is wrong or incomplete if any of these tests fails:

1. **Descriptor golden:** independently encoded descriptor JCS yields one digest;
   field reordering leaves JCS/digest unchanged, while changing owner, schema,
   format, codec or policy changes it. Unknown/missing fields reject.
2. **Owner mismatch:** a Project frame carrying a Canvas descriptor, another schema
   digest or a caller-selected `canonicalizerDigest` rejects before Yjs apply.
3. **Yjs-history independence:** two ProjectIndex Y.Docs constructed through
   different update/client/arrival histories but with the same nine maps yield
   byte-identical `ProjectCanonicalStateV2` and canonical-state digest.
4. **Nine-root exactness:** missing/extra roots, wrong shared type, nested Yjs value,
   wrong key/value id, non-ASCII/oversized key, duplicate tuple or unknown record
   rejects. Exact genesis yields one identity tuple, one root entry, six empty fact
   maps and empty operations: seven empty root slots total after `identity` and
   `entries`.
5. **Canonical-byte exactness:** noncanonical JSON, omitted required null, sparse
   array, lone surrogate, duplicate set item or parse/re-encode byte mismatch
   rejects before hashing.
6. **No dual state digest:** every field named
   `projectIndexCanonicalStateDigest` equals the kernel formula; scanning generated
   digest code finds no use of `convax.project-index-canonical-state/2` as a domain.
7. **Projection determinism:** permuting input fact/Yjs iteration order leaves
   location, family, conflict, file and route digests unchanged. Every row of the
   location, conflict and file state-by-role tables has a positive vector. Removing
   each candidate record independently includes its digest iff the exact tagged
   counterfactual JCS changes. Direct loser, inherited loser, winner replacement,
   removed ancestor to valid orphan, selected-claim fallback, selected-claim removal
   to the invalid tag, SCC, dormant/reserved/explicit conflict and irrelevant-loser
   vectors agree in two clean-room reducers. Neither reducer represents invalid as a
   symbol, exception or `ProjectEntryLocationOutcomeValueV2`. A non-current losing
   route fact does not change the live route projection.
8. **Guard precision:** a content write does not stale an entry-location guard; a
   parent move that changes the resolved path does. A losing binary version changes
   family evidence but does not silently become current. A route reset changes the
   route guard and live-scope entry.
9. **Actual-write exactness:** every one of the eleven Project intents produces the
   exact allowed new root/key set including `operations`; an extra, missing,
   overwritten, deleted or unchanged-padding write rejects. Replacing a value under
   another root/key changes `valueDigest`. The generated digest dependency graph
   topologically sorts exactly as section 4.3.8; adding an evidence digest to the
   operation receipt or any other back-edge fails generation before hashing.
10. **Reset nominal codec:** a raw 22-character `Id128V2` in
    `initiatorReplicaId`, mixed-case replica spelling or unreserved replica rejects
    before signature verification and before the CAS callback is invoked.
11. **Reset chain mismatch:** independently mutate claim, confirmation, credential
    receipt or edit-authorization member/replica/actor/key/role/edit-state fields
    while retaining otherwise valid signatures. Viewer, pending-editor, revoked,
    downgraded and floor-stale initiators reject through the Control algorithm and a
    spy proves zero Project candidate mutation.
12. **Valid reset:** one vector whose claim/confirmation/credential tuple,
    reservation pair/key and exact current `ReplicaEditAuthorizationV2` are closed
    verifies both initiator signatures under one active-editor key, verifies current
    admin authority and performs exactly one idempotent route CAS.
13. **One-shot permit and exact bytes:** reuse for another candidate, changed route,
    changed admin, downgrade between initial F13 and consume, structured clone and a
    second consumption all reject. Mutate each complete wrapper and each signature
    byte independently while preserving its advertised core digest; the closed
    `exactInputBytes` comparison or final complete F13 rejects every mutation.
    Candidate id is exactly 16 secure-random bytes, nonce is exactly 32 independent
    secure-random bytes, the candidate binding has exactly eleven fields, and every
    nested record field is required with unknown fields forbidden. Concurrent and
    synchronous re-entrant calls allow exactly one `issued -> consuming` winner.
    Every post-claim pre-reducer verifier pending/rejection, mismatch, cancellation
    and exception reaches `spent`, zeroes the nonce, releases once and leaves the
    candidate untouched. Every fully revalidated attempt reaches `consumed`
    immediately before exactly one reducer entry; reducer/sign/persist/durable
    failure leaves it `consumed` and the same permit never retries.
14. **Bundle regeneration:** the final registry is the exact revision-4 kernel raw-UTF-8
    sorted union, contains all 35 additions once, omits both the retired Project
    digest domain and forbidden Canvas-private domain, and has count 123. Every
    artifact/core/protocol/main pin independently recomputes from final bytes.
15. **Breaking open:** an old project is never silently reset or migrated; cancel
    preserves bytes, confirmation deletes only the displayed private set, and the
    new Project epoch opens with the exact genesis canonical digest.
16. **File projection totality:** every row of the section 4.3.4 table verifies exact
    null/non-null/empty/singleton/family-array fields. Every unlisted role/state pair,
    directory id, dormant primary, managed conflict-copy, cross-family digest,
    wrong conflict source version, mismatched location digest, null live resource or
    non-empty dormant/tombstoned conflict array rejects.
17. **Counterfactual totality:** accepted base is always the valid tag. Removing an
    ancestor entry yields the valid orphan value; removing a selected claim selects
    its exact fallback or yields the invalid tag; removing a required ancestor claim,
    promotion, reservation or version-DAG record yields one exact valid/invalid tag.
    The removed digest is included exactly when the tagged JCS bytes differ. An
    unrelated invalid branch is ignored and an invalid base rejects before hashing.
18. **Permit witness/TOCTOU/crash matrix:** inject accepted-head advancement at
    acquire, A1, during initial F13, A2, after issue, A3, during final F13, A4 and the
    reducer-entry boundary. Acquisition/A1/initial-F13/A2 failure creates no record;
    A3/final-F13/A4 failure produces `issued -> consuming -> spent`; after successful
    A4 the lease blocks publication until reducer entry. Assert exactly four times,
    release exactly once and never let a losing/re-entrant call release the winner's
    witness. Kill or throw before claim, at every Control verifier step, after
    `consuming`, immediately after `consumed`, during reducer, after signature and at
    every object/outbox/journal/head barrier. Restart never reconstructs a witness or
    permit. No durable frame ref requires fresh verification; an exact retained frame
    ref resumes only that frame; a committed head returns the committed route without
    reducer replay or re-signing.

## 16. Red-team decision

### Strongest three objections

1. **Append-only ProjectIndex state still has a hard lifetime ceiling.** The design
   refuses silent record deletion, so a very old/high-churn Project may reach the
   32 MiB checkpoint or retained-record cap and require export/project reset rather
   than transparent compaction.
2. **File/YDoc atomicity is intentionally absent.** File-first publication avoids
   deleting user bytes, but crashes and failed Canvas commits leave visible or
   managed orphans that need product-grade partial-success and GC handling.
3. **Project-owned route reset raises availability cost.** If ProjectIndex is
   damaged, a single Canvas cannot self-reset; the entire Project must remain closed
   or roll `projectEpoch`. An independent `docEpoch` would be more available only by
   creating a second route authority.

### Flaw types checked

- **duplicate authority:** no JSON/service/filesystem index decides Project route,
  file identity or current content;
- **hidden LWW/arrival assumption:** all location/version/route conflicts use closed
  portable projection or grow-only delete;
- **locality leak:** paths, inodes, fsync/index generations and admission tokens do
  not enter portable bytes;
- **lifecycle omission:** every object/outbox/journal/head, shard reset, checkpoint,
  blob and tree-swap crash state has a deterministic reopen transition;
- **destructive authorization gap:** unsupported bytes are immutable until exact
  reset inventory and second confirmation are durable;
- **alternative omission:** online sequencer, whole-document CAS, Y.Text-everywhere,
  independent docEpoch and cross-file WAL were considered and deliberately rejected.

### Falsifiable signature gate

This appendix is wrong and its signature is revoked if any implementation can:

1. produce a different ProjectIndex hash from another runtime for the same facts;
2. accept an unknown root/key/value or write outside the intent's exact set;
3. lose a concurrent text branch or let path/clock/arrival choose current content;
4. transmit an outbox frame not reachable from durable head;
5. reexecute/re-sign an operation after object/outbox/journal/head crash;
6. abandon or replace a reset claim after its route frame has a durable ref;
7. expose old route after accepted route CAS or expose two current shards;
8. prune without both the prunable certificate and complete local root scan;
9. sign a blob ACK before exact bytes and local index are fsynced;
10. mutate unsupported bytes before confirmation or delete ordinary Project files
    during Project reset.

Retained revision-3 surface score: **8.7 / 10**. The deductions are the finite append-only ProjectIndex lifetime,
intentional file/document partial success and ProjectIndex-coupled shard recovery.
They are nonfatal under the stated v1 product boundary because they fail closed,
retain user bytes and do not introduce a second Project authority or silent winner.
This historical score does not sign the changed revision-4 artifact bytes.

Revision-3 retained-surface decision: **historical SIGN 8.7/10**. It does
not sign the changed revision-4 exact bytes.

Revision-4 closure change log:

- retained the revision-3 shared identity/stamp codecs, content-certified live-scope
  floor, independent multi-file partial-success semantics, native barriers,
  checkpoint/blob GC and breaking-reset recovery;
- bound Project to the one kernel-owned canonicalizer descriptor and replaced the
  private Project canonical hash with exact restricted-JCS bytes for all nine roots
  plus the sole kernel canonical-state digest;
- closed location/counterfactual, conflict, content-family, file, route and
  actual-write projections as an acyclic digest ledger, added the approved seven
  kernel/Project domains and retired the old private digest domain;
- corrected the reset member/replica nominal triad, required the current
  active-editor credential/reservation/edit-authorization chain, and added the
  Project-private witness plus exact 9/16/11/45 PermitRecord closure;
- bound both reset decisions to the same complete Control F13 verifier and closed
  A1..A4, one-shot A+C, no-gap reducer entry, exactly-once release and crash behavior;
- added exact Project closure vectors P and Q.

Mechanical source: approved Owner closure SHA-256
`4bfc55a7bbef440b310215e9363fb53585acfb395db7176e58e0af0cf86e92fd`.
The revision-4 bundle, `project-persistence` artifact and portable protocol
identities are instantiated only by the pinned collaboration-kernel section 18 and
canonical Main section 1. This Project appendix embeds none of those concrete
identities because its own complete bytes participate in the artifact computation.
No previous whole-file, artifact or bundle identity is copied forward.

The whole-file SHA-256 is detached because a file cannot contain its own stable hash
without an exclusion rule. Any semantic edit requires a new digest and 3/3 review.

## 17. Revision 5.1 normative persistence and recovery replacement

This section is normative Revision 5.1 authority and replaces every conflicting
Revision 4 persistence, wrapper-reference, limit and recovery statement. Unchanged
ProjectIndex semantics, file/blob policy, reset confirmation and private-project
ownership rules remain normative.

### 17.1 Separate local-authoring and remote-admission barriers

The sole native writer uses these exact durable orders.

Local authoring:

```text
immutable frame object fsync
  -> authoring replication-outbox ref fsync
  -> accepted journal ref fsync
  -> sole accepted-head CAS/fsync
  -> in-memory replica and projection
```

Remote admission:

```text
immutable remote frame object fsync
  -> durable pending-inbox ref fsync
  -> complete incoming validation
  -> accepted journal consumes the exact inbox receipt and fsyncs
  -> sole accepted-head CAS/fsync
  -> in-memory replica and projection
  -> durable ACK eligibility
```

A remotely received frame never creates an authoring replication outbox. Pending
inbox cleanup after accepted head is idempotent housekeeping and is not an ACK
precondition. Object-only, inbox-below-head and journal-below-head restart states
recover the exact retained bytes. Recovery never reruns owner decoding, reducer,
history materialization, external-fact discovery, signer or id allocator. A frame is
duplicate-success only if its request, exact object ref, frame digest, scope, actor,
operation id and actor sequence all match and the accepted head can reach it.

### 17.2 Exact signed-wrapper storage and conflict indexes

Checkpoint, content-certificate, floor-ACK and prunable-certificate native object
keys use their Revision 5.1 complete wrapper object digest. Native indexes retain:

```ts
interface SignedWrapperIndexEntryV2 {
  readonly wrapperKind:
    | "replica-checkpoint"
    | "checkpoint-content-certificate"
    | "replica-causal-floor-ack"
    | "prunable-checkpoint-set-certificate"
  readonly coreDigest: DigestV2
  readonly objectDigests: readonly DigestV2[]
  readonly state: "unique" | "equivocated"
}
```

The first valid wrapper creates `unique`. A byte-distinct valid wrapper with the
same kind/core changes the index atomically to terminal `equivocated` and retains
both objects. A conflicting logical subject is also retained and quarantined. No
repair, startup scan, checkpoint installer, coverage calculator, GC or pruning path
may select one object, rewrite a parent, collapse the set or use arrival order.

All ProjectIndex route/reset/live-scope/registry/floor records and native refs use
the Control Revision 5.1 `...ObjectDigest` field names. The removed Revision 4 names
are rejected as unknown keys. Directory names and native-key codecs derive only
from exact object digests; raw digest text, paths, wrapper core digests and logical
subjects never directly form native paths.

### 17.3 State-vector overflow remains readable but not editable

Local candidate base and post vectors of 65,536 bytes pass. A 65,537-byte vector
returns exact `state-vector-limit` before signing or durable writing. Incoming base
or post vectors over the same cap are invalid frames. If already accepted state
materializes an over-cap vector, its canonical state, projection, read APIs and
bounded nonportable export remain available, but all current-epoch local mutation,
incoming mutation, editable claims and durable ACKs reject until explicit Project
new-epoch reset.

The portable `StateVectorV2` and all Peer inventory/sync DTOs remain capped and
non-null. A nonportable projection reports:

```ts
interface MutationAvailabilityProjectionV2 {
  readonly stateVector: StateVectorV2 | null
  readonly mutationAvailability: "available" | "reset-required"
  readonly observedStateVectorByteLength: number
}
```

Only the bounded nonportable `AcceptedStateExportV2` may carry the uncapped vector.
`null` means unavailable due to required reset and is never interpreted as an empty
Yjs vector.

### 17.4 Frontier and lifecycle persistence obligations

Every raw/wire/IPC/port frontier is rejected above 256 before closure, reduction or
allocation. Only an already-capped internal frontier plus operation-bounded new
heads may reduce first: internal 256 plus one dominating head may reduce and pass;
a final 257-head frontier rejects. A raw 257-head input rejects even when reducible.

Document lifecycle is `open -> closing -> disposed`. `dispose()` is an idempotent
Promise: it synchronously marks closing, rejects new work, drains the same exclusive
queue, clears undo/pending state, destroys documents and emits no projection after
closing. Cancellation before accepted-head CAS leaves no commit; cancellation or
dispose after CAS cannot roll back the durable commit and must not repopulate undo
or projection. A later open reconstructs only from the durable checkpoint/journal/
head chain.

### 17.5 Breaking-open and falsifiers

Revision 4 collaboration bytes are unsupported under Revision 5.1. Open may
inventory and preserve them, but cannot hydrate, migrate, rewrite or garbage-collect
them before the explicit destructive reset confirmation. Reset creates a new
Project epoch and deletes only the confirmed private collaboration set; ordinary
Project files remain untouched.

Revision 5.1 is falsified if remote admission creates an authoring outbox; if an ACK
precedes accepted-head durability; if recovery invokes owner/business callbacks; if
a same-core wrapper conflict has a selected winner; if a core digest forms a native
wrapper path; if accepted over-cap state becomes unreadable or editable; if raw 257
frontier input reaches reduction; if dispose races outside the document queue; or
if an old project is changed before explicit reset confirmation.

## 18. Revision 5.2 normative native ingress and wrapper-index replacement

This section is terminal Revision 5.2 Project/native authority and replaces every
conflicting Revision 5.1 recovery, ingress-port and wrapper-index statement.
Revision 5.1 is unsupported portable/native collaboration state and may only follow
the preserved explicit-reset path.

### 18.1 Durable ingress records and typed receipts

The kernel owns the generic schemas/ports; `@convax/project/node` is their sole
native implementation. Its ingress ledger persists a stable transfer index, current
attempt, exact manifest, declared charge and stage:

```ts
type RemoteIngressStageV2 =
  | "reserved" | "staging" | "object-durable" | "inbox-durable"
  | "journal-durable" | "head-durable" | "released" | "quarantined"

interface RemoteIngressReservationRecordV2 {
  stableKey: StableRemoteTransferKeyV2
  manifestDigest: DigestV2
  currentConnectionId: string
  exactManifestJcs: Uint8Array
  declaredByteLength: Uint64V2
  stage: RemoteIngressStageV2
}
```

The stable index key excludes connection id. An attempt key includes it and may CAS
take over only the same manifest/reservation. Every transition returns a private
live receipt bound by object identity and exact durable record digest:

```text
RemoteIngressReservationReceiptV2
RemoteFrameObjectReceiptV2
RemotePendingInboxReceiptV2
```

The reservation receipt gates bounded staging. Kernel consumes one
`PayloadParsedIncomingFrameV2` capability and the reservation receipt, then the
object receipt proves the same structurally parsed exact staged bytes were fsynced
under their frame object digest. The inbox receipt proves a closed
`RemotePendingInboxRefV2` naming that exact object and reservation was fsynced. Only
after both receipts are verified does Kernel mint
`ObjectAndInboxDurablePayloadParsedV2`. Each receipt/capability is one-use,
frame/member/Project/attempt bound and is never portable document authority.

Project/member accounting covers every reserved, staged, object-before-inbox and
inbox item. Reservation-only or partial-staging cancellation/reopen may delete those
non-authoritative bytes and durably release the complete charge after proving no
object/inbox exists. Moving to quarantine atomically moves, never first releases,
the charge. Repeated exact frame/manifest retries do not charge twice.

### 18.2 Separate journal admission ports

`CollaborationPersistencePortV2` exposes distinct methods owned by the kernel:

```ts
appendAcceptedJournalFromOutbox(
  outboxReceipt: LocalAuthoringOutboxReceiptV2,
  validated: FullyValidatedLocalFrameV2,
): Promise<AcceptedJournalReceiptV2>

appendAcceptedJournalFromInbox(
  inboxReceipt: RemotePendingInboxReceiptV2,
  validated: FullyValidatedIncomingFrameV2,
): Promise<AcceptedJournalReceiptV2>
```

There is no nullable shared source parameter. The journal record is a closed union:

```ts
type JournalAdmissionSourceV2 =
  | { kind: "local-authoring-outbox"; refDigest: DigestV2 }
  | { kind: "remote-pending-inbox"; refDigest: DigestV2;
      reservationRecordDigest: DigestV2 }
```

Every accepted journal record binds expected accepted-head digest, exact source ref,
frame/object digest, scope, actor, operation id, actor sequence, resulting frontier
and actor-head commitments. The inbox method atomically consumes the exact inbox
receipt and fully-validated capability in the sole-writer queue. One inbox can
produce at most one exact journal.

### 18.3 Provenance-specific crash recovery

Remote reservation/staging below object is cleaned or resumed under the same charge.
Remote object-only or inbox-below-journal restarts from retained exact bytes through
the full four-capability incoming validation chain: header authority, actor
equivocation, structural five-section parsing, object/inbox proof, exact declared
dependencies, exact base, owner decode/pure isolated apply, evidence, delta and
post-state. It never calls a public
local command, history materializer, fresh fact discovery, signer or allocator.
Missing declared bytes stays pending; invalid bytes quarantine.

Remote journal-below-head first verifies the exact journal/object/inbox/reservation
closure and then CASes only its persisted expected head. A different current head
is stale/corruption quarantine, never a rebase. It invokes owner callbacks zero
times. Head-durable cleanup/release is idempotent. Remote rules never collect or
reinterpret a local-authoring object-only state; local recovery retains its existing
actor-sequence/double-sign safety.

### 18.4 Durable core and subject indexes

The sole writer maintains both:

```ts
interface SignedWrapperCoreIndexEntryV2 {
  wrapperKind: SignedWrapperKindV2
  coreDigest: DigestV2
  subjectDigest: DigestV2
  objectDigests: readonly DigestV2[]
  state: "unique" | "equivocated"
}

interface SignedWrapperSubjectIndexEntryV2 {
  wrapperKind: SignedWrapperKindV2
  subject: SignedWrapperSubjectV2
  subjectDigest: DigestV2
  coreDigests: readonly DigestV2[]
  state: "unique" | "conflicted"
}
```

Arrays are strict sorted unique. The subject native key is derived only from the
governed `convax.signed-wrapper-subject/2` digest, never raw subject/path text. One
sole-writer index journal/head transition publishes both indexes after object fsync.
Same-core/different-wrapper makes core `equivocated` and subject `conflicted`;
different-core/same-subject makes subject `conflicted`. A usable wrapper requires:

```text
subject unique -> exactly one core -> core unique -> exactly one object
```

Every reverse link and exact subject/core/object digest must match. A broken link,
hash collision, equivocation or conflict blocks currentness, inventory selection,
coverage, ACK, GC deletion and pruning across restart and either arrival order.

### 18.5 Native falsifiers

Revision 5.2 is falsified if a stable transfer key differs by connection; if one
manifest owns two charges/writers; if ingress exceeds Project 8192/512 MiB or member
512/32 MiB; if bad header produces object/inbox; if inbox-below-journal does not
revalidate or journal-below-head calls owner; if one inbox enters two journals; if
local object-only takes a remote GC path; or if either wrapper index can select a
winner without the complete unique chain.

### 18.6 ProjectIndex owner specialization and exact dependency table

The selected Project artifact returns one
`DocumentOwnerRuntimeV2<"project-index">`; `history` is literal null.
`inspectIntent` returns ordinary for exactly the eleven section-7 intent kinds and
rejects every other value. The terminal Owner dependency-kind union adds
`canvas-genesis-proof`; this classifier introduces no hash domain. Its digest is an
existing `convax.replica-checkpoint/2` complete-wrapper object digest and selects
the Canvas genesis checkpoint verifier. `project-index-proof` continues to select a
ProjectIndex causal frame digest; one kind never overloads the other's preimage.
The registry remains 128.

Mandatory Authority dependencies are separate. Portable Owner dependencies and
process-local gates are exactly:

| ProjectIndex intent | Portable Owner dependency set | Process-local gate |
| --- | --- | --- |
| `project.directory.create/2` | empty | none |
| `project.file.create/2` | empty | exact `LocalBlobAdmissionTokenV2` |
| `project.entry.locate/2` | empty | none |
| `project.entry.tombstone/2` | empty | none |
| `project.file.write-text/2` | empty | exact `LocalBlobAdmissionTokenV2` |
| `project.file.overwrite-binary/2` | empty | exact `LocalBlobAdmissionTokenV2` |
| `project.canvas.route.stage/2` | empty | none |
| `project.canvas.route.activate/2` | exactly `{kind:"canvas-genesis-proof", digest:G}` | none |
| `project.canvas.route.rename/2` | empty | none |
| `project.canvas.route.tombstone/2` | empty | none |
| `project.canvas.route.reset/2` | exactly the F13-derived `reset-authorization` ref set | private one-shot reset permit |

Missing G exact bytes is Owner `dependency-pending`; extra, missing, duplicate,
wrong-kind or unconsumed refs reject. The three local blob tokens bind exact Project
identity/epoch, blob digest, byte length and MIME and prove verified/fsynced native
bytes/index/directory. They never enter the intent, dependency set, frame, Y.Doc,
URI, ACK, journal or log and are never requested during incoming/recovery. Remote
metadata admission is independent of local blob availability.

### 18.7 Activation F/G closure and base-reference ledger

The terminal activation record is:

```ts
interface CanvasRouteActivationV2 {
  format: "convax.canvas-route-activation/2"
  transitionId: ProjectFactIdV2
  canvasId: CanvasIdV2
  shardEpoch: Id128V2
  predecessorActivationDigest: null
  stageRecordDigest: DigestV2
  projectIndexRouteDependencyFrameDigest: DigestV2 // F
  canvasGenesisCheckpointObjectDigest: DigestV2 // G
  stagedProjectIndexFrontierDigest: DigestV2
  stamp: PortableStampV2
}
```

The old `canvasGenesisCheckpointDigest` spelling is rejected. For activation,
`OwnerBaseReferenceLedgerV2.required == {F}` while portable Owner dependencies
contain only G. Kernel's base-closure port proves F is an accepted/reachable exact
ProjectIndex ancestor. Project decodes the exact F intent/evidence through the same
selected port and requires F to be `project.canvas.route.stage/2` for this
Canvas/shard, to have the exact stage record and no extra business write, and to
produce:

```text
activation.stageRecordDigest == recordDigest(F.body.stage)
activation.stagedProjectIndexFrontierDigest
  == digest(Max(F.context.baseFrontier union head(F)))
```

The current exact base still selects that stage and has no activation/reset/
tombstone. The `canvas-genesis-proof` resolver verifies G's complete wrapper,
signature/credential chain, full update, state vector and canonical Canvas genesis
through the selected Canvas public verifier, then requires:

```text
G.CanvasIdentity.projectIndexRouteDependencyFrameDigest == F
G scope/project/epoch/canvas/shard/schema/protocol/canonicalizer == activation
```

F missing while reconstructing its real base closure is `causal-base-pending` or
`exact-base-unavailable` before owner invocation. In a complete base, absent or
wrong F is semantic rejection with zero external I/O. Only G absence is Owner
dependency pending. F's discovery/apply consumption is tracked in the independent
base-reference ledger and never appears in a causal dependency partition.

For reset, the base-reference required set is exactly the predecessor F extracted
from G by the approval-rooted F13 closure. F13 alone validates that F wrote the
current selected activation/reset predecessor, G is the staged new genesis, and the
locked current ProjectIndex head/route/authority match. Reset portable Owner deps
remain only `reset-authorization`; no independent F/G/live-manifest gate may return
pending or rejection.

Initial activation can complete offline. The registration claim is queued after
activation and is not its guard or dependency. F exact frame plus validation
closure and G complete checkpoint/full update remain retention roots while the
stage/live route, queued or retained registration claim, or reset recovery refers
to them. Release requires tombstone/supersession and the existing certified
floor/pruning gates.

The terminal reset route-CAS does not add F. Its checkpoint reference and every
mirrored reset field use `stagedGenesisCheckpointObjectDigest`; the old
`stagedGenesisCheckpointDigest` spelling rejects. F is obtained only from G's
canonical Canvas identity inside F13, avoiding a second current-route authority or
hash cycle.

## 19. Revision 5.3 normative Project reset and dependency-cache replacement

This terminal section replaces every conflicting Revision 5.2 ProjectIndex
dependency, reset DTO, F13-coordinator, native dependency-cache, quota and GC
statement. Revision 5.2 was rejected before signature and has no decoder or
fallback. The nine ProjectIndex roots, eleven intent kinds and all unrelated file,
route, tombstone, conflict and reset rules remain unchanged.

### 19.1 Exact ProjectIndex dependency table

The terminal portable Owner dependencies are:

| ProjectIndex intent | Exact Owner dependency set |
| --- | --- |
| directory create, entry locate/tombstone, route stage/rename/tombstone | empty |
| file create/write-text/overwrite-binary | empty; local blob token remains process-only |
| `project.canvas.route.activate/2` | exactly `[{kind:"canvas-genesis-proof",digest:G}]` |
| `project.canvas.route.reset/2` | exactly `[{kind:"reset-authorization",digest:C}]` |

For activation, G is `activation.canvasGenesisCheckpointObjectDigest`. For reset,
C is `intent.body.resetCommit.resetAuthorizationCarrierDigest`. Missing, extra,
duplicate, differently ordered, F, G, project-index, live-manifest or any second
reset Owner ref rejects. `canvas-genesis-proof` is in the Kernel portable Owner
union and uses the self-contained Canvas carrier; it is not a prose-only kind.

F is never a portable dependency or typed-intent field. For activation it is in the
activation record and exact base ledger. For reset it is first read as an untrusted
hint from structurally valid C, then must equal validated G identity F before Kernel
opens the exact-base lookup. Only the branded phase view supplies exact F bytes.

### 19.2 Complete Project reset DTO replacement

```ts
interface DocumentShardResetRouteCasCoreV2 {
  format: "convax.document-shard-reset-route-cas-core/2"
  operationId: Id128V2
  canvasId: CanvasIdV2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
}

interface DocumentShardResetClaimCoreV2 {
  format: "convax.document-shard-reset-claim-core/2"
  projectIndexScope: ProjectIndexScopeV2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  oldProtocolDigest: DigestV2
  newProtocolDigest: DigestV2
  oldSchemaDigest: DigestV2
  newSchemaDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
  routeCasCoreDigest: DigestV2
  initiatorMemberId: MemberIdV2
  initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
  adminMemberId: MemberIdV2
  adminAuthorizationDigest: DigestV2
  explicitConfirmationReceiptDigest: DigestV2
}

interface CanvasRouteResetCommitV2 {
  format: "convax.canvas-route-reset-commit/2"
  transitionId: ProjectFactIdV2
  canvasId: CanvasIdV2
  oldShardEpoch: Id128V2
  newShardEpoch: Id128V2
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  routeCasCoreDigest: DigestV2
  stamp: PortableStampV2
}
```

Route-CAS, claim, Control confirmation, Control approval and reset commit all mirror
the same C/G/update/state-vector values byte-for-byte. C excludes those five
objects/digests, so this reverse binding is acyclic. The route-CAS still does not
repeat F.

The terminal F13 candidate binding is:

```ts
interface DocumentShardResetCandidateBindingV2 {
  readonly scope: DocumentScopeV2 & {
    docKind: "project-index"; docId: "project-index"
  }
  readonly routeCasCoreDigest: DigestV2
  readonly stagedGenesisCheckpointObjectDigest: DigestV2
  readonly resetAuthorizationCarrierDigest: DigestV2
  readonly typedIntentDigest: DigestV2
  readonly causalContextDigest: DigestV2
  readonly baseStateVectorDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly installedFloorSetDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV2
}
```

### 19.3 Permit, binding and native reset manifest

```ts
interface ProjectIndexResetExactInputBytesV2 {
  claim: CanonicalInputBytesV2
  confirmation: CanonicalInputBytesV2
  approval: CanonicalInputBytesV2
  routeCas: CanonicalInputBytesV2
  resetCommit: CanonicalInputBytesV2
  authorizationCarrier: Readonly<Uint8Array>
}

interface ProjectIndexResetAuthorityBindingV2 {
  claimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  resetCommitRecordDigest: DigestV2
  routeCasCoreDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
  predecessorRouteFrameDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  membershipSnapshotCoreDigest: DigestV2
  membershipEpoch: MembershipSnapshotV2["core"]["membershipEpoch"]
  membershipSequence: MembershipSnapshotV2["core"]["membershipSequence"]
  memberId: MemberIdV2
  memberAuthorizationEpoch: MembershipMemberV2["memberAuthorizationEpoch"]
  memberState: MembershipMemberV2["state"]
  memberRole: MembershipMemberV2["role"]
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  replicaAuthorizationEpoch: MembershipReplicaV2["replicaAuthorizationEpoch"]
  replicaState: MembershipReplicaV2["state"]
  editState: MembershipReplicaV2["editState"]
  replicaSigningPublicKey: MembershipReplicaV2["replicaSigningPublicKey"]
  credentialCoreDigest: DigestV2
  reservationReceiptCoreDigest: DigestV2
  editAuthorizationCoreDigest: DigestV2
  installedFloorSetDigest: DigestV2
  floorRootCoreDigest: DigestV2
  orderedFloorPageDigests: readonly DigestV2[]
  liveScopeManifestDigest: DigestV2
  trustBundleDigest: DigestV2
  adminCapabilityCoreDigest: DigestV2
  adminMemberId: MemberIdV2
  adminMemberAuthorizationEpoch:
    ProjectAdminCapabilityV2["core"]["adminMemberAuthorizationEpoch"]
  currentProjectIndexStateVectorDigest: DigestV2
  currentProjectIndexCanonicalStateDigest: DigestV2
  predecessorActivationDigest: DigestV2
  projectIndexScope: ProjectIndexScopeV2
  currentOldRouteActivationDigest: DigestV2
  currentOldShardEpoch: Id128V2
  currentNewRouteState: "absent"
  currentStagedGenesisState: "inert"
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
}

interface ProjectIndexResetPermitRecordV2 {
  state: ProjectIndexResetPermitStateV2
  nonce32: ProcessLocalNonce32V2
  candidateId: ProcessLocalCandidateIdV2
  candidateObject: object
  binding: Readonly<DocumentShardResetCandidateBindingV2>
  baseReferences: OwnerResolvedBaseReferencesV2<
    "project-index", "reset-f13-final"
  >
  witnessIdentity: object
  acceptedAuthorityHeadIdentity: object
  exactInputBytes: Readonly<ProjectIndexResetExactInputBytesV2>
  authorityBinding: Readonly<ProjectIndexResetAuthorityBindingV2>
}

interface DocumentShardResetManifestV2 {
  format: "convax.document-shard-reset-manifest/2"
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  routeCasCoreDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
  oldScopeNativeKey: DigestV2
  newScopeNativeKey: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  routeCasFrameDigest: DigestV2 | null
  state:
    | "shard-reset-staged"
    | "shard-reset-awaiting-route-cas"
    | "shard-reset-recovery-required"
    | "unsupported-old-shard"
    | "abandoned-pre-cas"
}
```

The retired names `canvasGenesisCheckpointDigest`,
`stagedGenesisCheckpointDigest`, `currentStagedGenesisCheckpointDigest`,
`genesisCheckpointDigest` and `projectIndexRouteDependencyDigest` are unknown keys
in every Project, Control, F13, permit and manifest decoder. There is no alias,
dual-read, prose substitution or old-project hydration.

### 19.4 Exact no-cycle reset order

```text
resolve exact C bytes and all sections outside the document queue
-> enter exclusive queue on latest accepted/working base
-> decode reset intent and require declared Owner refs == singleton C
-> structurally validate C, then fully validate nested G and extract F
-> require C hint F == G identity F before any base lookup
-> Kernel freezes required base set {F}
-> discover phase reads exact F from reconstructed authored base
-> fresh initial F13 phase reads exactly {F}; run complete F13
-> issue private permit and clone candidate
-> apply phase independently reads exact same F and consumes {F}
-> apply typed reset intent
-> fresh final F13 phase reads exactly {F}; rebuild current facts; run complete F13
-> A4, consume permit and synchronously enter reducer with no await/callback/IPC
-> require discover/initial/apply/final ledgers all exactly {F}
-> validate post state and evidence
-> object/outbox-or-inbox/journal/head durable barrier
```

Incoming/recovery executes one complete `reset-f13-incoming` phase before apply and
still performs an independent `apply` phase read. Only C absence is Owner dependency
pending. Incomplete real base is `causal-base-pending`; F absent from a complete base
is `exact-base-unavailable`. Structural C failure rejects before F13. G/F/reset/
authority semantic failures are F13 rejection. No ambient lookup, hidden WeakMap
fact, second F/G dependency gate or second reset verifier exists.

### 19.5 Native dependency cache and accounting

Project/node implements the Control-owned dependency-carrier refs and receipts as a
separate sole-writer store. Exact order is:

```text
authenticated wanted root -> quota reservation -> staging/chunk fsync
-> complete length/SHA and carrier semantic validation
-> constituent immutable object fsync
-> dependency index plus wanted-root fsync
-> session transfer ACK with durabilityProofDigest:null
```

Carrier bytes never enter the causal-frame object/inbox/journal/head path and never
produce a Replica or Blob durable ACK. Recovery rehashes staging; repairs an
object-before-index cut by rebuilding/fsyncing only the dependency index; and wakes
only frames/operations waiting for the exact `{kind,subjectDigest,scope}`. It never
fabricates a causal inbox, journal or accepted head.

ACK releases only the connection writer/inflight credit. Project/source object and
byte quota remain charged and atomically transfer to the dependent pending frame,
staged operation or recovery root, then to accepted causal/checkpoint/stage/live-
route/reset/registration/history retention. There is no release-then-recharge
window. An exact duplicate G/C is charged once.

C index/sections and G/component objects are one rebuildable retained closure.
Pending inbox/outbox, accepted causal history, stage/live route, registration/reset
recovery, active validation lease, checkpoint or prune root pins the closure. Only
two complete durable reverse-reference scans proving no root, transfer or
reservation may delete it and release quota. Ambiguity retains all candidates. An
unsolicited carrier without an authenticated wanted root is rejected before
reservation or allocation.

### 19.6 Project falsifiers

Revision 5.3 is falsified if reset declares other than singleton C; if C contains a
mirrored DTO digest; if hint F differs from G identity F yet reaches base lookup;
if F is absent from the exact authored base yet F13/reducer runs; if any phase does
not consume exactly the same `{F}` bytes; if current authority is trusted from C;
if an old reset field decodes; if dependency recovery writes a causal inbox/journal;
if ACK releases retained quota; or if GC removes a closure with any live durable
root.
