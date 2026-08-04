# Route B Kernel/Control disposition ledger

Status: **single disposition ledger for the Route B Kernel/Control final-candidate
partition. This ledger is evidence, not protocol authority.**

## 1. Frozen audit inputs and write scope

| Input | Ordinary SHA-256 | Disposition |
| --- | --- | --- |
| `drafts/collaboration-v10-route-b-audit-input/appendices/collaboration-kernel.md` | `3616e02b7fcf259dff2ea719d5eae5bd3199b221f15a4f5aa7eef3ad1bfdc1ec` | audit input only |
| `drafts/collaboration-v10-route-b-audit-input/appendices/control-plane.md` | `e32201dd8d5a3c17745eee9f3fcf62b4b6df41a190721ad18c65a04e6f88a19e` | audit input only |

Only these final-candidate targets are covered:

- `appendices/collaboration-kernel.md`;
- `appendices/control-plane.md`.

Main, Canvas, Project, manifest and stable pointer are outside this partition.
Drafts supply disposition evidence only. No prior authority ancestry, vote or digest
is inherited.

## 2. Removed audit-input segments

| Audit-input segment | Disposition | Reason | Replacement |
| --- | --- | --- | --- |
| Kernel §17 decision prose | delete | review material is not normative protocol | final §21 mechanical falsifiers |
| Kernel §§18–20 versioned additive tails | delete and re-express | ancestry/replacement structure and duplicate declarations | final §§17–20 |
| Kernel §21 embedded bundle instance | delete | stale/self-referential activation material | final §4 external assembly rule |
| Control §16 decision/SHA prose | delete | review and provenance are outside protocol | this ledger and external 3/3 evidence |
| Control §§17–19 versioned tails | delete | Project RSA/currentness/attempt/ACK contracts belong only to Project; Control retains no restatement | Project annex sole declarations; Control final §§16/18 only |
| Control unnumbered terminal replacement tails | delete | direct ACK, Project semantic and ancestry language are foreign to Control | Project-owned attempt outbox; Control structural verifier only |

## 3. Kernel section disposition

