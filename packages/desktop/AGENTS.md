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
  Host scope is authoritative; arguments cannot select another Project.
- Renderer and Agent never edit private Canvas/Project JSON. Use typed clients and
  repository/application services. Only managed assets use the scoped file bridge.
- Incompatible main/preload/renderer bridge changes update all three layers, tests,
  and `desktopProtocolVersion` together.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, and trusted
  sender validation.
- Treat OpenCode Skills and Convax Plugins as distinct existing concepts. Skills use
  the Agent runtime's native discovery; Plugins compose existing Canvas file-renderer
  and toolbar registries. Do not create a generic extension framework.
- Install Plugins as validated static packages under `userData`. Render third-party
  entries only in `sandbox="allow-scripts"` iframes served by the contained Plugin
  asset protocol. Never use `webview`, import Plugin JS, or expose Electron/Node.
- Bind Plugin RPC to its MessagePort and exact Project/Canvas/node scope. Enforce the
  manifest allowlist and delegate to existing typed clients; never add a generic
  IPC/function-call escape hatch.
- Treat connected media as a narrow input capability: derive it from direct incoming
  edges, use the bounded Main-owned managed-asset read, and reject stale or
  caller-selected paths.
- Grant fullscreen or any future iframe feature-policy exception only when the
  installed manifest declares it; keep all unrelated denials unchanged.

Run `bun typecheck && bun test`. Run `bun run build` for main/preload/renderer changes
and `bun run smoke:open-project` for Project open, persistence, IPC or migration work.
