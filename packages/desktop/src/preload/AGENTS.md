# Desktop Preload Contract

This file applies to `packages/desktop/src/preload/**` and extends the Desktop
package contract. Preload is a narrow serialization and authority-reducing adapter
between trusted Main and untrusted Renderer code. It owns no business state.

## Rules

- Keep packaged Preload as a self-contained JavaScript dependency bundle. Only
  Electron and Node built-ins may remain external; never rely on packaged
  `node_modules` or a monorepo workspace layout.
- Expose explicit typed methods and subscriptions under the existing
  `window.convax` namespaces. Never expose generic `invoke`, arbitrary channel
  names, caller-selected MCP/tool methods, or raw `ipcRenderer`.
- Keep namespaces separate: `projects`, `projectFiles`, `projects.canvases`,
  `canvas`, `generation`, `agent`, `plugins`, `pluginCapabilities`, and
  `pluginServices`. Preserve the matching `project:*`, `project-files:*`,
  `project:canvas-*`, `canvas:*`, `generation:*`, `agent:*`, `plugin:*`, and
  `plugin-service:*` channel families.
- Pass only bounded, structured-clone-safe contracts. Do not leak Electron objects,
  functions, class instances, native paths, executable bindings, SourceKeys,
  credentials, cookies, authorization URLs, transport choices, or raw diagnostics.
- Treat every returned catalog, status, model, and capability object as a
  renderer-safe projection, not authority. Main revalidates the real request.
- Marketplace detail lookup forwards only a bounded capability `{kind,id}` and
  returns Main-projected metadata, bounded Skill file previews, and optional
  verified Showcase bytes. Never add SourceKey, artifact URL, digest, or native
  path parameters to this bridge. The optional source action likewise forwards only
  `{kind,id}`; Main opens the canonical GitHub repository and no URL returns through
  Preload.
- Keep Project and Canvas references portable and scoped. Never translate them into
  native paths in Preload.
- Editable-text save forwards only the bounded content update plus its original
  Project, Canvas, and renderer session lease. It never derives or rewrites that
  scope, and Main remains responsible for validating the lease and active Project.
- Keep bounded Project file thumbnail results separate from purpose-tagged opaque
  media leases. Video-cover leases and full-preview leases carry only Project scope,
  purpose, or an opaque lease id; media bytes remain on Main's range protocol rather
  than crossing IPC.
- Translate cancellable operations into explicit cloneable start/cancel messages.
  Do not treat the opaque operation id as authority or expose a Main `AbortSignal`.
- Keep adapters stateless apart from listener registration and deterministic
  disposal. Remove IPC listeners when the owning subscription or window is
  disposed.
- The Plugin locale method is a fixed typed connection update, not a generic event
  bridge. Forward only the opaque connection id and bounded locale string.
- Preserve `contextIsolation`, sandboxing, disabled Node integration, and the
  smallest possible exposed surface.

Read [`docs/architecture.md` §10](../../../../docs/architecture.md#10-electron-boundary)
for every bridge change. Also read the routed capability document from the root and
Desktop contracts; Preload must not simplify or widen its semantics.

## Cross-process changes

An incompatible bridge change updates Main, Preload, Renderer,
`desktopProtocolVersion`, and compatibility tests together. Keep authoritative load
and closed typed Canvas commands; never add whole-document save or
renderer-supplied native authority.

Canvas session mutation DTOs carry a strict accepted frame digest and complete
session projection, including exact owner projection identity plus live node and
edge incarnation tables; invalidations carry their frame digest. Resource mutation
requests carry the current session id and responses use a strict
`certified | unavailable` delivery union. The certified branch contains the closed
Canvas owner patch, exact ref/session/frame/history binding, and a separate bounded
runtime sidecar; it never contains a full document. Preload parses the owner codecs
without constructing or modifying authority.
Targeted resource hydration carries the exact mounted Canvas `ref`, session id, and
a bounded unique exact-node incarnation set. Preload validates that closed field set
and never derives, drops, or widens its lease scope.
Pointer-originated resource adds may carry only the closed `center | top-left`
anchor-origin marker. Preload validates and forwards it without calculating card
geometry; Main and Canvas remain authoritative for final resource size and placement.
`convax.desktop-ipc/47` resource-add results may carry only the unchanged validated
Canvas-certified patch, its exact ProjectIndex-derived resource-hierarchy delta,
and optional prepared-runtime sidecar whose ids belong to that patch's exact
returned created-node set. Full projections carry an identity-bound complete or
explicitly unavailable hierarchy snapshot. Preload uses Canvas's strict closed
codecs and never accepts native paths or constructs a classification. Stale hydration requests
carry the originating session and a bounded unique exact-node incarnation set;
responses must contain exactly the corresponding bounded runtime patches. Preload
rejects unknown fields, malformed runtime state, duplicate/partial ids and
whole-document-shaped payloads; an intentionally empty prepared-runtime sidecar is
valid because its loss cannot reverse the authoritative mutation.

## Validation

- Run `bun typecheck && bun test` from `packages/desktop`.
- Run focused preload/IPC compatibility tests.
- Run `bun run build`.
- Run `bun run smoke:open-project` when Project, Canvas persistence, or startup IPC
  changes.
- Run root `bun check` for public IPC or composition changes.