| Final section | Disposition | Source | Sole owner | Seam | Falsifier |
| --- | --- | --- | --- | --- | --- |
| 1. Scope, owner and dependency direction | replace-and-close | audit-input §1 + Route B owner decision | @convax/collaboration | owner packages provide ports; host owns transport; persistence returns plain evidence | collaboration imports an owner package or mints owner semantics |
| 2. Shared portable primitives | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 2.1 Exact scalar codecs and rejection boundary | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 3. Restricted JCS, digest and signature rules | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 4. Four-owner artifact contract and no-self-reference rule | replace-and-close | audit-input §4, self-reference removed | @convax/collaboration | external assembler computes all artifact and bundle digests | annex embeds its own digest or substitutes whole-file SHA |
| 5. Exact Yjs wire codec | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 5.1 Stable replica-derived Yjs client id | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 6. Causal heads, frontiers and actor chains | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 7. Closed causal context and dependency refs | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 8. Generic typed-intent and actual-write evidence sections | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 9. Exact causal-edit core, header and binary frame | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 9.1 Causal payload | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 9.2 `CVXCOLL2` causal-edit envelope | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 10. Owner verifier and canonical-state ports | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 10.1 Closed descriptor and scalar constraints | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 10.2 Owner protocol port and binding | replace-and-close | 3/3 non-author review; second-round exact-generic rejection closure | @convax/collaboration | one `K` binds requirement/dependencies/result/resolver/history/closure/port/factory/runtime; attempt creation is closed `created/rejected` | caller selects another `K`, bare owner union re-enters the chain, malformed dependencies mint a port, or owner mints a Kernel brand |
| 11. Replica and candidate documents | replace-and-close | 3/3 `LIFECYCLE D` decision | @convax/collaboration | sole durable `replicaDoc`; isolated temporary `candidateDoc`; replication status separate | second long-lived Y.Doc, delayed local conversion or ACK-gated local authority |
| 12. Generic persistence, journal and recovery ports | replace-and-close | audit-input §§12–13 + R5.6 E | @convax/collaboration | plain persistence evidence -> Kernel validation/brand | below-head projection/ACK or persistence-minted brand |
| 13. Incoming-frame validation and replica application | replace-and-close | audit-input §§12–13 + 3/3 `LIFECYCLE D` | @convax/collaboration | authored-base candidate validation -> final frame barrier -> sole replica apply | arrival-order validation, command replay or ACK before durable application |
| 14. Session undo coordinator | replace-and-close | audit-input §14 + 3/3 `LIFECYCLE D` | @convax/collaboration | semantic inverse becomes a new final frame; no raw UndoManager bytes; restart clears | cursor moves before durable replica apply or undo survives restart |
| 15. Exact kernel caps and failure contract | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 16. Mandatory conformance tests | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 16.1 Cross-runtime byte goldens | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 16.2 Model and permutation tests | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 16.3 Crash and port-contract tests | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 16.4 Clean package gate | retain-and-clean | audit-input kernel SHA 3616e02b…c1ec, same numbered section | @convax/collaboration | pure portable contract; owner data enters only through typed ports | byte/codec divergence, duplicate owner, or package/runtime leak |
| 17. Remote ingress capability chain | insert-consolidated | R5.5 §§2–4 + R5.6 A/C–F + approved R5.8 I | @convax/collaboration | plain owner-persistence facts -> process-only Kernel capability | structural/plain value acts as brand or ACK |
| 17.1 Generic kinds, reservation and completed staging | replace-and-close | R5.5 §2 + 3/3 generic-owner correction + aggregate-quota closure | @convax/collaboration | generic `K` scalar plus limits-bound plain quota evidence; owner closes each literal and native store records | Kernel enumerates a concrete kind/native record, accepts a quota +1 or double-charges reconnect |
| 17.2 Sequential cursor bridge | insert-consolidated | R5.6 C | @convax/collaboration | plain owner-persistence facts -> process-only Kernel capability | structural/plain value acts as brand or ACK |
| 17.3 Owner validation and immutable object durability | replace-and-close | R5.5 §§3.1–3.2 + generic-owner correction | @convax/collaboration | plain owner-persistence facts -> process-only Kernel capability | structural/plain value acts as brand or ACK |
| 17.4 Generic owner installation | replace-and-close | R5.5 §3.3 + generic `<K,A>` correction + quota-transfer closure | @convax/collaboration | exact owner-selected `<K,A>` port/install chain plus plain reservation-to-owner quota-transfer mirrors | Kernel interprets K/A/native records, drops/increments a charge during transfer, or a mismatch mints receipt |
| 17.5 Owner-selected terminal policy | replace-and-close | 3/3 owner-boundary correction | selected owner; Kernel binds only `<K,A>` | no Kernel route matrix, concrete kind, ACK literal or attempt key | Kernel chooses a route/ACK or exposes Project policy |
| 17.6 Plain quarantine, scan fence and GC commands | insert-consolidated | R5.5 §4 + R5.6 E/F + approved R5.8 I.1/I.3 | @convax/collaboration | plain owner-persistence facts -> process-only Kernel capability | structural/plain value acts as brand or ACK |
| 18. Project-epoch evidence admission | insert-consolidated | approved R5.9 G.1/G.6/G.8 | @convax/collaboration | Kernel owns commands/receipt factory; owner adapter owns native records/COW heads | per-key mutable authority, native record as receipt, or evidence-only admission |
| 18.1 Commands and monotonic authority seam | insert-consolidated | approved R5.9 G.1/G.6/G.8 | @convax/collaboration | Kernel owns commands/receipt factory; owner adapter owns native records/COW heads | per-key mutable authority, native record as receipt, or evidence-only admission |
| 18.2 Plain transition evidence and Kernel receipt | insert-consolidated | approved R5.9 G.1/G.6/G.8 | @convax/collaboration | Kernel owns commands/receipt factory; owner adapter owns native records/COW heads | per-key mutable authority, native record as receipt, or evidence-only admission |
| 18.3 Metadata-GC isolation | insert-consolidated | approved R5.9 G.10 + R5.10–R5.14 negative isolation | @convax/collaboration | Kernel owns commands/receipt factory; owner adapter owns native records/COW heads | per-key mutable authority, native record as receipt, or evidence-only admission |
| 19. Generic transfer-attempt binding | insert-consolidated | approved R5.9 H.1/H.4 + R5.10 §3 ownership | @convax/collaboration | Kernel attempt binding -> Project-owned currentness/ACK gate | binding alone ACKs or exposes routing identity |
| 19.1 Process identity | insert-consolidated | approved R5.9 H.1/H.4 + R5.10 §3 ownership | @convax/collaboration | Kernel attempt binding -> Project-owned currentness/ACK gate | binding alone ACKs or exposes routing identity |
| 19.2 ACK ownership seam | insert-consolidated | approved R5.9 H.1/H.4 + R5.10 §3 ownership | @convax/collaboration | Kernel attempt binding -> Project-owned currentness/ACK gate | binding alone ACKs or exposes routing identity |
| 20. Native recovery and deletion isolation | insert-consolidated | approved R5.10–R5.14 negative isolation | @convax/collaboration boundary; implementation remains @convax/project/node | no host-private I/O or metadata authority crosses generic ports | native result mutates Y.Doc, mints a brand, adds a domain, or ACKs |
| 20.1 Project/node-only facts | insert-consolidated | approved R5.10–R5.14 negative isolation | @convax/collaboration boundary; implementation remains @convax/project/node | no host-private I/O or metadata authority crosses generic ports | native result mutates Y.Doc, mints a brand, adds a domain, or ACKs |
| 20.2 Zero-authority rules | insert-consolidated | approved R5.10–R5.14 negative isolation | @convax/collaboration boundary; implementation remains @convax/project/node | no host-private I/O or metadata authority crosses generic ports | native result mutates Y.Doc, mints a brand, adds a domain, or ACKs |
| 21. Closed owner counts and conformance | insert-consolidated | all accepted Route B Kernel/Control inputs | @convax/collaboration | mechanical declaration-count and cross-runtime gate | any listed zero path or owner count differs |
| 21.1 Declaration counts | insert-consolidated | all accepted Route B Kernel/Control inputs | @convax/collaboration | mechanical declaration-count and cross-runtime gate | any listed zero path or owner count differs |
| 21.2 Mandatory falsifiers | insert-consolidated | all accepted Route B Kernel/Control inputs | @convax/collaboration | mechanical declaration-count and cross-runtime gate | any listed zero path or owner count differs |

