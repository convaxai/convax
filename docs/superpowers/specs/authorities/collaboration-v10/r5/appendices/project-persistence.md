# Convax collaboration Project persistence authority

Status: **standalone exact-byte final candidate; inactive until the same five-file
authority set and derived protocol bundle receive unconditional 3/3 SIGN.**

This document is complete for its ownership surface. It does not inherit fields,
states, limits, paths or transitions from an earlier authority. Unknown keys,
unknown union members, noncanonical encodings and unspecified transitions fail
closed.

The words MUST, MUST NOT, SHOULD and MAY are normative.

## 1. Scope, ownership and authority counts

This appendix owns the ProjectIndex schema and Project-private persistence required
by collaboration. It does not own Canvas payload records, collaboration-kernel
brands, control-plane membership, PeerJS messages or global URI grammar.

| Package | Sole responsibility in this appendix | Forbidden responsibility |
| --- | --- | --- |
| `@convax/project` | ProjectIndex schema, typed intents, canonical projection, resource-currentness, Canvas route/reset and Project reset composition | native paths, fsync, PeerJS routing, raw Yjs updates from callers |
| `@convax/project/collaboration-protocol` | browser-safe Project proof and reset DTOs | native I/O or live capabilities |
| `@convax/project/node` | sole writer of Project-private collaboration stores, immutable objects, heads, journals, outboxes, admission records, checkpoints, GC records, blobs and reset publications | portable winner rules, Kernel brands, ACK bytes, a second Project catalog |
| `@convax/collaboration` | generic `replicaDoc`/isolated `candidateDoc`, frames, process brands, receipt factories and live proof registries | Project records, native paths, blob policy |
| `@convax/desktop` | connection-local PeerJS transport and attempt-keyed ACK outbox | Project state, native Project writes, caller-selected ACK bytes |
| `@convax/uri` | global stateless URI components, codec and canonicalization | Project lookup, I/O, authorization or currentness |

Authority counts are exact:

- one `ProjectIndexYDoc` per `{projectId, projectEpoch}`;
- one `CanvasYDoc` per live `{canvasId, shardEpoch}`;
- one `@convax/project/node` private-store writer per open Project;
- one accepted durable head per document shard;
- one admission epoch-head pointer and one admission-publication recovery pointer
  per Project epoch;
- one metadata-GC head pointer per Project epoch;
- zero document-wide revisions, JSON mirrors, renderer document stores,
  per-stable-key heads, per-member heads, dynamic path registries or caller-created
  receipt brands.

Renderer, Agent, Plugin and Desktop callers submit the same closed Project intents.
They cannot provide raw Yjs updates, native paths, Project identity, operation ids,
ACK bodies or persistence records.

## 2. Canonical scalar and encoding rules

This appendix uses the v10 canonical JCS restrictions: UTF-8 RFC 8785 ordering,
NFC scalar strings, plain objects and dense arrays only, finite JSON numbers only,
and no accessor, symbol, `undefined`, cycle, lone surrogate, `NaN` or infinity.
Unknown keys and unknown union tags fail closed.

```ts
type Id128V2 = import("@convax/collaboration").Id128V2
type ActorIdV2 = import("@convax/collaboration").ActorIdV2
type Uint32V2 = import("@convax/collaboration").Uint32V2
type Uint64V2 = import("@convax/collaboration").Uint64V2
type DigestV2 = import("@convax/collaboration").DigestV2
type SignatureV2 = import("@convax/collaboration").SignatureV2
type ProjectIdV2 = import("@convax/collaboration").ProjectIdV2
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

The resource URI is an opaque canonical value produced and parsed only through the
public `@convax/uri` API. Project compares its decoded Project id, epoch, entry id,
optional presentation hint and blob pin with the enclosing reference. It does not
restate scheme grammar, resolve by string concatenation, treat an OS path as
identity, dynamically register a scheme or accept a noncanonical alias. A promoted
conflict reference names the stable conflict-copy `entryFileId` while retaining the
same `familyPrimaryFileId`, `versionId`, blob and version-record digest.

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
  projectIndexRouteDependencyFrameDigest: DigestV2
  canvasGenesisCheckpointObjectDigest: DigestV2
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

For initial activation, `projectIndexRouteDependencyFrameDigest` is the exact
accepted ProjectIndex stage frame `F`, and
`canvasGenesisCheckpointObjectDigest` is the complete Canvas genesis checkpoint
object `G`. The selected Kernel base-closure port proves that `F` is reachable from
the authored ProjectIndex base and that it writes exactly the referenced stage.
The selected Canvas genesis verifier validates the complete `G` wrapper, update,
state vector and canonical state and returns an identity whose predecessor digest
equals `F`. Missing `F` is causal-base pending before owner invocation; missing `G`
is owner dependency pending. Neither digest is resolved through a current URI,
registry entry or native path.

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
registry-only/tombstoned route as required is invalid. This is the complete Project-owned live-scope authority.

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

This section defines every phrase such as "projection digest", "version digest" or
"exact value digest". All cores below are closed, restricted
JCS values. Unknown fields/tags reject. Digest arrays sort strictly by decoded
32-byte digest; id arrays sort by the id's declared canonical byte codec. A tuple
array is duplicate-free and sorted by its first item unless explicitly stated
otherwise.

#### 4.3.1 Record, intent and reset digests

`projectIndexRecordDigest(record)` is:

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
  digests are separate explicit references and never replace the reset-commit
  record digest.

The intent, resource-reference, route-CAS core, reset-claim core, reset-claim
signature, live-scope manifest and local-store formulas are exactly the formulas
declared by this authority and its named owner imports.

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
| Persistent record / version / reset-commit fact | `record.format`, NUL, exact record JCS | `convax.project-index-record-digest/2` |
| Entry location/path | `ProjectEntryLocationProjectionV2` | `convax.project-entry-location-projection/2` |
| Conflict copy | `ProjectConflictProjectionV2` | `convax.project-conflict-projection/2` |
| Content family/live heads | `ProjectContentFamilyProjectionV2` | `convax.project-content-family-projection/2` |
| File/current resource | `ProjectFileProjectionV2` | `convax.project-file-projection/2` |
| Canvas route | `ProjectCanvasRouteProjectionV2` | `convax.project-route-projection/2` |
| Reset route CAS | exact `DocumentShardResetRouteCasCoreV2` | `convax.document-shard-reset-route-cas-core-digest/2` |
| Reset claim | exact `DocumentShardResetClaimCoreV2` | `convax.document-shard-reset-claim-core-digest/2` |
| Actual inserted root value | `ProjectIndexWriteValueV2` | `convax.project-index-write-value/2` |
| Portable actual-write set | exact `ActualWriteEvidenceV2` | kernel `convax.actual-write-evidence/2` |

The Project owner contributes exactly the following seventeen digest domains to the
external protocol-bundle assembler, in strict ascending raw UTF-8 byte order:

```text
convax.document-shard-reset-claim-core-digest/2
convax.document-shard-reset-claim-signature/2
convax.document-shard-reset-route-cas-core-digest/2
convax.local-project-store-record-digest/2
convax.native-document-store-key/2
convax.native-object-store-key/2
convax.project-conflict-projection/2
convax.project-content-family-projection/2
convax.project-derived-identity/2
convax.project-entry-location-projection/2
convax.project-file-projection/2
convax.project-index-intent-digest/2
convax.project-index-live-scope-manifest/2
convax.project-index-record-digest/2
convax.project-index-write-value/2
convax.project-resource-reference-digest/2
convax.project-route-projection/2
```

The list has fixed cardinality `17`, is duplicate-free, and is compared
byte-for-byte before it is unioned with the other owner contributions. A missing,
extra, differently ordered or aliased item rejects bundle generation.
`convax.project-index-canonical-state/2` is only the canonical JCS format string,
not a digest domain. Imported Kernel and Control domains are not repeated here.

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

### 7.1 Selected ProjectIndex owner artifact

Project supplies exactly one unbranded
`SelectedDocumentOwnerArtifactDefinitionV2<"project-index">`. It is the raw owner
definition consumed by the Kernel loader, not a runtime, service locator or second
ProjectIndex implementation. Its `createDefinitions` receives only the exact
loader-owned `OwnerProcessValueFactoryV2<"project-index">` and returns the raw
`DocumentOwnerProtocolDefinitionV2<"project-index">` and
`OwnerIntentClosureDefinitionV2<"project-index">` defined by this appendix:

```ts
type ProjectIndexSelectedOwnerArtifactDefinitionV2 =
  import("@convax/collaboration")
    .SelectedDocumentOwnerArtifactDefinitionV2<"project-index">
type ProjectIndexOwnerProcessValueFactoryV2 =
  import("@convax/collaboration")
    .OwnerProcessValueFactoryV2<"project-index">
type ProjectIndexOwnerProtocolDefinitionV2 =
  import("@convax/collaboration")
    .DocumentOwnerProtocolDefinitionV2<"project-index">
type ProjectIndexOwnerIntentClosureDefinitionV2 =
  import("@convax/collaboration")
    .OwnerIntentClosureDefinitionV2<"project-index">
type ProjectIndexOwnerExternalFactRequirementV2 =
  import("@convax/collaboration")
    .OwnerExternalFactRequirementV2<"project-index">
type ProjectIndexOwnerIntentDependenciesV2 =
  import("@convax/collaboration")
    .OwnerIntentDependenciesV2<"project-index">
type ProjectIndexOwnerExternalFactResolverDefinitionV2 =
  import("@convax/collaboration")
    .OwnerExternalFactResolverDefinitionV2<"project-index">
