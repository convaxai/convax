# Convax P2P v10 collaboration kernel and portable protocol appendix

Status: **normative revision-4 bundle candidate; exact instance generated for 3/3 review**. This
appendix is the sole owner of the generic causal-edit language, shared portable
primitives, deterministic Yjs wire codec, replica/candidate kernel, persistence
ports and instantiated `ProtocolSchemaBundleV2`. It is not implementation authority
until the complete revision-4 authority set receives 3/3 exact-digest approval.

The words MUST, MUST NOT, SHOULD and MAY are normative.

## 1. Scope, owner and dependency direction

`@convax/collaboration` exclusively owns:

- shared ids, `DocumentScopeV2`, `PortableStampV2`, restricted JCS and raw-byte
  digest rules used across owner schemas;
- causal head/frontier/context, generic actual-write evidence and the final
  long-lived-replica-signed causal frame;
- exact `CVXCOLL2` causal-edit envelope, state-vector/update codec and the stable
  replica-derived Yjs client-id mapping;
- one local `replicaDoc`, isolated `candidateDoc`, incoming-frame validation order,
  session undo coordination and typed persistence/journal ports;
- the four-owner protocol artifact manifest and the one portable
  `ProtocolSchemaBundleV2.coreDigest`, which is the v2 `protocolDigest`.

It MUST NOT own ProjectIndex or Canvas records, business reducers, membership or
reset policy, PeerJS, filesystem/native durability, React, Electron, Plugin
execution or service adapters. Owner packages inject closed schema/reducer ports;
`@convax/project/node` implements native barriers; Desktop composes IPC and
transport; `@convax/api` verifies only public browser-safe protocol exports.

Dependency direction remains:

```text
collaboration -> yjs only
canvas -> collaboration
project -> canvas, collaboration
desktop -> collaboration, canvas, project
api -> collaboration + project/collaboration-protocol
```

No owner imports another owner's private source to decode a frame. Generated public
validators derive from the exact four-artifact bundle instantiated after the
normative-prefix sentinel.

## 2. Shared portable primitives

```ts
type Id128V2 = string      // unpadded base64url of exactly 16 bytes
type ActorIdV2 = string    // unpadded base64url of exactly 32 bytes
type DigestV2 = string     // exactly 64 lowercase SHA-256 hex
type SignatureV2 = string  // unpadded base64url Ed25519 signature, exactly 64 bytes
type Uint32V2 = string     // canonical decimal 0..2^32-1
type Uint64V2 = string     // canonical decimal 0..2^64-1
type ProjectIdV2 = string  // exact opaque case-sensitive global URI owner codec
type CanvasIdV2 = `cv_${string}` // suffix exactly 64 lowercase SHA-256 hex
type DocumentScopeDigestV2 = DigestV2

declare const publicKeyV2Brand: unique symbol
declare const memberIdV2Brand: unique symbol
declare const replicaIdV2Brand: unique symbol
declare const sessionIdV2Brand: unique symbol
declare const peerIdV2Brand: unique symbol
declare const stateVectorV2Brand: unique symbol

type PublicKeyV2 = string & { readonly [publicKeyV2Brand]: "PublicKeyV2" }
type MemberIdV2 = Id128V2 & { readonly [memberIdV2Brand]: "MemberIdV2" }
type ReplicaIdV2 = string & { readonly [replicaIdV2Brand]: "ReplicaIdV2" }
type SessionIdV2 = Id128V2 & { readonly [sessionIdV2Brand]: "SessionIdV2" }
type PeerIdV2 = string & { readonly [peerIdV2Brand]: "PeerIdV2" }
type StateVectorV2 = Uint8Array & { readonly [stateVectorV2Brand]: "StateVectorV2" }
```

`ProjectIdV2` is not `Id128V2`; its exact codec remains globally owned by
`@convax/uri`. A Canvas id is Project-owned operation-derived identity. Every
Canvas route, Canvas identity and Canvas-kind document scope uses the same exact
`CanvasIdV2` bytes.

```ts
interface DocumentScopeV2 {
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  docKind: "project-index" | "canvas"
  docId: "project-index" | CanvasIdV2
  shardEpoch: Id128V2
}

interface PortableStampV2 {
  format: "convax.portable-stamp/2"
  lamport: Uint64V2
  actorId: ActorIdV2
  operationId: Id128V2
  writeOrdinal: Uint32V2
}
```

For `docKind="project-index"`, `docId` is exactly `project-index`; for
`docKind="canvas"`, `docId` is exactly one `CanvasIdV2`. Every scope comparison is
byte equality over all five fields. There is no `docEpoch`.

`DocumentScopeDigestV2` is exactly:

```text
SHA-256("convax.document-scope/2\0" || JCS(exact DocumentScopeV2))
```

Canvas `CanvasScopeIdV2` is an alias of this digest, not an opaque independent id.

Portable stamps compare ascending, maximum winning, by decoded unsigned Lamport,
decoded actorId bytes, decoded operationId bytes and decoded unsigned write ordinal.
Machine time, Yjs client id, service sequence, Peer arrival and filesystem order do
not participate. An owner-specific alias or second `PortableStampV2` wire shape is
forbidden.

### 2.1 Exact scalar codecs and rejection boundary

`PublicKeyV2` is one raw Ed25519 verification key encoded as exactly 43 ASCII
characters from `[A-Za-z0-9_-]`, with no prefix or padding. Strict unpadded RFC 4648
base64url decoding MUST produce exactly 32 bytes and re-encoding those bytes MUST
reproduce the input byte-for-byte. It is a verification key only: it is not member,
replica, session, Peer, identity or authority by itself.

Ed25519 verification is pure Ed25519, not Ed25519ctx or Ed25519ph, over the decoded
32-byte purpose-separated digest named by the exact DTO signature field. A conforming
backend implements the W3C WebCrypto Level 2 Ed25519 profile and RFC 8032 section
5.1.7's unbatched, cofactorless equation `[S]B = R + [k]A'`. It rejects before
authority admission: a signature not exactly 64 bytes; `S >= L`; noncanonical or
small-order encodings of `A` or `R`; and any key/signature accepted only by a
cofactored, batched or implementation-specific fallback. A signature role exists
only through its exact DTO field, purpose digest and credential/trust binding. No
key-purpose, field-role or domain fallback is permitted.

`MemberIdV2` and `SessionIdV2` are distinct nominal types with the same wire codec
as `Id128V2`: no prefix, exactly 22 case-sensitive ASCII base64url characters,
strictly decoding to exactly 16 bytes and re-encoding byte-for-byte. Each field
decoder assigns only the brand declared by that field; a wrong nominal brand fails
static typing. The wire scalar cannot prove its provenance, so a semantic relation
mismatch rejects only where an authoritative credential or store binding exists.
A case-changed string that independently passes canonical decoding is another valid
scalar, not a scalar-level "wrong case" error. Ordering compares decoded 16-byte
values.

`ReplicaIdV2` has exactly the prefix `replica_` followed by eight lowercase
hexadecimal digits. The suffix decodes as one nonzero unsigned 32-bit big-endian
integer. Zero, uppercase, another prefix or another length rejects. Within one
Project epoch it is allocated, durably reserved and never reused by the control
owner; expiry, abandonment, credential replacement, revocation, checkpoint pruning
or snapshot retirement cannot release the value. The same spelling in another
Project epoch is a separate identity. One replica keeps the same id across scopes
and actor-sequence rotation; key replacement receives a new id. The id is neither
authority nor edit order.

`PeerIdV2` has exactly the prefix `peer_` followed by 26 lowercase unpadded RFC 4648
base32 characters from `[a-z2-7]`. Strict decoding produces exactly 16 bytes and
re-encoding reproduces the input byte-for-byte; total length is 31 ASCII bytes.
The fixed spelling starts and ends alphanumeric and satisfies the PeerJS lexical
boundary without importing PeerJS. The kernel owns only this codec and byte
comparison; control owns allocation/routing, Desktop owns the PeerJS adapter, and
the global URI owner governs any URI embedding. A Peer id grants no identity,
membership, role, session or authorization.

`StateVectorV2` is a copy-owned raw `Uint8Array`, never JSON text or base64. Its
exact lifetime and canonical admission rules are defined by the pinned Yjs codec in
section 5. Scalar codecs reject noncanonical form, unknown spelling and cap excess
before JCS construction, signature verification, sorting or Yjs application.

## 3. Restricted JCS, digest and signature rules

Canonical JSON is RFC 8785 key ordering plus these closed restrictions:

- strings are NFC Unicode scalar sequences and keys are unique;
- numbers are finite JSON numbers; protocol integers use the decimal-string codecs
  above rather than JSON numbers;
- arrays are dense and objects are plain data objects;
- accessors, symbols, `undefined`, sparse arrays, cycles, lone surrogates, NaN,
  infinity and implementation prototypes are rejected;
- exact objects reject unknown/missing keys; closed unions reject unknown tags;
- arrays declared as sets are strictly sorted by the stated raw-byte codec and are
  duplicate-free.

Every structured digest is:

```text
SHA-256(UTF8(exact-domain-ending-/2) || 0x00 || JCS(exact closed value))
```

Every protocol raw-byte digest is:

```text
SHA-256(UTF8(exact-domain-ending-/2) || 0x00 || exact bytes)
```

Fields named exactly `sha256` or `blobSha256` retain ordinary content SHA-256 as
defined by Project/blob protocols. A signature covers the decoded 32-byte digest of
its purpose-separated preimage. Signature and digest fields are absent from their
own preimages.

Kernel-owned domains are exactly:

```text
convax.actual-write-evidence/2
convax.canonical-state/2
convax.causal-context/2
convax.causal-dependency-set/2
convax.causal-edit-core/2
convax.causal-edit-frame-digest/2
convax.causal-edit-signature/2
convax.causal-frontier/2
convax.causal-head-ref/2
convax.document-scope/2
convax.owner-canonicalizer-descriptor/2
convax.owner-actual-write-evidence/2
convax.protocol-schema-artifact/2
convax.protocol-schema-bundle-core/2
convax.replica-actor-head-set/2
convax.state-vector/2
convax.typed-intent/2
convax.validation-artifact-set/2
convax.yjs-update/2
```

The complete bundle registry is the strict UTF-8 sorted union of these domains and
the exact owner-domain sets in the Canvas, control-plane and Project artifacts.
Locally copied subsets are not protocol registries.

## 4. Four-owner artifact contract and no-self-reference rule

The portable bundle has exactly four refs in strict UTF-8 `name` order:

| `name` | `format` | Exact artifact bytes |
| --- | --- | --- |
| `canvas-schema` | `convax.canvas-protocol-schema/2` | complete Canvas annex UTF-8 bytes including final LF |
| `collaboration-kernel` | `convax.collaboration-kernel-protocol-schema/2` | this file's UTF-8 prefix defined below |
| `control-plane` | `convax.control-plane-protocol-schema/2` | complete control-plane annex UTF-8 bytes including final LF |
| `project-persistence` | `convax.project-persistence-protocol-schema/2` | complete Project appendix UTF-8 bytes including final LF |

Each ref has the exact kernel-owned shape:

```ts
interface ProtocolSchemaArtifactRefV2 {
  name: string
  format: string
  artifactDigest: DigestV2
}
```

For Canvas, control-plane and Project, `artifactDigest` is:

```text
SHA-256("convax.protocol-schema-artifact/2\0" || exact complete file bytes)
```

Those files MUST NOT embed their own whole-file/artifact digest or a literal bundle
`coreDigest`; they refer symbolically to `ProtocolSchemaBundleV2.coreDigest`.

For this kernel file, artifact bytes start at byte zero and end at the LF immediately
before the unique sentinel comment. Its ASCII bytes are the concatenation:

```text
"<!-- BEGIN " || "PROTOCOL_SCHEMA_BUNDLE_V2_INSTANCE -->"
```

The sentinel and everything after it are excluded from the kernel artifact. The
kernel artifact digest, exact artifact manifest, bundle core and its digest are
therefore publishable after the normative kernel prefix without hashing themselves.
The complete kernel whole-file SHA-256 is detached review identity only and MUST NOT
enter the portable bundle. This is the only artifact-span exception.

The exact manifest is the following closed array value, not another extensible DTO:

```ts
type ProtocolSchemaArtifactManifestV2 = readonly [
  ProtocolSchemaArtifactRefV2 & { name: "canvas-schema"; format: "convax.canvas-protocol-schema/2" },
  ProtocolSchemaArtifactRefV2 & { name: "collaboration-kernel"; format: "convax.collaboration-kernel-protocol-schema/2" },
  ProtocolSchemaArtifactRefV2 & { name: "control-plane"; format: "convax.control-plane-protocol-schema/2" },
  ProtocolSchemaArtifactRefV2 & { name: "project-persistence"; format: "convax.project-persistence-protocol-schema/2" }
]

