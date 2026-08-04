# P2P collaboration v10 canonical revision 3 service G2 red-team review

Date: 2026-08-01

Reviewer lane: G2 service/control-plane, protocol closure, URI and package-boundary
audit.

Reviewed indivisible candidate set:

1. `docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md`;
2. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md`;
3. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-collaboration-kernel-appendix.md`;
4. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md`;
5. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md`.

I changed neither this authority set nor implementation. This report is valid only
for the exact bytes below. Older drafts, current v9 implementation and prior review
prose were used only to identify required regressions; none was used as a fallback
definition.

## 1. Exact identity and independent recomputation

Every supplied whole-file digest matches independently computed bytes:

| File | Lines | Bytes | SHA-256 | Result |
| --- | ---: | ---: | --- | --- |
| main revision 3 | 1,561 | 86,558 | `de24e72edd8a7114932b1c4b86ed2491b41d52f241ad7ed66f4752dc2aca0e05` | PASS |
| Canvas annex | 1,559 | 70,938 | `f258bbab3d85ad54cd2f023ef4e1f135deb2a87c3b473725ca6ab5bf7641b099` | PASS |
| collaboration-kernel annex | 1,019 | 55,278 | `313800d1905f8a4a88463a4c91ca16a43b9d847f93867170efae011b2e20c604` | PASS |
| control-plane annex | 2,711 | 104,940 | `33a23c1f089394a010987b179741d45a37f8380ba2051cc94809c5711277faad` | PASS |
| Project persistence annex | 1,643 | 78,346 | `33d925f80e28615271cbd59b518779f47ded5494050d119c0cda04dc7e9ff857` | PASS |

The exact four-annex restricted-JCS review preimage is 706 bytes. Its independently
computed ordinary SHA-256 is:

```text
ecdf0018a643bac3e4a45458dfd3e957fe8e4e188ee1965450fd137f4dc1b6b3
```

That matches main section 1. The independently versioned global URI file also
matches its pinned digest:

```text
298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949
```

The kernel sentinel occurs exactly once at byte 37,469. Its prefix ends in LF and
recomputes to:

```text
ordinary prefix SHA-256 = 695571c8a77719cd8330406159f026dbfa77dde2e79cf260888936573dd661f0
artifact digest         = 7b20604e909e16adeb14ad0f2409f245edeb215701117cbbd7e1dcaaccc361d7
```

The other three domain-separated artifact digests also match the instantiated
manifest:

```text
canvas-schema       81d5422976f490f973979937a6ac49e7854b6725cfdf03ca2f521dab6d5f582e
control-plane       0999a444e562ae5ab7e258813c63b1720a2b2426986ee04ca67778ba8bbef5e0
project-persistence fed8324163a39e3c683ab30798acddfcd28eb44a23679a8a40aa59566130fca8
```

I parsed and round-tripped the exact limits, channel, bundle-core and bundle-wrapper
JCS. Results:

- 61 named limits plus `format`, `limitsDigest =
  c01f518d76b916b8f97990101aaced33792bd66404d9db4f790e7a629b8d179f`;
- four channel policies, `channelContractDigest =
  0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242`;
- four artifact refs and five namespace refs in strict order;
- exactly 88 domain strings, sorted and duplicate-free;
- wrapper core byte-identical to the published core;
- `coreDigest === protocolDigest ===
  3cb032469da372773d912c27c0e16918bd6379a3c956af83c448013b112ee437`.

All five files end in LF and every Markdown fence count is even. Exact identity,
self-reference exclusion and bundle arithmetic therefore pass. They do not repair
the semantic closure failures below.

## 2. Exact-set decision

**REJECT** the exact revision-3 five-file set.

Two P0 defects remain:

1. the control artifact imports six exact kernel codecs/types which the kernel does
   not define or export; five participate directly in signed credential and Peer
   wire objects;
2. the main file's generation first-loss composition still requires the retired raw
   `beginAuthorizationEpoch`, contradicting the byte-identical digest field required
   by both owner annexes.

Score: **6.7/10**. Revision 3 closes the portable bundle identity and almost every
rev2 state-machine defect, but an exact schema set with dangling primitive imports
and a contradictory cross-owner authorization key cannot be implementation
authority.

## 3. Revision-2 reject-blocker audit

