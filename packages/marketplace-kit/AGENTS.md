# @convax/marketplace-kit contract

This package owns deterministic authoring-time generation for third-party and
Official Marketplaces. It depends only on the public `@convax/marketplace` API.

- Treat authored package contents and companion inputs as inert bytes.
- Never execute package lifecycle scripts or companion binaries.
- Generated Registry, Showcase, artifacts, and Builtin bundles must be byte
  deterministic for identical inputs.
- `add-target` is the only supported writer of companion inputs.
- Add a failing fixture or temporary-repository test before changing output.
