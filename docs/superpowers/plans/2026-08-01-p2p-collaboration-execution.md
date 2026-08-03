# P2P Collaboration Execution Plan

Status: revision-4 G2 frozen by exact-byte 3/3 SIGN; governance pins updating before implementation resumes
Branch: `feat/yjs-collaboration-architecture`

Revision-4 exact candidate:

- main: `5f6a69af82cf71e0f2a2aa609c75e2054e73f556ac72a2aa9154aaa8c1c2165f`
- annex set: `8c3eca5c411ef729d53899aa9dc7e83df7b1e650638c6f7e82178ebd55b2dc55`
- protocol/core: `6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4`
- proposal vote: 3/3 `APPROVE FOR ANNEX MERGE`
- prior final authority vote: 3/3 `REJECT`; missing closed verifier input/signature was the sole exact-byte blocker
- R5 repair vote: 3/3 `APPROVE F13-ABI-CLOSED-SNAPSHOT/1`; new exact-byte SIGN required after regeneration
- final authority vote: 3/3 `SIGN REVISION 4` — Canvas 9.2, Kernel 9.3, Service 8.8

## Governance

Architecture decisions are owned jointly by the three architecture reviewers:

- Canvas schema and typed-intent reviewer
- Causal-kernel and persistence reviewer
- Service, membership, PeerJS, and blob-channel reviewer

The primary task does not cast an architecture vote. It owns only:

1. conflict-matrix preparation;
2. formatting clauses that already have three identical approvals;
3. digest and evidence generation;
4. dependency-aware task dispatch;
5. integration and verification scheduling.

No disputed clause may enter an implementation task. Architecture is frozen only
when all three reviewers approve the exact same canonical-document digest.

That freeze gate is satisfied by the three exact revision-4 receipts above. The
primary task may now resume dependency-ordered implementation dispatch, but it may
not reinterpret, amend or cast a deciding vote on an architecture clause. Any
missing or contradictory clause returns to all three reviewers.

## Gates

| Gate | Required evidence | Blocks |
| --- | --- | --- |
| G0 independent drafts | Three separately authored drafts | Cross-review |
| G1 conflict resolution | Three reviews covering every conflict-matrix item | Canonical formatting |
| G2 semantic freeze | One canonical document and 3/3 approval of its digest | Protocol implementation |
| G3 package verification | Owner-package tests and typecheck for every lane | Integration |
| G4 architecture verification | Three implementation reviews against the frozen digest | Legacy-path removal |
| G5 repository verification | `bun check`, breaking-reset tests, convergence and reconnect suites | Delivery |

## Parallel lanes

## Active task dispatch

| Task | Owner scope | Task id | Status |
| --- | --- | --- | --- |
| Collaboration v2 kernel | `@convax/collaboration` only | `019fbd95-431d-79d3-9105-7c848b23a525` | integrated from scoped commit `127824013`; verified |
| Project control protocol and API first round | browser-safe `@convax/project/collaboration-protocol` plus `apps/api` | `019fbd95-431e-74f1-9e91-1a000cb4b0d2` | fail-closed skeleton integrated; v2 completion delegated below |
| Global URI and breaking reset | `@convax/uri`, Project file identity, explicit reset boundary | `019fbd95-431e-74f1-9e91-19e3f3d99803` | integrated and verified |
| React Flow transient cleanup | `@convax/canvas` renderer/view edge | `019fbd95-431e-74f1-9e91-1a21f7540624` | integrated and verified; Desktop v2 session TODO remains for Lane H |
| ProjectIndex domain v2 | `@convax/project` browser-safe collaboration domain | `019fbdf6-86ec-7620-a7fb-13f34736dea6` | paused without commit until revision-4 freeze |
| Project native persistence v2 | `@convax/project/node` | pending ProjectIndex domain commit | not dispatched |
| CanvasYDoc schema and typed intents v2 | `@convax/canvas` domain/collaboration edge | `019fbdf6-86ec-7620-a7fb-13b29772394d` | stopped without code/commit on false closure |
| Control protocol v2 second round | browser-safe Project collaboration protocol only | `019fbdf6-86ec-7620-a7fb-13d25f7838fa` | blocked correctly on `initiatorReplicaId` ReplicaIdV2/Id128V2 authority conflict; no code/commit |
| API control service v2 | `apps/api` only | pending public control-protocol commit | not dispatched |
| PeerJS/offline/blob transport preflight | `@convax/desktop` collaboration edge, read-only first phase | `019fbdf9-86ed-7a22-a862-e9cb6181f6f8` | completed read-only; implementation waits for control v2 public DTO commit |

