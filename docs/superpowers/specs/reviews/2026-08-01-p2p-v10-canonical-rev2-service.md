# P2P collaboration v10 canonical revision-2 service review

Date: 2026-08-01

Reviewed authority set:

1. `docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md`;
2. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md`;
3. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md`;
4. `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md`.

I independently read and reviewed the complete 6,575-line, 289,833-byte set. I
also checked the root architecture contract, the global URI source, round-3
revision-4 candidate and both prior canonical reject reviews. I modified neither a
specification nor implementation.

## 1. Exact-byte and source-set verification

Every declared whole-file digest matches independently computed bytes:

| File | Lines | Bytes | SHA-256 | Result |
| --- | ---: | ---: | --- | --- |
| main revision 2 | 1,600 | 83,556 | `257b00ceb122f3eb092d1c4e6e156c4155b273568a61ffa70850be2a00004940` | PASS |
| Canvas annex | 1,335 | 58,191 | `7a11fed58dd8769c1af84748abda3524fb00bb6a06dc0e12237dec0dd827733e` | PASS |
| control annex | 2,195 | 81,296 | `d884726daef51eacf3f2d4d9ea5e8448849b3995ab19b2ce9a72c64abd3d65a0` | PASS |
| Project annex | 1,445 | 66,790 | `b1f07de09adff277dd195f10189ac24e7d646503c55a1d78d1561aace0ed418f` | PASS |

The exact UTF-8, no-newline JCS source-set preimage is:

```json
[{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md","sha256":"7a11fed58dd8769c1af84748abda3524fb00bb6a06dc0e12237dec0dd827733e"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md","sha256":"d884726daef51eacf3f2d4d9ea5e8448849b3995ab19b2ce9a72c64abd3d65a0"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md","sha256":"b1f07de09adff277dd195f10189ac24e7d646503c55a1d78d1561aace0ed418f"}]
```

Its independently computed ordinary SHA-256 is exactly:

```text
1df7906e82f0b9fdf96fb13c90acd493dd0201b3c4dd36fb32f21e9166712d6f
```

The incorporated global URI source and round-3 revision-4 source also match their
declared digests:

- global URI: `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`;
- revision 4: `ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`.

The documentation source-set rule is therefore reproducible. That does not prove
the portable `ProtocolSchemaBundleV2.coreDigest`; finding 2 explains why.

## 2. Exact-set decision

**REJECT** the indivisible exact set
`{main=257b00ce..., annex-set=1df7906e...}`.

Revision 2 repairs most previously reported omissions: the annexes close the
Canvas and Project records/intents, membership and Peer DTOs, registry quotas,
single-shard reset persistence, signed-frame crash recovery and React Flow owner.
The remaining defects are not editorial. The exact authority set contains mutually
unsatisfiable identity codecs, does not determine one portable protocol digest,
delegates reset security objects to an annex that does not define them, and lets a
lagging non-authoritative registry decide Project-wide editor bootstrap coverage.
The main file's own `canonical-authority-conflict` rule requires rejection.

## 3. Prior reject-blocker closure matrix

| Prior blocker | Revision-2 result | Conclusion |
| --- | --- | --- |
| Closed Canvas/Project records and intents | PARTIAL | Detailed annexes exist, but Canvas identity and portable stamp codecs conflict across annexes; one undefined Project bulk intent remains. |
| Bounded replay-safe membership/session | PASS | Credentials, epochs, challenges, counters, atomic idempotency and member/replica caps are closed. |
| Signed-frame pre-head crash recovery | PASS | Object-only, ref/journal-below-head, transport gating and exact-operation lookup are explicit. |
| Closed Peer/update/blob wire | PARTIAL | Handshake/channels/envelopes/transfers are closed, but reconnect discovery promised by main cannot be encoded by the inventory DTO. |
| Revision-4 shard reset | PARTIAL | Project route/persistence state machine is restored; its admin confirmation and team epoch-rollover service protocol is missing. |
| Registry nested quotas/failures | PASS | Per-replica/member/Project/byte limits, retained accounting, pages and failure states are restored. |
| React Flow/editor owner | PASS | Canvas owns projection, gestures and view commands; Desktop is composition/adapters only. |
| URI governance | PARTIAL | Grammar, identity/path/blob separation and comparison pass; the URI-specified authenticated team reset flow is not incorporated. |

## 4. Blocking finding S1 — Canvas identity and stamp codecs conflict

