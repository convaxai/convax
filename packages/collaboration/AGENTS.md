# Collaboration Package Contract

`@convax/collaboration` is a browser-safe, independently publishable Yjs kernel.
It has no knowledge of a Project, Canvas, Plugin, PeerJS peer, identity provider,
Electron, filesystem, React, or a concrete document schema.

This package implements exactly one current collaboration protocol. There is no
second decoder, kernel, reducer, codec strategy, authority selector, release pair,
dual-version dispatcher, promotion bridge, or successor runtime, and none may be
added back.

## Owns

- One current protocol descriptor and its exact `protocolDigest`, generated
  deterministically from the owner schemas and recomputed during build/CI.
- One set of ids/scopes/stamps, one restricted JCS canonicalization, the exact
  Yjs 13.6.31 update-v1 codec, bounded envelopes, causal frames/frontiers,
  exact-base validation, the binary `CVXCAR02` checkpoint-carrier structural codec,
  and checkpoint/causal-floor primitives.
- One Main-owned `replicaDoc` per shard plus one isolated `candidateDoc` per command.
  Owner packages inject their exact closed schema, reducer, canonicalizer, evidence,
  and external-fact ports.
- The final long-lived-replica-signed causal frame and its object/outbox/journal/head
  ordering contract. Replication outboxes and ACKs are metadata, never another doc.
- One closed signer-authority union for the current protocol: unshared
  `local-project-owner` and shared `team-replica`. The core commits the authority
  kind and structured digest; each branch requires its exact dependency subset.
- Transaction-origin separation, typed persistence/journal ports without an I/O
  implementation, and one transient session undo coordinator.

## Does not own

- ProjectIndex/Canvas schema or business projection, membership/reset policy,
  service registry, PeerJS transport, native persistence, authentication, or UI.
- Raw local-update submission. Every local mutation is one closed owner typed intent
  applied to an isolated candidate and admitted only as the exact signed frame.
- Cross-process writer coordination, durable-head semantics, fsync, or retry policy.
- Centralized edit sequencing, Merkle edit-log ordering, global shard authority,
  or a multi-document promotion model.
- Compatibility with retired experimental protocols. This package never ships a
  fallback decoder for bytes it did not produce.

## Invariants

- `replicaDoc` is reconstructed only from a retained/prunable checkpoint base plus
  every locally accepted durable causal-frame closure. No provisional Y.Doc overlays
  it and no reconnect path replays a business command.
- Candidate validation happens on an isolated Y.Doc cloned from the latest
  `replicaDoc`. A stale, canceled, failed, or disposed candidate cannot mutate it;
  candidate state never replaces it.
- After exact durable acceptance and replica application, the same isolated
  post-state may be retained only as a process-local next-command standby bound to
  the exact scope, durable head, frontier, full update, state vector and document
  generation. Any mismatch or lifecycle transition destroys or rebuilds it; it is
  never document authority.
- Local success signs once, durably commits immutable object, replication-outbox ref,
  journal record, and sole head, then applies the exact accepted delta to
  `replicaDoc`. A below-head frame never transmits or projects.
- Optional latency diagnostics are closed-stage, identity-free and failure-isolated.
  They may report only stage durations, bounded history/outbox counts and cache-hit
  booleans; Project/Canvas/entity identity and document content never enter them.
  Instrumentation cannot reorder or weaken the object/outbox/journal/head ports.
- Offline work uses the same final frame bytes. Reconnect requests and validates
  missing causal objects idempotently; it never reallocates identity/sequence or
  re-signs a frame.
- Restart, rebuild, unmount, and Project/shard scope change clear the session undo
  coordinator. Remote/bootstrap/recovery frames never enter or reorder its stacks.
  Owners materialize a new semantic inverse/forward intent; raw Y.UndoManager bytes
  never enter candidate, replica, journal, or wire.
- Dispatch, decode, and signing require the current descriptor to match the built
  digest exactly. A missing or drifted descriptor fails closed before any of them.
- Frame magic, wire format, or `protocolDigest` mismatch resolves to one
  `unsupported-project-data` result. Never try another decoder, guess a layout,
  reinterpret unknown bytes, or re-sign, renumber, or rewrite them.
- Wire identity is unversioned and carries no parallel `/2` or `/3` discriminator.
  Version-suffixed identifiers that still exist here are legacy names of this one
  implementation; renaming them is mechanical cleanup and never admits a second
  protocol.
- Never select behavior from directory presence, a durable record shape, public
  exports, source constants, a pointer file, an archived authority release, or
  passing tests. `docs/superpowers/specs/authorities/**` is non-runtime archive and
  review material and must not be read, staged, or imported by this package.
- Schema changes change the descriptor digest. They never add a second codec, a
  migration decoder, or a compatibility branch.
- Local-owner authorization is scope-, epoch-, schema-, and protocol-exact. It is
  not a Team credential surrogate, and a durable Team handoff may disable future
  local signing without invalidating retained current-protocol history.

Run `bun typecheck && bun test`.
