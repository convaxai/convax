# Desktop Package Contract

Desktop is the Electron composition root. It may depend on every domain package, but
it must not become the permanent home of reusable domain rules.

Desktop is also not the authoring repository for concrete Plugins, Skills, or
companion tools. Their source belongs in the sibling `convax-plugins` repository.
Do not add a new integration under `resources/plugins`; the existing directories
there are legacy/bootstrap migration inputs. Desktop may consume verified Registry
artifacts, mechanically generated bootstrap bytes, and clearly synthetic generic
test fixtures, but it must not keep a hand-maintained copy of a concrete Plugin.

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
- Main owns live generation coordination and writes node-targeted run state only
  through Canvas application services. Main never asks renderer to flush, lock,
  approve, or arbitrate a Main mutation; committed revision invalidation and reload
  are fallible projection work. Renderer components hydrate and display that state;
  mounting, selection and panel lifetime must never become task ownership or
  implicit cancellation.
- Card-scoped Agent and Generate conversations preload only direct incoming Canvas
  file nodes as removable `@` references. Keep the owning card separate as locked
  conversation context or the replacement target; never infer it or an outgoing
  neighbor as an input. Revalidate generation mentions against Main's live incoming
  edges before execution.
- Agent tools are thin adapters over Canvas application/business and view ports.
  Host Project scope is authoritative; document tools may select only a Canvas in
  that Project's live catalog, while view tools resolve the mounted active Canvas.
  Reject stale revisions against Main's authoritative document. Never ask renderer
  to flush, lock, or approve a Main read/write; publish committed revisions and let
  renderer reload as a fallible projection.
- Renderer and Agent never edit private Canvas/Project JSON. Use typed clients and
  repository/application services. Native Project-file and managed-asset access uses
  one narrow typed, scoped resource bridge.
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
- A v6 remote Agent MCP is declared by the installed Plugin but connected by
  OpenCode. Desktop validates and maps the declaration to a stable server key,
  refreshes the lazy Agent configuration after Plugin publication, and exposes only
  Plugin-id-based connect actions. Never send renderer-supplied URLs, headers,
  server names, callbacks, or credentials to the Agent runtime, and never add a
  provider-specific branch. Expose Agent MCP connection state to the renderer only as
  a display-only Plugin-id status; preserve distinct authentication, client-setup,
  failed, disabled, unavailable, and connected outcomes. After authorization,
  invalidate directory-scoped OpenCode capabilities so existing Project instances
  reconnect. “Use in Agent” only navigates/focuses and may attach the sole owned
  Skill; it does not execute a tool or guess among multiple Skills.
- A top-level `hooks` field declares one self-contained OpenCode Plugin module.
  Treat it as executable Agent code, not a Web entry or Skill. During explicit
  install/update, bind consent to the normalized manifest and exact `.js`/`.mjs`
  bytes, publish a private immutable snapshot in the same package transaction, and
  load only that snapshot through the generic Agent runtime resolver. Resolve under
  the per-Plugin mutation lock, sort by Plugin id, skip changed/unauthorized modules,
  and append the host protected-path guard last. Retain superseded snapshots until
  the old OpenCode generation has disposed, then reconcile them. Only static
  `node:`/`bun:` imports may remain; require valid ESM with an exported Plugin entry
  and reject CommonJS globals, runtime module loaders, dynamic imports and every
  unbundled dependency.
  Never wait for Agent hard refresh while holding the per-Plugin mutation lock:
  Agent startup resolves Hooks under that lock. Invalidate first without the lock,
  then reacquire it to converge current receipts and remove obsolete snapshots.
  Default/background provisioning must never authorize new Hook bytes and must
  recheck the parsed publication candidate rather than catalog metadata alone.
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
- Install Plugins as validated packages under `userData`. Render third-party Web
  entries only in `sandbox="allow-scripts"` iframes served by the contained Plugin
  asset protocol. Never use `webview`, import Web Plugin JS, or expose Electron/Node.
  The separately authorized Hook snapshot is main-owned Agent configuration and is
  never imported by Desktop.
- Fetch the official remote Plugin/Skill Registry only in main from its fixed
  origin. Renderer IPC carries a catalog id, never an arbitrary URL, path or digest.
  Verify monotonic catalog sequence, compatibility, size, SHA-256 and a bounded safe
  ZIP inventory, then reuse the existing Plugin and managed-Skill installers. A
  remote package never enters the trusted built-in update/provenance path.
  Catalog UI may display validated package and current-host companion byte counts.
  Open an official GitHub Release only through id-only Plugin IPC that re-resolves
  the Registry package and constructs the canonical page in main.
