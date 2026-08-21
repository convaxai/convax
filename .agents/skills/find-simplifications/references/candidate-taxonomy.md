# Candidate taxonomy

Use these classes to broaden discovery without assuming that every match is removable.

## Dead or unused API

Look for public exports, methods, events, config keys, IPC methods, manifest fields, tool operations, registry notifications, and helpers with no verified consumer. Search both TypeScript names and serialized strings. A public or published surface with no in-repository call site remains ambiguous until external, generated, and dynamic consumers are checked.

## Duplicate representation

Find two durable or live forms of the same fact: JSON plus Yjs state, a catalog plus a canonical owner projection, cached authority plus source authority, persisted metadata derivable from an existing log, or renderer state mirroring Main/domain state. A cache is not automatically duplicate authority when it is explicitly disposable, validated, and never authorizes mutation.

## Duplicate lifecycle or state

Look for multiple flags, promises, queues, sentinels, registries, or controllers that all encode readiness, ownership, settlement, cancellation, recovery, or disposal. Consolidate only when one owner and transition model can preserve publication, rollback, first-terminal-outcome arbitration, and quiescence.

## Speculative surface

Question unused generality such as provider registries without multiple providers, extension points without product owners, compatibility layers for formats never shipped, background orchestration without a consumer, or configuration knobs that no deployment varies. Do not confuse generic Host behavior required by Plugin or Marketplace policy with speculation.

## Test-only production API

Identify production exports, setters, hooks, and constructors used only by tests. Prefer testing through the real owner boundary or injecting an existing typed port. Retain a test seam when it is also a legitimate failure, clock, filesystem, process, platform, or nondeterminism boundary.

## Package, config, event, and tool surface

Evaluate packages that own no independent invariant, config fields that only restate a constant, events with no consumer, and tools that duplicate an existing business operation. Removing a package must reduce ownership or release overhead, not move the same files into a less coherent bucket. Dynamic registration and string-based event/tool lookup require runtime-aware searches.

## Dependency replacement

Consider replacing owned parsers, framing, globbing, retry, canonicalization, or similar infrastructure with a healthy dependency or a Bun/Node builtin. Apply the full net-complexity and residual-semantics test in [net complexity and dependencies](net-complexity-and-dependencies.md); a wrapper around equivalent custom behavior is not a simplification.

## Protected design twins

Two implementations may deliberately prove a common contract or provide distinct durability, platform, trust, or delivery properties. Examples include runtime adapters, persistence backends, platform implementations, current-versus-archived evidence, and production-versus-test reference implementations. Treat a twin as intentional until its owning contract and consumers prove otherwise. Removing an unused method inside a protected seam can still be valid when the seam itself remains intact.