interface ProtocolTypeNamespaceRefV2 {
  namespace:
    | "canvas-schema" | "collaboration-kernel" | "control-plane"
    | "global-uri" | "project-persistence"
  imports: readonly (
    | "canvas-schema" | "collaboration-kernel" | "control-plane"
    | "global-uri" | "project-persistence"
  )[]
}

type ProtocolTypeNamespaceManifestV2 = readonly [
  { namespace: "canvas-schema"; imports: readonly ["collaboration-kernel", "control-plane"] },
  { namespace: "collaboration-kernel"; imports: readonly ["global-uri"] },
  { namespace: "control-plane"; imports: readonly ["collaboration-kernel", "global-uri", "project-persistence"] },
  { namespace: "global-uri"; imports: readonly [] },
  { namespace: "project-persistence"; imports: readonly ["collaboration-kernel", "control-plane", "global-uri"] }
]

interface ProtocolSchemaBundleCoreV2 {
  format: "convax.protocol-schema-bundle-core/2"
  protocolMajor: "2"
  artifacts: ProtocolSchemaArtifactManifestV2
  typeNamespaces: ProtocolTypeNamespaceManifestV2
  domainRegistry: readonly string[]
  yjsWireCodec: YjsWireCodecV2
  uriProtocolDigest: DigestV2
  limitsDigest: DigestV2
  channelContractDigest: DigestV2
}

interface ProtocolSchemaBundleV2 {
  format: "convax.protocol-schema-bundle/2"
  core: ProtocolSchemaBundleCoreV2
  coreDigest: DigestV2
  protocolDigest: DigestV2
}
```

The namespace tuple is strict UTF-8 `namespace` order. Its imports are strict UTF-8
sorted and duplicate-free; they declare portable schema references, including the
independently versioned global URI contract, not additional runtime package
dependency edges. `uriProtocolDigest` is the exact detached global URI protocol
whole-file digest. `ProtocolSchemaBundleCoreV2.artifacts` is
byte-identical to the artifact tuple. Its `domainRegistry` is the complete strict
UTF-8 sorted, duplicate-free union; `limitsDigest` and
`channelContractDigest` are the exact control-owned constant-object digests. The
bundle `coreDigest` is:

```text
SHA-256("convax.protocol-schema-bundle-core/2\0" || JCS(core))
```

The bundle wrapper repeats that core byte-for-byte and sets both `coreDigest` and
`protocolDigest` to that exact digest. Unknown fields, another artifact/namespace
order, an unregistered domain, an alternate Yjs codec or unequal digests reject.
Documentation source-set SHA, annex whole-file SHA and artifact digest are distinct
identities and never substitute for it.

## 5. Exact Yjs wire codec

The only v2 Yjs implementation/wire profile is:

```ts
interface YjsWireCodecV2 {
  format: "convax.yjs-wire-codec/2"
  package: "yjs"
  version: "13.6.31"
  packageIntegrity: "sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw=="
  stateVectorCodec: "Y.encodeStateVector"
  updateCodec: "Y.encodeStateAsUpdate"
  applyCodec: "Y.applyUpdate"
  updateVersion: "v1"
}
```

No peer negotiates update v2, alternative Yjs version, compression or a custom
struct codec under collaboration protocol major 2.

The `StateVectorV2` bytes for a document are exactly a copy-owned result of
`Y.encodeStateVector(doc)`, using update-v1. A state vector is 1..65,536 bytes
inclusive. Zero bytes, 65,537 bytes, trailing bytes or another byte representation
of the same logical clocks reject. The operation delta is exactly
`Y.encodeStateAsUpdate(candidateDoc, baseStateVector)`. Apply uses
`Y.applyUpdate(targetDoc, update, nonportableOrigin)`. The origin is process-local
metadata and never enters a frame or digest.

State-vector digest:

```text
SHA-256("convax.state-vector/2\0" || exact state-vector bytes)
```

Update digest:

```text
SHA-256("convax.yjs-update/2\0" || exact update bytes)
```

An incoming base state vector is first bounded by the wire cap. If its exact
reconstructed base is unavailable, the frame remains bounded `dependency-pending`
with reason `exact-base-unavailable` and the missing dependency is requested; lack
of a base is not evidence that bytes are invalid. Once that base exists, the
received bytes MUST be byte-equal to `Y.encodeStateVector(exactReconstructedBase)`.
An incoming delta is applied to an isolated clone of that base and then re-encoded
from the same base state vector; the re-encoded bytes MUST equal the received bytes.
The incoming post state vector is recomputed after isolated apply, must stay within
the cap and must match the signed post digest. A semantically equivalent but
byte-different vector or update is not the signed value.

For a local candidate, the exact base state vector is encoded and checked before
clone. The exact post state vector is encoded and checked after owner application
but before construction, signature, object write, journal append or head commit.
An over-cap local base or post discards only the candidate with
`state-vector-limit`; the accepted state remains readable and exportable but cannot
accept another mutation until an explicit Project-owned reset creates a new epoch.
There is no implicit sharding, truncation or vector compaction fallback. With at
most 4,096 retained revoked replicas plus 512 active replicas, the worst closed
entry count is 4,608; the v2 bound is conservatively
`2 + 4,608 * (5 + 8) = 59,906 < 65,536` bytes.

### 5.1 Stable replica-derived Yjs client id

The Yjs client id for a portable operation is exactly the nonzero uint32 decoded
from its signer authority's `ReplicaIdV2`. The Project-epoch control allocator's
exact service-signed reservation receipt, immutable membership snapshot and actor
credential MUST bind the same Project epoch, member, replica id and public key.
Reservation and credential verification are control-owned; the kernel neither
allocates nor probes ids and does not copy the control DTO.

Every struct authored by a candidate update MUST use only that decoded client id.
The same replica uses it in every document scope and after actor-sequence rotation;
replacement authority uses the newly reserved `ReplicaIdV2`. A delete set may name
existing structs from other clients, but cannot author their struct clocks. An
update with a newly authored struct under another client id rejects before durable
admission. Mapping is pure decode, so pruning a first operation cannot erase or
change it; the exact reservation receipt/credential dependencies remain retained
and retrievable by digest.

Clone procedure is exact: create an empty Y.Doc, apply the exact canonical full-base
update, assign the decoded replica client id before the owner transaction, apply one
intent transaction, encode the delta from the byte-equal base state vector, and
destroy the candidate after success/failure. The replica document's process-local
default client id never authors portable operation structs. Arrival order, machine
time, hashing, random fallback and local collision probes never select a client id.

## 6. Causal heads, frontiers and actor chains

```ts
interface CausalHeadRefV2 {
  format: "convax.causal-head-ref/2"
  actorId: ActorIdV2
  actorSequence: Uint64V2
  frameDigest: DigestV2
  lamport: Uint64V2
}

interface CausalFrontierV2 {
  format: "convax.causal-frontier/2"
  heads: readonly CausalHeadRefV2[]
}

interface ReplicaActorHeadSetV2 {
  format: "convax.replica-actor-head-set/2"
  scope: DocumentScopeV2
  heads: readonly CausalHeadRefV2[]
}
```

Heads sort strictly by decoded actorId bytes, are duplicate-free and number at most
256. `actorSequence` starts at `"1"`; first predecessor is null. A successor is
exact +1 and names the prior frame digest from the same actor/scope. Sequence zero,
gap, rollback and same sequence/different digest are invalid; the last is
equivocation.

Frontier heads form a maximal antichain. `F <= G` iff every head in F occurs in the
verified causal closure of G. `Max(S)` removes every dominated head after complete
closure validation, then sorts by actorId. It never trusts declared parent order.
Frontier digest is the `convax.causal-frontier/2` structured digest. Actor-head-set
digest uses `convax.replica-actor-head-set/2`.

For a frame:

```text
lamport = 1 + max(baseFrontier[*].lamport), max(empty)=0
```

Overflow of the document-wide Lamport enters the Project-owned shard reset. Actor
sequence exhaustion rotates actor identity and does not reset a shard.

## 7. Closed causal context and dependency refs

```ts
type CausalDependencyKindV2 =
  | "membership-snapshot"
  | "replica-actor-credential"
  | "replica-edit-authorization"
  | "authorization-mutation"
  | "cutoff-coverage-root"
  | "checkpoint-content-certificate"
  | "project-index-proof"
  | "project-resource-proof"
  | "plugin-validation-artifact"
  | "generation-external-fact"
  | "reset-authorization"

interface CausalDependencyRefV2 {
  kind: CausalDependencyKindV2
  digest: DigestV2
}

interface CausalSignerAuthorityV2 {
  memberId: MemberIdV2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  memberAuthorizationEpoch: Id128V2
  replicaAuthorizationEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  replicaActorCredentialCoreDigest: DigestV2
  replicaEditAuthorizationCoreDigest: DigestV2
}

interface CausalContextV2 {
  format: "convax.causal-context/2"
  scope: DocumentScopeV2
  baseFrontier: CausalFrontierV2
  baseFrontierDigest: DigestV2
  baseStateVectorDigest: DigestV2
  baseCanonicalStateDigest: DigestV2
  signerAuthority: CausalSignerAuthorityV2
  dependencies: readonly CausalDependencyRefV2[]
  validationArtifactSetDigest: DigestV2
}
```

Dependencies sort by `(kind UTF-8 bytes, decoded digest bytes)`, are duplicate-free
and number at most 256. The mandatory actor credential, edit authorization and
membership snapshot appear both in the signer authority and as exact dependency
refs. Duplicated fields MUST be byte-equal. Owner resource/Plugin/generation/reset
refs are included exactly when the closed owner intent/validator requires them;
missing and extra refs both reject.

`baseFrontierDigest`, state-vector digest and canonical-state digest MUST recompute
from the exact reconstructed base. The context digest is the
`convax.causal-context/2` structured digest. The dependency set digest, when used by
checkpoint/inventory records, is the `convax.causal-dependency-set/2` digest of the
exact sorted dependency array.

## 8. Generic typed-intent and actual-write evidence sections

The typed-intent payload section is exact restricted-JCS bytes for one owner-defined
closed object whose top-level `format` is `convax.typed-intent/2`. The kernel treats
its owner body as opaque canonical data but requires the owner validator selected by
`scope.docKind` and `ownerSchemaDigest` to decode it completely. Typed-intent digest
is the `convax.typed-intent/2` raw-byte digest over the exact section bytes. Parsing
and re-encoding MUST reproduce the same bytes.

The evidence section has one shared closed shape:

```ts
type DocumentOwnerKindV2 = "project-index" | "canvas"

interface ActualWriteV2 {
  entityKind: string // owner-closed ASCII token, 1..64 bytes
  entityId: string   // owner-closed identity/key, 1..256 UTF-8 bytes
  field: string      // owner-closed logical field/path token, 1..256 UTF-8 bytes
  valueDigest: DigestV2
}

interface ActualWriteEvidenceV2 {
  format: "convax.actual-write-evidence/2"
  scope: DocumentScopeV2
  owner: DocumentOwnerKindV2
  ownerSchemaDigest: DigestV2
  intentDigest: DigestV2
  changedPaths: readonly string[]
  writes: readonly ActualWriteV2[]
}
```

`owner` equals `scope.docKind`. Paths and writes are strict UTF-8 sorted,
duplicate-free sets. A path is 1..512 UTF-8 bytes. The owner artifact closes every
allowed `entityKind`, id/field codec, path family and expected value digest; the
kernel does not create a cross-domain enum or infer semantics from strings.

Evidence MUST equal the owner's pure reducer-derived actual semantic write set,
including operation/history auxiliary writes required by that owner. Missing,
extra, duplicate, unchanged padding or hidden Yjs writes reject. The evidence digest
is the `convax.actual-write-evidence/2` structured digest. An owner may derive an
internal evidence object, whose digest uses
`convax.owner-actual-write-evidence/2`, but the portable section above is the only
frame evidence wrapper.

Validation artifacts use:

```ts
interface ValidationArtifactRefV2 {
  owner: "kernel" | "project-index" | "canvas" | "control-plane" | "plugin"
  format: string
  artifactDigest: DigestV2
}

interface ValidationArtifactSetV2 {
  format: "convax.validation-artifact-set/2"
  artifacts: readonly ValidationArtifactRefV2[]
}
```

Refs sort by `(owner, format, decoded digest)`, are duplicate-free and number at
most 64. The set MUST contain the exact four protocol owner artifacts and every
declarative Plugin validator required by the typed intent/base state. The set digest
uses `convax.validation-artifact-set/2`.

## 9. Exact causal-edit core, header and binary frame

```ts
interface CausalEditCoreV2 {
  format: "convax.causal-edit-core/2"
  scope: DocumentScopeV2
  actorId: ActorIdV2
  actorSequence: Uint64V2
  predecessorFrameDigest: DigestV2 | null
  operationId: Id128V2
  lamport: Uint64V2
  intentKind: string
  intentDigest: DigestV2
  causalContextDigest: DigestV2
  baseFrontierDigest: DigestV2
  baseStateVectorDigest: DigestV2
  baseCanonicalStateDigest: DigestV2
  yjsUpdateDigest: DigestV2
  postStateVectorDigest: DigestV2
  postCanonicalStateDigest: DigestV2
  actualWriteEvidenceDigest: DigestV2
  typedIntentJcsByteLength: Uint64V2
  causalContextJcsByteLength: Uint64V2
  baseStateVectorByteLength: Uint64V2
  yjsUpdateByteLength: Uint64V2
  actualWriteEvidenceJcsByteLength: Uint64V2
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
  canonicalizerDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  membershipSnapshotDigest: DigestV2
  replicaActorCredentialCoreDigest: DigestV2
  replicaEditAuthorizationCoreDigest: DigestV2
}

