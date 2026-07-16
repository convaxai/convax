# Convax Architecture Contract

Status: canonical. This document describes the current architecture and the
decisions that new code must preserve. `AGENTS.md` turns these decisions into an
operational checklist, and `scripts/package-boundary-check.ts` enforces the parts
that can be checked statically.

## 1. Design principles

Convax is built from independently testable domain packages and one application
composition root. A package owns its state, invariants, and public capabilities.
Cross-domain behavior is assembled through injected ports; packages do not discover
each other through globals or mutate each other's persistence.

The recurring rules are:

1. One concept has one owner and one canonical state source.
2. Domain state machines are headless; hosts provide I/O and rendering adapters.
3. UI and Agent entry points execute the same application/business operations.
4. Portable Project state is separate from user/window preferences.
5. Every native path is treated as a trust boundary and works on Windows.

When a feature does not fit an existing owner, make the ownership decision explicit.
Do not default it into Desktop, Project, a `shared` folder, or a new `workspace`
package.

## 2. Terms

### Project

A Project is the durable product aggregate associated with one bound root directory.
It has a stable identity, a per-user binding, private namespaced storage, and a
catalog of capabilities such as Canvases. It is not merely a filesystem folder and
does not own the currently displayed UI.

### Project Files

Project Files is the scoped file capability for visible content below a Project root.
Its contract uses `projectId + project-relative portable path`. It owns file/tree UI
state and operations, not Project identity. The native adapter currently lives in
`@convax/project/node` because that adapter resolves Project bindings and real paths;
it implements the `ProjectFilesClient` contract without moving file semantics back
into `ProjectController`.

### Canvas

A Canvas is an independent document with its own schema, revision, commands,
business operations, queries, view commands, and editor. Project owns the catalog
relationship and persistence adapter, but it does not own Canvas document semantics.

### Workbench

Workbench is window-scoped interaction state: the active Input, Input-scoped
Selection, derived Surface, guarded navigation, and generic top-level layout-part
transactions. It is the only source of the active Canvas/file. It does not persist
Project or Canvas data and has no DOM, React, Electron, or localStorage dependency.

### Workspace

There is no current Workspace aggregate. The term is reserved for a future feature
where one window/session genuinely coordinates multiple Projects. The legacy schema
name `convax.canvas-workspace/1` exists only as a migration input.

## 3. Packages and dependency graph

| Package | Responsibility |
| --- | --- |
| `@convax/ui` | Product-agnostic components, styling primitives, and theme |
| `@convax/project-files` | Renderer-safe scoped file contracts, controller, and drag protocol |
| `@convax/canvas` | Canvas core, application/business layer, view layer, editor and plugins |
| `@convax/project` | Project lifecycle/registry/private storage and Project capability composition |
| `@convax/project/canvas` | Project Canvas catalog, relationships, controller, drag and resource references |
| `@convax/project/node` | Native Project, Project Files, private storage, and Canvas persistence adapters |
| `@convax/workbench` | Headless window Input/Selection/Surface and layout state machines |
| `@convax/agent-runtime` | Host-agnostic OpenCode integration and protected execution boundary |
| `@convax/desktop` | Electron composition root, IPC, adapters, coordinators and product shell |

Allowed internal runtime dependencies:

```text
@convax/ui             -> none
@convax/project-files  -> none
@convax/workbench      -> none
@convax/agent-runtime  -> none
@convax/canvas         -> @convax/ui
@convax/project        -> @convax/canvas, @convax/project-files, @convax/ui
@convax/desktop        -> every package above
```

This is an allowlist, not a description generated from current manifests. Adding an
edge requires an intentional architecture update. All cross-package imports use
published `exports`; private `src/**` imports and relative package escapes are
forbidden.

### Package independence

Every library package is independently publishable and externally consumable.
“Independent” describes its delivery and runtime boundary, not an artificial ban on
dependencies or domain semantics:

- it owns a coherent capability and may contain the business rules for that domain;
- it builds, type-checks, tests, and packs from its own package root;
- its tarball contains compiled `dist` artifacts and resolvable declarations only;
- every runtime/peer dependency is declared, and every Convax dependency follows the
  allowlist above;
- it receives filesystem, persistence, network, clock, host scope, and view services
  through explicit ports where applicable;
- it has no dependency on Desktop composition, monorepo source aliases, hoisted
  undeclared modules, globals, or another package's private data.

External libraries such as React or an editor engine are valid declared dependencies.
Likewise, `@convax/canvas` legitimately contains Canvas business semantics. Moving
those semantics out merely to make the package look generic would weaken ownership.
The current exception to publishability is `@convax/desktop`, which is the private
application composition root.

Adding a package requires an architecture use case, an ownership row and dependency
policy, package-local `AGENTS.md`, local lifecycle scripts, public `dist` exports,
standalone tests, and inclusion in the real-tarball/external-consumer smoke. The
boundary checker fails closed until those admissions are complete.

## 4. Canonical state

| State | Canonical owner | Notes |
| --- | --- | --- |
| Active Project | `ProjectController` | Project lifecycle only |
| Project file tree, expansion, file selection and preview | `ProjectFilesController` | Scoped and reset by Project id |
| Project Canvas catalog | `ProjectCanvasController` | CRUD/relationships only; no active Canvas |
| Active Canvas/file | `WorkbenchController.activeInput/surface` | Sole source for the displayed primary content |
| Canvas node selection | Workbench selection plus mounted Canvas view | Always scoped to the corresponding Input/view |
| Canvas document and revision | Canvas application service/repository | Mutations use commands and conflict checks |
| Top-level sidebar size/visibility/resize transaction | `WorkbenchLayoutController` | Desktop supplies pixels, events, animation and persistence |
| Agent sessions | `@convax/agent-runtime` scoped by the host | Never stored in Project Canvas state |

