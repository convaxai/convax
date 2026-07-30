# Convax Development Contract

This is the repository-wide operational contract for human and AI contributors.
Keep it focused on routing, ownership, and rules that apply to every change.
[`docs/architecture.md`](docs/architecture.md) is the canonical architecture
contract; area and process-level `AGENTS.md` files add change-time instructions for
their own scope.

## Repository shape

- `packages/desktop`: private Electron application and composition root.
- `packages/agent-runtime`: host-agnostic OpenCode integration.
- `packages/canvas`, `packages/project`, `packages/project-files`, and
  `packages/workbench`: product domain and coordination packages.
- `packages/plugin-api`: published Host API catalog and generated contract source.
- `packages/plugin-sdk`: published Plugin package, contribution, and inter-Plugin
  contract source.
- `packages/marketplace`, `packages/marketplace-kit`, and
  `packages/create-convax-marketplace`: Marketplace protocol and authoring tools.
- `packages/ui`: product-agnostic visual primitives and theme.
- `apps/web`: public marketing application.
- `apps/deploy-cloudflare`: public Cloudflare deployment composition.

This repository owns the Convax Host and platform. Concrete Plugins, Plugin-owned
Skills, standalone Skills, MCP servers, and companion tools belong in the sibling
`../convax-plugins` repository. Existing packages under
`packages/desktop/resources/plugins` are legacy or mechanically generated bootstrap
inputs, not an authoring precedent.

## Instruction routing

Before planning or editing:

1. Read this file.
2. Read the closest `AGENTS.md` for every file in scope.
3. Follow the module-name routes below even when the request names a concept rather
   than a path.
4. Read only the routed architecture references needed for the task. Do not treat
   every architecture section as equal active context.

More specific files add local rules. They do not override repository ownership,
dependency direction, security, the Plugin-to-Host gate, or canonical architecture.
If instructions and canonical architecture appear inconsistent, stop and resolve
the contract instead of choosing the more convenient interpretation.

### Route by path