- A remote Tool Plugin executable is an optional Registry companion, never a file
  inside the static Plugin ZIP. Select only an exact `process.platform`/`arch`
  target, verify its deterministic Release URL plus declared size/SHA-256, and
  publish immutable bytes below private versioned `userData/plugin-companions`.
  Treat only the exact `#!/usr/bin/env convax-bun` header as an interpreted
  companion and launch its verified snapshot through the app-owned shared Bun
  runtime. Do not infer this mode from Plugin identity, filename, or manifest text.
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
- For immediate Plugin generation feedback, create a host-owned pending Canvas
  resource in Main before `tools/call`, then replace or fail that exact guarded node.
  The sandboxed caller may opt into the mode but cannot choose a node id or target;
  cancellation and sidecar failures keep a safe visible error and never revive a
  removed or edited placeholder. Renderer refresh/reveal runs asynchronously and
  cannot delay the paid call, replacement, failure mark, or returned domain result.
- Keep host `operationId` and sidecar `taskId` distinct. Task creation receipts use
  the validated, per-call structured generation lifecycle notification; never parse
  logs, progress text or stderr. Persist only a bounded host-safe opaque task handle.
  The generic recovery contract is a durable Long-Running Operation surface with
  fixed get/wait/cancel/result/acknowledge methods. Main implements the
  Scheduler–Agent–Supervisor pattern: it schedules and persists, the verified
  sidecar executes, and startup reconciliation supervises recovery. Legacy tools may
  omit the task receipt or LRO contract; startup then changes orphaned
  submitting/running node runs to `interrupted` and never repeats the call.
- Tool-custom generation controls come from only the explicitly selected MCP tool's
  current `tools/list.inputSchema`. Lazily project bounded top-level scalar fields,
  never raw JSON Schema, across preload; revalidate them in Main immediately before
  execution and never allow them to replace the fixed generation-call envelope.
- Keep the Agent-selected generation model as the user-global renderer default.
  A generation model is available only when its owning Plugin contributes the same
  model through a service and Main's bounded live status reports that service
  connected. Missing, disconnected, attention, unknown, timed-out, or invalid
  service status hides that service's models; service-independent operations remain
  manifest-driven. If no model is available, Agent and card composers route to
  Services and never synthesize an `auto` option. A card's output-scoped available
  model catalog remains visible regardless of its current `@` inputs. Non-empty text
  `@` inputs are authoritative prompt context:
  Main reads and appends their text in order, and they never enter model
  `acceptedInputs` or the sidecar reference array. Media `@` inputs remain typed
  references. Cards without an owning-node override prefer a compatible
  matching Agent default, then the first compatible model; if none accepts the
  current inputs, they still show the matching Agent default or first available model
  and block execution until the inputs or model change. A persisted override requires
  an exact available output match and remains visible when only its inputs are
  incompatible; stale or output-mismatched ids fail closed. A card selection writes
  only the node override through Canvas and never mutates the Agent default in reverse.
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
- Main serializes document persistence through repository CAS and rechecks
  Agent/Tool cancellation at the final durable checkpoint. Renderer reconciliation
  is never a lease or commit prerequisite and its failure cannot report a durable
  mutation as failed.
- Main reserves inactive documents as well as mounted editors during an external
  operation. Block Project/Canvas navigation while a reservation exists, cancel a
  timed-out prepare explicitly, and propagate Agent/Tool cancellation to the final
  durable checkpoint. Renderer reconciliation failure after commit must not report
  the durable mutation as failed.
- Bind legacy node-scoped Plugin RPC to its MessagePort and exact Project/Canvas/node
  scope. Enforce the
  manifest allowlist and delegate to existing typed clients; never add a generic
  IPC/function-call escape hatch.
- Treat connected media as a narrow input capability: derive it from direct incoming
  edges, use the bounded Main-owned typed Project-resource read, and reject stale or
  caller-selected paths.
- A v6 connected-input metadata capability is pathless and read-only. Return only
  bounded direct-incoming media descriptors, send edge/source changes as
  invalidations, and never let an invalidation trigger upload or another external
  effect. Bytes still cross only the verified Main-owned tool staging boundary
  after explicit user intent.
- A manifest-declared direct-incoming Agent operation must require its owning Plugin
  node id, verify that node belongs to the same installed Plugin principal, and
  constrain every reference to live direct incoming edges before staging and again
  before execution. A return-delivery text operation reuses all normal execution
  guards but creates no Canvas resource or node.
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
  automation. Export only image/video nodes backed by valid typed Project resource
  references; main reloads the active Canvas, checks
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
and `bun run smoke:open-project` for Project open, persistence, IPC, migration or
breaking-cutover work.
