# Convax P2P v10 collaboration kernel and portable protocol appendix

Status: **Route B standalone final-candidate. It is non-authoritative until one
complete five-file candidate, its generated protocol bundle, and the same exact
whole-file identities receive unconditional 3/3 signoff and atomic pointer
publication.**

The words MUST, MUST NOT, SHOULD and MAY are normative. Unknown, noncanonical or
unsupported values fail closed.

## 1. Scope, owner and dependency direction

`@convax/collaboration` exclusively owns the browser-safe generic kernel:

- shared ids, `DocumentScopeV2`, `PortableStampV2`, restricted JCS and exact byte
  digest/signature rules;
- causal heads, frontiers, dependency contexts, generic actual-write evidence and
  final signed causal frames;
- exact Yjs update-v1 codecs and the one-authority
  `replicaDoc`/isolated-`candidateDoc` lifecycle;
- generic remote-ingress capabilities, process-only brands, selected owner-port
  factories, plain-evidence validators and private live registries;
- typed durability, recovery, scan-fence and GC command ports with no native
  implementation;
- transient session undo coordination and generic transfer-attempt binding.

It MUST NOT own owner records, business reducers, membership, reset semantics,
owner currentness, terminal ACK policy, concrete transport, host I/O, UI runtime,
Plugin execution or service adapters. Owner packages inject closed schema/reducer
and external-fact ports. The owner persistence adapter returns plain evidence; the
control-plane semantic owner owns currentness and terminal carrier ACK gates; the
host composition edge owns transport and connection-local adapters.

Runtime dependency direction is exactly:

```text
collaboration -> yjs only
canvas -> collaboration
project -> canvas, collaboration
desktop -> collaboration, canvas, project
api -> collaboration + project/collaboration-protocol
```

Portable namespace references in the generated schema bundle do not create runtime
package dependencies. There is no ambient owner registry, service locator,
`@convax/collaboration/control` package, or public constructor that can mint a
process brand from structural data.

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
The fixed spelling starts and ends alphanumeric and satisfies the selected
transport's lexical boundary without importing its implementation. The kernel owns
only this codec and byte comparison; control owns allocation/routing, Desktop owns
the concrete transport adapter, and
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

## 4. Four-owner artifact and namespace contract

A complete protocol candidate contains exactly four annex artifacts in strict raw
UTF-8 `name` order:

| `name` | `format` | Artifact bytes |
| --- | --- | --- |
| `canvas-schema` | `convax.canvas-protocol-schema/2` | complete Canvas annex UTF-8 file including its single final LF |
| `collaboration-kernel` | `convax.collaboration-kernel-protocol-schema/2` | this complete UTF-8 file including its single final LF |
| `control-plane` | `convax.control-plane-protocol-schema/2` | complete control-plane annex UTF-8 file including its single final LF |
| `project-persistence` | `convax.project-persistence-protocol-schema/2` | complete Project annex UTF-8 file including its single final LF |

```ts
interface ProtocolSchemaArtifactRefV2 {
  readonly name: string
  readonly format: string
  readonly artifactDigest: DigestV2
}

type ProtocolSchemaArtifactManifestV2 = readonly [
  ProtocolSchemaArtifactRefV2 & {
    readonly name: "canvas-schema"
    readonly format: "convax.canvas-protocol-schema/2"
  },
  ProtocolSchemaArtifactRefV2 & {
    readonly name: "collaboration-kernel"
    readonly format: "convax.collaboration-kernel-protocol-schema/2"
  },
  ProtocolSchemaArtifactRefV2 & {
    readonly name: "control-plane"
    readonly format: "convax.control-plane-protocol-schema/2"
  },
  ProtocolSchemaArtifactRefV2 & {
    readonly name: "project-persistence"
    readonly format: "convax.project-persistence-protocol-schema/2"
  },
]

interface ProtocolTypeNamespaceRefV2 {
  readonly namespace:
    | "canvas-schema"
    | "collaboration-kernel"
    | "control-plane"
    | "global-uri"
    | "project-persistence"
  readonly imports: readonly (
    | "canvas-schema"
    | "collaboration-kernel"
    | "control-plane"
    | "global-uri"
    | "project-persistence"
  )[]
}

interface ProtocolSchemaBundleCoreV2 {
  readonly format: "convax.protocol-schema-bundle-core/2"
  readonly protocolMajor: "2"
  readonly artifacts: ProtocolSchemaArtifactManifestV2
  readonly typeNamespaces: readonly ProtocolTypeNamespaceRefV2[]
  readonly domainRegistry: readonly string[]
  readonly yjsWireCodec: YjsWireCodecV2
  readonly uriProtocolDigest: DigestV2
  readonly limitsDigest: DigestV2
  readonly channelContractDigest: DigestV2
}

interface ProtocolSchemaBundleV2 {
  readonly format: "convax.protocol-schema-bundle/2"
  readonly core: ProtocolSchemaBundleCoreV2
  readonly coreDigest: DigestV2
  readonly protocolDigest: DigestV2
}
```

The exact `typeNamespaces` tuple is:

```json
[{"imports":["collaboration-kernel","control-plane","global-uri"],"namespace":"canvas-schema"},{"imports":["global-uri"],"namespace":"collaboration-kernel"},{"imports":["collaboration-kernel","global-uri","project-persistence"],"namespace":"control-plane"},{"imports":[],"namespace":"global-uri"},{"imports":["canvas-schema","collaboration-kernel","control-plane","global-uri"],"namespace":"project-persistence"}]
```

The outer tuple is strict raw-UTF-8 sorted by `namespace`. Every `imports` tuple is
duplicate-free, excludes its own namespace and is strict raw-UTF-8 sorted. It is a
portable type-reference graph, not the runtime package dependency graph; its
type-only strongly connected component grants no runtime import.

For every annex:

```text
artifactDigest =
  SHA-256("convax.protocol-schema-artifact/2\0" || completeAnnexBytes)
```

`completeAnnexBytes` means the complete file including its single final LF. No
sentinel, prefix range, embedded whole-file digest, embedded artifact digest or
literal bundle digest exists.

The external assembly step computes the four artifact digests, uses the exact
namespace tuple above, builds the duplicate-free strict raw-UTF-8 sorted domain
registry and constructs the bundle core. It sets both `coreDigest` and
`protocolDigest` to:

```text
SHA-256("convax.protocol-schema-bundle-core/2\0" || JCS(exact core))
```

Source-set SHA, ordinary whole-file SHA, artifact digest and protocol digest are
distinct identities and never substitute for one another. A missing, mismatched,
duplicate, unsorted, self-referential or non-complete artifact fails before decode,
sign, persistence or ACK.
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
`state-vector-limit`; `replicaDoc` remains readable and exportable but cannot
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
destroy the candidate after success/failure. `replicaDoc`'s process-local
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

