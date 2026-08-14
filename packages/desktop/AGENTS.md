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
  ActiveSet and installed capability authority, Agent runtime composition, trusted
  IPC, and the signed packaged-application update lifecycle.
- Preload exposes a narrow typed bridge. It owns no durable or business state.
- Renderer owns presentation, controller composition, fallible projections, and
  user preferences. It never imports Node or Electron.
- Reusable state machines, validation, sizing, placement, relationship, persistence,
  and conflict rules stay in their domain owner and enter Desktop through public
  typed ports.
- Public Plugin Host APIs and manifest/contribution contracts belong to
  `@convax/plugin-api` and `@convax/plugin-sdk`; Desktop implements and binds them
  but never forks their schemas or generated documentation.
- Packaged Main and Preload outputs are self-contained JavaScript bundles. Only
  Electron and Node built-ins may remain external, the ASAR must not contain or
  depend on `node_modules`, and Main stays CommonJS so Electron Vite cannot inject
  its ESM compatibility shim into dependency-bundled source strings.
- Main also composes the PeerJS data plane, its independently bound channels,
  OS-vault identity keys, Project-scoped writer coordination, and typed ports to
  collaboration, Project, Canvas, and control-plane owners. Peer or service arrival
  order never becomes edit order.
- Development runtime identity is Main-owned composition state. A bounded task id
  and label require a task-private userData profile; Main owns native/window
  branding and may project only the display identity to Renderer. Packaged runtime
  ignores the mode, and Renderer never chooses or receives the native profile path.
- Packaged application updates are Main-owned native operations for signed macOS
  and Windows builds. Renderer and Preload receive no updater bridge. The public
  feed URL is build configuration; signing, notarization, object-storage, and
  publication credentials live only in protected GitHub Actions settings. Main
  must finish the shared write/task/runtime shutdown drain before installation.

## Shared composition rules

- Keep Project lifecycle, Project Files, Project Canvas, Canvas, generation, Agent,
  Plugin, Plugin capability, and Plugin service bridge namespaces distinct. Do not
  add general file methods to `window.convax.projects` or a generic invoke bridge.
- Plugin service usage history crosses Main/Preload only through the fixed optional
  `service.usage.list` projection. Keep it bounded and display-only; failure must
  not invalidate an otherwise valid service status or become billing authority.
- Derive the active Canvas/file from Workbench Surface only. Project Canvas owns
  catalog CRUD; Desktop coordinators may own save guards, fallback, rollback, and
  preference flows, but not a second active selection.
- Create Project injects the trusted `Documents/Convax` parent and never opens a
  native picker. Open Project alone binds an existing directory. Renderer and
  Preload never receive or choose the default native creation path.
- Workbench owns generic resize/collapse transactions. Desktop owns concrete pixels,
  viewport constraints, pointer/keyboard wiring, animation, and browser persistence.
- Desktop Renderer owns one explicitly composed scoped shortcut service for window
  keyboard routing. Registrations are the closed discriminated union
  `CommandShortcut | HoldShortcut | GestureModifier`: commands consume one winning
  keydown, holds consume and own active/release state, and gesture modifiers never
  consume native key handling because a later pointer gesture observes their
  transient state. Focus scopes register DOM roots and feature/chord bindings;
  the deepest focus scope wins, application features alone may fall back, and one
  deterministic priority/registration-order winner handles a conflict within a
  scope. Scope changes, top-level Window blur, visibility loss, and disposal release
  all held features; descendant DOM blur inside the active scope must not impersonate
  Window focus loss. A transient pointer-created `activeElement === body` gap is
  rechecked on the next frame; explicit registered-scope transitions stay immediate,
  and a sustained outside-root focus releases the held feature. A fresh non-repeat matching keydown releases and replaces a stale held
  feature when a native operating-system loop swallowed keyup; repeat events never
  restart it. Do not add parallel global listeners for application/workspace/Canvas
  command routing or move DOM focus into Workbench. Register the complete product
  Canvas chord inventory in Renderer and invoke only Canvas's typed shortcut-command
  or held-state ports. Prioritized target-matched scopes isolate node inputs and
  Canvas interaction surfaces. Gesture/hold state is never persisted to Canvas,
  Workbench, browser storage, or native tickets. Register `document.body` only as an
  additional application Portal root; direct body/document-element focus remains
  ambiguous and never preserves Canvas scope. Native copy/paste stays on browser
  clipboard events.
- Main's Canvas application service is authoritative. Mounted UI submits closed
  commands through its originating session lease, installs the returned projection
  and accepted frame marker, and queries only for unknown/remote invalidation; it never saves a complete snapshot,
  sends raw Yjs updates, arbitrates Main mutations, or turns projection failure into
  domain failure.
- Each Main mutation uses an isolated candidate Y.Doc against the latest replica
  state and crosses the collaboration object's outbox/journal/head durability
  barrier exactly once before publication. Each offline/local commit is the final long-lived-replica-signed causal frame.
  Reconnect transmits the same bytes and never replays, renumbers, or re-signs the
  business intent.
- Checkpoint pruning requires both content certification and exact all-active-editor causal-floor
  ACK coverage for the bound membership snapshot. Missing either gate retains
  history without blocking ordinary edits or replication.
