# Owner canonicalizer and Project closure normative patch proposal

Date: 2026-08-01

Status: **non-authoritative normative patch proposal; implementation prohibited**

Author: `/root/project_local_fork`

This file is a mechanically transplantable patch proposal. It does not modify,
supersede or become a fallback for any pinned authority file. Its clauses use
`MUST`, `MUST NOT`, `SHOULD` and `MAY` normatively only if the complete patch is
transplanted into the exact owner artifacts, all generated bundle identities are
recomputed, and three independent architecture reviewers sign the same resulting
bytes. No implementation work is authorized by this proposal.

The reset-identity and initiator-acceptance rulings in section 8 are already 3/3
architecture decisions. The transplant may correct wording around those rulings,
but MUST NOT reopen the selected identity model, weaken it to raw `Id128V2`, admit a
viewer or pending editor, rename the field to create a second identity, or add a
compatibility union.

## 1. Exact source authority inspected

This proposal was derived from these exact current bytes:

| Authority | Whole-file SHA-256 |
| --- | --- |
| `docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md` | `6fa3b6d0c7cedbe1bfc52a04422f060edb453639d4713d9d47e659a483c3b721` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md` | `f258bbab3d85ad54cd2f023ef4e1f135deb2a87c3b473725ca6ab5bf7641b099` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-collaboration-kernel-appendix.md` | `577a54fbaaab29004fd4182d9980020235e4118ff55a1030c8cf5a0942ab1186` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md` | `7df4f62a61495273960f5f640b8892d1480e09c617d1e3303931703e89f1b2ac` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md` | `33d925f80e28615271cbd59b518779f47ded5494050d119c0cda04dc7e9ff857` |

The source bundle has 89 registered domains and portable
`ProtocolSchemaBundleV2.coreDigest` / `protocolDigest`
`e37edd84c576d2ce8fbb983f29b34d5e78fe0d6578af30f93c7ffb91d41b43ad`.
Those identities describe the flawed input, not the proposed output.

## 2. Defects closed by this patch

The current authority has two P0 closure failures and two incomplete derived-state
or identity contracts:

1. Kernel frames bind `canonicalizerDigest`, but the kernel defines no closed
   canonicalizer descriptor or digest preimage. An implementation can therefore
   assign the same name to different algorithms or invent an unreviewed digest.
2. Project defines a private `convax.project-index-canonical-state/2` hash while the
   kernel separately requires `convax.canonical-state/2`. The Project owner does not
   return exact bytes from a closed `ProjectCanonicalStateV2`, so the two digests are
   parallel authorities over an underspecified object.
3. Project guards, manifests and actual-write evidence name projection/value
   digests without closing all of their value shapes and preimages. This permits
   independently reasonable implementations to disagree about route, file,
   conflict and write identity.
4. Project reset claim fields use raw `Id128V2` for member/replica identities even
   though control confirmation and active credentials use nominal `MemberIdV2` and
   `ReplicaIdV2`. A raw 128-bit value cannot even encode the canonical
   `replica_XXXXXXXX` scalar.

The flaw types are respectively **missing protocol definition**, **duplicate
authority**, **implicit serialization assumption**, and **fact/type contradiction**.
They are not Yjs convergence issues and cannot be repaired by arrival ordering,
document-wide version checks or implementation convention.

## 3. Kernel-owned canonicalizer descriptor

### 3.1 Closed descriptor and scalar constraints

Add this kernel-owned closed shape beside `DocumentOwnerKindV2`:

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

### 3.2 Exact digest domain and preimage

Add the kernel-owned domain:

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

### 3.3 Owner port and frame binding

Replace the descriptor-less portion of `DocumentOwnerProtocolPortV2` with:

```ts
interface DocumentOwnerProtocolPortV2 {
  readonly owner: DocumentOwnerKindV2
  readonly schemaDigest: DigestV2
  readonly canonicalizerDescriptor: OwnerCanonicalizerDescriptorV2
  readonly canonicalizerDigest: DigestV2
  // existing methods remain, including canonicalStateBytes(document)
}
```

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

The existing kernel canonical-state digest remains the sole portable state digest:

```text
canonicalStateDigest = SHA-256(
  UTF8("convax.canonical-state/2") || 0x00 ||
  decoded-32-byte(ownerSchemaDigest) || 0x00 ||
  exact canonicalStateBytes
)
```

The source appendix currently writes the first domain and NUL as one ASCII literal;
the expanded form above is byte-identical. `ownerSchemaDigest` is decoded 32-byte
hex, not its 64-byte spelling. `canonicalizerDigest` is bound separately in
`CausalEditCoreV2`; it is not folded into this digest and MUST NOT be omitted from
the frame.