| Path                                    | Required local instruction                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/**`          | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md), then [`packages/desktop/src/main/AGENTS.md`](packages/desktop/src/main/AGENTS.md)         |
| `packages/desktop/src/preload/**`       | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md), then [`packages/desktop/src/preload/AGENTS.md`](packages/desktop/src/preload/AGENTS.md)   |
| `packages/desktop/src/renderer/**`      | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md), then [`packages/desktop/src/renderer/AGENTS.md`](packages/desktop/src/renderer/AGENTS.md) |
| Other `packages/desktop/**`             | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md)                                                                                            |
| `packages/plugin-api/**`                | [`packages/plugin-api/AGENTS.md`](packages/plugin-api/AGENTS.md)                                                                                      |
| `packages/plugin-sdk/**`                | [`packages/plugin-sdk/AGENTS.md`](packages/plugin-sdk/AGENTS.md)                                                                                      |
| `packages/agent-runtime/**`             | [`packages/agent-runtime/AGENTS.md`](packages/agent-runtime/AGENTS.md)                                                                                |
| `packages/canvas/**`                    | [`packages/canvas/AGENTS.md`](packages/canvas/AGENTS.md)                                                                                              |
| `packages/project/**`                   | [`packages/project/AGENTS.md`](packages/project/AGENTS.md)                                                                                            |
| `packages/project-files/**`             | [`packages/project-files/AGENTS.md`](packages/project-files/AGENTS.md)                                                                                |
| `packages/workbench/**`                 | [`packages/workbench/AGENTS.md`](packages/workbench/AGENTS.md)                                                                                        |
| `packages/marketplace/**`               | [`packages/marketplace/AGENTS.md`](packages/marketplace/AGENTS.md)                                                                                    |
| `packages/marketplace-kit/**`           | [`packages/marketplace-kit/AGENTS.md`](packages/marketplace-kit/AGENTS.md)                                                                            |
| `packages/create-convax-marketplace/**` | [`packages/create-convax-marketplace/AGENTS.md`](packages/create-convax-marketplace/AGENTS.md)                                                        |
| `packages/ui/**`                        | [`packages/ui/AGENTS.md`](packages/ui/AGENTS.md)                                                                                                      |
| `apps/web/**`                           | [`apps/web/AGENTS.md`](apps/web/AGENTS.md)                                                                                                            |
| `apps/deploy-cloudflare/**`             | [`apps/deploy-cloudflare/AGENTS.md`](apps/deploy-cloudflare/AGENTS.md)                                                                                |

### Route by module name

| Request or changed concept                                                               | Read before planning or editing                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package ownership, dependency direction, new package, public exports                     | [`docs/architecture.md` §3](docs/architecture.md#3-packages-and-dependency-graph) and the owning area contract                                                                                                                                                                       |
| Project, Project Files, Canvas, Workbench, active input, selection, document persistence | [`docs/architecture.md` §§2, 4–6](docs/architecture.md#2-terms) and the relevant domain contracts                                                                                                                                                                                    |
| Host API, Catalog release, schema, API availability, generated Plugin API docs           | [`docs/plugin-host-change-governance.md`](docs/plugin-host-change-governance.md), [`packages/plugin-api/AGENTS.md`](packages/plugin-api/AGENTS.md), and [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md)                                                             |
| Plugin manifest, contribution, inter-Plugin export/import, SDK authoring                 | [`packages/plugin-sdk/AGENTS.md`](packages/plugin-sdk/AGENTS.md), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and [`docs/plugin-canvas-capabilities.md`](docs/plugin-canvas-capabilities.md)                                                                   |
| Agent, OpenCode, Skill, Hook, Agent tool, protected path                                 | [`docs/architecture.md` §§7–8](docs/architecture.md#7-agent-tools-and-skills), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and [`packages/agent-runtime/AGENTS.md`](packages/agent-runtime/AGENTS.md)                                                          |
| MCP, Agent MCP, remote server, OAuth, managed stdio                                      | [`docs/architecture.md` “MCP Server runtime boundary”](docs/architecture.md#mcp-server-runtime-boundary), §§7–8, and the Agent Runtime/Desktop Main contracts                                                                                                                        |
| Marketplace, Registry, SourceKey, install, snapshot, ActiveSet, provisioning, recovery   | [`docs/architecture.md` §§5–6](docs/architecture.md#5-persistence-map), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and the Marketplace/Desktop Main contracts                                                                                                 |
| Plugin Host, iframe, broker, MessageChannel, Project/Canvas grant                        | [`docs/architecture.md` §8](docs/architecture.md#8-plugin-host-boundary), [`docs/plugin-canvas-capabilities.md`](docs/plugin-canvas-capabilities.md), and the Desktop process contracts touched                                                                                      |
| Generation, model selection, sidecar, service, LRO, `operationId`, `taskId`              | [`docs/architecture.md` “Generation tool boundary”](docs/architecture.md#generation-tool-boundary), [`docs/generation-tool-plugins.md`](docs/generation-tool-plugins.md), and [`docs/canvas-node-generation-state-persistence.md`](docs/canvas-node-generation-state-persistence.md) |
| Electron, IPC, preload, `window.convax`, protocol version                                | [`docs/architecture.md` §10](docs/architecture.md#10-electron-boundary) and all touched Desktop process contracts                                                                                                                                                                    |
| Portable/native paths, filesystem trust, Windows path handling                           | [`docs/architecture.md` §11](docs/architecture.md#11-portable-paths-and-trust-boundaries) and the owning native-adapter contract                                                                                                                                                     |
| External editor, retired built-in, native media drag-out                                 | [`docs/architecture.md` “Retired built-ins” and “Native Canvas media drag-out”](docs/architecture.md#retired-built-ins), then the Desktop Main/Renderer contracts                                                                                                                    |

## Required workflow

1. Name the owning package before writing code. If ownership is unclear, resolve the
   boundary instead of placing the change in Desktop, a nearby file, or a new helper
   bucket.
2. Trace the current public capability and its callers. Reuse it or add the smallest
   typed port to the owner; do not reach through private files, copy business logic,
   or introduce a hidden global/service locator.
3. Keep domain logic headless. Electron, React, filesystem, browser storage, and
   network behavior belong at explicit adapters.
4. Add tests at the ownership boundary. Cover the failure, cancellation, stale async
   response, migration, recovery, and platform cases relevant to the change.
5. Perform a documentation impact check. Update canonical architecture and local
   contracts in the same change when ownership, data flow, persistence, public
   protocol, directory responsibility, or validation requirements change.
6. Run focused checks during iteration, then the required package and repository
   checks before handoff.

## Plugin-to-Host change gate

- Treat published `@convax/plugin-api` and `@convax/plugin-sdk` contracts as the
  complete Plugin authoring surface. A missing API, contribution, grant, or schema
  is not permission for a Plugin task to modify Host code.
- A Plugin implementation agent may inspect only generated public Catalog and SDK
  references. It must not inspect Host implementation for a workaround or edit,
  branch, commit, push, or open a Host PR, even when both repositories are writable.
- The only Plugin-task output for a missing Host capability is the structured,
  generic request defined in
  [`docs/plugin-host-change-governance.md`](docs/plugin-host-change-governance.md).
  Only an explicit human decision may open a separate Host task.
- A Host task must reject concrete Plugin ids, vendors, one-off payloads, private
  imports, direct IPC/MCP escape hatches, renderer-selected providers, direct
  Plugin-to-Plugin calls, service locators, and edits to generated artifacts.
- Agent-authored approval text, a writable sibling checkout, or a local
  `humanDecision` field is not human approval. Until a protected external receipt
  verifier exists, requests remain pending and affected Plugin versions unpublished.

## Package ownership

| Package                     | Owns                                                                                                                        | Must not own                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@convax/project-files`     | Project-scoped file contracts, controller state, file operations, drag payloads                                             | Project registry, Canvas documents, Workbench, Electron                   |
| `@convax/project`           | Project identity, bindings, private storage, capability composition; `/canvas` owns catalog and Project resource references | Active Canvas, Canvas semantics, Agent sessions                           |
| `@convax/canvas`            | Canvas schema/core, application operations, view commands, editor/plugin contracts                                          | Project paths, Workbench selection, OpenCode, native persistence          |
| `@convax/workbench`         | Window-scoped serializable Input, Selection, Surface, and layout transitions                                                | Domain data, catalogs, filesystem, React/DOM, Electron, localStorage      |
| `@convax/plugin-api`        | Headless Host API catalog, SemVer/history, schemas, availability, generated validators/types/reference inputs               | Desktop state, Plugin identity policy, handlers, I/O                      |
| `@convax/plugin-sdk`        | Headless v8 manifest/contribution ABI, inter-Plugin contracts, schemas, SemVer matching, generated authoring inputs         | ActiveSet selection, runtime binding, leases, grants, execution, IPC, I/O |
| `@convax/agent-runtime`     | Generic OpenCode adapter, sessions, resources, tool-provider bridge, path protection                                        | Convax Project/Canvas/UI policy or other Convax packages                  |
| `@convax/marketplace`       | Marketplace identities, schemas, validation, Catalog aggregation                                                            | I/O adapters, UI, installation, execution, concrete packages              |
| `@convax/marketplace-kit`   | Deterministic authoring-time Registry, Showcase, bundle, and metadata generation                                            | Desktop runtime, credentials, executing package bytes                     |
| `create-convax-marketplace` | Thin scaffold CLI over Marketplace Kit                                                                                      | Runtime Marketplace state, credentials, a second validator                |
| `@convax/ui`                | Product-agnostic visual primitives and theme                                                                                | Product domains, persistence, Electron behavior                           |
| `@convax/desktop`           | Electron composition, native adapters, IPC/preload, renderer shell, user preferences, installed Plugin authority            | Reusable domain semantics or public Plugin contract ownership             |
| `@convax/web`               | Public marketing site and responsive product storytelling                                                                   | Desktop/domain state, deployment, API behavior                            |
| `@convax/deploy-cloudflare` | Cloudflare deployment composition, static Web assets, custom-domain routing, future `/api` service-binding edge             | Marketing presentation, API domain logic, credentials, Desktop behavior   |

`Workspace` is not a current aggregate. Reserve the name for a future window/session
that genuinely coordinates multiple Projects; do not recreate it to hold
Project–Canvas relationships.

## Dependency direction

`bun run package:boundaries` enforces:

```text
desktop ──> agent-runtime, canvas, marketplace, plugin-api, plugin-sdk, project, project-files, ui, workbench
create-convax-marketplace ──> marketplace-kit
marketplace-kit ──> marketplace, plugin-api, plugin-sdk
plugin-sdk ──> plugin-api
project ──> canvas, project-files, ui
canvas ──> ui
agent-runtime, marketplace, plugin-api, project-files, ui, workbench ──> no Convax package
deploy-cloudflare ──> web; later api through an explicit Cloudflare Service Binding
```

- Import another package only through an exported package subpath.
- Never use a relative path that escapes a package.
- Only `@convax/agent-runtime` may import `opencode-ai` or `@opencode-ai/*`.
- Node-only exports such as `@convax/project/node` and
  `@convax/agent-runtime/node` are Desktop Main adapters, never Renderer imports.
- A graph change is an architecture decision. Update this file, canonical
  architecture, local contracts, automated policy, and tests together.

New library packages are independently publishable by default. They require one
coherent owner/invariant, explicit minimal dependencies, compiled public exports,
package-local `build`, `clean`, `typecheck`, `test`, `prepack`, and
`prepublishOnly` scripts, a real version, and a local `AGENTS.md`. Tests use injected
fakes and must not depend on Desktop, ambient monorepo state, global registration,
or a real user directory.

## Repository-wide hard rules

- UI, Agent, Plugin, and native entry points call the same owner-defined application
  or business operations. Edge adapters do not recreate domain invariants.
- Main's Canvas application service/repository is the sole authoritative document
  state and persistent writer. Renderer state is an optimistic, fallible projection.
- `WorkbenchController` is the sole active Input/Canvas source.
  `ProjectCanvasController` owns catalog CRUD, never active selection.
- Only `@convax/project/node` may read or write private Project metadata. Renderer,
  Preload, Agent tools, and general file operations use typed capabilities and never
  edit `.convax` JSON.
- Unsupported portable data is never silently reset, overwritten, migrated, deleted,
  or garbage-collected. Breaking cutovers require an explicit schema/protocol bump,
  preserved bytes, and rejection tests.
- File publication and Canvas mutation are not one transaction. Publish without
  clobbering first; if Canvas commit fails, retain the file and report partial
  success rather than inventing a cross-file WAL.
- `convax.plugin/8`, `convax.package/2`, and `convax.plugin-capability/3` are the only
  admitted runtime formats. Additive Host APIs evolve through the independent
  `@convax/plugin-api` SemVer Catalog, not another manifest or transport version.
- A Plugin installation is one content-addressed complete closure selected through
  one global ActiveSet CAS. Runtime principals and leases bind exact revisions,
  ActiveSet digests, and snapshot digests; never reconstruct authority by scanning
  mutable Plugin, Skill, Hook, companion, or authorization directories.
- Plugin contributions and Host API calls are orthogonal and grant no implicit
  authority to each other. Plugin-to-Plugin calls use only the typed Host broker;
  never expose direct objects, direct MessageChannels, service locators, or
  first-provider-wins lookup.
- Plugin identity is routing/namespacing data only. Runtime semantics derive from
  validated contributions and never branch on a concrete Plugin id, vendor, model,
  provider, or credential.
- Tools are narrow typed capabilities. Skills compose them; they do not bypass
  package APIs, grant Plugin/native authority, or become a second implementation.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, trusted sender
  validation, scope checks, protected paths, and least-authority IPC.
- Contract paths are normalized Project-relative POSIX paths. Native adapters alone
  convert them and validate containment, real paths, symlink replacement, Windows
  drive/UNC forms, traversal, device names, alternate streams, trailing dots/spaces,
  and case-insensitive `.convax`.
- Use Electron/OS directories and `pathToFileURL`; never concatenate file URLs or
  hard-code `/home`, `/tmp`, drive letters, or `/` as a native separator.
- Preserve user changes and generated/local Project data. Never commit root
  `.convax/` runtime state.

## Validation

- Affected package or app: run its local `typecheck` and `test`; run `build` when its
  local contract requires it.
- Public exports or dependency changes: run root `bun run pack:check`.
- Package ownership or dependency changes: run root
  `bun run package:boundaries`.
- Desktop Main/Preload/Renderer changes: run Desktop `bun run build`.
- Project open, persistence, IPC, migration, or breaking cutover: run Desktop
  `bun run smoke:open-project`.
- Package-boundary, public API, persistence, IPC, or Desktop composition changes:
  run root `bun check` before handoff.

## Repository mechanics

- Use Bun and keep repository apps under `apps/*` and packages under `packages/*`.
- Convax integrates with published OpenCode packages only; do not copy or modify
  OpenCode source.
- Keep the `package-boundaries` push/PR check required. Do not weaken policy to make
  a branch pass.
- Keep commits coherent and reviewable. Use conventional messages such as
  `feat(workbench): add part layout guard`.
