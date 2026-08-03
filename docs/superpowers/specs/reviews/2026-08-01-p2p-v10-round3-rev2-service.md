# P2P v10 round-3 revision-2 service review

Reviewed exact candidate:
`drafts/2026-08-01-p2p-v10-round3-consensus-candidate.md`

Declared SHA-256:
`a9e69fe85310bb9a86db4acbe7bca2953674e51990e939272a28bb248492ae72`

Independently computed SHA-256:
`a9e69fe85310bb9a86db4acbe7bca2953674e51990e939272a28bb248492ae72`

Digest verification passed before review. I also reread the full kernel round-3
review and checked every one of its six minimum patches, plus both minimum patches
from my prior service review. This file reviews the exact revision-2 bytes and does
not modify the candidate or implementation.

## Patch incorporation audit

| Required revision | Rev2 result | Decision |
| --- | --- | --- |
| Service: immutable paged registry cutoff coverage | `RegistryCutoffCoverageV2`, bounded pages/root, atomic authorization commit added | Incorporated, but retry duplicates expose one remaining ordering/fold ambiguity |
| Service: dismissal removes output claim and recomputes effective data | Existing/manual winner and pending-placeholder fallback added; suppressed resources retained | Fully incorporated |
| Kernel: carrier arithmetic and checkpoint failure-state scope | Proposal+parents, suffix and whole caps separated; seeded editing remains available | Incorporated except one impossible boundary assertion in the test |
| Kernel: reset reason narrowing | Actor sequence rotates actorId; only document Lamport exhaustion/unrecoverable state resets shard | Fully incorporated |
| Kernel: registry absence/default/abandonment/caps | Absence non-denying, unlisted target empty, abandonment, 64 MiB total cap and client-only unroutable state added | Fully incorporated except duplicate revision semantics below |
| Kernel: canonical generation recovery marker | Canonical first-loss receipt and one fixed recovery key added | Fully incorporated |
| Kernel: recovery permit dependency direction | Canvas-owned headless port, Project implementation, non-serializable local permit and remote pending added | Fully incorporated |

## R3-1 — Checkpoint carrier and dual gate

### Decision

**REJECT only the boundary fixture sentence; authority/state machine otherwise
passes.** The service content certificate and all-editor floor still prove distinct,
necessary properties. Package ownership, declarative-only Plugin eligibility,
payload-zero persistence, failure-state scoping and the dual-gated state machine are
now closed.

The remaining cap statement is arithmetically impossible:

```text
proposal + all parent snapshots <= 256 MiB
suffix <= 64 MiB
whole carrier <= 320 MiB
```

Those are valid independent ceilings. However the falsifiable test additionally
requires “Exact 256+64 MiB passes.” At exactly 320 MiB of snapshot and suffix bytes,
there is no byte left for mandatory carrier framing, checkpoint headers,
certificates, causal indexes or validation artifacts, all of which are part of the
whole carrier. Two conforming implementations could interpret the 320 MiB as payload
only versus full wire bytes and accept different carriers.

### Strongest objection

Treating this as test wording rather than semantics is tempting. It cannot be left
in a signed exact protocol because the test defines the valid language and directly
contradicts the whole-object cap. Raising the whole limit is unnecessary; independent
section ceilings are already allowed not to be simultaneously attainable.

### Falsifiable test

There must be three independent boundary fixtures: snapshot aggregate exactly
256 MiB with smaller suffix/metadata and whole <=320; suffix exactly 64 MiB with
smaller snapshots/metadata and whole <=320; and a complete encoded carrier exactly
320 MiB whose sections are each within their caps. Every corresponding `+1` case
fails before allocation/decompression.

### Remaining minimum patch

Replace only this candidate sentence:

> Exact 256+64 MiB passes; either component or the 320 MiB whole carrier over by one
> byte fails preallocation.

with:

> A proposal-plus-parent snapshot aggregate exactly 256 MiB passes only when suffix,
> framing, certificates and artifacts keep the encoded whole carrier at or below
> 320 MiB. A suffix exactly 64 MiB/4,096 frames passes under the same whole-carrier
> rule. At least one legal fixture MUST exercise an exact 320 MiB encoded carrier.
> Either component or the encoded whole carrier over by one byte fails before
> allocation/decompression. Section maxima are independent and need not be jointly
> attainable.

No other R3-1 change is requested.

## R3-2 — Epoch ownership

### Decision

**SIGN.** Rev2 closes the prior reset-trigger ambiguity: actor sequence exhaustion
rotates actorId; ordinary equivocation uses quarantine/revoke; only document-wide
Lamport exhaustion, incompatible schema, or corruption/equivocation unrecoverable
from every trusted checkpoint can replace a shard. Recovery resumes the same reset
claim and only a pre-CAS staged shard may be abandoned.

There is still no independent invariant for `docEpoch`: Project-owned `shardEpoch`
is the single document-history incarnation and reset CAS. Package direction,
64 KiB claim cap, failure states and crash tests are sufficient.

### Strongest objection

ProjectIndex corruption can delay a local Canvas reset. That is the deliberate cost
of one route/reset authority; a docEpoch controlled elsewhere would allow two layers
to disagree about the current Canvas universe.

### Falsifiable test

Retain the rev2 reset crash matrix and additionally assert that actor rotation after
sequence exhaustion preserves shardEpoch and that post-CAS recovery can never
abandon back to the old live route.

### Remaining minimum patch

None.

## R3-3 — Registry retry identity and cutoff fold