ProjectIndex, per-Canvas Yjs schema, PeerJS/blob transport, and unified caller
removal are intentionally not dispatched from a provisional kernel API. They are
the second wave and start only after the relevant first-wave public contracts have
been integrated and verified.

### Lane A: architecture-independent UI cleanup

Owner: `@convax/canvas` renderer edge.

- Remove React Flow state from durable or shared authority.
- Keep selection, drag preview, measured geometry, viewport, and resize state
  transient.
- Reproduce and eliminate the update-depth/reset defect.
- Do not introduce a collaboration protocol or decide Yjs schema.

This lane may run before G2.

### Lane B: global URI and Project file identity

Owners: `@convax/uri`, `@convax/project-files`, and the explicit Project reset
boundary.

- Enforce the frozen global Convax URI grammar.
- Keep stable `ProjectFileId` distinct from mutable URI location and content hash.
- Implement only the explicit breaking-reset UX and rejection tests needed for
  unsupported portable data.
- Do not choose causal-frame, checkpoint, or blob-conflict semantics.

This lane may run before G2.

### Lane C: legacy-authority audit

Owner: read-only cross-package audit.

- Inventory document-wide version checks, whole-document writes, central edit
  admission, MMR, certified/local-fork promotion, and renderer-authoritative paths.
- Produce exact symbol and test references.
- Make no code changes before G2.

This lane may run before G2.

### Lane D: collaboration kernel

Owner: `@convax/collaboration`.

- Implement only the frame, candidate, replica, journal, snapshot, sync, and undo
  contracts frozen at G2.
- Keep project and Canvas schema out of this package.

Blocked by G2.

### Lane E: ProjectIndex and Project resources

Owners: `@convax/project` and `@convax/project-files`.

- Implement the frozen ProjectIndex shard, Canvas routes/tombstones, file identity,
  current blob references, native persistence ports, and breaking reset.
- Keep Electron and PeerJS adapters outside domain packages.

Blocked by G2 and the public kernel contracts from Lane D.

### Lane F: per-Canvas schema and typed intents

Owner: `@convax/canvas`.

- Implement the frozen Yjs schema, closed typed intents, candidate validation,
  semantic undo/redo, Plugin creation groups, generation invariants, and
  cross-entity cleanup.
- React Flow remains a projection.

Blocked by G2 and the public kernel contracts from Lane D.

### Lane G: session, PeerJS, reconnect, and blob transport

Owners: service API composition, `@convax/desktop`, and Project node adapters.

- Implement the frozen identity/credential/session contract.
- Keep Yjs update, awareness/control, and blob transfer as separately bounded
  channels.
- Implement offline durability, reconnect/bootstrap, remote durable ACK, and blob
  verification exactly as frozen.

Blocked by G2; may proceed in parallel with Lanes E and F after shared wire types
are frozen.

### Lane H: unified callers and legacy removal

Owners: Canvas application services and Desktop composition.

- Route UI, Agent, and Plugin through the same typed-intent service.
- Remove document-wide version conflict and whole-document mutation paths.
- Remove superseded central-admission/certified/local-fork code identified by Lane
  C.

Blocked by Lanes D through G and G4.

## Integration order

1. Land architecture-independent lanes A and B after owner-package verification.
2. Freeze G2; create protocol implementation tasks from the exact digest.
3. Land kernel public types and conformance fixtures.
4. Run ProjectIndex, Canvas, and transport lanes in parallel against those types.
5. Run the unified-caller and legacy-removal lane only after the three reviewers
   confirm the implementation still matches the frozen architecture.
6. Run breaking-reset, convergence, offline/reconnect, blob, Plugin compatibility,
   generation-race, and React update-depth acceptance suites.

## Dispatch rule

Every implementation task must include:

- owning package and allowed file scope;
- frozen architecture digest;
- public contracts it may consume;
- explicit forbidden decisions;
- required failure, cancellation, stale-response, migration/reset, and platform
  tests;
- package-local `bun typecheck` and `bun test` commands;
- a stop condition requiring escalation to all three architecture reviewers when a
  frozen clause is missing or contradictory.