type ProjectIndexOwnerExternalFactPortV2 =
  import("@convax/collaboration")
    .OwnerExternalFactPortV2<"project-index">
type ProjectIndexOwnerExternalFactPortFactoryV2 =
  import("@convax/collaboration")
    .OwnerExternalFactPortFactoryV2<"project-index">

declare function projectIndexOwnerProtocolDefinitionV2(
  processValues: ProjectIndexOwnerProcessValueFactoryV2,
): ProjectIndexOwnerProtocolDefinitionV2

declare function projectIndexOwnerIntentClosureDefinitionV2():
  ProjectIndexOwnerIntentClosureDefinitionV2

const selectedProjectIndexOwnerArtifactDefinitionV2:
  ProjectIndexSelectedOwnerArtifactDefinitionV2 = {
    owner: "project-index",
    createDefinitions(processValues) {
      return {
        protocol: projectIndexOwnerProtocolDefinitionV2(processValues),
        closure: projectIndexOwnerIntentClosureDefinitionV2(),
      }
    },
  }
```

The raw protocol definition uses the section-4 canonicalizer and exact section-7
decoder/reducer. `validateBase` decodes all nine roots and wraps only the exact
validated projection through the supplied process-value factory. `applyIntent`
accepts only a decoded `ProjectIndexIntentV2`, the matching branded base and the
attempt-scoped ProjectIndex fact port; it wraps only the exact reducer result.
`validatePost`, canonical-state bytes and actual-write evidence are exactly sections
4.2 and 4.3. Cross-owner, cross-artifact, structurally copied, disposed or restarted
process values reject. The definition does not mint, cast or imitate a Kernel brand.

The selected loader must prove all of these equalities before exposing
`DocumentOwnerRuntimeV2<"project-index">`:

```text
runtime.artifactDigest
  == protocol.schemaDigest
  == protocol.canonicalizerDescriptor.ownerSchemaDigest
protocol.canonicalizerDescriptor.owner == "project-index"
closure.protocolPort object identity == runtime.protocolPort object identity
runtime.externalFactPortFactory is OwnerExternalFactPortFactoryV2<"project-index">
```

The ProjectIndex artifact has no history materializer. Its closure has
`history=null`; `inspectIntent` returns `{kind:"ordinary"}` for every and only exact
`ProjectIndexIntentV2` member. Any undo, redo, Canvas intent, generic patch or
unknown value rejects. Project undo across restart and ProjectIndex session undo are
not v2 features.

### 7.2 Project external-fact codecs and permits

Project owns this closed fact grammar. The host may resolve it, but cannot mint a
Project permit or widen the request union:

```ts
type ProjectIndexExternalFactKindV2 =
  | "blob-publication-currentness"
  | "canvas-genesis-currentness"
  | "reset-authorization-currentness"

type ProjectIndexExternalFactRequestV2 =
  | {
      readonly format: "convax.project-index-external-fact-request/2"
      readonly kind: "blob-publication-currentness"
      readonly projectIndexScope: ProjectIndexScopeV2
      readonly operationId: Id128V2
      readonly intentDigest: DigestV2
      readonly versionRecordDigest: DigestV2
      readonly blob: ProjectBlobRefV2
    }
  | {
      readonly format: "convax.project-index-external-fact-request/2"
      readonly kind: "canvas-genesis-currentness"
      readonly projectIndexScope: ProjectIndexScopeV2
      readonly operationId: Id128V2
      readonly intentDigest: DigestV2
      readonly canvasScope: DocumentScopeV2 & {
        readonly docKind: "canvas"
        readonly docId: CanvasIdV2
      }
      readonly stageRecordDigest: DigestV2
      readonly routeDependencyFrameDigest: DigestV2
      readonly genesisCheckpointObjectDigest: DigestV2
      readonly stagedProjectIndexFrontierDigest: DigestV2
    }
  | {
      readonly format: "convax.project-index-external-fact-request/2"
      readonly kind: "reset-authorization-currentness"
      readonly projectIndexScope: ProjectIndexScopeV2
      readonly operationId: Id128V2
      readonly intentDigest: DigestV2
      readonly oldScope: DocumentScopeV2 & {
        readonly docKind: "canvas"
        readonly docId: CanvasIdV2
      }
      readonly newScope: DocumentScopeV2 & {
        readonly docKind: "canvas"
        readonly docId: CanvasIdV2
      }
      readonly claimCoreDigest: DigestV2
      readonly confirmationCoreDigest: DigestV2
      readonly approvalCoreDigest: DigestV2
      readonly routeCasCoreDigest: DigestV2
      readonly predecessorActivationDigest: DigestV2
    }

interface ProjectIndexExternalFactResultV2 {
  readonly format: "convax.project-index-external-fact-result/2"
  readonly kind: ProjectIndexExternalFactKindV2
  readonly requestSha256: DigestV2
  readonly factDigest: DigestV2
  readonly decision: "verified"
}

declare const projectIndexExternalFactPermitBrandV2: unique symbol
interface ProjectIndexExternalFactPermitV2 {
  readonly kind: ProjectIndexExternalFactKindV2
  readonly requestSha256: DigestV2
  readonly factDigest: DigestV2
  readonly [projectIndexExternalFactPermitBrandV2]: true
}

function encodeProjectIndexExternalFactRequestV2(
  request: ProjectIndexExternalFactRequestV2,
): Readonly<Uint8Array> | "rejected"

function decodeProjectIndexExternalFactRequestV2(
  exactJcs: Readonly<Uint8Array>,
): ProjectIndexExternalFactRequestV2 | "rejected"

function validateProjectIndexExternalFactResultV2(
  value: unknown,
): ProjectIndexExternalFactResultV2 | "rejected"
```

Requests are exact restricted JCS. The closure creates one imported
`ProjectIndexOwnerExternalFactRequirementV2` per required request with owner
`"project-index"`, its exact `kind`, ordinary SHA-256 of the request bytes as both
`request.sha256` and `factDigest`, and those exact bytes as `request.exactJcs`.
The host resolver first decodes the public request, then proves the native blob
publication/current presence, the artifact-bound Canvas genesis identity, or the
complete reset authorization/currentness gate respectively. A resolved result is
still untrusted: Project accepts it only when its exact validator proves kind,
request hash and fact digest equal the declared requirement, then mints the
process-local permit. The permit has no codec and cannot enter an intent, Y.Doc,
frame, journal, IPC, log or durable evidence.

Blob verification requires the exact opened-handle SHA-256/length, durable
create-new publication and current presence-index head. Canvas-genesis verification
requires the exact artifact-bound verifier in section 17, identity scope/checkpoint/
predecessor equality and a still-staged matching route. Reset verification requires
the exact RSA carrier installation plus the full section-17 semantic/currentness
gate; a structurally valid carrier alone never resolves the fact.

### 7.3 Closed discovery and consumption

The closure deterministically discovers facts from the exact decoded intent:

| Intent | Exact external fact requirements |
| --- | --- |
| `project.file.create/2` | one blob request for `initialVersion` |
| `project.file.write-text/2` | one blob request for `version` |
| `project.file.overwrite-binary/2` | one blob request for `version` |
| `project.canvas.route.activate/2` | one Canvas-genesis request for `activation` |
| `project.canvas.route.reset/2` | one reset-authorization request for the exact reset body |
| every other ProjectIndex intent | empty |

The validation-artifact set is empty for every current ProjectIndex intent. Fact
requirements use Kernel strict order and are duplicate-free. Discovery rejects a
request over 64 KiB, over 64 requirements or over 1 MiB aggregate before resolution
or candidate creation.

The runtime invokes only its captured
`ProjectIndexOwnerExternalFactPortFactoryV2.createAttemptPort({declared,resolver})`.
There is no method-level owner parameter and no caller-selected `K`. Only
`status="created"` yields the ProjectIndex port; every closed `rejected` result
aborts before fact access or candidate creation.

For both a local command and an incoming/recovery signed frame, the pipeline is:

```text
decode exact restricted JCS -> inspect ordinary -> discover exact dependencies
-> resolve outside the document queue when pending -> restart from latest exact base
-> create one ProjectIndex-scoped declared attempt port -> isolated candidate apply
-> validate post-state and actual-write evidence -> exact final frame durability
```

The Kernel must prove byte-identical
`discovered == attempt-declared == apply-consumed` for both dependency arrays.
`applyIntent` must consume every declared fact once and no undeclared fact. Pending
retry retains no branded base, resolver, result, permit or candidate. Incoming and
recovery never call a local constructor, allocate ids, publish a blob, replay a
business command or substitute the current ProjectIndex for the authored causal
base. Thus UI, Agent, Plugin, local replay and remote ingress all use the same raw
protocol/closure pair and no document-wide version path exists.

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
  stagedGenesisCheckpointObjectDigest: DigestV2
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
  stagedGenesisCheckpointObjectDigest: DigestV2
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
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  approvalCoreDigest: DigestV2
  routeCasCoreDigest: DigestV2
  stamp: PortableStampV2
}
```

The whole claim JCS is <=64 KiB and depth <=16. `oldScope` and `newScope` have the
same Project, epoch, Canvas id and `docKind`; only `shardEpoch` differs, and the new
epoch is fresh random 128-bit. Both Canvas `docId` values equal the enclosing
`canvasId`. ProjectIndex scope has the same Project/epoch. Every corresponding field
in the route-CAS core, reset claim and route commit is byte-equal.

