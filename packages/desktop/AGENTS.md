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

- Keep Project lifecycle, Project Files, Project Canvas, Canvas, generation and Agent
  bridge/IPC namespaces separate. Never re-add file methods to `window.convax.projects`.
- Derive active Canvas/file from Workbench Surface only. Project Canvas owns catalog
  CRUD; Desktop coordinators own save-guard, fallback, rollback and preference flows.
- Create Project injects the user-visible `Documents/Convax` parent and never opens a
  native folder picker; Open Project alone lets the user bind an existing directory.
  Renderer and preload never receive or choose the default native creation path.
- Workbench layout owns generic resize/collapse state. Desktop owns concrete sizes,
  viewport constraints, pointer/keyboard events, CSS animation and localStorage.
- The Agent generation-tool preference is the host default for new file-card
  conversations. A card may persist its own opaque tool-id override, but card
  changes never write back to the Agent preference or create a second catalog.
- Agent tools are thin adapters over Canvas application/business and view ports.
  Host Project scope is authoritative; document tools may select only a Canvas in
  that Project's live catalog, while view tools resolve the mounted active Canvas.
  Reject stale revisions and pass every document read/write through the renderer
  flush/lock/reload barrier so an active editor cannot overwrite external work.
- Renderer and Agent never edit private Canvas/Project JSON. Use typed clients and
  repository/application services. Only managed assets use the scoped file bridge.
- Desktop may label and contribute the native media drag source, but Canvas owns the
  persistent drag-out mode and selection interaction. Keep native staging, live
  Project/Canvas/selection revalidation and Electron `startDrag` in Main; renderer
  snapshots must publish the complete multi-selection synchronously.
- Incompatible main/preload/renderer bridge changes update all three layers, tests,
  and `desktopProtocolVersion` together.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, and trusted
  sender validation.
- Treat OpenCode Skills and Convax Plugins as distinct existing concepts. Skills use
  the Agent runtime's native discovery; Plugins compose existing Canvas file-renderer
  and toolbar registries. Standalone Skills and the legacy top-level `skill` field in
  `convax.plugin/1` through `/3` remain independently managed. A
  `convax.plugin/4` and later `contributes.skills` entries are owned by their Plugin:
  Desktop keeps
  the ownership binding and atomically publishes, updates, rolls back, and removes
  the materialized Skill with that Plugin. Owned Skills are visible as provided by
  the Plugin but cannot be managed separately. No Skill grants Plugin or native
  permission, and `@convax/agent-runtime` must not learn Plugin identity. Do not
  create a generic extension framework.
- Plugin-owned Skill publication has three ordered phases. Prepare validates and
  stages without exposing new bytes. `publish` rechecks external names and journals
  exact rollback receipts before the Plugin directory switch. `activate` publishes
  ownership before Skill bytes after the switch. `commit` records the forward
  decision before cleanup. Startup converges exact remnants to the validated Plugin
  package selected by Plugin-package recovery; changed bytes and unknown backups fail
  closed. A v1-v3 companion transfers to v4-or-later ownership only after an exact old-package
  byte match. Package recovery must succeed before any dependent Skill journal is
  consumed. Serialize same-id Plugin install/update/uninstall publications, and
  serialize owned-Skill transactions with every standalone managed Skill mutation;
  they share one filesystem namespace. Agent discovery refresh uses that coordinator
  too. A surviving ownership binding reserves its Skill name even when materialized
  bytes are missing; a pending journal reserves both previous and next names and
  blocks standalone mutation until recovery.
- A dependent publication may roll back only after every Plugin-package rollback
  rename succeeds. Any incomplete install, update, built-in update, or uninstall
  rollback must call `deferToRecovery`: retain Skill journals, authorization receipts,
  and managed companions, release process-local locks, and surface a typed
  recovery-required error. Startup selects the canonical Plugin package first, then
  converges all retained state. Default provisioning must not downgrade this error
  to an offline failure or continue opening the application with a pending journal.
- Treat owned-Skill commit as the fallible forward decision. Only after it succeeds
  may executable-authorization and backup cleanup run; cleanup is best-effort and
  must not roll a current Plugin back. Recover validated uninstall tombstones by
  finishing removal, never by restoring them. Refresh Agent Skill discovery once
  startup default provisioning has completed, including its failure path.
- Install Plugins as validated static packages under `userData`. Render third-party
  entries only in `sandbox="allow-scripts"` iframes served by the contained Plugin
  asset protocol. Never use `webview`, import Plugin JS, or expose Electron/Node.
- Fetch the official remote Plugin/Skill Registry only in main from its fixed
  origin. Renderer IPC carries a catalog id, never an arbitrary URL, path or digest.
  Verify monotonic catalog sequence, compatibility, size, SHA-256 and a bounded safe
  ZIP inventory, then reuse the existing Plugin and managed-Skill installers. A
  remote package never enters the trusted built-in update/provenance path.
- A remote Tool Plugin executable is an optional Registry companion, never a file
  inside the static Plugin ZIP. Select only an exact `process.platform`/`arch`
  target, verify its deterministic Release URL plus declared size/SHA-256, and
  publish immutable bytes below private versioned `userData/plugin-companions`.
  Preserve the previous Plugin/companion pair on failure, clean orphans on
  update/uninstall/startup, and keep explicit `PATH` commands as the fallback.
  Installation must resolve and fingerprint either the exact managed artifact or
  the exact PATH executable and transactionally coordinate a host-owned receipt
  with Plugin publication. A crash or cleanup failure may leave an inert orphan,
  which runtime rejects and startup reconciliation removes. Runtime never prompts:
  it silently verifies the same
  manifest, binding kind, real path, size and SHA-256 or fails closed and requests
  reinstall. A required managed artifact must never fall back to PATH.
  Launch snapshots belong in a separate private runtime temporary directory and
  must never add files to or otherwise mutate the immutable companion installation.
