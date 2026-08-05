# Collaboration V11 R1 Local-First Authority

Status: frozen review candidate; inactive until the repository active pointer selects
this exact release after unconditional 3/3 review evidence is installed.

## 1. Selection and historical dependency

This release defines protocol major 3 and the `CVXCOLL3` frame family. It is not a
fallback for V10 and it cannot be selected from directory presence, source constants,
network availability, Project age, or caller-supplied paths or digests. Production
continues to select the sealed V10/R5 release until a create-only V11 pointer CAS
selects this exact manifest and review evidence.

`historical-v10-r5-pin.json` binds the complete V10/R5 identity chain. A V3 runtime
MUST validate that historical release before it may decode a V2 predecessor or
install a promotion bridge. V2 frames retain their exact bytes, signature and digest;
they are never decoded by V3 rules, re-encoded, or re-signed.

## 2. Local-first bootstrap authority

R1 activates only the narrow promotion of a verified pristine, unshared V10/R5
ProjectIndex into one local-owner V3 Project with one deterministic default Canvas.
It does not activate direct-new V3 Projects, a second Canvas, or V3 sharing. Those
operations fail closed until a later reviewed release.

A new Project epoch begins with one Main-private local-owner key and one exact owner
binding. The binding fixes Project id, epoch, owner key, initial replica and actor,
protocol digest, `sharingGeneration: 0`, creation nonce, and a closed genesis policy
for one exact ProjectIndex scope. It does not contain an owner schema digest or any
Canvas scope. Each signed edit authorization separately fixes one exact document
scope and that owner's exact schema digest. ProjectIndex is authorized only for the
binding's fixed genesis scope; a Canvas authorization may be signed only after an
accepted ProjectIndex route-stage frame derives that exact Canvas id and shard
epoch. Wildcards and authorization of future Canvas ids are forbidden.

Publication order is retry-stable claim, key, binding, ProjectIndex authorization,
ProjectIndex genesis or verified V10 bridge journal, accepted ProjectIndex route
stage, exact Canvas authorization, Canvas genesis, route activation, device
high-water record, then active protocol pointer. The Canvas genesis checkpoint
binds the exact accepted ProjectIndex stage-frame digest, and route activation binds
that stage, its accepted frontier and the exact Canvas genesis checkpoint object.
Each create-only object is retry-byte-stable. A crash resumes the same claim and
bytes or enters a closed recovery state; it never allocates a second writer.

An unshared V10/R5 Project may promote only after validating its complete durable V2
head and proving the absence of Team binding and sharing handoff. If that verified
ProjectIndex has no Canvas route, Project derives one default-Canvas claim from the
exact Project id, epoch, ProjectIndex scope and verified R5 owner actor. That claim
deterministically fixes `stageOperationId`, Canvas id, shard epoch and Canvas schema
digest; retry cannot allocate a different default Canvas. Promotion adds immutable
owner-signed bridges and the V3 closure without modifying any V2 byte. A shared,
non-empty-but-incomplete or ambiguous V10 Project remains V10.

## 3. One writer and durability

Each Project epoch has exactly one active writer kind: `local-project-owner` or
`team-replica`. A command mutates only an isolated candidate document. The final
signed frame crosses immutable object, outbox, journal and sole-head durability
barriers before it enters the Main-owned replica document. Offline and online
replication transport the identical final bytes.

The first V3 actor frame has one exact `protocol-promotion-bridge` predecessor
dependency. Later frames have one exact actor predecessor and forbid another bridge.
The V3 envelope magic is `CVXCOLL3`; V3 core, context, frame, signature and digest
domains are distinct from V2. Owner typed intents remain exact frozen
`convax.typed-intent/2` owner-language bytes, preserving Canvas and ProjectIndex
schema ownership rather than inventing a parallel V3 reducer language. The V3
frame's digest of those bytes uses the distinct `convax.typed-intent/3` digest
domain; payload format and enclosing-protocol digest domain are different axes.

## 4. Control-plane and expansion exclusion

Ordinary local open, edit, restart and Project relocation do not initialize Team,
API, rendezvous or PeerJS. R1 exposes no V3 sharing handoff and no active-runtime
Canvas-genesis capability. Share or create-Canvas requests fail closed without
changing durable authority. Existing shared or non-pristine V10 Projects remain on
the sealed V10/R5 runtime.

## 5. Owner boundaries

- Collaboration owns the headless V3 frame codec, authority tagged union, admission,
  candidate/replica kernel and bridge contracts.
- Project/node owns private protocol state, promotion journal, immutable bridge,
  device high-water record and external anti-rollback evidence.
- Desktop Main owns native key custody, durable adapters and runtime composition.
- API has no V11/R1 production authority surface.
- Canvas and ProjectIndex retain their V2 typed-intent languages and schema owners.

Renderer, Preload, Agent, Plugin, network state and Team availability cannot select a
protocol, writer, native path, signer identity, authority digest or fallback.

## 6. Failure contract

Missing, extra, reordered, mode-drifted, symlinked or hash-mismatched release members
are `protocol-schema-bundle-unavailable`. Mutation of any sealed V10/R5 dependency is
also unavailable. A genuine Main/annex contradiction is
`canonical-authority-conflict`. Local authority is unavailable only for missing key,
corrupt evidence, anti-rollback failure or ambiguous promotion. Direct-new V3,
sharing and additional Canvas creation are explicitly unavailable in R1.
