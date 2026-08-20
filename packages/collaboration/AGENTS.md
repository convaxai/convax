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
- The final long-lived-replica-signed causal frame and one owner-agnostic atomic
  accepted-frame port that closes its immutable object, required replication
  outbox, durable delta metadata, journal, and sole shard head. Replication
  outboxes and ACKs are metadata, never another doc.
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
- Cross-process writer coordination, native transaction/WAL implementation, fsync
  mechanics, or storage retry scheduling. Collaboration owns the atomic port's
  fail-closed and idempotent evidence semantics; Project/node owns how they are
  durably implemented.
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
  candidate state never replaces it. Cold open prepares the first private standby
  candidate while full-state work is already allowed; each accepted local or remote
  delta transfers an exactly bound successor standby. A normal fixed-size local
  mutation therefore does not clone retained document history. Cache corruption or
  loss discards the standby and takes the explicit cold-validation fallback.
- The one exact local candidate transaction emits the update-v1 bytes used by the
  final frame. The kernel binds those bytes to the expected origin, signer replica,
  candidate generation, post state vector and sealed owner result, then requires
  applying the frame to `replicaDoc` to emit those same bytes. A normal local commit
  never calls a full-document delta encoder or scans retained Yjs structs/delete
  sets. Missing, multiple, widened or wrong-origin events reject the local attempt
  before durability; they are never guessed, merged or admitted by a second encoder.
- Local success signs once, invokes exactly one mandatory `commitAcceptedFrame`
  operation for immutable object, replication-outbox ref, closed durable delta
  metadata, journal record, and sole head, then applies the exact accepted delta
  to `replicaDoc`. The retired four-write port is not a fallback. A below-head
  frame never transmits or projects, and one call never spans shards.
- `AcceptedHeadMaterializationEvidence` is process-local issuer authority. A WAL,
  capsule, or checkpoint chain may persist only its closed
  `AcceptedHeadDurableDeltaMetadata` projection, never the brand, work counters,
  or a hot-path full Yjs update. Cold recovery replays each exact signed frame,
  validates the exact owner state commitment and state vector, and compares every
  durable-delta field before admitting the recovered head.
- A complete atomic commit is idempotent by the exact request. Response loss,
  process-local cache loss, or an observer failure after its fsync cannot turn it
  into a reported failure; retry returns the same committed evidence. A partial or
  truncated tail is repairable only when no success could have been reported.
- Optional latency diagnostics are closed-stage, identity-free and failure-isolated.
  They may report only stage durations, bounded history/outbox counts and cache-hit
  booleans; Project/Canvas/entity identity and document content never enter them.
  Instrumentation exposes one atomic accepted-frame stage and cannot split,
  reorder, or weaken that port.
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
