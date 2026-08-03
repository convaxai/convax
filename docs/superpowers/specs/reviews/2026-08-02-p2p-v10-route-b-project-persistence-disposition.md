# Route B Project persistence disposition ledger

Status: Project/store/URI owner audit record. This file is evidence only and is not
part of the five-file authority set.

## 1. Locked inputs

Primary full-spec audit input:

```text
docs/superpowers/specs/drafts/collaboration-v10-route-b-audit-input/appendices/project-persistence.md
pre-clean SHA-256 707d21ca3983024fc634facbc1ea47620739692f3f3eec3a2b3f7c77484c8f72
pre-clean bytes   172092
pre-clean lines   3645
```

Final cross-owner authority inputs were audited as these exact bytes:

| Input | Ordinary SHA-256 | Bytes | Lines | Admitted boundary |
| --- | --- | ---: | ---: | --- |
| `authorities/collaboration-v10/r5/appendices/collaboration-kernel.md` | `cd9dcd59724eeb77cb47f729446d442a72d56cd093caa1efe0a787758d95bffa` | 96,450 | 2,363 | final K-bound owner/fact runtime, quota evidence, Lifecycle D and generic ingress ABI |
| `authorities/collaboration-v10/r5/appendices/control-plane.md` | `30f02414b8d4e7f4645584e845eecf67e04e89d895397a26fe543b5cab64cc63` | 140,665 | 3,426 | final 73-field limits, 62-domain contribution and structural-only F13/RSA verifier |
| `authorities/collaboration-v10/r5/appendices/canvas-schema.md` | `2afb080ef3ba3aed259d1d7501b73552fe02a6e826d3a28cafc746caa314eb19` | 156,514 | 3,386 | final Canvas owner specialization, CGP callable, history semantics and 29-domain contribution |
| `2026-07-31-global-uri-protocol.md` | `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949` | 15,102 | 249 | Project resource identity/use seam only; no URI grammar or resolver copied |

Applied decision inputs are content-addressed below. A whole-file identity does not
admit a rejected section from that file:

| Input | Ordinary SHA-256 | Bytes | Lines | Sections admitted for this owner |
| --- | --- | ---: | ---: | --- |
| `drafts/collaboration-v10-r5-v6-cross-review-docket.md` | `7a7b9ccc57b0837dd44a9a30bfb16a05e6f4a617b1897e618df937923d85e54e` | 11,470 | 277 | C, D, E, F only |
| `drafts/collaboration-v10-r5-v8-ghi-unique-delta.md` | `f91a36bffa8cd8e60a124305bcc40f71fcb062f77c0b11726a645eec9de07b46` | 37,253 | 1,185 | I only |
| `drafts/collaboration-v10-r5-v9-gh-unique-delta.md` | `414d72f394df7ad6151cb97811e511f3492d66ae9b794a9573d774242d9a7f9b` | 47,846 | 1,440 | G and Project-side H |
| `drafts/collaboration-v10-r5-v10-minimal-delta.md` | `1707fcc34c103d6fb8483f7f2fca89c1d2c21dabfb2a6d937b60eb36a8ce24ae` | 22,161 | 713 | exact admission publication boundary, metadata-GC retained clauses, attempt-key ACK outbox |
| `drafts/collaboration-v10-r5-v11-minimal-delta.md` | `1fa16f31ab2acc719a873e9277814fb41f3c5620b3a7674ee2d2cba41c285b8a` | 15,168 | 424 | publication pointer/barriers, acyclic candidate, delete tombstone, generic ACK query |
| `drafts/collaboration-v10-r5-v12-minimal-delta.md` | `61c390d2206feab796928763c24a5da4e1d1fdbca23d30c0e6d4fbc2a11efbc8` | 19,450 | 537 | closed publication recovery graph, ten-kind union, recovery-root commitment and GC eligibility |
| `drafts/collaboration-v10-r5-v13-minimal-delta.md` | `aaa24cfd86a74f1080ab6fc8b6068e002971d50e9e050297876fe64ecd2b02e6` | 17,310 | 404 | 1.1 and 1.3 through 1.9 native destructive capability |
| `drafts/collaboration-v10-r5-v14-minimal-delta.md` | `a29b202e94c4c2446f52a0648dae01bd2380b56a97eb66ed5b7861050d2dfe41` | 20,546 | 482 | 1.1 through 1.8 exhaustive ten-kind location authority |