A recovery preference such as “last Canvas for Project X” is not canonical state.
Desktop may read it to choose an initial Workbench Input, then Workbench becomes the
truth. Do not mirror active state into catalogs, React state, or another controller.

## 5. Persistence map

```text
Electron userData/
  projects.json                         per-user bindings and recency

browser localStorage                    per-user Workbench/renderer preferences

<project root>/
  .convax/
    project.json                        stable Project identity only
    canvases/catalog.json               portable Canvas catalog, no selection
    canvases/<canvas-id>/document.json  Canvas document
    assets/                             managed Canvas resources
```

Private Project metadata is owned by `@convax/project/node`. Renderer, preload,
Agent tools, and general Project Files operations do not read or write its JSON.
Managed assets are the explicit exception: they are imported/copied through the
scoped Project Files capability into `.convax/assets`, while the rest of `.convax`
remains hidden and protected.

Canvas JSON is an implementation detail behind `CanvasDocumentRepository` and Canvas
application services. A schema change needs a version, a migration path, and tests
using real old data. Never “fix” an incompatibility by deleting or silently resetting
portable data.

## 6. Core flows

### Project activation

```text
ProjectController activates Project
  -> Desktop synchronously scopes Workbench to Project
  -> Desktop scopes ProjectFilesController
  -> Desktop scopes ProjectCanvasController
  -> catalog loads
  -> Desktop coordinator restores a valid user Canvas preference or fallback
  -> Workbench opens the chosen Canvas
```

Controllers use request generations/identities so late responses from the previous
Project cannot overwrite current state.

### Canvas mutation from UI or Agent

```text
UI action or typed Agent tool
  -> Canvas business operation (preferred) or explicit primitive
  -> CanvasApplicationService
  -> load document + revision
  -> validate/apply command
  -> CanvasDocumentRepository port
  -> @convax/project/node persistence adapter
  -> optional mounted-view refresh/reveal
```

The domain mutation commits before optional view behavior. Selection, reveal,
fit-view, zoom, animation, and notification are legitimate Agent view capabilities;
they remain explicitly scoped to the mounted view and cannot rewrite domain history.

### Adding a resource to Canvas

Resource insertion is a business operation, not a series reimplemented by each
caller. Host resource preparation, media inspection, card sizing, placement,
relationship creation, revision handling, persistence, and optional view refresh are
composed once. The UI and Agent call that same operation. A primitive remains
available for precise low-level edits, but it is not the default product path.

### Canvas navigation and deletion

`ProjectCanvasWorkbenchCoordinator` is a Desktop coordinator because the flow spans
catalog, document-save guard, Workbench navigation, user preference, and rollback.
Neither Project nor Workbench imports the other to implement this flow.

## 7. Agent tools and skills

- A tool is a typed executable capability backed by an owner package's port.
- A skill is a workflow that chooses and sequences tools. It must not contain a
  second implementation of domain invariants.
- Business tools are preferred so Agent and product UI remain behaviorally equal.
- Primitive and view tools remain available when the request needs exact control.
- Desktop prepares structured resources, binds the active Project scope, and exposes
  the MCP/tool schema. `@convax/agent-runtime` remains unaware of Convax semantics.
- Tool arguments cannot select another Project or expand the host-provided scope.
- Canvas attachments are validated read-only snapshots. Agents mutate through tools,
  never by shell/file edits under `.convax`.

## 8. Workbench layout boundary

Workbench owns the generic state transition: part size, visibility, collapse
threshold, begin/update/end/cancel resize, and restoration of an expanded size.
Desktop owns viewport budgets, concrete pixel values, pointer/keyboard listeners,
responsive overlay rules, CSS transitions, reduced-motion behavior, and localStorage
adapters. Project Sidebar still owns its internal vertical Canvases/Files split.

This distinction applies to future panels: add generic state only when it is reusable
window coordination; keep the product's visual implementation in the host.

## 9. Electron boundary

- Main: native I/O, Electron lifecycle, Project Node adapters, Canvas repositories,
  Agent runtime, and trusted IPC handlers.
- Preload: the narrow typed `window.convax` bridge; no business state.
- Renderer: React shell, controllers, coordinators, view adapters, and preferences;
  no Node/Electron imports.

The public bridge keeps separate namespaces for Project lifecycle, Project Files,
Project Canvas, Canvas documents/views, and Agent runtime. Incompatible bridge changes
must bump the Desktop protocol version so stale main/preload/renderer combinations
fail visibly instead of hanging.

## 10. Portable paths and trust boundaries

Contracts carry only normalized POSIX-style Project-relative paths. Native adapters
join them with the bound root using `node:path`, validate containment, and defend
against symlink replacement. No portable document stores a machine absolute path.

Windows is a first-class target. Validate drive-absolute and UNC paths, backslash
traversal, reserved device names including superscript forms, alternate data streams,
trailing dots/spaces, case-insensitive reserved paths, and cross-device moves. Use
`pathToFileURL` instead of constructing file URLs.

## 11. Adding a capability

Before implementation, answer:

1. Which package uniquely owns the invariant and canonical state?
2. Is this a domain capability, host adapter, window coordinator, or visual primitive?
3. Can callers use an existing public API? If not, what is the smallest typed port?
4. Does UI and Agent need the same business operation?
5. Is state user-specific, Project-portable, or transient?
6. Does the change introduce a forbidden dependency or Node/browser leak?
7. What migration, stale-response, rollback, Windows, and symlink tests are needed?

If the answer changes this contract, update this document, the relevant
`AGENTS.md`, `package-boundary-check.ts`, and tests in the same change.