- ProjectIndexYDoc is the sole Canvas route, tombstone, shardEpoch, and current
  Project-entry authority. Per-Canvas Y.Docs own Canvas state. Desktop must not
  reconstruct a JSON catalog, global revision counter, or renderer document store
  as a parallel authority.
- React Flow projection, measurements, selection, viewport, and gesture previews
  remain transient Canvas-owned view state. Desktop supplies shell and adapters,
  not a competing document store.
- A renderer presentation overlay is isolated from the session's authoritative
  projection. Ghost/token/visual-history values never cross preload or IPC. Resource
  preparation remains in Main; post-commit session delivery may be unavailable
  without changing durable success, in which case Renderer performs one refresh.
- The strict session projection carries exact node and edge incarnation tables for
  guarded presentation only. Provisional visual roots and renderer-decoded image
  hints remain Canvas-owned transient state; Main binds history to durable roots and
  derives authoritative image geometry from Project-admitted bytes.
- Collaboration composition loads only the packaged current protocol descriptor and
  composes exactly one kernel, one codec, and one document session type. There is no
  authority selector, release pair, dual-version dispatch, promotion bridge, or
  successor runtime, and new/open/recover/share use the same composition. A descriptor
  that is missing or does not match the build fails closed; archived authority
  releases, drafts, receipts, code, or portable JSON bytes are evidence only and never
  runtime fallback. Desktop build and packaging never stage or read
  `docs/superpowers/specs/authorities/**`.
- Unsupported collaboration bytes return one `unsupported-project-data` result. Never
  infer a protocol from a directory, filename, or durable record shape, and never
  reset, re-sign, or reinterpret those bytes without the explicit user-confirmed reset
  that retains a recoverable backup.
- Plugin surface creation crosses processes as one narrow trusted method carrying only
  Project, Canvas, and Plugin ids. Main resolves one exact current ActiveSet lease,
  derives renderer/size/schema/validation-artifact/snapshot and initial state from that
  leased manifest, rechecks the lease immediately before the durable commit, and calls
  the Canvas business command. Renderer and Preload never send or build a version,
  digest, node id, position, complete Canvas node, or initial state, and no renderer
  node factory or generic node-insert path substitutes for that command.
- Product Agent tools and direct UI/Plugin/native calls are thin adapters over the
  same typed Project, Canvas, Workbench, and generation capabilities.
- UI and Agent updates to an existing editable Canvas text resource share one
  Main-owned adapter over Project Files compare-and-replace, ProjectIndex version
  publication, and the Canvas resource relink operation. Filesystem notifications
  remain refresh hints and never substitute for that transaction path.
- Card conversations infer only direct incoming file nodes. Image/video replacement
  cards may persist one opaque output-tool override. Text cards isolate model and
  options by output for the mounted composer and create a separate pending media
  node; the text owner is only the constrained relation anchor unless separately
  admitted as input.
- Project-directory browsing reuses the Project Files listing capability as a
  transient, bounded, read-only Canvas projection. It never creates persisted Canvas
  entries or a second filesystem bridge.
- Only typed Project resources staged as generation inputs may retain a bounded,
  stable `.convax/staging` hard-link alias. Plugin outputs, executable snapshots,
  and every other native copy retain the single-link requirement.
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
- Renderer owns the application-language preference. Mirror only its validated
  locale into each exact Web Plugin connection; Main keeps no durable locale and a
  language switch must not replace the iframe, ActiveSet lease, or Plugin principal.
  Resource parsing and fallback remain `@convax/plugin-sdk` behavior.
- Explicit Plugin install/update/import consent publishes exact execution
  authorization with the immutable snapshot. Integrity or byte mismatch routes to
  exact-source reinstall/update, never a second Plugin setup action. Static Web
  Plugins receive the same exact source/version/artifact-bound authorization.
- Product-lock recovery bytes are visible only to an explicit quarantined
  retired-major update after exact retired-source/id/old-version/archive/snapshot/
  Host-major matching and an exact move to the lock-derived current Official
  SourceKey. Fresh install and default provisioning cannot consume them; a
  successful CAS stays inert until restart, and no other source migration is valid.
- Native paths, credentials, cookies, authorization URLs, SourceKeys, snapshot
  digests, executable bindings, transport choices, and raw diagnostics stay in Main.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, trusted sender
  validation, bounded messages, stale-scope checks, and cancellation at every
  process crossing.
- Browser storage is for renderer preferences, Workbench recovery choices, and
  bounded versioned Marketplace, Plugin Service, and model catalog display caches
  only. It is never
  canonical domain, installation, execution, billing, or authorization state.
- Marketplace settings seed from the last complete safe Renderer projection across
  remounts and cold windows, then revalidate in the background at window startup.
  Strictly reject malformed, oversized, unknown-field, or Main-authority-shaped
  cache data; never accept it as Marketplace, installation, grant, or ActiveSet
  authority.
- Plugin Services seed from the last complete safe Renderer projection across
  remounts and cold windows, then revalidate inventory, status, and optional usage
  independently in the background. Keep old values visible during refresh; reject
  unsafe cache data, clear prior usage on credential-changing actions, and never use
  the projection for service actions, Checkout, or execution.
- Agent and generation model pickers seed from one last-complete safe Renderer
  projection across cold windows, then revalidate in the background. Group models
  by Service for navigation, preserve exact model ids at selection, reject unsafe
  cache data, and revalidate every selection at the Agent/generation dispatch
  boundary.
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
