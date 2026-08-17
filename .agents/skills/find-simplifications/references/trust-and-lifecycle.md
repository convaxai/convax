# Trust and lifecycle audit

Simplification is unsafe when it collapses mechanisms that protect different owners, trust sources, or terminal transitions.

## Trace every value

For each defensive copy, validation, freeze, digest, guard, or callback capture, answer:

1. Where did the value originate?
2. Who owns and may mutate it now?
3. Which process, parser, persistence, IPC, worker, network, Plugin, or filesystem boundary did it cross?
4. Who consumes it next, and does that consumer retain it asynchronously?
5. Which stale identity, scope, revision, lease, semantic guard, or content fact must be rechecked before side effects?

Same-process typed calls may often borrow readonly values. Parser output, config, model/tool JSON, Plugin payloads, durable bytes, filesystem state, queued messages, IPC, workers, subprocesses, and wire data require owner-appropriate validation or immutable capture. Do not delete validation merely because TypeScript describes the value after it crossed an untyped boundary.

## Draw the asynchronous ownership graph

For non-trivial lifecycle code, list the nodes and directed ownership edges:

```text
caller -> admission -> queued operation -> active external work -> terminal commit
                     \-> cancellation      \-> cleanup/disposal
```

Map each flag, promise, registry entry, abort signal, process handle, lease, and disposer to one owner and transition. Multiple mechanisms are candidates for consolidation only when they encode the same fact and have the same publication and teardown boundary.

Preserve separate machinery when it protects:

- synchronous admission or publication before asynchronous work;
- rollback versus post-commit cleanup;
- first-terminal-outcome arbitration;
- stale response, identity, scope, or revision rejection;
- callback exception containment;
- process or worker tree ownership;
- durable commit versus delivery acknowledgement;
- active-use leases versus future-call routing;
- recovery observation versus mutation authority.

## Settlement and cancellation

Name the terminal outcomes and who is allowed to publish each one. Cancellation must propagate to queued and active work where the public contract promises it; cancellation after an admitted durable or billable boundary may instead stop waiting while preserving completion. Do not merge those semantics into one boolean.

Check error, timeout, cancel, stale-result, renderer loss, process exit, restart, and retry paths. A “done” promise is only redundant when every path settles it exactly once and no owner awaits it for quiescence.

## Dispose to quiescence

Disposal must stop admission, detach or silence callbacks, request cancellation, and await owned work or process exit before releasing the resources that work can still touch. A method that only calls `abort()` or `kill()` is not equivalent to a quiescence barrier.

When simplifying teardown, prove:

- no new work enters after disposal begins;
- late callbacks cannot publish into disposed state;
- child processes, workers, streams, listeners, and timers are closed or awaited;
- failure remains observable at the correct owner;
- retry or recovery state is not deleted before success.

Convax persistence, collaboration, generation/LRO, managed-stdio, Plugin lease, and Electron sender lifecycles are high-risk examples. Their separate state often represents distinct authority rather than accidental duplication.
