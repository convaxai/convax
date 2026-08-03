# P2P collaboration v10 canonical service review

Reviewed exact candidate:
`docs/superpowers/specs/2026-08-01-p2p-collaboration-v10.md`

Declared SHA-256:
`0a45c13f5023890fe759da8fdf66557818580ebc4d3f6361d94b5fffb96abc77`

Independently computed SHA-256:
`0a45c13f5023890fe759da8fdf66557818580ebc4d3f6361d94b5fffb96abc77`

The candidate is 1,347 lines and 65,064 bytes. Digest and size verification passed
before review. I read the complete candidate and checked it against the exact global
URI source, round-3 revision-4 candidate, first- and round-2 reviews, three detailed
P2P drafts, Canvas/Yjs design, current root architecture contract and affected
package ownership contracts. I modified neither candidate nor implementation.

## Exact-digest decision

**REJECT** exact whole-file digest
`0a45c13f5023890fe759da8fdf66557818580ebc4d3f6361d94b5fffb96abc77`.

The architecture direction is coherent, but this file declares itself the sole
canonical semantic source while replacing several closed wire/schema/state-machine
contracts with summaries. Those omissions allow two conforming implementations to
produce different bytes, cutoff/reset outcomes and crash recovery. An exact file
hash cannot certify semantics that the file does not define.

## Incorporation audit

### Global URI governance

**PASS.** The incorporated URI source still hashes to
`298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`.
The canonical file preserves global ownership, five components, closed static
scheme governance, opaque case-sensitive Project authority, explicit comparison
modes, stable ProjectFileId/directory id, mutable path hint, immutable blob pin and
single-value Yjs atomicity. Its no-`docEpoch` and no-admission overrides are narrow
and consistent with v10. The original URI specification is explicitly retained as
an independently versioned normative source, so omission of its unrelated scheme
allocation rows here is not a silent fallback.

### Round-3 revision-4

- **R3-1 PASS:** candidate/content-certified/prunable gates, stateless payload-zero
  attestation, all-active-editor durable floors, section limits and encoded-whole
  320 MiB ceiling remain intact.
- **R3-2 BLOCKING DRIFT:** revision 4 defined a bounded
  `DocumentShardResetClaimV2`, exact old/new scope and reason/signature domain,
  staged-genesis/ProjectIndex-operation binding, pre/post route-CAS states and the
  rule that only a pre-CAS staged shard may be abandoned. The canonical file keeps
  only prose saying Project stages a new shard route. It omits the 64 KiB claim, the
  closed reset object and `shard-reset-staged`, `shard-reset-awaiting-route-cas`,
  `shard-reset-recovery-required`, `unsupported-old-shard` states. The detailed
  whole-Project reset in section 19 does not close single-Canvas reset recovery.
- **R3-3 PARTIAL DRIFT:** target/action union, member multi-replica coverage,
  immutable pages and all-pages unlisted-empty are correctly preserved. The
  registry's 64 KiB claim, four outstanding candidates per active replica and 1,024
  retained entries per member are absent; only the 4,096 Project/64 MiB aggregate
  remains. “Releases one outstanding slot” has no normative limit to release.
  Removing those nested quotas reopens the bounded authorized-editor DoS that the
  reviewed state machine explicitly contained.
- **R3-4 PASS:** dismissal and owner-loss recovery remain separate monotonic facts;
  owner-only terminal, retained suppressed resources, canonical cutoff proof,
  Canvas-owned external-fact port and Project-injected non-serializable permit keep
  the approved dependency direction.

### First-round and unanimous direction

The following consensus directions are present without material drift:

- offline local success is one final long-lived-replica-signed frame and reconnect
  never replays the business command;
- PeerJS/peerId/session/arrival/Yjs client id are not edit authority;
- revoke is target authorization plus exact cutoff, not global edit ordering;
- structural and blob durability are different ACK barriers;
- exact causal-base reconstruction is mandatory and a newer snapshot is no
  substitute;
- sequence starts at 1, v2 is breaking, old bytes wait for explicit reset;
- raw UndoManager updates are never authoritative and remote frames do not clear the
  local session cursor;
- existing durable replicas edit offline while a holder-less fresh replica waits.

The detailed incorporation is nevertheless incomplete in the areas below.

## Blocking defects

### 1. “Closed schema” has no closed record or intent schema

Sections 10 and 11 list root `Y.Map<unknown>` names, and section 12 lists intent
kind strings. They do not define the exact v2 record keys/value codecs, node/edge
register shapes, metadata fields, operation receipts, semantic-history records,
resource proof unions, or per-intent guard/body/write contracts.

Material reviewed rules that disappear include, among others:

- exact actor-slot key codecs and key/value identity equality;
- exact node/edge/plugin/placeholder/generation record shapes and allowed keys;
- causal-base placement algorithm and its bounds;
- observed incident-edge closure on remove;
- per-intent entity limits and exact resource-proof coverage;
- retained-history-only resource proof rules for undo/redo;
- exact semantic inverse/forward operation union and duplicate-inverse guard;
- node data, Plugin state, prompt/message, changed-path and logical-write limits;
- exact ProjectIndex entry/location/content/reservation/promotion record shapes.