interface CausalEditFrameHeaderV2 {
  format: "convax.causal-edit-frame/2"
  core: CausalEditCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}
```

`intentKind` is the exact top-level typed-intent discriminator, NFC ASCII, 1..128
bytes, and must be a member of the owner artifact's closed union. Every duplicated
scope/actor/authority/digest/length field across core, context and payload recomputes
and is byte-equal.

`coreDigest` is the `convax.causal-edit-core/2` structured digest. The long-lived
replica actor signs:

```text
SHA-256("convax.causal-edit-signature/2\0" || decoded coreDigest)
```

The signed digest is verified by the exact `ReplicaActorCredentialV2` dependency;
session keys never sign edits. The edit authorization dependency must bind the same
Project/member/replica/actor, authorization epochs, owner schema,
`validationArtifactSetDigest` and `protocolDigest`.

### 9.1 Causal payload

The payload is exactly five sections in this order:

```text
u32be typedIntentLength           || exact typed-intent JCS
u32be causalContextLength         || exact CausalContextV2 JCS
u32be baseStateVectorLength       || exact Yjs state-vector bytes
u32be yjsUpdateLength             || exact Yjs update-v1 bytes
u32be actualWriteEvidenceLength   || exact ActualWriteEvidenceV2 JCS
```

Each u32 length equals both the following section byte count and the corresponding
decimal length field in the core. No padding, compression, optional sixth section or
trailing byte exists.

### 9.2 `CVXCOLL2` causal-edit envelope

```text
offset 0    8 bytes  ASCII "CVXCOLL2"
offset 8    2 bytes  u16be protocol major, exactly 2
offset 10   1 byte   kind code, exactly 1 for causal edit
offset 11   1 byte   flags, exactly 0
offset 12   4 bytes  u32be header JCS length
offset 16   8 bytes  u64be payload length
offset 24  32 bytes  ordinary SHA-256 of exact header JCS bytes
offset 56  32 bytes  ordinary SHA-256 of exact payload bytes
offset 88   N bytes  exact CausalEditFrameHeaderV2 JCS
             M bytes  exact five-section payload
```

Major/kind/flags, integer overflow, cap excess, short read, hash mismatch,
noncanonical header, core/signature mismatch or trailing bytes reject before Yjs or
owner parsing. Frame digest is:

```text
SHA-256("convax.causal-edit-frame-digest/2\0" || exact complete envelope bytes)
```

The frame digest is not stored inside the header. One
`{scope,actorId,actorSequence}` and one `{scope,actorId,operationId}` map to exactly
one core/frame digest. Same identity with different bytes is equivocation, never an
arrival-order or idempotency winner.

## 10. Owner verifier and canonical-state ports

### 10.1 Closed descriptor and scalar constraints

The kernel owns this closed shape beside `DocumentOwnerKindV2`:

```ts
type OwnerCanonicalStateCodecV2 = "restricted-jcs-utf8"

interface OwnerCanonicalizerDescriptorV2 {
  format: "convax.owner-canonicalizer-descriptor/2"
  owner: DocumentOwnerKindV2
  ownerSchemaDigest: DigestV2
  canonicalStateFormat: string
  canonicalStateCodec: OwnerCanonicalStateCodecV2
  exactBytePolicy: "parse-reencode-byte-equal"
  unknownStatePolicy: "reject"
}
```

The shape is exact: every listed field is required and every unknown field rejects.
`canonicalStateFormat` is NFC ASCII, 1..128 bytes, matches
`^convax\.[a-z0-9][a-z0-9.-]*/2$`, and is closed to one literal by the selected
owner artifact. It is not a dynamic registry key. `ownerSchemaDigest` is the exact
domain-separated artifact digest selected from the four-owner bundle.

The descriptor commits the owner, schema, state format, byte codec and fail-closed
policy. It deliberately does not contain `protocolDigest`: the frame already binds
that independently, and adding it would rotate a canonicalizer when an unrelated
transport or control-plane field changes. It also does not contain Yjs package
internals; canonical state is a logical owner projection. This is the only
canonicalizer descriptor shape in v2. An owner artifact may close a detailed
canonical-state extraction algorithm, but it MUST NOT define another descriptor
type, descriptor digest or owner-private canonicalizer domain. The selected
`ownerSchemaDigest` already binds those owner-specific algorithm bytes.

#### 10.1.1 Exact digest domain and preimage

The kernel-owned domain is:

```text
convax.owner-canonicalizer-descriptor/2
```

The only legal digest is:

```text
canonicalizerDigest = SHA-256(
  UTF8("convax.owner-canonicalizer-descriptor/2") || 0x00 ||
  JCS(exact OwnerCanonicalizerDescriptorV2)
)
```

No raw-byte hash, JSON stringify, implementation name, function source, package
version, abbreviated descriptor, alternate domain or caller-supplied digest is
legal. The descriptor contains no digest of itself, so it creates no hash cycle.
An owner artifact defines a constructor parameterized by its externally computed
artifact digest; it MUST NOT embed a literal digest of its own whole file.

### 10.2 Owner protocol port and binding

The kernel consumes one owner selected by scope; it never dynamically registers an
ambient schema:

```ts
interface OwnerIntentValidationContextV2 {
  scope: DocumentScopeV2
  actorId: ActorIdV2
  actorSequence: Uint64V2
  operationId: Id128V2
  lamport: Uint64V2
  intentDigest: DigestV2
  baseFrontierDigest: DigestV2
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
}

interface DocumentOwnerProtocolPortV2 {
  readonly owner: DocumentOwnerKindV2
  readonly schemaDigest: DigestV2
  readonly canonicalizerDescriptor: OwnerCanonicalizerDescriptorV2
  readonly canonicalizerDigest: DigestV2
  decodeIntent(exactJcs: Uint8Array): unknown | "rejected"
  validateBase(document: Y.Doc): OwnerValidatedStateV2 | "pending" | "rejected"
  applyIntent(
    candidate: Y.Doc,
    context: OwnerIntentValidationContextV2,
    intent: unknown,
    externalFacts: OwnerExternalFactPortV2,
  ): OwnerApplyResultV2 | "pending" | "rejected"
  validatePost(
    base: OwnerValidatedStateV2,
    candidate: Y.Doc,
    result: OwnerApplyResultV2,
  ): OwnerValidatedStateV2 | "pending" | "rejected"
  canonicalStateBytes(document: Y.Doc): Uint8Array | "rejected"
  deriveActualWriteEvidence(result: OwnerApplyResultV2): ActualWriteEvidenceV2
}
```

`unknown` above is a headless call boundary only: the owner returns one value from
its exact generated validator and never exposes an unvalidated object. The opaque
`OwnerValidatedStateV2`, `OwnerApplyResultV2` and external-fact permits are
nonportable process values. They cannot enter structured clone, Y.Doc, frame,
journal or digest.

Before base validation, candidate construction, signature verification, checkpoint
validation or ACK, the kernel MUST require:

```text
port.canonicalizerDescriptor.owner == port.owner
port.canonicalizerDescriptor.ownerSchemaDigest == port.schemaDigest
digest(port.canonicalizerDescriptor) == port.canonicalizerDigest
frame.core.ownerSchemaDigest == port.schemaDigest
frame.core.canonicalizerDigest == port.canonicalizerDigest
selectedArtifact.artifactDigest == port.schemaDigest
```

`canonicalStateBytes(document)` returns a fresh, immutable byte copy. The bytes
MUST parse as exact restricted JCS, the top-level `format` MUST equal the descriptor
literal, and parsing then re-encoding MUST reproduce every byte. An owner decoder
rejects an unknown root, slot, field, union tag, shared type, noncanonical key,
duplicate or illegal value before the kernel hashes the bytes.

The kernel canonical-state digest remains the sole portable state digest:

```text
canonicalStateDigest = SHA-256(
  UTF8("convax.canonical-state/2") || 0x00 ||
  decoded-32-byte(ownerSchemaDigest) || 0x00 ||
  exact canonicalStateBytes
)
```

The compact domain-plus-NUL spelling is byte-identical to the expanded form above.
`ownerSchemaDigest` is decoded 32-byte
hex, not its 64-byte spelling. `canonicalizerDigest` is bound separately in
`CausalEditCoreV2`; it is not folded into this digest and MUST NOT be omitted from
the frame.

Canvas/Project artifacts define exact canonical bytes. The kernel never hashes
JavaScript object enumeration, Yjs internal structs or React projection.

## 11. Candidate creation and local final-frame commit

Each open shard has one Main-owned `replicaDoc` reconstructed from the current
durable head. One per-shard commit mutex serializes local candidate construction;
this is local I/O exclusion, not a team edit order.

Local mutation order is exact:

1. lookup `{actorId,operationId}`; exact accepted duplicate returns its original
   frame/result and conflicting identity quarantines;
2. snapshot the latest replica frontier/state vector/canonical hash, enforce the
   local base-vector cap and validate the current actor/edit authority, exact
   replica reservation dependency and owner artifacts;
3. allocate next actor sequence, operation-derived identities, Lamport and stamp
   ordinals, then decode the already reserved `ReplicaIdV2` as the sole Yjs client
   id;
4. clone an isolated candidate from exact base, decode/apply exactly one typed
   intent in one owner transaction and derive evidence;
5. validate closed schema, owner invariants, exact changed-path/write evidence,
   authored client id, capped post state vector/canonical hash and re-encoded update
   bytes;
6. construct one final core/header/envelope, sign once with the long-lived actor key
   and compute frame digest;
7. invoke the persistence barrier in section 12 for exact bytes;
8. only after durable head acceptance, apply the exact delta to in-memory
   `replicaDoc`, move session undo selection, publish projection invalidation and
   return `saved-locally`.

Candidate rejection, pending dependency, cancellation before head or durability
failure has no authoritative document effect. Candidate state never replaces
`replicaDoc`. Cancellation after the head cannot roll back; it only suppresses stale
view effects.

## 12. Generic persistence, journal and recovery ports

`@convax/collaboration` defines ordering and evidence; `@convax/project/node` alone
implements filesystem paths, create-new, fsync, directory barriers, atomic replace,
writer locks and reopen scans.

```ts
interface FrameObjectRefV2 {
  scope: DocumentScopeV2
  frameDigest: DigestV2
  actorId: ActorIdV2
  actorSequence: Uint64V2
  operationId: Id128V2
}

