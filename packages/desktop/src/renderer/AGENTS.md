# Desktop Renderer Contract

This file applies to `packages/desktop/src/renderer/**` and extends the Desktop
package contract. Renderer owns the React shell, controller composition, view
adapters, fallible projections, and per-user/window preferences. It owns no native
or durable domain authority.

## State and composition

- `WorkbenchController` is the sole source of the active Input/Canvas/file.
  `ProjectCanvasController` owns catalog CRUD only. Do not mirror active selection
  into Project state, component-local state, or browser storage.
- Keep domain behavior in the owning package's business/application service.
  Renderer coordinators compose public capabilities; React components handle user
  events, subscriptions, and rendering rather than recreating validation,
  persistence, placement, conflict, or recovery logic.
- Canvas domain state is Main's authoritative session projection. Immediate
  feedback is a separate Canvas-owned presentation overlay: ghosts are
  non-interactive and never enter selection, clipboard, commands or IPC. Install a
  local response projection before covering its frame digest, skip the matching
  invalidation query, and preserve one trailing query for unknown frames arriving
  during refresh.
- Every local Canvas mutation may reserve only a Canvas-owned opaque provisional root
  before the durable lane; Renderer never applies the business command or constructs
  a candidate document. Geometry may attach its already-known presentation result;
  all other before/after snapshots come from Main's accepted projection. Undo/Redo
  uses that visual cursor immediately and still sends no caller-selected operation
  id. Never invent identities for create commands. Dropped-image decoding is likewise
  presentation-only: wait for the hint before showing a full ghost card and use the
  Canvas sizing policy, while Main independently inspects admitted bytes.
- Main mutations never depend on Renderer flush, lock, mounted editor, selection,
  reveal, panel lifetime, or acknowledgement. Projection failure after commit is a
  UI recovery condition, not a failed domain mutation.
- Switching Project synchronously resets Workbench scope and scopes Project Files
  and Project Canvas controllers. Guard asynchronous results so prior-scope
  responses cannot overwrite the current projection.
- Project activation is local-first. A missing local Canvas mutation authority is a
  bounded recovery state; Renderer must not automatically
  open Team creation/join UI, load sharing runtime, or imply that sharing is required.
  Team collaboration UI is reached only through an explicit sharing action.
- Browser storage contains renderer preferences, Workbench recovery choices, and
  bounded versioned Marketplace, Plugin Service, and model catalog display caches
  only. Loading a
  preference may choose an initial Input; Workbench is canonical afterward. Both
  caches remain disposable projections and Main remains authoritative.
- Development task identity is a Main-authored, bounded URL projection used only
  for the window title and visible environment badges. Do not persist it, derive a
  native path from it, accept it through Plugin/UI input, or use it as authority.
- Workbench owns generic layout transitions. Renderer owns pointer/keyboard wiring,
  concrete viewport budgets, CSS animation, and persistence of user preferences.
- Compose the scoped shortcut service explicitly in the Renderer root. Surfaces
  register focus roots and feature bindings through the injected instance; do not
  create global shortcut singletons or independent global command listeners. The exact
  focused scope switches the active feature set, application scope is the only
  fallback, and nested conversation/node-input scopes isolate Canvas commands.
  Conflicts use explicit priority then first registration, while scope change,
  window blur, document hiding, and unmount release every held feature.

## Capability surfaces

- Renderer and React code never import Node, Electron, Node-only package exports, or
  private Main files. Use the typed Preload bridge.
- Renderer never receives or constructs native paths, SourceKeys, executable
  bindings, credentials, cookies, authorization URLs, MCP server keys, transport
  configuration, or raw host diagnostics.
- Catalogs, service state, Agent MCP status, generation models, tool controls, and
  runtime preferences are display projections. Main must revalidate the exact
  ActiveSet/snapshot identity, live schema/service status, grants, scope, and
  revisions before action.
- Service usage history is an optional bounded display list. Render every admitted
  record, keep filtering/navigation local to the Services surface, and never infer
  execution or billing authority from it.
- Seed Services from the last complete strictly validated projection across cold
  windows, preserve those values while inventory, status, and usage refresh in the
  background, clear prior usage on credential-changing actions, and discard an entry
  when its Plugin contribution fingerprint changes.
- Seed Agent and generation model pickers from one last-complete strictly validated
  projection across cold windows, retain it while the current catalogs refresh, and
  group models under expandable Service rows. Cache entries are display-only; exact
  provider/model and tool ids must still cross the normal send-time revalidation.
- Marketplace UI may render its last complete strictly validated projection
  immediately across remounts and cold windows while revalidating it through Main
  at Renderer startup. Persist only bounded renderer-safe fields; never let the
  projection authorize a selection, install, update, setup, or runtime action.
- Keep the Agent generation model as the user-global renderer preference. A Canvas
  card may persist only its own opaque output-tool override through Canvas; card
  changes never update the Agent default in reverse or create a second catalog.
- Card-scoped Agent and Generate conversations preload direct incoming file nodes
  only as removable references. The owning card remains separate context/target;
  never infer it or outgoing neighbors as inputs.
- Image/video replacement cards may persist one opaque output-tool override. A text
  card keeps image/video model and options isolated by output for the mounted
  composer, creates exactly one separate pending result node, and uses the text
  owner only as the relation anchor unless its content is separately admitted as an
  incoming input.
- Project-directory browsing is a transient read-only projection over the existing
  Project Files capability. Projected entries are not persisted, selected,
  connected, moved, or added to Canvas history.
