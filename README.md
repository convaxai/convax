# Convax

Convax is an independent desktop canvas for AI-assisted work. It uses OpenCode through published npm packages rather than maintaining an OpenCode source fork.

## Structure

```text
packages/
  canvas/     Canvas document model, commands, services, and editor
  desktop/    Electron shell and renderer
  project/    Project registry, file-system boundary, controller, and explorer
  ui/         Shared product-agnostic UI primitives
```

`@convax/project` keeps renderer-safe contracts and React UI on its default export. Native filesystem code is isolated behind `@convax/project/node` and is only imported by the Electron main process. Renderer file operations always use a project id plus a project-relative path through the preload bridge.

## Project storage

Project state is split by ownership instead of being collected under the user's home directory:

```text
Electron userData/
  projects.json                         Per-user bindings, recency, and active-canvas preferences

<project root>/
  .convax/
    project.json                        Stable project identity and canvas catalog
    canvases/<canvas-id>/document.json  Portable canvas documents
    assets/                             Files managed for canvas references
```

The project directory is the portable source of truth. `app.getPath("userData")` only stores machine/user-specific state, while renderer-only panel preferences use browser storage backed by the same Electron profile. Convax does not write project metadata to `$HOME` directly. A legacy `.convax/canvas.json` is migrated into the default canvas when a project is first initialized by the new project manager.

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