## 4. Control section disposition

| Final section | Disposition | Source | Sole owner | Seam | Falsifier |
| --- | --- | --- | --- | --- | --- |
| 1. Ownership and dependency boundary | replace-and-close | audit-input §1 + approved R5.9 H.1 + R5.10 §3 ownership | explicit owner matrix | structural Control, Project semantics, API service, Desktop transport remain distinct | Control mints Project brand/currentness/ACK or Desktop owns semantics |
| 2. Imported canonical primitives and control-plane descriptor | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol or @convax/api as stated | imports Kernel/URI/Project protocol types by exact public identity | redeclared primitive, self digest, copied registry, or runtime package edge |
| 2.1 Primitive codecs | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol or @convax/api as stated | imports Kernel/URI/Project protocol types by exact public identity | redeclared primitive, self digest, copied registry, or runtime package edge |
| 2.2 Digest and signature rule | replace-and-close | audit-input control SHA e32201dd…a19e + wrapper-domain audit | @convax/project/collaboration-protocol or @convax/api as stated | exactly 62 Control contributions include four distinct complete checkpoint-wrapper domains in addition to signed cores | missing/duplicate wrapper domain, core/wrapper substitution, self digest, or copied registry |
| 2.3 Kernel bundle binding and control constants | replace-and-close | audit-input control SHA e32201dd…a19e + aggregate-quota audit | @convax/project/collaboration-protocol or @convax/api as stated | exact 73-field limits object includes Project-epoch 8192/512 MiB and source-member 512/128 MiB generic ingress caps | count differs, retired key decodes, limit +1 admits, or Control implements native quota storage |
| 3. Service trust and membership state | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 3.1 Trust bundle | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 3.2 Epochs and counters | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 3.3 Service-reserved replica identity | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 3.4 Member, replica and snapshot | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 3.5 Credentials and offline edit authorization | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 4. Replay-safe membership mutations | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 4.1 Challenges | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 4.2 Closed proof union | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 4.3 Atomic mutation and idempotency | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 4.4 Destructive reset evidence and team epoch rollover | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 4.4.1 Exact shard-reset principal and signature closure | replace-and-close | 3/3 cross-owner cleanup | Control protocol structural closure | carrier-contained identity/digest/signature equality only; Project separately proves edit/floor/route/reservation/admin currentness | F13 resolves a candidate, floor, edit authorization or private reservation state |
| 4.4.2 F13 structural verification only | replace-and-close | 3/3 cross-owner cleanup | Control protocol | exact carrier bytes -> thirteen structural/cryptographic steps -> plain diagnostic | Control evaluates currentness, route, Y.Doc, owner install or ACK |
| 5. Session credential and rendezvous | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 5.1 Session challenge and proof | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 5.2 Session credential | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 5.3 Active-peer directory | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 5.4 Freshness-ticket request and ticket | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api for service state; protocol DTOs in @convax/project/collaboration-protocol | signed DTOs and service metadata only | service orders edits or persists Project/Canvas payload |
| 6. Transport-independent Peer connection and four channels | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 6.1 Connection handshake | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 6.2 Independently bound channel opens | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 6.3 Signed message envelope and sequence | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 6.4 Control body union | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 6.5 Transfer manifest, chunks and cancellation | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 6.6 Awareness | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol DTO; @convax/desktop adapter | four portable channels; concrete connection objects stay private | connection callback/object enters DTO or transport grants identity |
| 7. Durable replication ACKs | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol | durability ACK authenticates holder only | ACK proves edit authority, blob/frame cross-substitution, or precedes durable state |
| 8. Checkpoint carrier and content certificate | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 8.1 Checkpoint candidate | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 8.2 Streaming carrier | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 8.3 Content certificate | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 8.4 Owner canonicalizer and atomic registry audit | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 9. Causal floors and prunable checkpoint sets | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 9.1 Project-wide installed floor for editor activation | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 10. Registered-scope state machine | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 10.1 Registration and abandonment | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 10.2 Registry snapshot and fold | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 11. Cutoff target, coverage and authorization mutation | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 11.1 Closed target | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 11.2 Coverage leaves, pages and root | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 11.3 Authorization mutation | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 11.4 Canonical generation first-loss receipt | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 12. Quotas and hard limits | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/project/collaboration-protocol + @convax/api metadata | content certificates/floors/registry/cutoff never become Project route authority | candidate/floor/registry metadata exposes payload or changes ordinary edit order |
| 13. Service durable store and payload-zero boundary | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api | payload-zero durable service boundary | Yjs/frame/blob/native bytes enter durable control storage or logs |
| 14. Failure-state contract | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | @convax/api | payload-zero durable service boundary | Yjs/frame/blob/native bytes enter durable control storage or logs |
| 15. Golden, model and security tests | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | cross-owner conformance | Bun/Chromium/service byte identity and state-machine gates | permutation, fault, or cross-runtime result differs |
| 15.1 Byte and cross-runtime goldens | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | cross-owner conformance | Bun/Chromium/service byte identity and state-machine gates | permutation, fault, or cross-runtime result differs |
| 15.2 State-machine tests | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | cross-owner conformance | Bun/Chromium/service byte identity and state-machine gates | permutation, fault, or cross-runtime result differs |
| 15.3 Security and durability tests | retain-and-clean | audit-input control SHA e32201dd…a19e, same numbered section | cross-owner conformance | Bun/Chromium/service byte identity and state-machine gates | permutation, fault, or cross-runtime result differs |
| 15.4 Reset-carrier structural tests | replace-and-close | 3/3 Control-boundary cleanup | cross-owner conformance | closed carrier/fence/import tests only | Project semantic/currentness test appears in Control |
| 16. Closed reset-authorization carrier and structural verifier | replace-and-close | 3/3 non-author reviews | Control protocol | one `CVXRSA02` DTO + one synchronous callable; Project semantics remain imported seam | missing carrier type, duplicate Project DTO or structural result becomes authority |
| 16.1 Exact wire DTO | replace-and-close | 3/3 non-author reviews | Control protocol | eleven exact sections; Project route/reset types imported | carrier/claim digest cycle, gap/overlap or stale alias |
| 16.2 Sole synchronous verifier | replace-and-close | 3/3 non-author reviews | Control protocol | exact bytes -> closed structural result | Promise/phase/currentness/ambient lookup |
| 16.3 Project semantic and ACK import seam | replace-and-close | 3/3 non-author reviews | Project owns named contracts; Control has zero declarations | reference-only owner list | Control redeclares RSA authority, attempt key, outbox or `queryAttempt` |
| 18. Isolation, counts and mandatory falsifiers | insert-consolidated | approved R5.10–R5.14 negative isolation + all owner counts | explicit closed owner table | native metadata and transport remain adapters, never protocol authority | owner count differs, native result becomes evidence, or forbidden route exists |
| 18.1 Native and transport isolation | insert-consolidated | approved R5.10–R5.14 negative isolation + all owner counts | explicit closed owner table | native metadata and transport remain adapters, never protocol authority | owner count differs, native result becomes evidence, or forbidden route exists |
| 18.2 Closed owner counts | insert-consolidated | approved R5.10–R5.14 negative isolation + all owner counts | explicit closed owner table | native metadata and transport remain adapters, never protocol authority | owner count differs, native result becomes evidence, or forbidden route exists |
| 18.3 Mandatory falsifiers | insert-consolidated | approved R5.10–R5.14 negative isolation + all owner counts | explicit closed owner table | native metadata and transport remain adapters, never protocol authority | owner count differs, native result becomes evidence, or forbidden route exists |

