# Convax Development Guide

- Use Bun for dependency management and scripts.
- Keep the repository as a Turbo monorepo with packages under `packages/*`.
- Convax is an independent product. Do not copy or modify OpenCode source code here.
- Integrate OpenCode through its published `opencode-ai` and `@opencode-ai/sdk` packages behind a dedicated package boundary.
- Run type checks from the affected package with `bun typecheck`.
- Keep each commit below 1,000 changed lines, counting additions and deletions.
- Use conventional commit messages such as `feat(desktop): add electron shell`.

