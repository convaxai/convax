# Plugin SDK Package Contract

`@convax/plugin-sdk` is the headless, independently publishable source of truth for
the admitted Convax Plugin package contracts.

## Owns

- The closed `convax.plugin/8` manifest schema, the additive
  `convax.plugin/9` manifest schema, their generic discriminated parser, and every
  portable contribution declaration. V8 stays byte- and semantics-compatible: its
  optional singleton `contributes.service`, Plugin-level generation/LLM/runtime,
  validation order, and error behavior must not be projected through or changed by
  v9.
- V9 retains the v8 non-Service contribution plane and one top-level immutable
  runtime artifact. Its optional `services` array contains 1–16 service profiles;
  each profile has a Plugin-local id, display strings, possibly empty actions,
  optional generation, optional LLM, and static runtime args appended to the base
  runtime args. A Service never has to provide generation or LLM, and either
  contribution remains independently optional. Its id must differ from the owning
  Plugin id, which is reserved for the top-level runtime projection. A present `services` collection is
  executable: runtime must exist exactly when any Service, top-level generation or
  LLM, or capability export exists; runtime alone remains invalid.
- Service-local generation tool/model ids are unique only inside one service and
  may repeat in another service. Agent/Canvas tool references and capability
  exports continue to resolve only against top-level generation and the base
  runtime; v9 adds no service selector to those declarations.
- Bounded `i18n` resources, canonical locale/message-key validation, reserved
  metadata keys, localized contribution text, and the one deterministic fallback
  algorithm. Desktop may project a locale but must not fork this resolution logic.
- Plugin-to-Plugin capability export/import ABI, bounded value schemas, SemVer
  compatibility helpers, and deterministic authoring/Skill reference inputs.
- The portable `convax.plugin-host/8` Web MessagePort envelopes and author client,
  including the required `host.context.get` Web negotiation baseline,
  `host.locale.changed` validation and race-safe `getLocale`/`onLocaleChange`,
  cached/refreshable Host API availability helpers, declaration checks, schema
  validation, discriminated API/capability/protocol failures, per-contract byte
  limits, cancellation, and bounded request correlation.
- Its payload-free sender-scoped disconnect control envelope is protocol lifecycle,
  not a Host API or Plugin capability. `client.close()` settles local work, posts
  it best-effort, then closes the MessagePort; teardown never awaits `beforeunload`.
- The portable contribution-scoped `convax.pet-host/1` contract and Pet surface
  client. The client derives Plugin identity from the immutable Plugin origin;
  callers never supply a concrete Plugin id.
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

The package may depend only on `@convax/bounded-value` and `@convax/plugin-api`.
Keep portable contracts free of Electron, Node, browser globals, native paths,
credentials, and concrete Plugin ids.
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