## 5. Cross-annex closure

| Seam | Kernel side | Control side | Required zero path |
| --- | --- | --- | --- |
| owner runtime | raw owner definition -> Kernel branded runtime/fact-port factories | Control uses only generic `DocumentOwnerProtocolPortV2<K>` where required | owner-minted Kernel brand or unresolved ambient ABI |
| external facts | exact same `K` through requirement/dependencies/result/resolver/history/closure/port/factory/runtime; closed attempt creation | no owner fact semantics | method-level owner reselection, bare union or malformed dependencies produce a port |
| RSA install | generic selected owner-port factory and exact `<K,A>` receipt | one closed Control carrier/verifier; Project alone owns semantic F13/currentness | Control-minted Project authority |
| ingress quota | generic limits-bound reservation evidence and owner-install charge-transfer mirrors | exact four aggregate constants inside the 73-field limits object | Project-native record enters Kernel/Control, quota +1 admits, reconnect charges twice or transfer drops charge |
| carrier attempt | generic process-only `RemoteTransferAttemptBindingV2<K>` | Project alone owns carrier kind/receipt/attempt key/`queryAttempt<K>` | Kernel/Control concrete kind or old-attempt ACK |
| persistence evidence | plain evidence validator and private process brands | Project/node remains adapter owner | adapter-minted brand |
| terminal message | no transport/routing API | Project semantic ACK contract; Desktop outbox adapter | caller ACK bytes/body/connection/transfer id |
| native recovery | plain command/evidence boundary only | no portable native deletion DTO | native result as Y.Doc/evidence/ACK authority |