These four Project-owned declarations have no reduced Control copy, legacy alias or
field-name adapter. No shorter checkpoint-field spelling is admitted; the only
checkpoint field is
`stagedGenesisCheckpointObjectDigest`, which names the complete immutable
checkpoint object. The enclosing RSA carrier digest is deliberately absent: the
carrier contains the Project claim, so a claim-to-carrier digest field would create
a forbidden hash cycle. The Control annex imports these exact declarations when
validating confirmation/approval bindings. Carrier installation remains subject to
the process-local Project semantic/currentness gate in section 17.

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
editAuthorization.core.installedFloorSetDigest
  == exact current ReplicaProjectFloorRootV2.coreDigest installed for this replica

membershipMember.memberId == credential.core.memberId
membershipMember.state == "active"
membershipMember.role == "editor"
membershipReplica.replicaId == credential.core.replicaId
membershipReplica.state == "active"
membershipReplica.editState == "active-editor"
```

The exact Kernel-owned `CausalSignerAuthorityV2` used for the reset frame MUST also
be current and byte-equal to the same chain:

```text
causalSigner.memberId/replicaId/actorId
  == credential.core.memberId/replicaId/actorId
causalSigner.memberAuthorizationEpoch
  == editAuthorization.core.memberAuthorizationEpoch
causalSigner.replicaAuthorizationEpoch
  == editAuthorization.core.replicaAuthorizationEpoch
causalSigner.membershipSnapshotDigest
  == editAuthorization.core.membershipSnapshotDigest
causalSigner.replicaActorCredentialCoreDigest == credential.coreDigest
causalSigner.replicaEditAuthorizationCoreDigest == editAuthorization.coreDigest
```

The installed floor root must bind this exact Project/epoch/replica, the current
Project-owned live-scope manifest and every required scope from section 3.6 with an
exact durable floor ACK; a digest-only lookup or older complete floor is stale.
Every remaining identity/epoch/digest field of the edit authorization MUST validate
under the selected Control authority algorithms. A viewer replica
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

The selected Control authority's approval authorization-epoch and
current-capability checks are mandatory.

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

The only live document roles are the Kernel-owned `replicaDoc` and one isolated
`candidateDoc` per command. Project/node persists final signed frame bytes and
accepted-frame references only. No third document role, durable business-command
overlay/journal, state-promotion step or command-replay rebase exists. Replication
outboxes and ACK indexes describe delivery; they never promote or select document
state. Candidate lifetime is one
validation attempt and is destroyed on every accept, reject, cancel, stale-base,
pending-dependency and throw path.

### 9.2 Local success barrier

Inside the per-shard Main writer mutex, local mutation order is exact:

1. require the sole in-memory `replicaDoc` frontier to equal the validated durable
   head (reopen reconstructs that one document once); allocate
   operation/identities/stamps;
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
bounded structural and authorization/cutoff checks, Main resolves the complete
authored causal closure and constructs the one isolated `candidateDoc` directly at
that exact base, independently of current arrival state. It applies the signed typed
intent once and requires the candidate update, state vector, canonical post-state
and actual-write evidence to equal the frame byte-for-byte. Missing causal objects
stay bounded pending; the current `replicaDoc` is never substituted for a missing
authored base, and no third mutable document is allocated.

After exact-base validation, Main creates/fsyncs the immutable object and any local
replication reference, appends/fsyncs the accepted journal record and atomically
advances/fsyncs the durable frontier head. It then applies the exact accepted update
to the current in-memory `replicaDoc`, verifies the resulting owner projection and
publishes invalidation. Only after the object/journal/head barrier and successful
`replicaDoc` reconstruction may it sign `ReplicaDurableAckV2`. Local arrival order is
recovery metadata only; concurrent frames converge through the owner-defined
I-confluent projection and never create a global edit order.

Crash before head yields no ACK and revalidates the same frame. Crash after head but
before in-memory apply/ACK reconstructs `replicaDoc` from the durable causal closure
and may then sign the ACK; it never replays the business command. Duplicate frame digest is
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

`<ProjectEpochNativeStore>` is the already-opened and native-identity-pinned handle
for the exact `<project>/.convax/collaboration/` directory whose
`manifest-v2.bin` validates the bound `projectId`, `projectEpoch`, protocol and
schema. It is a handle capability, not a caller-supplied pathname. Project reset
publishes a new complete `.convax` tree, so two epochs never share this mutable
store root.

```text
<project>/.convax/
  project.json                                  stable projectId only
  collaboration/
    manifest-v2.bin                             projectEpoch/schema/store identity
    remote-ingress-evidence-admission/           exact pointers and kind locations in sections 16 and 19
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
        durable-head.bin                        sole local replica head pointer
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

## 16. Remote ingress persistence boundary

### 16.1 Sequential cursor and plain evidence

Project/node may expose completed staging bytes only through an unbranded sequential
handle:

```ts
type RemoteIngressByteCursorReadV2 =
  import("@convax/collaboration").RemoteIngressByteCursorReadV2
type RemoteIngressSequentialCursorPortHandleV2 =
  import("@convax/collaboration").RemoteIngressSequentialCursorPortHandleV2
type OpenRemoteIngressSequentialCursorPortResultV2 =
  import("@convax/collaboration").OpenRemoteIngressSequentialCursorPortResultV2
```

Project/node enforces one live handle per final staging head and exact forward
progression. Kernel binds the handle to one completed capability, wraps it and alone
mints the branded cursor. Both sides close it on every terminal path.

Reservation, immutable promotion, owner install and stale-head quarantine ports
return plain immutable evidence. Evidence mirrors Project, epoch, stable transfer
key, manifest/closure/reservation/chunk heads, object kind, scope, subject, SHA,
length, immutable digest and publication heads. Kernel independently compares every
mirror with its live facts and alone mints process-local brands. Project/node never
mints, serializes or persists a Kernel receipt.

### 16.2 Project-epoch admission and COW74

The sole mutable admission pointer is:

```text
<ProjectEpochNativeStore>/remote-ingress-evidence-admission/head
  -> RemoteIngressEvidenceAdmissionEpochHeadRecordV2 digest
```

The Project-owned admission records are closed:

