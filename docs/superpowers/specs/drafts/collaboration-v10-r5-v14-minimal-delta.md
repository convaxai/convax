# Collaboration v10 R5.14 minimal unique delta

Status: architecture-owner-authored, non-authoritative correction input. This delta replaces only R5.13 section 1.2, the corresponding owner/count amendments, and the corresponding falsifiers of rejected R5.13 candidate SHA-256 `aaa24cfd86a74f1080ab6fc8b6068e002971d50e9e050297876fe64ecd2b02e6`.

Every other R5.13 clause and every inherited R5.12, R5.11, R5.10, R5.9 G/H and approved R5.8 I clause remains byte-semantically unchanged.

## 1. Exhaustive metadata kind-to-location authority

This section replaces R5.13 section 1.2 in full.

### 1.1 Scope of the unique correction

`RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2.deleteExactMetadataObject` accepts the complete ten-member `RemoteIngressEvidenceMetadataObjectKindV2` union. Therefore its kind-to-location authority must be total over that exact union.

The inherited specifications define the exact record formats for all ten kinds. R5.12 and R5.13 define canonical native locations only for:

```text
admission-publication-operation
admission-publication-terminal
admission-publication-recovery-head
```

No inherited R5.10, R5.11, R5.12 or R5.13 clause determines a unique native directory for the other seven kinds. Their locations below are therefore the sole new architecture decision in this delta, not an inference from implementation, filenames, directory scans or prior non-authoritative bytes.

The only new decision is the exact directory-component sequence for:

```text
epoch-head
transition
checkpoint
stable-key-state
member-quota
stable-key-map-page
member-quota-map-page
```

The three R5.13 publication paths, every record format, the R5.13 conditional-delete capability, native identity checks, durability barriers, metadata-GC state machine, receipt/ACK authority, Y.Doc model and collaboration kernel remain unchanged.

Because these seven paths were not previously authoritative and all R5.x inputs remain non-authoritative design candidates, there is no legacy-path fallback, dual-read migration or alternate location.

### 1.2 Exact record-format set

The complete admitted metadata record-format set is:

```ts
export type RemoteIngressEvidenceMetadataRecordFormatV2 =
  | "convax.remote-ingress-evidence-admission-epoch-head-record/2"
  | "convax.remote-ingress-evidence-admission-transition-record/2"
  | "convax.remote-ingress-evidence-admission-checkpoint-record/2"
  | "convax.remote-ingress-evidence-stable-key-state-record/2"
  | "convax.remote-ingress-evidence-member-quota-record/2"
  | "convax.remote-ingress-evidence-map-leaf-page-record/2"
  | "convax.remote-ingress-evidence-map-internal-page-record/2"
  | "convax.remote-ingress-evidence-admission-publication-operation-record/2"
  | "convax.remote-ingress-evidence-admission-publication-terminal-record/2"
  | "convax.remote-ingress-evidence-admission-publication-recovery-head-record/2"
```

A map-page kind admits both the leaf and internal page formats, but only with its exact `mapKind`:

```text
stable-key-map-page:
  format = map-leaf-page-record/2 | map-internal-page-record/2
  mapKind = "stable-key-state"

member-quota-map-page:
  format = map-leaf-page-record/2 | map-internal-page-record/2
  mapKind = "member-quota"
```

A leaf or internal page with the wrong `mapKind` is a kind/record mismatch even when its digest and native location otherwise validate.

### 1.3 Closed literal component vocabulary

The node-only location authority uses this closed literal directory-component vocabulary:

```ts
export type RemoteIngressEvidenceMetadataDirectoryLiteralComponentV2 =
  | "remote-ingress-evidence-admission"
  | "epoch-head-records"
  | "transition-records"
  | "checkpoint-records"
  | "stable-key-state-records"
  | "member-quota-records"
  | "maps"
  | "stable-key-state"
  | "member-quota"
  | "pages"
  | "publication"
  | "operations"
  | "terminals"
  | "recovery-head-records"
```

These values are descriptor-relative directory components, not paths, URIs or caller input. No separator, drive, UNC prefix, device prefix, dot component, alternate data-stream syntax, percent-decoded representation or Unicode-normalization alternative is admitted.

### 1.4 Exact exhaustive location declaration