interface CollaborationPersistencePortV2 {
  loadAcceptedHead(scope: DocumentScopeV2): Promise<AcceptedHeadViewV2>
  putImmutableFrame(ref: FrameObjectRefV2, bytes: Uint8Array): Promise<void>
  putReplicationOutboxRef(ref: FrameObjectRefV2): Promise<void>
  appendAcceptedJournal(ref: FrameObjectRefV2): Promise<JournalAppendReceiptV2>
  compareAndCommitHead(
    expectedHeadDigest: DigestV2,
    journal: JournalAppendReceiptV2,
    resultingFrontierDigest: DigestV2,
  ): Promise<HeadCommitReceiptV2 | "stale-head">
  isReachableFromAcceptedHead(ref: FrameObjectRefV2): Promise<boolean>
  lookupOperation(actorId: ActorIdV2, operationId: Id128V2): Promise<OperationLookupV2>
  scanDurableReferences(frameDigest: DigestV2): Promise<ReferenceScanResultV2>
  quarantineExactObject(frameDigest: DigestV2, reason: KernelQuarantineReasonV2): Promise<void>
}
```

Port DTOs are bounded nonportable process contracts. Project's exact local record
schemas and native crash matrix remain in its owner appendix. A conforming adapter
must provide these observable barriers:

- immutable frame object durable before an outbox ref;
- outbox ref durable before accepted journal reference;
- journal durable before compare-and-commit of the sole accepted head;
- transport can send only refs reachable from the validated accepted head;
- object-only bytes never transmit; ref/journal below head completes the exact
  already signed frame or enters read-only quarantine;
- recovery never reruns the intent, reallocates identity/sequence or signs
  replacement bytes;
- object collection requires a complete durable-reference proof; ambiguity retains
  bytes;
- exact `{actorId,operationId}` response-loss lookup returns the original accepted
  frame/result or the same-frame recovery state.

There is no generic filesystem implementation, ambient journal, mtime winner or
Desktop-local writer.

## 13. Incoming-frame validation and replica application

Incoming exact frame bytes pass this order before projection or durable ACK:

1. envelope magic/major/kind/flags/length/caps and ordinary hashes;
2. exact header JCS, bundle protocol digest, owner schema/canonicalizer/artifact set;
3. actor credential, its exact replica-id reservation receipt, edit authorization,
   membership/cutoff and signature; decode the bound replica id as the only client
   id permitted to author structs in this update;
4. actor sequence/predecessor/operation uniqueness and equivocation checks;
5. parse five sections; verify every core/context/section digest and duplicate field;
6. resolve complete dependencies and reconstruct the exact authored base from a
   content-certified checkpoint plus exact suffix DAG;
7. compare base frontier, exact canonical state-vector bytes and owner
   canonical-state bytes;
8. owner-decode/rerun the intent and guards on an isolated candidate;
9. require byte-identical canonical Yjs delta, exact owner evidence, capped post
   state vector/canonical hash and merged closed-schema/I-confluence validation;
10. persist immutable object, journal and accepted head through the same barrier;
11. apply exact delta to `replicaDoc`, publish projection and only then permit a
    long-lived replica durable ACK.

Missing predecessor/base/proof/artifact remains bounded `dependency-pending` and is
not projected or ACKed. Invalid bytes reject without mutating replicaDoc. Duplicate
exact frame digest is idempotent. Arrival on a newer current snapshot never
substitutes for exact-base reconstruction.

## 14. Session undo coordinator

```ts
interface SessionUndoCoordinatorV2 {
  recordDurableRoot(rootOperationId: Id128V2): void
  peekUndo(): { rootOperationId: Id128V2; cursorToken: Id128V2 } | null
  peekRedo(): { rootOperationId: Id128V2; cursorToken: Id128V2 } | null
  commitUndo(cursorToken: Id128V2, durableInverseOperationId: Id128V2): void
  commitRedo(cursorToken: Id128V2, durableForwardOperationId: Id128V2): void
  clear(reason: "restart" | "rebuild" | "scope-change" | "unmount" |
    "post-commit-cursor-failure"): void
}
```

Only a durable local owner-declared root enters undo and clears redo. Remote,
bootstrap and recovery frames do not modify the stacks. Peek does not move; the
owner materializes a new exact semantic inverse/forward intent against current
`replicaDoc`; cursor moves only after that new frame crosses durable head. Failure
before head leaves both stacks. Domain success with cursor failure keeps domain
state, clears the coordinator and reports `history-reset-after-commit`. There is no
cross-restart undo. Raw Y.UndoManager updates never enter candidate, replica,
journal or wire.

## 15. Exact kernel caps and failure contract

All limits are checked before large allocation, JSON/Yjs decode, candidate clone,
signature verification that allocates retained state, or persistence mutation.

| Item | Limit |
| --- | ---: |
| `CVXCOLL2` causal header JCS | 64 KiB |
| complete typed-intent JCS | 512 KiB |
| causal-context JCS | 64 KiB |
| base or post state vector | 1..64 KiB each |
| Yjs update-v1 delta | 1 MiB |
| actual-write-evidence JCS | 256 KiB |
| complete causal envelope | 2 MiB |
| causal frontier heads | 256 |
| causal dependency refs | 256 |
| changed paths / actual writes | 2,048 / 2,048 |
| one changed path | 512 UTF-8 bytes |
| validation artifact refs | 64 |
| pending inbox/document | 4,096 frames and 256 MiB |
| pending inbox/remote actor | 512 frames and 32 MiB |
| local outbox/document | 4,096 frames and 512 MiB |
| retained durable ACKs/frame | 32 |
| quarantine/Project | 1,024 objects and 128 MiB |
| local recovery branch | 1 GiB |

All section maxima still obey the 2 MiB encoded-whole limit and need not be jointly
attainable. Owner caps may be smaller and never waive these outer limits.

| Failure | Required behavior |
| --- | --- |
| `protocol-schema-bundle-unavailable` | missing/mismatched artifact or digest; decode/sign nothing |
| `unsupported-yjs-codec` | preserve bytes read-only; no alternate update decoder |
| `state-vector-limit` | local candidate is discarded before sign/write/head and accepted state remains readable/exportable; over-cap incoming bytes are invalid |
| `dependency-pending` | retain bounded exact bytes/ref; request dependency; no projection/ACK |
| `exact-base-unavailable` | read-only/pending; no newer-snapshot validation |
| `stale-local-head` | discard candidate and retry business intent only if caller still authorizes; never reuse signed bytes for another base |
| `equivocation-quarantine` | freeze actor fork/dependants and retain both proofs |
| `outbox-backpressure` | stop new mutation; retain/export accepted work |
| `history-reset-after-commit` | domain remains committed; clear transient undo/redo |
| `read-only-recovery-required` | preserve all durable evidence; transmit/project no below-head frame |

## 16. Mandatory conformance tests

### 16.1 Cross-runtime byte goldens

Bun, Chromium and isolated attester implementations given only the approved owner
artifacts MUST produce byte-identical:

1. every primitive, scope digest, portable stamp and malformed-boundary rejection,
   including the exact scalar and Ed25519 corpus below;
2. exact four-ref artifact manifest, complete domain registry, bundle core JCS and
   non-placeholder `protocolDigest`;
3. direct replica-id-to-Yjs-client-id mapping, state vector/update bytes and digests
   under Yjs 13.6.31;
4. causal heads/frontier `Max`, context/dependency order and evidence JCS;
5. causal core/header/signature preimage, five-section payload, `CVXCOLL2` envelope
   and complete frame digest;
6. first ProjectIndex and `canvas.nodes.create/2` operation frames;
7. exact `OwnerCanonicalizerDescriptorV2` JCS/digest, with field reordering stable
   under JCS and every owner/schema/format/codec/policy change producing a distinct
   digest while unknown or missing fields reject;
8. owner canonical-state bytes/digest for logically identical documents built from
   different Yjs client, update and arrival histories; parse/re-encode is byte-equal
   and mutating one returned byte copy cannot alter a later call.

Any repository-code fallback, artifact-name choice, alternate Yjs version, unknown
field acceptance or byte difference falsifies closure.

Exact scalar and cryptographic goldens are:

- raw bytes `000102030405060708090a0b0c0d0e0f` encode as both the Id128 wire
  value `AAECAwQFBgcICQoLDA0ODw` and Peer value
  `peer_aaaqeayeaudaocajbifqydiob4`; field context alone assigns the nominal
  Member or Session brand;
- `replica_00010203` decodes to raw big-endian bytes `00010203` and uint32/Yjs
  client id `66051`; `replica_00000000`, uppercase, short, long and another prefix
  reject;
- accepted raw Ed25519 key hex
  `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
  encodes as `11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo`;
- small-order identity key
  `AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, noncanonical `y=p` key
  `7f_______________________________________38`, and any signature whose `S` is
  `edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010`
  reject;
- the mandatory mixed-order negative corpus uses message/digest hex
  `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`,
  public-key hex
  `98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819`,
  and signature hex
  `e6ff0e4955925b2100e8ceebbd4ffe93e6fdfc71c226b33409a570d916254f72506ba7f38360d99680bdd68d13fa7116c21961d4339692254d63ee177bfcd70a`.
  Its canonical non-small-order `A` and `R` satisfy only the cofactored equation,
  not the required cofactorless equation, so every runtime rejects it;
- an empty Y.Doc state vector is the one byte `00`; its
  `convax.state-vector/2` digest is
  `87e7210e576ca5c626cdd6c1b710f2a2dc8ebe2ae09d6e4dc32d74e98115d7ca`.

### 16.2 Model and permutation tests

- Generate random valid 2/3/9-actor DAGs, every delivery permutation and duplicate;
  frontier, exact base, replica canonical hash and actor heads must converge.
- Deliver a valid frame on a newer replica state; validation reconstructs authored
  base rather than rerunning guards on current state.
- Double-sign same actor sequence/operation with different frames; both arrival
  orders quarantine the same fork and dependent descendants.
- Exercise every exact/over-one section, dependency, frontier, write and encoded
  envelope cap before allocation.
- Exercise state vectors of 0, 65,536 and 65,537 bytes; missing exact base then
  dependency arrival/acceptance; trailing and logically equivalent byte-different
  encodings; and local exact-cap/plus-one base and post vectors before any signature
  or durable write.
- Race replica reservations from the same Project-epoch high-water, force two
  allocator transactions to contend on the same next-id candidate, prune the first
  authored frame, rotate actor identity and replace replica authority; only exact
  control receipts may select unique Yjs client ids and no pruning or arrival order
  may remap them.
- Give Project/Canvas owner validators hidden Yjs writes, unknown roots, wrong
  evidence and byte-equivalent re-encodings; every runtime rejects identically.

### 16.3 Crash and port-contract tests

Fault injection stops after object create/fsync, outbox ref, journal append, head
temp/fsync/rename/directory-fsync, memory apply and response. It proves:

- no frame below accepted head transmits or projects;
- reopen completes the exact signed frame or quarantines read-only;
- no intent rerun, new operation/sequence/client id or replacement signature occurs;
- head accepted/memory absent replays the exact frame;
- `{actorId,operationId}` returns the same original frame/result after response loss;
- durable ACK is impossible before object/journal/head acceptance.

### 16.4 Clean package gate

`@convax/collaboration` must build, type-check, test, prepack and type-check every
public entry from a clean external consumer using only declared `yjs@13.6.31`.
Boundary scans reject imports of Project, Canvas, Desktop, Electron, React,
filesystem, PeerJS or service implementation.

## 17. Red-team decision before bundle instance

### Strongest three objections

1. Pinning one exact Yjs version makes protocol upgrades explicit major/minor
   governance work; a security fix cannot silently change wire bytes.
2. Exact-base reconstruction and byte-identical delta replay retain substantial
   checkpoint/history material and make hostile-frame validation expensive.
3. A Project-epoch replica id can never be reused because it is also a Yjs client
   id. A compromised member can burn its bounded reservation budget and a team can
   eventually force explicit destructive Project reset; recycling ids would improve
   availability but make retained structs ambiguous.

Flaw types checked are hidden dependency, signature ambiguity, cofactored-verifier
drift, nominal-wire provenance assumptions, client-id collision/order leakage,
permanent-id reuse, codec drift, duplicate authority, crash-state omission and
unbounded input. The design is falsified if two clean runtimes disagree on the
scalar/crypto corpus or bundle/frame bytes, if an authored Yjs struct uses a client
id other than the signer's reserved replica id, if a burned id can be reused inside
one Project epoch, if a below-head frame transmits, or if collaboration must
understand a control owner record rather than verify its public receipt binding.

Historical revision-3 decision on the prior kernel prefix: **SIGN**, score **8.8/10**. Deductions are
the deliberate exact-version/crypto-backend qualification cost, exact-base
storage/CPU cost and bounded permanent-id-burn denial-of-service surface. They are
nonfatal under the v2 contract because backend behavior is corpus-tested, service
loss preserves already authorized offline editing, all exhaustion fails visibly
closed, and no fallback creates an edit sequencer or second document owner. This
historical decision does not sign the changed revision-4 prefix; exact-set approval
follows only after the Phase-B pins are generated.

## 18. Revision 5.1 normative kernel replacement

This section is inside the collaboration-kernel artifact span and is normative
Revision 5.1 authority. It replaces every conflicting Revision 4 statement above.
The bundle instance below the sentinel is generated metadata and remains outside the
kernel artifact span.

### 18.1 Artifact-bound owner runtime closure

The selected owner artifact exports one factory that atomically constructs:

```ts
interface DocumentOwnerRuntimeV2 {
  readonly protocolPort: DocumentOwnerProtocolPortV2
  readonly closurePort: OwnerIntentClosurePortV2
}

type InspectedOwnerIntentV2 =
  | { readonly kind: "ordinary" }
  | {
      readonly kind: "history"
      readonly direction: "undo" | "redo"
      readonly rootOperationId: Id128V2
    }

interface OwnerIntentClosurePortV2 {
  readonly protocolPort: DocumentOwnerProtocolPortV2
  inspectIntent(decodedIntent: unknown): InspectedOwnerIntentV2 | "rejected"
  discoverDependencies(
    base: OwnerValidatedStateV2,
    context: OwnerIntentDependencyContextV2,
    decodedIntent: unknown,
    facts: OwnerExternalFactPortV2,
  ): "verified" | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationPortV2 | null
}
```

The kernel registers the returned runtime as a private live capability. Both ports
must be members of the same selected artifact closure and
`closurePort.protocolPort === runtime.protocolPort` by object identity. Ports cannot
be separately injected, serialized, reconstructed, mixed between artifacts or
paired through self-reported digests. Canvas supplies non-null `history`;
ProjectIndex supplies null.

The ordinary command entry accepts only `inspectIntent(...) == {kind:"ordinary"}`.
A schema-valid history intent submitted through the ordinary API rejects before
external facts, authority, candidate creation or mutation. The public semantic
history API accepts only operation id, direction and optional cancellation signal;
it never accepts a root id, cursor, materialized operations, typed-intent bytes,
Y.Doc, raw update or document-wide version.

Inside the document-exclusive queue, history reads the latest private replica,
peeks the current root, materializes through the selected owner runtime, requires
the inspected direction/root to be byte-identical, recomputes restricted JCS and
digest, discovers exact dependencies, validates an isolated candidate and crosses
the durable head barrier before advancing the session cursor. Recovery replays the
exact signed frame and never rematerializes history.

### 18.2 Exact dependency closure

All dependency references are classified exactly once:

```text
Authority = membership-snapshot | replica-actor-credential |
            replica-edit-authorization | authorization-mutation |
            cutoff-coverage-root
