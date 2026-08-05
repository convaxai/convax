# Local-first Collaboration v11 — successor design draft

Status: **DRAFT / NON-ACTIVE / NOT AN AUTHORITY**

This document is design input for a possible successor to the frozen
Collaboration v10 R5 authority. It is not a runtime selector, protocol artifact,
review receipt, activation pointer, migration authorization, or fallback. No
implementation may decode, sign, admit, or replicate v11 objects until a complete
successor release has been independently generated, reviewed, sealed, and selected
by a dedicated active-authority pointer. The current v10 R5 directory and active
pointer remain byte-authoritative and immutable.

## 1. Decision and invariants

A Project is always local-first. Sharing adds remote membership and replication to
the same Project; it does not create a second document model or a "Team Project"
variant.

1. ProjectIndexYDoc and each CanvasYDoc retain their existing owner schemas and
   causal history. No JSON mirror, document replacement, or cross-document revision
   counter is introduced.
2. An unshared Project may create final frames under a durable local owner
   authority without contacting a control plane, membership service, Team vault, or
   PeerJS runtime.
3. A shared Project creates final frames only under Team replica authority. Once a
   sharing handoff commits, local-owner signing is permanently closed for that
   Project epoch, including while offline or when Team credentials are corrupt.
4. Historical v10 frames remain immutable evidence. A v11 implementation verifies
   them with the selected v10 R5 authority and never re-encodes, re-signs, or
   reinterprets them as v11.
5. Unsupported, incomplete, or contradictory authority state fails closed. It is
   never repaired by inventing membership digests or treating a formerly shared
   Project as unshared.

## 2. Closed signer authority

V11 replaces the Team-only signer shape and the three duplicated Team digest fields
with a closed tagged union and one signed authority digest.

```ts
type CausalSignerAuthorityV3 =
  | Readonly<{
      kind: "local-project-owner"
      ownerKeyId: PublicKeyIdV3
      replicaId: ReplicaIdV2
      actorId: ActorIdV2
      ownerBindingCoreDigest: DigestV2
      ownerEditAuthorizationCoreDigest: DigestV2
    }>
  | Readonly<{
      kind: "team-replica"
      memberId: MemberIdV2
      replicaId: ReplicaIdV2
      actorId: ActorIdV2
      memberAuthorizationEpoch: Id128V2
      replicaAuthorizationEpoch: Id128V2
      membershipSnapshotDigest: DigestV2
      replicaActorCredentialCoreDigest: DigestV2
      replicaEditAuthorizationCoreDigest: DigestV2
    }>
```

Both alternatives use exact-key parsing. Unknown `kind`, missing keys, extra keys,
nullable fields, cross-kind fields, and non-canonical values are rejected. The
structured digest domain is `convax.causal-signer-authority/3`; it covers the exact
parsed alternative including `kind`.

`CausalEditCoreV3` carries `signerAuthorityKind` and
`signerAuthorityDigest`. It does not carry nullable or sentinel Team fields.
`CausalContextV3` embeds the exact `CausalSignerAuthorityV3`. Frame closure requires:

```text
core.signerAuthorityKind == context.signerAuthority.kind
core.signerAuthorityDigest == Digest(context.signerAuthority)
core.actorId == context.signerAuthority.actorId
```

All other v10 exact-base, frontier, actor successor, intent, Yjs delta, evidence,
artifact, durability, and signature invariants remain mandatory in v11.

## 3. Exact dependency closure

The context dependency set remains strictly sorted and duplicate-free. Authority
dependencies are selected exclusively by signer kind:

| Signer kind | Mandatory authority dependencies | Forbidden authority dependencies |
| --- | --- | --- |
| `local-project-owner` | `local-owner-binding` matching `ownerBindingCoreDigest`; `local-owner-edit-authorization` matching `ownerEditAuthorizationCoreDigest` | membership snapshot, replica actor credential, replica edit authorization |
| `team-replica` | membership snapshot, replica actor credential, replica edit authorization matching all three signer fields | local owner binding, local owner edit authorization |

Owner-defined dependencies such as ProjectIndex proofs, Project resource proofs,
Plugin validation artifacts, generation facts, reset authorization, checkpoint
certificates, and authorization mutations remain additional typed references. Their
existing owner discovery and exact-consumption checks continue to apply.

Incoming authority verification returns only after resolving the complete
kind-specific proof closure:

```ts
type IncomingAuthorityVerificationV3 =
  | Readonly<{
      status: "verified"
      signerKind: CausalSignerAuthorityV3["kind"]
      signerAuthorityDigest: DigestV2
      publicKey: PublicKeyV2
    }>
  | Readonly<{ status: "pending"; missing: readonly CausalDependencyRefV3[] }>
  | Readonly<{ status: "rejected" }>
```

