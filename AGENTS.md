# Convax Development Contract

This file is the operational contract for human and AI contributors. Read
[`docs/architecture.md`](docs/architecture.md) before changing package boundaries,
state ownership, persistence, IPC, or Agent capabilities. More specific `AGENTS.md`
files under `packages/` add local rules and inherit this contract.

## Required workflow

1. Name the owning package before writing code. If ownership is unclear, stop and
   resolve the boundary instead of placing the code in Desktop or the nearest file.
2. Reuse an existing public capability or add a port to the owning package. Do not
   reach through another package's private files, copy its logic, or introduce a
   hidden global/service locator.
3. Keep domain logic headless. Electron, React, filesystem, browser storage, and
   network adapters belong at explicit edges.
4. Add tests at the ownership boundary, including failure, cancellation, stale
   async response, migration, and platform cases relevant to the change.
5. Run the affected package's `bun typecheck` and `bun test`. Run `bun check` for
   package-boundary, public API, persistence, IPC, or Desktop composition changes.

## Package ownership

| Package | Owns | Must not own |
| --- | --- | --- |
| `@convax/project-files` | Project-scoped file contracts, tree/controller state, file CRUD/import/open/reveal, drag payloads | Project registry, Canvas catalog/documents, Workbench state, Electron APIs |
| `@convax/project` | Durable Project identity, registry/bindings, private storage, capability composition; `@convax/project/canvas` owns the Project Canvas catalog and relationships | Active Canvas selection, Canvas document semantics, Agent sessions |
| `@convax/canvas` | Canvas schema/core, primitives, application commands and queries, business operations, view commands, editor/plugin contracts | Project paths/registry, Workbench selection, OpenCode implementation, native persistence |
| `@convax/workbench` | Window-scoped serializable Input, Selection, Surface and layout-part state; guarded open/close/reveal/resize transitions | Domain data, catalogs, filesystem, React/DOM, Electron, localStorage |
| `@convax/media-generation` | Provider-neutral AI image/video generation contracts, model discovery, requests, responses, streams and async jobs | Provider implementations, credentials, routing registries, Canvas/Project state, Electron, OpenCode |
| `@convax/agent-runtime` | Generic OpenCode adapter, sessions, resources, tool-provider bridge, protected-path enforcement | Convax Project/Canvas/UI policy or imports from other Convax packages |
| `@convax/ui` | Product-agnostic visual primitives and theme | Project, Canvas, Workbench, Agent, persistence, or Electron behavior |
| `@convax/desktop` | Electron composition root, native adapters, IPC/preload, renderer shell, user preferences, concrete cross-package wiring | New reusable domain semantics that belong in a published package |

`Workspace` is intentionally not a current aggregate. Reserve that name for a
future window/session that coordinates multiple Projects. Do not recreate a
`workspace` package merely to hold Project–Canvas relationships.

## Dependency direction

The allowed internal runtime dependency graph is enforced by
`bun run package:boundaries`:

```text
desktop ──> agent-runtime, canvas, media-generation, project, project-files, ui, workbench
project ──> canvas, project-files, ui
canvas  ──> ui
agent-runtime, media-generation, project-files, ui, workbench ──> no Convax package
```

- Import another package only through an exported package subpath.
- Never use a relative path that escapes a package.
- Only `@convax/agent-runtime` may import `opencode-ai` or `@opencode-ai/*`.
- Node-only exports such as `@convax/project/node` and
  `@convax/agent-runtime/node` are Desktop-main adapters, never renderer imports.
- Treat a change to this graph as an architecture decision. Update the canonical
  document, local package instructions, automated policy, and tests together.

## Package independence and admission

Independent means a library can be built, type-checked, tested, packed, and consumed
from a clean external project using only its declared public API and dependencies. It
does not mean “has no dependencies” or “contains no domain concepts.” A Canvas
package may own Canvas business semantics and depend on lower-level declared
libraries; it must not assume Convax Desktop, a particular Project, hidden monorepo
source, or ambient application state.

- `@convax/desktop` is the only current private application package. New library
  packages are independently publishable by default.
- A new package needs one coherent owner/invariant, not merely a convenient folder,
  shared helper bucket, or workaround for a dependency rule.
- It must have package-local `build`, `clean`, `typecheck`, `test`, `prepack`, and
  `prepublishOnly` scripts; compiled `dist` exports; a real version; and a local
  `AGENTS.md` contract.
- Runtime and peer dependencies must be explicit and minimal. External libraries are
  allowed; undeclared imports, root-only aliases, source imports from sibling
  packages, and reliance on hoisting are not.
- Host services enter through typed ports. Tests use in-memory/fake adapters and do
  not require Desktop, a real user directory, global registration, or another
  package's private state.
- Register the owner and dependency edges in this file, `docs/architecture.md`, and
  `package-boundary-check.ts`. `pack:check` must build the package standalone, pack a
  real tarball, and type-check every public TypeScript entry from an external
  consumer.

## State and persistence ownership

- Electron `userData/projects.json`: per-user Project bindings and recency only.
- `<project>/.convax/project.json`: portable stable Project identity only.
- `<project>/.convax/canvases/catalog.json`: Project-owned Canvas catalog; never
  active/selected Canvas state.
- `<project>/.convax/canvases/<id>/document.json`: Canvas document data accessed
  through Canvas repository/application ports implemented by `@convax/project/node`.
- `<project>/.convax/assets/`: managed Canvas assets accessed through the scoped
  Project Files capability.
