# P2P v10 revision-4 R5 collaboration-kernel signoff

Date: 2026-08-02

Reviewer: `/root/project_local_fork`

Decision: **SIGN REVISION 4**

This is an independent exact-byte architecture review receipt. It binds only the
five-file authority set and identities below. It is evidence, not a schema source,
portable authority, fallback decoder or substitute for any pinned annex.

## Exact reviewed authority

| Authority | Whole-file SHA-256 |
| --- | --- |
| `docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md` | `5f6a69af82cf71e0f2a2aa609c75e2054e73f556ac72a2aa9154aaa8c1c2165f` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md` | `4a1d7b2362349826ab7df488af7be4d66ed48f49df3aa39f07552235a2fcd530` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-collaboration-kernel-appendix.md` | `fc40e646aae952b731450c4b60d2213219be130b4bd90115223afbb74f421691` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md` | `1506c4834295d9d1dfeffc07c0dd2666661af74a659d9271b77b43e5214ecca4` |
| `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md` | `6c29fefdf52b63f97199e44fb8f7328b85d98be9f15e884c1aff5727bc34d0b6` |

| Exact set identity | Digest |
| --- | --- |
| Revision-4 four-annex set | `8c3eca5c411ef729d53899aa9dc7e83df7b1e650638c6f7e82178ebd55b2dc55` |
| `ProtocolSchemaBundleV2.coreDigest` | `6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4` |
| Portable `protocolDigest` | `6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4` |
| Global URI protocol whole-file digest | `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949` |

## Exact artifact and control identities

| Identity | Exact value |
| --- | --- |
| Canvas artifact digest | `8270e6fe017ceb27d324b6c71247c993f643edda13d2135987857a01c009944e` |
| Kernel prefix length | `50828` bytes |
| Kernel ordinary prefix SHA-256 | `1863419be46f0e0839a85245b70e6374e3e1df322a47df2b6c305c3b8af5678f` |
| Kernel artifact digest | `7702eb4ee348948c6f9633f4128cade52ea32c76c9501729db40d7dee00d8534` |
| Control artifact digest | `e96148c5fdf5a24eb0d4b0d9c1c3e3dc314018319b3ec2d2f3828600c5d3efcf` |
| Project artifact digest | `cb417657f0c6818115cda43a59354111692e58aad22bf87a89e565a86e24a8db` |
| 67-field limits object digest | `2ac48434013d2669447511a16f9aa706612e97638718fa4c572374579bae19c0` |
| Four-channel contract digest | `0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242` |
| Strict 123-domain registry JCS SHA-256 | `c0de9713db5f39dd6bc97cf56f8f7697d4ebaa7660b583f5758f5a0d7662facf` |

The four artifact refs are in exact raw-UTF-8 name order. The registry is strict
sorted, duplicate-free, excludes `convax.canvas-canonicalizer/2` and
`convax.project-index-canonical-state/2`, and remains exactly 123 domains.

## R5 callable closure

The Control-owned public declaration for `F13-ABI-CLOSED-SNAPSHOT/1` has exact
SHA-256 `0dc97526f5983c26f9c06871d0f35b13195c39db020307d91688a29ff62fa244`
over the declaration code block bytes, excluding its Markdown fences and final LF.

Independent declaration scans proved:

| Closed value | Exact field count |
| --- | ---: |
| `VerifyDocumentShardResetAuthorityInputV2` | 10 |
| `DocumentShardResetAuthorityDependencyBytesV2` | 11 |
| `DocumentShardResetCandidateFactsV2` | 5 |
| `DocumentShardResetCurrentReplicaDocHeadV2` | 4 |
| `DocumentShardResetCurrentRouteFactsV2` | 11 |
| `DocumentShardResetCandidateBindingV2` | 11 |

There is exactly one
`export declare function verifyDocumentShardResetAuthorityV2(...)` declaration.
It has one input, a synchronous closed readonly result, no overload, generic,
optional key, callback, port, ambient lookup, phase, resume token or async return.
Its nonportable input has no `format`; all byte values are defensively copied before
decode. The dedicated update alias is update-v1 and the state-vector alias is
separate. Unknown, accessor and symbol keys reject.

The existing Control F13 remains exactly thirteen ordered steps. Its consumption
matrix does not change their first-failure semantics:

- step 1 bounds and decodes all input;
- step 2 consumes only `claim`, `confirmation`, `approval`, `routeCas` and
  `resetCommit`;
- `typedIntentExactJcs` is structural input in step 1 and first participates
  semantically in step 12;
- candidate, current `replicaDoc` head, route/predecessor and staged-genesis facts
  first participate semantically in step 12;
- step 13 returns only a diagnostic, never authority.

Raw candidate/head update, state-vector and canonical-state bytes close the prior
digest-mirror hole: the verifier reconstructs both documents under the pinned Yjs
codec and independently recomputes the candidate binding. No caller-supplied digest
summary can substitute for either document.

## Project caller and witness audit

Project names the Control declaration but does not copy its `.d.ts`, thirteen-step
algorithm or failure-order table. The only mutation-admission caller is the
module-private `ProjectIndexDocumentShardResetCoordinatorV2`; the sole public pure
implementation is exported from `@convax/project/collaboration-protocol`.

The Project sequence remains:

```text
A1 -> fresh initial ten-field input -> complete F13 -> A2
issued -> consuming -> complete permit comparison -> A3
fresh final ten-field input -> complete F13 -> A4
consumed -> immediate reducer entry
```

Initial and final inputs are distinct objects. Final business and dependency bytes
come only from the permit's defensive exact-input copies and are freshly copied and
decoded. The frozen eleven-field binding is freshly canonicalized. All five
candidate facts, all four current-head facts and all eleven current-route facts,
including the three `currentStagedGenesis*` digests, are freshly rebuilt after A3
while the writer lock and witness remain held. A4 retains the accepted-head lease
through the no-await/no-callback/no-release reducer-entry boundary.

Project record cardinalities remain closed: permit record 9 fields, exact-input
bytes 16 fields and authority binding 45 fields. Witness, permit, candidate identity
and accepted-head identity remain private, nondigestible and nonportable.

## Broader architecture closure audited

- The kernel owns the sole seven-field owner-canonicalizer descriptor; owner
  canonical bytes exclude Yjs insertion/client history and reject unknown state.
- Canvas has one root with eleven mandatory maps and a twelve-field canonical
  state. ProjectIndex has nine roots and a ten-field canonical state. Neither JSON
  documents nor a document-wide revision are parallel authorities.
- Every UI, Agent and Plugin mutation enters the same closed typed-intent path. Raw
  Yjs updates, caller identity and expected document version remain forbidden.
- Semantic undo has fourteen closed intent families. Raw `Y.UndoManager` updates
  never reach candidate, journal, frame or replicaDoc, and no cross-restart undo is
  promised.
- Tombstones dominate late edits and generation terminals. Invalid edges are
  unreachable. Source deletion suppresses the complete Plugin creation group, and
  deterministic dependency scheduling rejects missing producers or source cycles.
- Plugin state is exact artifact/schema-digest pinned; older Plugins cannot default,
  strip or down-migrate newer state.
- `ProjectFileId`, canonical URI and blob hash retain separate roles. Project files
  preserve conflicting text heads; overwritable binary current values use the
  deterministic logical-counter/actor rule rather than wall clock.
- Peer id is routing only, never identity. Membership credentials and signed
  Project/member/replica authority govern the four transport channels; blob transfer
  cannot block the update/control lanes.
- Main explicitly forbids narrowing, extending or reinterpreting annex DTOs,
  topology, transitions or owners. Main contains no duplicate R5 interface and no
  fallback to older drafts.
- The R5 local ABI helpers are not portable values or hash preimages. No digest
  domain was added; the registry, URI, limits and channel contracts are unchanged.

## Independent recomputation evidence

Two independent generators, one Node.js and one Python, read the current bytes and
independently reproduced:

1. all five authority whole-file digests and final LF;
2. the main's exact sorted four-entry annex JCS and annex-set digest;
3. the unique kernel sentinel, exact prefix span and four artifact digests;
4. strict-JCS round trips for manifest, limits, channel, bundle core and wrapper;
5. the 123-domain sorted/unique registry and unchanged URI/limits/channel digests;
6. byte-identical wrapper core and equal core/protocol digests;
7. the exact declaration SHA, unique callable and 10/11/5/4/11 plus binding-11
   field topology;
8. all thirteen F13 steps and the step-2/step-12 input-consumption boundaries;
9. A1/initial/A2/A3/final/A4 textual and semantic order, plus Project 9/16/45
   private-record cardinalities;
10. zero unresolved `PENDING`, `TODO`, `TBD` or `PLACEHOLDER` markers and no Main
    copy of the R5 declaration.

`bun run package:boundaries` stopped only at the explicitly permitted legacy
hardcode: `scripts/package-boundary-check.ts` still freezes older main, annex-set,
protocol and signoff manifest identities and therefore reports
`exact frozen manifest entries/order changed`. No non-manifest boundary failure was
observed. That checker must be updated atomically with final receipt/manifest
publication before implementation work is admitted; it is not treated as evidence
for the current identities.

## Three strongest objections

1. **Synchronous F13 reconstruction cost.** A destructive reset performs two full,
   synchronous, bounded reconstructions of candidate and current ProjectIndex. At
   admitted maxima this can cause Main latency or CPU denial of service. A suffix
   verifier would reduce cost but reopen the authority gap. This is nonfatal only
   while the existing byte/object/working-set caps are enforced before allocation
   and worst-case conformance stays within the product's reset budget.
2. **Whole-file identity blast radius and frozen-tool lag.** Editorial normative
   changes rotate owner artifacts, bundle, annex-set, manifest and all receipts.
   The currently stale boundary-check constants demonstrate this operational cost.
   A schema-AST digest could reduce churn but would introduce a second canonical
   source not specified in v2. The protocol remains exact; release automation must
   catch up before implementation.
3. **Duplicate evidence and availability assumptions.** Binding, raw candidate,
   raw head and current route facts intentionally repeat information, creating
   implementation-drift risk. Separately, P2P bootstrap and missing blobs still
   require an online holder. The first is accepted because every duplicate is
   recomputed and byte-compared; the second is an explicit product availability
   boundary, not hidden durability or an online edit sequencer.

## Flaw types checked

- missing callable ABI and dangling cross-owner symbol;
- hidden ambient input, caller assertion and digest-mirror substitution;
- optional/unknown field ambiguity and async/overload alternate call paths;
- first-failure reordering and shortened final-currentness verification;
- TOCTOU between accepted authority head, candidate, route and reducer entry;
- witness/permit capability leakage, replay and double consume;
- duplicate owner authority, Main-summary reinterpretation and fallback decoder;
- artifact self-reference, annex pin drift and domain-registry mutation;
- document-wide version conflicts, raw-update mutation and renderer authority;
- arrival/wall-clock ordering, identity/routing confusion and schema downgrade;
- Plugin creation-group orphaning, generation resurrection and containment cycles;
- URI/file/blob identity conflation, silent text overwrite and premature blob GC;
- bounded-input performance and P2P bootstrap availability assumptions.

## Falsifiable revoke conditions

This signature is revoked immediately if any of the following is demonstrated:

1. Any whole-file, annex-set, prefix, artifact, URI, limits, channel, core or
   protocol digest above fails independent recomputation.
2. The R5 declaration produces other than one callable or other than
   input/dependency/candidate/head/route counts 10/11/5/4/11.
3. Two clean generators produce different declaration bytes or a declaration hash
   other than `0dc97526f5983c26f9c06871d0f35b13195c39db020307d91688a29ff62fa244`.
4. Step 2 consumes typed intent/current facts, typed intent affects semantics before
   step 12, or either invocation skips/reorders one of the thirteen steps.
5. Replacing raw candidate/head bytes while preserving supplied binding/digests can
   still return verified.
6. Final admission reuses the initial input/snapshots, obtains static bytes outside
   the permit copies, or rebuilds candidate/head/route before A3.
7. A4 can succeed without retaining the accepted-head lease through immediate
   reducer entry, or any await/callback/IPC/release enters that gap.
8. A public diagnostic, copied permit or serialized witness can authorize mutation
   outside the module-private Project coordinator.
9. Main summary changes an annex field/topology/transition, an older draft fills a
   missing rule, or any owner bytes are accepted without all exact pins.
10. A new F13/domain literal enters the 123-domain registry, or URI/limits/channel
    constants change without full bundle regeneration.
11. Message arrival order changes delete/edge, generation, Plugin-group,
    containment, file-conflict or canonical projection outcomes.
12. The boundary checker is treated as passing current identities before its frozen
    constants and receipt manifest are actually updated and verified.

## Score

Final score: **9.3/10**.

Deductions are for synchronous double-reconstruction cost, whole-file rotation and
tooling burden, repeated-evidence implementation complexity, and explicit P2P
holder-availability limits. They are not fatal because the authority is closed,
every safety-critical duplicate is recomputed, all failures are bounded/fail-closed,
and no fallback creates silent overwrite, schema downgrade, reusable authority or
an online edit sequencer.

## Final decision

**SIGN REVISION 4** for exactly the authority bytes and identities in this receipt.

Any normative byte change revokes this receipt and requires complete regeneration,
independent recomputation and renewed 3/3 review.
