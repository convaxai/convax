# Desktop Package Contract

Desktop is the Electron composition root. It may depend on every domain package, but
it must not become the permanent home of reusable domain rules.

## Process boundaries

- `main`: Electron/native I/O, trusted IPC, Project Node adapters, repositories,
  Agent runtime and tool providers.
- `preload`: narrow typed `window.convax` bridge; no business state.
- `renderer`: React shell, controller instances, cross-domain coordinators, host view
  adapters and user preferences; no Node/Electron imports.

## Composition rules

- Keep Project lifecycle, Project Files, Project Canvas, Canvas and Agent bridge/IPC
  namespaces separate. Never re-add file methods to `window.convax.projects`.
- Derive active Canvas/file from Workbench Surface only. Project Canvas owns catalog
  CRUD; Desktop coordinators own save-guard, fallback, rollback and preference flows.
- Workbench layout owns generic resize/collapse state. Desktop owns concrete sizes,
  viewport constraints, pointer/keyboard events, CSS animation and localStorage.
- Agent tools are thin adapters over Canvas application/business and view ports.
  Host scope is authoritative; arguments cannot select another Project or Canvas.
  Resolve the live active Canvas from the mounted view, inject it at the adapter, and
  reject stale revisions rather than accepting a model-selected Canvas id.
- Renderer and Agent never edit private Canvas/Project JSON. Use typed clients and
  repository/application services. Only managed assets use the scoped file bridge.
- Incompatible main/preload/renderer bridge changes update all three layers, tests,
  and `desktopProtocolVersion` together.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, and trusted
  sender validation.
- Treat OpenCode Skills and Convax Plugins as distinct existing concepts. Skills use
  the Agent runtime's native discovery; Plugins compose existing Canvas file-renderer
  and toolbar registries. A companion Skill is independently installed/removed,
  describes workflows and selects tools; it grants no Plugin or native permission.
  Do not create a generic extension framework.
- Install Plugins as validated static packages under `userData`. Render third-party
  entries only in `sandbox="allow-scripts"` iframes served by the contained Plugin
  asset protocol. Never use `webview`, import Plugin JS, or expose Electron/Node.
- Fetch the official remote Plugin/Skill Registry only in main from its fixed
  origin. Renderer IPC carries a catalog id, never an arbitrary URL, path or digest.
  Verify monotonic catalog sequence, compatibility, size, SHA-256 and a bounded safe
  ZIP inventory, then reuse the existing Plugin and managed-Skill installers. A
  remote package never enters the trusted built-in update/provenance path.
- Bind Plugin RPC to its MessagePort and exact Project/Canvas/node scope. Enforce the
  manifest allowlist and delegate to existing typed clients; never add a generic
  IPC/function-call escape hatch.
- Treat connected media as a narrow input capability: derive it from direct incoming
  edges, use the bounded Main-owned managed-asset read, and reject stale or
  caller-selected paths.
- Grant fullscreen or any future iframe feature-policy exception only when the
  installed manifest declares it; keep all unrelated denials unchanged.
- Trusted built-in native integrations stay in main and are never loaded from the
  static Plugin package. Reserve their catalog ids from ordinary imports and enable
  them only after validating host-authored provenance plus the exact catalog bundle,
  never manifest id/version alone. Renderer and Agent adapters share one narrow
  service, pass only host-scoped ids/revisions, and never expose native paths to
  preload or a sandboxed frame. One-time default Plugin and companion-Skill installs
  need independent durable receipts so either uninstall is respected.
- Startup may claim an existing marker-free built-in only when its complete
  canonical digest matches the current catalog bundle or an explicit historical
  `(version, digest)` allowlist. Never reinstall a missing non-default Plugin,
  accept a case-variant provenance path, trust marker text without rehashing files,
  or replace different bytes at the same version.
- JianYing native actions and Agent tools currently run on macOS only. Keep an
  explicit Windows WIP adapter that fails closed as unsupported; never substitute UI
  automation. Export only image/video nodes backed by managed Project references
  under `.convax/assets`; main reloads the active Canvas, checks
  revision/node/MIME/regular-file containment, and resolves or stages native paths
  after that validation.
- Dispatch JianYing imports through its macOS Deep Link, never Accessibility, Apple
  Events, JXA or `AXPress`. Serve staged media only from a temporary
  `127.0.0.1` server on a random port, with one unguessable opaque-token route per
  item; the payload may contain only those URLs. Keep the server alive until every
  requested item has fully transferred, then close it, or close it on bounded
  failure. The verified Deep Link adds media to both the material panel and timeline
  and has no panel-only parameter.
- New-draft export from JianYing's home/not-running state must dispatch the native
  force-create route and prove that a new draft directory became active before
  dispatching the current-draft material import. Active-editor-to-new is an explicit
  macOS WIP and must fail before native mutation, asking the user to return JianYing
  home and retry. Never rely on editor-scene `new_draft`, silently reuse the old
  draft, or send media before the destination identity is verified.
- A cancellable renderer-to-main operation gets a sender-scoped opaque `operationId`.
  Keep the live Canvas `AbortSignal` in renderer and forward cloneable start/cancel
  messages over explicit IPC. Abort queued/filesystem work on renderer
  destruction/disposal. Cancellation before Deep Link dispatch is safe; after
  dispatch may have produced a side effect, finish the bounded transfer and never
  retry an unknown/partial outcome automatically. The id correlates lifecycle only
  and cannot select authority or scope.

Run `bun typecheck && bun test`. Run `bun run build` for main/preload/renderer changes
and `bun run smoke:open-project` for Project open, persistence, IPC or migration work.