- Electron `userData/opencode/skills/user/<name>/`: Convax-managed OpenCode Skills.
- Electron `userData/plugins/<id>/`: validated user-global static Plugin packages.
- Browser storage: per-user Workbench input/layout and renderer preferences only.
- In-memory controller state: loading, errors, selection, preview, and transition
  state. Do not silently turn it into durable shared state.

No package except `@convax/project/node` may read or write private Project metadata
JSON directly. Desktop and Agent code must call typed clients/services. Never teach
an Agent to edit `.convax` JSON; protect it and expose capabilities instead. Legacy
formats are read only in explicit, tested migration code and are written back in the
current schema.

## Project, Canvas, and Workbench rules

- `ProjectController` handles Project lifecycle only. File operations go through
  `ProjectFilesController`; Canvas catalog CRUD goes through
  `ProjectCanvasController`.
- `ProjectCanvasController` owns catalog CRUD, not `activeCanvasId`.
  `WorkbenchController` is the sole source of the active Input/Canvas.
- Switching Project must synchronously reset the Workbench scope and scope both
  Project Files and Project Canvas controllers. Ignore stale async responses from
  the prior Project.
- Canvas document mutation never means “write JSON.” UI and Agent callers use the
  same Canvas application services and revision/conflict handling.
- Prefer Canvas business operations for product behavior. Primitive operations are
  explicit low-level escape hatches. View operations such as select, reveal,
  fit-view, animation, and notification are valid Agent capabilities when requested.
- A business operation commits domain state first. Optional view effects must not
  turn a successful mutation into a failed mutation.

## Agent capability rules

- Tools are typed, narrow executable capabilities. Skills compose tools into a
  workflow; they do not bypass package APIs or become a second implementation.
- Agent tool adapters stay thin and live at the composition edge. Product rules,
  validation, sizing, placement, relationships, persistence, and conflict handling
  live in the same business services used by UI actions.
- Every Agent call is scoped by the host's active Project/Canvas. Tool arguments
  cannot switch or widen that scope.
- Structured resources are validated and prepared by the host. Canvas snapshots are
  pathless/read-only; mutations use Canvas tools.
- OpenCode Skills remain native instruction bundles. Project-local ambient Skills
  and executable OpenCode extensions are not discovered merely by opening a folder.
- Installing a Plugin companion Skill is explicit and uses the same managed Skill
  lifecycle; it grants no implicit Plugin or host capability.

## Plugin capability rules

- Reuse the existing Canvas file-renderer and node-toolbar registries. A Plugin
  surface is a `file` node; do not add an extension bus, service locator, or node
  role to route Plugin behavior.
- Third-party Plugin code is static Web content in an iframe with exactly
  `sandbox="allow-scripts"`. Never import it into the host, use Electron `webview`,
  enable same-origin/Node/Electron access, or expose a generic function-call bridge.
- Bind every MessageChannel to the installed Plugin plus current Project, Canvas and
  owning node. Check manifest permissions, message size, stale scope and target on
  every call. Plugin node state writes stay inside a namespaced field.
- Connected Plugin inputs must be derived from direct incoming Canvas edges. Never
  accept a caller-supplied Project path or widen that access to unrelated nodes;
  use the bounded Main-owned managed-asset reader and recheck the exact edge and
  source reference afterward.
- Gate browser feature-policy exceptions such as fullscreen through an explicit
  manifest capability. Preserve every unrelated iframe permission denial.
- Direct Plugin calls are thin adapters over existing typed Project, Canvas and
  Agent capabilities. They do not read private JSON or recreate domain invariants.

## Desktop and IPC rules

- Main owns native filesystem, Electron, Project Node adapters, and Agent runtime.
- Preload exposes a narrow typed bridge. Renderer code must not import Node/Electron.
- Keep bridge namespaces separate: `projects`, `projectFiles`, `projects.canvases`,
  `canvas`, `agent`, and `plugins`; keep IPC prefixes `project:*`, `project-files:*`,
  `project:canvas-*`, `canvas:*`, `agent:*`, and `plugin:*`.
- Bump the Desktop protocol version and update its compatibility tests when the
  preload/main contract changes incompatibly.
- Desktop may coordinate packages, but reusable state machines and business rules
  must be pushed down to their owner and injected back through ports.

## Cross-platform and security rules

- All logical Project paths crossing contracts use normalized POSIX separators and
  are relative to a Project. Native adapters convert with `node:path`.
- Never concatenate file URLs or hard-code `/home`, `/tmp`, drive letters, or `/` as
  a host separator. Use Electron/OS directories and `pathToFileURL` where needed.
- Validate Windows drive/UNC paths, backslash traversal, reserved device names,
  alternate data streams, trailing dots/spaces, and case-insensitive `.convax`.
- Resolve and verify real paths at native trust boundaries; tests must cover symlink
  replacement for protected/private writes.
- Do not weaken protected-path or scope checks to make an Agent workflow convenient.

## Repository mechanics

- Use Bun for dependencies and scripts; keep the Turbo monorepo under `packages/*`.
- Convax is independent. Do not copy or modify OpenCode source; integrate only via
  its published packages behind `@convax/agent-runtime`.
- Preserve user changes and generated/local Project data. Never commit root
  `.convax/` runtime state.
- Keep the `package-boundaries` push/PR check enabled and required on protected
  branches. Do not weaken the policy to make a feature branch pass.
- Keep commits coherent and reviewable. Split changes when it improves clarity,
  not to satisfy an arbitrary line-count limit.
- Use conventional commit messages such as `feat(workbench): add part layout guard`.
