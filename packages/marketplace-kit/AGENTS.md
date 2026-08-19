# @convax/marketplace-kit contract

This package owns deterministic authoring-time generation for third-party and
Official Marketplaces. It depends only on the public `@convax/marketplace`,
`@convax/plugin-api`, and `@convax/plugin-sdk` APIs.

- Treat authored package contents and companion inputs as inert bytes.
- Never execute package lifecycle scripts or companion binaries.
- Generated Registry, Showcase, artifacts, and Builtin bundles must be byte
  deterministic for identical inputs.
- A selective catalog removal must name the exact production version, be absent
  from the candidate publication view, preserve every unselected Registry and
  Showcase entry byte-for-byte, and emit no replacement package Release.
- Inject Host API and inter-Plugin capability references into every Plugin-owned
  Skill archive from the validated manifest. Those generated reference paths are
  reserved and must reject hand-authored shadows.
- `add-target` is the only supported writer of companion inputs.
- A Builtin bundle is an inert, deterministic archive for a host installation that
  actually depends on those capabilities. This kit does not select Desktop product
  content, assign default-install policy, or stage a second catalog from a remote
  Marketplace.
- External Marketplace packages stay in their published descriptor, Registry,
  Showcase, and Release lifecycle; authoring tools must not copy a remote catalog
  into a product-specific distribution channel.
- Add a failing fixture or temporary-repository test before changing output.