## 4. Exact Project and Canvas canonicalizer binding

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
section 3 digest of exactly this constructed descriptor.

This constructor is an artifact-digest template, not executable source identity.
Whitespace, function names and implementation language never enter the digest.

The Canvas artifact MUST instantiate the same kernel-owned descriptor and port; it
MUST NOT retain `CanvasCanonicalizerDescriptorV2` or the
`convax.canvas-canonicalizer/2` digest domain:

```ts
function canvasCanonicalizerDescriptorV2(
  schemaDigest: DigestV2,
): OwnerCanonicalizerDescriptorV2 {
  return {
    format: "convax.owner-canonicalizer-descriptor/2",
    owner: "canvas",
    ownerSchemaDigest: schemaDigest,
    canonicalStateFormat: "convax.canvas-canonical-state/2",
    canonicalStateCodec: "restricted-jcs-utf8",
    exactBytePolicy: "parse-reencode-byte-equal",
    unknownStatePolicy: "reject",
  }
}
```

The Canvas artifact's exact named root, child-map tuple, slot codecs, sort rules,
null rules and extraction algorithm remain normative owner-artifact bytes and are
therefore bound by `ownerSchemaDigest`; they are not copied into a second descriptor.
Canvas and Project each provide `canonicalStateBytes(document)`, but the kernel
validates both through the one `DocumentOwnerProtocolPortV2` above. No owner may
keep the former descriptor-less port as an alternate runtime path.

## 5. `ProjectCanonicalStateV2` and nine-root byte encoding

### 5.1 Exact closed value

Replace the current prose-only Project canonical hash object with this exact owner
value:

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

### 5.2 Root/map/slot matrix

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

### 5.3 Exact bytes and sole canonical digest

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

### 5.4 Exact genesis identity

V2 defines no parallel `projectGenesisDigest`. An exact ProjectIndex genesis is the
`ProjectCanonicalStateV2` that satisfies all of these predicates:

- `identity` has the one exact `project` record for the new scope and selected
  protocol/schema/URI digests;
- `entries` has exactly the root-directory entry named by identity, with provenance
  `project-root`, directory policy/storage invariants and no other entry;
- the remaining six fact maps and `operations` are empty arrays;
- the root directory has no location or tombstone fact.

The **genesis digest is exactly the section 5.3 canonical-state digest of that
value**. `EmptyProjectIndexGenesisAttestationCoreV2.canonicalStateDigest`,
`ProjectResetManifestV2.emptyProjectIndexCanonicalStateDigest` and
`TeamEpochRolloverReceiptCoreV2.emptyProjectIndexCanonicalStateDigest` MUST all equal
it. A separate Project genesis domain or hash alias is forbidden because it would
restore the duplicate-authority defect.

## 6. Project derived-digest ledger

This section replaces every undefined phrase such as "projection digest",
"version digest" or "exact value digest". All cores below are closed, restricted
JCS values. Unknown fields/tags reject. Digest arrays sort strictly by decoded
32-byte digest; id arrays sort by the id's existing canonical byte codec. A tuple
array is duplicate-free and sorted by its first item unless explicitly stated
otherwise.

### 6.1 Existing record, intent and reset digests retained

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
except where this proposal explicitly changes a field type or canonical-state
value.

### 6.2 Entry-location projection

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

### 6.3 Conflict and content-family projections

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

Every `versions` digest is the section 6.1 version-record digest. Conflict records
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

### 6.4 File projection

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

### 6.5 Canvas-route projection

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

### 6.6 Actual-write value and wrapper

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
format and `recordDigest` is section 6.1. Writes and paths are strict UTF-8 sorted,
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

### 6.7 Closed ledger summary

| Semantic identity | Exact value/preimage | Domain |
| --- | --- | --- |
| Canonical state | exact `ProjectCanonicalStateV2` bytes plus decoded owner schema digest | kernel `convax.canonical-state/2` |
| Genesis | canonical-state digest of the exact section 5.4 genesis value | no second domain |
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

### 6.8 Acyclic construction and self-reference prohibition

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
`ProjectIndexWriteValueV2` contains only the root value's section 6.1 record digest,
never a projection digest. `ProjectResourceReferenceV2` contains its exact version
record digest and blob identity but no file projection digest. Derived projections
are never inserted into a ProjectIndex root. The frame may bind both canonical state
and actual-write evidence because neither is reachable from any stored record.

