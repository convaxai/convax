# Convax

Convax is an independent desktop canvas for AI-assisted work. It uses OpenCode through published npm packages rather than maintaining an OpenCode source fork.

## Structure

```text
packages/
  desktop/    Electron shell and renderer
```

Future OpenCode integration belongs in a dedicated adapter package under `packages/`. That package may depend on `opencode-ai` and `@opencode-ai/sdk`; application and canvas packages should depend on the adapter instead of OpenCode internals.

## Development

```bash
bun install
bun dev
```

Run package checks from the package directory:

```bash
cd packages/desktop
bun typecheck
bun run build
```

