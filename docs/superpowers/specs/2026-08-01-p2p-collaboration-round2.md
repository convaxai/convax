# P2P Collaboration Architecture Round 2

Status: unresolved reviewer differences; no normative decision is recorded here.

All three first-round reviews reject implementation. Their common clauses may be
carried into a future canonical candidate, but G2 remains closed until the items
below have one exact answer signed by all three reviewers.

## Unanimous direction from round 1

The reviewers agree on these directions, subject to final canonical wording:

- an offline local commit immediately creates one final, durable, replica-signed
  causal frame; reconnect never replays the business intent;
- PeerJS is an untrusted transport, peerId is not identity, and portable edits use a
  long-lived per-device replica key rather than a session key;
- ordinary revoke targets authorization and an exact checkpoint cutoff instead of
  rolling every unrelated Project/Canvas history;
- compaction needs a causal-stability commitment from every actor/replica still
  entitled to produce older-base work, or explicit revoke/cutoff;
- machine-local durable index/path facts do not enter portable frames; local blob
  admission, structural replication, and blob durable ACK are separate barriers;
- the breaking protocol family is v2 and old bytes are preserved until an explicit
  destructive reset;
- typed intents are validated on their exact causal base; a newer arbitrary
  snapshot is not a substitute;
- raw `Y.UndoManager` inverse bytes are never authoritative collaboration updates;
  undo/redo submit semantic intents and remote frames do not clear local session
  selection;
- an existing replica can edit offline, while a new device without a data holder
  waits and never fabricates synchronized empty state.

## Items requiring round-2 unanimity

| ID | Canvas review | Kernel review | Service review |
| --- | --- | --- | --- |
| R2-1 checkpoint trust | Stateless service content attester and content certificate | Stateless service content attester and content certificate | Service never receives content; all-active replicas sign peer-validation stability witness |
| R2-2 stability coverage | Every authorized offline-capable actor signs a base floor | Every active editor replica signs a floor ACK | Every active replica, including viewers, validates and signs the checkpoint |
| R2-3 sequence genesis | First frame is `1`, `0` reserved | First frame is `0`, absence is nullable | First frame is `1`, `0` reserved |
| R2-4 document epochs | Keep narrow `docEpoch` for explicit document-universe reset | Keep narrow `docEpoch` for explicit document-universe reset | No `docEpoch`; `shardEpoch` is the document reset fence |
| R2-5 bounds | intent 512 KiB; checkpoint parents/tips 8 | intent 512 KiB; checkpoint parents/tips 8 | intent 256 KiB; checkpoint parents/tips 32 |
| R2-6 frontier authority | Attester computes frontier from certified content | Attester computes frontier from certified content | Service catalogs declared DAG tips; peers validate content and invalid children cannot remove parents |
| R2-7 document discovery | Certified Canvas genesis registers a grow-only scope; ProjectIndex decides route state | Inventory is derived only from certified ProjectIndex checkpoint | Current editor registers a grow-only unverified collaboration scope; ProjectIndex decides route state |
| R2-8 generation owner loss | Any editor may create a concurrent dismissal claim; dismissal suppresses lifecycle/output | Non-owner may write cutoff-proof-backed `FAILED_RECOVERY` terminal in an actor slot | No cross-device termination in v2; lost owner may remain active until later protocol |
| R2-9 undo coordinator | Dedicated semantic cursor; UndoManager optional metadata | UndoManager selects/materializes only if stack moves after durable commit | Dedicated semantic cursor; UndoManager optional only after public-API spike |

## Round-2 output contract

Each reviewer must independently read the other two reviews and, for every R2 item:

1. select one exact option or define a third option precisely enough to become wire
   and state-machine text;
2. name which first-round clause the reviewer withdraws;
3. give the strongest remaining objection and a falsifiable test;
4. state `SIGN` or `REJECT` for the complete proposed round-2 clause set.

The reviewers may not use a 2:1 majority. A `REJECT` keeps G2 closed. After all
three return `SIGN` for the same semantic clause set, one reviewer—not the primary
task—will author the canonical semantic draft. The primary task may then normalize
formatting without changing meaning, calculate its digest, and return that exact
digest to all three reviewers for final 3/3 approval.