```ts
export interface RemoteIngressEvidenceMetadataLocationV2 {
  readonly directoryComponents: readonly [
    RemoteIngressEvidenceMetadataDirectoryLiteralComponentV2,
    ...RemoteIngressEvidenceMetadataDirectoryLiteralComponentV2[],
  ]
  readonly recordFormats: readonly [
    RemoteIngressEvidenceMetadataRecordFormatV2,
    ...RemoteIngressEvidenceMetadataRecordFormatV2[],
  ]
  readonly requiredMapKind: RemoteIngressEvidenceMapKindV2 | null
}
```

The sole kind-to-location declaration is:

```ts
export const REMOTE_INGRESS_EVIDENCE_METADATA_LOCATION_BY_KIND_V2 = {
  "epoch-head": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "epoch-head-records",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-admission-epoch-head-record/2",
    ],
    requiredMapKind: null,
  },

  transition: {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "transition-records",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-admission-transition-record/2",
    ],
    requiredMapKind: null,
  },

  checkpoint: {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "checkpoint-records",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-admission-checkpoint-record/2",
    ],
    requiredMapKind: null,
  },

  "stable-key-state": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "stable-key-state-records",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-stable-key-state-record/2",
    ],
    requiredMapKind: null,
  },

  "member-quota": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "member-quota-records",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-member-quota-record/2",
    ],
    requiredMapKind: null,
  },

  "stable-key-map-page": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "maps",
      "stable-key-state",
      "pages",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-map-leaf-page-record/2",
      "convax.remote-ingress-evidence-map-internal-page-record/2",
    ],
    requiredMapKind: "stable-key-state",
  },

  "member-quota-map-page": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "maps",
      "member-quota",
      "pages",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-map-leaf-page-record/2",
      "convax.remote-ingress-evidence-map-internal-page-record/2",
    ],
    requiredMapKind: "member-quota",
  },

  "admission-publication-operation": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "publication",
      "operations",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-admission-publication-operation-record/2",
    ],
    requiredMapKind: null,
  },

  "admission-publication-terminal": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "publication",
      "terminals",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-admission-publication-terminal-record/2",
    ],
    requiredMapKind: null,
  },

  "admission-publication-recovery-head": {
    directoryComponents: [
      "remote-ingress-evidence-admission",
      "publication",
      "recovery-head-records",
    ],
    recordFormats: [
      "convax.remote-ingress-evidence-admission-publication-recovery-head-record/2",
    ],
    requiredMapKind: null,
  },
} as const satisfies Readonly<
  Record<
    RemoteIngressEvidenceMetadataObjectKindV2,
    RemoteIngressEvidenceMetadataLocationV2
  >
>
```

The declaration contains exactly ten keys. Removing, renaming or omitting any `RemoteIngressEvidenceMetadataObjectKindV2` member fails type checking. Adding a non-union key to the object literal also fails excess-property checking.

No `default`, wildcard, fallback directory, legacy directory, caller-selected adapter, dynamic registry or platform-specific duplicate map exists.

### 1.5 Exact descriptor-relative resolution plan

The sole Project/node resolver performs:

```text
strictly decode objectKind as RemoteIngressEvidenceMetadataObjectKindV2
-> index the exhaustive static declaration by that exact kind
-> acquire the trusted ProjectEpochNativeStore root handle
-> open each declared directoryComponents member in exact array order
   relative to the previously retained handle
-> derive exactly one canonical metadata basename from objectRecordDigest
   through the inherited Project-local record-digest native-key/basename codec
-> open that basename relative to the retained final parent handle
-> validate the record through the unchanged R5.13 capability
```

The basename remains:

```text
<canonical digest-native-key>.bin
```

The `.bin` suffix is applied only by the canonical metadata-record basename codec. It is one native filename component, never a pathname and never caller input.

The resolver must not:

```text
split a caller string into components
join the components into an absolute or current-working-directory path
probe multiple directories
scan for a matching digest
infer kind from record bytes or filename
infer a directory from format
retry another kind after format mismatch
use a platform-specific location map
use implementation bytes as a fallback authority
```

A runtime value not admitted by the strict `RemoteIngressEvidenceMetadataObjectKindV2` decoder is `store-corrupt` before root-handle acquisition.

### 1.6 Closed kind, format and map-kind validation

After opening the exact entry through the retained final handle, Project/node requires:

```text
record.format occurs in location.recordFormats

when location.requiredMapKind != null:
  record is a map leaf or internal page
  record.mapKind equals location.requiredMapKind

when location.requiredMapKind == null:
  record validates through the exact non-map record decoder selected by objectKind

record.projectId equals command.projectId
record.projectEpoch equals command.projectEpoch
ProjectLocalRecordDigest(exact opened bytes) equals command.objectRecordDigest
```

