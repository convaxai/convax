# Collaboration v10 R5 Route F and L1 exact release delta

Status: **non-authoritative formatter assembly for exact-byte 3/3 architecture
review. Root has no architecture vote. No clause in this file activates R5 or
authorizes implementation.**

This delta assembles the three architecture owners' Route F and L1 decisions. It
changes only release identity, complete-file artifact assembly, review/promotion,
the Task 1 publication guard and downstream scheduling. It does not change any
Canvas, Kernel, Control, Project or global URI business semantic.

The target authority identity is `collaboration-v10`. The directory component `r5`
is an immutable revision, not an authority id. The fixed release directory is:

```text
docs/superpowers/specs/authorities/collaboration-v10/r5/
```

There is no content-addressed release directory, dynamic resolver, repository
candidate pointer or staging pointer.

## 1. Exact Main replacements

### 1.1 Status paragraph

Replace the existing Main status paragraph with:

```text
Status: **standalone inactive revision directory. Its authorityId is
`collaboration-v10`; `r5` is only its immutable directory revision. It becomes
active only through the exact global pointer after its protocol bundle, manifest,
three fresh full-review report/receipt pairs and review evidence all validate.**
```

### 1.2 Main section 1.1

Replace Main section 1.1 in full with:

```markdown
### 1.1 Standalone authority set

This file is the Main member of the fixed inactive revision directory:

`docs/superpowers/specs/authorities/collaboration-v10/r5/`

The authority id is `collaboration-v10`; `r5` is only the immutable revision.
The complete release identity chain uses these fixed paths:

- `docs/superpowers/specs/authorities/collaboration-v10/r5/main.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json`;
- the three report/receipt pairs under
  `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/` declared in
  section 24;
- `docs/superpowers/specs/2026-07-31-global-uri-protocol.md`;
- `docs/superpowers/specs/collaboration-v10-active-authority.json`.

Every JSON file in this identity chain is exact restricted-JCS UTF-8 followed by
one LF. The seven-line manifest uses the exact non-JSON byte grammar in section 24.
Markdown members are complete UTF-8 files with one final LF.

There is no repository candidate pointer or staging pointer. Final-path bytes that
are not selected by the global active pointer remain inactive. After activation,
the seven manifest members, manifest, three fresh reports, three receipts, review
evidence and bound global URI bytes are create-only. Any future semantic or release
change uses `r6`, a fresh unconditional 3/3 review and one pointer compare-and-swap.

The repository selects the release only through:

`docs/superpowers/specs/collaboration-v10-active-authority.json`

A missing, mismatched or inactive identity-chain member is
`protocol-schema-bundle-unavailable`; prose never reconstructs a pin and no older
manifest, source constant, draft, review input or persisted byte is a fallback.
```

Main section 1.2 otherwise remains unchanged.

### 1.3 Main section 23 scheduling change

Replace only the existing Task 1 row with these eight owner rows:

