# Collaboration Package Contract

`@convax/collaboration` is a browser-safe, independently publishable Yjs kernel.
It has no knowledge of a Project, Canvas, Plugin, PeerJS peer, identity provider,
Electron, filesystem, React, or a concrete document schema.

## Owns

- Shared v2 ids/scopes/stamps, restricted JCS, exact Yjs 13.6.31 update-v1 codecs,
  bounded envelopes, causal frames/frontiers, exact-base validation, the binary
  `CVXCAR02` checkpoint-carrier structural codec, and checkpoint/causal-floor
  primitives.
- One Main-owned `replicaDoc` per shard plus one isolated `candidateDoc` per command.
  Owner packages inject their exact closed schema, reducer, canonicalizer, evidence,
  and external-fact ports.
- The final long-lived-replica-signed causal frame and its object/outbox/journal/head
  ordering contract. Replication outboxes and ACKs are metadata, never another doc.
- Transaction-origin separation, typed persistence/journal ports without an I/O
  implementation, and the transient `SessionUndoCoordinatorV2`.
- The exact four-owner artifact manifest and one instantiated
  `ProtocolSchemaBundleV2.coreDigest`/`protocolDigest` from the frozen v10 authority.

## Does not own

- ProjectIndex/Canvas schema or business projection, membership/reset policy,
  service registry, PeerJS transport, native persistence, authentication, or UI.
- Raw local-update submission. Every local mutation is one closed owner typed intent
  applied to an isolated candidate and admitted only as the exact signed frame.
- Cross-process writer coordination, durable-head semantics, fsync, or retry policy.
- Centralized edit sequencing, Merkle edit-log ordering, global shard authority,
  or the legacy multi-document promotion model.

## Invariants

- `replicaDoc` is reconstructed only from a retained/prunable checkpoint base plus
  every locally accepted durable causal-frame closure. No provisional Y.Doc overlays
  it and no reconnect path replays a business command.
- Candidate validation happens on an isolated Y.Doc cloned from the latest
  `replicaDoc`. A stale, canceled, failed, or disposed candidate cannot mutate it;
  candidate state never replaces it.
- Local success signs once, durably commits immutable object, replication-outbox ref,
  journal record, and sole head, then applies the exact accepted delta to
  `replicaDoc`. A below-head frame never transmits or projects.
- Offline work uses the same final frame bytes. Reconnect requests and validates
  missing causal objects idempotently; it never reallocates identity/sequence or
  re-signs a frame.
- Restart, rebuild, unmount, and Project/shard scope change clear the session undo
  coordinator. Remote/bootstrap/recovery frames never enter or reorder its stacks.
  Owners materialize a new semantic inverse/forward intent; raw Y.UndoManager bytes
  never enter candidate, replica, journal, or wire.
- Missing or mismatched files in the root's sealed R5 authority release fail
  closed before decode or sign as `protocol-schema-bundle-unavailable`.
- Successor-shaped V3 authority DTOs, verification ports, and protocol codec
  strategy seams are non-active implementation scaffolding. The only selected
  production strategy remains V2 and requires `VerifiedProtocolAuthorityV2`.
  Never pass V3 evidence into the v2 kernel, dispatch V3 bytes without a verified
  successor selector, or infer activation from public exports or passing tests.
- A successor becomes usable only as one sealed release containing its complete
  core/context/frame and wire codec, admission closure, dual-version dispatcher,
  independently generated artifacts, external role receipts, review evidence,
  manifest, pointer, and mutation checks. Repository-local code or approval prose
  cannot satisfy that gate.
- The non-active V3 sharing-handoff codec binds one exact Project epoch, owner
  predecessor, ProjectIndex head, sorted live-Canvas head closure, initial Team
  artifact digests, and successor protocol. Its receipt requires owner and trusted
  service signatures over one core digest; handoff-id retries are byte-idempotent
  and any alternate bytes are equivocation.

Run `bun typecheck && bun test`.