### Decision

**REJECT the retry/coverage ambiguity; all prior authority objections are closed.**
Rev2 correctly makes registry absence non-denying, promotion a discovery cache rather
than admission, unlisted scopes target-empty, candidate abandonment auditable, and
cutoff coverage immutable/paged/atomic. It is not a second route authority.

The remaining conflict appears when an abandoned claim is retried. The candidate
requires a “new claim revision” while retaining the abandoned entry forever. Thus
one exact document scope can have two retained entries: an abandoned revision with
`empty-target-frontier` and a later dual-validated revision with a certified target
frontier. But coverage leaves are sorted only by UTF-8 scope and defined one per
retained entry:

- equal scope keys have no unique canonical order;
- it is unspecified whether the empty older leaf overrides, intersects with or is
  neutral to the later certified leaf;
- “same scope” retry could alternatively be implemented as mutation of an abandoned
  entry, contradicting the terminal/auditable state machine.

This affects revocation survival, so it cannot be left to adapter choice.

### Strongest objection

Collapsing retries into one mutable scope entry would be simpler, but would erase
abandonment evidence and make `abandoned` nonterminal. Keeping immutable revisions
requires a canonical entry identity and an explicit per-scope frontier fold.

### Falsifiable test

Abandon revision 1 for scope S, promote revision 2 for the same S, and construct a
target cutoff under every insertion/page-fetch order. All peers must produce one
coverage digest and retain exactly the certified target closure. Repeat with two
abandoned revisions and no promoted revision; the effective target frontier must be
empty. Duplicate revision identity or conflicting certified frontier evidence must
fail closed.

### Remaining minimum patch

Add this paragraph to R3-3:

> `CollaborationScopeEntryV2` identity is exact
> `{scopeKey, registrarReplicaId, claimRevision}`. `claimRevision` is a canonical
> uint64, starts at `"1"` per `{scopeKey,registrarReplicaId}`, and increments exactly
> by one for each retry; an abandoned entry is terminal and never mutated back to
> candidate. `TargetCutoffLeafV2` is ordered strictly by
> `(UTF8(scopeKey), registrarReplicaId bytes, claimRevision unsigned)` and binds that
> exact entry digest. For target survival, leaves are folded per scope: all
> `registered-candidate` and `abandoned` empty leaves are neutral when at least one
> dual-validated leaf exists; the effective scope frontier is the deterministic
> `Max` union of every dual-validated certified target frontier. If no
> dual-validated leaf exists, it is `empty-target-frontier`. Conflicting proof for
> the same exact entry identity fails closed. Every retained revision still counts
> toward member/Project/64 MiB caps and exact coverage.

This patch preserves immutable audit evidence, bounded coverage and ProjectIndex's
sole route authority.

## R3-4 — Dismissal, canonical recovery and permit direction

### Decision

**SIGN.** Both service and kernel minimum patches are completely incorporated:

- dismissal excludes the matching generation output claim from effective data and
  deterministically falls back to remaining portable claims/placeholder;
- suppressed success remains a retained resource root;
- one canonical first-loss receipt exists per begin actor authorization instance;
- one fixed recovery key/value exists per generation, with later/noncanonical proof
  rejected;
- Canvas owns the headless external-fact port, Project verifies and injects it, and
  the non-serializable permit never enters Canvas public/wire/Y.Doc state;
- missing proof makes remote validation pending.

Dismissal and failed-recovery can coexist without semantic conflict: dismissal is
the visible lifecycle winner, while recovery is dormant audit evidence. Neither
claims cancellation/refund, and non-owner success remains impossible. O(1) marker
caps and the failure enum are closed.

### Strongest objection

Any editor can irreversibly hide a valid success and the product may conflate that
with external cancellation. That is disclosed editor authority, not convergence
ambiguity. UI/telemetry must preserve the distinct `dismissed` and
`failed-recovery` meanings.

### Falsifiable test

Retain the rev2 permutation tests and add static package-boundary tests proving
Canvas has no Project/API/membership import and structured-clone tests proving the
local recovery permit cannot enter an intent, frame or Y.Doc.

### Remaining minimum patch

None.

## Exact-digest decision

**REJECT** exact revision-2 digest
`a9e69fe85310bb9a86db4acbe7bca2953674e51990e939272a28bb248492ae72`.

Only two small semantic patches remain:

1. correct the impossible R3-1 exact `256+64` carrier boundary fixture while keeping
   all three independent caps;
2. define immutable retry entry identity/order and deterministic per-scope cutoff
   frontier folding in R3-3.

R3-2 and R3-4 are ready to sign. All minimum patches from the prior service review
and the kernel review are otherwise present without a new package-direction or
authority regression.

## Strongest overall rebuttals, flaw types and score

The strongest remaining objections to the architecture are unchanged: the dual gate
combines central content exposure with all-editor availability; a lost editor can
block pruning until revoke strands its work; and candidate/dismissal powers remain
bounded authorized-editor abuse surfaces.

The rev2 blockers are narrower: a **cap/test contradiction** changes the accepted
carrier language, and an **immutable-state identity/fold omission** changes target
frame survival after registration retry. Both are falsifiable interoperability
defects, not formatting issues.

Score for exact rev2: **8.3/10**. It remains unsigned because consensus requires one
valid language at every cap and one cutoff result for every retained registry state.
After only the two patches above, the expected score is **8.8/10**; remaining risks
are explicit threat-model/product tradeoffs rather than hidden state-machine forks.