```ts
type StableRemoteTransferKeyV2 =
  import("@convax/collaboration").StableRemoteTransferKeyV2
type RemoteIngressEvidenceMissingObjectV2 =
  import("@convax/collaboration").RemoteIngressEvidenceMissingObjectV2
type RemoteIngressQuotaReservationPortEvidenceV2 =
  import("@convax/collaboration").RemoteIngressQuotaReservationPortEvidenceV2
type RemoteIngressQuotaTransferPortEvidenceV2<
  K extends import("@convax/collaboration").RemoteIngressKindV2,
> = import("@convax/collaboration")
  .RemoteIngressQuotaTransferPortEvidenceV2<K>
type RemoteIngressEvidenceStableKeyStateMapKeyV2 = DigestV2
type RemoteIngressEvidenceMemberQuotaMapKeyV2 = DigestV2
type RemoteIngressEvidenceMapKindV2 = "stable-key-state" | "member-quota"

interface RemoteIngressEvidenceMemberQuotaRecordV2 {
  readonly format: "convax.remote-ingress-evidence-member-quota-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly memberQuotaMapKey: RemoteIngressEvidenceMemberQuotaMapKeyV2
  readonly monotonicAttemptCount: Uint32V2
  readonly chargedClosureCount: Uint32V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly lastTransitionRecordDigest: DigestV2
  readonly priorMemberQuotaRecordDigest: DigestV2 | null
}

interface RemoteIngressEvidenceStableKeyStateBaseV2 {
  readonly format: "convax.remote-ingress-evidence-stable-key-state-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly stableKeyStateMapKey: RemoteIngressEvidenceStableKeyStateMapKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly prospectiveClosureExactByteLength: Uint64V2
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
  readonly accountedAdmissionByteLength: Uint64V2
  readonly monotonicAttemptCount: Uint32V2
  readonly currentAttemptOrdinal: Uint32V2
  readonly chargedClosureCount: Uint32V2
  readonly lastTransitionRecordDigest: DigestV2
  readonly priorStableKeyStateRecordDigest: DigestV2 | null
}

type RemoteIngressEvidenceStableKeyStateRecordV2 =
  | (RemoteIngressEvidenceStableKeyStateBaseV2 & {
      readonly state: "reserved"
      readonly signedOfferEvidenceClosureObjectDigest: null
      readonly abandonmentReason: null
      readonly chargeTransferBindingRecordDigest: null
    })
  | (RemoteIngressEvidenceStableKeyStateBaseV2 & {
      readonly state: "settled"
      readonly signedOfferEvidenceClosureObjectDigest: DigestV2
      readonly abandonmentReason: null
      readonly chargeTransferBindingRecordDigest: null
    })
  | (RemoteIngressEvidenceStableKeyStateBaseV2 & {
      readonly state: "released"
      readonly releaseKind: "abandoned"
      readonly signedOfferEvidenceClosureObjectDigest: null
      readonly abandonmentReason: "authorization-closed"
        | "caller-cancelled" | "evidence-capacity-exceeded"
      readonly chargeTransferBindingRecordDigest: null
    })
  | (RemoteIngressEvidenceStableKeyStateBaseV2 & {
      readonly state: "released"
      readonly releaseKind: "charge-transferred"
      readonly signedOfferEvidenceClosureObjectDigest: DigestV2
      readonly abandonmentReason: null
      readonly chargeTransferBindingRecordDigest: DigestV2
    })

type RemoteIngressEvidenceReplacementChargeKindV2 =
  | "remote-ingress-reservation" | "manifest-equivocation-high-water"
  | "installed-payload" | "owner-install" | "recovery" | "audit"
  | "dependency-carrier"

interface RemoteIngressEvidenceChargeTransferBindingCoreV2 {
  readonly format: "convax.remote-ingress-evidence-charge-transfer-binding-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly currentAttemptOrdinal: Uint32V2
  readonly manifestCoreDigest: DigestV2
  readonly settledStableKeyStateRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly replacementKind: RemoteIngressEvidenceReplacementChargeKindV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
}

interface RemoteIngressEvidenceReplacementChargeV2 {
  readonly chargeTransferBindingDigest: DigestV2
  readonly kind: RemoteIngressEvidenceReplacementChargeKindV2
  readonly rootRecordDigest: DigestV2
  readonly rootHeadRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
}

interface RemoteIngressEvidenceChargeTransferBindingRecordV2 {
  readonly format: "convax.remote-ingress-evidence-charge-transfer-binding-record/2"
  readonly core: RemoteIngressEvidenceChargeTransferBindingCoreV2
  readonly coreDigest: DigestV2
  readonly replacement: RemoteIngressEvidenceReplacementChargeV2
}

type RemoteIngressEvidenceMapLeafEntryV2 =
  | { readonly mapKind: "stable-key-state"
      readonly keyDigest: RemoteIngressEvidenceStableKeyStateMapKeyV2
      readonly stableKey: StableRemoteTransferKeyV2
      readonly valueRecordDigest: DigestV2 }
  | { readonly mapKind: "member-quota"
      readonly keyDigest: RemoteIngressEvidenceMemberQuotaMapKeyV2
      readonly sourceMemberId: MemberIdV2
      readonly valueRecordDigest: DigestV2 }

interface RemoteIngressEvidenceMapLeafPageRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-leaf-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly height: "0"
  readonly entries: readonly RemoteIngressEvidenceMapLeafEntryV2[]
  readonly subtreeEntryCount: Uint64V2
}

type RemoteIngressEvidenceMapBoundaryKeyV2 =
  | { readonly mapKind: "stable-key-state"
      readonly keyDigest: RemoteIngressEvidenceStableKeyStateMapKeyV2
      readonly stableKey: StableRemoteTransferKeyV2 }
  | { readonly mapKind: "member-quota"
      readonly keyDigest: RemoteIngressEvidenceMemberQuotaMapKeyV2
      readonly sourceMemberId: MemberIdV2 }

interface RemoteIngressEvidenceMapChildV2 {
  readonly firstKey: RemoteIngressEvidenceMapBoundaryKeyV2
  readonly lastKey: RemoteIngressEvidenceMapBoundaryKeyV2
  readonly childPageRecordDigest: DigestV2
  readonly childSubtreeEntryCount: Uint64V2
}

interface RemoteIngressEvidenceMapInternalPageRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-internal-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly height: Uint32V2
  readonly children: readonly RemoteIngressEvidenceMapChildV2[]
  readonly subtreeEntryCount: Uint64V2
}

interface RemoteIngressEvidenceMapRootRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly generation: Uint64V2
  readonly rootPageDigest: DigestV2 | null
  readonly entryCount: Uint64V2
  readonly treeHeight: Uint32V2
  readonly mapCommitment: DigestV2
}

interface RemoteIngressEvidenceAdmissionEpochHeadRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-epoch-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly currentTransitionRecordDigest: DigestV2 | null
  readonly currentCheckpointRecordDigest: DigestV2
  readonly previousCheckpointRecordDigest: DigestV2 | null
  readonly priorHeadRecordDigestSinceCheckpoint: DigestV2 | null
  readonly transitionsSinceCheckpoint: Uint32V2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}

interface RemoteIngressEvidenceAdmissionTransitionRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-transition-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly transition: "reserve" | "settle" | "abandon-release" | "transfer-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2 | null
  readonly chargeTransferBindingRecordDigest: DigestV2 | null
  readonly priorEpochHeadRecordDigest: DigestV2
  readonly priorStableKeyStateRecordDigest: DigestV2 | null
  readonly resultingStableKeyStateRecordDigest: DigestV2
  readonly priorMemberQuotaRecordDigest: DigestV2 | null
  readonly resultingMemberQuotaRecordDigest: DigestV2
  readonly priorStableKeyStateRootRecordDigest: DigestV2
  readonly resultingStableKeyStateRootRecordDigest: DigestV2
  readonly priorMemberQuotaRootRecordDigest: DigestV2
  readonly resultingMemberQuotaRootRecordDigest: DigestV2
  readonly resultingStableKeyMonotonicAttemptCount: Uint32V2
  readonly resultingMemberMonotonicAttemptCount: Uint32V2
  readonly resultingProjectMonotonicAttemptCount: Uint32V2
  readonly resultingStableKeyChargedClosureCount: Uint32V2
  readonly resultingMemberChargedClosureCount: Uint32V2
  readonly resultingProjectChargedClosureCount: Uint32V2
  readonly resultingMemberAccountedAdmissionByteLength: Uint64V2
  readonly resultingProjectAccountedAdmissionByteLength: Uint64V2
}

interface RemoteIngressEvidenceAdmissionCheckpointRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-checkpoint-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly priorCheckpointIdentityDigest: DigestV2 | null
  readonly priorRecursiveHistoryCommitment: DigestV2 | null
  readonly intervalFirstTransitionGeneration: Uint64V2 | null
  readonly intervalLastTransitionGeneration: Uint64V2 | null
  readonly intervalTransitionCount: Uint32V2
  readonly orderedIntervalTransitionRecordDigests: readonly DigestV2[]
  readonly intervalHistoryCommitment: DigestV2
  readonly coveredTransitionCount: Uint64V2
  readonly recursiveHistoryCommitment: DigestV2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}
```

It commits `generation`, current transition/checkpoint, the stable-key and member
quota COW roots, Project monotonic attempt count, charged closure count and accounted
bytes. Per-stable-key and per-member mutable heads do not exist.

Admission states are `reserved`, `settled`, `released/abandoned` and
`released/charge-transferred`. Commands are exactly `reserve`, `settle`,
`abandon-release` and `transfer-release`. Every source member must equal the
authenticated signed-offer source member and stable-key source member.

Attempt counts are monotonic:

```text
stable key <= 2
source member per Project epoch <= 512
Project epoch <= 8192
```

A successful non-idempotent reserve increments all three. Settle and releases never
return an attempt slot. Exact idempotent reserve writes nothing. Quota is charged
before staging allocation. Only `abandon-release` subtracts the exact closure count
and bytes once. `transfer-release` atomically changes the charge owner from admission
to the exact replacement in the same epoch-head CAS; Project/source-member charged
counts, accounted bytes and all four aggregate totals remain byte-identical to the
reservation evidence. Charge transfer uses an acyclic binding core shared by the
settled admission state and exact replacement root/head. Old and replacement
immutable records may coexist physically during publication, but logical quota is
always exactly one charge: it is never zero and never temporarily double-charged.

Reserve also binds the exact imported `ProtocolLimitsV2` object and its digest. The
four aggregate limits are:

```text
pendingRemoteIngressObjectsPerProjectEpoch == "8192"
pendingRemoteIngressBytesPerProjectEpoch == "536870912"
pendingRemoteIngressObjectsPerSourceMember == "512"
pendingRemoteIngressBytesPerSourceMember == "134217728"
```

`ReserveRemoteIngressRequestV2.accountedAdmissionByteLength` is the exact
prospective closure byte charge, not merely the transfer payload. In the one
epoch-head CAS, Project/node computes the prospective Project and source-member
charged closure counts and accounted byte totals. Equality with each applicable
cap is admitted; any plus-one count or byte rejects with
`evidence-capacity-exceeded` before a staging object, COW page, transition,
reservation record, recovery head or epoch head is written.

```text
request.accountedAdmissionByteLength
  == reservedState.prospectiveClosureExactByteLength
  == reservedState.accountedAdmissionByteLength
  == quotaReservation.accountedAdmissionByteLength
```

On success Project/node returns plain
`RemoteIngressQuotaReservationPortEvidenceV2` with the exact `limitsDigest`, stable
key, manifest, kind, source member, `chargedClosureCount="1"`, accounted bytes, all
four resulting aggregate totals, admission epoch-head/transition digests and member
quota record digest. Reservation, completed-staging and immutable-object evidence
carry that value byte-for-byte unchanged. Kernel independently compares every
mirror and cap before minting its process receipt.

Owner installation transfers the same charge exactly once. Project/node returns
plain `RemoteIngressQuotaTransferPortEvidenceV2<K>` with the same limits/stable-key/
manifest/kind/member/count/bytes/four totals, prior and resulting admission heads,
the charge-transfer binding, `replacementKind="owner-install"` and the exact owner
install root/head. The owner install evidence and Kernel receipt carry that value
byte-for-byte. A changed total, limit digest, transfer binding, replacement root or
head is `owner-quota-transfer-invalid`/`owner-quota-transfer-mismatch`; it grants no
install receipt or ACK eligibility. Project/node never mints either Kernel receipt.

There are exactly two persistent COW maps: `stable-key-state` and `member-quota`.
Both use the same canonical geometry:

```text
leaf max 128; non-root min 64; overflow 129 -> 64/65
internal max 74; non-root min 37; overflow 75 -> 37/38
root internal 2..74; maximum height 9
maximum exact restricted-JCS page bytes 65,536
```