The third-round Project audit was rerun fresh against every exact byte identity in
both manifests. Filenames, earlier observations and superseded draft prose were not
used to fill a field, owner, limit, transition or cross-owner ABI.

Rejected or superseded source text has no fallback force. In particular: the
rejected v5.4 candidate, v5.7, v5.8 G/H, v5.6 G/H/I prose, COW96, three-record
admission ledger, direct Project/node Kernel brands, old ACK enqueue, path-based
metadata deletion, wider publication recovery records and every author-vote/review
section were excluded.

## 2. Pre-clean section disposition

`KEEP` means semantic content survives in one terminal section. `FOLD` means later
terminal corrections replace the source wording. `DROP` means provenance, review or
superseded wording has no normative descendant.

| Pre-clean section | Disposition | Final destination / reason |
| --- | --- | --- |
| 1 Scope, precedence and owners | FOLD | final 1; missing-base precedence and predecessor claims removed |
| 2 Canonical scalar and encoding rules | KEEP | final 2 |
| 2.1 Operation-derived identities | KEEP | final 2.1 |
| 2.2 Portable names and paths | KEEP | final 2.2; global URI grammar remains external |
| 3 Exact ProjectIndexYDoc topology | KEEP | final 3 |
| 3.1 Identity | KEEP | final 3.1 |
| 3.2 Entry/location/tombstone | KEEP | final 3.2 |
| 3.3 Content/promotion/reservation/resource | KEEP | final 3.3 with global URI reduced to the Project seam |
| 3.4 Content projection | KEEP | final 3.4 |
| 3.5 Canvas route facts | KEEP | final 3.5 |
| 3.6 Live-scope manifest | KEEP | final 3.6 |
| 3.7 Operation receipts | KEEP | final 3.7 |
| 4 Closed validation and canonical projection | KEEP | final 4 |
| 4.1 Project canonicalizer binding | KEEP | final 4.1 |
| 4.2 Canonical state/nine-root encoding | KEEP | final 4.2 and its four subsegments |
| 4.3 Derived-digest ledger and 4.3.1–4.3.8 | KEEP | final 4.3 and its eight subsegments |
| 4.4 predecessor domain-registry delta | DROP | no predecessor ancestry in standalone candidate |
| 5 Resource/filesystem/materialization boundary | KEEP | final 5 |
| 6 Caps and preallocation gates | KEEP | final 6; admission-specific limits also final 16.2 |
| 7 Closed ProjectIndex typed intents | KEEP | final 7 |
| 8 Project-owned Canvas shard reset | KEEP | final 8 |
| 8.1 Route-CAS core | KEEP | final 8.1 |
| 8.2 Initiator authority and 8.2.1 chain | KEEP | final 8.2/8.2.1; current Control objects remain imported |
| 9 Native frame commit/reopen | KEEP | final 9 |
| 9.1 Local records | KEEP | final 9.1 |
| 9.2 Local success barrier | KEEP | final 9.2 |
| 9.3 Crash reopen matrix | KEEP | final 9.3 |
| 9.4 Remote receive/ACK barrier | KEEP | final 9.4 |
| 10 Native store layout | FOLD | final 10 plus terminal admission metadata locations in final 19.2 |
| 11 Checkpoint install/pruning/object GC | KEEP | final 11; frame scan closure final 18 |
| 11.1 Checkpoint installation | KEEP | final 11.1 |
| 11.2 Prune plan | KEEP | final 11.2 |
| 11.3 Object collection | FOLD | final 11.3 plus final 18; Kernel GC authorization stays private |
| 12 Blob presence/replication/GC | KEEP | final 12 |
| 13 Breaking Project cutover/reset | KEEP | final 13; unsupported bundle bytes fail closed |
| 14 Failure-state contract | KEEP | final 14 |
| 15 Mandatory tests | KEEP | final 15 and final 20 |
| 15.1 and 15.1.1 goldens | KEEP | final 15.1/15.1.1 |
| 15.2 convergence/model | KEEP | final 15.2 |
| 15.3 frame crash | KEEP | final 15.3 |
| 15.4 reset/checkpoint/GC crash | KEEP | final 15.4 |
| 15.5 predecessor closure conformance | DROP | predecessor-specific counts/digests are not standalone authority |
| 16 Red-team decision and 16.1–16.3 | DROP | review prose belongs in this ledger, not normative authority |
| 17 persistence/recovery replacement and 17.1–17.5 | FOLD | final 9/16; replacement wording and predecessor names removed |
| 18 native ingress/wrapper replacement and 18.1–18.7 | FOLD | final 16/17; Project/node returns only plain evidence |
| 19 Project reset portable contract and 19.1–19.3 | FOLD | final 8/13; duplicate reset DTO layers removed |
| 20 dependency store/reset gate/sole apply | FOLD | terminal admission/RSA/reset semantics in final 16/17/8 |
| 20 Four immutable local record classes | FOLD | final 16.2 admission records/COW roots |
| 20 Fold, quota and transitions | FOLD | final 16.2 |
| 20 Permanent high-water/paged checkpoint | FOLD | final 16.2 recursive checkpoint and epoch-reset retention |
| 20 Stable transfer/live reservation fold | FOLD | final 16.2/16.3 |
| 20 Install/malformed/conflict/ACK | FOLD | final 16.3/17 |
| 20 Native identity/GC | FOLD | final 18/19 |
| 20 Reset witness/semantic currentness/sole apply | FOLD | final 8/17.1; Control structural F13 and Canvas verifier remain their owners |
| 20 Project falsifiers | KEEP | consolidated final 20 |

