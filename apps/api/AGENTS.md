# API Collaboration Service Contract

`@convax/api` is the Web-standard collaboration service owner. It owns membership
records, monotonic non-reusable replica-id reservations, offline edit
authorizations, session challenges/leases, signed credentials, peer rendezvous and
freshness, transient content-attestation orchestration, checkpoint/floor metadata,
registered-scope anti-rollback/discovery, cutoff coverage, and reset/rollover control
transactions.

## Allowed dependencies

- `@convax/collaboration`
- `@convax/project/collaboration-protocol`

It must remain browser/worker-safe: no Node built-ins, Electron, filesystem,
Desktop/UI, deployment credentials, PeerJS, or concrete database SDK imports.
Adapters provide durable membership transactions, signing, proof verification,
random allocation, time, and signaling configuration through typed ports.

## Security invariants

- A `peerId` is rendezvous routing only. It never authenticates a caller or grants
  access to membership, tickets, edit authorization, checkpoints, or payload bytes.
- Session proof, challenge consumption, credential issue, membership/current-role
  recheck, counter advancement, nonce use, idempotency record, and session write
  happen in the same injected membership transaction.
- Every credential endpoint verifies the purpose-separated service signature and
  compares project/member/actor/role/epoch/key/session fields with current records
  in that same transaction. Role change or revocation therefore fences old leases.
- Unknown keys, malformed/oversized bodies, replayed nonce/challenge/counter, stale
  credentials, and unimplemented endpoints fail closed. This service never stores
  Yjs updates, blob chunks, Canvas state, or Project file content.
- The service never orders ordinary edits. It has no centralized edit sequence,
  Merkle edit-log reservation, global shard revision token, or command replay path. Existing
  authorized replicas remain able to create final durable signed frames while the
  service and all Peers are offline.
- ProjectIndex is the only current route/tombstone and `shardEpoch` authority. The
  registered-scope service registry is bounded advisory anti-rollback/discovery
  metadata; absence cannot deny a ProjectIndex-proved scope and registry-only state
  cannot grant, hide, revive, or block a Project floor scope.
- Checkpoint pruning requires both a content certificate from the isolated stateless
  attester and exact causal-floor ACK coverage from every active editor in the bound
  membership snapshot. Service CAS serializes that GC metadata only and never
  selects an edit winner.
- Ordinary API/storage/log/trace/retry surfaces accept no checkpoint, frame, Yjs,
  typed-intent, Plugin-state, Project-file, or blob payload. Only the isolated
  streaming attester sees bounded payload and it exposes no durable payload-write
  port.
- The isolated checkpoint handler accepts only the exact `CVXCAR02` content type,
  validates the public carrier preamble/index and per-section length/hash while
  streaming into an injected process-scoped ephemeral store, and destroys every
  section on success, rejection, cancellation, audit failure, or adapter failure.
  It signs only after `assertDocumentOwnerRuntime` proves that the resolver
  returned a live runtime from the current collaboration protocol. Structural owner
  ports, repository-current owner code, and a missing artifact executable resolver
  fail closed. The ordinary control router never mounts this payload endpoint.
- Project bootstrap binds the exact Project manifest epoch, shard epoch,
  initialization authority and four empty-ProjectIndex digests. Member-add is a
  two-half mediator over one request digest: current admin and target possession
  sign independently, while the service never signs either half. Pending-editor
  floor-install ACKs are retained separately from the exact active-editor ACK set
  that authorizes pruning.
- Team reset is challenge/proof plus isolated empty-ProjectIndex attestation and one
  atomic rollover transaction. A separately admitted service-signed reset receipt
  is not a valid mutation path.
- Consume only the public root of `@convax/collaboration` and the browser-safe
  `@convax/project/collaboration-protocol` export for the current collaboration
  protocol. A missing or mismatched artifact/digest fails closed;
  private Project/Canvas source and old drafts are never decoder fallbacks.

## Verification

Run `bun typecheck`, `bun test`, and `bun run package:boundaries` from the repo
root for dependency changes. Contract tests must cover replay, stale counter,
revoked/expired leases, active-peer filtering, peerId non-authority, ticket ordering,
and credential contents.
