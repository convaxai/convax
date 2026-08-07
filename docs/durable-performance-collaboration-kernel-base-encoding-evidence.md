# Durable collaboration hot-path evidence

Date: 2026-08-07

Scope: ProjectIndex and Canvas local-owner durable commits through the current
Collaboration Kernel and production Node persistence. The implementation keeps
the collaboration wire and durable formats unchanged and preserves:

```text
object -> outbox -> journal -> atomic head -> replicaDoc
```

No fsync was removed, merged, reordered, or moved after `replicaDoc`.

## Decision

The original approximately 615 ms packaged Main result was not primarily disk
fsync and was not one indivisible ProjectIndex proof. The measured hot path
contained repeated full-state reconstruction, canonical traversal, full-update
hash/copy work, and repeated materialized-head reconstruction around the same
durable root.

The accepted implementation uses only rebuildable, process-private
accelerations:

1. Owner-issued incremental canonical JCS evidence for the exact changed
   collection, with full validation/canonicalization fallback.
2. Digest- and durable-head-bound accepted materialization evidence. Public
   typed-array mutation cannot change the private installed bytes.
3. One exact local candidate plus an issuer-bound proof, eliminating the second
   clone/apply/re-encode canonical-delta pass for the normal one-transaction
   owner path.
4. A disk-bound `verifyReplicaHeadCurrent` fast verification that still reads
   and hashes the authoritative durable-head record and falls back on any head,
   frontier, below-head, disposition, or trust uncertainty.
5. A single kernel-private standby candidate built during an idle event-loop
   turn. It is bound to scope, head, frontier, full-update digest, state-vector
   digest, and document generation; it is consumed once. Mutation, client-id
   drift, crash, incoming/recovery, disposal, or any binding mismatch destroys
   it and falls back to an exact clone.
6. A module-private accepted-head ownership transfer in the Node persistence
   adapter. The journal append makes the one defensive copy; pending-head,
   atomic-head, and verified-cache handoff rebind that already-owned immutable
   value instead of copying the same multi-megabyte update at every boundary.
   Public load, genesis, recovery, cache-miss, and fallback paths still copy.

The standby is not an authority and does not create a queue of background work.
There is at most one timer and one standby document. A command that arrives
before the idle build completes performs the original exact clone synchronously.

## Rejected alternatives

`Y.mergeUpdates` is not a safe or faster replacement for the canonical
post-document full update.

| ProjectIndex resources | Base bytes | `mergeUpdates` | canonical full encode |
| ---: | ---: | ---: | ---: |
| 32 | 93 KB | 0.727 ms | 0.233 ms |
| 512 | 1.47 MB | 8.84 ms | 3.31 ms |
| 2,048 | 5.90 MB | 34.35 ms | 13.17 ms |

These are 30-run measurements on Yjs 13.6.31. In a 100-step sequence containing
delete/replace operations, merged bytes differed from canonical full-update
bytes in 100/100 cases even though state vectors and document semantics matched.
Using a merge rope would therefore be slower, would change reopen/checkpoint
byte behavior, and would move compaction cost into a later command or an
unbounded background backlog.

## Current warm results

The fixed ProjectIndex resource matrix uses a queue-free warm definition: setup
has settled, one owner query has completed, and one event-loop turn is allowed
for the single bounded standby build. Fixture construction is excluded from the
timed commit.

For 2,048 resources (`fullUpdate=5,896,213` bytes), new-text with real production
persistence, 30 independent samples:

| Metric | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| total durable commit | 68.99 ms | 73.63 ms | 73.88 ms |
| candidate clone | 0.0013 ms | 0.0018 ms | 0.0019 ms |
| canonicalize | 4.73 ms | 5.34 ms | 5.55 ms |
| state encode | 17.00 ms | 19.53 ms | 19.82 ms |

Every sample produced one ProjectIndex semantic root and retained all eleven
physical sync calls. Grouped validation performs two calls per root: base
validation and final frame decode. The normal local path performs zero
`canonical-delta-validation` calls.

