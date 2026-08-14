# @convax/marketplace contract

This package owns source-qualified Marketplace identities, public wire schemas,
strict validation, catalog aggregation, and source-conflict decisions.

- Keep the package headless and independently publishable.
- Validation is strict: reject unknown keys, ambiguous MCP profiles, duplicate
  identities, mutable same-version contracts, and malformed immutable metadata.
- `SourceKey` and `SelectionToken` are opaque Main-only values. Renderer-facing
  contracts may carry a token but cannot construct its payload.
- Builtin has one fixed product-defined source identity. Bundle release ids,
  product-lock revisions, artifact digests, and member lists are content state
  and must never enter its `SourceKey`; use `builtinSourceKey()`.
- Keep product-lock `recoveryArtifacts` bounded and disjoint from preinstall.
  Bind one exact retired source/id/version/archive/snapshot/Host-major tuple to one
  immutable Official replacement closure and derive its sole target SourceKey from
  the current fixed Official descriptor; an incomplete or ambiguous tuple fails.
- Marketplace membership never grants execution authority.
- Keep Plugin categories to the bounded `service`, `video`, `image`, and `skill`
  source-qualified display taxonomy. Desktop derives them from an exact validated
  manifest, and aggregation must keep them on the same representative source as the
  card's name and description. They are not Registry author input or authority.
- Add a failing boundary test before changing a contract.
