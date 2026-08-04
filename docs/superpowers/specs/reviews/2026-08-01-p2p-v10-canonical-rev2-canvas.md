# P2P collaboration v10 canonical revision 2 Canvas red-team review

Date: 2026-08-01

Reviewed indivisible authority set:

1. `docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md`
2. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md`
3. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md`
4. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md`

I changed neither the authority set nor implementation. This review is for the exact
four-file byte set below; no prior draft, review, code or generated artifact was used
as a fallback decoder.

## Exact identity and source-set verification

All four detached whole-file digests independently match:

| File | Declared SHA-256 | Independently computed | Result |
| --- | --- | --- | --- |
| canonical revision 2 | `257b00ceb122f3eb092d1c4e6e156c4155b273568a61ffa70850be2a00004940` | `257b00ceb122f3eb092d1c4e6e156c4155b273568a61ffa70850be2a00004940` | PASS |
| Canvas annex | `7a11fed58dd8769c1af84748abda3524fb00bb6a06dc0e12237dec0dd827733e` | `7a11fed58dd8769c1af84748abda3524fb00bb6a06dc0e12237dec0dd827733e` | PASS |
| control annex | `d884726daef51eacf3f2d4d9ea5e8448849b3995ab19b2ce9a72c64abd3d65a0` | `d884726daef51eacf3f2d4d9ea5e8448849b3995ab19b2ce9a72c64abd3d65a0` | PASS |
| Project annex | `b1f07de09adff277dd195f10189ac24e7d646503c55a1d78d1561aace0ed418f` | `b1f07de09adff277dd195f10189ac24e7d646503c55a1d78d1561aace0ed418f` | PASS |

I independently sorted the three annex objects by raw UTF-8 path bytes and encoded
the closed array with no whitespace or trailing newline. The exact 526-byte preimage
was:

```json
[{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md","sha256":"7a11fed58dd8769c1af84748abda3524fb00bb6a06dc0e12237dec0dd827733e"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md","sha256":"d884726daef51eacf3f2d4d9ea5e8448849b3995ab19b2ce9a72c64abd3d65a0"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md","sha256":"b1f07de09adff277dd195f10189ac24e7d646503c55a1d78d1561aace0ed418f"}]
```

Its independently computed SHA-256 is
`1df7906e82f0b9fdf96fb13c90acd493dd0201b3c4dd36fb32f21e9166712d6f`,
matching canonical section 1. The global URI and revision-4 source files also still
hash to their incorporated values:

- URI: `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`;
- round-3 revision 4:
  `ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`.

File identity and documentation source-set construction therefore pass. They do not
repair the missing portable protocol identity described below.

## Exact-set decision

**REJECT** the exact four-file authority set.

The prior Canvas review's shard-reset, registry-bound and React Flow ownership
blockers are repaired. The service review's membership replay, PeerJS channel and
native pre-head crash-state blockers are also materially repaired. The closed-schema
blocker is not: the set now contains detailed owner records, but still cannot produce
one portable `protocolDigest` or one causal-frame wire. It also contains two
cross-annex mismatches and one contradictory Canvas write budget.

Score: **6.5/10**. The owner graph and most state machines are strong, but a protocol
whose signature identity and primary edit frame cannot be generated from its
authority set is below the implementation gate.

## Prior reject-blocker audit

| Prior blocker | Revision 2 result | Evidence-based conclusion |
| --- | --- | --- |
| Canvas C1: no closed schema bundle | **FAIL, narrowed** | Canvas and Project owner schemas now exist, but `ProtocolSchemaBundleV2` is not instantiated and the generic causal-frame/header/context/frontier schemas are still absent. |
| Canvas C2: shard-reset lifecycle omitted | **PASS for R3-2 semantics** | Exact claim, three reasons, staged/CAS/recovery transition, sole-route rule and pre-CAS-only abandonment are restored. Reset authorization receipts remain separately blocked by R2-C2 below. |
| Canvas C3: registry nested quotas omitted | **PASS** | 64 KiB claim, 4 outstanding/replica, 1,024/member, 4,096/Project, 64 MiB and retained-accounting rules are restored. |
| Canvas C4: React Flow moved to Desktop | **PASS** | Canvas owns editor/view/React Flow projection and gesture semantics; Desktop owns shell, IPC, transport and native adapters. |
| Service: replay-safe membership/session identity | **PASS** | Closed challenges, counters, atomic receipts, snapshot/epoch/key binding and idempotency are defined and bounded. |
| Service: signed-frame pre-head crash recovery | **PASS** | Object-only, ref/journal-below-head, head-visible and response-loss cases deterministically recover the same signed frame or quarantine. |
| Service: Peer/channel/transfer wire closure | **PASS** | Handshake, four channel opens, per-open sequences, `CVXPEER2`, control union, manifests, chunks and ACK mapping are closed. |
| Service/Canvas: complete portable schema and frame language | **FAIL** | Detailed domain annexes do not supply the missing instantiated descriptor/core digest or generic causal-edit frame DTO. |

## Blocking R2-C1 — the portable bundle and causal edit wire still do not exist

Severity: **P0**. Flaw types: **false completeness**, **hidden normative
dependency**, and **signature-domain omission**.

Canonical lines 38-43 say generated validators derive from the exact descriptor and
the three annexes. Lines 59-60 explicitly say the documentation source-set digest is
not `coreDigest` or credential `protocolDigest`. Control lines 146-176 then define
only interfaces for `ProtocolSchemaArtifactRefV2`, `ProtocolSchemaBundleCoreV2` and
`ProtocolSchemaBundleV2`.

The authority set contains none of the following:

- the exact sorted `artifacts` value;
- the canonical descriptor artifact bytes named by each ref;
- their `artifactDigest` values;
- the exact instantiated bundle core JCS;
- the resulting `coreDigest`, which every credential/frame/ticket/handshake requires
  as `protocolDigest`;
- a normative deterministic transform from Markdown/TypeScript-like prose to those
  descriptor bytes.

This is not solved by hashing the three Markdown annexes: the main file explicitly
forbids treating that source-set digest as the portable bundle digest.

The primary edit wire is independently incomplete. Canonical lines 346-376 list five
payload sections and say what a header “binds”, but no file defines the exact closed:

- causal-edit header/core/frame object and wrapper fields;
- causal context and signer-authorization dependency layout;
- `CausalHeadRefV2`, frontier object/key ordering and digest records;
- Project-owner `ActualWriteEvidenceV2` shape;
- `CVXCOLL2` kind-to-header DTO mapping for causal edit.

A repository implementation or old kernel draft could fill these gaps, but canonical
section 1 explicitly makes both non-normative. Two teams can choose different
artifact arrays or causal header keys, obtain different `protocolDigest` and frame
signatures, and still claim conformance to the prose.

### Minimum patch

1. Publish exact canonical descriptor artifacts inside the pinned set, including
   their byte encoding, name, format and artifact digest.
2. Instantiate the exact sorted artifact-ref array and complete bundle core, then
   publish its computed `coreDigest` as the one portable `protocolDigest`.
3. Add a closed generic kernel artifact containing causal head/frontier/context,
   edit header/core/frame, signer authorization dependencies, actual-write evidence
   envelope and exact `CVXCOLL2` per-kind header mapping.
4. Recompute the control-annex whole-file digest, source-set digest and main-file
   digest, then restart 3/3 review.

### Falsifiable test

Give two independent implementers only the four files. They must print the same
non-placeholder protocol bundle JCS, `coreDigest` and first `canvas.nodes.create/2`
causal-frame bytes. Today they cannot do so without inventing an artifact list and
frame header. Any request for repository code or author clarification confirms the
blocker.

## Blocking R2-C2 — reset authority cites receipts that no owner defines

Severity: **P0**. Flaw types: **authorization lifecycle omission** and
**cross-owner dangling reference**.

Project lines 814-842 put `adminAuthorizationDigest`,
`explicitConfirmationReceiptDigest` and `adminApprovalDigest` into the portable
shard-reset claim. Lines 861-863 explicitly state that the control annex defines how
the admin authorization and confirmation receipts are issued. It does not. Across
the complete authority set, these names occur only in the Project claim/manifest and
summary prose.

Whole-Project reset has the same gap. Canonical lines 1303-1309 require an
authenticated service epoch-rollover challenge/receipt for a team Project, while
Project lines 1240-1263 store `teamEpochRolloverReceiptDigest`; the control annex has
no challenge, proof, receipt, signature domain, single-use/idempotency rule or atomic
epoch/session-fence transaction for it.

The existing generic `ProjectAdminCapabilityV2` proves that one member has the fixed
admin grant. It does not define which exact reset claim/deletion set/new epoch the
admin approved, nor does it instantiate a user confirmation or epoch-rollover
receipt. Treating an arbitrary digest or renderer boolean as proof would violate the
annex's own fail-closed rule.

### Minimum patch

Add purpose-separated closed DTOs and transactions for:

1. a shard-reset admin approval bound to exact claim core, old/new scope and current
   admin authorization instance;
2. an explicit destructive confirmation receipt bound to exact observed inventory,
   deletion set and proposed new identity;
3. team Project epoch-rollover challenge/proof/receipt bound to the exact empty
   ProjectIndex genesis, old/new project epoch, confirmation and current membership;
4. atomic single-use/idempotency, session/writer fencing and signer/store rollback.

Add their domains and artifacts to the instantiated bundle from R2-C1. If explicit
confirmation is deliberately local-only, define its signer, storage and portable
verification contract rather than calling an opaque digest sufficient.

### Falsifiable test

Ask a clean implementation to verify `adminApprovalDigest` or issue the team
epoch-rollover receipt from the four files. If two implementations may choose
different signed fields, accept the same approval for another claim, or cannot know
which service transaction closes old sessions, reset authority is not closed.

## Blocking R2-C3 — revision-4 generation recovery loses authorization identity

Severity: **P0**. Flaw types: **normative merge drift** and **unbound digest**.

Revision 4 and canonical lines 794-797 require the unique first-loss receipt for the
exact tuple
`{projectId,projectEpoch,beginActorId,beginAuthorizationEpoch}`. Control lines
1942-1967 correctly store raw `beginAuthorizationEpoch: Id128V2` in the signed
receipt. Canvas lines 443-449 instead store only
`beginAuthorizationEpochDigest: DigestV2` in `GenerationBeginV2`.

No digest domain, preimage, codec or equality rule maps that Canvas field back to
the receipt's raw epoch. The control domain registry contains no authorization-epoch
digest domain. Project therefore cannot prove that a first-loss receipt names the
authorization instance that authored the exact begin; it can only compare actorId.
An old/new authorization instance for the same actor could be accepted or rejected
according to an implementation-local hash choice.

### Minimum patch

Prefer the revision-4 shape: store exact
`beginAuthorizationEpoch: Id128V2` in `GenerationBeginV2` and require byte equality
with the first-loss receipt. If disclosure requires a digest, add one exact
purpose-separated domain/preimage to the shared descriptor and require the receipt
to bind that same digest explicitly. Recompute the Canvas/source-set/main digests.

### Falsifiable test

Create two begins for one actor across authorization replacement and present each
with the other's first-loss receipt. Exactly the matching epoch must receive a
recovery permit under Bun, Chromium and attester. The current set does not define
the comparison required to obtain that result.

## Blocking R2-C4 — Canvas write closure and cap arithmetic disagree

Severity: **P1**. Flaw types: **internal contract contradiction** and
**boundedness arithmetic error**.

Canvas lines 1161-1190 say each successful undoable resource-add writes an operation
receipt and history root and list six per-node domain paths
(`identity/position/size/data/plugin-null/creationGroup-null`) plus three per-edge
paths (`identity/data/creationGroup-null`). Lines 1248-1269 cap changed paths/writes
at 2,048 but claim the same operation costs `4*N + 2*E + 1` and has maximum 1,537.

For the independently allowed `N=256`, `E=256`, the path table requires at least:

```text
6*256 + 3*256 + operation receipt + semantic-history root = 2306
```

That exceeds 2,048 and is not the stated formula. Even if null/container
initialization is intended not to count, the exact path table currently says it is
part of the domain-write closure, and the mandatory history root is still absent
from `+1`. Implementations can disagree on evidence, ordinal assignment and whether
the advertised maximum batch is legal.

### Minimum patch

Choose one semantic-path counting model, then update together:

- the per-intent path closure;
- creator initialization rule;
- operation/history auxiliary writes;
- resource/pending/Plugin cardinalities;
- logical-write and 256 KiB evidence caps;
- exact/over-one generated fixtures.

Do not merely raise one count: the complete evidence JCS and outer frame caps must
also admit every advertised maximum, or the advertised cardinality must shrink.

### Falsifiable test

Generate resource-add fixtures at every `(N,E)` boundary, including `(256,256)`.
Every runtime must produce the same path count, write ordinals and accept/reject
result. The current text yields both 1,537 and at least 2,306 for the same case.

## URI, revision-4 and authority-split audit

### Global URI governance

**PASS.** The set preserves global `@convax/uri` ownership, five components, closed
static schemes, opaque case-sensitive Project authority, explicit entry/revision/
canonical-string comparison, stable ProjectFileId, mutable path hint, immutable blob
pin and one atomic Project/Canvas resource value. Path, id and hash remain distinct;
no global resolver or dynamic handler registry appears.

### Round-3 revision 4

| Revision-4 clause | Result |
| --- | --- |
| R3-1 dual checkpoint gate and 320 MiB encoded carrier | PASS |
| R3-2 no `docEpoch`, Project-owned shard reset, sole-route recovery | PASS |
| R3-3 non-denying registry, abandonment, quotas and complete paged cutoff | PASS |
| R3-4 dismissal and first-loss recovery | **FAIL** only at the raw-epoch/digest binding in R2-C3; lifecycle precedence and fixed markers otherwise pass |

### Canonical ownership and duplicate-authority check

No second ProjectIndex, Canvas JSON document, service route catalog, renderer
document store, document-wide version, central edit sequencer, `certifiedTeamDoc`,
`workingDoc` or local-fork Y.Doc survives in the four-file semantics. UI, Agent and
Plugin converge on typed Main application services. Canvas/Project/Collaboration/
Desktop ownership and dependency direction agree with the target architecture.

The remaining failures are not duplicate-state failures. They are missing or
contradictory protocol bytes at the boundaries between otherwise-correct owners.

## Consolidated minimum patch and re-review boundary

The architecture does not need another conceptual redesign. The minimum new exact
digest set must:

1. instantiate the descriptor artifacts, bundle core and `protocolDigest`;
2. close the generic causal edit/context/frontier/evidence/header codec;
3. close shard-reset approval, destructive confirmation and Project epoch-rollover
   authority transactions;
4. bind generation begin and first-loss receipt to one exact authorization epoch;
5. reconcile Canvas path evidence, batch cardinalities and all byte/write caps.

Then recompute every affected annex whole-file digest, the sorted annex source-set
digest and detached main digest. An editorial review that keeps the current exact
digests cannot waive these changes.

## Strongest three objections to signing now

1. **There is no portable protocol identity to sign.** The documentation source-set
   hash is explicitly not `protocolDigest`; the artifact list/core digest required by
   every credential and frame has no value.
2. **Destructive authority is asserted through dangling digests.** Neither a Plugin,
   renderer nor service adapter may invent reset approval semantics after 3/3
   architecture approval.
3. **The same accepted Canvas batch has two incompatible write counts.** This is
   exactly the class of cross-runtime drift that actual-write evidence is supposed to
   prevent.

The strongest defense is that the annex prose contains enough intent for one team to
implement consistently. That is an **implicit single-implementation assumption**,
not a protocol argument. The canonical release gate explicitly requires two clean
implementations with no repository source or author clarification.

## Falsifiable re-review gates

The next set is eligible for SIGN only if all of these pass:

1. From the authority set alone, two clean implementations generate the identical
   non-placeholder bundle artifact list, bundle JCS, `protocolDigest`, causal header,
   context, frontier and first frame bytes.
2. Every portable format/digest/signature name has one owner, exact closed shape,
   purpose-separated preimage and an instantiated descriptor artifact.
3. Shard reset approval and team Project epoch rollover reject cross-claim replay,
   stale admin epoch, changed deletion set/genesis and partial signer/store commit.
4. First-loss receipts cross authorization replacement only for the exact begin
   epoch; mismatched old/new receipts remain pending/rejected identically.
5. Canvas resource/Plugin batches at exact and over-one limits produce one write
   count/evidence result and remain within both logical and encoded byte caps.
6. Existing URI, registry, cutoff, Peer channel, crash, checkpoint, blob and package
   ownership gates continue unchanged.

## Reviewer signature

Decision: **REJECT**

Score: **6.5 / 10**

Reviewer: `/root/canvas_intent_runtime`

Reviewed detached main SHA-256:
`257b00ceb122f3eb092d1c4e6e156c4155b273568a61ffa70850be2a00004940`

Reviewed annex source-set SHA-256:
`1df7906e82f0b9fdf96fb13c90acd493dd0201b3c4dd36fb32f21e9166712d6f`

The score is below 7 because R2-C1 prevents any conforming implementation from
constructing the protocol identity or ordinary edit frame. The owner boundaries,
offline model and repaired state machines do not compensate for that signing gate.
