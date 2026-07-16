# Convax

Convax is an independent desktop canvas for AI-assisted work. It uses OpenCode through published npm packages rather than maintaining an OpenCode source fork.

The canonical package boundaries, state ownership, persistence map, and extension workflow live in [the architecture contract](docs/architecture.md). Contributor and AI rules are enforced through the root and package-local `AGENTS.md` files plus `bun run package:boundaries`.

## Structure

```text
packages/
  agent-runtime/  Published OpenCode package adapter and desktop Agent runtime
  canvas/         Canvas model, primitives, application commands, view ports, and editor
  desktop/        Electron composition root and renderer
  project-files/  Project-scoped file contracts, controller, drag protocol, and filesystem capability
  project/        Project identity, registry, private storage, Canvas catalog, and capability adapters
  ui/             Shared product-agnostic UI primitives
  workbench/      Window-level Input, Selection, Surface, open, close, and reveal coordination
```

Each library package is independently buildable, testable, publishable, and consumable from a clean external project. Independence does not mean zero dependencies or zero domain semantics: dependencies are explicit, and each package owns only its coherent domain. Packages do not discover or mutate one another through hidden globals; the application injects ports and combines optional capabilities at its composition root. Desktop is the private composition application rather than a published library.

The published libraries export compiled ESM, declarations, and (for UI packages) precompiled CSS from `dist`. Internal dependencies use compatible semver ranges in packed manifests. `bun run package:boundaries` enforces the architecture dependency allowlist, public package exports, browser/Node entry boundaries, the OpenCode isolation boundary, and cycle freedom. `bun run pack:check` then discovers every publishable library, clean-builds them in dependency order, inspects real tarballs for unresolved workspace protocols or leaked source, and type-checks every public TypeScript entry from an external consumer without monorepo path aliases.

The `package-boundaries` GitHub check runs on every push and pull request without needing dependency installation. Protect release branches by requiring that status check so architecture drift cannot be merged by skipping local validation.

`@convax/project-files` owns renderer-safe file contracts, the file controller, and drag protocol. `@convax/project` owns durable Project identity, bindings, private storage, and project-level capability composition while keeping compatibility exports for the existing explorer. Native filesystem and Project Canvas persistence code is isolated behind `@convax/project/node` and is only imported by the Electron main process. Renderer file operations always use a project id plus a portable project-relative path through the preload bridge.

Canvas document semantics do not live in Project. `@convax/canvas/application` owns schema validation, JSON serialization, business commands, queries, logical revisions, and the `CanvasDocumentRepository` port. `@convax/project/canvas` owns the Project's Canvas catalog, controller, drag contracts, and Project-resource references; `@convax/project/node` implements the corresponding persistence adapters on top of opaque, namespaced Project private storage. Desktop exposes lifecycle operations as `window.convax.projects`, file operations as `window.convax.projectFiles`, and the Project Canvas catalog as `window.convax.projects.canvases`. Their IPC namespaces are likewise separate: `project:*`, `project-files:*`, `project:canvas-*`, and `canvas:*`.

`@convax/workbench` is deliberately smaller than the Project aggregate. It owns the active serializable Input, an Input-scoped Selection, the derived primary Surface, guarded open/close/reveal commands, and DOM-free top-level layout-part transactions. Desktop supplies concrete sizes, pointer/keyboard events, animation, responsiveness, and preference persistence. Workbench is the sole source of truth for the currently displayed Canvas or file; the Project Canvas controller owns only catalog CRUD. Project files, Canvas documents, Agent runtime state, and durable relationships remain in their domain packages.

Canvas operations are layered deliberately:

- `@convax/canvas/core` contains headless document primitives.
- `@convax/canvas/application` exposes stable business commands such as resource insertion plus Agent-safe queries.
- `@convax/canvas/view` exposes explicitly scoped selection, reveal, viewport, animation, and notification commands.
- UI and Agent tools call the same application commands; Agent skills only compose those tools into higher-level workflows.

