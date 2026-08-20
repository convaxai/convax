# Add Text durable hot-path evidence

Date: 2026-08-24

Scope: the normal fixed-size local Add Text flow, from immediate Renderer feedback
through Project file publication, one ProjectIndex mutation, one Canvas mutation,
accepted projection delivery, and editable text presentation.

## Decision

The previous implementation made a fixed-size edit pay for retained state multiple
times. It flattened and hashed complete owner state, asked Yjs to rescan the retained
StructStore to encode a small delta, copied reachable-frame sets and materialized
heads, wrote four separately durable collaboration records per shard, queried whole
ProjectIndex projections, rehydrated a whole Canvas, and republished the complete
React Flow node array.

The current implementation is a breaking single-current-protocol cutover. It does
not keep a predecessor decoder. Unsupported private collaboration bytes are retained
byte-exact in a recoverable archive; after explicit user confirmation the upgraded
Project starts a fresh current genesis.

The current protocol identity is:

```text
protocolDigest = b5b5980bca795d622049657409f1c3b3ed5d4f2eed98773caaea909520c42214
```

Its generated source-closure artifacts are:

| Owner artifact | Digest |
| --- | --- |
| Canvas schema | `58f5c364345b4816a4aae1abed5c962a2deccb361817ed59ddaf950e1217decc` |
| Collaboration kernel | `ea1c93b9434b572d2c9816bc86015bf354f0cb135e73768c0b574bbb5ae0d74b` |
| Control plane | `482313db5564bedd00619f5bc3b661158762053e45ac5111b9d98c17ee7f70ec` |
| Project persistence | `235f216452723a02c873292df26747d2d2c5e0bfb675ca302378f82c6e48a48b` |

The artifact generator records sorted exact source-file SHA-256 values, can be run
repeatedly without changing output, and is checked before packaging.

## Current normal flow

1. Renderer creates a Canvas-owned Portal ghost without inserting it into React
   Flow's authoritative node array. First feedback is bounded by the changed ghost,
   not total Canvas size.
2. Project publishes the user-visible Markdown file first and without clobbering.
   The repeated empty-text blob takes an exact digest lookup and re-verifies the
   durable object; it does not sort or rewrite the presence index.
3. ProjectIndex resolves only exact target/ancestor keys, applies a fixed number of
   persistent-index and Merkle-Patricia updates, then appends one accepted-frame WAL
   record and performs one file sync.
4. Canvas applies one typed intent. Placement, generation state, quick-connect
   anchors, canonical commitment, and projection use persistent exact indexes. The
   kernel signs the exact update bytes emitted by the sole candidate transaction;
   it does not call the retained-StructStore delta encoder.
5. Canvas appends one accepted-frame WAL record and performs one file sync.
6. Main returns an owner-certified fixed-size projection patch plus separately
   validated transient runtime state. Renderer applies that patch to the Canvas-owned
   keyed projection and bounded viewport. It does not query or materialize the whole
   accepted Canvas on the successful lane.

ProjectIndex and Canvas remain distinct authorities. File-first publication and the
two durable roots are intentionally not combined into a cross-shard transaction.

## Complexity contract

For fixed-size Add Text, normal hot work is bounded by changed bytes and a fixed
number of changed keys. Balanced indexes may path-copy logarithmically; bounded-key
Merkle-Patricia commitment work is independent of collection cardinality. The hot
path must not enumerate unrelated:

- Canvas nodes, edges, generation records, semantic history, or Yjs structs;
- ProjectIndex entries, resource families, locations, or materialization rows;
- blob-presence entries, accepted frames, outbox history, or reachable-frame sets;
- Renderer projection arrays, React Flow's complete document, or runtime overlays.

Bulk commands whose requested/output set is large may cost O(output). Cold open,
explicit recovery, checkpoint construction, export, cache loss, and truly pathless
filesystem invalidation may rebuild or traverse complete state once. They are
explicit boundaries, not work deferred from a successful fixed-size mutation.

Structural gates cover the boundary rather than relying on wall-clock assertions:

- owner commitment build/apply/digest at 1, 1k, and 10k entries;
- exact local Yjs transaction capture with retained StructStore history;
- ProjectIndex exact queries and incremental state at 256, 1,024, and 4,096 entries;
- 1,000 real Kernel/Project WAL appends with zero directory sync, cold scan,
  historical visit, or full-update materialization on the hot path;
