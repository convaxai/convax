# Desktop Package Contract

This file applies to `packages/desktop/**`. Desktop is the private Electron
composition root: it wires domain packages to native adapters, installed capability
authority, IPC, renderer controllers, and user preferences. It must not become a
second domain core or a second public Plugin contract owner.

Concrete Plugins, Skills, MCP servers, and companion tools are authored in the
sibling `convax-plugins` repository. Do not add integrations under
`resources/plugins`; Desktop may consume verified artifacts, mechanically generated
bootstrap bytes, and synthetic generic test fixtures only.

## Process routing

Read the closest process contract before planning or editing:

- `src/main/**` → [`src/main/AGENTS.md`](src/main/AGENTS.md)
- `src/preload/**` → [`src/preload/AGENTS.md`](src/preload/AGENTS.md)
- `src/renderer/**` → [`src/renderer/AGENTS.md`](src/renderer/AGENTS.md)
- `src/generated/**` → generated contracts; change their source/generator rather than
  editing generated output by hand

When a contract crosses processes, read every touched process contract and update
Main, Preload, Renderer, protocol compatibility tests, and
`desktopProtocolVersion` together.

## Directory guide

- `src/main`: Electron lifecycle, native I/O, repositories, trusted IPC, Agent
  runtime composition, Plugin/Marketplace runtimes, and Host-owned coordinators.
- `src/preload`: narrow serializable `window.convax` bridge and renderer-safe
  adapters; no business state.
- `src/renderer`: React application shell, domain controller instances,
  cross-domain coordinators, view adapters, and per-user/window preferences.
- `src/generated`: generated protocol/build artifacts.
- `resources`: packaged static resources and migration/bootstrap inputs, not a
  concrete integration authoring surface.

Canonical ownership, state, persistence, and flows live in
[`docs/architecture.md`](../../docs/architecture.md). Keep this file focused on
Desktop-wide change rules; detailed Main-only lifecycles belong in the Main
contract and its routed references.

## Process boundaries

- Main owns Electron/native I/O, Project Node adapters, authoritative repositories,
  ActiveSet and installed capability authority, Agent runtime composition, and
  trusted IPC.
- Preload exposes a narrow typed bridge. It owns no durable or business state.
- Renderer owns presentation, controller composition, fallible projections, and
  user preferences. It never imports Node or Electron.
- Reusable state machines, validation, sizing, placement, relationship, persistence,
  and conflict rules stay in their domain owner and enter Desktop through public
  typed ports.
- Public Plugin Host APIs and manifest/contribution contracts belong to
  `@convax/plugin-api` and `@convax/plugin-sdk`; Desktop implements and binds them
  but never forks their schemas or generated documentation.

## Shared composition rules

- Keep Project lifecycle, Project Files, Project Canvas, Canvas, generation, Agent,
  Plugin, Plugin capability, and Plugin service bridge namespaces distinct. Do not
  add general file methods to `window.convax.projects` or a generic invoke bridge.
- Derive the active Canvas/file from Workbench Surface only. Project Canvas owns
  catalog CRUD; Desktop coordinators may own save guards, fallback, rollback, and
  preference flows, but not a second active selection.
- Create Project injects the trusted `Documents/Convax` parent and never opens a
  native picker. Open Project alone binds an existing directory. Renderer and
  Preload never receive or choose the default native creation path.
- Workbench owns generic resize/collapse transactions. Desktop owns concrete pixels,
  viewport constraints, pointer/keyboard wiring, animation, and browser persistence.
- Main's Canvas application service is authoritative. Renderer submits
  revision-bound commands and reloads after invalidation; it never saves a whole
  document, arbitrates Main mutations, or turns projection failure into domain
  failure.
- Product Agent tools and direct UI/Plugin/native calls are thin adapters over the
  same typed Project, Canvas, Workbench, and generation capabilities.
- Treat standalone Skills, Plugin-owned Skills, Web entries, OpenCode Hooks, Agent
  MCP contributions, Tool companions, Host API calls, and inter-Plugin capabilities
  as distinct surfaces. One never grants another's authority.
- Publish each Plugin as one complete immutable closure and select exact snapshots
  through the global ActiveSet CAS. Plugin-owned Skills and Hooks resolve from the
  leased closure; never copy them into standalone namespaces or recreate legacy
  ownership/authorization journals.
- Bind `convax.plugin/8` contributions and `hostApi` declarations independently.
  Plugin-to-Plugin imports/exports resolve through the typed Host broker and exact
  leased caller/provider snapshots, never direct calls or a service locator.
- Native paths, credentials, cookies, authorization URLs, SourceKeys, snapshot
  digests, executable bindings, transport choices, and raw diagnostics stay in Main.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, trusted sender
  validation, bounded messages, stale-scope checks, and cancellation at every
  process crossing.
- Browser storage is for renderer preferences and Workbench recovery choices only.
  It is never canonical domain, installation, execution, or authorization state.
- Every cancellable cross-process operation uses a sender-scoped opaque id only for
  lifecycle correlation. Authority and scope are independently derived and
  revalidated by Main.

## Module routing

These references are mandatory when the named capability is involved:

| Capability                                                   | Required reference                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project/Canvas/Workbench composition                         | [`docs/architecture.md` §§4–6](../../docs/architecture.md#4-canonical-state) and the relevant package contracts                                                                                                            |
| Host API/SDK change                                          | [`docs/plugin-host-change-governance.md`](../../docs/plugin-host-change-governance.md), Plugin API/SDK package contracts, and [`docs/plugin-skill-platform.md`](../../docs/plugin-skill-platform.md)                       |
| Agent/OpenCode/Skills/Hooks/MCP                              | [`docs/architecture.md` §§7–8](../../docs/architecture.md#7-agent-tools-and-skills), [`docs/plugin-skill-platform.md`](../../docs/plugin-skill-platform.md), and Agent Runtime/Main contracts                              |
| Marketplace/Registry/install/snapshot/ActiveSet/provisioning | [`docs/architecture.md` Marketplace flow and §8](../../docs/architecture.md#marketplace-listing-install-and-setup), [`docs/plugin-skill-platform.md`](../../docs/plugin-skill-platform.md), and Marketplace/Main contracts |
| Generation/models/services/LRO                               | [`docs/generation-tool-plugins.md`](../../docs/generation-tool-plugins.md), [`docs/canvas-node-generation-state-persistence.md`](../../docs/canvas-node-generation-state-persistence.md), and Main/Renderer contracts      |
| Web Plugin/Host API/broker/Canvas grants                     | [`docs/plugin-canvas-capabilities.md`](../../docs/plugin-canvas-capabilities.md) and all touched process contracts                                                                                                         |
| IPC/bridge/protocol                                          | [`docs/architecture.md` §10](../../docs/architecture.md#10-electron-boundary) and all touched process contracts                                                                                                            |
| External editor or media drag-out                            | [`docs/architecture.md` native integration sections](../../docs/architecture.md#retired-built-ins) and Main/Renderer contracts                                                                                             |

## Validation

- Run `bun typecheck && bun test` from `packages/desktop`.
- Run `bun run build` for Main, Preload, Renderer, or cross-process contract changes.
- Run `bun run smoke:open-project` for Project open, persistence, IPC, migration, or
  breaking-cutover changes.
- Run root `bun run package:boundaries` when package imports or composition edges
  change.
- Run root `bun check` for public API, persistence, IPC, or Desktop composition
  changes before handoff.