## Canvas nodes and plugins

The public Canvas model has exactly two node roles:

- `file` is renderable content. Text, media, and folder are built-in file renderers; folder is render-only and is created from a real host-directory reference rather than as an unbound placeholder. Structural groups are an internal `file` rendering kind, not a third public node role.
- `agent` embeds the same host Agent UI used by the application. Every connected file is supplied as an `@` structured resource, regardless of edge direction. Selecting one file opens the same Agent UI below it with that file locked as its `@` context.

Applications can create one `CanvasFileRendererRegistry`, register disposable plugins, and pass it to `CanvasEditor`. A renderer contribution owns its component and may add a toolbar and an insertion factory. Matcher failures and renderer exceptions are isolated, plugin registration is atomic, and disposing a plugin removes all of its contributions. Canvas only exposes an `assistant` render port; Desktop composes `@convax/agent-runtime` into that port, so Canvas never imports the Agent implementation.

The desktop composition root exposes Canvas capabilities to OpenCode through a loopback-only, authenticated MCP bridge. The default Agent surface favors `canvas_add_resources`, which prepares assets, determines card sizing and placement, applies relations, persists with revision checks, and refreshes the mounted editor as one business operation. `canvas_apply_primitive` remains available for precise low-level mutations, while `canvas_view` deliberately includes selection, reveal, fit, zoom, animation, and notification behavior. Every call is scoped to the active project by the host; a tool argument cannot switch that project scope.

Main, preload, and renderer also share a versioned desktop IPC handshake. A development hot reload that leaves one component on an older protocol fails before mounting the application and shows a restart-required screen instead of leaving Project, Canvas, or Agent requests hanging. Agent shutdown force-closes in-flight local MCP connections so a main-process restart cannot be blocked by an old tool request.

Canvas JSON remains private implementation data. Agent Canvas attachments are pathless, read-only snapshots, and mutations go through the same application services used by product behavior rather than editing `.convax` files directly.

## Project storage

Project state is split by ownership instead of being collected under the user's home directory:

```text
Electron userData/
  projects.json                         Per-user project bindings and recency

<project root>/
  .convax/
    project.json                        Stable project identity only
    canvases/catalog.json               Project-owned Canvas catalog (no user selection state)
    canvases/<canvas-id>/document.json  Portable canvas documents
    assets/                             Files managed for canvas references
```

The project directory is the portable source of truth. `app.getPath("userData")` only stores machine/user-specific project registry state, while Workbench input and panel preferences use browser storage backed by the same Electron profile. The active Canvas is therefore user-specific and is not written into the shared Project catalog. Convax does not write project metadata to `$HOME` directly. Project Canvas persistence migrates a legacy catalog from `.convax/project.json` and a legacy `.convax/canvas.json` document into the dedicated Canvas storage without changing user files.

OpenCode integration belongs in `@convax/agent-runtime`, which may depend on `opencode-ai` and `@opencode-ai/sdk`. The runtime itself is host-agnostic: callers supply `scopeId`, structured resources, prompt instructions, protected paths, and a tool-server name. Lexical permission patterns are only a first guard; an optional symlink-aware execution guard protects concrete host-owned paths and fails closed when its OpenCode plugin is not loaded. Because a general shell cannot be safely constrained to a path, that strong mode deliberately disables shell and LSP tools. Desktop enables it for `.convax` and owns all Convax/Canvas-specific instructions and policy. Canvas, Project, Project Files, and Workbench do not depend on OpenCode internals; Canvas Agent tools remain thin adapters over Canvas application and view capabilities.

## Development

```bash
bun install
bun dev
bun check
```

`bun check` ends with a production-built Electron Open Project smoke test. It launches an isolated profile, exercises the real preload-to-main bridge, opens an empty project, and verifies Project Canvas catalog and Canvas document initialization on disk.

Run package checks from the package directory:

```bash
cd packages/desktop
bun typecheck
bun run build
```