The maximum-width fixture admits a 74-child page and must split before serializing
75 children. A map page with the wrong map kind, boundary, subtree count, Project,
epoch or canonical key order is `store-corrupt`.

Every 256 transitions create a recursive checkpoint committing the exact ordered
interval, both COW roots, Project totals and prior recursive history commitment.
Only the current and previous checkpoint records are retained by the epoch head;
the prior checkpoint identity in the recursive commitment is diagnostic and not a
native retention edge.

### 16.3 Admission publication recovery

One pointer exists per Project epoch:

```text
<ProjectEpochNativeStore>/remote-ingress-evidence-admission/
  publication-recovery-head
    -> RemoteIngressEvidenceAdmissionPublicationRecoveryHeadRecordV2 digest
```

```ts
interface RemoteIngressEvidenceAdmissionPublicationOperationRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-publication-operation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly transition: "reserve" | "settle" | "abandon-release" | "transfer-release"
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly candidateEpochHeadRecordDigest: DigestV2
  readonly transitionRecordDigest: DigestV2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly checkpointRecordDigest: DigestV2
}

interface AdmissionPublicationTerminalBaseV2 {
  readonly format: "convax.remote-ingress-evidence-admission-publication-terminal-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly operationRecordDigest: DigestV2
}

type RemoteIngressEvidenceAdmissionPublicationTerminalRecordV2 =
  | (AdmissionPublicationTerminalBaseV2 & {
      readonly status: "published"
      readonly observedEpochHeadPointerDigest: DigestV2
      readonly quarantineReason: null
    })
  | (AdmissionPublicationTerminalBaseV2 & {
      readonly status: "quarantined"
      readonly observedEpochHeadPointerDigest: DigestV2
      readonly quarantineReason:
        | "unexpected-epoch-head" | "candidate-closure-mismatch"
    })
  | (AdmissionPublicationTerminalBaseV2 & {
      readonly status: "quarantined"
      readonly observedEpochHeadPointerDigest: DigestV2 | null
      readonly quarantineReason: "pointer-store-corrupt"
    })

interface AdmissionPublicationRecoveryHeadBaseV2 {
  readonly format: "convax.remote-ingress-evidence-admission-publication-recovery-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly priorHeadIdentityDigest: DigestV2 | null
}

type RemoteIngressEvidenceAdmissionPublicationRecoveryHeadRecordV2 =
  AdmissionPublicationRecoveryHeadBaseV2 &
    (
      | { readonly phase: "idle"; readonly operationId: null;
          readonly operationRecordDigest: null; readonly terminalRecordDigest: null }
      | { readonly phase: "publication-pending"; readonly operationId: Id128V2;
          readonly operationRecordDigest: DigestV2; readonly terminalRecordDigest: null }
      | { readonly phase: "reconciled-published" | "quarantined";
          readonly operationId: Id128V2; readonly operationRecordDigest: DigestV2;
          readonly terminalRecordDigest: DigestV2 }
    )
```

Genesis is generation zero, prior null and the exact idle variant. Every checked
successor increments generation, names the current record digest as prior identity
and follows only:

```text
idle -> publication-pending
publication-pending -> reconciled-published | quarantined
reconciled-published -> idle
quarantined -> no same-epoch successor
```

Candidate admission objects and operation record are fsynced before publishing the
pending recovery head. Only then may Project/node CAS the sole epoch-head pointer.
Recovery reloads that pointer: exact candidate publishes a `published` terminal;
exact expected prior retries only the same CAS; any other pointer or candidate
closure mismatch publishes a quarantined terminal and blocks the epoch. Business
commands, counters and candidates are never replayed during reconciliation.

Plain transition evidence may leave Project/node only after
`reconciled-published` is current. Kernel reloads the epoch head and validates every
mirror before minting its receipt. Clearing to idle drops current recovery edges but
does not synchronously delete immutable records.

## 17. Dependency-carrier owner authorities and attempt-keyed ACK

### 17.1 Project carrier wrappers and semantic/currentness gate

`@convax/project` owns two and only two process-local carrier authorities: one for
Canvas genesis and one for RSA. Control's F13 is structural carrier validation
only. The Project semantic/currentness coordinator below is deliberately not named
F13 and cannot be replaced by a successful Control verifier result.

Each authority captures exact Project/epoch/scope, selected Project owner artifact,
kind-specific verifier, one common Project semantic/currentness capability and
owner-install persistence capability. The private registry binds every live object
and artifact/policy digest. Structural copies, digest reconstruction, swapped
components, disposed values, cross-Project and cross-epoch values reject.
For both kinds:

```text
authority.ownerArtifactDigest
  == authority.projectOwnerArtifactDigest
  == bundle-selected Project owner artifact digest
```

Control/Canvas verifier digests are captured dependencies and never replace the
generic port's owner artifact.

```ts
type RemoteDependencyCarrierKindV2 =
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"
type ProjectPrivateCarrierAckAuthorityV2 = "project-private-carrier-ack"

type CanvasGenesisProofCarrierExactBytesV2 =
  import("@convax/canvas").CanvasGenesisProofCarrierExactBytesV2
type ValidateCanvasGenesisProofCarrierResultV2 =
  import("@convax/canvas").ValidateCanvasGenesisProofCarrierResultV2
type CanvasGenesisProofCarrierVerifierV2 =
  import("@convax/canvas").CanvasGenesisProofCarrierVerifierV2
type DocumentShardResetAuthorizationCarrierExactBytesV2 =
  import("@convax/project/collaboration-protocol")
    .DocumentShardResetAuthorizationCarrierExactBytesV2
type VerifyDocumentShardResetAuthorizationCarrierResultV2 =
  import("@convax/project/collaboration-protocol")
    .VerifyDocumentShardResetAuthorizationCarrierResultV2
type DocumentShardResetAuthorizationCarrierVerifierV2 =
  import("@convax/project/collaboration-protocol")
    .DocumentShardResetAuthorizationCarrierVerifierV2

interface ProjectCarrierSemanticCurrentnessCapabilityV2 {
  readonly policyDigest: DigestV2
  // The phase-aware live gate is package-private and has no codec.
}

interface ProjectDependencyCarrierOwnerInstallPersistenceCapabilityV2 {
  readonly artifactDigest: DigestV2
  // Project/node returns plain evidence only; this value has no portable codec.
}

declare const projectCanvasGenesisOwnerAuthorityBrandV2: unique symbol
declare const projectRsaOwnerAuthorityBrandV2: unique symbol
declare const projectDependencyCarrierOwnerAuthorityFactoryBrandV2: unique symbol

interface ProjectCanvasGenesisOwnerAuthorityFactoryInputV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2 & {
    readonly docKind: "canvas"
    readonly docId: CanvasIdV2
  }
  readonly projectOwnerArtifactDigest: DigestV2
  readonly canvasGenesisVerifier: CanvasGenesisProofCarrierVerifierV2
  readonly canvasVerifierArtifactDigest: DigestV2
  readonly semanticCurrentness: ProjectCarrierSemanticCurrentnessCapabilityV2
  readonly ownerInstallPersistence:
    ProjectDependencyCarrierOwnerInstallPersistenceCapabilityV2
}

interface ProjectRsaOwnerAuthorityFactoryInputV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: ProjectIndexScopeV2
  readonly projectOwnerArtifactDigest: DigestV2
  readonly structuralVerifier: DocumentShardResetAuthorizationCarrierVerifierV2
  readonly structuralVerifierArtifactDigest: DigestV2
  readonly canvasGenesisVerifier: CanvasGenesisProofCarrierVerifierV2
  readonly canvasVerifierArtifactDigest: DigestV2
  readonly semanticCurrentness: ProjectCarrierSemanticCurrentnessCapabilityV2
  readonly ownerInstallPersistence:
    ProjectDependencyCarrierOwnerInstallPersistenceCapabilityV2
}

interface ProjectCanvasGenesisOwnerAuthorityV2 {
  readonly kind: "canvas-genesis-proof-carrier"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2 & {
    readonly docKind: "canvas"
    readonly docId: CanvasIdV2
  }
  readonly projectOwnerArtifactDigest: DigestV2
  readonly canvasVerifierArtifactDigest: DigestV2
  readonly semanticCurrentnessPolicyDigest: DigestV2
  readonly ownerInstallPersistenceArtifactDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly [projectCanvasGenesisOwnerAuthorityBrandV2]: true
}

interface ProjectRsaOwnerAuthorityV2 {
  readonly kind: "document-shard-reset-authorization-carrier"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: ProjectIndexScopeV2
  readonly projectOwnerArtifactDigest: DigestV2
  readonly structuralVerifierArtifactDigest: DigestV2
  readonly canvasVerifierArtifactDigest: DigestV2
  readonly semanticCurrentnessPolicyDigest: DigestV2
  readonly ownerInstallPersistenceArtifactDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly [projectRsaOwnerAuthorityBrandV2]: true
}

type RemoteNonFrameIngressOwnerPortFactoryV2 =
  import("@convax/collaboration").RemoteNonFrameIngressOwnerPortFactoryV2
type RemoteNonFrameIngressOwnerPortV2<
  K extends RemoteDependencyCarrierKindV2,
  A extends ProjectPrivateCarrierAckAuthorityV2,
> =
  import("@convax/collaboration").RemoteNonFrameIngressOwnerPortV2<K, A>

interface ProjectDependencyCarrierOwnerAuthorityFactoryV2 {
  createCanvasGenesisAuthority(
    input: ProjectCanvasGenesisOwnerAuthorityFactoryInputV2,
  ): ProjectCanvasGenesisOwnerAuthorityV2

  createRsaAuthority(
    input: ProjectRsaOwnerAuthorityFactoryInputV2,
  ): ProjectRsaOwnerAuthorityV2

  createCanvasGenesisOwnerPort(
    authority: ProjectCanvasGenesisOwnerAuthorityV2,
    genericFactory: RemoteNonFrameIngressOwnerPortFactoryV2,
  ): RemoteNonFrameIngressOwnerPortV2<
    "canvas-genesis-proof-carrier",
    "project-private-carrier-ack"
  >

  createRsaOwnerPort(
    authority: ProjectRsaOwnerAuthorityV2,
    genericFactory: RemoteNonFrameIngressOwnerPortFactoryV2,
  ): RemoteNonFrameIngressOwnerPortV2<
    "document-shard-reset-authorization-carrier",
    "project-private-carrier-ack"
  >

  readonly [projectDependencyCarrierOwnerAuthorityFactoryBrandV2]: true
}
```

