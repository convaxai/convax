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
- Canvas state is an optimistic projection of Main's authoritative document.
  Submit element-level revision-bound commands, process committed revision
  invalidations, and reload without first saving a stale whole-document snapshot.
- Main mutations never depend on Renderer flush, lock, mounted editor, selection,
  reveal, panel lifetime, or acknowledgement. Projection failure after commit is a
  UI recovery condition, not a failed domain mutation.
- Switching Project synchronously resets Workbench scope and scopes Project Files
  and Project Canvas controllers. Guard asynchronous results so prior-scope
  responses cannot overwrite the current projection.
- Browser storage contains renderer preferences and Workbench recovery choices only.
  Loading a preference may choose an initial Input; Workbench is canonical
  afterward.
- Workbench owns generic layout transitions. Renderer owns pointer/keyboard wiring,
  concrete viewport budgets, CSS animation, and persistence of user preferences.

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
- Selection actions render only host-projected actions for an immutable selection
  snapshot. Abort their live Canvas signal when the snapshot or surface is replaced
  and forward cancellation through the explicit Preload protocol.
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
- Closing a Web Plugin client may send only the payload-free lifecycle disconnect
  for its existing MessagePort. It must not select a Main connection or frame
  identity, and teardown must not depend on asynchronous `beforeunload` work.
- Project connected-media CSP from exact declarations and grants only. Image input
  may widen `img-src`, audio/video input may widen `media-src`, and neither widens
  `connect-src`. Pet assets widen only `img-src` for the exact admitted Pet document;
  unrelated Plugin documents and legacy schemas stay closed.
- Native media drag-out starts only from an explicit held export gesture. Renderer
  publishes a complete immutable selection and may hold a short-lived opaque ticket;
  it never stages files or sees the native drag payload.

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
