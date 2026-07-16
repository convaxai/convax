# UI Package Contract

This file extends the repository-level `AGENTS.md` for `packages/ui`.

## Owns

- Product-agnostic React primitives, styling helpers, design tokens, and shared theme CSS.
- Accessibility and interaction behavior that belongs to a reusable UI primitive.

## Must not own

- Project, Project Files, Canvas, Workbench, Agent, Electron, or persistence state.
- Imports from another `@convax/*` package.
- Product workflows disguised as generic components.

If a component needs domain types or a domain controller, keep it in the owning domain package or compose it in Desktop.

## Validation

- Run `bun --cwd packages/ui typecheck`.
- Run focused tests for changed components, then `bun run package:boundaries` from the repository root.