For both authorities the captured verifier object identity is registered, not
reconstructed from a digest. The Canvas verifier's callable
`canvasGenesisVerifier(exactBytes)` is invoked over exact
`CanvasGenesisProofCarrierExactBytesV2`; its own
`canvasGenesisVerifier.canvasArtifactDigest`, the captured
`canvasVerifierArtifactDigest`, the validated result's `canvasArtifactDigest` and
the bundle-selected Canvas artifact digest must all be byte-equal. Project never
captures a generic Canvas owner runtime or reimplements `CVXCGP02`.
Only `status="validated"` exposes a usable `identity`. `pending` propagates owner
dependency pending and discards the attempt; `rejected` rejects owner validation.
Project neither copies Canvas error members nor interprets Canvas section/schema
validation, and it never treats a diagnostic result as portable authority.

Canvas-genesis ingress closes generic scope and subject as follows:

```text
completed.evidence.kind == "canvas-genesis-proof-carrier"
completed.evidence.scope == authority.scope
validated.identity.scope == authority.scope
completed.evidence.subjectDigest
  == validated.identity.checkpointObjectDigest
```

RSA ingress closes them independently:

```text
completed.evidence.kind == "document-shard-reset-authorization-carrier"
completed.evidence.scope == authority.scope
completed.evidence.subjectDigest == validated claim.coreDigest
validated carrier projectId/projectEpoch == authority projectId/projectEpoch
validated claim.core.projectIndexScope == authority.scope
```

Null scope, old/new Canvas scope substituted for the RSA ProjectIndex scope, a
checkpoint subject for RSA, a claim subject for Canvas genesis, or any cross-kind
reuse rejects before immutable-object publication.

The Canvas-genesis authority uses the same four lifecycle boundaries but its closed
semantic gate is kind-specific: current Project/epoch, the exact still-staged route,
reachable stage dependency frame, verifier-returned checkpoint/predecessor identity,
current wanted root/dependency-index head, live transfer attempt and the phase-
appropriate reservation/owner-install quota transfer. It does not invent an RSA
claim, reset approval or admin requirement.

The RSA semantic validation order is:

```text
bounded carrier structural validation through the captured Control verifier
-> embedded Canvas generation proof validation through the captured Canvas verifier
-> fresh Project base references and ProjectIndex live route/head authority
-> exact wanted-root and reservation/charge-state recheck
-> current membership editor + edit authorization + installed floor
-> current causal signer + admin authorization/capability
-> isolated semantic validation
```

For the RSA-embedded Canvas result, the following bindings are mandatory before
any semantic result is registered:

```text
rsaCanvasGenesisResult.identity.scope == claim.core.newScope
rsaCanvasGenesisResult.identity.checkpointObjectDigest
  == claim.core.stagedGenesisCheckpointObjectDigest
  == routeCasCore.stagedGenesisCheckpointObjectDigest
rsaCanvasGenesisResult.identity.identity.projectIndexRouteDependencyFrameDigest
  == exact current predecessor ProjectIndex frame digest selected by the authored-base closure
```

The selected ProjectIndex base-closure proof must additionally show that this exact
frame digest is reachable from the reset intent's authored base and that its actual
write names the current Canvas route fact whose record digest equals
`routeCasCore.predecessorActivationDigest`. A reachable frame for another Canvas, a
frame that merely precedes the base without writing that activation, another
checkpoint object or another new scope rejects. A newer current ProjectIndex head
is never substituted for the authored base.

Every attempt invokes the captured verifier over the exact
`DocumentShardResetAuthorizationCarrierExactBytesV2` bytes. Its
`VerifyDocumentShardResetAuthorizationCarrierResultV2` value is plain diagnostic
data bound only inside that attempt's private live registry; it is never persisted,
serialized or minted into authority.

For RSA only, the one Project semantic/currentness gate repeats without a reduced
fast path at all four boundaries: initial owner validation; immediately before Project/node
owner installation; immediately before Kernel owner-install receipt and Project
durable-receipt minting; and immediately before ACK outbox enqueue. At every
boundary it reloads and validates:

1. exact current membership snapshot, active member role `editor` and active
   replica `editState="active-editor"`;
2. exact current `ReplicaEditAuthorizationV2`, including Project/epoch,
   member/replica/actor, authorization epochs, protocol, ProjectIndex schema and
   validation-artifact set;
3. `installedFloorSetDigest` equal to the current installed
   `ReplicaProjectFloorRootV2.coreDigest` covering the section-3.6 live-scope set;
4. the Kernel `CausalSignerAuthorityV2` equal to that credential and edit
   authorization chain;
5. the exact current live ProjectIndex route, predecessor activation, old/new shard
   scope and no tombstone;
6. the exact current wanted root and dependency-index head;
7. the same stable-key reservation and quota charge: reserved/settled and
   unconsumed before install, then consumed exactly once by the exact owner-install
   charge-transfer binding before receipt/ACK;
8. the exact current admin member authorization epoch, signed
   `ProjectAdminCapabilityV2`, grant and approval/claim binding from section 8.2.1.

Any changed fact returns pending/rejected for a fresh attempt; it never reuses the
prior semantic result. Project/node returns only plain owner-install and quota
transfer evidence. Kernel validates every mirror and alone mints its generic
receipt.

For each kind, the installed result and generic receipt must carry exactly:

```text
ackBinding.authority == "project-private-carrier-ack"
ackBinding.evidenceDigest == ownerInstallRecordDigest
quotaTransfer.kind == installed kind
quotaTransfer.replacementKind == "owner-install"
quotaTransfer.replacementRootRecordDigest == ownerInstallRecordDigest
quotaTransfer.replacementRootHeadRecordDigest == ownerHeadRecordDigest
```

`evidenceDigest=null`, another owner-install digest, a Project-generated generic
receipt, or an ACK before exact quota transfer/currentness is invalid. There is one
registered authority and one selected owner port per kind; a shared union port,
Control-owned semantic port or Desktop-selected owner has declaration count zero.

### 17.2 Attempt key and outbox

After the repeated complete Project semantic/currentness gate and owner-install
barrier, `@convax/project` mints
the process-local `RemoteDependencyCarrierDurableReceiptV2` only while the same
Project/epoch/scope, wanted root, editor authority, dependency-index head, immutable
object, generic Kernel install receipt and live transfer-attempt object remain
current. It then derives the branded attempt key from that exact receipt, Project
gate, Desktop outbox, Project/epoch/source member/stable key, manifest, carrier kind
and subject. The receipt and key are private live objects; neither exposes a
connection id, raw transfer id, ACK bytes, Peer body or signature.

Desktop owns exactly one connection-local outbox for that attempt key. Its
synchronous API is:

```ts
type RemoteTransferAttemptBindingV2<
  K extends RemoteDependencyCarrierKindV2,
> =
  import("@convax/collaboration").RemoteTransferAttemptBindingV2<K>
type ProjectPrivateCarrierAckBindingV2 =
  import("@convax/collaboration")
    .RemoteIngressOwnerAckBindingV2<"project-private-carrier-ack">

declare const remoteDependencyCarrierDurableReceiptBrandV2: unique symbol
declare const dependencyCarrierTransferAckAttemptKeyBrandV2: unique symbol
declare const dependencyCarrierTransferAckOutboxPortBrandV2: unique symbol

interface RemoteDependencyCarrierDurableReceiptV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly kind: K
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly subjectDigest: DigestV2
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly ackBinding: ProjectPrivateCarrierAckBindingV2
  readonly dependencyIndexHeadRecordDigest: DigestV2
  readonly wantedRootDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly exactManifestDigest: DigestV2
  readonly transferAttempt: RemoteTransferAttemptBindingV2<K>
  readonly [remoteDependencyCarrierDurableReceiptBrandV2]: true
}

interface DependencyCarrierTransferAckAttemptKeyV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly kind: K
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly [dependencyCarrierTransferAckAttemptKeyBrandV2]: true
}

interface EnsureDependencyCarrierTransferAckRequestV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly attemptKey: DependencyCarrierTransferAckAttemptKeyV2<K>
  readonly kind: K
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly durabilityProofDigest: null
}

type EnsureDependencyCarrierTransferAckResultV2 =
  | { readonly status: "enqueued" | "already-enqueued";
      readonly outboundEnqueueId: Id128V2 }
  | { readonly status: "not-enqueued";
      readonly code: "outbound-backpressure" }
  | { readonly status: "indeterminate";
      readonly code: "enqueue-outcome-indeterminate" }
  | { readonly status: "rejected"; readonly code:
      | "attempt-key-stale" | "connection-closed"
      | "manifest-mismatch" | "subject-mismatch" }

type QueryDependencyCarrierTransferAckResultV2 =
  | { readonly status: "enqueued"; readonly outboundEnqueueId: Id128V2 }
  | { readonly status: "not-enqueued" }
  | { readonly status: "indeterminate" }
  | { readonly status: "stale"; readonly code:
      | "attempt-key-stale" | "connection-closed" }

interface DependencyCarrierTransferAckOutboxPortV2 {
  ensureEnqueuedOnce<K extends RemoteDependencyCarrierKindV2>(
    request: EnsureDependencyCarrierTransferAckRequestV2<K>,
  ): EnsureDependencyCarrierTransferAckResultV2

  queryAttempt<K extends RemoteDependencyCarrierKindV2>(
    attemptKey: DependencyCarrierTransferAckAttemptKeyV2<K>,
  ): QueryDependencyCarrierTransferAckResultV2

  readonly [dependencyCarrierTransferAckOutboxPortBrandV2]: true
}
```

