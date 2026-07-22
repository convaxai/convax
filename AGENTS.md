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

| Package                 | Owns                                                                                                                                                             | Must not own                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@convax/project-files` | Project-scoped file contracts, tree/controller state, file CRUD/import/open/reveal, drag payloads                                                                | Project registry, Canvas catalog/documents, Workbench state, Electron APIs               |
| `@convax/project`       | Durable Project identity, registry/bindings, private storage, capability composition; `@convax/project/canvas` owns the Project Canvas catalog and relationships | Active Canvas selection, Canvas document semantics, Agent sessions                       |
| `@convax/canvas`        | Canvas schema/core, primitives, application commands and queries, business operations, view commands, editor/plugin contracts                                    | Project paths/registry, Workbench selection, OpenCode implementation, native persistence |
| `@convax/workbench`     | Window-scoped serializable Input, Selection, Surface and layout-part state; guarded open/close/reveal/resize transitions                                         | Domain data, catalogs, filesystem, React/DOM, Electron, localStorage                     |
| `@convax/agent-runtime` | Generic OpenCode adapter, sessions, resources, tool-provider bridge, protected-path enforcement                                                                  | Convax Project/Canvas/UI policy or imports from other Convax packages                    |
| `@convax/ui`            | Product-agnostic visual primitives and theme                                                                                                                     | Project, Canvas, Workbench, Agent, persistence, or Electron behavior                     |
| `@convax/desktop`       | Electron composition root, native adapters, IPC/preload, renderer shell, user preferences, concrete cross-package wiring                                         | New reusable domain semantics that belong in a published package                         |

`Workspace` is intentionally not a current aggregate. Reserve that name for a
future window/session that coordinates multiple Projects. Do not recreate a
`workspace` package merely to hold Project–Canvas relationships.

## Dependency direction

The allowed internal runtime dependency graph is enforced by
`bun run package:boundaries`:

```text
desktop ──> agent-runtime, canvas, project, project-files, ui, workbench
project ──> canvas, project-files, ui
canvas  ──> ui
agent-runtime, project-files, ui, workbench ──> no Convax package
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
- Electron `userData/opencode/skills/user/<name>/`: materialized Convax-managed
  OpenCode Skills, including independently managed standalone Skills and Plugin-owned
  Skills. Ownership is never inferred from this shared discovery path.
- Electron `userData/plugin-skill-bindings/index-v1.json`: Desktop-owned authoritative
  bindings from each materialized Plugin-owned Skill to its exact Plugin id, name,
  version, source path, and source digest, plus at most one crash-recovery transition
  containing digest-bound managed-Skill receipts and an optional durable forward
  decision.
- Electron `userData/plugins/<id>/`: validated user-global static Plugin packages.
- Electron `userData/plugin-companions/<plugin-id>/<plugin-version>/`: Registry-verified,
  host-owned native or `convax-bun` script companions; never Plugin package assets or renderer paths.
- Electron `userData/capability-registry/artifact-v1/<sha256>`: bounded, verified,
  non-authoritative cache of immutable Plugin ZIP, Skill ZIP, and companion bytes.
- Electron `userData/plugin-authorizations/<plugin-id>/`: install-time Tool Plugin
  execution receipts bound to the normalized manifest and exact executable source/bytes.
- Electron `userData/plugin-service-authorization-checkpoints/<plugin-id>.json`:
  private, bounded and short-lived crash-recovery handoff for exact-origin allowlisted Cookies,
  bound to the unchanged Plugin and verified executable identity; never a browser profile.
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
- Whole-Canvas tidy is a size-aware directed-graph business operation. Primitive
  grid/horizontal/vertical layout requires explicit node ids and must never be used
  as an implicit whole-Canvas fallback. External layout providers return a
  revision-bound geometry plan that Canvas validates and commits atomically.
- A multi-command Canvas transaction validates against one document revision and
  persists with one CAS write. Callers must not emulate atomicity with a sequence of
  independent saves. Transport transactions must be non-empty, request-bounded, and
  must not retain unbounded full-document idempotency results.
