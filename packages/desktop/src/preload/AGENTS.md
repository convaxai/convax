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
- Keep Project and Canvas references portable and scoped. Never translate them into
  native paths in Preload.
- Translate cancellable operations into explicit cloneable start/cancel messages.
  Do not treat the opaque operation id as authority or expose a Main `AbortSignal`.
- Keep adapters stateless apart from listener registration and deterministic
  disposal. Remove IPC listeners when the owning subscription or window is
  disposed.
- Preserve `contextIsolation`, sandboxing, disabled Node integration, and the
  smallest possible exposed surface.

Read [`docs/architecture.md` §10](../../../../docs/architecture.md#10-electron-boundary)
for every bridge change. Also read the routed capability document from the root and
Desktop contracts; Preload must not simplify or widen its semantics.

## Cross-process changes

An incompatible bridge change updates Main, Preload, Renderer,
`desktopProtocolVersion`, and compatibility tests together. Keep authoritative load
and revision-bound Canvas commands; never add whole-document save or
renderer-supplied native authority.

## Validation

- Run `bun typecheck && bun test` from `packages/desktop`.
- Run focused preload/IPC compatibility tests.
- Run `bun run build`.
- Run `bun run smoke:open-project` when Project, Canvas persistence, or startup IPC
  changes.
- Run root `bun check` for public IPC or composition changes.