- blob exact-presence admission at 256, 1,024, and 4,096 entries with one lookup,
  zero historical visit, zero sort, and zero presence-index rewrite;
- Canvas certified patch and Renderer application at 1, 1k, and 10k nodes with zero
  full projection build/traversal/materialization;
- generation history through 4,096 records with zero historical-generation visits;
- same-row dense placement through 10k nodes with bounded interval visits;
- quick-connect relation creation through 10k nodes with exact keyed reads;
- focused ancestry through depth 4,096 with two visits, and malformed/rootless
  ancestry capped at the 256-node working-set budget;
- a bounded mounted view of at most 256 authoritative nodes and 512 edges, with
  optimistic node and edge ghosts kept outside React Flow arrays.

## Durability

Every new document precreates `journals/accepted-frames.wal`. A normal accepted
frame appends one checksummed, digest-chained `CVXAWREC` record to the `CVXAWL01`
file and performs exactly one file sync. The record closes the exact signed frame,
state vector, durable delta, logical outbox, journal transition, and resulting head.

The process updates only disposable caches after that sync. A post-sync cache,
observer, or response failure cannot turn a durable success into a reported failed
mutation. Response-loss retry returns the byte-identical accepted result. Cold open
validates the complete checksum/digest chain and replays exact signed frames;
truncated tails are repaired only by a writer before another append. ACK,
checkpoint, prune, quarantine, and recovery remain explicit maintenance boundaries.

The normal ProjectIndex and Canvas roots each report one durability barrier:

```text
stage=accepted-frame-wal  barrierKind=file-sync  callCount=1
```

No normal accepted-frame root performs a directory sync or writes the retired
object/outbox/journal/head sequence.

## Packaged Electron results

The clean run used one Electron process and one growing fixture, one unmeasured
warm-up, then 30 measured Add Text operations. Diagnostics and record-all logging
were disabled for these timings.

| Metric | p50 | p95 | p99 / max |
| --- | ---: | ---: | ---: |
| click to first Renderer feedback | 5.9 ms | 12.0 ms | 12.5 ms |
| click to Main durable commit result | 68.9 ms | 281.9 ms | 310.7 ms |
| commit result to authoritative reconcile | 45.6 ms | 89.9 ms | 92.0 ms |
| click to authoritative reconcile | 124.4 ms | 324.7 ms | 345.5 ms |

With 30 samples, nearest-rank p99 is the maximum and is not presented as a stable
tail estimate. The <20 ms interaction target is met by first feedback, including
the growing-Canvas run. The authoritative result is not claimed to be <20 ms: it
contains no-clobber file publication and two serial durable authorities, and its
tail is dominated by operating-system persistence latency rather than retained
document traversal.

A separate diagnostics run used one warm-up and two measured operations. It is not
included in the timing table. Every measured Add Text produced one ProjectIndex root
and one Canvas root, and every root reported one accepted-frame-WAL file sync. The
observed sync durations were approximately 3.3-6.5 ms. The sampled Collaboration
roots were approximately 14-22 ms for ProjectIndex and 19-22 ms for Canvas; fixed
delta encoding itself was below 0.001 ms on the warm samples.

## Rejected shortcuts

- weakening or moving durability after `replicaDoc` publication;
- combining ProjectIndex and Canvas into a cross-owner WAL;
- moving a full scan, hash, hydration, or React Flow rebuild to background work;
- trusting Renderer-generated changed keys, paths, nodes, or Merkle roots;
- using private React Flow/Zustand internals as a complexity contract;
- retaining a predecessor collaboration decoder or silently rewriting old Projects.

## Falsification conditions

This result is invalid if a normal fixed-size Add Text:

- visits retained Canvas, ProjectIndex, blob, Yjs, WAL, or Renderer history;
- materializes a whole accepted projection on the certified-success lane;
- performs more than one accepted-frame WAL sync per owner root or any hot directory
  sync;
- reports success before file-first publication and both durable roots complete;
- accepts a stale/cross-owner commitment, projection patch, runtime sidecar, or
  candidate transaction;
- loses an external/pathless filesystem invalidation in order to preserve latency;
- decodes or mutates an unsupported archived Project instead of requiring the
  confirmed archive-and-fresh-genesis flow.
