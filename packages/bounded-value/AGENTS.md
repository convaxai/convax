# Bounded Value Package Contract

This file extends the repository-level `AGENTS.md` for `packages/bounded-value`.

## Owns

- The closed `convax.plugin-state-schema/1` portable bounded-value dialect.
- Canonical declarative schema bytes and domain-separated digest input bytes.
- Pure bounded payload validation shared by Plugin authoring and Canvas admission.

## Must not own

- Plugin manifests, identity, installation, ActiveSet selection, Canvas state,
  collaboration sessions, persistence, I/O, authorization, or executable validators.
- Node, Electron, React, browser storage, network, or another `@convax/*` package.

The package is independently publishable, browser-safe, deterministic, and has no
runtime dependencies. Run `bun typecheck && bun test && bun run pack:check`.
