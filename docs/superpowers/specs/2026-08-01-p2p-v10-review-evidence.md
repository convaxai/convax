# P2P collaboration v10 architecture review evidence

Status: **G2 FROZEN — revision-4 3/3 SIGN**

This file records review evidence. It does not define protocol semantics. The exact
authority files and hashes are listed in
`2026-08-01-p2p-v10-authority.sha256`.

## Frozen identities

| Identity | SHA-256 |
| --- | --- |
| Canonical main | `5f6a69af82cf71e0f2a2aa609c75e2054e73f556ac72a2aa9154aaa8c1c2165f` |
| Ordered annex set | `8c3eca5c411ef729d53899aa9dc7e83df7b1e650638c6f7e82178ebd55b2dc55` |
| Protocol/core | `6271a21fe81c9dbf2b53c3ff814a380953f69121684eb8bb47933222676efcc4` |
| Global URI protocol | `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949` |
| Approved Canvas closure source | `32a3c8f888137e5a1b0695e3fa68390a27a26f3fbd401943b1f968ceae8fafe4` |
| Approved Owner closure source | `4bfc55a7bbef440b310215e9363fb53585acfb395db7176e58e0af0cf86e92fd` |
| Approved Control closure source | `879547b9f437e28c9e9a78dc5fcbe0d94a150c96c6c920bd71853e9001fbf085` |

The normative authority is the canonical main plus all four exact annex files. A
missing or hash-mismatched file is `canonical-authority-conflict`; the main summary
cannot replace an annex DTO or codec.

## Independent final votes

| Reviewer | Decision | Score | Signoff SHA-256 |
| --- | --- | ---: | --- |
| `/root/canvas_intent_runtime` | `SIGN REVISION 4` | 9.2/10 | `04d64e9f473ac83d8fc3a738f0e1cbd4e40bf0e5a5d7dd0c7b859ecc213de6c9` |
| `/root/project_local_fork` | `SIGN REVISION 4` | 9.3/10 | `e07fb2c6d94fed50a18cd57842548e86ab2575e78c4e4ece57465341b62e95f5` |
| `/root/collaboration_api` | `SIGN REVISION 4` | 8.8/10 | `adee20dd2a8e4f4c9567565d72fd84de1dafbc74f71ea443803e86b5a168cdfb` |

The prior revision-3 signatures were revoked 3/3 after implementation exposed two
P0 false-closure families. Each reviewer independently recomputed the revision-4
five-file hashes, ordered annex-set JCS digest, protocol/core digest, URI digest,
artifact references, limits, channel policies, 123-domain registry, kernel prefix,
exact F13 callable ABI and final-LF requirements before signing these same bytes.

## Architecture decisions released to implementation

The following decisions are implementation authority only when consumed with the
exact revision-4 identities and receipts above.

- Yjs is the sole durable ProjectIndex/per-Canvas data authority; React Flow is a
  transient rendering and interaction projection.
- Offline local commits immediately create final durable replica-signed causal
  frames; reconnect sends the same bytes and never replays business commands.
- There is no document-wide version, per-edit service admission order, MMR,
  certified/working/local-fork promotion, or whole-document write path.
- Every command uses one isolated candidate document and one closed typed intent;
  UI, Agent and Plugin use the same application service.
- Safe pruning requires both service content certification and all-active-editor
  causal floors. Without either, editing and replication continue while history is
  retained.
- ProjectIndex is the only route/tombstone and live-scope authority. The service
  registry is bounded anti-rollback/discovery metadata and never grants, denies or
  expands the required Project floor.
- `ReplicaIdV2` is service-reserved, Project-epoch unique, never reused and directly
  decodes to the replica's Yjs client id. There is no hash/probe fallback.
- URI, ProjectFileId, mutable location, version identity and blob hash remain
  distinct. Blob replication and structural frame replication use separate durable
  acknowledgements.
- Old formats are preserved without hydration or rewriting until an explicit
  user-confirmed destructive reset.

## Strongest residual objections

1. Whole-file protocol artifacts make harmless normative text edits rotate the
   protocol identity and require another complete 3/3 review.
2. The content attester and replica-id allocator are central privacy/availability
   boundaries, while an offline editor can block safe compaction until explicit
   revoke and recovery handling.
3. Exact-base retention, long-lived credential/receipt roots and the 64 KiB Yjs
   state-vector bound can force an explicit Project or shard reset in a sufficiently
   long-lived Project.

These are accepted, bounded and fail-closed product constraints. They do not create
an edit sequencer, silent overwrite or second Canvas/Project authority.

## Falsifiable release gates

The architecture approval is revoked if any implementation:

- computes another protocol/core/annex digest from the frozen bytes;
- admits a frame from a non-signer Yjs client structure or reuses a replica id;
- replays or re-signs an offline command during reconnect;
- validates a guard on a newer arbitrary document instead of the exact causal base;
- prunes without both gates or lets registry-only scopes block editor activation;
- persists or transmits raw `beginAuthorizationEpoch` instead of its exact digest;
- permits React Flow, JSON, renderer state or a service catalog to become durable
  Canvas/Project authority;
- rewrites unsupported old Project bytes before explicit destructive confirmation.