- A business operation commits domain state first. Optional view effects must not
  turn a successful mutation into a failed mutation.

## Agent capability rules

- Tools are typed, narrow executable capabilities. Skills compose tools into a
  workflow; they do not bypass package APIs or become a second implementation.
- Agent tool adapters stay thin and live at the composition edge. Product rules,
  validation, sizing, placement, relationships, persistence, and conflict handling
  live in the same business services used by UI actions.
- Every Agent call is scoped by the host's current Project. Document tools may name
  any Canvas in that Project's live catalog; they cannot select another Project.
  View tools remain bound to the mounted active Canvas. External document access
  must pass through the renderer flush/lock/reload barrier.
- Structured resources are validated and prepared by the host. Canvas snapshots are
  pathless/read-only; mutations use Canvas tools.
- OpenCode Skills remain native instruction bundles. Project-local ambient Skills
  and executable OpenCode extensions are not discovered merely by opening a folder.
- Standalone Skills have their own package identity and install/update/removal
  lifecycle. The optional top-level `skill` in `convax.plugin/1` through `/3` is a
  legacy independently managed companion and keeps that behavior while that schema
  remains installed. An explicit v1-v3 update to a v4-or-later owned schema may
  transfer ownership only when the current managed Skill tree exactly matches the
  old installed Plugin's embedded companion; modified or unrelated same-name Skills
  fail closed.
- `convax.plugin/4` and later may declare owned Skill directories through
  `contributes.skills`. Desktop validates and publishes those Skills atomically with
  their owner Plugin; they cannot be installed, updated, or removed independently.
  A persisted owner binding continues to reserve the Skill name if its materialized
  directory is missing. A pending Plugin transition conservatively reserves both its
  previous and next Skill names and blocks standalone mutation or discovery refresh
  until recovery settles it. Neither kind of Skill grants implicit Plugin or host capability.
- `@convax/agent-runtime` validates, materializes, discovers, and refreshes generic
  Skill directories only. Plugin ownership, receipts, UI policy, and transaction
  composition remain Desktop concerns.

## Plugin capability rules

- Plugin identity is routing and namespacing data only. Model discovery, Agent
  exposure, Canvas actions, execution, and UI behavior must derive from validated
  manifest contributions and must never branch on a concrete Plugin id. Default
  installation catalogs may name packages, but those ids cannot change runtime
  semantics.
- Serialize every install, update, built-in claim, and uninstall for the same Plugin
  id. Startup package recovery must resolve validated staging, replacement, and
  uninstall remnants before authorization or owned-Skill recovery consumes package
  state; ambiguity fails closed. If any Plugin-package rollback rename fails, do not
  guess by rolling back dependent Skills, authorization receipts, or companions.
  Release process-local locks while retaining their exact journals, require startup
  recovery, and let the selected canonical package drive every dependent outcome.
- Concrete generation or LLM vendors, models, credentials, and routing are never
  built into Convax packages. An installed Tool Plugin plus its explicitly
  authorized external executable is the complete vendor integration boundary; do
  not add vendor classes or a parallel provider registry. A v5 LLM contribution is
  generic display metadata. Desktop may translate its verified sidecar's Main-only,
  ephemeral loopback gateway into host-injected OpenCode configuration, while the
  Agent runtime remains unaware of Plugin identity and vendor credentials.
- An official Registry Tool Plugin may declare a target-specific executable
  companion whose command exactly matches its manifest runtime. Desktop verifies
  the fixed Release URL, platform/architecture, size and SHA-256, publishes it to a
  private versioned host directory, and resolves it before an explicit `PATH`
  fallback. A companion beginning with the exact `#!/usr/bin/env convax-bun` header
  is a bundled Bun program run by Desktop's shared app-owned Bun runtime; all other
  companions retain native execution. Missing targets, runtimes, and
  immutable-identity byte changes fail closed.
- Agent, Toolbar/UI, and Plugin callers use the same Desktop-main generation tool
  executor. OpenCode is only the Agent-side tool client, not the execution owner or
  a dependency of direct product actions.
