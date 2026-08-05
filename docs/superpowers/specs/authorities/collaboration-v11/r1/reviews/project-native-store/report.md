# Collaboration v11 R1 Project native-store authority review

- reviewerRole: `project-native-store`
- reviewerTaskPath: `/root/review_project_v11`
- frozenCandidateCommit: `7f425fd0794e5a049ddc9462f9a0843f3e8b1825`
- decision: `UNCONDITIONAL SIGN`
- ScoreBasisPoints: `970`

## Exact eight-member candidate

| Manifest member | Ordinary whole-file SHA-256 |
| --- | --- |
| `docs/superpowers/specs/2026-07-31-global-uri-protocol.md` | `9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/appendices/canvas-schema.md` | `2d6d756c764ee4510f3e3afbe37a16d42311dcd29e58e91f4811a44486f5a22e` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/appendices/collaboration-kernel.md` | `194ab07c03feba59c39b90de3ebfa02bba64cdc39884b25dfbd47a364c8b7068` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/appendices/control-plane.md` | `f27070b5b5560be44a3319c61e6f362d3e44ce9892cd04d4bf9af38060400e9a` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/appendices/project-persistence.md` | `27d0fa4ffe6ef743655e1fac395da75316030a25d4e582c7e55ea68189a7fcd3` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/historical-v10-r5-pin.json` | `ac17fd5a5ee5b989909266bc58d616a1476a286ea7f27f7cda5819c0a857f369` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/main.md` | `58ef4eb781f87bd0d0ef7e0b11bf5f238fca55fca0efd9f7e9b4c256e338f9ca` |
| `docs/superpowers/specs/authorities/collaboration-v11/r1/protocol-schema-bundle-v3.json` | `180199f3e77e5f4daa9c914f97b8e9a08293ba70e201656efe3bd0c10af70d6c` |

- manifestPath: `docs/superpowers/specs/authorities/collaboration-v11/r1/authority.sha256`
- manifestSha256: `351634036ae88bbe843430bb11b3e9d46e6b9bcd865df4aaf55e50fe55dfb1b4`
- protocolBundlePath: `docs/superpowers/specs/authorities/collaboration-v11/r1/protocol-schema-bundle-v3.json`
- protocolBundleSha256: `180199f3e77e5f4daa9c914f97b8e9a08293ba70e201656efe3bd0c10af70d6c`
- protocolDigest: `5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f`

## Mechanical verification

The candidate is committed at the named freeze commit. All eight manifest members
are regular non-symlink Git blobs with mode `100644`; the manifest is raw-UTF-8 path
sorted, uses two ASCII spaces as its separator, and matches each complete file. The
independent V11 generator reproduced the installed bundle and manifest byte-for-byte.
The bundle is restricted JCS plus one LF and has `coreDigest === protocolDigest`.

The historical pin binds the complete frozen V10/R5 fifteen-file closure. R1 requires
that exact R5 authority before inspecting or decoding a V2 predecessor and forbids
rewriting, re-encoding or re-signing all V10 bytes. The only promotable input is a
verified pristine, unshared, empty V10 ProjectIndex. Shared, non-pristine, incomplete
and ambiguous V10 Projects stay V10; direct-new V3, V3 sharing and additional Canvas
creation are explicitly unavailable.

The Project/native publication contract is narrow and ordered: deterministic claim,
claim-bound key and binding, exact ProjectIndex authorization and bridge journal,
claim-bound route stage, exact Canvas authorization and genesis, route activation,
external device high-water, then the create-only active pointer. The empty-V10 claim
fixes `stageOperationId`, Canvas id, shard epoch and schema before publication. The
Canvas proof binds the accepted stage frame, and each mutation subsequently crosses
object, outbox, journal and sole-head durability before replica projection.

The persisted protocol state is the only runtime selector. Directory presence,
network state and Team reachability are not authority. A restored Project directory
behind the external device high-water or sharing tombstone fails closed. The private
bootstrap writer is confined to the exact claim and disposed after the one default
Canvas activation; the selected R1 runtime exposes neither bootstrap Canvas creation
nor Team/API/PeerJS capabilities.

Project/node and Desktop native implementation context was inspected only to test
whether the frozen requirements are implementable without elevating plain filesystem
records into protocol authority. This receipt signs the exact authority bytes, not
mutable implementation files. Activation remains invalid if implementation accepts a
generic current head in place of the exact claim-derived stage operation, skips a
directory durability barrier, or exposes any operation outside the R1 closure.

## Strongest three objections

1. Staged-route restart can substitute a later ProjectIndex head for the exact
   claim-derived `stageOperationId`. Flaw type: hidden identity-substitution
   assumption. R1 requires the same operation and bytes on retry; an implementation
   unable to prove that correspondence must enter closed recovery and cannot activate.
2. A movable Project directory can be restored behind a completed promotion or an
   older sharing tombstone. Flaw type: ignored rollback path. The external device
   high-water and tombstone dominate Project-local owner files, so restored local
   evidence cannot reactivate signing.
3. Scope reduction could be defeated by leaving candidate direct-new, sharing or
   create-Canvas constructors reachable from production composition. Flaw type:
   hidden capability-leak assumption. The control-plane, Canvas and persistence
   annexes explicitly make those operations unavailable; reachability is a release
   falsifier rather than a permitted implementation detail.

## Falsifiers

- Any candidate member, manifest byte, bundle byte or digest differing from the
  values above invalidates this sign.
- Any V10 object, frame, checkpoint, head source or signature rewritten during
  promotion invalidates this sign.
- Any promoted default Canvas whose `stageOperationId`, Canvas id, shard epoch or
  schema differs across restart invalidates this sign.
- Any recovery path that accepts a non-claim-bound ProjectIndex head, projects a
  frame before object/outbox/journal/head durability, publishes the active pointer
  before device high-water, or produces two active writers invalidates this sign.
- Any R1 production path for direct-new V3, V3 sharing, a second Canvas, Team/API,
  rendezvous or PeerJS invalidates this sign.
- Any restored Project directory that bypasses device high-water or sharing
  tombstone, or any V11 pointer created before exact fresh 3/3 evidence, invalidates
  this sign.

## Decision

`UNCONDITIONAL SIGN`