The operation receipt itself is one actual write: its already-closed record digest
produces its per-write value digest, which enters the evidence. The receipt MUST NOT
gain an evidence-digest back-reference. A schema generator that cannot topologically
sort the graph above, or that needs a placeholder/fixed-point digest, fails bundle
generation as `canonical-authority-conflict`.

## 7. Domain registry and bundle impact

Apply this one atomic registry delta to the inspected 89-domain bundle. The added
list below is already strict raw-UTF-8 sorted and duplicate-free. It consists of the
28 Canvas recipe domains that remain after deleting the proposed private Canvas
canonicalizer domain, followed by the seven kernel/Project domains from this patch:

```text
convax.canvas-actual-write-value/2
convax.canvas-containment-slot/2
convax.canvas-creation-group-member-set/2
convax.canvas-data-register/2
convax.canvas-edge-identity/2
convax.canvas-effective-child-set/2
convax.canvas-effective-data/2
convax.canvas-effective-plugin/2
convax.canvas-generation-begin/2
convax.canvas-generation-dismissal/2
convax.canvas-generation-lifecycle/2
convax.canvas-generation-recovery-failure/2
convax.canvas-generation-terminal/2
convax.canvas-genesis-core/2
convax.canvas-geometry/2
convax.canvas-group-geometry-plan/2
convax.canvas-history-footprint/2
convax.canvas-history-material/2
convax.canvas-history-materialization/2
convax.canvas-metadata-effective/2
convax.canvas-metadata-slot/2
convax.canvas-node-identity/2
convax.canvas-obstacle-projection/2
convax.canvas-operation-receipt/2
convax.canvas-projected-generation/2
convax.canvas-semantic-guard/2
convax.canvas-semantic-history-root/2
convax.canvas-semantic-history-state/2
convax.owner-canonicalizer-descriptor/2
convax.project-conflict-projection/2
convax.project-content-family-projection/2
convax.project-entry-location-projection/2
convax.project-file-projection/2
convax.project-index-write-value/2
convax.project-route-projection/2
```

Remove this one existing digest domain:

```text
convax.project-index-canonical-state/2
```

The registry generator MUST compute exactly:

```text
source = strictDecodeRegistry(inspected89)
assert source.size == 89
assert source contains exactly "convax.project-index-canonical-state/2"
assert every item in additions35 is absent from source
final = SortRawUtf8Unique(
  (source minus {"convax.project-index-canonical-state/2"})
  union additions35
)
assert final.size == 123 // 89 + Canvas 28 + kernel/Project 7 - retired 1
```

`convax.canvas-canonicalizer/2` MUST be absent: it was not in the inspected 89-domain
source and section 4 forbids adding it. Both
`convax.canvas-canonical-state/2` and
`convax.project-index-canonical-state/2` remain owner canonical-state **format**
strings, not registered digest domains. Any duplicate addition, missing removal,
unexpected pre-existing addition, alternate sort, count other than 123 or registry
entry not produced by the algorithm fails regeneration.

Transplanting any normative byte here changes at least:

- the Project whole-file and `project-persistence` artifact digests;
- the kernel prefix/whole-file and `collaboration-kernel` artifact digests;
- the four-artifact manifest, domain registry, bundle core and portable protocol
  digest;
- the main spec's kernel/Project pins, annex-set digest and every embedded detached
  golden affected by those values;
- generated schema validators, protocol conformance vectors and any credential,
  checkpoint, frame, reset or identity record bound to the prior protocol/artifact
  digest.

The kernel descriptor is mandatory for every owner. Atomic adoption therefore also
requires the Canvas owner to instantiate section 4's exact generic descriptor and
receive 3/3 review for its owner-specific canonical-state extraction bytes. The old
bundle MUST NOT be partially upgraded with a new Project port, a descriptor-less
Canvas port or a Canvas-private descriptor.

No current hash in section 1 is copied forward. The merge process computes new
values from final exact bytes, then performs independent 3/3 recomputation.

## 8. 3/3 Project reset identity and initiator-authority ruling

### 8.1 Nominal field correction

Project section 2 MUST import the kernel-owned nominal types:

```ts
type MemberIdV2 = import("@convax/collaboration").MemberIdV2
type ReplicaIdV2 = import("@convax/collaboration").ReplicaIdV2
```

Replace only these three fields in `DocumentShardResetClaimCoreV2`:

```diff
- initiatorMemberId: Id128V2
- initiatorReplicaId: Id128V2
+ initiatorMemberId: MemberIdV2
+ initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
- adminMemberId: Id128V2
+ adminMemberId: MemberIdV2
```