Validation dispatch is selected only by `objectKind` and its exhaustive location entry. A format token cannot select another directory or object kind.

The following all reject before unlink:

```text
epoch-head bytes under transition
stable-key-state bytes under member-quota
stable-key map page under member-quota-map-page
member-quota map page under stable-key-map-page
leaf/internal page with wrong mapKind
publication operation under terminal
publication terminal under recovery-head
any admitted format under a different kind directory
```

A hard link or same-byte alias does not collapse object identity across kinds. The exact kind, exact directory sequence, exact format, exact map-kind discriminator and exact digest must all agree.

### 1.7 One capability for all ten kinds

Every physical deletion of an object admitted by `RemoteIngressEvidenceMetadataObjectKindV2` invokes the same inherited:

```ts
RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2
```

The capability receives only:

```text
projectId
projectEpoch
objectKind
objectRecordDigest
deletionCommitRecordDigest
deleteCommittedHeadRecordDigest
```

Project/node derives the exhaustive location entry, descriptor-relative traversal and canonical basename internally.

The seven new path decisions do not create seven capabilities, per-kind deletion functions or a second metadata-GC executor. POSIX, Windows and future conforming adapters consume the same resolved node-only location plan and implement only the unchanged R5.13 native conditional-delete primitive.

If a platform adapter contains its own kind-to-location switch, default branch, filename inference or alternate path table, it is non-conforming.

### 1.8 Authority isolation

This delta changes no collaboration-kernel or application authority.

The exhaustive location declaration and resolver are owned only by `@convax/project/node`. They are not exported from or imported by `@convax/collaboration`, Canvas, Desktop renderer, preload, Agent, Plugin, Marketplace or the control plane.

The location declaration:

```text
does not mutate replicaDoc
does not create or validate candidateDoc
does not admit a causal frame
does not advance a durable document head
does not mint plain persistence evidence
does not mint or validate a Kernel receipt
does not enqueue, consume or acknowledge replication
does not create an ACK authority
does not authorize metadata deletion without the current delete-committed tombstone
```

`RemoteIngressEvidenceMetadataNativeDeleteResultV2` remains an internal native result. It is not admission evidence, Kernel evidence, an ACK, a causal receipt or a portable protocol object.

This capability remains restricted to Project-private immutable admission metadata. It gains no authority over ordinary Project files, managed assets, blobs, Canvas objects, staging files, Plugin closures, Marketplace bytes, user paths or arbitrary `.convax` entries.

## 2. Exact owner and declaration count amendments

Add to the R5.13 exactly-one declarations:

```text
one ten-entry REMOTE_INGRESS_EVIDENCE_METADATA_LOCATION_BY_KIND_V2 declaration
one compile-time exhaustive Record<RemoteIngressEvidenceMetadataObjectKindV2, ...>
one canonical descriptor-relative directory sequence per metadata object kind
one record-format set per metadata object kind
one required mapKind discriminator for stable-key-map-page
one required mapKind discriminator for member-quota-map-page
one strict runtime objectKind decoder before map lookup
one shared Project/node location-plan resolver
one inherited RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2 for all ten kinds
```

Add to the R5.13 `@convax/project/node` ownership list:

```text
the seven newly frozen inherited-metadata directory sequences
the three unchanged publication-metadata directory sequences
the exhaustive kind/location/format/mapKind declaration
strict runtime object-kind decoding
shared descriptor-relative location-plan resolution
```

Add to the R5.13 exactly-zero declarations:

```text
missing RemoteIngressEvidenceMetadataObjectKindV2 location
extra non-union location key
default or wildcard location branch
legacy or fallback metadata directory
per-platform kind-to-location map
per-kind destructive capability
second metadata destructive authority
format-selected directory
record-byte-selected directory
directory scan used to locate any of the ten kinds
caller-supplied directory component
caller-supplied basename
dynamic metadata location registry
dual-read or migration lookup for the seven new path decisions
map page admitted without exact mapKind
kind alias based only on equal bytes or a hard link
metadata-native location type in @convax/collaboration
native delete result treated as persistence evidence, Kernel receipt or ACK
change to replicaDoc, candidateDoc, causal-frame or durable document-head authority
extension to non-admission metadata or user-visible Project content
```

The owner remains `@convax/project/node`. No package, dependency direction, public Plugin/Agent capability, collaboration API, receipt factory, ACK port, Yjs schema or kernel state changes.