`ensureEnqueuedOnce` returns `enqueued`, `already-enqueued`, `not-enqueued`,
`indeterminate` or `rejected`. Queue insertion and the attempt's enqueued state are
one atomic in-process action. Unexpected throw is indeterminate, never proof of zero
enqueue. Only Desktop constructs/authenticates/sequences Peer ACK bytes.

The Project gate receipt state is:

```text
issued -> loading -> consuming
consuming -> enqueued | issued(backpressure) | outbound-indeterminate | abandoned
outbound-indeterminate -> enqueued | issued | outbound-indeterminate | abandoned
```

Before the final synchronous outbox call, the Project sole-writer section reloads
the exact Project epoch, wanted root, editor authority, owner identity, install
head, dependency index, carrier closure, manifest and live attempt, and proves the
receipt's `ackBinding.authority` is the literal Project authority and its
`evidenceDigest` is the same `ownerInstallRecordDigest`. An indeterminate
result must query the same attempt key before any retry. After restart all old keys,
receipts and connection bindings are stale; reconnect creates a new attempt and
revalidates durable carrier state. No old ACK is reconstructed.

## 18. Durable reference scan and frame-object GC

Each active frame-object scan has one recovery head with phases:

```text
first-proof-durable
-> fence-prepared
-> fence-durable
-> second-proof-durable
-> gc-command-issued
-> terminal-deleted | terminal-not-deleted
```

```ts
type FrameObjectRefV2 = import("@convax/collaboration").FrameObjectRefV2

interface DurableReferenceScanRecoveryHeadRecordV2 {
  readonly format: "convax.durable-reference-scan-recovery-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scanOperationId: Id128V2
  readonly priorRecoveryHeadRecordDigest: DigestV2 | null
  readonly phase:
    | "first-proof-durable" | "fence-prepared" | "fence-durable"
    | "second-proof-durable" | "gc-command-issued"
    | "terminal-deleted" | "terminal-not-deleted"
  readonly targetRefDiagnostic: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly fencePreparationRecordDigest: DigestV2 | null
  readonly fenceCommitRecordDigest: DigestV2 | null
  readonly secondProofRecordDigest: DigestV2 | null
  readonly gcCommandRecordDigest: DigestV2 | null
  readonly terminalRecordDigest: DigestV2 | null
}

interface DurableReferenceFrameGcCommandRecordV2 {
  readonly format: "convax.frame-object-gc-command-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scanOperationId: Id128V2
  readonly priorSecondProofRecoveryHeadRecordDigest: DigestV2
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly fenceCommitRecordDigest: DigestV2
  readonly secondProofRecordDigest: DigestV2
  readonly secondReplicaHeadRecordDigest: DigestV2
  readonly secondStoreGeneration: Uint64V2
  readonly secondReferenceIndexHeadRecordDigest: DigestV2
  readonly secondReferenceIndexGeneration: Uint64V2
  readonly secondReferenceIndexRootRecordDigest: DigestV2
  readonly secondReferenceIndexRootPageDigest: DigestV2 | null
  readonly secondReferenceEntryCount: Uint64V2
  readonly secondIndexCommitment: DigestV2
  readonly secondCoverageRecordDigest: DigestV2
}

type GarbageCollectFrameObjectPersistenceCommandV2 =
  import("@convax/collaboration")
    .GarbageCollectFrameObjectPersistenceCommandV2
```

The head binds one scan operation, target frame ref, prior recovery head and exact
first proof, preparation, fence, second proof, command and terminal digests according
to the phase. No other null/non-null combination decodes.

```text
first-proof-durable: first only
fence-prepared: first + preparation
fence-durable: first + preparation + fence
second-proof-durable: first + preparation + fence + second proof
gc-command-issued: first + preparation + fence + second proof + command
terminal-deleted | terminal-not-deleted:
  first + preparation + fence + second proof + command + terminal
```

Fence publication reloads the first-proof head, fsyncs one preparation, fsyncs one
fence, advances logical reference-store generation exactly once, advances reference
index generation exactly once and fsyncs the fence-durable head. Proof, preparation,
recovery and command metadata do not themselves advance those generations or add a
frame reference-index edge.

Kernel alone owns both live proof brands and GC authorization. After consuming
them, it sends Project/node a plain `GarbageCollectFrameObjectPersistenceCommandV2`
binding both proofs, fence, replica head, store/index generations, index
head/root/page/count/commitment and coverage. No branded GC authority crosses the
persistence boundary.

Project/node writes/fsyncs the command and `gc-command-issued` recovery head, then
under its sole-writer section reloads all named objects, the current replica head,
all eight source heads, generations, root, coverage, zero reference count and
unreachability. It writes/fsyncs a terminal record and terminal recovery head before
physical deletion. Any changed fact yields `terminal-not-deleted` and zero deletion.
The recovery pointer clears only after terminal reconciliation; only then can scan
metadata enter metadata GC.

## 19. Admission metadata GC and native deletion

### 19.1 Sole metadata-GC authority

One mutable pointer exists per Project epoch:

```text
<ProjectEpochNativeStore>/remote-ingress-evidence-admission/metadata-gc-head
  -> RemoteIngressEvidenceMetadataGcHeadRecordV2 digest
```

```ts
interface RemoteIngressEvidenceMetadataNonGcRootIdentityV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly currentEpochHeadRecordDigest: DigestV2
  readonly currentCheckpointRecordDigest: DigestV2
  readonly previousCheckpointRecordDigest: DigestV2 | null
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly durableIngressRootSetDigest: DigestV2
  readonly recoveryRootSetDigest: DigestV2
  readonly auditRootSetDigest: DigestV2
  readonly resetRetentionRootSetDigest: DigestV2
  readonly identityDigest: DigestV2
}

interface RemoteIngressEvidenceMetadataGcRootSetV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly metadataGcHeadRecordDigest: DigestV2
  readonly metadataGeneration: Uint64V2
  readonly currentEpochHeadRecordDigest: DigestV2
  readonly currentCheckpointRecordDigest: DigestV2
  readonly previousCheckpointRecordDigest: DigestV2 | null
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly durableIngressRootSetDigest: DigestV2
  readonly recoveryRootSetDigest: DigestV2
  readonly auditRootSetDigest: DigestV2
  readonly resetRetentionRootSetDigest: DigestV2
}

interface RemoteIngressEvidenceMetadataGcPreparationRecordV2 {
  readonly format: "convax.remote-ingress-evidence-metadata-gc-preparation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly priorMetadataGcHeadRecordDigest: DigestV2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly firstRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
  readonly firstReferenceCount: "0"
}

interface RemoteIngressEvidenceMetadataGcHeadRecordV2 {
  readonly format: "convax.remote-ingress-evidence-metadata-gc-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly priorHeadIdentityDigest: DigestV2 | null
  readonly phase: "idle" | "first-scan-prepared" | "second-scan-durable"
    | "delete-committed" | "terminal-deleted" | "terminal-not-deleted"
  readonly operationId: Id128V2 | null
  readonly retryGeneration: Uint64V2 | null
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2 | null
  readonly objectRecordDigest: DigestV2 | null
  readonly attemptedCandidateSetRootRecordDigest: DigestV2
  readonly preparationRecordDigest: DigestV2 | null
  readonly secondScanRecordDigest: DigestV2 | null
  readonly deletionCommitRecordDigest: DigestV2 | null
  readonly terminalRecordDigest: DigestV2 | null
}

interface RemoteIngressEvidenceMetadataGcCandidateStateRecordV2 {
  readonly format: "convax.remote-ingress-evidence-metadata-gc-candidate-state-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly state: "first-scan-prepared" | "second-scan-durable"
    | "delete-committed" | "terminal-deleted" | "terminal-not-deleted"
  readonly lastNonMetadataRootIdentityDigest: DigestV2
  readonly expectedPriorMetadataGcHeadRecordDigest: DigestV2
}

interface RemoteIngressEvidenceMetadataGcSecondScanRecordV2 {
  readonly format: "convax.remote-ingress-evidence-metadata-gc-second-scan-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly preparationRecordDigest: DigestV2
  readonly firstScanPreparedHeadRecordDigest: DigestV2
  readonly expectedSecondScanDurableHeadGeneration: Uint64V2
  readonly firstRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
  readonly secondRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
  readonly firstNonMetadataRootIdentityDigest: DigestV2
  readonly secondNonMetadataRootIdentityDigest: DigestV2
  readonly firstReferenceCount: "0"
  readonly secondReferenceCount: "0"
}

interface RemoteIngressEvidenceMetadataGcDeletionCommitRecordV2 {
  readonly format: "convax.remote-ingress-evidence-metadata-gc-deletion-commit-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly secondScanRecordDigest: DigestV2
  readonly secondScanDurableHeadRecordDigest: DigestV2
  readonly authorizedNonMetadataRootIdentityDigest: DigestV2
}

interface RemoteIngressEvidenceMetadataRecoveryRootCommitmentV2 {
  readonly format: "convax.remote-ingress-evidence-metadata-recovery-root-commitment/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly unchangedRecoveryRootsDigest: DigestV2
  readonly currentAdmissionPublicationRecoveryHeadRecordDigest: DigestV2
  readonly currentAdmissionPublicationOperationRecordDigest: DigestV2 | null
  readonly currentAdmissionPublicationTerminalRecordDigest: DigestV2 | null
}
```

