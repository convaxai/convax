# Convax

Convax is an independent desktop canvas for AI-assisted work. It uses OpenCode through published npm packages rather than maintaining an OpenCode source fork.

## Structure

```text
packages/
  agent-runtime/  Published OpenCode package adapter and desktop Agent runtime
  canvas/         Canvas model, primitives, application commands, view ports, and editor
  desktop/        Electron composition root and renderer
  project/        Project registry, private storage, controller, and explorer
  ui/             Shared product-agnostic UI primitives
  workspace/      Project + Canvas persistence and resource adapters
```

`@convax/project` keeps renderer-safe contracts and React UI on its default export. Native filesystem code is isolated behind `@convax/project/node` and is only imported by the Electron main process. Renderer file operations always use a project id plus a project-relative path through the preload bridge.

Canvas document semantics do not live in Project. `@convax/canvas/application` owns schema validation, JSON serialization, business commands, queries, logical revisions, and the `CanvasDocumentRepository` port. `@convax/workspace/node` implements that port on top of Project's opaque, namespaced private storage. The renderer uses a separate `canvas:*` IPC boundary instead of reading or writing Canvas JSON through `ProjectClient`.

Canvas operations are layered deliberately:

- `@convax/canvas/core` contains headless document primitives.
- `@convax/canvas/application` exposes stable business commands such as resource insertion plus Agent-safe queries.
- `@convax/canvas/view` exposes explicitly scoped selection, reveal, viewport, animation, and notification commands.
- UI and Agent tools call the same application commands; Agent skills only compose those tools into higher-level workflows.

The desktop composition root exposes Canvas capabilities to OpenCode through a loopback-only, authenticated MCP bridge. The default Agent surface favors `canvas_add_resources`, which prepares assets, determines card sizing and placement, applies relations, persists with revision checks, and refreshes the mounted editor as one business operation. `canvas_apply_primitive` remains available for precise low-level mutations, while `canvas_view` deliberately includes selection, reveal, fit, zoom, animation, and notification behavior. Every call is scoped to the active project by the host; a tool argument cannot switch that project scope.

Canvas JSON remains private implementation data. Agent Canvas attachments are pathless, read-only snapshots, and mutations go through the same application services used by product behavior rather than editing `.convax` files directly.

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

OpenCode integration belongs in `@convax/agent-runtime`, which may depend on `opencode-ai` and `@opencode-ai/sdk`. Canvas, Project, and Workspace do not depend on OpenCode internals; Canvas Agent tools must remain thin adapters over Canvas application and view capabilities.

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