## 3. Mandatory falsifier amendments

Add the following mandatory falsifiers after the unchanged R5.13 list:

1. Removing any one of the ten location entries fails TypeScript type checking at the `satisfies Record<RemoteIngressEvidenceMetadataObjectKindV2, ...>` declaration.
2. Adding an eleventh non-union key to the location object literal fails excess-property checking.
3. Each of the ten kinds resolves to exactly its declared ordered directory-component sequence and one canonical digest-derived basename.
4. `epoch-head`, `transition`, `checkpoint`, `stable-key-state` and `member-quota` each reject every format except their single declared record format.
5. `stable-key-map-page` accepts leaf and internal map pages only when `mapKind="stable-key-state"`.
6. `member-quota-map-page` accepts leaf and internal map pages only when `mapKind="member-quota"`.
7. Swapping stable-key and member-quota map pages while retaining identical filenames performs zero unlink operations.
8. The three publication kinds retain the exact R5.13 directory sequences and record formats byte-for-byte.
9. For every kind, wrong directory, wrong format, wrong mapKind, wrong Project, wrong epoch or wrong digest performs zero unlink operations.
10. An unknown runtime kind rejects before trusted-root acquisition and never enters a default or fallback lookup.
11. Instrumented execution over all ten kinds proves that every successful or already-absent result flows through the same `RemoteIngressEvidenceMetadataNativeDeleteCapabilityV2`.
12. POSIX and Windows adapters receive the same already-resolved location plan and contain no independent kind/path switch.
13. No test can cause a format token, record body, directory scan or existing pathname to select another location.
14. No metadata deletion succeeds through an inherited pathname API, legacy directory or second destructive capability.
15. Native deletion of any of the ten kinds changes no `replicaDoc`, `candidateDoc`, causal-frame head, journal head or accepted Canvas/Project document state.
16. Native deletion of any of the ten kinds returns no plain persistence evidence or Kernel receipt and performs no ACK enqueue, consumption or acknowledgement.
17. Import and package-boundary checks prove `@convax/collaboration` contains no metadata location declaration, Project-native handle, pathname, fsync, unlink or destructive-result dependency.
18. Attempts to pass an ordinary Project file, managed asset, blob, Canvas object, Plugin object, Marketplace byte or arbitrary `.convax` entry remain impossible through the closed object-kind boundary and perform zero unlink operations.
19. Every unchanged R5.13 native conditional-delete, same-entry identity, durability, already-absent and recovery falsifier continues to pass.
20. Every unchanged R5.12 state-machine, retention, metadata-GC, ACK and inherited R5.11/R5.10/R5.9/R5.8 falsifier continues to pass.

## 4. Red-team closure

The three strongest rejection attempts are:

1. The seven inherited metadata kinds still depend on undocumented directories. Rejected because this delta explicitly identifies that inherited information was insufficient and freezes one exact sequence for every missing kind instead of claiming an inferred path.
2. Map leaf and internal pages cannot share one object kind safely. Rejected because each map-page kind admits exactly the two inherited page formats and additionally requires its exact `mapKind`; format equality alone cannot cross the stable-key/member-quota boundary.
3. Platform adapters can silently restore duplicate path authority. Rejected because the exhaustive map and resolver are singular Project/node inputs to the one R5.13 capability, while per-platform switches, defaults and fallbacks have declaration count zero and dedicated falsifiers.

Flaw types checked:

```text
incomplete closed union
undocumented inherited assumption
kind/format conflation
missing mapKind discriminator
cross-kind aliasing
hard-link identity collapse
default/fallback authority
per-platform path drift
duplicate destructive capability
native-detail leakage into collaboration kernel
receipt/ACK authority expansion
accepted/candidate/Y.Doc authority expansion
non-admission deletion expansion
```

No major defect remains within this delta’s scope. This conclusion becomes false if any union member lacks a static entry, if any adapter selects a path outside the exhaustive declaration, if map pages omit the exact `mapKind` check, or if the node-only location plan enters collaboration, receipt or ACK APIs.

Score: 9/10. The remaining deduction is the operational cost of freezing seven previously unspecified native directory sequences. It is not fatal because the inputs are still non-authoritative design candidates, no legacy fallback is admitted, all ten kinds share one capability, and the exhaustive type/fault suite makes future kind additions fail closed.

## 5. Unconditional unique author vote

As Project/store/URI architecture owner, I unconditionally vote `ADOPT` for this exact R5.14 minimal delta and no broader change.