- Project file rows render only bounded thumbnail data. Mounted video rows schedule
  bounded-concurrency thumbnail-purpose leases, capture one small Chromium frame,
  and immediately clear the media element and close the lease without waiting for
  hover. Open the independent full-preview lease only after the hover delay and
  close it while clearing the media source on preview exit or unmount. Admit the
  preview protocol in Renderer CSP only for `img-src` and `media-src`, never
  `connect-src`.
- A Canvas pointer drop projects the screen point through React Flow exactly once
  and forwards only that Canvas point plus the closed `center` anchor origin.
  Renderer may size an optimistic ghost but never converts the authoritative card
  geometry or supplies intrinsic dimensions to Main.
- Selection actions render only host-projected actions for an immutable selection
  snapshot. Abort their live Canvas signal when the snapshot or surface is replaced
  and forward cancellation through the explicit Preload protocol only while Main
  admission is pending. After the durable admission receipt, close the dialog and
  leave cancellation and terminal progress on each pending Canvas card; unmount,
  remount, selection changes and late UI responses must not own the task lifetime.
- Third-party Web Plugins render as `file` nodes in exactly
  `sandbox="allow-scripts"` iframes. Never import their JavaScript, use `webview`,
  enable same-origin/Node/Electron access, or expose a generic function-call bridge.
  Feature-policy exceptions require an explicit manifest capability.
- Load Web entries and portable relative subresources from the exact leased immutable
  snapshot identity. Root-relative, absolute, Plugin-id-derived, or version-derived
  asset URLs must fail closed rather than fall through to a current installation.
- Web Plugin MessagePorts, Host API calls, capability imports, commands, and
  node-scoped calls remain bound to their exact frame lease and scope.
  Renderer-provided ids and state do not create Project/Canvas authority.
- Application locale is a Renderer preference projected through one stable store.
  Update the exact live Plugin connection and Host-rendered labels in place; never
  unregister the contribution or reload the iframe solely for a language change.
- Closing a Web Plugin client may send only the payload-free lifecycle disconnect
  for its existing MessagePort. It must not select a Main connection or frame
  identity, and teardown must not depend on asynchronous `beforeunload` work.
- Project connected-media CSP from exact declarations and grants only. Image input
  may widen `img-src`, audio/video input may widen `media-src`, and neither widens
  `connect-src`. Pet assets widen only `img-src` for the exact admitted Pet document;
  unrelated Plugin documents and legacy schemas stay closed.
- Native media drag-out starts only from an explicit held export gesture. Renderer
  publishes a complete immutable selection and may hold a short-lived opaque ticket;
  it never stages files or sees the native drag payload. Convax Desktop exposes both
  the persistent drag-out mode and a `Command-Shift` compatibility chord; the chord
  is registered in the Canvas focus scope and forwards only held/released state to
  the Canvas editor handle. It cannot activate from a conversation, node input,
  inactive scope, or parallel Canvas-owned window listener.

## UI behavior

- Reuse `@convax/ui`, Canvas command/menu/toolbar/renderer registries, and
  owner-provided UI contracts. Placements reference canonical command ids rather
  than duplicating title, icon, target, or behavior. Do not create a parallel
  primitive layer, extension bus, node role, or service locator.
- A successful domain mutation remains successful even if notification, reveal,
  animation, selection, or refresh fails.
- Preserve cancellation and stale-snapshot behavior across unmount, remount,
  selection changes, scope changes, focus loss, and disposal.
- Keep user-visible errors bounded and safe. Raw sidecar, filesystem, network,
  authorization, and recovery diagnostics remain in Main.
- Plugin readiness and setup UI is a display projection. Integrity, authorization,
  source, version, or artifact mismatch routes to exact-source reinstall/update;
  never invent a `Complete setup` action for a Plugin.
- Keep the development task label visible in both the titlebar and a fixed
  bottom-right badge whenever Main supplies it; product branding alone is not
  sufficient environment identification.

## Mandatory references

- Project/Canvas/Workbench UI:
  [`docs/architecture.md` §§4–6](../../../../docs/architecture.md#4-canonical-state)
  and the relevant domain package contracts.
- Agent/Skill/MCP UI:
  [`docs/architecture.md` §§7–8](../../../../docs/architecture.md#7-agent-tools-and-skills)
  and [`docs/plugin-skill-platform.md`](../../../../docs/plugin-skill-platform.md).
- Plugin Host API or contribution UI:
  [`docs/plugin-host-change-governance.md`](../../../../docs/plugin-host-change-governance.md),
  Plugin API/SDK package contracts, and
  [`docs/plugin-canvas-capabilities.md`](../../../../docs/plugin-canvas-capabilities.md).
- Generation/model/service UI:
  [`docs/generation-tool-plugins.md`](../../../../docs/generation-tool-plugins.md)
  and
  [`docs/canvas-node-generation-state-persistence.md`](../../../../docs/canvas-node-generation-state-persistence.md).
- Plugin iframe, RPC, or Canvas grants:
  [`docs/plugin-canvas-capabilities.md`](../../../../docs/plugin-canvas-capabilities.md).
- IPC changes:
  [`docs/architecture.md` §10](../../../../docs/architecture.md#10-electron-boundary)
  and the Main/Preload contracts.

## Validation

- Run `bun typecheck && bun test` from `packages/desktop`.
- Run focused renderer/controller/component tests for the changed behavior.
- Run `bun run build`.
- Run `bun run smoke:open-project` for Project activation, Canvas persistence, or
  IPC behavior.
- Run root `bun check` for public IPC or Desktop composition changes.
