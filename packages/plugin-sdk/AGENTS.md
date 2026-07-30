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

A concrete Plugin task may propose a missing contribution or inter-Plugin contract
but must not edit this package. Only a separate human-approved Host task may change
the SDK. Reject concrete Plugin ids, vendors, product-specific commands, direct
Plugin references, and service-locator semantics at the contract boundary.

Run `bun typecheck && bun test && bun run pack:check`.

Marketplace authoring must inject generated Host API and inter-Plugin references
into every Plugin-owned Skill archive. The generated reference paths are reserved;
source packages must not hand-maintain files that would shadow them.