ExactBase  = checkpoint-content-certificate
Owner      = project-index-proof | project-resource-proof |
             plugin-validation-artifact | generation-external-fact |
             reset-authorization
```

For a local ordinary or history operation, the owner discovery-required set,
declared Owner partition, history-materialization-consumed set when present and
owner-apply-consumed set are strict sorted byte-equal. The Authority and ExactBase
resolvers independently enforce the same equality for their partitions. Plugin
dependencies equal exactly the plugin references in the ValidationArtifactSet.
Unknown, missing, extra, duplicate or multiply classified references reject.

Fetchable absence yields `dependency-pending`; local owner/resolver drift yields
`invalid-owner-result`; authority that changes the owner-required set yields
`canonical-authority-conflict`; an incoming closure mismatch yields
`invalid-causal-frame`.

### 18.3 Two-stage incoming verification

The decoder first bounds and parses only the `CVXCOLL2` prelude, authenticated
header and causal core. `verifyHeaderAuthority(prelude)` verifies the three exact
header/core authority digests, scope, actor, reservation, current membership,
credential, edit authorization and signature. It returns a private one-time token
bound by object identity to the exact envelope bytes. The token permits only bounded
five-section parsing and is neither serializable nor commit authority.

After header authorization, the kernel enforces actor-sequence
uniqueness/equivocation, parses all five bounded payload sections, requires context
signer facts to equal the token, then calls
`verifyDeclaredAuthorityDependencies(authenticated, declaredAuthorityRefs)` with
strict missing/extra rejection. Exact-base and Owner closure validation follow.
Bad signature plus malformed payload must invoke the five-section parser, dependency
resolvers and owner runtime zero times.

### 18.4 Signed wrapper object identity

Revision 5.1 registers these four additional domains:

```text
convax.checkpoint-content-certificate/2
convax.prunable-checkpoint-set-certificate/2
convax.replica-causal-floor-ack/2
convax.replica-checkpoint/2
```

For each corresponding signed wrapper:

```text
objectDigest = SHA-256(UTF8(wrapperDomain) || 0x00 || completeCanonicalWrapperJcs)
```

The complete canonical wrapper includes its exact core, recomputed core digest,
signer/key identity and signature. The core digest identifies the signed statement;
the wrapper object digest identifies the immutable portable/native object and every
parent, coverage, ACK and pruning reference.

Same wrapper kind and core digest with byte-distinct valid wrappers is
`signed-wrapper-equivocation`; different cores with one logical subject is
`wrapper-logical-subject-conflict`. Both objects are retained and quarantined; no
arrival-order winner, current value, coverage, ACK or pruning authority exists. The
four logical subjects and all breaking `...ObjectDigest` field renames are exactly
those in Control section 17.1. Old field names fail exact-schema validation.

### 18.5 Durable barriers, recovery and duplicate binding

Local authoring crosses object fsync, authoring-outbox fsync, journal fsync and sole
head CAS/fsync before replica/projection. Remote admission crosses immutable object
fsync, durable pending-inbox ref, complete validation, accepted journal consuming
that exact inbox receipt and sole head CAS/fsync before replica/projection and ACK.
Remote frames never create authoring outboxes; inbox cleanup is post-head idempotent
housekeeping.

Recovery from object-only, inbox-below-head or journal-below-head states continues
the exact retained bytes and never calls owner decoder/reducer/materializer,
external facts, signer or allocator. Duplicate success requires exact request,
object ref, frame bytes/digest, scope, actor, operation id and actor sequence plus
reachability from current accepted head.

Checkpoint and ACK coverage bind complete wrapper object digests, core digests and
logical subjects. A disconnected digest-to-object edge, an equivocated index or a
wrapper not reachable from the accepted head cannot certify durability, coverage or
pruning.

### 18.6 Limits, overflow and frontier admission

Local base and post state vectors of 65,536 bytes pass; 65,537 yields exact
`state-vector-limit` before sign/write. Incoming base/post plus one is invalid. An
already accepted over-cap state remains canonical-readable, projectable and
exportable as a bounded nonportable accepted-state export, but rejects every
current-epoch local/incoming mutation, editable claim and ACK until Project
new-epoch reset. Portable `StateVectorV2` and Peer sync remain capped; a null
projection vector means reset-required and never empty.

Every raw, wire, IPC or port frontier is capped at 256 before closure, reduction or
allocation. Only an already-capped internal current frontier plus operation-bounded
new heads may reduce before its final cap check. Thus 256 plus one dominating new
head may reduce and pass, while a final 257 rejects; any raw 257 rejects even if it
would reduce.

### 18.7 Queue-linearized lifecycle

Lifecycle is `open -> closing -> disposed`. `dispose()` is an idempotent Promise. It
synchronously marks closing, rejects new work, enters the same exclusive queue,
drains in-flight work, clears history/pending state and destroys every Y.Doc. No
projection is emitted after closing. Cancellation before accepted-head CAS means no
commit; after CAS the durable commit is never rolled back, but disposed projection
or undo state is not repopulated. Reopen derives state only from certified durable
checkpoint, admitted frames and the exact local overlay rules.

### 18.8 Compatibility and mandatory conformance

Protocol major remains `2` and the `CVXCOLL2` five-section/Yjs 13.6.31 update-v1
wire remains fixed. Nevertheless all four artifact digests, bundle digest,
five-authority-file set and receipts rotate. Revision 4 and Revision 5.1 fail closed
against each other; old projects can only be preserved and explicitly reset.

Mandatory tests include bad-signature/malformed-payload zero callbacks; exact
dependency missing/extra matrices; same-core and same-logical-subject wrapper
equivocation in both arrival orders; all local/remote crash cuts; duplicate binding;
history latest-replica and recovery-no-rematerialization; state-vector
65,536/65,537 and accepted-overflow read-only behavior; raw/internal frontier
256/257 properties; and dispose races before/after head CAS. Any failure revokes
Revision 5.1 conformance.

## 19. Revision 5.2 normative ABI, ingress and recovery replacement

This section is inside the kernel artifact span and is terminal Revision 5.2
authority. It replaces every conflicting Revision 5.1 generic ABI, ingress,
capability, recovery, limits and registry statement. Revision 5.1 was not signed and
has no fallback or compatibility authority.

### 19.1 Complete generic owner runtime ABI

Only `@convax/collaboration` declares these generic contracts:

```ts
type DocumentOwnerKindV2 = "project-index" | "canvas"

interface OwnerIntentConstructionContextV2 {
  readonly scope: DocumentScopeV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly operationId: Id128V2
  readonly lamport: Uint64V2
  readonly baseFrontierDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
}

interface OwnerIntentDependencyContextV2
  extends OwnerIntentConstructionContextV2 {
  readonly intentDigest: DigestV2
}

type OwnerDependencyKindV2 =
  | "project-index-proof" | "project-resource-proof"
  | "canvas-genesis-proof"
  | "plugin-validation-artifact" | "generation-external-fact"
  | "reset-authorization"

interface OwnerDependencyRefV2 {
  readonly kind: OwnerDependencyKindV2
  readonly digest: DigestV2
}

interface OwnerExternalFactViewV2 {
  readonly ref: OwnerDependencyRefV2
  readonly exactBytes: Uint8Array
}

interface OwnerExternalFactPortV2 {
  readExact(
    ref: OwnerDependencyRefV2,
  ): OwnerExternalFactViewV2 | "pending" | "rejected"
  consumedRefs(): readonly OwnerDependencyRefV2[]
}

interface OwnerBaseCausalFrameViewV2 {
  readonly frameDigest: DigestV2
  readonly exactEnvelopeBytes: Uint8Array
  readonly scope: DocumentScopeV2
  readonly typedIntentExactJcs: Uint8Array
  readonly actualWriteEvidenceExactJcs: Uint8Array
  readonly postFrontierDigest: DigestV2
}

interface OwnerBaseCausalClosurePortV2 {
  readAncestorFrame(
    frameDigest: DigestV2,
  ): OwnerBaseCausalFrameViewV2 | "not-in-base"
  consumedFrameDigests(): readonly DigestV2[]
}

type InspectedOwnerIntentV2 =
  | { readonly kind: "ordinary" }
  | { readonly kind: "history"; readonly direction: "undo" | "redo";
      readonly rootOperationId: Id128V2 }

interface OwnerHistoryMaterializationPortV2 {
  materialize(
    base: OwnerValidatedStateV2,
    context: OwnerIntentConstructionContextV2,
    request: Readonly<{ direction: "undo" | "redo";
      rootOperationId: Id128V2 }>,
    facts: OwnerExternalFactPortV2,
  ): Readonly<{ typedIntent: unknown }> | "pending" | "rejected"
}

interface OwnerIntentClosurePortV2<K extends DocumentOwnerKindV2> {
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>
  inspectIntent(decodedIntent: unknown): InspectedOwnerIntentV2 | "rejected"
  discoverDependencies(
    base: OwnerValidatedStateV2,
    context: OwnerIntentDependencyContextV2,
    decodedIntent: unknown,
    facts: OwnerExternalFactPortV2,
  ): "verified" | "pending" | "rejected"
  discoverBaseReferences(
    base: OwnerValidatedStateV2,
    context: OwnerIntentDependencyContextV2,
    decodedIntent: unknown,
    baseClosure: OwnerBaseCausalClosurePortV2,
  ): "verified" | "rejected"
  readonly history: K extends "canvas"
    ? OwnerHistoryMaterializationPortV2
    : null
}

interface DocumentOwnerRuntimeV2<K extends DocumentOwnerKindV2> {
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>
  readonly closurePort: OwnerIntentClosurePortV2<K>
}

interface SelectedDocumentOwnerArtifactFactoryV2<
  K extends DocumentOwnerKindV2,
> {
  createRuntime(): DocumentOwnerRuntimeV2<K>
}
```

`DocumentOwnerProtocolPortV2` from section 10 is specialized by the same `K`; its
owner literal equals `K`. The artifact loader is the only factory caller and
registers the returned runtime as a private live capability.
`closurePort.protocolPort === runtime.protocolPort` by object identity. Structural
copies, separate injection and self-reported pair digests reject. Canvas specializes
non-null history. ProjectIndex specializes literal null, inspects each of its exact
eleven mutation intents as ordinary and defines a per-intent portable Owner-
dependency table. Project-local blob admission tokens are process-local and never
become causal dependencies.

Fact ports are synchronous, attempt-scoped, read-only tracked snapshots. Returned
bytes are defensive immutable copies. They do not fetch, generate facts, execute a
Plugin/generator or perform I/O. Pending fetch leaves the queue and restarts from the
latest base. Canvas and Project may specialize fact view decoding but cannot
redeclare these generic names or make collaboration depend on either package.

The base-closure port is a distinct nonportable capability created only after
Kernel reconstructs and validates the exact authored base checkpoint plus suffix.
It has no enumeration, I/O, fetch or ambient-store access and returns defensive
immutable views only for frames reachable from that exact base frontier. Kernel
tracks an independent `OwnerBaseReferenceLedgerV2`; owner discovery, apply and any
single-owner verifier such as F13 must consume the exact same required frame set.
This ledger is attempt evidence only and never enters CausalDependencyRef,
Authority/ExactBase/Owner partitions, wire, Y.Doc, journal or a digest.

The terminal `DocumentOwnerProtocolPortV2.applyIntent` signature additionally takes
`baseClosure: OwnerBaseCausalClosurePortV2` before `externalFacts`. A base whose
required ancestor bytes are fetchable but not reconstructed returns
`causal-base-pending` before owner invocation; an unprovable closure is
`exact-base-unavailable`. After port creation, a named frame absent from the closure
or having wrong scope/intent/write/evidence/post-frontier is a semantic local
`invalid-owner-result` or incoming `invalid-causal-frame`, never pending and never
an external fetch.

### 19.2 Kernel-owned remote transfer identities

```ts
interface StableRemoteTransferKeyV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Uint64V2
  readonly sourceMemberId: MemberIdV2
  readonly transferId: Id128V2
}