## 6. Mechanical acceptance gates

1. Both final annexes contain no ancestry/replacement review sections or embedded
   self/artifact/protocol digest literals.
2. Every public declaration name has one owner and one occurrence per annex unless
   the ledger explicitly records an imported reference.
3. Kernel contains no concrete transport, owner schema implementation, native I/O
   type or service implementation.
4. Project/node-returned values are plain evidence; only Kernel factories mint
   Kernel brands.
5. Owner install preserves exact `<K,A>` through definition, selected port,
   result, evidence and receipt; mismatch yields zero receipt and zero ACK.
6. ACK recovery is absent from Kernel and Control; Project alone declares exact
   `queryAttempt<K>(DependencyCarrierTransferAckAttemptKeyV2<K>)`.
7. `replicaDoc` is the sole long-lived Y.Doc and `candidateDoc` is isolated and
   temporary; no third role, delayed local conversion or ACK-gated authority exists.
8. R5.10–R5.14 native metadata/path semantics produce no Kernel/Control domain or
   authority expansion.
9. Every Kernel bracket brand has one exact `declare const ...: unique symbol`, and
   raw owner definitions enter only through the loader-owned admission factory.
10. Control declares exactly one closed reset carrier/callable and zero Project RSA,
    currentness, attempt-key, outbox or ACK brands.
