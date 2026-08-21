# @convax/marketplace contract

This package owns source-qualified Marketplace identities, public wire schemas,
strict validation, catalog aggregation, and source-conflict decisions.

- Keep the package headless and independently publishable.
- Validation is strict: reject unknown keys, ambiguous MCP profiles, duplicate
  identities, mutable same-version contracts, and malformed immutable metadata.
- `SourceKey` and `SelectionToken` are opaque Main-only values. Renderer-facing
  contracts may carry a token but cannot construct its payload.
- Builtin has one fixed installation-owned source identity. Bundle release ids,
  artifact digests, and member lists are content state and must never enter its
  `SourceKey`; use `builtinSourceKey()`.
- This protocol package does not select product content, define default
  installations, or authorize source migration. A host may compose a Builtin
  archive only from capabilities that are actual dependencies of that installation;
  external capabilities use ordinary source-qualified Marketplace lifecycle.
- Retired-major recovery remains bound to the installed capability's exact
  `SourceKey`; adding another source with matching package identity does not make it
  an update candidate.
- Marketplace membership never grants execution authority.
- Keep Plugin categories to the bounded `service`, `video`, `image`, and `skill`
  source-qualified display taxonomy. Desktop derives them from an exact validated
  manifest, and aggregation must keep them on the same representative source as the
  card's name and description. They are not Registry author input or authority.
- Add a failing boundary test before changing a contract.