Severity: **P0**. Flaw types: **fact conflict**, **schema collision** and
**cross-owner invariant impossibility**.

The Project annex defines:

```ts
type CanvasIdV2 = `cv_${string}` // suffix exactly 64 lowercase hex
```

The Canvas annex stores `CanvasIdentityV2.canvasId: Id128V2`, and the control annex
requires a Canvas `DocumentScopeV2.docId` to be `Id128V2`, defined as unpadded
base64url of exactly 16 bytes. The Project reset contract then requires Canvas
`docId` to equal the enclosing `canvasId` byte-for-byte. No string can satisfy both
closed codecs. A Project-created Canvas route therefore cannot produce a scope that
the Canvas/control validators accept.

The duplicate `PortableStampV2` name is also not one schema: Canvas requires a
`format` field and decimal-string `Uint32V2.writeOrdinal`; Project omits `format`
and uses a JSON-number uint32. Even if package namespaces make this compilable, the
four-file bundle never states whether the two wire codecs are intentionally distinct
or one shared portable primitive. Generated declarations cannot safely merge them.

### Minimum patch

Choose one Project-owned Canvas id codec and use it in Project routes, Canvas
identity and every `DocumentScopeV2.docId`. The operation-derived `cv_<64hex>` form
already matches Project ownership and global stable-id practice. Define shared scope
and stamp primitives once, or rename package-local stamps and state explicitly that
they are distinct. One shared stamp should use one closed object and one uint32
encoding in all annexes.

### Falsifiable test

Generate a Canvas route, Canvas genesis identity, registration claim, Peer inventory
and shard-reset claim from one operation. All five must round-trip the byte-identical
Canvas id/scope through all generated validators. Generate one maximum portable
stamp in Canvas and Project; if the shared descriptor emits two incompatible shapes,
the patch fails.

## 5. Blocking finding S2 — `ProtocolSchemaBundleV2` is a shape, not one bundle

Severity: **P0**. Flaw types: **false completeness**, **hidden build-time choice**
and **signature-domain ambiguity**.

The control annex defines `ProtocolSchemaBundleCoreV2.artifacts` as an arbitrary
sorted array of up to 256 `{name,format,artifactDigest}` refs. The authority set
defines neither:

- the exact artifact list, names and formats;
- the canonical descriptor bytes for each ref;
- a deterministic extraction/generation algorithm from the prose/TypeScript fences;
- the resulting exact `ProtocolSchemaBundleV2.coreDigest`.

Its “mandatory domain registry” contains only the control domains. Canvas and
Project normative domains such as `convax.canvas-derived-id/2`,
`convax.project-index-record-digest/2`,
`convax.project-derived-identity/2`, reset-signature domains and native key domains
are absent. The main file correctly says the annex source-set digest is not the
portable bundle digest, so `1df7906e...` cannot fill this hole.

Two implementations can select different artifact granularity or names, both hash
the pinned annexes, and still issue different credential `protocolDigest` values.
They will reject each other's credentials, frames and handshakes before testing any
business semantics.

### Minimum patch

Freeze one machine-readable descriptor as part of the indivisible authority set.
It must contain the exact artifact manifest, complete domain registry, closed type
namespace/import graph, constants and resulting expected core digest. Prefer one
canonical JSON descriptor from which Bun, Chromium and attester declarations and
validators are generated; do not claim deterministic generation from Markdown
without an exact extraction grammar. Pin that artifact or embed its exact bytes and
update all four-file/source-set receipts.

### Falsifiable test

Give two clean generators only the approved authority bytes. Without repository
code or author input they must emit byte-identical descriptor bytes and the same
`ProtocolSchemaBundleV2.coreDigest`. Any choice of artifact name, domain, namespace,
field optionality or cap falsifies closure.

## 6. Blocking finding S3 — reset authorization is delegated to missing objects

Severity: **P0**. Flaw types: **authorization lifecycle omission** and
**normative-source drift**.

Project annex section 8 says the control annex defines issuance of the shard-reset
admin authorization and explicit confirmation receipts. It does not. The control
annex contains no shard reset, reset confirmation or epoch-rollover DTO/state
machine. Project annex section 13 and main section 19 also require an authenticated,
single-use team `projectEpoch` rollover challenge/receipt and transient validation
of the exact empty ProjectIndex genesis, but no closed request, proof, receipt,
signature preimage, idempotency key, counter or atomic transaction exists.

