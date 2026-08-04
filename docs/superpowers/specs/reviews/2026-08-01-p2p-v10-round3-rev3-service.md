# P2P v10 round-3 revision-3 service review

Reviewed exact candidate:
`drafts/2026-08-01-p2p-v10-round3-consensus-candidate.md`

Declared SHA-256:
`e5a92156aabae8cbb6d4f5957aafe82bfe3938176fff6f3395ec68b6a5d75fdb`

Independently computed SHA-256:
`e5a92156aabae8cbb6d4f5957aafe82bfe3938176fff6f3395ec68b6a5d75fdb`

Digest verification passed before review. Scope is limited to the two service rev2
patches, the kernel cutoff-coverage patch, and regression checks of already accepted
R3 semantics. The candidate and implementation were not modified.

## Rev2 service patch verification

### Encoded carrier cap

**PASS.** Rev3 now distinguishes:

- proposal plus parent snapshot aggregate `<=256 MiB`;
- suffix `<=64 MiB / 4,096 frames`;
- complete encoded carrier, including framing/certificates/indexes/artifacts,
  `<=320 MiB`.

It explicitly says section ceilings need not be jointly attainable. Its tests cover
each section at its own maximum under the encoded-whole limit, one legal encoded
carrier at exactly 320 MiB, and every `+1` rejection before allocation. The rev2
`256+64` contradiction is gone without raising a cap or weakening payload-zero
attestation.

### Immutable registry retry and per-scope fold

**PASS.** Entry identity is now exact
`{scopeKey,registrarReplicaId,claimRevision}`; revision starts at 1 and advances
exactly after terminal abandonment. Retained leaves have a strict total order over
scope, registrar and unsigned revision. Duplicate/gap/conflicting identities fail
closed.

The participating revision and per-scope fold are deterministic: per registrar only
the highest authenticated contiguous legal revision participates; any participating
dual-validated evidence dominates candidate/abandoned empty leaves; multiple
certified frontiers combine through deterministic `Max`; no certified leaf means
empty. Every old revision remains covered and counts toward caps. This closes both
the equal-scope ordering and empty-versus-certified survival ambiguity from rev2.

Falsifiable acceptance fixture: abandoned revision 1 plus dual-validated revision 2
must preserve the same target closure under every insertion/page order; only
abandoned/candidate revisions must yield empty; duplicate/gap/conflicting exact
identity must reject.

## Kernel coverage patch verification

### Incorporated portions

Rev3 correctly binds the coverage root to project/projectEpoch, unique cutoff id,
target fields, prior authorization epoch, before/after membership snapshots,
registry sequence/root, fixed unlisted-empty policy, page digests and leaf count.
The authorization mutation binds the root digest. Pages/root/mutation commit
atomically; target/epoch/root replay fails. Missing coverage is
`cutoff-coverage-incomplete`, current mutable registry never substitutes, and no
target frame is accepted/excluded before coverage is proven.

These changes close the kernel review's signature-domain, cross-mutation replay and
fail-closed lazy-page objections.

### Remaining target-cardinality ambiguity

**BLOCKING.** The root currently names one target
`memberId/replicaId/actorId` and one `priorAuthorizationEpoch`, while the protocol
supports both replica revoke and member revoke/editor-to-viewer downgrade. A member
may own multiple active replica actors with distinct replica authorization epochs.
The text does not say whether a member mutation:

- creates one actor-scoped root and accidentally leaves other replicas uncovered;
- creates multiple roots even though the mutation binds singular “the
  coverage-root digest”;
- treats the triple as nullable/member-scoped; or
- aggregates all actors into an unstated target frontier.

Those choices retain different historical frames. A database transaction cannot
fill in a missing portable target union.

### Remaining non-membership-proof ambiguity

**BLOCKING.** Rev3 allows unlisted-empty after all pages **or a canonical
root-authenticated non-membership proof**, but defines no proof DTO, page range
commitment, tree algorithm, digest domain or verification rule. One implementation
may accept an ad-hoc neighbor proof while another requires every page. Because the
registry is capped at eight pages/4 MiB, v2 can safely require complete coverage and
defer compact non-membership proofs to a future protocol.

### Strongest objection

