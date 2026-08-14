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
- Product-lock schema `convax.marketplace-product-lock/3` uses one bounded
  `packages` collection in both policy and resolved state. Each exact Official
  identity has canonical purposes and targets; one Plugin closure may serve both
  `default-install` and `retired-recovery` without duplicating its immutable bytes.
- A standalone Skill product-lock entry may serve only `default-install`, remains
  portable, and must not carry Plugin-owned closure fields. Plugin-owned Skills
  remain members of their owner Plugin closure and are never independently selected.
- A `retired-recovery` purpose binds one exact retired
  source/id/version/archive/snapshot/Host-major tuple to the current immutable
  Official replacement and fixed Official SourceKey. It never authorizes a fresh
  install; if the same closure also has `default-install`, fresh provisioning is
  admitted only through that independent purpose. Incomplete or ambiguous bindings
  fail closed.
- `default-install` is an explicit product provisioning policy, not a property
  inferred from general Marketplace membership or packaged byte presence.
- Marketplace membership never grants execution authority.
- Keep Plugin categories to the bounded `service`, `video`, `image`, and `skill`
  source-qualified display taxonomy. Desktop derives them from an exact validated
  manifest, and aggregation must keep them on the same representative source as the
  card's name and description. They are not Registry author input or authority.
- Add a failing boundary test before changing a contract.