- Plugin service settings reuse that same Tool Plugin process/runtime. Keep actions
  as a manifest-declared subset of fixed `service.*` MCP tools, validate structured
  status in main, and expose one fixed preload method per action. Never return raw
  MCP content, secrets, native paths or authorization URLs to renderer settings.
- Generation `tools/call` has no host-imposed overall deadline. Keep initialization,
  discovery and service/control-plane calls bounded, but let the sidecar own queued
  vendor state until a terminal result or caller cancellation. Agent transport must
  relay content-free MCP progress so its timeout remains an inactivity guard rather
  than an absolute generation cutoff.
- Tool-custom generation controls come from only the explicitly selected MCP tool's
  current `tools/list.inputSchema`. Lazily project bounded top-level scalar fields,
  never raw JSON Schema, across preload; revalidate them in Main immediately before
  execution and never allow them to replace the fixed generation-call envelope.
- Keep the Agent-selected generation model as the user-global renderer default.
  Cards without an owning-node override inherit it only when its output matches the
  owning card's intrinsic media kind. A direct card catalog contains only tools for
  that intrinsic output; mismatched Agent defaults and persisted overrides fail
  closed. A card selection writes only the node override through Canvas and never
  mutates the Agent default in reverse.
- Browser-cookie service authorization is a main-only two-phase fixed exchange.
  Use a fresh non-persistent sandboxed Electron session. Choosing Configure and
  personally completing sign-in is explicit authorization: an allowlisted cookie
  add/update checks the exact HTTPS origin and continues automatically, with no
  second confirmation dialog. Closing the window completes only if that check finds
  an approved cookie and otherwise cancels. Preserve real opener semantics for HTTPS
  sign-in popups while forcing every child and descendant onto the same temporary
  session and the same sandbox, navigation, permission and Node-denial guards. A
  child close must never settle the root authorization. Independently re-read and
  filter only allowlisted cookies before the one-shot
  `service.authorization.complete`
  continuation bound to the unchanged Plugin runtime. Before clearing the temporary
  Chromium session, atomically checkpoint only that exact-origin allowlisted Cookie
  envelope in private Main state, bound to the manifest plus verified executable
  identity and a short recovery lifetime. Remove it after sidecar persistence, explicit cancel/sign-out, or Plugin
  change; preserve it across an interrupted handoff so retry never requires another
  login. Never persist a browser profile or expose the request, URL or cookies
  through IPC. Drain the checkpoint/sidecar handoff before quit disposes the shared
  Tool Plugin runtime.
- V5 Project/Canvas RPC is owned by one transport-neutral main broker. Bind every
  connection to the exact installed manifest identity and a host-issued Project
  scope; revalidate identity, grants and the live Canvas catalog on every call.
  Web MessagePorts, verified Tool sidecars and built-ins may only adapt to this
  broker, never recreate its authorization or Canvas semantics.
- Bound each connection's concurrent requests and pending subscriptions before
  awaiting principal resolution. Serialize and deduplicate revision notifications,
  and recheck the exact Canvas remains in the live catalog before delivery.
- Web node methods remain bound to the exact MessagePort and Project/Canvas/node.
  V5 document methods are not authorized by node ownership: they carry an explicit
  portable Canvas ref and use bounded geometry/structure projections or atomic
  resource-free transactions. Resource bytes/admission require a separate Project
  business capability and never ride the document transaction escape hatch.
- Main reserves inactive documents as well as mounted editors during an external
  operation. Block Project/Canvas navigation while a reservation exists, cancel a
  timed-out prepare explicitly, and propagate Agent/Tool cancellation to the final
  durable checkpoint. Renderer reconciliation failure after commit must not report
  the durable mutation as failed.
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
- Native Canvas media drag-out is destination-neutral and uses Electron's native
  `webContents.startDrag`; do not special-case Finder or drive JianYing UI. Renderer
  may hold only a short-lived sender-scoped opaque ticket. Main reloads the exact
  active selection, accepts only managed image/video/audio files, stages host-owned
  copies below its private drag directory, and removes abandoned or expired stages.
  Build the native drag preview before ticket publication from the first staged
  material, adding a bounded count badge for a multi-selection; synchronous
  `startDrag` must consume that prepared preview without renderer paths or bytes.
  Selection alone must not stage media: only an explicit held export-drag gesture
  may prepare. Modifier release, focus loss, cancel and scope change must abort an
  in-flight fallback copy.
- A cancellable renderer-to-main operation gets a sender-scoped opaque `operationId`.
  Keep the live Canvas `AbortSignal` in renderer and forward cloneable start/cancel
  messages over explicit IPC. Abort queued/filesystem work on renderer
  destruction/disposal. Cancellation before Deep Link dispatch is safe; after
  dispatch may have produced a side effect, finish the bounded transfer and never
  retry an unknown/partial outcome automatically. The id correlates lifecycle only
  and cannot select authority or scope.

Run `bun typecheck && bun test`. Run `bun run build` for main/preload/renderer changes
and `bun run smoke:open-project` for Project open, persistence, IPC or migration work.