Do not change control confirmation to `Id128V2`, split replica identity into a new
field, add a raw-id alternative or accept both codecs. `ReplicaIdV2` is the exact
service-reserved `replica_` plus eight lowercase hexadecimal digits and maps to the
Yjs client id; raw 16-byte base64url cannot represent the same identity.

### 8.2 Initiator tuple and reservation chain

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
function. There is no shortened final-currentness verifier, suffix API or Project
copy of any verifier step. Section 8.2 supplies equality and acceptance predicates
to the Control function; it does not define another execution sequence.

The Control document owns only that pure diagnostic algorithm. It returns only its
closed `verified | pending | rejected` result and owns no witness, permit, registry,
state transition or reducer gate. This Owner/Project document solely defines the
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
   exact canonical input bytes;
3. synchronously acquire the witness. Acquisition's atomic current check is separate
   from four mandatory explicit assertions. Acquisition failure returns dependency-
   pending, releases any partial lease and creates no record;
4. invoke assertion **A1** immediately after acquisition, then call the complete
   Control-owned `verifyDocumentShardResetAuthorityV2` for the initial F13 decision;
   invoke assertion **A2** immediately after its `verified` result. A1 failure,
   verifier pending/rejection/exception or A2 failure releases the witness exactly
   once, discards the candidate and creates no permit record;
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
8. invoke assertion **A3**, then call the same complete Control-owned
   `verifyDocumentShardResetAuthorityV2` again for the final F13 decision against the
   exact bound objects and synchronous current route/head values. Invoke assertion
   **A4** immediately after its `verified` result;
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

## 9. Breaking cutover and failure behavior

This proposal intentionally provides no compatibility decoder. Frames, checkpoints,
claims, Project identities and persisted private collaboration bytes bound to the
old protocol/artifact/canonicalizer identities are unsupported by the new bundle.

Project open MUST detect and preserve unsupported private bytes until the user
confirms the existing explicit breaking reset flow. The reset may delete all
displayed private Convax collaboration state and create a new Project epoch; it may
leave ordinary user Project files intact as already specified. It MUST NOT silently
hydrate, rewrite, down-migrate, reinterpret or garbage-collect old bytes, and it
MUST NOT claim content recovery. Cancel leaves the old bytes untouched and the
Project unopened/read-only according to the existing cutover contract.

## 10. Mechanical transplant order and gates

1. Transplant kernel descriptor shape/domain/digest/port clauses.
2. Transplant both generic descriptor instances, `ProjectCanonicalStateV2`, exact
   nine-root codec and owner-port bindings; delete the Canvas-private descriptor and
   domain.
3. Transplant the complete Project derived-digest ledger and guard/evidence
   references.
4. Transplant the nominal reset fields, active-editor acceptance predicates and the
   complete `F13-WITNESS-A+C/1` Owner gate: private accepted-head witness, closed
   nested permit record, acquire plus A1..A4, initial/final calls to the same complete
   Control verifier, A+C state machine and release/durability matrix. Reference the
   Control-owned verifier as the only verification order and failure-code authority;
   do not transplant a Project verifier sequence or final-currentness suffix.
5. Merge the independently reviewed Canvas canonical-state extraction closure under
   the generic descriptor; do not retain its former private descriptor.
6. Regenerate all schema artifacts, the exact 123-domain registry, bundle
   core/wrapper, main pins
   and detached goldens from final bytes.
7. Obtain three independent architecture signatures over the same complete
   authority set. Any reviewer dissent keeps implementation blocked.
8. Only after 3/3, create implementation tasks at the package owners and run package
   boundary, pack, typecheck, test and protocol-vector gates.

No hand-edited embedded digest is accepted. No implementation commit may precede
step 7.

## 11. Required falsifiable conformance tests

This proposal is wrong or incomplete if any of these tests fails:

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
   topologically sorts exactly as section 6.8; adding an evidence digest to the
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
14. **Bundle regeneration:** the final registry is the exact section 7 raw-UTF-8
    sorted union, contains all 35 additions once, omits both the retired Project
    digest domain and forbidden Canvas-private domain, and has count 123. Every
    artifact/core/protocol/main pin independently recomputes from final bytes.
15. **Breaking open:** an old project is never silently reset or migrated; cancel
    preserves bytes, confirmation deletes only the displayed private set, and the
    new Project epoch opens with the exact genesis canonical digest.
16. **File projection totality:** every row of the section 6.4 table verifies exact
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

### 11.1 Exact closure vectors

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

**Vector R — Project-private permit terminal traces**

