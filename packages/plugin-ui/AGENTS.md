# Plugin UI Package Contract

This file extends the repository-level `AGENTS.md` for `packages/plugin-ui`.

## Owns

- Browser-safe semantic design tokens and minimal interaction foundations for
  sandboxed Convax Plugin documents.
- A self-contained system light/dark stylesheet with no runtime dependency.

## Must not own

- React components, Desktop appearance preferences, product workflows, Plugin
  identity, Host transport, or concrete Plugin composition.
- Imports from another `@convax/*` package or remote assets.

## Validation

- Run `bun --cwd packages/plugin-ui build` and `bun --cwd packages/plugin-ui test`.
- Run `bun run package:boundaries` from the repository root.