| Prior blocker | Revision-3 result | Conclusion |
| --- | --- | --- |
| No instantiated portable bundle/core digest | **PASS for bytes** | Manifest, artifact spans, constants, 88-domain registry, core JCS and protocol digest independently reproduce. |
| Generic causal frame/header/context absent | **PASS** | Kernel owns the closed causal language, binary sections, signature/digest domains, exact-base validation and persistence barriers. |
| Shared primitive/schema closure | **FAIL** | Canvas id/scope/stamp are unified, but control imports six names absent from the kernel export it cites. |
| Canvas id and stamp collision | **PASS** | One `cv_<64 lowercase hex>` Canvas id and one decimal-string shared portable stamp are used across owners. |
| Reset approvals, destructive confirmation and team rollover absent | **PASS** | Control now owns closed approval/confirmation/challenge/proof/receipt DTOs and atomic single-use service transactions; Project binds their exact digests. |
| Generation begin/first-loss authorization identity mismatch | **FAIL at main composition** | Canvas and control now agree on `beginAuthorizationEpochDigest`; main section 11.2 still names the raw epoch. |
| Canvas write closure arithmetic conflict | **PASS** | Exact per-intent equations, auxiliary writes and the 512-write cap agree, with exact and over-one fixtures. |
| Pending-editor floor derived from lagging registry | **PASS** | Coverage derives from one content-certified current `ProjectIndexLiveScopeManifestV2`; registry fields are advisory anti-rollback only. |
| Reconnect cannot discover exact missing objects/blobs | **PASS** | Paged inventory commits actor-head/frontier/state-vector objects; exact object requests and bounded blob-have query/response are closed. |
| Undefined Project bulk-file intent | **PASS** | Multi-file import is explicitly independent with partial-success reporting; no atomic bulk intent is implied. |
| React Flow/Desktop ownership drift | **PASS** | Canvas owns projection, gesture reduction and view semantics; Desktop owns shell, IPC and platform/transport adapters. |
| Revision-4 cutoff target/cardinality and unlisted proof | **PASS** | Closed replica/member targets and all-pages-before-unlisted semantics survive without registry route authority. |

## 4. Blocking G2-S1 — control imports portable codecs that do not exist

Severity: **P0**. Flaw types: **false schema closure**, **dangling normative
dependency**, **owner mismatch** and **under-bounded external input**.

Control section 2.1 says it imports, by exact exported type identity, these
kernel-owned codecs among others:

```text
PublicKeyV2
MemberIdV2
ReplicaIdV2
SessionIdV2
PeerIdV2
StateVectorV2
```

The kernel artifact defines none of those names. Its shared primitive section
defines `Id128V2`, `ActorIdV2`, `DigestV2`, `SignatureV2`, decimal uint codecs,
`ProjectIdV2`, `CanvasIdV2`, `DocumentScopeDigestV2`, `DocumentScopeV2` and
`PortableStampV2`. Its Yjs section defines exact raw state-vector bytes and a digest
rule, but no exported `StateVectorV2` object/type.

This is not an unused documentation import:

- `MemberIdV2` and `ReplicaIdV2` occur throughout signed membership, reset, cutoff,
  session, directory and ACK records;
- `PublicKeyV2` is signed into trust, member, replica and session objects;
- `SessionIdV2` and `PeerIdV2` are signed into session/rendezvous/handshake objects;
- the active-peer directory sorts by decoded `replicaId`, but no exact decoder for
  `ReplicaIdV2` exists in the authority set;
- `PeerIdV2` has no exact byte/character/length codec, despite being attacker-facing
  PeerJS routing input carried repeatedly inside bounded JCS objects.

One implementation may alias member/replica/session ids to `Id128V2`, another may
use prefixed strings, and two PeerJS adapters may admit different Unicode or length
sets. Both can cite the current prose because the promised exact export is absent.
They will produce different JCS, signatures, sorting and request-size behavior.
Likewise, kernel `CausalSignerAuthorityV2` currently spells member and replica ids as
`Id128V2`; byte equality with the control aliases is only an assumption.

The clean ownership fix is not to make generic collaboration own membership or
Peer policy merely because control has a missing type. Prefer control ownership of
closed `MemberIdV2`, `ReplicaIdV2`, `SessionIdV2`, `PeerIdV2` and the public-key
codec unless another generic kernel use is proved. State-vector is already a
kernel-owned raw-byte format: either define one exact kernel export or remove the
unused DTO import and refer to the existing exact bytes/digest contract. In all
cases, state the exact bounded codec, sorting bytes and alias relation where an id
must equal `Id128V2`.

### Falsifiable test

Generate declarations and validators from only the pinned authority sources in an
empty consumer with `noImplicitAny` and no ambient v9 declarations. Every namespace
import must resolve exactly once. Then run maximum/malformed fixtures for public
keys, member/replica/session ids and PeerJS ids under Bun, Chromium and the service.
Any unresolved name, implementation-selected alias, differing Unicode/length
acceptance or differing signature bytes confirms this blocker.