11. `OwnerExternalFactRequirementV2<K>`, `OwnerIntentDependenciesV2<K>`, history,
    closure, result, resolver, port, factory and runtime retain the exact same `K`;
    `createAttemptPort` has no method-level owner parameter and returns only the
    closed `CreateOwnerExternalFactAttemptPortResultV2<K>` union.
12. Exact-boundary quota fixtures pass, Project totals 8193/536870913 and source
    totals 513/134217729 reject before allocation, reconnect remains single-charge,
    and owner install preserves count/bytes through one transfer.
13. Control contributes exactly 62 unique domains including the four complete
    checkpoint wrappers, and `ProtocolLimitsV2` has exactly 73 fields including
    `format` and the four aggregate ingress limits.
14. Every TypeScript fence parses, a strict clean consumer accepts the exact Canvas
    specialization, rejects cross-owner dependencies/resolvers and rejects a
    method-level owner type argument.

## 7. Lifecycle D crash and ACK trace

1. **Local commit:** clone current `replicaDoc` to one candidate, apply and validate
   one typed intent, produce the final signed binary frame, then commit immutable
   object, replication outbox ref, binary frame journal and sole replica head before
   applying the exact update to `replicaDoc` and reporting local success.
2. **Crash/reopen:** a pre-head object is non-authoritative; a post-head/pre-memory
   crash reconstructs the one `replicaDoc` from checkpoint plus durable frame
   closure. Recovery reuses exact frame bytes and never reruns, reallocates or
   re-signs the intent. Session undo starts empty.
3. **Incoming frame:** reconstruct and validate its authored causal base in a
   temporary candidate, cross the same durable barrier, then merge the exact update
   into current `replicaDoc`. Arrival-order current state never selects validity.
4. **Undo/redo:** materialize a new semantic intent against current `replicaDoc`,
   commit it as a new final frame, and move the cursor only after durable head plus
   in-memory apply. No stack state survives restart.
5. **Remote ACK:** a receiver ACKs only after exact frame validation, durability and
   authoritative reconstruction/application. Sender records replication metadata
   only; ACK receipt, loss or retry never mutates `replicaDoc`, frame identity or
   undo state, and local success never waits for a remote ACK.

## 8. Final candidate identities

| Final-candidate annex | Ordinary SHA-256 | Bytes | Lines |
| --- | --- | ---: | ---: |
| `appendices/collaboration-kernel.md` | `cd9dcd59724eeb77cb47f729446d442a72d56cd093caa1efe0a787758d95bffa` | 96,450 | 2,363 |
| `appendices/control-plane.md` | `30f02414b8d4e7f4645584e845eecf67e04e89d895397a26fe543b5cab64cc63` | 140,665 | 3,426 |

This is a fresh audit against the exact final-candidate bytes above and the
reference-only Project ABI input
`5fa9ab986f8f191e595bd7c516014414962eb9d2f57a8a800e0ab0b816def654`
(182,204 bytes; 3,826 lines) after correcting the Project factory name. Across
those exact artifacts, `ProjectRsaOwnerAuthorityFactoryV2` occurs zero times;
`ProjectDependencyCarrierOwnerAuthorityFactoryV2` has exactly one Project
declaration and one Control reference-only mention, with zero Control declarations.

These hashes identify only the two inactive Route B final-candidate annexes. They do
not activate, replace or inherit the frozen five-file authority set. Any byte change
requires a new ledger identity and a fresh cross-annex audit before assembly.