This also drifts from the still-normative global URI reset clause, which requires
the admin capability, member long-term proof, observed old membership/index/
checkpoint frontier, preallocated new epochs, attested exact genesis and atomic old
session/route fencing. The main file overrides only URI text involving `docEpoch`
or central edit admission; it does not override these reset authorization rules.

An implementer must currently invent which bytes an admin/member signs and whether
reset publication can race a replayed rollover. A local confirmation digest is not
a service authorization protocol.

### Minimum patch

Add closed `DocumentShardResetApprovalV2`, confirmation receipt, team Project reset
challenge/proof/receipt and exact transaction semantics to the control owner. Bind
old/new Project/scope epochs, exact ProjectIndex reset intent or route-CAS core,
admin capability, member/replica proof, observed old roots, attested staged-genesis
digests, nonce/counter and protocol/trust digests. Exact retry returns one receipt;
same id/different digest fails; signing/store failure rolls back all epoch/session/
route effects. Service stores metadata only, never genesis payload.

### Falsifiable test

Replay and race shard/Project reset proofs before staging, after service commit and
after local publication. At most one new epoch/claim exists, every old session is
fenced, retry returns byte-identical receipts, wrong genesis or stale root changes
nothing, and service forensic scans contain no snapshot/Yjs bytes.

## 7. Blocking finding S4 — pending-editor floor uses the wrong completeness owner

Severity: **P0**. Flaw types: **hidden second authority**, **invalid completeness
assumption** and **cross-clause contradiction**.

The control annex's `ReplicaProjectFloorRootV2` covers ProjectIndex plus every
currently `dual-validated` Canvas registry entry and binds registry sequence/root.
It then sets `unlistedScopePolicy: "forbid-edit-until-floor-installed"`. But main
and revision 4 explicitly make that registry lagging and incomplete: absence MUST
NOT deny a scope proved by ProjectIndex. ProjectIndex alone owns live Canvas routes.

This creates two incompatible outcomes for a live ProjectIndex Canvas absent from
registry:

1. apply the registry non-denial rule, let the newly active replica edit it, and the
   globally scoped `ReplicaEditAuthorizationV2` has certified no installed floor for
   that Canvas; or
2. apply the floor root's unlisted policy and let registry absence deny an otherwise
   valid ProjectIndex scope, making registry an editor-scope authority.

The service cannot prove omission is safe from its mutable registry because it is
not allowed to treat that registry as the route catalog. The edit authorization has
no per-scope restriction that could resolve the conflict later.

### Minimum patch

Derive Project-floor coverage from an exact content-certified ProjectIndex route
projection, not registry completeness. The service attester may transiently verify
that ProjectIndex checkpoint and the per-live-scope prunable certificates/target
ACKs, persist only digests/pages and sign the replica-specific floor root. Another
valid design is scope-specific edit authorization with an explicit floor-extension
protocol, but that is a larger change. Registry may remain discovery/cutoff
metadata and must not select the scope set.

### Falsifiable test

Create a valid live Canvas route offline, leave it absent from registry, then promote
a new editor. It must not receive Project-wide edit authority until the exact
ProjectIndex-proved Canvas floor is installed, and registry absence alone must not
permanently deny that Canvas. A forged floor omitting one live route must fail even
when every listed registry entry is valid.

## 8. Additional blocking interoperability gaps

### S5 — reconnect summary cannot name the promised missing objects

Severity: **P1**. The main file says reconnect exchanges actor heads and requests
exact missing objects. The closed control inventory carries only
`frontierDigest`/`stateVectorDigest`, not actor-head refs or state-vector bytes, and
`object-request` has no frontier/state-vector object kind. The main also says blob
discovery uses holder inventories, while the control annex explicitly has no blob
inventory digest. Sender-driven full-history offers might be invented, but they are
not the promised exact missing-object protocol and have no closed paging/resume
algorithm.

Minimum patch: either add bounded/paged exact frontier heads and checkpoint/bootstrap
roots sufficient to walk missing DAG objects, plus exact blob holder query semantics,
or narrow the main claims and specify one complete sender-offer algorithm. Test a
partially overlapping two-actor history and a fresh post-prune peer using only wire
objects; both must discover a finite exact request set without an out-of-band digest.

### S6 — Project bulk import invokes a nonexistent intent