## 5. Blocking G2-S2 — main still names the retired raw generation epoch

Severity: **P0**. Flaw types: **normative merge drift**, **cross-owner fact
conflict** and **stale canonical summary**.

Main section 11.2 says the canonical first-loss receipt is for:

```text
{projectId,projectEpoch,beginActorId,beginAuthorizationEpoch}
```

That is the only raw `beginAuthorizationEpoch` occurrence in the exact five-file
set. It conflicts with both owners:

- Canvas `GenerationBeginV2` stores `beginAuthorizationEpochDigest` and explicitly
  forbids a raw epoch or implementation-selected hash;
- control `GenerationFirstLossReceiptCoreV2` stores the byte-identical
  `beginAuthorizationEpochDigest`, defined as the exact
  `BeginAuthorizationEpochV2.coreDigest`;
- Canvas's Project-composed verifier requires equality of that digest across the
  begin, reconstructed authorization core and first-loss receipt.

Main section 1.2 makes this conflict decisive: the main file is final for
cross-owner composition, an annex is final for its closed DTO, a main summary may
not reinterpret it, and a genuine contradiction is
`canonical-authority-conflict`. Calling the missing `Digest` suffix editorial would
waive the specification's own anti-fallback rule. A runtime cannot know whether to
require a raw authorization epoch absent from the receipt or the digest expressly
required by the two owner artifacts.

### Falsifiable test

Create two generation begins for the same actor across member/replica authorization
replacement. Present each begin with the other's first-loss receipt. Only the
byte-identical `BeginAuthorizationEpochV2.coreDigest` match may produce the
non-serializable Canvas recovery permit. If a clean implementer asks whether main's
raw field is shorthand, or can compare one raw epoch instead of the complete bound
authorization core, the current set has already failed.

## 6. URI, revision-4 and ownership audit

### Global URI governance

The pinned URI bytes pass the requested global—not Canvas-local—governance model:

- one stateless `@convax/uri` owner and a closed static scheme table;
- the VS Code-style five components remain parsing data, not a resolver or service
  locator;
- Project authority is opaque and case-sensitive under its owner codec;
- `projectId + projectEpoch + entryId`, mutable `path` hint and optional immutable
  blob hash are distinct;
- entry, entry-revision and canonical-string comparisons are explicit;
- Project references are one atomic URI/component value and cannot mix independently
  concurrent id/path/hash fields;
- `ProjectFileId` and content hash remain different identities.

Project persistence uses the same canonical `convax-project` entry/revision shape
and verifies the enclosing project, epoch, file id and blob. No dynamic Plugin
scheme, global resolver or path-as-authority shortcut appears.

The URI document itself still says it requires three reviewers on one digest. A
revision-3 review can bind that exact URI digest, but this G2 report is a rejection,
not one of the required approvals.

### Round-3 revision 4

R3-1 dual checkpoint certification/floor coverage, R3-2 Project-owned shard reset,
R3-3 bounded non-denying registry plus closed cutoff targets/full-page unlisted
proof, and the R3-4 dismissal/first-loss state machines survive in the owner
annexes. R3-4 fails only at the main-file cross-owner field name in G2-S2. No
`docEpoch`, central edit admission or registry route authority has returned.

### Package owner and dependency direction

The target split is coherent:

- collaboration owns generic replica/candidate/frame/journal semantics and no
  Project/Canvas schema, PeerJS or membership policy;
- Canvas owns reducers, semantic undo and React Flow projection/gesture semantics;
- Project owns ProjectIndex, Canvas routes, resources and public composite verifier;
- `@convax/project/node` is the sole private native writer;
- API owns Web-standard membership/rendezvous/attestation/cutoff service
  composition;
- Desktop owns PeerJS, Electron and transport composition.

The existing manifests already provide the correct public Project
`./collaboration-protocol` export and restrict `apps/api` to collaboration plus
Project. The allowed target dependency graph has no Canvas-to-Project or
collaboration-to-Convax-package cycle.

Current repository governance is deliberately still v9, and therefore is not proof
that revision 3 is registered. Root `AGENTS.md` and `docs/architecture.md` still
declare `certifiedTeamDoc`, `workingDoc` and `localForkJournal`; the boundary checker
explicitly requires the frozen v9 receipt and the text `Main-owned
certifiedTeamDoc`. `bun run package:boundaries` passes because it validates that v9
contract. After a repaired revision 3 receives 3/3 approval, the first execution
change must atomically update root/package `AGENTS.md`, `docs/architecture.md`, the
boundary checker and affected manifests before any runtime lane implements
`replicaDoc`. Temporarily satisfying both v9 and v10 tokens would preserve two
authorities and is forbidden.

