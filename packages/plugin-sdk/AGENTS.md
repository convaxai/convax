# Plugin SDK Package Contract

`@convax/plugin-sdk` is the headless, independently publishable source of truth for
the current Convax Plugin package contract.

## Owns

- The current Plugin manifest schema and every portable contribution declaration.
- Plugin-to-Plugin capability export/import ABI, bounded value schemas, SemVer
  compatibility helpers, and deterministic authoring/Skill reference inputs.
- The portable `convax.plugin-host/8` Web MessagePort envelopes and author client,
  including the required `host.context.get` Web negotiation baseline,
  cached/refreshable Host API availability helpers, declaration checks, schema
  validation, discriminated API/capability/protocol failures, per-contract byte
  limits, cancellation, and bounded request correlation.
- Its payload-free sender-scoped disconnect control envelope is protocol lifecycle,
  not a Host API or Plugin capability. `client.close()` settles local work, posts
  it best-effort, then closes the MessagePort; teardown never awaits `beforeunload`.
- The rule that an exported operation is one exact verified sidecar MCP tool,
  including the pure `tools/list` input/output schema matcher used by Desktop
  readiness.
- Pure validation and authoring helpers that require no Host state.

## Does not own

- Host API catalog releases or Host API availability; those belong to
  `@convax/plugin-api`. The SDK only projects that same availability contract for a
  Web author; it must not define a second reason or API-id map.
- Installed Plugin identity, ActiveSet selection, dependency binding policy,
  snapshots, leases, grants, execution, IPC, filesystem, network, or UI state.
- Marketplace source/delivery schemas or concrete Plugin implementations.

The package may depend only on `@convax/plugin-api`. Keep portable contracts free of
Electron, Node, browser globals, native paths, credentials, and concrete Plugin ids.
`convax.plugin-capability/3` is Host-internal and must never be exported as an
authoring transport or accepted from an iframe.

SDK publication owns authoring-package provenance, not Host capability approval.
Protected publication must emit the independent
`convax.host-package-release/1` manifest described in
[`../../docs/plugin-sdk-release.md`](../../docs/plugin-sdk-release.md), binding the
exact SDK npm tarball and release-time Plugin API tarball/Catalog identity. It must
not absorb, replace, or reinterpret a Plugin API runtime-conformance or capability
decision receipt. Concrete Plugin bundle provenance remains a frozen-lock and
attestation responsibility in `convax-plugins`.

A concrete Plugin task may propose a missing contribution or inter-Plugin contract
but must not edit this package. Only a separate human-approved Host task may change
the SDK. Reject concrete Plugin ids, vendors, product-specific commands, direct
Plugin references, and service-locator semantics at the contract boundary.

Run `bun typecheck && bun test && bun run pack:check`.

Marketplace authoring must inject generated Host API and inter-Plugin references
into every Plugin-owned Skill archive. The generated reference paths are reserved;
source packages must not hand-maintain files that would shadow them.