Severity: **P1**. Project annex section 7 says multi-file import may use a bounded
“higher-level Project intent” containing up to 256 instances, but the closed
`ProjectIndexIntentKindV2` has no bulk member, operation receipts permit only eight
allocated ids, and the same section forbids extension fields/implementation-selected
intent kinds. Minimum patch: remove the nonexistent atomic option and require
independent v2 operations, or define one closed bulk intent with compatible id,
record, write and byte caps. A 2-file atomic import fixture must have exactly one
valid encoding or be uniformly rejected.

## 9. URI and revision-4 drift audit

### Global URI

Parsing, five components, static scheme governance, opaque Project authority,
ProjectFileId/path/blob separation, comparison modes, atomic references and ordinary
file preservation all **PASS**. The Canvas-id mismatch is not URI grammar but breaks
the Project identity using that URI universe. Authenticated team reset is **FAIL**
under S3; the main file did not legally override that global URI requirement.

### Round-3 revision 4

- **R3-1 PASS:** candidate/content/prunable gates, attester payload-zero boundary,
  exact all-active-editor pruning coverage and carrier limits survive.
- **R3-2 PARTIAL/FAIL:** Project owns shard reset, claim/persistence/CAS states and
  pre-CAS-only abandonment, but the required admin/confirmation issuance is absent.
- **R3-3 PASS:** lagging registry semantics, nested quotas, abandonment, closed
  member/replica cutoff targets, immutable pages and all-pages unlisted-empty remain.
  S4 is a new misuse of that registry outside revision-4 cutoff semantics.
- **R3-4 PASS:** owner-only terminal, dismissal, first-loss receipt, recovery permit
  direction, fixed markers and projection precedence remain closed.

## 10. No-double-authority audit

The following boundaries pass: ProjectIndex remains sole route/file-version
authority; CanvasYDoc remains sole Canvas state; `replicaDoc` is one local durable
document authority; React Flow is transient; service registry is not route truth;
raw UndoManager, UI, Agent and Plugin updates are non-authoritative; native paths and
JSON catalogs are excluded.

S4 is the exception: registry completeness becomes an implicit editor-scope gate
despite the authority table. S2 also risks copied/generated schema registries
becoming parallel protocol authorities because no exact descriptor artifact is
pinned.

## 11. Falsifiable re-review gates

The next exact set MUST satisfy all of these before signature:

1. one Canvas id/scope and one intentionally shared or explicitly namespaced stamp
   codec pass every owner validator;
2. two clean generators emit the byte-identical descriptor and portable protocol
   core digest from authority bytes only;
3. replay/crash tests prove one shard/Project reset authorization and zero durable
   service payload bytes;
4. a ProjectIndex-live, registry-absent Canvas is included safely in new-editor
   floor coverage without making registry route authority;
5. fresh, partial and post-prune Peers discover every exact missing object using only
   the closed Peer protocol;
6. bulk Project import has exactly one defined encoding or is explicitly
   non-atomic/independent;
7. all prior Canvas permutation, registry cap, cutoff missing-page, frame crash,
   blob ACK, URI and package-boundary gates remain unchanged.

## 12. Strongest three rebuttals and score

1. **“The three annex hashes already define the protocol bundle.”** They define a
   documentation source set, but the main explicitly says that digest is not
   `protocolDigest`; an unconstrained artifact array still lets runtimes sign
   different bundles.
2. **“Canvas id/stamp differences are package-local implementation details.”** They
   cross reset claims, Peer scopes, Canvas identity and generated declarations. The
   exact Project rule requires equality, so the id mismatch is mathematically
   unsatisfiable rather than stylistic.
3. **“Registry/floor and reset details can be completed during implementation.”**
   That would let service and Project lanes choose edit scope and destructive epoch
   authority after the required three-reviewer architecture gate—the exact class of
   hidden authority this review is meant to prevent.

Flaw types explicitly found: fact conflict, hidden normative dependency,
authorization lifecycle omission, incomplete-state assumption, duplicate authority,
protocol-language omission and undefined alternative.

Score for the exact four-file set: **5.9/10**. The architecture has substantially
better owner boundaries, convergence rules, crash recovery and bounded service
state than the prior candidate. It remains below 7 because the current bytes cannot
produce one valid cross-owner Canvas scope or one portable protocol digest, and
leave destructive reset and editor-scope authority to implementation choice. These
are implementation blockers, not residual operational costs.

Decision: **REJECT**.

No implementation lane may start from this exact set. Apply only the minimum
semantic patches above, recompute every changed whole-file/source-set digest, and
repeat 3/3 review on the new indivisible bytes.