This current-v9 registration is not scored as a third defect in the unapproved
candidate bytes: keeping the last approved contract active before 3/3 is correct.
It is an independent execution gate, and the candidate's statement that old
architecture prose is merely evidence has no operational force until approval and
the atomic governance cutover.

## 7. Minimum repair and re-review boundary

The next candidate must, at minimum:

1. define every portable control scalar exactly once at its proper owner and remove
   all dangling kernel imports;
2. close public-key and Peer id bytes, lengths, canonicalization and sorting, plus
   explicit alias equality for member/replica/session ids;
3. make main section 11.2 name
   `beginAuthorizationEpochDigest` byte-for-byte;
4. regenerate/recompute every affected artifact ref, kernel bundle instance,
   `coreDigest`/`protocolDigest`, annex-set digest and detached main digest;
5. repeat all three independent reviews on that new indivisible set.

Because repairing G2-S1 changes at least one normative annex, this is not eligible
for a main-only editorial waiver. No implementation lane may start from the current
digests.

After 3/3, the governance/architecture/boundary cutover described in section 6 must
be the first atomic implementation step. It must make the boundary test fail on any
revived v9 accepted/working/local-fork authority.

## 8. Strongest three objections to signing now

1. **The promised schema namespace cannot compile from its own exact imports.** A
   digest over Markdown containing an unresolved portable type still hashes
   reproducibly; it does not define that type's wire bytes.
2. **The cross-owner recovery key has two names and two possible meanings.** The
   whole point of `BeginAuthorizationEpochV2.coreDigest` was to prevent one raw
   epoch from standing in for the complete authorization instance; main revives
   precisely that ambiguity.
3. **A premature implementation would be governed by two incompatible canonical
   runtime models.** The repository currently enforces v9 accepted/working/local
   fork while revision 3 forbids all three. Starting code before repaired 3/3 plus
   the atomic governance cutover would make architecture choice depend on lane or
   import path.

The strongest defense is that all six missing types have obvious intended codecs
and the main tuple has an obvious intended suffix. That defense relies on
**implicit implementer knowledge**. The candidate expressly forbids old code,
author clarification and summary reinterpretation as decoders, so “obvious” cannot
repair the exact authority bytes.

## 9. Falsifiable re-review gates

The architecture is eligible for SIGN only if all of these pass on one new digest
set:

1. a clean generated-consumer build resolves every portable type exactly once with
   no ambient declarations or repository-private imports;
2. Bun, Chromium and service validators accept/reject identical boundary and
   malformed fixtures for every id, key, URI and Peer routing scalar;
3. two clean implementations generate the same artifact manifest, 88-domain union,
   limits/channel digests, bundle JCS, protocol digest and first causal-frame bytes;
4. no raw `beginAuthorizationEpoch` remains at the Canvas/control composition
   boundary, and authorization-replacement cross-replay always rejects;
5. reset approval/confirmation/rollover, pending-editor floor, reconnect inventory,
   cutoff full-page and exact/+1 Canvas write fixtures retain their current results;
6. global URI entry/path/blob comparison and Project resource proof fixtures remain
   byte-identical across platforms;
7. after approval, `bun check` rejects v9 `certifiedTeamDoc`, `workingDoc`,
   `localForkJournal`, document-wide version and renderer/raw-update authority.

## 10. Reviewer signature

Decision: **REJECT**

Score: **6.7 / 10**

Reviewer: `/root/collaboration_api`

Reviewed detached main SHA-256:
`de24e72edd8a7114932b1c4b86ed2491b41d52f241ad7ed66f4752dc2aca0e05`

Reviewed annex-set SHA-256:
`ecdf0018a643bac3e4a45458dfd3e957fe8e4e188ee1965450fd137f4dc1b6b3`

Reviewed `ProtocolSchemaBundleV2.coreDigest` and `protocolDigest`:
`3cb032469da372773d912c27c0e16918bd6379a3c956af83c448013b112ee437`

Reviewed global URI SHA-256:
`298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`

The score is below 7 because the current exact sources cannot resolve every signed
wire scalar or decide the first-loss authorization key without adding unstated
knowledge. The repaired bundle arithmetic, causal kernel, reset transactions,
Project floor, reconnect protocol, URI model and package split do not compensate
for those protocol-language blockers.