## 3. Final section ownership and falsifier ledger

Every top-level and second-level final section has one source set, owner, cross-owner
seam and direct falsifier.

| Final section | Disposition/source | Owner | Required seam | Primary falsifier |
| --- | --- | --- | --- | --- |
| 1 Scope/authority counts | normalized from input 1 plus v5.6 C–F and v5.9 G/H | Project + Project/node | Kernel brands and Desktop ACK remain external | duplicate owner/head or branded Project/node return |
| 2 plus 2.1–2.2 scalars/identity/path | input 2 plus global URI 4–7 seam | Kernel owns shared scalars; Project owns derived entry/fact ids; URI remains `@convax/uri` | exact Kernel type imports and opaque canonical URI components | re-declared scalar, copied URI grammar, caller id or native path identity |
| 3 plus 3.1–3.7 ProjectIndex | input 3 | Project | Kernel Yjs/frame; CanvasYDoc remains Canvas | root count not nine, silent LWW or registry-selected route |
| 4 plus 4.1–4.3.8 canonical projection | input 4 excluding predecessor registry delta | Project | Kernel canonicalizer descriptor | history-dependent bytes, digest cycle or unchecked write |
| 5 resource/materialization | input 5 | Project + Project/node | URI and blob ports | Canvas reference split into independently writable fields |
| 6 caps | input 6 | Project | Kernel ingress caps compose separately | cap excess truncates rather than rejects |
| 7 plus 7.1–7.3 typed intents/selected owner | input 7 plus terminal Kernel K-bound owner ABI | Project raw protocol/closure and fact codecs; Kernel wraps runtime/ports | raw Yjs, caller ids, history, unconstrained fact factory, dependency mismatch or different local/remote reducer |
| 8 plus 8.1–8.2.1 Canvas reset | input 8/19/20 terminal reset seam | Project uniquely declares activation, reset commit, route-CAS core and claim/core | exact Control/Canvas live authority imported by owner | duplicate DTO, carrier digest cycle, two current routes or non-editor reset |
| 9 plus 9.1–9.4 commit/reopen | input 9 plus v5.6 E and 3/3 lifecycle D ruling | Project/node durable barrier | Kernel owns the sole `replicaDoc` and one isolated `candidateDoc` | second live document, intent journal, success before head or re-signed recovery |
| 10 native layout | input 10, narrowed by final 19.2 | Project/node | digest-native-key only | user/URI/path text in private filename |
| 11 plus 11.1–11.3 checkpoint/prune | input 11 plus final 18 | Project/node under Kernel gate | service certificate and editor floors | prune without dual gate or scan-selected head |
| 12 blob presence/ACK/GC | input 12 | Project current roots; Project/node bytes | Canvas roots and Desktop transfer | ACK before fsync/index or ordinary-file GC |
| 13 breaking reset | input 13/19 normalized standalone | Project composition; Project/node publish | current Control approval/rollover | implicit migration/delete or mixed-tree reopen |
| 14 failure contract | input 14 | Project product contract | Desktop renders exact state | local saved displayed as team replicated |
| 15 plus 15.1–15.4 conformance | input 15 excluding predecessor closure | all named owners | clean implementations | stale embedded predecessor identity is required |
| 16 plus 16.1–16.3 remote ingress | v5.6 C–F, v5.9 G, v5.10–12 publication chain plus terminal four-cap quota ABI | Project/node records/CAS; Kernel cursor, quota mirrors and brands | exact imported cursor, quota reservation/transfer evidence and generic owner ports | re-declared cursor, brand crosses port, cap-plus-one write, COW96/per-key head or command replay |
| 17 plus 17.1–17.2 carrier owners/ACK | v5.9 H, v5.10 §3, v5.11 §4 plus terminal owner-dedup/currentness ruling | Project uniquely owns one Canvas-genesis authority/port, one RSA authority/port, semantic/currentness, receipt/attempt/outbox; Desktop implements outbox | exact Control structural verifier, Canvas artifact-bound callable and Kernel generic install/quota receipt | generic Canvas runtime capture, shared union port, missing currentness phase, wrong scope/subject/ACK evidence or indeterminate retry without query |
| 18 frame-object scan GC | approved v5.8 I and v5.6 F | Kernel command/authorization; Project/node records | exact imported plain GC command only | re-declared command, changed source head deletes or branded auth crosses port |
| 19 plus 19.1–19.3 metadata GC | final v5.10–14 chain | Project/node | publication recovery roots | not ten kinds, second map/capability or path-reopen unlink |
| 20 plus 20.1 final gates | consolidated delta falsifiers | three independent owners | identical five-file hashes | clean-room needs draft or signers disagree |