- Do not expire an accepted generation job merely because it remains queued or
  running. Generation sidecars own vendor polling, bound individual network
  requests, and keep non-terminal work alive until success, explicit terminal
  failure, or caller cancellation. Host/Agent transports must not turn a healthy
  pending state into an absolute tool-call timeout.
- A Tool Plugin may expose a user-global service surface through the same verified
  sidecar lifecycle. Service status and mutations use fixed host tool names and a
  strict display-only contract; renderer code never selects an MCP method or receives
  credentials, cookies, authorization URLs, native paths, or raw diagnostics.
- Browser-cookie authorization for a Tool Plugin is a fixed main-only exchange,
  never a generic MCP bridge. Use a fresh non-persistent sandboxed Electron session,
  require explicit confirmation, export only allowlisted cookie names for one exact
  HTTPS origin, and call only `service.authorization.complete` on the unchanged
  requesting runtime. Cancellation, timeout, sign-out, close and Plugin change clear
  the temporary session and fail closed; no request URL or cookie crosses preload.
- Treat an explicit Tool Plugin install/update as consent for only the normalized
  manifest and executable binding verified during that publication. Persist the
  binding kind, real path, size and SHA-256; runtime silently rechecks it and asks
  for reinstall on missing or changed state, never for first-call approval.
- Fingerprint an external Tool Plugin executable before staging aggregate-bounded
  inputs. Recheck live reference/revision guards immediately
  before a billable call. Launch the install-authorized entrypoint through a verified
  host-owned snapshot, terminate the whole process tree on disposal, and fail
  closed on platforms where the host lacks a process-tree ownership primitive.
- Generated media enters Canvas only through `CanvasResourceBusinessService` and
  the managed `.convax/assets/` flow before existing `file` nodes reference it;
  failed commits must roll back newly admitted assets.
- Reuse the existing Canvas file-renderer and node-toolbar registries. A Plugin
  surface is a `file` node; do not add an extension bus, service locator, or node
  role to route Plugin behavior.
- Project-wide Canvas authority is a main-owned, principal-bound broker capability,
  never a property of a Web node. `convax.plugin/5` declares separate Project,
  catalog, document-read, document-write, and event grants. Calls carry an explicit
  portable `{ projectId, canvasId }`, revalidate the installed manifest identity and
  catalog scope, and use the same Canvas application services as UI and Agent.
- Plugin document reads expose bounded geometry or portable structure projections;
  neither projection exposes native paths or resource bytes. Document transactions
  are revision-bound, command-bounded, atomic, and cannot admit/replace resources or
  forge resource references. Resource bytes and admission remain separate Project
  business capabilities.
- Third-party Plugin code is static Web content in an iframe with exactly
  `sandbox="allow-scripts"`. Never import it into the host, use Electron `webview`,
  enable same-origin/Node/Electron access, or expose a generic function-call bridge.
- Bind every MessageChannel to the exact installed Plugin and owning Web frame.
  Legacy node methods additionally bind current Project, Canvas and node; Plugin
  node state writes stay inside that node's namespaced field. V5 Project/Canvas
  methods route through an opaque sender-scoped main connection and derive authority
  only from the installed principal and its declared grants, not from node ownership.
- Bound in-flight Plugin RPC before asynchronous connection/subscription work. Tool
  and Agent cancellation must cross queue and preparation boundaries and be checked
  immediately before any Canvas persistence call.
  Check permissions, message size, stale scope and target on every call.
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
- Native file drag-out uses a short-lived sender-scoped opaque ticket: Main validates
  the live managed Canvas media selection, stages host-owned copies, and synchronously
  starts Electron's drag. Renderer/preload never receive native paths, and targets
  such as Finder or JianYing must not introduce UI automation branches.
- Keep bridge namespaces separate: `projects`, `projectFiles`, `projects.canvases`,
  `canvas`, `generation`, `agent`, `plugins`, `pluginCapabilities`, and
  `pluginServices`; keep IPC prefixes
  `project:*`, `project-files:*`, `project:canvas-*`, `canvas:*`, `generation:*`,
  `agent:*`, `plugin:*`, and `plugin-service:*`.
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