| Injection | Assertions reached | Exact trace | Release count | Reducer entries | Durable interpretation | Same-permit retry |
| --- | --- | --- | ---: | ---: | --- | --- |
| acquire, A1, initial F13 or A2 rejects/pends/throws | acquire, at most A1..A2 | no record | 1 after acquisition | 0 | none | no permit exists |
| exact bytes/field/witness-identity mismatch | A1..A2 | `issued -> consuming -> spent` | 1 | 0 | none | reject |
| A3 fails | A1..A3 | `issued -> consuming -> spent` | 1 | 0 | none | reject |
| final complete F13 rejects/pends/throws | A1..A3 | `issued -> consuming -> spent` | 1 | 0 | none | reject |
| A4 fails | A1..A4 | `issued -> consuming -> spent` | 1 | 0 | none | reject |
| all checks pass, reducer then throws | A1..A4 exactly once | `issued -> consuming -> consumed` | 1 in reducer-call `finally` | 1 | no commit unless kernel proves one | reject |
| exact frame persisted and head committed, return then throws | A1..A4 exactly once | `issued -> consuming -> consumed` | 1 | 1 | committed by kernel barrier | reject; recover exact frame |
| copied, concurrent or re-entrant losing permit | winner owns A1..A4 | genuine winner unchanged | 0 by loser | 0 by loser | none from loser | reject |
| process crashes in any state | at most A1..A4 | process-local state lost | process teardown only | at most 1 | inspect only exact frame/head barrier | no reconstructed permit |

Any counterexample revokes acceptance; implementation convention or a passing UI
test cannot override it.

## 12. Strongest objections and decision score

### Strongest objection 1: full canonical JCS is an O(document) hot-path cost

An expert can reject this design because every candidate/frame/checkpoint appears
to require serializing all Project facts, including retained versions and operation
receipts. A large Project can turn fine-grained Yjs edits into repeated full-state
CPU and allocation spikes. This objection is valid; the protocol closes bytes, not
an incremental algorithm. An implementation may cache per-root sorted tuple bytes
and a validated aggregate, but cache invalidation must be proven equivalent to the
full golden encoder. If benchmarked p99 candidate validation cannot meet the agreed
budget at maximum supported Project size, this representation is wrong for the
declared cap and must be redesigned before shipping.

Flaw type challenged: **ignored operational complexity / hidden scaling
assumption**.

### Strongest objection 2: projection digests can become a second schema language

The six Project projection/value domains add protocol surface and demand exact
dependency selection. Over-inclusive projections cause false conflicts; under-
inclusive projections allow stale operations. The route rule intentionally excludes
non-current losers, while family evidence retains all accepted versions; one generic
"include all facts" rule cannot implement both. If independent reducers disagree on
any golden corpus, the ledger has failed its purpose and must not be patched with
arrival order or broader document versions.

Flaw type challenged: **complexity transfer / insufficient alternative analysis**.
The rejected alternative is one monolithic Project projection digest: it is simpler
but recreates unrelated conflicts and defeats fine-grained collaboration.

### Strongest objection 3: credential/receipt closure increases reset dependency
fragility

A valid destructive reset now depends on retained exact reservation, actor
credential, current replica edit authorization, member/admin credential and
capability bytes. Aggressive GC or service outage can prevent reset even when a
human sees a corrupted Canvas. If no active editor remains, admin approval alone
cannot initiate a shard mutation; the product must use the explicit whole-Project
reset boundary or separately review a narrower admin system-writer protocol. Making
every viewer an implicit Project writer is not a valid availability shortcut. This
is a real tradeoff, not incidental ceremony. The alternative—accepting a session
identity, viewer actor, current credential or admin assertion—allows authority
substitution on a destructive route change. V2 chooses fail-closed retention and
least privilege; if the product cannot retain/fetch those bounded dependencies, it
must change the reset authority model explicitly rather than weaken verification.

Flaw type challenged: **hidden availability assumption / omitted failure mode**.

### Score

Proposal score: **8.5/10**.

Deductions: 0.5 for full-state canonicalization cost, 0.4 for the size and review
burden of the projection ledger, 0.4 for reset dependency/active-editor
availability, and 0.2 because atomic adoption still depends on the separately owned
Canvas extraction/history closure. These are not currently fatal because the
protocol has explicit fail-closed behavior, finite state caps, a precise independent
golden-test surface and no silent LWW/document-version fallback. The score falls
below 7 if the Canvas owner does not close its generic descriptor instance and exact
canonical bytes, if p99 full-equivalence encoding
misses the accepted capacity budget, or if two independent reducers disagree on any
projection or reset corpus.

## Decision

**PROPOSE, DO NOT IMPLEMENT.** Transplant only as one atomic authority-set change,
then require fresh 3/3 exact-byte architecture review.