## 4. Final declaration counts

```text
ProjectIndex authority per Project epoch                         1
CanvasYDoc authority per live Canvas shard                      1
Kernel replicaDoc per open document shard                       1
isolated candidateDoc per validation attempt                    0..1
additional live document roles beyond replica/candidate         0
durable business-command overlays or journals                   0
Project/node private writer per open Project                    1
document-wide version / JSON mirror / renderer document store  0
admission epoch-head pointer per Project epoch                  1
admission publication recovery pointer per Project epoch        1
metadata-GC head pointer per Project epoch                      1
stable-key/member mutable heads                                 0
admission COW maps                                              2
COW internal maximum                                            74
metadata object kinds/locations                                10
metadata native delete capabilities                             1
caller/native path authorities                                  0
caller ACK bytes/routing authorities                            0
Kernel-branded GC authorization across persistence boundary     0
Project route/reset DTO declarations                            4
Control route/reset DTO copies                                  0
Project digest-domain contributions                            17
ProjectIndex selected raw owner definition                      1
ProjectIndex history materializer                               0
Project dependency-carrier authorities/selected owner ports     2 / 2
Project dependency-carrier owner factory                        1
Project semantic/currentness/receipt/key/outbox                  1 each
Control copies of Project RSA declarations                      0
```

Any different count rejects this owner signoff.

## 5. Lifecycle, ABI and domain-list closure

The 3/3 architecture ruling selects lifecycle D. A local commit creates the final
long-lived-replica-signed causal frame before the object/outbox/journal/head durable
barrier. The same bytes are retained and sent after reconnect. Replica ACK is
delivery/durability metadata and cannot promote, replay, renumber or re-sign the
business operation. Incoming frames are verified from their exact authored causal
base in one isolated candidate before the exact object/journal/head barrier and ACK.

The Project appendix imports, rather than re-declares, these Kernel-owned ABI names:

```text
ActorIdV2
CanvasIdV2
CausalSignerAuthorityV2
DigestV2
DocumentOwnerProtocolDefinitionV2
DocumentOwnerRuntimeV2
DocumentScopeV2
FrameObjectRefV2
GarbageCollectFrameObjectPersistenceCommandV2
Id128V2
MemberIdV2
OpenRemoteIngressSequentialCursorPortResultV2
OwnerCanonicalizerDescriptorV2
OwnerExternalFactPortFactoryV2
OwnerExternalFactPortV2
OwnerExternalFactRequirementV2
OwnerExternalFactResolverDefinitionV2
OwnerIntentClosureDefinitionV2
OwnerIntentDependenciesV2
OwnerProcessValueFactoryV2
PortableStampV2
ProjectIdV2
RemoteIngressByteCursorReadV2
RemoteIngressEvidenceMissingObjectV2
RemoteIngressKindV2
RemoteIngressOwnerAckBindingV2
RemoteIngressQuotaReservationPortEvidenceV2
RemoteIngressQuotaTransferPortEvidenceV2
RemoteIngressSequentialCursorPortHandleV2
RemoteNonFrameIngressOwnerPortFactoryV2
RemoteNonFrameIngressOwnerPortV2
RemoteTransferAttemptBindingV2
ReplicaIdV2
SelectedDocumentOwnerArtifactDefinitionV2
SignatureV2
StableRemoteTransferKeyV2
Uint32V2
Uint64V2
```

Project uniquely owns the four route/reset declarations, the raw ProjectIndex owner
specialization and closed external-fact codecs/permits, the complete Project
semantic/currentness seam, both concrete dependency-carrier kind literals and their
separate authority/selected-port bindings, the durable carrier receipt, attempt key,
outbox contract and the state machine containing `outbound-indeterminate`. Control
imports the reset declarations and uniquely owns only RSA carrier bytes and its
structural verifier. Canvas uniquely owns the artifact-bound Canvas genesis exact-
byte callable/result; Project captures that callable and digest, never a generic
Canvas runtime.
No portable Project DTO binds the enclosing RSA carrier or evidence digest; exact
bytes and the plain verifier result are bound only in the process-local attempt
registry, avoiding the carrier-to-claim-to-carrier hash cycle.

The Project owner digest-domain contribution list is fixed at 17 entries, strictly
ascending by raw UTF-8 bytes and duplicate-free before the four-owner union. Kernel
and Control domains are excluded. The two added members are exactly
`convax.native-document-store-key/2` and `convax.native-object-store-key/2`. Any
missing, extra, reordered or aliased entry rejects generation.

## Mechanical audit record

| Check | Result |
| --- | --- |
| Project imported Kernel/Control/Canvas ABI names missing from frozen owner declarations | 0 |
| unconstrained Project alias of a Kernel generic | 0 |
| ProjectIndex fact factory caller-selected owner parameter | 0 |
| ProjectIndex owner history materializer | 0 |
| local/remote protocol or closure implementation split | 0 |
| direct Project interface/union authority overlap with Kernel/Control/Canvas, excluding exact import aliases | 0 |
| dependency-carrier kinds / registered Project authorities / selected owner ports | 2 / 2 / 2 |
| carrier scope/subject policies | Canvas scope + checkpoint digest; ProjectIndex scope + claim-core digest |
| RSA embedded Canvas identity | new scope + staged checkpoint + authored-base reachable predecessor activation frame |
| carrier ACK policies with `authority="project-private-carrier-ack"` and `evidenceDigest=ownerInstallRecordDigest` | 2 |
| RSA Project semantic/currentness phases | 4, same eight-check gate |
| aggregate ingress quota caps | 4 exact imported fields; equality admitted; plus-one zero-write; transfer keeps all four totals byte-identical |
| Project digest-domain contribution | 17, raw UTF-8 sorted, unique |
| Markdown backtick fences | 160, even |
| Markdown tilde fences | 0, even |
| trailing whitespace | 0 |
| final LF | present |

## 6. Project owner output identity

```text
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md
post-clean SHA-256 5fa9ab986f8f191e595bd7c516014414962eb9d2f57a8a800e0ab0b816def654
post-clean bytes   182204
post-clean lines   3826
```

This identity is a Project-owner audit output, not an active authority pointer.
Any later byte change invalidates this ledger entry and requires the Project owner
to repeat the ancestry, source-disposition, duplicate-authority, path, crash and
falsifier audits before signing a five-file set.