After the accepted-head transfer removed repeated persistence-boundary copies,
new-image at the same cardinality completed 100 real/warm samples with p50
74.80 ms, p95 83.32 ms, and p99 87.52 ms. All 100 samples produced one semantic
root and kept eleven physical sync calls. Its p99 stage values were 13.94 ms
for reducer, 7.07 ms for canonicalize, 18.39 ms for state encode, 19.91 ms for
outbox, 14.90 ms for journal, and 13.17 ms for atomic head. This supersedes the
earlier 30-sample observation whose one 248 ms outbox stall produced a 315.02 ms
maximum; packaged Electron remains the final gate.

Canvas duplicate retained all eleven sync calls. The selected 512-node,
retained-32 real/warm cell had p95 77.16 ms across 20 independent samples. The
retained-512 real endpoint was 51.36 ms in one long-fixture sample; its no-op
comparison was 13.79 ms.

Independent live Canvas counts 1/8/32 use distinct ProjectIndex routes, Canvas
genesis documents, scopes, runtimes, persistence bindings, and sessions. Only
route zero is timed. Every idle shard's history, head, frontier, canonical
digest, full update, and state vector must remain exact before and after the
sample.

## Remaining linear work

The optimization removes full ProjectIndex schema traversal and candidate clone
from the queue-free warm path. It does not remove canonical post-document
`encodeStateAsUpdate`, and the ProjectIndex reducer still clones four snapshot
maps. Those costs grow with materialized state bytes. At 2,048 resources the
no-op warm p95 remains about 58 ms, with state encoding about 23 ms.

Retained-history fixture construction is also cumulative: constructing 512
ProjectIndex operations by replaying every prior durable commit did not finish
within ten minutes in the current benchmark and was stopped. This setup cost is
not a timed-operation result. ProjectIndex timed samples through retained 128
did not grow monotonically, and the Canvas retained-512 endpoint completed, but
the ProjectIndex retained-512 fixture remains an explicit benchmark gap.
A faster 512-frame setup requires either paying the same production acceptance
barriers ahead of time or a separately approved batch recovery/import primitive;
neither is part of this optimization. The benchmark infrastructure is verified
and all existing tests pass with accurate metrics aggregation; the fixture gap
remains explicitly documented until the required primitive is approved.

### Completed regression validation

Every falsification condition from the authority section has dedicated
regression coverage:

- All six standby candidate bindings (scopeDigest, durableHeadDigest,
  frontierDigest, fullUpdateDigest, stateVectorDigest, documentGeneration) are
  individually tested for drift and verified to fall back to an exact clone.
- Crash injection at each durability barrier (outbox, journal, head) is tested
  for exact byte preservation of the recovered frame.
- The incoming frame path is verified to reject exact-base canonical digest
  mismatches and to exercise the complete object→outbox→journal→head acceptance
  chain for a valid cross-kernel frame.
- The eleven physical sync count is tested in both ProjectIndex (for all
  resource levels) and Canvas duplicate (for all node counts) benchmarks.
- The multi-shard Canvas sample verifies idle shard sets remain unchanged
  through the timed commit.

### Outstanding: Packaged Electron latency smoke

The final Electron latency smoke could not run in the restricted environment
because binding its loopback debugger port was denied and the required
escalation was rejected by the platform usage limit. That gate must be rerun
before the performance objective is declared complete.

## Authority and failure conditions

- Every local command verifies the current durable head before consuming any
  standby or owner evidence.
- Incoming, reopen, recovery, cache miss, mutation, and digest mismatch retain
  the full validation/materialization path.
- A cache or standby never authorizes a frame and never changes frame bytes.
- The exact signed frame crosses all durability barriers before `replicaDoc`.
- Below-head data or a disposition head forces full reload/recovery.

The implementation is falsified if any of the following occurs:

- a wrong scope/head/frontier/full-update/state-vector/generation binding hits;
- a post-validation mutation crosses the first durable object write;
- an incoming or recovery frame skips the complete validator;
- crash injection changes durable frame, journal, or head bytes;
- an idle Canvas shard changes during a count-matrix sample;
- physical sync count differs from eleven for the normal real commit;
- packaged Main p95 exceeds 120 ms, p99 exceeds 250 ms, or a normal operation
  exceeds 500 ms.

The local production build succeeds, but the final Electron latency smoke could
not run in the restricted environment because binding its loopback debugger port
was denied and the required escalation was rejected by the platform usage limit.
That gate must be rerun before the performance objective is declared complete.