interface RemoteTransferAttemptBindingV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly connectionId: string
  readonly manifestDigest: DigestV2
}
```

These are generic shape/codecs, not membership policy. Control imports them and
authenticates the offer; Project/node implements their persistence. Stable
uniqueness uses only `StableRemoteTransferKeyV2` and maps it to exactly one manifest
digest. Attempt cancellation/takeover uses the connection-bearing binding. Quota is
aggregated only by Project epoch and stable source member.

### 19.3 Four affine incoming capabilities

The following types have private unique-symbol brands and no public constructor,
serializer or structural admission. Each instance is registered in a private live
set, binds defensive immutable byte handles and can be consumed exactly once:

```ts
interface HeaderAuthenticatedIncomingFrameV2 {
  readonly exactEnvelopeDigest: DigestV2
}
interface PayloadParsedIncomingFrameV2 {
  readonly exactEnvelopeDigest: DigestV2
}
interface ObjectAndInboxDurablePayloadParsedV2 {
  readonly exactEnvelopeDigest: DigestV2
}
interface FullyValidatedIncomingFrameV2 {
  readonly exactEnvelopeDigest: DigestV2
}
```

The observable fields are diagnostic only; private bindings carry the exact
envelope/staged handle, header facts, five exact section handles, reservation,
object/inbox receipts, expected accepted head, frame/scope/actor/op/sequence,
frontier/actor-head, dependency/evidence/delta and post-state commitments.

The only transitions are:

```text
verifyHeaderAuthority(exact staged bytes)
  -> HeaderAuthenticatedIncomingFrameV2
parseAuthenticatedPayload(header capability)
  -> PayloadParsedIncomingFrameV2
persistStructurallyParsedRemoteFrame(payload capability, reservation receipt)
  -> ObjectAndInboxDurablePayloadParsedV2
validateDurableIncomingFrame(durable payload capability)
  -> FullyValidatedIncomingFrameV2 | DurableDependencyPendingV2 | rejected
appendAcceptedJournalFromInbox(fully validated capability, inbox receipt)
  -> accepted journal receipt
```

Header verification includes current signed offer binding, manifest/frame/header
equality, causal authority and signature; bad signature invokes the structural
parser zero times. Structural parsing checks only framing, every section's
preallocation cap, restricted-JCS canonical equality, length/digest/trailing bytes
and duplicate/repeated-field equality. It treats the Yjs update as opaque bytes and
invokes Authority/ExactBase/Owner dependency resolvers, owner decode/apply, external
facts and Yjs decode/apply zero times. A malformed structural payload writes no
immutable object or inbox.

Persistence consumes the parsed capability and exact reservation receipt, obtains
the original complete-envelope handle from private binding, fsyncs that byte copy as
the immutable object, then fsyncs the exact pending-inbox ref. It never re-encodes
parsed sections. Object and inbox receipts bind stable/attempt transfer identity,
reservation record digest, frame/object digest, complete length, header/payload and
five section digests. Only after verifying both receipts does Kernel mint the third
capability.

Semantic validation consumes the third capability and performs actor equivocation,
current declared Authority, ExactBase and Owner closure, exact-base reconstruction,
owner decode/pure isolated apply, Yjs apply, evidence/delta/post validation and
current authority/cutoff recheck. `dependency-pending` produces a non-authoritative
durable pending ref, not a reusable capability. Retry reauthenticates and reparses
the exact durable bytes through a new one-shot kernel gate. Only the fourth
capability can enter the inbox journal; no capability directly grants head or ACK.

### 19.4 Closed ingress persistence port

```ts
interface RemoteIngressReservationRefV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly attempt: RemoteTransferAttemptBindingV2
  readonly exactManifestDigest: DigestV2
  readonly declaredByteLength: Uint64V2
}

interface RemotePendingInboxRefV2 extends FrameObjectRefV2 {
  readonly reservationRecordDigest: DigestV2
  readonly objectDigest: DigestV2
  readonly exactByteLength: Uint64V2
  readonly sourceMemberId: MemberIdV2
}

type JournalAdmissionSourceV2 =
  | { readonly kind: "local-authoring-outbox";
      readonly refDigest: DigestV2 }
  | { readonly kind: "remote-pending-inbox";
      readonly refDigest: DigestV2;
      readonly reservationRecordDigest: DigestV2 }

interface CollaborationPersistencePortV2 {
  reserveRemoteIngress(
    ref: RemoteIngressReservationRefV2,
  ): Promise<RemoteIngressReservationReceiptV2 | "quota-exceeded" |
    "transfer-manifest-equivocation">
  putRemoteStagingChunk(
    reservation: RemoteIngressReservationReceiptV2,
    chunk: Uint8Array,
  ): Promise<RemoteIngressReservationReceiptV2>
  putImmutableRemoteFrame(
    reservation: RemoteIngressReservationReceiptV2,
    ref: FrameObjectRefV2,
    exactBytes: Uint8Array,
  ): Promise<RemoteFrameObjectReceiptV2>
  putRemotePendingInboxRef(
    object: RemoteFrameObjectReceiptV2,
    ref: RemotePendingInboxRefV2,
  ): Promise<RemotePendingInboxReceiptV2>
  appendAcceptedJournalFromOutbox(
    outbox: LocalAuthoringOutboxReceiptV2,
    validated: FullyValidatedLocalFrameV2,
  ): Promise<JournalAppendReceiptV2>
  appendAcceptedJournalFromInbox(
    inbox: RemotePendingInboxReceiptV2,
    validated: FullyValidatedIncomingFrameV2,
  ): Promise<JournalAppendReceiptV2>
}
```

This interface terminally replaces section 12's shared
`putImmutableFrame`/`appendAcceptedJournal` shorthand; unchanged load/head/
reachability/lookup/reference/quarantine methods remain. Receipt types are private
live capability plus exact durable-record identity. Each transition consumes its
input once; a thrown I/O, return-value loss or reentry never revives it.

Local and remote journal admission methods are distinct. Every journal record has
one closed `admissionSource` and persists expected accepted-head digest, exact
source/object/frame identity, scope, actor, operation id, actor sequence, resulting
frontier and actor-head commitments. Journal durability is the semantic validation
boundary. Head CAS uses only that persisted expected head; mismatch quarantines as
stale/corruption and never rebases.

### 19.5 Ingress quotas and crash recovery

The Revision 5.2 limit object has 71 fields and adds Project-epoch
8192 frames/536870912 bytes and stable-source-member 512 frames/33554432 bytes.
Reservation, staging, object-before-inbox and inbox all count until atomic
release/finalize/quarantine transfer. Header-authorized document 4096/268435456 and
actor 512/33554432 caps apply additionally. One stable key/manifest reconnect CASes
the existing reservation/writer without a second charge; different manifest is
terminal equivocation.

Reservation/staging-only restart redoes header and structural parsing as needed.
Remote object-only or inbox-below-journal redoes header, structural and semantic
validation over the exact bytes, with idempotent object/ref completion. It never
constructs a local intent, materializes history, discovers/generates a fresh fact,
allocates identity/sequence/Lamport/stamp or signs. Remote journal-below-head first
validates journal/object/inbox/reservation closure, then completes only the exact
persisted-head CAS with zero owner callbacks. Local-authoring recovery remains
provenance-distinct. Orphan collection needs a complete durable-reference scan.

### 19.6 Wrapper subject domain and registry

Revision 5.2 adds exactly `convax.signed-wrapper-subject/2`; its restricted-JCS
closed union and digest formula are Control section 18.5 authority. The kernel
registry is the strict raw-UTF-8 sorted Revision 5.1 127-domain set plus that one
domain: exactly **128** unique domains. The four wrapper object domains and their
four `-core/2` domains remain present. The Control limit digest and every artifact,
bundle, authority and receipt identity rotate; protocol major stays `2`.

### 19.7 Mandatory falsifiers

Conformance fails if collaboration imports Canvas/Control/Project; if a generic ABI
is structurally redeclared; if a token is forged/reused; if bad signature reaches
structural parsing; if malformed structural payload reaches object/inbox; if the
parser calls owner/Yjs/dependency; if persistence writes re-encoded bytes; if
dependency-pending lacks durable inbox or reuses a token; if journal-below-head calls
owner; if connection/peer/session partitions stable identity/quota; if one reconnect
creates two writers/charges; if a same-key different manifest has an arrival-order
winner; or if limits/registry counts are not 71/128.

## 20. Revision 5.3 normative dependency and base-reference replacement

This section is inside the Kernel artifact span and is terminal Revision 5.3
authority. It replaces every conflicting Revision 5.2 dependency-kind, owner
closure, base-reference, stable-transfer scalar, limits-count and registry
statement. Revision 5.2 was rejected before signature and provides no decoder or
fallback. Protocol major remains `"2"` as an exact-digest hard cut.

### 20.1 One closed dependency-kind source

The portable dependency union and Owner projection are generated from these exact
closed definitions:

```ts
type AuthorityDependencyKindV2 =
  | "membership-snapshot"
  | "replica-actor-credential"
  | "replica-edit-authorization"
  | "authorization-mutation"
  | "cutoff-coverage-root"

type ExactBaseDependencyKindV2 =
  | "checkpoint-content-certificate"

type OwnerDependencyKindV2 =
  | "project-index-proof"
  | "project-resource-proof"
  | "canvas-genesis-proof"
  | "plugin-validation-artifact"
  | "generation-external-fact"
  | "reset-authorization"

type CausalDependencyKindV2 =
  | AuthorityDependencyKindV2
  | ExactBaseDependencyKindV2
  | OwnerDependencyKindV2

type CausalDependencyRefV2 = {
  [K in CausalDependencyKindV2]: Readonly<{
    kind: K
    digest: DigestV2
  }>
}[CausalDependencyKindV2]

type OwnerDependencyRefV2 = Extract<
  CausalDependencyRefV2,
  Readonly<{ kind: OwnerDependencyKindV2 }>
>

type DependencyPartitionV2 = "authority" | "exact-base" | "owner"
```

`classifyDependencyKindV2` is an exhaustive switch over every literal above and
maps `canvas-genesis-proof` uniquely to `owner`. Unknown values reject during the
restricted-JCS decode. There is no separately maintained portable union and no
prose-only extension. These classifiers and carrier format literals do not create
digest domains.

### 20.2 Stable transfer identity correction

The sole stable identity declaration is:

```ts
interface StableRemoteTransferKeyV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly transferId: Id128V2
}

interface RemoteTransferAttemptBindingV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly connectionId: string
  readonly manifestDigest: DigestV2
}
```

`projectEpoch: Uint64V2` is an invalid retired codec here. Control and Project/node
import this exact type and codec; they cannot convert, alias or redeclare it.

### 20.3 Affine dependency and base-reference phases

```ts
type OwnerBaseReferencePhaseV2 =
  | "discover"
  | "reset-f13-initial"
  | "reset-f13-final"
  | "reset-f13-incoming"
  | "apply"

interface OwnerBaseReferenceLedgerV2 {
  readonly requiredFrameDigests: readonly DigestV2[]
  openPhase(
    phase: OwnerBaseReferencePhaseV2,
  ): OwnerBaseCausalClosurePortV2
  assertExactConsumption(
    phase: OwnerBaseReferencePhaseV2,
  ): "verified" | "rejected"
}

interface OwnerResolvedDependenciesV2<
  K extends DocumentOwnerKindV2,
> {
  readonly owner: K
  readonly intentDigest: DigestV2
  readonly declaredOwnerRefs: readonly OwnerDependencyRefV2[]
}

interface OwnerResolvedBaseReferencesV2<
  K extends DocumentOwnerKindV2,
  P extends OwnerBaseReferencePhaseV2,
> {
  readonly owner: K
  readonly phase: P
  readonly requiredFrameDigests: readonly DigestV2[]
  readRequiredFrame(
    digest: DigestV2,
  ): OwnerBaseCausalFrameViewV2 | "not-required"
  consumedFrameDigests(): readonly DigestV2[]
}
```

All four interfaces above expose synchronous, read-only diagnostics only. Kernel
owns private unique-symbol brands, construction, live registries and consumption.
Every instance is process-only, nonserializable and privately binds the exact
runtime, attempt, decoded-intent identity, scope, intent digest, base frontier,
base canonical digest, resolved external-fact byte handles and base-closure
identity. A structural copy, caller-built port, raw boolean/digest, cross-runtime,
cross-attempt, cross-base or cross-phase use rejects before owner/F13 mutation.

The terminal closure ABI is:

```ts
interface OwnerIntentClosurePortV2<
  K extends DocumentOwnerKindV2,