Its phases are exactly:

```text
idle
-> first-scan-prepared
-> second-scan-durable
-> delete-committed
-> terminal-deleted | terminal-not-deleted
terminal-not-deleted -> first-scan-prepared only after a changed non-GC root identity
```

The non-GC root identity commits the current admission epoch head, current/previous
checkpoint, both COW roots, durable ingress roots, current admission-publication
recovery closure, audit roots and reset-retention roots. Metadata-GC head identity,
retry records and metadata generation are excluded.

The admission-publication contribution is one atomic commitment of the current
publication recovery head plus its current operation and terminal digests. Idle
retains only its current head; pending retains head+operation; reconciled/quarantined
retains head+operation+terminal. `priorHeadIdentityDigest` is diagnostic and never a
retention edge. Quarantined publication closure remains rooted until Project-epoch
reset.

Candidate state stores `expectedPriorMetadataGcHeadRecordDigest`; it never names its
resulting head. The resulting head reaches candidate state only through the
attempted-candidate COW root, keeping the graph acyclic.

Prepare performs two complete zero-reference scans separated by durable records and
head CAS. Execute reloads the exact second scan and head, refolds all non-GC roots,
requires identical root identity, zero references, non-currentness and
unreachability, then fsyncs a `delete-committed` tombstone. While that tombstone is
current, new native references to the candidate reject.

Before unlink and after every restart, Project/node repeats the complete root and
reference decision. A changed root publishes `terminal-not-deleted`. Exact absence
under a continuously current tombstone may publish `terminal-deleted`; it never
recreates or deletes an alias.

### 19.2 Exhaustive ten-kind location authority

```ts
type RemoteIngressEvidenceMetadataObjectKindV2 =
  | "epoch-head"
  | "transition"
  | "checkpoint"
  | "stable-key-state"
  | "member-quota"
  | "stable-key-map-page"
  | "member-quota-map-page"
  | "admission-publication-operation"
  | "admission-publication-terminal"
  | "admission-publication-recovery-head"
```

The sole Project/node mapping is exhaustive:

| Kind | Descriptor-relative directory components | Exact format / discriminator |
| --- | --- | --- |
| `epoch-head` | `remote-ingress-evidence-admission/epoch-head-records` | `convax.remote-ingress-evidence-admission-epoch-head-record/2` |
| `transition` | `remote-ingress-evidence-admission/transition-records` | `convax.remote-ingress-evidence-admission-transition-record/2` |
| `checkpoint` | `remote-ingress-evidence-admission/checkpoint-records` | `convax.remote-ingress-evidence-admission-checkpoint-record/2` |
| `stable-key-state` | `remote-ingress-evidence-admission/stable-key-state-records` | `convax.remote-ingress-evidence-stable-key-state-record/2` |
| `member-quota` | `remote-ingress-evidence-admission/member-quota-records` | `convax.remote-ingress-evidence-member-quota-record/2` |
| `stable-key-map-page` | `remote-ingress-evidence-admission/maps/stable-key-state/pages` | leaf/internal map page; `mapKind="stable-key-state"` |
| `member-quota-map-page` | `remote-ingress-evidence-admission/maps/member-quota/pages` | leaf/internal map page; `mapKind="member-quota"` |
| `admission-publication-operation` | `remote-ingress-evidence-admission/publication/operations` | `convax.remote-ingress-evidence-admission-publication-operation-record/2` |
| `admission-publication-terminal` | `remote-ingress-evidence-admission/publication/terminals` | `convax.remote-ingress-evidence-admission-publication-terminal-record/2` |
| `admission-publication-recovery-head` | `remote-ingress-evidence-admission/publication/recovery-head-records` | `convax.remote-ingress-evidence-admission-publication-recovery-head-record/2` |

There is no default, wildcard, legacy directory, path probe, dynamic registry,
platform-specific duplicate map or format-selected directory. The basename is the
canonical digest-native-key plus `.bin`, derived internally from the record digest.

### 19.3 Single fail-closed native delete capability

Project/node owns exactly one destructive capability for all ten kinds:

```ts
interface RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2 {
  deleteExactMetadataObject(command: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
    readonly objectRecordDigest: DigestV2
    readonly deletionCommitRecordDigest: DigestV2
    readonly deleteCommittedHeadRecordDigest: DigestV2
  }): Promise<
    | { readonly status: "deleted" | "already-absent" }
    | { readonly status: "rejected"; readonly code:
        | "native-delete-primitive-unavailable"
        | "native-root-identity-mismatch"
        | "native-containment-failed"
        | "native-entry-raced"
        | "native-object-mismatch"
        | "native-durability-failed"
        | "store-corrupt" }
  >
}
```

The command contains no native path, URI, filename or handle. The capability opens
one trusted Project-epoch root directory handle, traverses only fixed literal
components relative to retained no-follow handles, opens the final regular file
without following links, validates Project/epoch/format/map-kind/digest through that
handle, obtains stable native identity, atomically rechecks the same parent/name and
identity, unlinks relative to the same retained parent and flushes that same parent.

If the platform cannot guarantee rooted containment, no-follow traversal, stable
identity, same-entry conditional unlink, non-interleaving and same-parent durability,
it returns `native-delete-primitive-unavailable` and performs zero unlink. A race
never authorizes deletion of the replacement entry. `already-absent` requires the
exact current delete tombstone, exact parent identity, zero references and a durable
same-parent absence check.

This capability cannot delete ordinary Project files, managed assets, blobs, Canvas
objects, staging, Plugin/Marketplace bytes or arbitrary `.convax` entries.

## 20. Cross-cutting falsifiers and release gates

The authority is invalid if any test below fails:

1. Two ProjectIndex histories with the same nine-map facts yield different canonical
   state bytes, or an extra/missing/nested Yjs root is accepted.
2. Concurrent text writes silently lose a branch; binary currentness depends on a
   machine clock; tombstone permits late resurrection.
3. Canvas payload state appears in ProjectIndex, or a Canvas route/tombstone is
   selected outside ProjectIndex.
4. Local success occurs before object/outbox/journal/head durability, or reconnect
   replays and re-signs a business command.
5. Project/node creates a Kernel brand, branded cursor, branded GC authorization or
   branded persistence receipt.
6. Admission has a per-key/member mutable head, increments an idempotent attempt,
   admits attempt 3/513/8193, exceeds any of the four imported aggregate caps, writes
   anything for an exact-cap-plus-one reserve, or serializes a 75-child COW page.
7. Admission evidence escapes before `reconciled-published`, recovery replays a
   command, or quarantined publication accepts another command.
8. ACK callers provide wire bytes/routing, a throw is treated as not-enqueued, or an
   indeterminate attempt retries without querying the same key.
9. Frame GC deletes after any source head/root/generation/reference changed, or a
   branded Kernel GC authorization crosses into Project/node.
10. Metadata GC has other than ten kinds, another location table/delete capability,
    a path-based fallback, a format-selected directory or a delete-before-tombstone
    transition.
11. A symlink/reparse race, native identity change or unavailable same-parent flush
    permits unlink.
12. Blob ACK precedes verified publication/index durability, or ordinary Project
    files enter blob/metadata GC.
13. The ProjectIndex raw owner definition has non-null history, an unconstrained
    fact factory, unequal discovered/declared/consumed dependencies, different
    local/remote apply pipelines or any document-wide version guard.
14. Either carrier kind lacks its one registered Project authority/selected owner
    port, accepts the wrong scope/subject, captures a generic Canvas runtime, accepts
    non-validated Canvas output, or binds ACK evidence to anything except the exact
    owner-install record digest.
15. RSA semantic/currentness omits any of membership/editor, edit authorization,
    installed floor, causal signer, live route, wanted root, reservation/charge
    consumption or admin authorization at any of initial/pre-install/pre-receipt/
    pre-ACK gates.
16. Unsupported bytes are hydrated or deleted without explicit reset, or reset
    publishes a mixed old/new tree.
17. A clean implementation requires an earlier authority, draft, review or source
    code to determine any Project-owned field, owner, state, limit, path or
    transition.

### 20.1 Release gates

Before activation, independent implementations must agree on ProjectIndex genesis,
all record/intent restricted-JCS bytes, content projection permutations, Canvas
route/reset CAS, local crash matrices, admission COW74 fixtures, publication recovery
graph, attempt-key ACK reconciliation, scan-fence recovery, ten-kind native location
mapping, conditional deletion and Project reset. The final five authority files,
schema bundle and protocol digest must be regenerated from clean inputs and receive
unconditional 3/3 over the exact same hashes.