interface CausalDependencyRefV2 {
  kind: string
  digest: DigestV2
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

Dependency `kind` is an NFC ASCII token matching
`^[a-z][a-z0-9.-]{0,127}$`. Dependencies sort by `(kind UTF-8 bytes, decoded digest
bytes)`, are duplicate-free and number at most 256. The mandatory actor credential, edit authorization and
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
ambient schema. The following is the complete generated public owner ABI. Every
brand is declared exactly once here, and a brand marker is necessary but never
sufficient: the creating Kernel factory also records the exact object in its private
live registry.

```ts
declare const ownerValidatedStateBrandV2: unique symbol
declare const ownerApplyResultBrandV2: unique symbol
declare const ownerProcessValueFactoryBrandV2: unique symbol
declare const ownerExternalFactPortBrandV2: unique symbol
declare const ownerExternalFactPortFactoryBrandV2: unique symbol
declare const ownerHistoryMaterializationPortBrandV2: unique symbol
declare const ownerIntentClosurePortBrandV2: unique symbol
declare const documentOwnerProtocolPortBrandV2: unique symbol
declare const documentOwnerRuntimeBrandV2: unique symbol
declare const selectedDocumentOwnerArtifactFactoryBrandV2: unique symbol

interface OwnerIntentConstructionContextV2 {
  scope: DocumentScopeV2
  actorId: ActorIdV2
  actorSequence: Uint64V2
  operationId: Id128V2
  lamport: Uint64V2
  baseFrontierDigest: DigestV2
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
}

interface OwnerIntentDependencyContextV2
  extends OwnerIntentConstructionContextV2 {
  intentDigest: DigestV2
}

type OwnerIntentValidationContextV2 = OwnerIntentDependencyContextV2

interface OwnerValidatedStateV2<
  K extends DocumentOwnerKindV2,
> {
  readonly owner: K
  readonly value: unknown
  readonly [ownerValidatedStateBrandV2]: true
}

interface OwnerApplyResultV2<
  K extends DocumentOwnerKindV2,
> {
  readonly owner: K
  readonly value: unknown
  readonly [ownerApplyResultBrandV2]: true
}

interface OwnerProcessValueFactoryV2<K extends DocumentOwnerKindV2> {
  wrapValidatedState(value: unknown): OwnerValidatedStateV2<K>
  wrapApplyResult(value: unknown): OwnerApplyResultV2<K>
  readonly [ownerProcessValueFactoryBrandV2]: true
}

interface OwnerExternalFactRequirementV2<
  K extends DocumentOwnerKindV2,
> {
  readonly owner: K
  readonly kind: string
  readonly factDigest: DigestV2
  readonly request: Readonly<{
    readonly sha256: DigestV2
    readonly exactJcs: Readonly<Uint8Array>
  }>
}

interface OwnerIntentDependenciesV2<
  K extends DocumentOwnerKindV2,
> {
  readonly validationArtifacts: readonly ValidationArtifactRefV2[]
  readonly externalFacts: readonly OwnerExternalFactRequirementV2<K>[]
}

type OwnerValidationArtifactResolveResultV2 =
  | Readonly<{
      status: "resolved"
      ref: ValidationArtifactRefV2
      exactBytes: Readonly<Uint8Array>
    }>
  | Readonly<{ status: "pending"; ref: ValidationArtifactRefV2 }>
  | Readonly<{
      status: "rejected"
      code: "artifact-not-declared" | "artifact-invalid"
    }>

type OwnerExternalFactResolveResultV2<
  K extends DocumentOwnerKindV2,
> =
  | Readonly<{
      status: "resolved"
      requirement: OwnerExternalFactRequirementV2<K>
      value: unknown
    }>
  | Readonly<{
      status: "pending"
      requirement: OwnerExternalFactRequirementV2<K>
    }>
  | Readonly<{
      status: "rejected"
      code: "fact-not-declared" | "fact-invalid"
    }>

interface OwnerExternalFactResolverDefinitionV2<
  K extends DocumentOwnerKindV2,
> {
  readonly owner: K
  resolveArtifact(
    ref: ValidationArtifactRefV2,
  ): OwnerValidationArtifactResolveResultV2
  resolveFact(
    requirement: OwnerExternalFactRequirementV2<K>,
  ): OwnerExternalFactResolveResultV2<K>
}

interface OwnerExternalFactPortV2<
  K extends DocumentOwnerKindV2,
> {
  resolveArtifact(
    ref: ValidationArtifactRefV2,
  ): OwnerValidationArtifactResolveResultV2
  resolveFact(
    requirement: OwnerExternalFactRequirementV2<K>,
  ): OwnerExternalFactResolveResultV2<K>
  consumedDependencies(): OwnerIntentDependenciesV2<K>
  readonly [ownerExternalFactPortBrandV2]: true
}

type CreateOwnerExternalFactAttemptPortResultV2<
  K extends DocumentOwnerKindV2,
> =
  | Readonly<{
      status: "created"
      port: OwnerExternalFactPortV2<K>
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "wrong-owner"
        | "dependency-cap-exceeded"
        | "dependency-order-invalid"
        | "dependency-duplicate"
        | "dependency-invalid"
    }>

interface OwnerExternalFactPortFactoryV2<
  K extends DocumentOwnerKindV2,
> {
  createAttemptPort(input: {
    readonly declared: OwnerIntentDependenciesV2<K>
    readonly resolver: OwnerExternalFactResolverDefinitionV2<K>
  }): CreateOwnerExternalFactAttemptPortResultV2<K>
  readonly [ownerExternalFactPortFactoryBrandV2]: true
}

type InspectedOwnerIntentV2 =
  | Readonly<{ kind: "ordinary" }>
  | Readonly<{
      kind: "history"
      direction: "undo" | "redo"
      rootOperationId: Id128V2
    }>

interface OwnerHistoryMaterializationDefinitionV2<
  K extends DocumentOwnerKindV2,
> {
  discoverDependencies(input: {
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128V2
    readonly base: OwnerValidatedStateV2<K>
    readonly context: OwnerIntentConstructionContextV2
  }): OwnerIntentDependenciesV2<K> | "pending" | "rejected"
  materialize(input: {
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128V2
    readonly base: OwnerValidatedStateV2<K>
    readonly context: OwnerIntentConstructionContextV2
    readonly externalFacts: OwnerExternalFactPortV2<K>
  }): unknown | "pending" | "rejected"
}

interface OwnerHistoryMaterializationPortV2<
  K extends DocumentOwnerKindV2,
> extends OwnerHistoryMaterializationDefinitionV2<K> {
  readonly [ownerHistoryMaterializationPortBrandV2]: true
}

interface OwnerIntentClosureDefinitionV2<K extends DocumentOwnerKindV2> {
  inspectIntent(intent: unknown): InspectedOwnerIntentV2 | "rejected"
  discoverDependencies(input: {
    readonly context: OwnerIntentDependencyContextV2
    readonly intent: unknown
  }): OwnerIntentDependenciesV2<K> | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationDefinitionV2<K> | null
}

interface OwnerIntentClosurePortV2<K extends DocumentOwnerKindV2> {
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>
  inspectIntent(intent: unknown): InspectedOwnerIntentV2 | "rejected"
  discoverDependencies(input: {
    readonly context: OwnerIntentDependencyContextV2
    readonly intent: unknown
  }): OwnerIntentDependenciesV2<K> | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationPortV2<K> | null
  readonly [ownerIntentClosurePortBrandV2]: true
}

interface DocumentOwnerProtocolDefinitionV2<K extends DocumentOwnerKindV2> {
  readonly owner: K
  readonly schemaDigest: DigestV2
  readonly canonicalizerDescriptor: OwnerCanonicalizerDescriptorV2
  readonly canonicalizerDigest: DigestV2
  decodeIntent(exactJcs: Uint8Array): unknown | "rejected"
  validateBase(
    document: Y.Doc,
  ): OwnerValidatedStateV2<K> | "pending" | "rejected"
  applyIntent(
    candidate: Y.Doc,
    context: OwnerIntentValidationContextV2,
    intent: unknown,
    externalFacts: OwnerExternalFactPortV2<K>,
  ): OwnerApplyResultV2<K> | "pending" | "rejected"
  validatePost(
    base: OwnerValidatedStateV2<K>,
    candidate: Y.Doc,
    result: OwnerApplyResultV2<K>,
  ): OwnerValidatedStateV2<K> | "pending" | "rejected"
  canonicalStateBytes(document: Y.Doc): Uint8Array | "rejected"
  deriveActualWriteEvidence(result: OwnerApplyResultV2<K>): ActualWriteEvidenceV2
}

interface DocumentOwnerProtocolPortV2<K extends DocumentOwnerKindV2>
  extends DocumentOwnerProtocolDefinitionV2<K> {
  readonly [documentOwnerProtocolPortBrandV2]: true
}

interface SelectedDocumentOwnerArtifactDefinitionV2<
  K extends DocumentOwnerKindV2,
> {
  readonly owner: K
  createDefinitions(
    processValues: OwnerProcessValueFactoryV2<K>,
  ): Readonly<{
    protocol: DocumentOwnerProtocolDefinitionV2<K>
    closure: OwnerIntentClosureDefinitionV2<K>
  }>
}

interface DocumentOwnerRuntimeV2<K extends DocumentOwnerKindV2> {
  readonly artifactDigest: DigestV2
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>
  readonly closurePort: OwnerIntentClosurePortV2<K>
  readonly externalFactPortFactory: OwnerExternalFactPortFactoryV2<K>
  readonly [documentOwnerRuntimeBrandV2]: true
}

interface SelectedDocumentOwnerArtifactFactoryV2<
  K extends DocumentOwnerKindV2,
> {
  createRuntime(
    definition: SelectedDocumentOwnerArtifactDefinitionV2<K>,
  ): DocumentOwnerRuntimeV2<K> | Readonly<{
    status: "rejected"
    code:
      | "owner-definition-mismatch"
      | "owner-artifact-mismatch"
      | "owner-runtime-invalid"
  }>
  readonly [selectedDocumentOwnerArtifactFactoryBrandV2]: true
}
```

`unknown` above is a headless call boundary only: the owner returns one value from
its exact generated validator and never exposes an unvalidated object. The opaque
`OwnerValidatedStateV2`, `OwnerApplyResultV2`, process factories, runtimes, closure
ports and external-fact ports are nonportable process values. They cannot enter
structured clone, Y.Doc, frame, journal or digest. The owner may inspect only the
opaque `value` created through its exact captured process-value factory; cross-owner,
cross-artifact, structural, disposed or restarted values reject. Both resolver
methods are synchronous and attempt-scoped. `resolveArtifact` returns defensive
immutable bytes only for an exact declared validation artifact. `resolveFact`
returns an opaque owner-specific process value only for an exact declared
`{owner,kind,factDigest,request}` requirement. The nested `sha256` is ordinary
SHA-256 of the exact owner-defined restricted-JCS request bytes; each request is at
most 64 KiB, one dependency set contains at most 64 fact requirements and their
aggregate request bytes are at most 1 MiB. Kernel checks those limits, the hash and
defensive-copies the bytes but never decodes their owner schema. The selected owner
validates and brands the resolved value;
Kernel never decodes a Project, Canvas, Control or Plugin fact. Neither attempt-port
method performs I/O, discovery or execution. An asynchronous Project/host resolver
runs outside the document queue using the owner package's public request codec; a
pending fetch discards the attempt, and retry constructs a new in-memory resolver
over already verified results. The Kernel loader creates one
`OwnerExternalFactPortFactoryV2<K>` whose captured `K` is the selected owner; the
caller cannot choose or pass another owner. `createAttemptPort` first validates the
declared caps, strict order, uniqueness, exact request hashes and resolver owner. It
returns `created` only after all checks pass; `wrong-owner`, cap, order, duplicate or
invalid dependency returns the corresponding closed rejection with no port. The
created port rejects every undeclared requirement and records every consumption.
`consumedDependencies()` returns strict sorted duplicate-free defensive copies of
both sets.

`OwnerExternalFactRequirementV2<K>.kind` is an owner-closed NFC ASCII token matching
`^[a-z][a-z0-9.-]{0,127}$`. Requirements sort by owner, kind, decoded request
`sha256` and decoded fact digest.
Validation artifacts retain their independent sort. The discovered, declared and
apply-consumed `OwnerIntentDependenciesV2<K>` values must be byte-identical. For one
history attempt, Kernel first validates the latest `replicaDoc` and passes that exact
`OwnerValidatedStateV2<K>` object as `base` to both dependency discovery and
materialization; the owner cannot capture or observe a mutable document. The attempt
discovers dependencies from that base/root using the construction context, then
consumes exactly that set while producing the intent. A pending or stale-head retry
revalidates the then-latest `replicaDoc` and uses a new branded base object.
After encoding and hashing, ordinary intent discovery and apply consumption must be
byte-identical to the history set. A pending attempt retains no resolver, permit,
decoded value, materialized intent or consumed-set state.

The owner artifact exports only one unbranded
`SelectedDocumentOwnerArtifactDefinitionV2<K>`. It cannot construct or stamp a
Kernel runtime, port, factory or process value. The four-artifact bundle loader
constructs the branded `SelectedDocumentOwnerArtifactFactoryV2<K>`, its private
`OwnerProcessValueFactoryV2<K>` and `OwnerExternalFactPortFactoryV2<K>`.
`createRuntime` passes only the process-value factory into
`definition.createDefinitions`, verifies the exact owner/artifact/descriptor
closure, then wraps and registers the protocol, history, closure and runtime brands.
The resulting runtime's `closurePort.protocolPort` is object-identical to
`runtime.protocolPort`; its artifact digest equals the selected owner artifact and
its external-fact factory is the exact loader-created instance. Runtime, closure,
protocol, history, fact and process-value objects from different factory instances
never mix.

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

Owner artifacts define exact canonical bytes. The kernel never hashes JavaScript
object enumeration, Yjs internal structs or UI projection.

## 11. Replica and candidate documents

Each open shard has exactly one long-lived Y.Doc authority and one temporary role:

| Role | Construction | Durable authority | Permitted use |
| --- | --- | --- | --- |
| `replicaDoc` | retained checkpoint plus every final locally durable causal-frame closure known to this replica | yes | sole UI/Agent/Plugin projection, next local base, current merged state and checkpoint source |
| `candidateDoc` | isolated reconstruction or clone of one exact authored base | no | one owner transaction and validation only |

A successful local offline command creates its final replica-signed causal frame
immediately. The exact frame object, replication outbox reference, binary frame
journal record and sole durable head commit before the exact update enters
`replicaDoc`. Local authority never waits for a remote Peer, ACK, service sequence or
later conversion. Reconnect sends the same frame bytes; it never reruns the business
intent, reallocates an identity, rewrites a Yjs update or signs replacement bytes.

A local command clones current `replicaDoc` into one `candidateDoc`. Incoming-frame
validation reconstructs the frame's exact authored base from its dependency closure
inside a temporary `candidateDoc`; it never validates against arrival-order current
state. Every candidate:

1. receives exactly one decoded typed intent in one owner transaction;
2. uses a nonportable origin and the exact selected replica-derived client id;
3. validates schema, semantic guards, actual-write evidence and canonical post-state;
4. is destroyed on success, rejection, pending, cancellation or stale base;
5. never replaces `replicaDoc`.

A durable-head success followed by an in-memory apply failure enters
`read-only-recovery-required`; recovery reloads the retained checkpoint and exact
durable frame closure. It never reruns a durable side effect, allocates another
identity or signs replacement bytes. Any second long-lived team document,
additional business-command store, unsigned-update durable store or renderer
document store has
declaration count zero.

## 12. Generic persistence, journal and recovery ports

`@convax/collaboration` defines ordering, plain process contracts and validation.
The owner persistence adapter alone implements host-private storage, sole-writer
exclusion, atomic publication, durability and recovery scans. No host-private I/O
primitive appears in this annex.

```ts
interface FrameObjectRefV2 {
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly operationId: Id128V2
}

interface JournalAppendPortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
}

interface HeadCommitPortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly resultingReplicaHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
}

interface HeadCommitQuarantinePortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly observedReplicaHeadRecordDigest: DigestV2
  readonly quarantineCommitRecordDigest: DigestV2
  readonly shardDispositionHeadRecordDigest: DigestV2
}

type CompareAndCommitReplicaHeadPortResultV2 =
  | Readonly<{ status: "committed"; evidence: HeadCommitPortEvidenceV2 }>
  | Readonly<{ status: "quarantined"; evidence: HeadCommitQuarantinePortEvidenceV2 }>
  | Readonly<{
      status: "rejected"
      code: "durability-failed" | "store-corrupt"
    }>

interface CollaborationPersistencePortV2 {
  loadReplicaHead(scope: DocumentScopeV2): Promise<unknown>
  putImmutableFrame(ref: FrameObjectRefV2, exactBytes: Readonly<Uint8Array>): Promise<void>
  putReplicationOutboxRef(ref: FrameObjectRefV2): Promise<void>
  appendFrameJournal(ref: FrameObjectRefV2): Promise<JournalAppendPortEvidenceV2>
  compareAndCommitReplicaHead(input: {
    readonly ref: FrameObjectRefV2
    readonly journal: JournalAppendPortEvidenceV2
    readonly expectedReplicaHeadRecordDigest: DigestV2
    readonly resultingFrontierDigest: DigestV2
  }): Promise<CompareAndCommitReplicaHeadPortResultV2>
}
```

Kernel compares every committed mirror with the input ref, journal, expected head
and reloaded replica head before minting an internal replica-head receipt. For a
quarantine result it compares the observed head and reloaded disposition head before
minting the process-only quarantine receipt. Project/node returns only the plain
evidence above.

The observable barrier is exact:

```text
immutable frame
-> replication outbox ref
-> binary frame journal
-> compare-and-commit sole replica head
-> apply exact frame to replicaDoc
-> projection invalidation
-> ACK eligibility
```

A below-head object cannot transmit, project, checkpoint or ACK. Response-loss
lookup returns the exact prior durable frame or same-frame recovery state. Recovery
never replays the business command, reallocates sequence/operation identity or
re-signs a frame.

## 13. Incoming-frame validation and replica application

Incoming exact frame bytes pass this order before projection or durable ACK:

1. envelope magic, major, kind, flags, lengths, caps and raw hashes;
2. exact header JCS, protocol bundle, owner artifact and canonicalizer binding;
3. actor credential, replica reservation, edit authorization, cutoff and signature;
4. actor successor, operation uniqueness and equivocation checks;
5. complete dependency resolution and exact authored-base reconstruction;
6. base frontier, canonical state-vector bytes and owner canonical-state validation;
7. owner intent and guards on one isolated `candidateDoc`;
8. byte/canonical post-state, actual-write evidence and I-confluence validation;
9. immutable object, outbox, binary journal and sole replica-head durability barrier;
10. exact update application to `replicaDoc`;
11. projection invalidation and only then owner-selected ACK eligibility.

Missing dependencies remain bounded `dependency-pending`. Invalid bytes mutate no
document. A duplicate exact frame is idempotent. Concurrent valid frames merge into
`replicaDoc` only after validation against their respective authored causal bases.
Every owner intent family MUST be I-confluent or retain claims with a deterministic
effective projection; arrival-dependent acceptance, hidden central ordering and
post-hoc command replay are forbidden.

## 14. Session undo coordinator

```ts
interface SessionUndoCoordinatorV2 {
  recordDurableRoot(rootOperationId: Id128V2): void
  peekUndo(): { readonly rootOperationId: Id128V2; readonly cursorToken: Id128V2 } | null
  peekRedo(): { readonly rootOperationId: Id128V2; readonly cursorToken: Id128V2 } | null
  commitUndo(cursorToken: Id128V2, durableInverseOperationId: Id128V2): void
  commitRedo(cursorToken: Id128V2, durableForwardOperationId: Id128V2): void
  clear(reason:
    | "restart"
    | "rebuild"
    | "scope-change"
    | "unmount"
    | "quarantine"
    | "post-commit-cursor-failure"
  ): void
}
```

Only an owner-declared local root whose final signed frame crossed the replica-head
barrier and entered `replicaDoc` enters the session stack and clears redo. Remote
frames, hydration and recovery do not enter the stack; restart and rebuild clear it.
Peek never mutates state. The owner materializes a new semantic inverse or forward
typed intent against current `replicaDoc`, validates it in an isolated
`candidateDoc`, and moves the cursor only after the new final frame is durable and
applied. Remote replication is a later status transition and never moves the cursor.

There is no cross-restart undo. Raw `Y.UndoManager` updates, origin objects and stack
items never enter `candidateDoc`, `replicaDoc`, the binary frame journal, causal
frames, checkpoint bytes or wire.

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
| owner external-fact requirements | 64 |
| one / aggregate owner external-fact request JCS | 64 KiB / 1 MiB |
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
| `state-vector-limit` | local candidate is discarded before sign/write/head and `replicaDoc` remains readable/exportable; over-cap incoming bytes are invalid |
| `dependency-pending` | retain bounded exact bytes/ref; request dependency; no projection/ACK |
| `exact-base-unavailable` | read-only/pending; no newer-snapshot validation |
| `stale-local-head` | discard candidate and retry business intent only if caller still authorizes; never reuse signed bytes for another base |
| `equivocation-quarantine` | freeze actor fork/dependants and retain both proofs |
| `outbox-backpressure` | stop new mutation; retain/export locally durable frames |
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
9. the complete generic owner declaration surface from
   `OwnerIntentConstructionContextV2` through
   `SelectedDocumentOwnerArtifactFactoryV2<K>`, including raw owner definitions,
   generic fact requests/resolvers and attempt-port factory; a clean consumer
   resolves every symbol and each actual brand has one `unique symbol` declaration.

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

Fault injection stops after every observable object, outbox, journal, head,
in-memory apply and response barrier. It proves:

- no frame below the replica head transmits or projects;
- reopen completes the exact signed frame or quarantines read-only;
- no intent rerun, new operation/sequence/client id or replacement signature occurs;
- replica head durable/memory absent replays the exact frame;
- `{actorId,operationId}` returns the same original frame/result after response loss;
- durable ACK is impossible before object/journal/head durability and successful
  authoritative reconstruction/application;
- local success never waits for a remote ACK, and receiving or losing a remote ACK
  changes only replication metadata, never `replicaDoc`, frame bytes or undo state;
- restart reconstructs one `replicaDoc` from checkpoint plus durable frame closure,
  resumes the exact outbox bytes and starts with an empty undo/redo stack.

### 16.4 Clean package gate

`@convax/collaboration` must build, type-check, test, prepack and type-check every
public entry from a clean external consumer using only declared `yjs@13.6.31`.
Boundary scans reject imports of owner packages, UI runtimes, host-I/O modules,
concrete transports or service implementations. Declaration generation rejects an
unresolved identifier, ambient declaration dependency, duplicate brand, concrete
ingress kind/ACK literal or non-generic owner-port specialization.

## 17. Remote ingress capability chain

### 17.1 Generic kinds, reservation and completed staging

```ts
type OrdinarySha256V2 = DigestV2

declare const remoteIngressReservationReceiptBrandV2: unique symbol
declare const completedRemoteUpdateIngressBrandV2: unique symbol
declare const remoteIngressByteCursorBrandV2: unique symbol
declare const fullyValidatedRemoteIngressStagingBrandV2: unique symbol
declare const remoteImmutableIngressObjectReceiptBrandV2: unique symbol
declare const remoteNonFrameIngressOwnerInstallReceiptBrandV2: unique symbol
declare const remoteNonFrameIngressOwnerPortBrandV2: unique symbol
declare const remoteNonFrameIngressOwnerPortFactoryBrandV2: unique symbol
declare const durableReferenceScanProofBrandV2: unique symbol
declare const remoteIngressEvidenceAdmissionReceiptBrandV2: unique symbol
declare const remoteTransferAttemptBindingBrandV2: unique symbol
declare const remoteTransferAttemptBindingFactoryBrandV2: unique symbol

interface StableRemoteTransferKeyV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly transferId: Id128V2
}

type RemoteIngressKindV2 = string
type RemoteIngressAckAuthorityV2 = string

type UpdateIngressChunkBytesV2 =
  | "4096" | "8192" | "16384" | "32768"
  | "65536" | "131072" | "262144"

interface RemoteIngressQuotaReservationPortEvidenceV2 {
  readonly limitsDigest: DigestV2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly sourceMemberId: MemberIdV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
  readonly resultingProjectChargedClosureCount: Uint32V2
  readonly resultingProjectAccountedAdmissionByteLength: Uint64V2
  readonly resultingSourceMemberChargedClosureCount: Uint32V2
  readonly resultingSourceMemberAccountedAdmissionByteLength: Uint64V2
  readonly admissionEpochHeadRecordDigest: DigestV2
  readonly admissionTransitionRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
}

interface RemoteIngressReservationPortEvidenceV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly currentChunkSetHeadRecordDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
  readonly quota: RemoteIngressQuotaReservationPortEvidenceV2
}

interface RemoteIngressReservationReceiptV2
  extends RemoteIngressReservationPortEvidenceV2 {
  readonly [remoteIngressReservationReceiptBrandV2]: true
}

interface ReserveRemoteIngressRequestV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
}

interface RemoteIngressCompletedStagingEvidenceV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly finalChunkSetHeadRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
  readonly quota: RemoteIngressQuotaReservationPortEvidenceV2
}

interface CompletedRemoteUpdateIngressV2<
  K extends RemoteIngressKindV2,
> {
  readonly evidence: RemoteIngressCompletedStagingEvidenceV2 & {
    readonly kind: K
  }
  openSequentialCursor(): Promise<RemoteIngressByteCursorV2>
  readonly [completedRemoteUpdateIngressBrandV2]: true
}

type ReserveRemoteIngressPortResultV2 =
  | Readonly<{
      status: "reserved"
      evidence: RemoteIngressReservationPortEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "manifest-mismatch"
        | "authorization-closed"
        | "capacity-exceeded"
        | "durability-failed"
        | "store-corrupt"
    }>

type CompleteRemoteIngressStagingPortResultV2 =
  | Readonly<{
      status: "complete"
      evidence: RemoteIngressCompletedStagingEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "transfer-incomplete"
        | "length-mismatch"
        | "hash-mismatch"
        | "durability-failed"
        | "store-corrupt"
    }>

interface RemoteIngressStagingPersistencePortV2 {
  reserveRemoteIngress(
    request: ReserveRemoteIngressRequestV2,
  ): Promise<ReserveRemoteIngressPortResultV2>
  completeRemoteIngressStaging(
    reservation: RemoteIngressReservationReceiptV2,
  ): Promise<CompleteRemoteIngressStagingPortResultV2>
  openRemoteIngressSequentialCursor(
    evidence: RemoteIngressCompletedStagingEvidenceV2,
  ): Promise<OpenRemoteIngressSequentialCursorPortResultV2>
}
```

`RemoteIngressKindV2` and `RemoteIngressAckAuthorityV2` are generic scalar bounds,
not registries or concrete unions. A selected owner closes each to one NFC ASCII
literal matching `^[a-z][a-z0-9-]{0,127}$`; Kernel compares byte identity and never
interprets a token. Empty, non-ASCII, overlong or dynamically registered values
reject before reservation.

Reservation and completion persistence return only plain evidence. Kernel compares
every stable-key, manifest, closure, record-head, kind, scope, subject, SHA, length
and chunk mirror against the authenticated offer and its private registry before
minting either brand. The Kernel-constructed reservation request copies the exact
accounted closure length from that authenticated offer; it is never supplied by an
owner or transport caller and cannot be smaller than `declaredByteLength`.

The nested quota evidence is also plain. Its `limitsDigest`, stable key, manifest,
kind, source member, charged count and accounted bytes must equal the request and
the exact current bundle. The resulting Project-epoch totals must be at most
`8192` objects and `536870912` bytes; the resulting source-member totals must be at
most `512` objects and `134217728` bytes. Boundary values are accepted; every +1
case rejects before staging allocation and yields no reservation brand. Exact
stable-key/manifest reconnect reuses the existing reservation, writer and quota
charge; it cannot increment a total. Completion and immutable-object evidence must
carry the byte-identical quota object. Kernel treats quota record digests as opaque
persistence mirrors and defines no Project-native map, path, COW or recovery logic.
Stale, corrupt, incomplete, over-limit or mismatched evidence produces no
capability and no ACK.

### 17.2 Sequential cursor bridge

```ts
type RemoteIngressByteCursorReadV2 =
  | Readonly<{
      status: "chunk"
      chunkIndex: Uint32V2
      byteOffset: Uint64V2
      exactByteLength: Uint32V2
      exactChunkSha256: OrdinarySha256V2
      exactChunkBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "complete"
      exactByteLength: Uint64V2
      ordinarySha256: OrdinarySha256V2
    }>

interface RemoteIngressSequentialCursorPortHandleV2 {
  nextPersistedChunk(): Promise<RemoteIngressByteCursorReadV2>
  closePersistedCursor(): void
}

type OpenRemoteIngressSequentialCursorPortResultV2 =
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

interface RemoteIngressByteCursorV2 {
  next(): Promise<RemoteIngressByteCursorReadV2>
  close(): void
  readonly [remoteIngressByteCursorBrandV2]: true
}
```

The Project/node handle is unbranded. Kernel binds it to one live completed
capability and alone wraps it with `RemoteIngressByteCursorV2`. A cursor starts at
offset zero, advances by exact contiguous index and offset, yields one persisted
chunk per call, and closes permanently on complete, explicit close, exception,
pending, rejection or cancellation. At most one handle is live for one completed
capability. Random reads, complete-transfer byte arrays and host-private resource
handles have declaration count zero.

### 17.3 Owner validation and immutable object durability

```ts
interface RemoteIngressOwnerValidationEvidenceV2<
  K extends RemoteIngressKindV2,
> {
  readonly kind: K
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
}

interface FullyValidatedRemoteIngressStagingV2<
  K extends RemoteIngressKindV2,
> {
  readonly completed: CompletedRemoteUpdateIngressV2<K>
  readonly ownerArtifactDigest: DigestV2
  readonly [fullyValidatedRemoteIngressStagingBrandV2]: true
}

interface RemoteImmutableIngressObjectPortEvidenceV2<
  K extends RemoteIngressKindV2,
> {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly finalChunkSetHeadRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly kind: K
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly immutableObjectDigest: DigestV2
  readonly quota: RemoteIngressQuotaReservationPortEvidenceV2
}

interface RemoteImmutableIngressObjectReceiptV2<
  K extends RemoteIngressKindV2,
> extends RemoteImmutableIngressObjectPortEvidenceV2<K> {
  readonly [remoteImmutableIngressObjectReceiptBrandV2]: true
}

type PutImmutableCompletedRemoteIngressPortResultV2<
  K extends RemoteIngressKindV2,
> =
  | Readonly<{
      status: "durable"
      evidence: RemoteImmutableIngressObjectPortEvidenceV2<K>
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-completed-staging"
        | "mirror-mismatch"
        | "durability-failed"
        | "store-corrupt"
    }>

interface RemoteIngressImmutableObjectPersistencePortV2 {
  putImmutableCompletedRemoteIngress<K extends RemoteIngressKindV2>(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
  ): Promise<PutImmutableCompletedRemoteIngressPortResultV2<K>>
}
```

The selected validator streams through the branded sequential cursor. Project/node
admits only the already completed staging object into immutable storage and returns
`RemoteImmutableIngressObjectPortEvidenceV2<K>`. Kernel compares every mirror with
reservation, completion, validation and manifest facts, registers the immutable
object and alone mints the receipt. The receipt proves durable immutable bytes only;
it never proves owner installation, currentness or ACK eligibility.

### 17.4 Generic owner installation

```ts
interface RemoteIngressOwnerAckBindingV2<
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly authority: A
  readonly evidenceDigest: DigestV2 | null
}

interface RemoteIngressQuotaTransferPortEvidenceV2<
  K extends RemoteIngressKindV2,
> {
  readonly limitsDigest: DigestV2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly kind: K
  readonly sourceMemberId: MemberIdV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
  readonly resultingProjectChargedClosureCount: Uint32V2
  readonly resultingProjectAccountedAdmissionByteLength: Uint64V2
  readonly resultingSourceMemberChargedClosureCount: Uint32V2
  readonly resultingSourceMemberAccountedAdmissionByteLength: Uint64V2
  readonly priorAdmissionEpochHeadRecordDigest: DigestV2
  readonly resultingAdmissionEpochHeadRecordDigest: DigestV2
  readonly chargeTransferBindingRecordDigest: DigestV2
  readonly replacementKind: "owner-install"
  readonly replacementRootRecordDigest: DigestV2
  readonly replacementRootHeadRecordDigest: DigestV2
}

interface RemoteIngressOwnerInstallEvidenceV2<
  K extends RemoteIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly kind: K
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly ownerHeadRecordDigest: DigestV2
  readonly ackBinding: RemoteIngressOwnerAckBindingV2<A>
  readonly quotaTransfer: RemoteIngressQuotaTransferPortEvidenceV2<K>
}

type RemoteIngressOwnerInstallResultV2<
  K extends RemoteIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> =
  | Readonly<{
      status: "installed"
      evidence: RemoteIngressOwnerInstallEvidenceV2<K, A>
    }>
  | Readonly<{
      status: "pending"
      code: "owner-install-pending"
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "authorization-closed"
        | "durability-failed"
        | "store-corrupt"
        | "owner-ack-binding-mismatch"
        | "owner-quota-transfer-invalid"
    }>

interface RemoteNonFrameIngressOwnerInstallReceiptV2<
  K extends RemoteIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly kind: K
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly ownerHeadRecordDigest: DigestV2
  readonly ackBinding: RemoteIngressOwnerAckBindingV2<A>
  readonly quotaTransfer: RemoteIngressQuotaTransferPortEvidenceV2<K>
  readonly [remoteNonFrameIngressOwnerInstallReceiptBrandV2]: true
}

interface RemoteNonFrameIngressOwnerPortDefinitionV2<
  K extends RemoteIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly kind: K
  readonly ackAuthority: A
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly ownerAuthorityIdentity: object
  validate(
    completed: CompletedRemoteUpdateIngressV2<K>,
  ): Promise<
    | Readonly<{
        status: "validated"
        evidence: RemoteIngressOwnerValidationEvidenceV2<K>
      }>
    | Readonly<{ status: "pending"; code: "owner-dependency-pending" }>
    | Readonly<{
        status: "rejected"
        code: "owner-validation-rejected" | "authorization-closed"
      }>
  >
  install(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
    object: RemoteImmutableIngressObjectReceiptV2<K>,
  ): Promise<RemoteIngressOwnerInstallResultV2<K, A>>
}

interface RemoteNonFrameIngressOwnerPortV2<
  K extends RemoteIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly kind: K
  readonly ackAuthority: A
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  validate(
    completed: CompletedRemoteUpdateIngressV2<K>,
  ): Promise<
    | Readonly<{
        status: "validated"
        evidence: RemoteIngressOwnerValidationEvidenceV2<K>
      }>
    | Readonly<{ status: "pending"; code: "owner-dependency-pending" }>
    | Readonly<{
        status: "rejected"
        code: "owner-validation-rejected" | "authorization-closed"
      }>
  >
  install(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
    object: RemoteImmutableIngressObjectReceiptV2<K>,
  ): Promise<RemoteIngressOwnerInstallResultV2<K, A>>
  readonly [remoteNonFrameIngressOwnerPortBrandV2]: true
}

interface RemoteNonFrameIngressOwnerPortFactoryV2 {
  createOwnerPort<
    K extends RemoteIngressKindV2,
    A extends RemoteIngressAckAuthorityV2,
  >(
    definition: RemoteNonFrameIngressOwnerPortDefinitionV2<K, A>,
  ): RemoteNonFrameIngressOwnerPortV2<K, A>

  mintOwnerInstallReceipt<
    K extends RemoteIngressKindV2,
    A extends RemoteIngressAckAuthorityV2,
  >(input: {
    readonly selectedPort: RemoteNonFrameIngressOwnerPortV2<K, A>
    readonly object: RemoteImmutableIngressObjectReceiptV2<K>
    readonly result: RemoteIngressOwnerInstallResultV2<K, A>
  }): RemoteNonFrameIngressOwnerInstallReceiptV2<K, A> | Readonly<{
    status: "rejected"
    code:
      | "owner-ack-binding-mismatch"
      | "owner-install-mirror-mismatch"
      | "owner-quota-transfer-mismatch"
  }>

  readonly [remoteNonFrameIngressOwnerPortFactoryBrandV2]: true
}
```

The factory's private registry binds the exact definition, selected port, owner
authority identity, kind, `A`, protocol digest and owner artifact. Before minting a
receipt Kernel requires exact equality of evidence kind, immutable-object digest,
owner records and conditional ACK-binding kind with the selected port, immutable
receipt and `ackAuthority`. It additionally requires a quota transfer from that
object's exact reservation charge to `replacementKind="owner-install"`: stable key,
manifest, kind, member, bundle limits digest, charged count, accounted bytes and all
four resulting totals remain byte-identical, the prior admission head equals the
registered reservation head, and the resulting head, transfer binding and
replacement root/head digests are non-null. The transfer never drops the charge to
zero and never increments it. Kernel validates mirrors and the four numeric caps but
does not decode or prescribe the owner's native records. Structural, cross-factory,
disposed, restarted, over-limit or mismatched values return the dedicated rejection
with zero receipt and zero ACK.

### 17.5 Owner-selected terminal policy

Kernel never enumerates a concrete ingress kind, ACK authority, route or carrier.
The selected owner supplies one literal `K`, one literal `A` and their closed
semantic policy through its package-owned protocol. Kernel binds those exact values
through the generic `<K,A>` factory and verifies plain persistence mirrors; it does
not decide whether a kind ACKs, construct an ACK body or interpret
`evidenceDigest`. An immutable receipt or owner-install receipt alone never ACKs.

### 17.6 Plain quarantine, scan fence and GC commands

```ts
interface DurableReferenceScanPortEvidenceV2 {
  readonly proofKind: "first-scan" | "second-scan"
  readonly priorProofRecordDigest: DigestV2 | null
  readonly ref: FrameObjectRefV2
  readonly proofRecordDigest: DigestV2
  readonly replicaHeadRecordDigest: DigestV2
  readonly referenceIndexHeadRecordDigest: DigestV2
  readonly referenceIndexGeneration: Uint64V2
  readonly referenceIndexRootRecordDigest: DigestV2
  readonly referenceIndexRootPageDigest: DigestV2 | null
  readonly coverageRecordDigest: DigestV2
  readonly durableReferenceCount: Uint64V2
  readonly reachableFromReplicaHead: boolean
  readonly storeGeneration: Uint64V2
}

interface DurableReferenceScanProofV2 {
  readonly proofKind: "first-scan" | "second-scan"
  readonly ref: FrameObjectRefV2
  readonly proofRecordDigest: DigestV2
  readonly [durableReferenceScanProofBrandV2]: true
}

interface PublishDurableReferenceScanFenceCommandV2 {
  readonly scanOperationId: Id128V2
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly expectedScanRecoveryHeadRecordDigest: DigestV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly expectedStoreGeneration: Uint64V2
  readonly expectedReferenceIndexHeadRecordDigest: DigestV2
  readonly expectedReferenceIndexGeneration: Uint64V2
  readonly expectedReferenceIndexRootRecordDigest: DigestV2
  readonly expectedCoverageRecordDigest: DigestV2
}

interface DurableReferenceScanFencePortEvidenceV2 {
  readonly scanOperationId: Id128V2
  readonly firstProofRecordDigest: DigestV2
  readonly fencePreparationRecordDigest: DigestV2
  readonly fenceCommitRecordDigest: DigestV2
  readonly priorScanRecoveryHeadRecordDigest: DigestV2
  readonly resultingScanRecoveryHeadRecordDigest: DigestV2
  readonly resultingStoreGeneration: Uint64V2
  readonly resultingReferenceIndexGeneration: Uint64V2
}

interface IssueGarbageCollectFrameObjectCommandPortEvidenceV2 {
  readonly scanOperationId: Id128V2
  readonly priorSecondProofRecoveryHeadRecordDigest: DigestV2
  readonly gcCommandRecordDigest: DigestV2
  readonly resultingGcCommandRecoveryHeadRecordDigest: DigestV2
}

interface GarbageCollectFrameObjectPersistenceCommandV2 {
  readonly scanOperationId: Id128V2
  readonly priorSecondProofRecoveryHeadRecordDigest: DigestV2
  readonly gcCommandRecordDigest: DigestV2
  readonly resultingGcCommandRecoveryHeadRecordDigest: DigestV2
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

type DurableReferenceScanPortResultV2 =
  | Readonly<{
      status: "complete"
      evidence: DurableReferenceScanPortEvidenceV2
    }>
  | Readonly<{
      status: "incomplete"
      code:
        | "coverage-gap"
        | "scan-invalidated"
        | "unsupported-record"
        | "store-corrupt"
    }>

type PublishDurableReferenceScanFencePortResultV2 =
  | Readonly<{
      status: "durable"
      evidence: DurableReferenceScanFencePortEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code: "scan-invalidated" | "mirror-mismatch" | "store-corrupt"
    }>

type IssueGarbageCollectFrameObjectCommandPortResultV2 =
  | Readonly<{
      status: "issued"
      evidence: IssueGarbageCollectFrameObjectCommandPortEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code: "scan-invalidated" | "mirror-mismatch" | "store-corrupt"
    }>

type GarbageCollectFrameObjectPortResultV2 =
  | Readonly<{
      status: "deleted"
      terminalRecordDigest: DigestV2
    }>
  | Readonly<{
      status: "not-deleted"
      code:
        | "reference-proof-stale"
        | "reference-present"
        | "replica-head-reachable"
        | "store-corrupt"
    }>

interface DurableReferencePersistencePortV2 {
  scanDurableReferences(input: {
    readonly ref: FrameObjectRefV2
    readonly proofKind: "first-scan" | "second-scan"
    readonly priorProofRecordDigest: DigestV2 | null
  }): Promise<DurableReferenceScanPortResultV2>
  publishScanFence(
    command: PublishDurableReferenceScanFenceCommandV2,
  ): Promise<PublishDurableReferenceScanFencePortResultV2>
  issueGarbageCollectCommand(input: {
    readonly first: DurableReferenceScanProofV2
    readonly second: DurableReferenceScanProofV2
    readonly fence: DurableReferenceScanFencePortEvidenceV2
  }): Promise<IssueGarbageCollectFrameObjectCommandPortResultV2>
  garbageCollectFrameObject(
    command: GarbageCollectFrameObjectPersistenceCommandV2,
  ): Promise<GarbageCollectFrameObjectPortResultV2>
}
```

Kernel validates plain scan evidence and mints short-lived process proof brands.
After the first proof it sends one plain fence command. Project/node returns plain
fence evidence; Kernel verifies every mirror and registers the fence. After a
strictly later second proof Kernel atomically consumes both proof brands, the exact
fence and one private GC authorization, obtains plain command-issue evidence, and
sends only `GarbageCollectFrameObjectPersistenceCommandV2`.

The branded GC authorization never crosses the Kernel module boundary. Host
recovery heads, record formats, resource mapping and physical deletion remain
exclusively in the owner persistence adapter. Any changed head, generation, root, coverage, source head or
recovery head yields terminal not-deleted and deletes zero frame objects.

## 18. Project-epoch evidence admission

### 18.1 Commands and monotonic authority seam

```ts
interface RemoteIngressEvidenceMissingObjectV2 {
  readonly objectDigest: DigestV2
  readonly byteLength: Uint64V2
}

interface BeginRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "reserve"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2 | null
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2 | null
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly prospectiveClosureRecordExactJcs: Readonly<Uint8Array>
  readonly admissionStartMissingObjects: readonly RemoteIngressEvidenceMissingObjectV2[]
}

interface SettleRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "settle"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
}

interface AbandonRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "abandon-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
  readonly abandonmentReason:
    | "authorization-closed"
    | "caller-cancelled"
    | "evidence-capacity-exceeded"
}

interface TransferRemoteIngressEvidenceAdmissionChargeCommandV2 {
  readonly transition: "transfer-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly chargeTransferBindingRecordDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
}

type AdvanceRemoteIngressEvidenceAdmissionCommandV2 =
  | SettleRemoteIngressEvidenceAdmissionCommandV2
  | AbandonRemoteIngressEvidenceAdmissionCommandV2
  | TransferRemoteIngressEvidenceAdmissionChargeCommandV2
```

Every command requires
`sourceMemberId = authenticatedSourceMemberId = stableKey.sourceMemberId` before
lookup or persistence. Stable-key, member and Project-epoch attempt counts increase
monotonically. Kernel owns commands and validation; Project/node owns the native COW
maps, records, checkpoints and sole epoch-head publication.

### 18.2 Plain transition evidence and Kernel receipt

```ts
type RemoteIngressEvidenceAdmissionTransitionV2 =
  | "reserve"
  | "settle"
  | "abandon-release"
  | "transfer-release"

interface RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2 {
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
  readonly idempotent: boolean
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly transitionRecordDigest: DigestV2
  readonly epochHeadRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
  readonly stableKeyMonotonicAttemptCount: Uint32V2
  readonly memberMonotonicAttemptCount: Uint32V2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly stableKeyChargedClosureCount: Uint32V2
  readonly memberChargedClosureCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly memberAccountedAdmissionByteLength: Uint64V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}

interface RemoteIngressEvidenceAdmissionReceiptV2 {
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
  readonly epochHeadRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
  readonly [remoteIngressEvidenceAdmissionReceiptBrandV2]: true
}

type RemoteIngressEvidenceAdmissionPortResultV2 =
  | Readonly<{
      status: "committed"
      evidence: RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "head-stale"
        | "identity-mismatch"
        | "quota-exceeded"
        | "transition-invalid"
        | "durability-failed"
        | "store-corrupt"
    }>

interface RemoteIngressEvidenceAdmissionPersistencePortV2 {
  begin(
    command: BeginRemoteIngressEvidenceAdmissionCommandV2,
  ): Promise<RemoteIngressEvidenceAdmissionPortResultV2>
  advance(
    command: AdvanceRemoteIngressEvidenceAdmissionCommandV2,
  ): Promise<RemoteIngressEvidenceAdmissionPortResultV2>
  loadCurrentEpochHeadDigest(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
  }): Promise<DigestV2>
}
```

Project/node returns only plain transition evidence. Kernel reloads the current epoch
head through its port, validates every identity, counter, charge and digest mirror,
then alone mints the process receipt. Per-stable-key and per-member mutable head
pointers, Project/node-minted brands and evidence-only admission have declaration
count zero.

### 18.3 Metadata-GC isolation

Admission metadata collection is a Project/node concern. Kernel may issue only a
plain command after consuming its own registered admission receipt and exact
terminal evidence. Metadata records create no frame-reference-index edge, grant no
Canvas or Project authority and cannot authorize frame deletion. Native metadata
recovery results never satisfy ingress installation, carrier currentness or ACK.

## 19. Generic transfer-attempt binding

### 19.1 Process identity

```ts
interface RemoteTransferAttemptBindingV2<
  K extends RemoteIngressKindV2,
> {
  readonly kind: K
  readonly stableKey: StableRemoteTransferKeyV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly [remoteTransferAttemptBindingBrandV2]: true
}

interface RemoteTransferAttemptBindingFactoryV2 {
  bind<K extends RemoteIngressKindV2>(input: {
    readonly kind: K
    readonly stableKey: StableRemoteTransferKeyV2
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly sourceMemberId: MemberIdV2
    readonly exactManifestDigest: DigestV2
    readonly subjectDigest: DigestV2
  }): RemoteTransferAttemptBindingV2<K>
  readonly [remoteTransferAttemptBindingFactoryBrandV2]: true
}
```

Only Kernel's live factory creates this process identity from the authenticated
manifest and selected transfer. Structural copies, cross-runtime values, replaced
connections, disposed factories and restarted processes reject.

### 19.2 ACK ownership seam

The binding grants no ACK. The selected owner package owns its carrier receipt,
currentness gate, attempt key and ACK outbox contract. The host composition edge
owns connection routing and exact message construction. Kernel declares no concrete
attempt key, `queryAttempt`, carrier kind or ACK state. No caller passes ACK bytes, a
Peer body, connection id, transfer id, signature or durability proof to Kernel.

## 20. Native recovery and deletion isolation

### 20.1 Project/node-only facts

Admission publication recovery heads, metadata-GC candidate/tombstone records,
ten-kind native location maps, trusted root handles, descriptor-relative traversal,
no-follow validation, same-entry conditional deletion and directory durability are
Project/node-only. They are neither protocol domains nor Kernel API declarations.

### 20.2 Zero-authority rules

A native recovery or deletion result:

- does not mutate `replicaDoc` or `candidateDoc`;
- does not create or validate a causal frame;
- does not mint a reservation, immutable, owner-install, admission, quarantine,
  scan-proof or attempt-binding brand;
- does not satisfy Project currentness or terminal ACK;
- does not add a protocol domain merely because a native record has a format token.

No host-private resource locator, I/O handle, traversal primitive, durability
primitive, wall clock or machine identifier crosses a collaboration port.

## 21. Closed owner counts and conformance

### 21.1 Declaration counts

| Declaration family | Sole owner | Count |
| --- | --- | ---: |
| replica/candidate lifecycle | collaboration | 1 |
| generic ingress scalar, cursor and completed capability | collaboration | 1 |
| reservation/immutable/install brands and factories | collaboration | 1 |
| `<K,A>` owner-port and ACK-binding chain | collaboration | 1 |
| admission commands, receipt factory and process registry | collaboration | 1 |
| scan proof/fence/GC command validator | collaboration | 1 |
| transfer-attempt binding | collaboration | 1 |
| Project-native records and persistence adapters | project/node | 1 |
| owner-specific currentness, kind and ACK gate | selected owner | 1 per owner contract |
| concrete transport and connection routing | desktop | 1 |

The following counts are zero: branded evidence minted by Project/node; a branded GC
authorization passed to persistence; an immutable receipt used as ACK; a plain
evidence value used as a capability; a document-wide version or global revision
token; full-state replacement; a renderer document authority; a second long-lived
Y.Doc; an online central edit order; an ambient owner registry; a Kernel-owned
concrete ingress kind, ACK literal, route matrix, attempt key or `queryAttempt`.

### 21.2 Mandatory falsifiers

A candidate fails closure if any test can:

1. construct an owner-install receipt whose `A` differs from the selected port;
2. mint any Kernel brand from structural or Project/node-returned data without the
   Kernel factory and private registry;
3. ACK any `K` before the selected owner's exact `<K,A>` installation/currentness
   policy succeeds;
4. checkpoint, transmit or ACK a `candidateDoc`;
5. mutate `replicaDoc` through raw Yjs update or full-state replacement input;
6. keep a cursor alive after a terminal path or open two cursors for one completed
   staging object;
7. reserve at Project totals `8193` objects or `536870913` bytes, source-member
   totals `513` objects or `134217729` bytes, double-charge an exact reconnect, or
   transfer an owner-install charge with changed count/bytes;
8. obtain a fact port for another owner, obtain any port from malformed, over-cap,
   duplicate or unsorted dependencies, or mix discovered/declared/consumed
   `OwnerIntentDependenciesV2<K>` across distinct `K` values;
9. delete a frame after a changed head, generation, root, coverage or recovery head;
10. expose concrete transport, owner schema or host-I/O imports from the
   clean packed collaboration package;
11. retain ancestry metadata, approval prose, a placeholder digest, duplicate
   declaration or unresolved marker in this standalone annex;
12. produce different restricted-JCS, Yjs, frame, owner-port or evidence results in
    Bun, Chromium and an isolated verifier.
