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
- The Official `catalogs/packaged.json` file selects a bounded generic product
  byte closure of Plugins and standalone Skills. It does not assign runtime
  purpose: the Host product lock independently decides whether a selected Plugin
  is a default install, retired recovery input, or both. Plugin-owned Skills enter
  only through their owner Plugin closure.
- Re-staging a product-lock catalog fragment from exact published Official
  descriptor, Registry, and Showcase bytes must preserve that Registry sequence
  and metadata Release identity. It may fetch only digest-bound package closure
  artifacts and must not rebuild or publish Marketplace metadata.
- Add a failing fixture or temporary-repository test before changing output.