> {
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>

  inspectIntent(
    decodedIntent: unknown,
  ): InspectedOwnerIntentV2 | "rejected"

  discoverDependencies(
    base: OwnerValidatedStateV2,
    context: OwnerIntentDependencyContextV2,
    decodedIntent: unknown,
    facts: OwnerExternalFactPortV2,
  ): OwnerResolvedDependenciesV2<K> | "pending" | "rejected"

  discoverBaseReferences(
    base: OwnerValidatedStateV2,
    context: OwnerIntentDependencyContextV2,
    decodedIntent: unknown,
    dependencies: OwnerResolvedDependenciesV2<K>,
    baseClosure: OwnerBaseCausalClosurePortV2,
  ): OwnerResolvedBaseReferencesV2<K, "discover"> | "rejected"

  readonly history: K extends "canvas"
    ? OwnerHistoryMaterializationPortV2
    : null
}
```

The terminal `DocumentOwnerProtocolPortV2.applyIntent` signature is:

```ts
applyIntent(
  candidate: Y.Doc,
  context: OwnerIntentValidationContextV2,
  intent: unknown,
  dependencies: OwnerResolvedDependenciesV2<K>,
  baseReferences: OwnerResolvedBaseReferencesV2<K, "apply">,
  baseClosure: OwnerBaseCausalClosurePortV2,
  externalFacts: OwnerExternalFactPortV2,
): OwnerApplyResultV2 | "pending" | "rejected"
```

Kernel creates one ledger only after reconstructing and validating the exact
authored base. Dependency discovery freezes the required set; each opened phase is
a fresh affine view and must consume exactly that set. Aggregate claims, a previous
phase's consumption and matching caller arrays are not evidence. For reset, every
F13 phase and apply independently consumes exactly `{F}`, and every returned F view
is byte-identical. Journal-below-head recovery invokes none of these owner ports.

### 20.4 Limits and registry delta

Revision 5.3 replaces the two object-count field names, changes the source-member
byte value and adds two individual carrier caps:

```ts
pendingRemoteIngressObjectsPerProjectEpoch: "8192"
pendingRemoteIngressBytesPerProjectEpoch: "536870912"
pendingRemoteIngressObjectsPerSourceMember: "512"
pendingRemoteIngressBytesPerSourceMember: "134217728"
canvasGenesisProofCarrierBytes: "83886080"
documentShardResetAuthorizationCarrierBytes: "100663296"
```

`pendingRemoteIngressFramesPerProjectEpoch` and
`pendingRemoteIngressFramesPerSourceMember` are unknown retired keys. All other
Revision 5.2 limit fields remain byte-identical, so the closed object has exactly
73 fields including `format`. The new limits digest is generated below the sentinel.

Revision 5.3 adds exactly one digest domain:

```text
convax.document-shard-reset-authorization-carrier/2
```

The registry is the strict sorted Revision 5.2 128-domain set plus that domain:
exactly 129 unique entries. `convax.canvas-genesis-proof-carrier/2` is only a binary
index format and is not registered. The channel contract remains unchanged.

### 20.5 Kernel falsifiers

Revision 5.3 is falsified if a valid Id128 Project epoch cannot round-trip through
the stable key; if a legal activation cannot encode `canvas-genesis-proof`; if a
dependency kind has two partitions or no portable carrier; if any reset/F13/apply
phase omits or substitutes F; if a branded value is serialized or replayed; if the
limits object has other than 73 fields; if the registry has other than 129 domains;
or if a Canvas genesis carrier is registered as a new digest domain.

<!-- BEGIN PROTOCOL_SCHEMA_BUNDLE_V2_INSTANCE -->

## 21. Instantiated Revision 5.3 ProtocolSchemaBundleV2

This is the sole generated Revision 5.3 bundle instance. It remains outside the
kernel artifact span so the kernel artifact digest cannot contain itself.

### 21.1 Exact source and artifact identities

- Canvas complete bytes: 149699; ordinary SHA-256
  `2220095c67d74884565db17b34b8bece7f7427c8a06ae78d341a06fcbd798fa5`;
- collaboration-kernel prefix through the LF before the sentinel: 82473
  bytes; ordinary SHA-256 `e6041f0d97592f79df2e3a29631c53cac6c11a0ff5328ee21d3d98b9f69512e7`;
- Control complete bytes: 195338; ordinary SHA-256
  `07b15d4df2273e8dcd89ba4e10b52b661298cb16f0f43bb013e3159017416226`;
- Project persistence complete bytes: 174385; ordinary SHA-256
  `cbfe749e337a5b6db08db7b4c7bef9762422f2c7abd7e168cfe1eeeb68183aed`.

The exact restricted-JCS artifact manifest is:

```json
[{"artifactDigest":"5089801494f2d5b7eab9b0bcde06111bff93157387f810e57ff3cac8418757bf","format":"convax.canvas-protocol-schema/2","name":"canvas-schema"},{"artifactDigest":"0749c83c19186d448f1fa8079894447d78992137c004d067ea48728d4704bbdc","format":"convax.collaboration-kernel-protocol-schema/2","name":"collaboration-kernel"},{"artifactDigest":"03661d9128b98a124fcbb61d6bc8601c03a205ffb6db745c709b8eb4ba252a2e","format":"convax.control-plane-protocol-schema/2","name":"control-plane"},{"artifactDigest":"04a7f0c3875339208052efb3f7b679ce982cb97c502dc133d132106358dbe4fa","format":"convax.project-persistence-protocol-schema/2","name":"project-persistence"}]
```

Each artifact digest is
`SHA-256("convax.protocol-schema-artifact/2\0" || artifactBytes)`. Canvas,
Control and Project use complete bytes including final LF; Kernel uses only the
82473-byte prefix. The resulting digests are:

```text
5089801494f2d5b7eab9b0bcde06111bff93157387f810e57ff3cac8418757bf
0749c83c19186d448f1fa8079894447d78992137c004d067ea48728d4704bbdc
03661d9128b98a124fcbb61d6bc8601c03a205ffb6db745c709b8eb4ba252a2e
04a7f0c3875339208052efb3f7b679ce982cb97c502dc133d132106358dbe4fa
```

### 21.2 Closed 129-domain registry

The registry is strict raw-UTF-8 sorted, duplicate-free and has exactly 129 entries:

```json
["convax.active-peer-directory-core/2","convax.actual-write-evidence/2","convax.authorization-mutation-core/2","convax.begin-authorization-epoch-core/2","convax.blob-durable-ack-core/2","convax.canonical-state/2","convax.canvas-actual-write-value/2","convax.canvas-containment-slot/2","convax.canvas-creation-group-member-set/2","convax.canvas-data-register/2","convax.canvas-derived-id/2","convax.canvas-edge-identity/2","convax.canvas-effective-child-set/2","convax.canvas-effective-data/2","convax.canvas-effective-plugin/2","convax.canvas-generation-begin/2","convax.canvas-generation-dismissal/2","convax.canvas-generation-lifecycle/2","convax.canvas-generation-recovery-failure/2","convax.canvas-generation-terminal/2","convax.canvas-genesis-core/2","convax.canvas-geometry/2","convax.canvas-group-geometry-plan/2","convax.canvas-history-footprint/2","convax.canvas-history-material/2","convax.canvas-history-materialization/2","convax.canvas-metadata-effective/2","convax.canvas-metadata-slot/2","convax.canvas-node-identity/2","convax.canvas-obstacle-projection/2","convax.canvas-operation-receipt/2","convax.canvas-projected-generation/2","convax.canvas-semantic-guard/2","convax.canvas-semantic-history-root/2","convax.canvas-semantic-history-state/2","convax.causal-context/2","convax.causal-dependency-set/2","convax.causal-edit-core/2","convax.causal-edit-frame-digest/2","convax.causal-edit-signature/2","convax.causal-frontier/2","convax.causal-head-ref/2","convax.checkpoint-content-certificate-core/2","convax.checkpoint-content-certificate/2","convax.checkpoint-validation-carrier-index/2","convax.collaboration-scope-entry-core/2","convax.document-registration-abandonment-core/2","convax.document-registration-claim-core/2","convax.document-scope/2","convax.document-shard-reset-approval-core/2","convax.document-shard-reset-authorization-carrier/2","convax.document-shard-reset-claim-core-digest/2","convax.document-shard-reset-claim-signature/2","convax.document-shard-reset-confirmation-core/2","convax.document-shard-reset-route-cas-core-digest/2","convax.empty-project-index-genesis-attestation-core/2","convax.generation-first-loss-receipt-core/2","convax.local-project-store-record-digest/2","convax.member-credential-core/2","convax.membership-snapshot-core/2","convax.mutation-challenge-core/2","convax.mutation-proof-core/2","convax.mutation-receipt-core/2","convax.native-document-store-key/2","convax.native-object-store-key/2","convax.owner-actual-write-evidence/2","convax.owner-canonicalizer-descriptor/2","convax.peer-channel-contract/2","convax.peer-channel-open-core/2","convax.peer-freshness-ticket-core/2","convax.peer-handshake-core/2","convax.peer-inventory-page-core/2","convax.peer-inventory-root-core/2","convax.peer-message-body/2","convax.peer-message-core/2","convax.peer-ticket-request-core/2","convax.peer-transfer-chunk/2","convax.peer-transfer-manifest-core/2","convax.project-admin-capability-core/2","convax.project-conflict-projection/2","convax.project-content-family-projection/2","convax.project-derived-identity/2","convax.project-entry-location-projection/2","convax.project-file-projection/2","convax.project-index-intent-digest/2","convax.project-index-live-scope-manifest/2","convax.project-index-record-digest/2","convax.project-index-write-value/2","convax.project-reset-approval-core/2","convax.project-reset-confirmation-core/2","convax.project-resource-reference-digest/2","convax.project-route-projection/2","convax.protocol-limits/2","convax.protocol-schema-artifact/2","convax.protocol-schema-bundle-core/2","convax.prunable-checkpoint-set-certificate-core/2","convax.prunable-checkpoint-set-certificate/2","convax.registry-cutoff-coverage-page-core/2","convax.registry-cutoff-coverage-root-core/2","convax.registry-entry-identity/2","convax.registry-entry-set/2","convax.registry-snapshot-core/2","convax.replica-actor-credential-core/2","convax.replica-actor-head-set/2","convax.replica-actor-id/2","convax.replica-causal-floor-ack-core/2","convax.replica-causal-floor-ack/2","convax.replica-checkpoint-core/2","convax.replica-checkpoint/2","convax.replica-durable-ack-core/2","convax.replica-edit-authorization-core/2","convax.replica-id-reservation-receipt-core/2","convax.replica-id-reservation-request-core/2","convax.replica-project-floor-page-core/2","convax.replica-project-floor-root-core/2","convax.service-trust-bundle-core/2","convax.session-challenge-core/2","convax.session-credential-core/2","convax.session-proof-core/2","convax.signed-wrapper-subject/2","convax.stable-checkpoint-set-core/2","convax.state-vector/2","convax.target-cutoff-leaf-core/2","convax.team-epoch-rollover-challenge-core/2","convax.team-epoch-rollover-proof-core/2","convax.team-epoch-rollover-receipt-core/2","convax.typed-intent/2","convax.validation-artifact-set/2","convax.yjs-update/2"]
```

`canvas-genesis-proof` is a dependency classifier and its carrier is proof input,
not a digest domain. Revision 5.3 adds only
`convax.document-shard-reset-authorization-carrier/2`.

### 21.3 Exact control digests

```text
uriProtocolDigest     = 298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949
limitsDigest          = 7c441df061e48710d29f7e4f4726a8d32e1e734c65a8cad6d5ecf7757cbb1cd4
channelContractDigest = 0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242
```

The limits digest is over the exact 73-field Revision 5.3 value. Yjs remains exactly
`13.6.31`, update-v1, with the unchanged pinned package integrity and codecs.

### 21.4 Exact bundle core and wrapper

The exact restricted-JCS core is:

```json
{"artifacts":[{"artifactDigest":"5089801494f2d5b7eab9b0bcde06111bff93157387f810e57ff3cac8418757bf","format":"convax.canvas-protocol-schema/2","name":"canvas-schema"},{"artifactDigest":"0749c83c19186d448f1fa8079894447d78992137c004d067ea48728d4704bbdc","format":"convax.collaboration-kernel-protocol-schema/2","name":"collaboration-kernel"},{"artifactDigest":"03661d9128b98a124fcbb61d6bc8601c03a205ffb6db745c709b8eb4ba252a2e","format":"convax.control-plane-protocol-schema/2","name":"control-plane"},{"artifactDigest":"04a7f0c3875339208052efb3f7b679ce982cb97c502dc133d132106358dbe4fa","format":"convax.project-persistence-protocol-schema/2","name":"project-persistence"}],"channelContractDigest":"0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242","domainRegistry":["convax.active-peer-directory-core/2","convax.actual-write-evidence/2","convax.authorization-mutation-core/2","convax.begin-authorization-epoch-core/2","convax.blob-durable-ack-core/2","convax.canonical-state/2","convax.canvas-actual-write-value/2","convax.canvas-containment-slot/2","convax.canvas-creation-group-member-set/2","convax.canvas-data-register/2","convax.canvas-derived-id/2","convax.canvas-edge-identity/2","convax.canvas-effective-child-set/2","convax.canvas-effective-data/2","convax.canvas-effective-plugin/2","convax.canvas-generation-begin/2","convax.canvas-generation-dismissal/2","convax.canvas-generation-lifecycle/2","convax.canvas-generation-recovery-failure/2","convax.canvas-generation-terminal/2","convax.canvas-genesis-core/2","convax.canvas-geometry/2","convax.canvas-group-geometry-plan/2","convax.canvas-history-footprint/2","convax.canvas-history-material/2","convax.canvas-history-materialization/2","convax.canvas-metadata-effective/2","convax.canvas-metadata-slot/2","convax.canvas-node-identity/2","convax.canvas-obstacle-projection/2","convax.canvas-operation-receipt/2","convax.canvas-projected-generation/2","convax.canvas-semantic-guard/2","convax.canvas-semantic-history-root/2","convax.canvas-semantic-history-state/2","convax.causal-context/2","convax.causal-dependency-set/2","convax.causal-edit-core/2","convax.causal-edit-frame-digest/2","convax.causal-edit-signature/2","convax.causal-frontier/2","convax.causal-head-ref/2","convax.checkpoint-content-certificate-core/2","convax.checkpoint-content-certificate/2","convax.checkpoint-validation-carrier-index/2","convax.collaboration-scope-entry-core/2","convax.document-registration-abandonment-core/2","convax.document-registration-claim-core/2","convax.document-scope/2","convax.document-shard-reset-approval-core/2","convax.document-shard-reset-authorization-carrier/2","convax.document-shard-reset-claim-core-digest/2","convax.document-shard-reset-claim-signature/2","convax.document-shard-reset-confirmation-core/2","convax.document-shard-reset-route-cas-core-digest/2","convax.empty-project-index-genesis-attestation-core/2","convax.generation-first-loss-receipt-core/2","convax.local-project-store-record-digest/2","convax.member-credential-core/2","convax.membership-snapshot-core/2","convax.mutation-challenge-core/2","convax.mutation-proof-core/2","convax.mutation-receipt-core/2","convax.native-document-store-key/2","convax.native-object-store-key/2","convax.owner-actual-write-evidence/2","convax.owner-canonicalizer-descriptor/2","convax.peer-channel-contract/2","convax.peer-channel-open-core/2","convax.peer-freshness-ticket-core/2","convax.peer-handshake-core/2","convax.peer-inventory-page-core/2","convax.peer-inventory-root-core/2","convax.peer-message-body/2","convax.peer-message-core/2","convax.peer-ticket-request-core/2","convax.peer-transfer-chunk/2","convax.peer-transfer-manifest-core/2","convax.project-admin-capability-core/2","convax.project-conflict-projection/2","convax.project-content-family-projection/2","convax.project-derived-identity/2","convax.project-entry-location-projection/2","convax.project-file-projection/2","convax.project-index-intent-digest/2","convax.project-index-live-scope-manifest/2","convax.project-index-record-digest/2","convax.project-index-write-value/2","convax.project-reset-approval-core/2","convax.project-reset-confirmation-core/2","convax.project-resource-reference-digest/2","convax.project-route-projection/2","convax.protocol-limits/2","convax.protocol-schema-artifact/2","convax.protocol-schema-bundle-core/2","convax.prunable-checkpoint-set-certificate-core/2","convax.prunable-checkpoint-set-certificate/2","convax.registry-cutoff-coverage-page-core/2","convax.registry-cutoff-coverage-root-core/2","convax.registry-entry-identity/2","convax.registry-entry-set/2","convax.registry-snapshot-core/2","convax.replica-actor-credential-core/2","convax.replica-actor-head-set/2","convax.replica-actor-id/2","convax.replica-causal-floor-ack-core/2","convax.replica-causal-floor-ack/2","convax.replica-checkpoint-core/2","convax.replica-checkpoint/2","convax.replica-durable-ack-core/2","convax.replica-edit-authorization-core/2","convax.replica-id-reservation-receipt-core/2","convax.replica-id-reservation-request-core/2","convax.replica-project-floor-page-core/2","convax.replica-project-floor-root-core/2","convax.service-trust-bundle-core/2","convax.session-challenge-core/2","convax.session-credential-core/2","convax.session-proof-core/2","convax.signed-wrapper-subject/2","convax.stable-checkpoint-set-core/2","convax.state-vector/2","convax.target-cutoff-leaf-core/2","convax.team-epoch-rollover-challenge-core/2","convax.team-epoch-rollover-proof-core/2","convax.team-epoch-rollover-receipt-core/2","convax.typed-intent/2","convax.validation-artifact-set/2","convax.yjs-update/2"],"format":"convax.protocol-schema-bundle-core/2","limitsDigest":"7c441df061e48710d29f7e4f4726a8d32e1e734c65a8cad6d5ecf7757cbb1cd4","protocolMajor":"2","typeNamespaces":[{"imports":["collaboration-kernel","control-plane"],"namespace":"canvas-schema"},{"imports":["global-uri"],"namespace":"collaboration-kernel"},{"imports":["collaboration-kernel","global-uri","project-persistence"],"namespace":"control-plane"},{"imports":[],"namespace":"global-uri"},{"imports":["collaboration-kernel","control-plane","global-uri"],"namespace":"project-persistence"}],"uriProtocolDigest":"298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949","yjsWireCodec":{"applyCodec":"Y.applyUpdate","format":"convax.yjs-wire-codec/2","package":"yjs","packageIntegrity":"sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw==","stateVectorCodec":"Y.encodeStateVector","updateCodec":"Y.encodeStateAsUpdate","updateVersion":"v1","version":"13.6.31"}}
```

```text
coreDigest = protocolDigest = ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838
```

The exact restricted-JCS complete wrapper is:

```json
{"core":{"artifacts":[{"artifactDigest":"5089801494f2d5b7eab9b0bcde06111bff93157387f810e57ff3cac8418757bf","format":"convax.canvas-protocol-schema/2","name":"canvas-schema"},{"artifactDigest":"0749c83c19186d448f1fa8079894447d78992137c004d067ea48728d4704bbdc","format":"convax.collaboration-kernel-protocol-schema/2","name":"collaboration-kernel"},{"artifactDigest":"03661d9128b98a124fcbb61d6bc8601c03a205ffb6db745c709b8eb4ba252a2e","format":"convax.control-plane-protocol-schema/2","name":"control-plane"},{"artifactDigest":"04a7f0c3875339208052efb3f7b679ce982cb97c502dc133d132106358dbe4fa","format":"convax.project-persistence-protocol-schema/2","name":"project-persistence"}],"channelContractDigest":"0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242","domainRegistry":["convax.active-peer-directory-core/2","convax.actual-write-evidence/2","convax.authorization-mutation-core/2","convax.begin-authorization-epoch-core/2","convax.blob-durable-ack-core/2","convax.canonical-state/2","convax.canvas-actual-write-value/2","convax.canvas-containment-slot/2","convax.canvas-creation-group-member-set/2","convax.canvas-data-register/2","convax.canvas-derived-id/2","convax.canvas-edge-identity/2","convax.canvas-effective-child-set/2","convax.canvas-effective-data/2","convax.canvas-effective-plugin/2","convax.canvas-generation-begin/2","convax.canvas-generation-dismissal/2","convax.canvas-generation-lifecycle/2","convax.canvas-generation-recovery-failure/2","convax.canvas-generation-terminal/2","convax.canvas-genesis-core/2","convax.canvas-geometry/2","convax.canvas-group-geometry-plan/2","convax.canvas-history-footprint/2","convax.canvas-history-material/2","convax.canvas-history-materialization/2","convax.canvas-metadata-effective/2","convax.canvas-metadata-slot/2","convax.canvas-node-identity/2","convax.canvas-obstacle-projection/2","convax.canvas-operation-receipt/2","convax.canvas-projected-generation/2","convax.canvas-semantic-guard/2","convax.canvas-semantic-history-root/2","convax.canvas-semantic-history-state/2","convax.causal-context/2","convax.causal-dependency-set/2","convax.causal-edit-core/2","convax.causal-edit-frame-digest/2","convax.causal-edit-signature/2","convax.causal-frontier/2","convax.causal-head-ref/2","convax.checkpoint-content-certificate-core/2","convax.checkpoint-content-certificate/2","convax.checkpoint-validation-carrier-index/2","convax.collaboration-scope-entry-core/2","convax.document-registration-abandonment-core/2","convax.document-registration-claim-core/2","convax.document-scope/2","convax.document-shard-reset-approval-core/2","convax.document-shard-reset-authorization-carrier/2","convax.document-shard-reset-claim-core-digest/2","convax.document-shard-reset-claim-signature/2","convax.document-shard-reset-confirmation-core/2","convax.document-shard-reset-route-cas-core-digest/2","convax.empty-project-index-genesis-attestation-core/2","convax.generation-first-loss-receipt-core/2","convax.local-project-store-record-digest/2","convax.member-credential-core/2","convax.membership-snapshot-core/2","convax.mutation-challenge-core/2","convax.mutation-proof-core/2","convax.mutation-receipt-core/2","convax.native-document-store-key/2","convax.native-object-store-key/2","convax.owner-actual-write-evidence/2","convax.owner-canonicalizer-descriptor/2","convax.peer-channel-contract/2","convax.peer-channel-open-core/2","convax.peer-freshness-ticket-core/2","convax.peer-handshake-core/2","convax.peer-inventory-page-core/2","convax.peer-inventory-root-core/2","convax.peer-message-body/2","convax.peer-message-core/2","convax.peer-ticket-request-core/2","convax.peer-transfer-chunk/2","convax.peer-transfer-manifest-core/2","convax.project-admin-capability-core/2","convax.project-conflict-projection/2","convax.project-content-family-projection/2","convax.project-derived-identity/2","convax.project-entry-location-projection/2","convax.project-file-projection/2","convax.project-index-intent-digest/2","convax.project-index-live-scope-manifest/2","convax.project-index-record-digest/2","convax.project-index-write-value/2","convax.project-reset-approval-core/2","convax.project-reset-confirmation-core/2","convax.project-resource-reference-digest/2","convax.project-route-projection/2","convax.protocol-limits/2","convax.protocol-schema-artifact/2","convax.protocol-schema-bundle-core/2","convax.prunable-checkpoint-set-certificate-core/2","convax.prunable-checkpoint-set-certificate/2","convax.registry-cutoff-coverage-page-core/2","convax.registry-cutoff-coverage-root-core/2","convax.registry-entry-identity/2","convax.registry-entry-set/2","convax.registry-snapshot-core/2","convax.replica-actor-credential-core/2","convax.replica-actor-head-set/2","convax.replica-actor-id/2","convax.replica-causal-floor-ack-core/2","convax.replica-causal-floor-ack/2","convax.replica-checkpoint-core/2","convax.replica-checkpoint/2","convax.replica-durable-ack-core/2","convax.replica-edit-authorization-core/2","convax.replica-id-reservation-receipt-core/2","convax.replica-id-reservation-request-core/2","convax.replica-project-floor-page-core/2","convax.replica-project-floor-root-core/2","convax.service-trust-bundle-core/2","convax.session-challenge-core/2","convax.session-credential-core/2","convax.session-proof-core/2","convax.signed-wrapper-subject/2","convax.stable-checkpoint-set-core/2","convax.state-vector/2","convax.target-cutoff-leaf-core/2","convax.team-epoch-rollover-challenge-core/2","convax.team-epoch-rollover-proof-core/2","convax.team-epoch-rollover-receipt-core/2","convax.typed-intent/2","convax.validation-artifact-set/2","convax.yjs-update/2"],"format":"convax.protocol-schema-bundle-core/2","limitsDigest":"7c441df061e48710d29f7e4f4726a8d32e1e734c65a8cad6d5ecf7757cbb1cd4","protocolMajor":"2","typeNamespaces":[{"imports":["collaboration-kernel","control-plane"],"namespace":"canvas-schema"},{"imports":["global-uri"],"namespace":"collaboration-kernel"},{"imports":["collaboration-kernel","global-uri","project-persistence"],"namespace":"control-plane"},{"imports":[],"namespace":"global-uri"},{"imports":["collaboration-kernel","control-plane","global-uri"],"namespace":"project-persistence"}],"uriProtocolDigest":"298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949","yjsWireCodec":{"applyCodec":"Y.applyUpdate","format":"convax.yjs-wire-codec/2","package":"yjs","packageIntegrity":"sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw==","stateVectorCodec":"Y.encodeStateVector","updateCodec":"Y.encodeStateAsUpdate","updateVersion":"v1","version":"13.6.31"}},"coreDigest":"ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838","format":"convax.protocol-schema-bundle/2","protocolDigest":"ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838"}
```

### 21.5 Regeneration gate

Admission independently recomputes the four source identities, Kernel prefix,
artifact digests, 129-domain registry, 73-field limits digest, core JCS and complete
wrapper. Revision 4, unsigned Revisions 5.1/5.2, 123/127/128-domain registries, old
epoch/dependency/reset/ingress field spellings or any mismatched bytes fail before
decoder, owner runtime, persistence or Peer channel construction.

Any owner or Kernel-prefix byte edit requires regeneration of this section, Main,
annex-set, five-file authority manifest and all three architecture receipts. This
generated section carries no independent architecture vote.