These may look like ordinary DTO details. They decide which actor's old frames
survive a member authorization mutation and when a peer may apply the unlisted-empty
default. Both are authorization semantics, not adapter choices.

### Falsifiable tests

1. Give member M three editor replicas and independent frames in one scope. Revoke
   only replica R1: only R1 uses its actor cutoff. Downgrade/revoke M: all three
   prior actor identities must be covered by one exact signed subject and the same
   result must hold under page order permutations.
2. Swap a replica-scoped coverage root into a member-scoped mutation, omit one
   affected actor, or replay a prior member/replica authorization epoch; reject
   before applying leaves.
3. Supply seven of eight pages with no matching scope; state remains
   `cutoff-coverage-incomplete`. Only after the eighth verified page may unlisted
   empty apply.

### Only remaining minimum patch

Replace the singular target fields with this closed target union and remove the
undefined proof shortcut:

```ts
type RegistryCutoffTargetV2 =
  | {
      kind: "replica"
      memberId: MemberIdV1
      priorMemberAuthorizationEpoch: Id128V1
      replicaId: ReplicaIdV1
      actorId: ReplicaActorIdV1
      priorReplicaAuthorizationEpoch: Id128V1
    }
  | {
      kind: "member"
      memberId: MemberIdV1
      priorMemberAuthorizationEpoch: Id128V1
      replicas: Array<{
        replicaId: ReplicaIdV1
        actorId: ReplicaActorIdV1
        priorReplicaAuthorizationEpoch: Id128V1
      }> // exact pre-mutation active editor replicas, sorted by replicaId bytes, max 8
    }
```

`RegistryCutoffCoverageRootV2` MUST bind this exact closed target. For a member
target, every certified target-frontier digest in a leaf represents the causal
frontier of the union of frames authored by the listed actor set; empty excludes
all listed target actors. Service verifies the listed replicas exactly equal the
pre-mutation membership snapshot's active editor replicas for that member. Replica
mutation binds a replica-target root; member revoke/downgrade binds a member-target
root. Wrong kind, omission, duplicate actor or epoch mismatch fails closed.

For v2, delete “or a canonical root-authenticated non-membership proof.” A scope is
unlisted only after every ordered page has been fetched and verified against the
root. Before that, state is `cutoff-coverage-incomplete`. A future additive protocol
may define a content-addressed non-membership proof with its own frozen codec.

No other coverage, registry or route-authority change is requested.

## Regression scan of accepted semantics

- **R3-1:** dual content/floor gates, active-editor coverage, common-validator threat
  limit, declarative Plugin boundary and payload-zero persistence remain intact.
- **R3-2:** no docEpoch; Project-owned shard reset; actor sequence rotation and
  narrow destructive reset triggers remain intact.
- **R3-3:** registry remains non-denying discovery/security metadata, never route or
  bootstrap authority; abandonment and caps remain bounded.
- **R3-4:** dismissal fallback, retained output resources, canonical single recovery
  marker and Canvas-owned/Project-injected permit direction remain intact.

No regression was found outside the remaining cutoff-target/proof issue.

## Exact-digest decision

**REJECT** exact revision-3 digest
`e5a92156aabae8cbb6d4f5957aafe82bfe3938176fff6f3395ec68b6a5d75fdb`.

The carrier and registry-retry service patches are fully resolved. The only remaining
patch is the closed cutoff target union plus removal of the undefined optional
non-membership proof. This is one localized coverage-object correction; it does not
change checkpoint trust, epoch ownership, ProjectIndex route authority, registry
state machine or generation semantics.

## Strongest overall rebuttals, flaw types and score

The architecture's strongest residual objections remain central attester exposure,
all-editor compaction availability and bounded authorized-editor registry/dismissal
abuse. Those are explicit product/threat-model costs.

The rev3 rejection is narrower: an **authorization subject cardinality omission**
and an **undefined proof language** can make peers retain different revoked actors'
frames. Exact consensus cannot delegate either to implementation convention.

Score for exact rev3: **8.6/10**. With the single coverage-object patch above, the
expected score is **8.9/10**; remaining deductions are disclosed trust/availability
costs rather than authority or convergence gaps.