The verifier must recompute the authority digest, bind the public key to the exact
proof, bind actor and replica ids, enforce Project/epoch/scope, and then verify the
frame signature. A host-provided key without these bindings is insufficient.

## 4. Local owner authority

`LocalProjectOwnerBindingCoreV3` is durable Project-private authority. It binds:

- Project id and Project epoch;
- owner public-key id and exact public key;
- initial local replica and actor ids;
- owner schema and protocol digests;
- genesis ProjectIndex scope and initial Canvas authorization policy;
- a monotonic `sharingGeneration`, initially `0`;
- creation nonce and signature by the bound owner key.

The initial Canvas policy is not a wildcard. The ProjectIndex genesis authorization
may sign only the ProjectIndex scope. A Canvas owner authorization is derived only
from an already accepted ProjectIndex route/genesis object that binds the exact
Project id, Project epoch, Canvas id, shard epoch, and genesis digest. A copied or
future Canvas id has no authority until that route proof is durably accepted.

`LocalOwnerEditAuthorizationCoreV3` binds the owner binding digest, exact document
scope, actor/replica ids, actor sequence allocation policy, `sharingGeneration: 0`,
and an expiry policy of `none`. Its signature is by the bound owner key. It is valid
only while the durable Project sharing state is exactly `unshared` and no committed
handoff exists for the Project epoch.

The binding and key are native-adapter responsibilities outside the browser-safe
kernel. The kernel owns only closed codecs, digests, proof verification ports, and
causal admission. A missing, replaced, symlinked, malformed, or mismatched private
binding produces read-only recovery; it does not trigger key regeneration.
Owner-key loss, Project cloning, and restoration of a pre-sharing backup likewise
fail closed. They never regenerate or copy an actor authority implicitly; recovery
requires a separately reviewed, explicit identity procedure.

## 5. Sharing handoff

Sharing is a signed one-way authority transition for one Project epoch.

`ProjectSharingHandoffCoreV3` binds:

- Project id and Project epoch;
- previous local owner binding digest and owner public-key id;
- `sharingGeneration: 1`;
- exact ProjectIndex accepted frontier/head digest;
- the sorted exact set of every live Canvas scope and accepted frontier/head digest;
- the service trust bundle and initial membership snapshot digests;
- initial owner member, replica, actor, credential, and edit-authorization digests;
- the successor protocol digest and a unique handoff id.

The owner signs the handoff core. The control plane verifies that signature and the
exact causal closure, then co-signs a `ProjectSharingHandoffReceiptV3`. The receipt
is valid only when both signatures cover the same core digest.

The local transition uses this barrier:

1. Acquire the Project authority-transition lease and quiesce new local commands.
2. Flush every accepted frame through object/outbox/journal/head durability.
3. Re-read ProjectIndex and all live Canvas heads; build and owner-sign the exact
   handoff core.
4. Submit idempotently by handoff id. A retry must return the byte-identical receipt
   or reject equivocation.
5. Durably install the receipt, Team credentials, membership snapshot, and
   `sharingGeneration: 1` in one native compare-and-swap record.
6. Only after that CAS may Team signing start and local-owner signing remain closed.
7. Release the transition lease and asynchronously start rendezvous/PeerJS.

Owner editing may resume after step 4 only when the service returns a signed,
handoff-id-bound `definitive-not-committed` receipt or a definitive CAS-conflict
receipt proving another successor. Timeout, disconnect, 5xx, cancellation, and a
lost response are outcome-unknown: the Project remains quiesced in
`handoff-recovery-required`, queries by handoff id, and never resumes owner signing.
If step 5 committed, all restart and offline paths select Team authority. Failure to
start transport affects sync, not local Team-authorized editing.

The Project record is not sufficient anti-rollback state. A device-level durable
sharing tombstone, stored outside the Project tree and keyed by Project id/epoch,
records the highest accepted sharing generation and receipt digest. Project open
compares both authorities and fails closed on rollback or contradiction. Remote
Team ingress also permanently rejects local-owner frames for a handed-off epoch.
A copied pre-share tree may form an isolated offline fork under an explicit new
Project identity, but its frames can never enter the shared Project closure.

Stopping sharing revokes other members and invitations and advances Team cutoff
state. It does not decrement `sharingGeneration`, erase the receipt, or restore
local-owner authority.

## 6. Versioning, compatibility, and selection

V11 must use a new protocol major, envelope magic, frame/core/context formats,
digest domains, schema bundle, authority id, release directory, and active pointer.
It must not expand the v10 parser or reuse the v10 protocol digest.

A dual-version reader dispatches only after a bounded outer-envelope version check.
The sealed v11 successor manifest pins the complete sealed R5 identity chain as a
read-only verifier dependency with its exact pointer selection and member digests;
there are not two independently chosen live authorities:

- v10 bytes are passed unchanged to the live verified v10 R5 decoder;
- v11 bytes are rejected until a live verified v11 authority exists;
- unknown versions are rejected without heuristic parsing;
- a v10 authority can never sign or admit v11 frames, and vice versa.

Activation requires one complete immutable successor snapshot, independently
generated artifact digests, all required role review reports and external receipts,
review evidence, a sealed manifest, activation-CAS rules, mutation detection, and a
new pointer that selects only that exact release. This draft and all intermediate
design/review files are never selector candidates or runtime fallbacks.

The successor performs a one-time explicit Project protocol promotion before any
v11 write. It preserves the exact v10 object closure and installs a signed bridge
from every accepted v10 shard head/frontier to one initial v11 shard head. The first
v11 actor successor names that bridge digest as its predecessor; it is never `null`.
For an existing v10 shared Project, the bridge selects `team-replica` and carries the
verified current Team receipt/authority closure. For a v10 Project with no Team
ordinary-edit authority, an explicit local promotion creates and signs the v11 owner
binding, device anti-rollback record, and bridge atomically before the first edit.
Mixed v10/v11 heads and dual writes are forbidden. Merely changing a registry
version or opening a v10 Project with a v11 writer is forbidden.

## 7. Migration states

The durable resolver exposes these non-overlapping states:

| State | Allowed behavior |
| --- | --- |
| verified v10 Project | Existing v10 behavior only; no v11 writes |
| v11 unshared, valid owner binding, no handoff | local owner read/write; zero Team/control-plane/PeerJS startup |
| v11 handoff in progress | read-only/quiesced until idempotent recovery decides remote outcome |
| v11 shared, valid receipt and cached Team authority | local Team-authorized read/write; network sync starts asynchronously |
| v11 shared, authority temporarily unavailable | read; write only if the frozen successor explicitly validates a cached non-expired Team authorization |
| contradictory or corrupt evidence | read-only recovery and preserved bytes |

Migration never infers `unshared` from missing Team network access. The existence of
a valid handoff receipt or `sharingGeneration >= 1` permanently dominates any stale
owner binding. A Team membership snapshot, credential, or authorization must not be
synthesized to import v10 history.

## 8. Conformance and falsification tests

The successor cannot activate until all tests below pass against independently
generated vectors.

### Codec and cryptographic closure

- Both signer alternatives round-trip to byte-identical restricted JCS.
- Unknown kind, unknown field, cross-kind field, missing field, duplicate key,
  unsorted dependency, duplicate dependency, and non-canonical encoding reject.
- Removing, substituting, or changing any mandatory dependency rejects.
- Authority kind/digest tampering, actor/replica mismatch, scope mismatch, key
  substitution, core/context mismatch, and signature tampering reject.
- Team authority with local-owner dependencies and local-owner authority with Team
  dependencies reject.

### Compatibility and authority gating

- Every v10 golden frame decodes byte-identically under R5 after v11 code lands.
- Every v11 frame rejects under the v10 selector before parsing its inner sections.
- A structural clone or draft-derived object cannot satisfy either live authority
  verifier.
- Missing, extra, reordered, symlinked, mode-changed, or digest-mismatched successor
  release members fail closed before v11 decode or sign.
- Mutation of any frozen R5 member remains `activated-authority-mutation`.

### Local-first and handoff recovery

- Creating, opening, editing, and restarting an unshared Project performs zero
  control-plane, Team-vault, rendezvous, or PeerJS operations.
- Each handoff crash boundary is exercised. No outcome permits two signer kinds to
  create accepted successors from the same frontier.
- Remote commit with lost response recovers the byte-identical receipt by handoff
  id and never resumes owner signing.
- After sharing, service outage, credential corruption, stopping sharing, restart,
  and attempted registry rollback never restore owner signing.
- A revoked member's post-cutoff frame is rejected while its pre-cutoff accepted
  history remains readable and immutable.
- Project switching, cancellation, and stale async handoff responses cannot install
  authority into another Project or epoch.

### Acceptance failure conditions

The design is falsified if any conforming implementation can: sign a local-owner
frame after committed sharing; accept an authority without its exact proof closure;
decode v11 under R5; rewrite v10 objects during promotion; start Team infrastructure
for an unshared Project; or recover from ambiguity by inventing or downgrading
authority.

## 9. Explicit non-goals

- This draft does not activate v11 or authorize implementation against invented
  digests.
- It does not define ProjectIndex/Canvas business schemas, UI, PeerJS transport,
  membership service internals, native file layouts, or private-key storage.
- It does not permit changes to the frozen v10 R5 snapshot or its active pointer.
- It does not claim that sharing, initial replica provisioning, cutoff enforcement,
  or migration is production-ready before the successor release and integration
  tests exist.