This is not harmless implementation detail. The same candidate also requires
unknown keys/shared types to fail, actual-write evidence to equal the reducer's
closed write set, and Bun/Chromium/attester canonical hashes to match. Those tests
cannot be implemented from `Y.Map<unknown>` plus intent names. One implementation
may accept a field or placement that another rejects, partitioning causal history.

Flaw type: **false completeness / hidden normative dependency**. Section 1 says
older drafts are evidence rather than parallel normative specifications, so they
cannot silently fill this schema.

### 2. Control-plane identity is not a bounded replay-safe protocol

The candidate says a session credential binds membership data, but never freezes a
closed membership snapshot, membership-authority epoch, challenge/proof, nonce/
counter, trust-bundle or idempotency transaction. It also omits Project member and
total active/retired replica caps. The only remaining cardinalities are eight active
replicas per member and 256 active editor replicas; viewer members/replicas and
retained retired identities are otherwise unbounded.

This leaves multiple security decisions to adapters:

- whether a membership signing-key/authority rollover resets or continues one
  sequence and how stale snapshots are rejected;
- how actorId is uniquely bound to Project/member/replica/public key and key
  rotation;
- whether a replayed enrollment/session challenge can issue another current lease;
- whether credential signing and challenge consumption commit atomically;
- what exact credential/ticket/channel-open bytes peers sign;
- what happens when viewer or retired-replica inventory grows without bound.

`peerId is not identity` is necessary but insufficient: without one exact
replay-safe membership and session protocol there is no portable identity to bind
the four PeerJS channels to.

Flaw types: **authorization lifecycle omission** and **bounded-state omission**.

### 3. Signed-frame crash recovery is underspecified

Section 8 orders frame-object creation, outbox/journal append and durable-head
advance, but defines recovery only after the head has advanced. It does not define
the two earlier crash states:

1. frame object durable, no durable reference;
2. outbox/journal reference durable, head not advanced.

It also does not state that transport must ignore an outbox entry until the local
head accepts it, nor that reopen must complete validation/head acceptance of the
exact already signed frame instead of allocating a new operation/sequence. A sender
that transmits state 2 and later quarantines or re-signs it can create a remotely
accepted local frame that its own `replicaDoc` omits, or same-sequence equivocation.
The generic crash test in section 22 states the desired result but does not choose
the recovery transition.

Flaw type: **crash-state transition omission**.

### 4. Closed Peer/update/blob wire claims are named but not encoded

The handshake and four channel roles are sound, but the canonical file does not
freeze a channel-open transcript, control message union, transfer manifest DTO,
per-message signature/replay domain, ACK/NACK identity, resume/cancel state machine
or blob chunk-proof codec. Likewise, the format list names checkpoint/floor/ACK/
cutoff objects while several have only prose field lists.

This is observable wire behavior: one peer cannot know whether a reconnect transfer
id resumes the same immutable manifest, whether a channel belongs to the signed
connection, or which exact bytes a durable ACK signs unless those objects are
closed. Channel isolation and final SHA-256 do not resolve transcript replay.

Flaw type: **protocol-language omission**.

## Other requested lanes

- **React Flow transient cleanup: PASS.** Gesture previews, measured size,
  selection, viewport, Plugin extraction/removal and remount/scope cancellation are
  projection-only; gesture end submits one guarded geometry intent.
- **Undo/redo: PASS WITH NONBLOCKING DETAIL LOSS.** The authoritative rule is the
  accepted semantic-intent design, not raw UndoManager bytes. Durable-success stack
  movement and remote-frame isolation are present. The reviewed
  `history-reset-after-commit` cursor-failure result should be restored with the
  schema appendix, but restart-clears-session prevents a durable second authority.
- **ProjectIndex/per-Canvas sharding: PASS at ownership level.** ProjectIndex is sole
  catalog/route/file-version authority and each Canvas is one shard. Exact closed
  record schema is still blocked by defect 1.
- **PeerJS/offline/blob architecture: PASS at dataflow level.** Desktop owns PeerJS,
  existing replicas edit offline, fresh peers wait, four channels isolate control
  from blobs and frame/blob ACKs are separate. Exact protocol closure is blocked by
  defects 2 and 4.
- **Plugin schema/creation group/invariants: PASS at projection level.** Digest-pinned
  declarative schema, no old-schema writeback, whole-group source-delete behavior,
  orphan-edge hiding, containment cycle break and delete-wins generation are
  preserved. Exact state/intent codec is blocked by defect 1.
- **Breaking reset: PASS for whole Project.** Unsupported bytes remain untouched
  until double confirmation, ordinary Project files and stable projectId survive,
  and atomic tree replacement is fail-closed. Single-shard reset remains blocked by
  the R3-2 drift.
