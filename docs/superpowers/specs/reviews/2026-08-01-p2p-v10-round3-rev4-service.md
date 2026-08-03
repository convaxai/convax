# P2P v10 round-3 revision-4 service review

Reviewed exact candidate:
`drafts/2026-08-01-p2p-v10-round3-consensus-candidate.md`

Declared SHA-256:
`ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`

Independently computed SHA-256:
`ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`

The candidate is 384 lines and 20,808 bytes. Digest and length verification passed
before semantic review. Scope is the sole rev3 service rejection patch plus a
regression scan of every previously accepted R3 clause. The candidate and
implementation were not modified.

## Rev3 patch verification

### Closed cutoff target and action

**PASS.** `RegistryCutoffTargetV2` is now a closed union rather than a nullable or
singular target tuple:

- a replica revoke binds member id/member authorization epoch plus exact replica
  id, actor id and replica authorization epoch;
- a member revoke or editor-to-viewer downgrade binds member id/member
  authorization epoch plus the complete pre-mutation active-editor
  replica/actor/authorization-epoch set;
- member replicas are uniquely sorted by replica id, bounded to eight, and checked
  exactly against the before-membership snapshot.

The coverage root binds this exact target and action, and the authorization mutation
must bind the same target/action and root digest. Wrong target kind, omitted or
duplicated actor, epoch mismatch, stale root and cross-target replay all fail. A
member leaf's certified frontier covers the union of all listed actors; its empty
value excludes every listed actor. Thus one member mutation has one portable,
signed subject and cannot accidentally retain an unlisted sibling replica.

This completely incorporates the rev3 minimum patch. Adding the closed `action`
discriminator is stricter than the requested shape and removes, rather than adds,
an ambiguity between replica revoke, member revoke and downgrade.

### Unlisted-scope proof rule

**PASS.** Rev4 removes the undefined optional non-membership-proof language. A scope
is unlisted only after every ordered content-addressed page verifies against the
root. Missing any page yields `cutoff-coverage-incomplete`; until completion no
target frame is accepted or excluded and no team-ready rebuild is claimed. The
current registry cannot substitute for the immutable cutoff coverage.

The seven-of-eight-page fixture is therefore deterministic and fail-closed. There
is no remaining implementation-defined proof codec or page-range interpretation.

## Regression scan

- **R3-1 checkpoint trust:** unchanged dual gate remains intact: stateless full
  content certification plus exact all-active-editor durable causal-floor ACKs.
  Only the prunable certificate authorizes pruning/bootstrap. Payload-zero service
  persistence, declarative Plugin validation, independent section ceilings and the
  320 MiB encoded-whole ceiling remain explicit.
- **R3-2 epoch ownership:** no `docEpoch` has returned. Project owns `projectEpoch`,
  `shardEpoch` and route CAS; actor sequence exhaustion rotates actor identity;
  ordinary forks remain quarantine/revoke cases. Reset preserves old bytes and
  never creates two route authorities.
- **R3-3 registry:** absence remains non-denying; ProjectIndex remains sole route
  truth. Candidate, dual-validated and abandoned states, immutable contiguous retry
  identity, strict leaf order, deterministic per-scope fold, quotas and atomic
  mutation/root/page storage remain intact. Rev4 changes only cutoff subject
  cardinality and complete-page verification.
- **R3-4 generation:** explicit dismissal still suppresses lifecycle/output claims
  without deleting resource history; canonical first-loss recovery proof and the
  single fixed recovery marker remain distinct. Canvas owns the headless external
  fact port and Project injects the non-serializable permit; no membership authority
  leaks into Canvas.

No new authority, convergence, replay-domain, persistence, dependency-direction or
boundedness ambiguity was found.

## Falsifiable acceptance tests

1. Give one member three active editor replicas with distinct actor and replica
   authorization epochs. Replica-R1 revoke must cut only R1. Member revoke and
   downgrade must encode exactly all three in one member target and produce the same
   retained frontier under every page/delivery order.
2. Omit or duplicate one member replica, alter either authorization epoch, bind a
   replica target to a member mutation, change revoke to downgrade, or replay the
   root for another cutoff id. Every case must reject before leaf effects apply.
3. Withhold one of eight pages while the desired scope is absent from the other
   seven. State must remain `cutoff-coverage-incomplete`; only the verified eighth
   page may make the fixed unlisted-empty rule applicable.
4. Re-run the maximum-carrier fixtures and crash points from R3-1, route-CAS crash
   fixtures from R3-2, registry retry/permutation fixtures from R3-3, and
   dismissal/success/recovery delivery permutations from R3-4. Any changed result
   invalidates this signature.

## Strongest rebuttals and flaw classification

1. The stateless attester still sees complete checkpoint content. This is a
   deliberate **privacy/trust tradeoff**, not a hidden assumption: deployments that
   require service content secrecy cannot also use the proposed bounded pruning
   path.
2. All-active-editor floor coverage lets an offline editor block pruning. This is an
   explicit **availability tradeoff**; revoke/cutoff is the only escape, and weakening
   it would reintroduce unsafe post-prune bootstrap.
3. The member target is capped at eight active editor replicas. This creates an
   **operational admission/cap coupling**: membership admission must keep that bound,
   or an over-cap member must be reduced through replica revokes before one member
   mutation is representable. It is not a convergence ambiguity in this candidate,
   because over-cap encoding rejects rather than truncates.

The earlier defects were an **authorization subject-cardinality omission** and an
**undefined proof language**. Rev4 resolves both. I checked target identity,
cardinality, action, authorization epochs, membership-snapshot binding, frontier
meaning, page completeness, replay domains, route authority, checkpoint gates,
generation ownership and dependency direction. The conclusion fails if any
implementation permits silent target truncation, derives membership from current
rather than bound snapshots, accepts partial coverage pages, or lets the attester
persist payload bytes.

## Exact-digest decision

**SIGN** exact revision-4 digest
`ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`.

Score: **8.9/10**. Deductions are for the disclosed attester privacy boundary,
all-editor pruning availability and the per-member replica cap. They are not fatal
under the candidate's stated threat model because each fails closed, has one owner
and does not create arrival-order state, silent overwrite, split route authority or
divergent cutoff semantics.
