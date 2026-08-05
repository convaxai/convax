# Collaboration v11 R1 collaboration/control-protocol authority review

- reviewerRole: `collaboration-control-protocol`
- reviewerTaskPath: `/root/review_control_v11`
- frozenCandidateCommit: `7f425fd0794e5a049ddc9462f9a0843f3e8b1825`
- decision: `UNCONDITIONAL SIGN`
- ScoreBasisPoints: `940`

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

## Scope and verification

This review covers only the R1 local-bootstrap control exclusion. V3 sharing,
handoff API and team-replica activation are outside this release and are not signed
by this receipt.

All eight manifest members match their whole-file hashes. R1 selects only verified
pristine, unshared V10/R5 ProjectIndex state for one local-owner V3 Project and one
deterministic default Canvas. Network state, Team reachability and caller input do
not participate in protocol selection.

The selected V3 local runtime constructor has no Team manager, API client,
rendezvous or PeerJS transport input. Its incoming authority resolver rejects the
`team-replica` branch. The only Team-related read in promotion is the local durable
V10 Team-authority store used to prove that the predecessor is unshared; it does not
start a Team runtime or contact a service. ProjectIndex Canvas-genesis preflight in
the selected R1 runtime remains pending, so a second Canvas fails before route-stage
mutation.

Shared and non-pristine V10 Projects are rejected by the narrow promoter and return
to the existing V10 ports. Desktop invokes durable sharing activation only when the
resolved protocol is exactly `v10-r5`; a selected V3 local Project never enters that
branch. Candidate V3 handoff/API source is not reachable from this R1 composition.

## Strongest three objections

1. The application still constructs legacy V10 Team infrastructure globally.
   Flaw type: scope ambiguity. This does not grant V11 authority: selected V3 local
   activation is protocol-gated away from the V10 sharing branch, while the legacy
   infrastructure remains necessary for existing shared V10 Projects.
2. Promotion reads the durable Team-authority store to prove absence of a shared
   binding. Flaw type: terminology ambiguity. This is a local fail-closed evidence
   read, not Team initialization, API traffic, rendezvous or PeerJS startup.
3. Candidate V3 handoff and team-replica codecs remain in source. Flaw type: hidden
   capability-leak assumption. R1 excludes them from its digest domains and active
   production composition; source presence alone is not authority.

## Falsifiers

- Any candidate member, manifest byte, bundle byte or digest differing from the
  values above invalidates this sign.
- Any selected V3 local open that constructs or calls a V11 Team manager, API
  client, rendezvous session or PeerJS transport invalidates this sign.
- Any accepted `team-replica` V3 frame, V3 sharing/handoff call, or second-Canvas
  route-stage mutation in R1 invalidates this sign.
- Any shared or non-pristine V10 Project promoted to V3, or any existing shared V10
  Project routed away from its sealed V10/R5 runtime, invalidates this sign.
- Any network or Team-availability result used to select V10 versus V3 invalidates
  this sign.

## Decision

`UNCONDITIONAL SIGN`
