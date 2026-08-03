# Convax Docs Contract

`@convax/docs` owns the independently deployed public documentation site and its
agent-readable documentation outputs.

- Treat [`docs/architecture.md`](../../docs/architecture.md) and the owning package
  contracts as canonical. This app may present or link them but must not invent a
  second architecture, Plugin API, SDK, or product-runtime contract.
- Keep the app browser/deployment independent from Desktop and private package
  source. Do not import product runtime state or Electron behavior.
- Preserve the existing Astro/Nimbus information architecture, accessible semantic
  markup, keyboard behavior, and responsive presentation.
- Keep Cloudflare configuration local to this delivery surface and never place
  credentials in source.
- Run `bun typecheck`, `bun test`, and `bun build` after changes.