```markdown
| 1. Architecture documents, protocol and Yjs schema | `1.release` — root formatter and mechanical generator, non-voting | the exact seven R5 release paths: `main.md`, four annexes, `protocol-schema-bundle-v2.json`, `authority.sha256`; `scripts/collaboration-authority/**`; removal of `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-canvas-disposition.md`, `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-kernel-control-disposition.md` and `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-project-persistence-disposition.md`; and byte-identical creation of `docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-canvas-disposition.md`, `docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-kernel-control-disposition.md` and `docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-project-persistence-disposition.md` | exact accepted Route F/L1 formatter delta plus the unchanged global URI, Canvas, Control and Project owner bytes | final inactive seven-member release, byte-identical independent-generator result, exact promotion contract and byte-preserved Route-B audit files outside the authority directory; no fresh report, receipt, evidence or active pointer | none |
| 1. Architecture documents, protocol and Yjs schema | `1.canvas-review` — `/root/canvas_intent_runtime` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md` and `receipt.json` only | exact `1.release` seven members, bundle, manifest and promotion contract | fresh full-review report and restricted-JCS receipt with unconditional decision, or an explicit rejection with no receipt | `1.release` |
| 1. Architecture documents, protocol and Yjs schema | `1.control-review` — `/root/collaboration_api` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md` and `receipt.json` only | exact `1.release` seven members, bundle, manifest and promotion contract | fresh full-review report and restricted-JCS receipt with unconditional decision, or an explicit rejection with no receipt | `1.release` |
| 1. Architecture documents, protocol and Yjs schema | `1.project-review` — `/root/project_store_reviewer` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md` and `receipt.json` only | exact `1.release` seven members, bundle, manifest and promotion contract | fresh full-review report and restricted-JCS receipt with unconditional decision, or an explicit rejection with no receipt | `1.release` |
| 1. Architecture documents, protocol and Yjs schema | `1.evidence` — root mechanical evidence assembler, non-voting | `docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json` only | exact `1.release` bytes and three fresh unconditional report/receipt pairs | exact restricted-JCS 3/3 evidence bound to the same manifest and protocol bundle | `1.canvas-review`, `1.control-review`, `1.project-review` |
| 1. Architecture documents, protocol and Yjs schema | `1.kernel-loader` — `@convax/collaboration` | `packages/collaboration/src/authority-selector.ts`, `packages/collaboration/src/authority-selector.test.ts`, `packages/collaboration/src/index.ts`, `packages/collaboration/scripts/pack-check.ts`; plus import-declaration-only changes in `packages/collaboration/src/checkpoint-undo.test.ts`, `packages/collaboration/src/kernel.test.ts` and `packages/collaboration/src/protocol.test.ts` | exact release and `1.evidence`; no active pointer yet | headless copy-owning authority packaging validator, exact public export closure and a runtime selection entry that remains unavailable until Task 3 installs the exact implementation | `1.evidence` |
| 1. Architecture documents, protocol and Yjs schema | `1.main-governance` — root formatter and mechanical verifier, non-voting | `AGENTS.md`, `docs/architecture.md`, `scripts/package-boundary-check.ts`, `scripts/collaboration-authority-release.ts`, `scripts/collaboration-authority-release.test.ts` and governance-check tests only | exact release, `1.evidence` and the frozen L1 selector contract; no active pointer yet | checker and governance bytes that recognize only Route F, verify T0/descendant Git trees and reject every legacy fallback; no authority-member modification | `1.evidence` |
| 1. Architecture documents, protocol and Yjs schema | `1.promotion` — root mechanical promoter, non-voting | `docs/superpowers/specs/collaboration-v10-active-authority.json` only | exact release, `1.evidence`, verified `1.kernel-loader` and verified `1.main-governance` | one validated sequence-1 active-pointer create CAS; no fallback | `1.evidence`, `1.kernel-loader`, `1.main-governance` |
```

In every remaining Main table row, mechanically replace each dependency token `1`
with `1.promotion`. Preserve every more-specific dependency.

Then insert the following normative prose in Main section 23 immediately after the
completed table and before the existing `Root may dispatch...` paragraph:

````markdown
Before the three fresh reviews, `1.release` relocates these three provisional files
byte-for-byte:

```text
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-canvas-disposition.md
-> docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-canvas-disposition.md

docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-kernel-control-disposition.md
-> docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-kernel-control-disposition.md

docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-project-persistence-disposition.md
-> docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-project-persistence-disposition.md
```

The source hashes are exactly:

```text
22a4864bcf78aa4bff715393886277bc46772c7cc9fff4d60c1b7d244798359b
4ff64ced10095784966d9069d98c9955664f0546bf8c4aa5a154d7942b3ef4f0
66a9594546c7c1a9c299809d3b749a36bd66d7934d82c2d3ed65bf9b141950f0
```

The relocation requires: active pointer absent; the fixed legacy manifest present
as a regular non-symlink file with its exact fixed hash; all three sources present
as regular non-symlink files with the hashes above; and all three targets absent.
Any failed precondition writes or removes nothing. After relocation the three old
R5 paths are absent. The audit targets are not release members, selector inputs or
fresh signoff, and no report, receipt, evidence, bundle, manifest or pointer may
reference their path or hash.

The owner graph has exactly 36 rows, no missing dependency, no cycle and no
unordered pair of overlapping write scopes. Every Task 2 through Task 8 row that
formerly depended on the architecture gate depends on `1.promotion`; no such row
may begin before `1.promotion`.
````

### 1.4 Main section 24

Replace Main section 24 in full with:

````markdown
## 24. Bundle, review and promotion gate

Every annex artifact is the complete UTF-8 file including its single final LF. No
sentinel, prefix span or self-exclusion rule exists. The generator runs outside
`docs/`, writes temporary bytes outside the release directory, and promotes only
the fixed final files named below after byte-for-byte revalidation.

Generation performs exactly this ordered procedure:

1. Read the four complete annexes and global URI file from their fixed paths;
   require regular non-symlink files, valid UTF-8 and exactly one final LF.
2. Compute each annex `artifactDigest` with the Kernel-owned domain-separated
   complete-file formula.
3. Build the four-element artifact tuple in exact order `canvas-schema`,
   `collaboration-kernel`, `control-plane`, `project-persistence`.
4. Use the exact closed namespace/import tuple declared by the Kernel annex.
5. Extract the exact owner domain sets from the four annexes.
6. Build their duplicate-free strict raw-UTF-8 sorted union and verify the declared
   owner counts and total count.
7. Extract the exact Kernel `YjsWireCodecV2` value.
8. Set `uriProtocolDigest` to ordinary SHA-256 of the complete global URI file.
9. Extract the exact Control `ProtocolLimitsV2` and compute its declared digest.
10. Extract the exact Control `PeerChannelContractV2` and compute its declared
    digest.
11. Restricted-JCS encode the exact `ProtocolSchemaBundleCoreV2` and compute
    `coreDigest` with the Kernel-owned domain-separated formula.
12. Set `protocolDigest = coreDigest`; restricted-JCS encode
    `ProtocolSchemaBundleV2`, append one LF, reopen it, and require parse plus
    re-encode to reproduce the exact same bytes. Its `protocolBundleSha256` is
    ordinary SHA-256 of that complete JSON file.

The bundle path is:

`docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json`

The manifest path is:

`docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256`

The manifest is exactly seven lines. Each line is:

```text
<64 lowercase hexadecimal SHA-256><two ASCII spaces><full repository-relative path><LF>
```

Its paths are duplicate-free and strict raw-UTF-8 sorted, and are exactly:

```text
docs/superpowers/specs/2026-07-31-global-uri-protocol.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md
docs/superpowers/specs/authorities/collaboration-v10/r5/main.md
docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json
```

`manifestSha256` is ordinary SHA-256 of the exact manifest bytes.

The three fresh full-review identities are exactly:

| `reviewerRole` | `reviewerTaskPath` | report | receipt |
| --- | --- | --- | --- |
| `canvas-intent-runtime` | `/root/canvas_intent_runtime` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json` |
| `collaboration-control-protocol` | `/root/collaboration_api` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json` |
| `project-native-store` | `/root/project_store_reviewer` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json` |

Each report is a fresh full review of the exact seven manifest members, generated
bundle and promotion contract. It states role, task path, all seven member hashes,
`manifestSha256`, `protocolBundleSha256`, `protocolDigest`, the unconditional
decision, strongest three objections, flaw types, falsifiers and
`ScoreBasisPoints`. A qualified, partial or inherited disposition is not a sign.

Every decoder uses these exact runtime codecs before comparing a value:

```ts
type LowercaseSha256HexV1 = string
// Exact runtime codec: /^[0-9a-f]{64}$/.

type CanonicalPositiveUint64V1 = string
// Exact runtime codec: canonical decimal 1..18446744073709551615,
// with no sign, whitespace or leading zero.

type DirectoryRevisionV1 = `r${CanonicalPositiveUint64V1}`
// Exact runtime codec: ASCII "r" followed by CanonicalPositiveUint64V1.

type AuthorityDirectoryV1<R extends DirectoryRevisionV1> =
  `docs/superpowers/specs/authorities/collaboration-v10/${R}`
type AuthorityManifestPathV1<R extends DirectoryRevisionV1> =
  `${AuthorityDirectoryV1<R>}/authority.sha256`
type AuthorityEvidencePathV1<R extends DirectoryRevisionV1> =
  `${AuthorityDirectoryV1<R>}/review-evidence.json`
```

These aliases do not replace runtime validation. Non-ASCII characters, uppercase
hexadecimal, `-0`, signed, fractional, exponent, leading-zero or out-of-range
representations reject before any equality or path lookup.

Each receipt is exact restricted-JCS UTF-8 followed by one LF and has exactly:

```ts
interface CollaborationAuthorityReviewReceiptV1 {
  readonly format: "convax.collaboration-authority-review-receipt/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly reviewerRole:
    | "canvas-intent-runtime"
    | "collaboration-control-protocol"
    | "project-native-store"
  readonly reviewerTaskPath:
    | "/root/canvas_intent_runtime"
    | "/root/collaboration_api"
    | "/root/project_store_reviewer"
  readonly decision: "UNCONDITIONAL SIGN"
  readonly scoreBasisPoints: number
  readonly reportPath: string
  readonly reportSha256: LowercaseSha256HexV1
  readonly manifestPath: "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256"
  readonly manifestSha256: LowercaseSha256HexV1
  readonly protocolBundlePath: "docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json"
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
}
```

`scoreBasisPoints` is a finite JSON integer from 0 through 1000; `-0`, fraction,
NaN and infinity reject. Path, role and task must match the fixed row;
caller-selected reviewer identity is rejected.

The evidence path is:

`docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json`

It is exact restricted-JCS UTF-8 followed by one LF and has exactly:

```ts
interface CollaborationAuthorityReviewEvidenceV1 {
  readonly format: "convax.collaboration-authority-review-evidence/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly decision: "UNCONDITIONAL 3/3 SIGN"
  readonly manifestPath: "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256"
  readonly manifestSha256: LowercaseSha256HexV1
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
  readonly reviews: readonly [
    CollaborationAuthorityReviewEvidenceEntryV1 & {
      readonly reviewerRole: "canvas-intent-runtime"
      readonly reviewerTaskPath: "/root/canvas_intent_runtime"
    },
    CollaborationAuthorityReviewEvidenceEntryV1 & {
      readonly reviewerRole: "collaboration-control-protocol"
      readonly reviewerTaskPath: "/root/collaboration_api"
    },
    CollaborationAuthorityReviewEvidenceEntryV1 & {
      readonly reviewerRole: "project-native-store"
      readonly reviewerTaskPath: "/root/project_store_reviewer"
    },
  ]
}

interface CollaborationAuthorityReviewEvidenceEntryV1 {
  readonly reviewerRole: string
  readonly reviewerTaskPath: string
  readonly decision: "UNCONDITIONAL SIGN"
  readonly scoreBasisPoints: number
  readonly reportPath: string
  readonly reportSha256: LowercaseSha256HexV1
  readonly receiptPath: string
  readonly receiptSha256: LowercaseSha256HexV1
}
```

The global active pointer is exact restricted-JCS UTF-8 followed by one LF at:

`docs/superpowers/specs/collaboration-v10-active-authority.json`

It has exactly:

```ts
interface CollaborationActiveAuthorityPointerV1<
  R extends DirectoryRevisionV1,
> {
  readonly format: "convax.collaboration-active-authority-pointer/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: R
  readonly sequence: CanonicalPositiveUint64V1
  readonly previousSelection:
    | {
        readonly kind: "legacy-manifest"
        readonly manifestPath: "docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256"
        readonly manifestSha256: "68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde"
      }
    | {
        readonly kind: "active-pointer"
        readonly sequence: CanonicalPositiveUint64V1
        readonly revision: DirectoryRevisionV1
        readonly pointerSha256: LowercaseSha256HexV1
      }
  readonly manifestPath: AuthorityManifestPathV1<R>
  readonly manifestSha256: LowercaseSha256HexV1
  readonly evidencePath: AuthorityEvidencePathV1<R>
  readonly evidenceSha256: LowercaseSha256HexV1
}
```

Pointer decoding parses `revision`, `manifestPath` and `evidencePath` independently,
then requires the two path revision segments to be byte-equal to `revision`. It
rejects `.`, `..`, percent aliases, backslashes, repeated slashes, normalization or
caller-selected paths. The first promotion is exactly revision `r5`, sequence `"1"`
and the fixed `legacy-manifest` selection above. A future promotion requires both
canonical positive-uint64 values to increase by exactly one and the exact prior
pointer SHA in `previousSelection`. The loader validates the structure of
`previousSelection` but never opens it and never falls back to it.

The initial R5 promotion is one create CAS under the repository promoter's exclusive
publication lock. Its writer precondition is the conjunction of:

1. the global active-pointer path is absent in the parent Git tree and at the write
   target;
2. the fixed legacy manifest exists as a regular non-symlink file and Git blob with
   mode `100644`;
3. ordinary SHA-256 of its exact bytes is
   `68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde`;
4. the new pointer has revision `r5`, sequence `"1"` and the exact
   `legacy-manifest` previous selection;
5. the complete inactive fifteen-file R5 snapshot has been reopened, the candidate
   pointer bytes have been defensively copied, and both have been verified; and
6. the selector and static checker accept the same complete golden and hostile
   corpus.

Failure of any term writes no pointer. The active loader never opens
`previousSelection`; only the promoter reads the legacy manifest as initial CAS
evidence.

`T0` is the first Git tree containing a valid sequence-1 pointer selecting R5. At
T0, the pointer and every member of the exact fifteen-file authority snapshot are
regular non-symlink Git blobs with mode exactly `100644`. The R5 directory contains
exactly its fourteen members of that snapshot and no extra authority file.

For every descendant Git tree of T0, all fifteen sealed authority paths, blob bytes,
regular-file kinds and `100644` modes remain exact, even after a later valid pointer
selects R6. Adding, deleting, renaming or modifying a sealed path, changing its mode,
or replacing it with a symlink, submodule or other file kind is
`activated-authority-mutation`. The active pointer is not one of the fifteen sealed
files because a valid later-revision CAS must replace its bytes, but every pointer
version is itself a regular non-symlink `100644` Git blob. If a tree still selects
R5, its active-pointer bytes also remain exact.

The first-parent Git-tree checker owns T0, descendant, file-kind and mode validation.
It fails closed when the required parent/T0 evidence is unavailable. The headless
selector receives no filesystem or Git metadata and validates only copy-owned exact
paths and bytes.

Protocol major 2 is valid only if the exact generated `protocolDigest` is checked
after bounded message-core framing and signature verification but before any body,
manifest, carrier or owner decoder is constructed. There is no compatibility
negotiation, dual decode, legacy manifest fallback or source-code pin fallback.

Root formats, dispatches and mechanically verifies. Only the three fixed reviewers
have architecture votes, and promotion requires their unconditional 3/3 sign of
the same exact bytes.
````

## 2. Exact Kernel section 4 replacement

Replace Kernel section 4 from its heading through the line immediately before
`## 5. Exact Yjs wire codec` with:

````markdown
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
````

## 3. Exact Main section 24.1 insertion

Append the following normative subsection inside the full Main section 24
replacement, immediately after its existing final paragraph:

````markdown
### 24.1 L1 authority selector boundary

This section is a Task 1 packaging gate only. It does not install a collaboration
runtime and does not authorize mutation, decode, sign, persistence or ACK before
Task 3.

The exact ordering is:

```text
1.release
-> {1.canvas-review, 1.control-review, 1.project-review}
-> 1.evidence
-> {1.kernel-loader, 1.main-governance}
-> 1.promotion
-> Task 3 runtime installation
```

The sole Task 1 collaboration write scope is:

```text
packages/collaboration/src/authority-selector.ts
packages/collaboration/src/authority-selector.test.ts
packages/collaboration/src/index.ts
packages/collaboration/scripts/pack-check.ts
packages/collaboration/src/checkpoint-undo.test.ts
packages/collaboration/src/kernel.test.ts
packages/collaboration/src/protocol.test.ts
```

`packages/collaboration/src/errors.ts` remains unchanged and private. Task 1 must
not modify any Kernel, frame, causal, checkpoint, canonicalizer, undo, Yjs codec,
port, contract or constant implementation and must not add a registry, installer,
Y.Doc, decoder, reducer or transport adapter. In the three listed pre-existing test
files, Task 1 may change only the import declarations from `"./index"` to the exact
private owner modules. Every test body, assertion, fixture, golden and other byte
remains unchanged.

`@convax/collaboration` performs no filesystem or Git I/O. The Host supplies one
complete snapshot, and the validator defensively copies every path and byte before
validation:

```ts
export interface AuthorityReleaseFileV1 {
  readonly path: string
  readonly bytes: Readonly<Uint8Array>
}

export interface AuthorityReleaseSnapshotV1 {
  readonly activePointerBytes: Readonly<Uint8Array>
  readonly files: readonly AuthorityReleaseFileV1[]
}

export interface ValidatedAuthorityReleaseV1 {
  readonly format: "convax.validated-authority-release/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly sequence: "1"
  readonly activePointerSha256: LowercaseSha256HexV1
  readonly manifestSha256: LowercaseSha256HexV1
  readonly evidenceSha256: LowercaseSha256HexV1
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
}
```

`activePointerBytes` contains only the active pointer and is not an entry in
`files`. `files` contains exactly these fifteen duplicate-free paths in strict raw
UTF-8 order:

```text
docs/superpowers/specs/2026-07-31-global-uri-protocol.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md
docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256
docs/superpowers/specs/authorities/collaboration-v10/r5/main.md
docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json
docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md
```

The seven manifest members, manifest, evidence, three reports and three receipts are
the complete cardinality. A fourteen-entry or sixteen-entry snapshot, duplicate, missing,
unsorted or alias path, pointer duplicated into `files`, old manifest, Route-B
disposition, draft/audit file or unrelated repository file rejects before bundle or
review decode.

The validator verifies the exact pointer, path grammar, manifest, payload hashes,
evidence, reports, receipts, bundle, artifact digests, core digest and protocol
digest. Invalid input throws the existing private `ProtocolAuthorityErrorV2`; the
only public failure identity is a readable
`code === "protocol-schema-bundle-unavailable"`. The error class and error types are
not package exports.

Task 1 runtime named exports are exactly:

```ts
validateAuthorityReleaseSnapshotV1(
  snapshot: AuthorityReleaseSnapshotV1,
): ValidatedAuthorityReleaseV1

selectInstalledProtocolAuthorityV2(
  validated: ValidatedAuthorityReleaseV1,
): never
```

Task 1 type-only exports are exactly:

```text
AuthorityReleaseFileV1
AuthorityReleaseSnapshotV1
ValidatedAuthorityReleaseV1
```

`src/index.ts` has no default or `export *`. Its runtime namespace keys are exactly
the two functions above, and its type surface has exactly the three types above.
`ProtocolAuthorityErrorV2`, `CollaborationFailureCodeV2` and every other error,
authority, Kernel, frame, causal, checkpoint, codec, Yjs and undo symbol are not
package-root exports. The package export map contains only `"."`; every deep
subpath, including `/authority`, `/authority-selector`, `/kernel`, `/frame`,
`/yjs-codec`, `/undo` and `/dist/index.js`, fails external resolution.

`ValidatedAuthorityReleaseV1` is frozen, copy-owned and unbranded. It proves only
packaging consistency. Other than the selection function receiving it as packaging
evidence, no Task 1 or Task 3 Kernel, frame, checkpoint, Yjs, owner, mutation,
decode, sign, persistence, ACK or live-runtime API may accept it as a live authority
or as sole authorization. During Task 1, `selectInstalledProtocolAuthorityV2` always throws
`protocol-schema-bundle-unavailable`. Task 3 alone may create a module-private,
non-structurally-forgeable live implementation identity and enable selection after
exact protocol and artifact digest equality.

The real packed-tarball check installs the tarball in a clean external consumer and
proves:

1. JavaScript `Object.keys()` is exactly the two selector functions;
2. the declaration surface has exactly those values and the three type-only names,
   with no `export *`;
3. old authority symbols and every mutation/decode/sign/ACK symbol fail positive
   import compilation;
4. no Kernel/frame/Yjs/undo runtime is importable;
5. all package deep subpaths fail resolution; and
6. borrowed input bytes cannot affect a completed validation result.

The exact Task 1 collaboration gates are:

```text
bun --cwd packages/collaboration typecheck
bun --cwd packages/collaboration test src/authority-selector.test.ts
bun --cwd packages/collaboration pack:check
```

The complete `bun --cwd packages/collaboration test` gate is mandatory in Task 3
and again at final integration, with zero failures required. Task 1 does not waive,
weaken or redefine that final gate. The import-only exceptions above exist to keep
Task 1 typecheck valid; they do not make the legacy R4 runtime tests authoritative
or green.

The selector and static checker consume the same complete golden and hostile
fifteen-file corpus. Any accept/reject difference blocks pointer promotion.

Before Task 3:

```text
authority packaging = valid
selected protocol implementation = unavailable
collaboration mutation/decode/sign/ACK = unavailable
legacy public runtime fallback = impossible
```

The Task 1-only public-API break must not be independently published or merged as a
product release. Final product integration waits for Task 3 to install and expose
the complete selected-authority runtime.

````

## 4. Exact Main section 24.2 insertion

Append the following normative subsection to Main immediately after section 24.1:

````markdown
### 24.2 Mandatory release falsifiers

The R5 release and pointer promotion are rejected if any of the following is true:

1. Any artifact digest excludes bytes from an annex, uses a sentinel or omits the
   final LF.
2. `typeNamespaces` differs from the exact five-element tuple in the
   collaboration-kernel annex section 4, is unsorted or is treated as a runtime
   dependency graph.
3. The manifest has anything other than the exact seven members, grammar or order.
4. A report/receipt is reused from an older route, names a different role/task, is
   conditional, or is not bound to the exact current manifest and bundle.
5. The active pointer accepts a caller-selected path, opens `previousSelection`,
   falls back, skips sequence/revision monotonicity or activates before all gates.
6. The initial promoter creates a pointer while the old manifest is missing, a
   symlink, non-regular, non-`100644` or has any hash other than the fixed legacy
   digest.
7. At T0, the pointer or any exact snapshot member is not a regular non-symlink Git
   blob with mode `100644`; or any descendant changes a sealed path, byte, file
   kind or mode without `activated-authority-mutation`.
8. A Route-B disposition remains under R5, changes bytes during relocation, enters
   the exact-fifteen snapshot, or has its path or hash referenced by a fresh report,
   receipt, `review-evidence.json`, `protocol-schema-bundle-v2.json`,
   `authority.sha256` or active pointer.
9. The snapshot has anything other than the exact fifteen ordered paths, or the
   pointer is duplicated into `files`.
10. Before Task 3, the package root exposes anything other than the exact two
    runtime functions and three type-only names, any deep subpath resolves, or a
    public API can instantiate a Kernel, decode/admit a frame, mutate Yjs state,
    sign, ACK or import an R4 verifier/pin.
11. The selector reads the filesystem, uses ambient state, trusts borrowed input
   bytes or treats packaging validation as a live runtime authority.
12. The selector and static checker disagree on any shared hostile corpus case.
13. Task 1 changes a forbidden Kernel/frame/causal/checkpoint/canonicalizer/undo/
    Yjs-codec/port/contract/constant implementation, changes `errors.ts`, changes
    any of the three import-only test exceptions beyond their import declarations,
    or expands into a runtime registry, installer, owner runtime or transport.
14. The Task 1 graph is not exactly 36 rows, has a missing provider/cycle/unordered
    overlapping scope, or any Task 2 through Task 8 row starts before
    `1.promotion`.
15. Root supplies an architecture vote or promotion proceeds with fewer than three
    unconditional decisions over the same exact release bytes.
16. Task 1 fails any of its exact package typecheck, targeted selector-test or real
    packed-tarball gates; or Task 3/final integration fails the complete
    `bun --cwd packages/collaboration test` gate with zero failures required.

````

## 5. Exact review request

This section is formatter-review metadata only. It is not inserted into Main or any
owner annex.

Each of the three fixed architecture owners must return exactly one of:

```text
UNCONDITIONAL SIGN
REJECT
```

A response containing a condition, reservation, optional correction or alternate
interpretation is `REJECT`. Review covers this complete file byte-for-byte, including
the Route F identity chain, exact namespace tuple, full-file artifact rule, review
envelopes, promotion CAS, Task 1 L1 selector boundary, scheduling graph and all
falsifiers.