- **Legacy version/admission removal: PASS.** Document-wide version/CAS/save,
  per-edit admission/MMR, accepted/working/local-fork dual authorities, raw Yjs
  caller mutation and JSON mirrors are explicitly deleted.
- **Testing and package ownership: PASS at lane level.** Owners/dependencies align
  with the target architecture and the test categories are appropriate. They do
  not compensate for missing normative inputs.

## Minimum semantic patch

No accepted authority split needs redesign. Produce one new full-file digest with
these minimum additions:

1. Restore revision-4 R3-2 verbatim in canonical form: closed <=64 KiB
   `DocumentShardResetClaimV2` binding old/new scope, closed reset reason, old/new
   schema/protocol digests, staged genesis, ProjectIndex operation, actor/admin and
   explicit confirmation; restore the staged/route-CAS/recovery states, sole-route
   before/after rule and pre-CAS-only abandonment.
2. Restore the registry nested caps: <=64 KiB claim, four outstanding candidates per
   active replica, 1,024 retained entries per member, 4,096 per Project and 64 MiB
   retained claim payload; promotion/abandonment frees only the outstanding slot.
3. Add a self-contained normative v2 schema appendix for ProjectIndex and Canvas.
   It must freeze exact root/record/key/value codecs, actor-slot rules, intent
   guard/body/resource-proof unions, deterministic placement, semantic history and
   inverse/forward plans, changed-path accounting and all field/entity/write caps.
   Mechanically copying `/1` source is forbidden; apply v2 identity/resource rules
   and R3 dismissal/recovery changes before hashing.
4. Add one closed control/wire appendix: membership/trust/replica/session/ticket/
   channel-open/transfer/ACK DTOs and signature domains; membership-authority epoch
   and monotonic sequence; actor/key uniqueness; challenge/nonce/counter/idempotent
   atomic transactions; <=256 members, <=8 active replicas/member, <=512 active
   replicas/Project, <=256 active editor replicas and <=4,096 retained retired
   replicas. Keep PeerJS at Desktop and content payloads out of durable service
   state.
5. Add the local persistence/reopen transition: an unreferenced frame object may be
   collected only after proving no durable reference; a durable outbox/journal frame
   below head is never transmitted and reopen must validate and finish accepting
   that exact signed frame or enter read-only quarantine. It may never re-run the
   intent, reallocate operation/sequence or sign replacement bytes. Add exact
   response-loss lookup by local `{actorId,operationId}`.

No change is requested to URI grammar, dual checkpoint gates, cutoff target union,
React Flow ownership, semantic undo authority, blob/file boundary, Plugin liveness,
whole-Project reset or removal of document-wide version/admission.

## Falsifiable re-review gates

1. Give two independent implementers only the new canonical file. They must encode
   byte-identical node create, Plugin creation group, Project text conflict,
   membership credential, channel-open, cutoff, checkpoint and blob ACK fixtures;
   any unspecified field/order is failure.
2. Crash before/after each frame object, outbox, journal and head barrier. No frame
   may be transmitted before local acceptance, omitted after remote acceptance,
   replayed as a new identity or re-signed.
3. Crash a Canvas reset before genesis, before route CAS and after CAS. Exactly one
   route is current; old bytes survive; only pre-CAS staging is abandonable.
4. Replay enrollment/session challenges across membership-authority rotation and
   attempt a second writer lease. Old proofs fail, exact retries return the same
   receipt and current state contains at most one session.
5. Exceed every nested registry/membership/schema cap by one. Rejection occurs
   before allocation/mutation and never silently truncates a member cutoff target.
6. Run existing URI, causal DAG, Canvas permutation, Project file conflict,
   checkpoint dual-gate, incomplete-cutoff-page, Peer/blob isolation, reset and
   clean-consumer package gates unchanged.

## Strongest three rebuttals and score

1. A semantic architecture document need not contain every TypeScript interface.
   That rebuttal fails here because the document calls schemas and wire unions
   closed, makes unknown keys fatal, demands byte-identical cross-runtime fixtures
   and explicitly demotes the detailed drafts to non-normative evidence.
2. The omitted details can be chosen inside implementation lanes. That would let a
   lane choose authorization epochs, crash winners and Canvas write legality after
   architecture approval, violating the user's three-reviewer gate and the stated
   “cross-lane contract changes return to review” rule.
3. Existing package code/docs can fill the gaps. Current architecture contracts
   still describe the superseded certified/working/local-fork model in places, so
   falling back to them would restore exactly the duplicate authorities this
   candidate deletes.

Score for this exact digest: **6.6/10**. The owner graph, canonical-state direction,
convergence rules and product failure model are strong. The score remains below 7
because missing closed schemas, reset states, control-plane replay rules and crash
transitions are implementation-authority gaps, not editorial polish. The design can
return to 8.9 once those appendices are part of one exact digest; the residual
attester privacy, offline-editor compaction and no-holder availability costs are then
explicit and nonfatal under the stated threat model.
