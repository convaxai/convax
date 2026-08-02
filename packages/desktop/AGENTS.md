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

Packaged Main and preload code must be self-contained JavaScript bundles. Disable
automatic dependency externalization, permit only Electron and Node built-ins as
runtime externals, and fail the build when another bare import remains. Never stage
or copy a `node_modules` tree into the application archive. Keep the packaged Main
entry in CommonJS so Electron Vite does not inject its ESM compatibility shim into
bundled source strings.

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
  Image/video replacement cards may persist that override. A text card keeps
  image/video model and tool-option state isolated by output only for the mounted
  composer; it never persists one owner override across those outputs.
- Main owns live generation coordination and writes node-targeted run state only
  through Canvas application services. Main never asks renderer to flush, lock,
  approve, or arbitrate a Main mutation; committed revision invalidation and reload
  are fallible projection work. Renderer components hydrate and display that state;
  mounting, selection and panel lifetime must never become task ownership or
  implicit cancellation. A terminal service-outage message is Main-authored from
  the validated service display name and must remain bounded; raw sidecar/native
  diagnostics never enter Canvas or renderer state.
- Card-scoped Agent and Generate conversations preload only direct incoming Canvas
  file nodes as removable `@` references. Keep the owning card separate as locked
  conversation context or the replacement target; never infer it or an outgoing
  neighbor as an input. Text-card visual generation creates exactly one separate
  pending image/video node and uses the text owner only as its constrained relation
  anchor; the owner's body is not prompt context unless it is separately supplied
  through an admitted incoming node. Revalidate generation mentions against Main's
  live incoming edges before execution.
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
  and toolbar registries. Standalone Skills remain independently managed.
  `convax.plugin/8` `contributes.skills` directories are owned immutable closure
  content selected by one ActiveSet; they are never copied into the standalone
  Skill root and need no second ownership journal. Desktop passes only their leased
  absolute directories through the generic Agent Runtime Skill-path port. No Skill
  grants Plugin or native permission, and `@convax/agent-runtime` must not learn
  Plugin identity. Do not create a generic extension framework.
- A v8 remote Agent MCP is declared by the installed Plugin but connected by
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
  bytes, publish them in the complete immutable closure, and load only the Hook from
  the leased ActiveSet through the generic Agent runtime resolver. Sort by Plugin
  id, skip unavailable or unauthorized modules, and append the host protected-path
  guard last. The runtime lease retains superseded snapshots until the old OpenCode
  generation has disposed. Only static
  `node:`/`bun:` imports may remain; require valid ESM with an exported Plugin entry
  and reject CommonJS globals, runtime module loaders, dynamic imports and every
  unbundled dependency.
  Default/background provisioning must never authorize new Hook bytes and must
  recheck the parsed publication candidate rather than catalog metadata alone.
- Startup installs every member of the product-lock-verified Builtin bundle before
  applying the target-specific Official preinstall policy. Both paths use the
  normal installation transaction. Builtin installation never grants execution
  authority. An exact preinstall with `setup: automatic` additionally uses the
  normal durable setup transition to authorize only its verified managed Tool
  companion; it must reject PATH fallback, Hooks, Services, extra Plugin
  capabilities, credentials, and any source/version/target mismatch. Refreshing
  the fixed Official source revalidates the packaged product closure but cannot
  silently widen or replace that grant; never pass its reserved identity to the
  user Network Marketplace manager.
- A user-confirmed Marketplace Plugin install/update and an explicit Local Plugin
  import publish the exact execution authorization with the immutable snapshot in
  one transition. They never require a second Marketplace setup click. Keep
  integrity/authorization mismatch distinct from setup-required state: missing or
  changed snapshot bytes route to exact-source reinstall/update, not setup.
- For a static Web Plugin, derive that authorization from the exact capability
  contract, package artifact, source identity and version even when no companion or
  Hook exists. Startup may backfill a missing Marketplace grant only for an existing
  InstallRecord whose id, version and source match the current ActiveSet snapshot.
  Every mismatch remains fail-closed and no Plugin may expose `Complete setup`.
- Validate Plugin-owned Skill paths and global names while building the immutable
  ActiveSet. One ActiveSet compare-and-swap publishes the package, Skill, Hook,
  companion and inter-Plugin dependency decision together. Do not materialize owned
  Skills into the standalone Skill namespace, create a parallel ownership journal,
  or emulate the atomic switch through ordered directory renames. On failure, leave
  the prior ActiveSet current. Refresh Agent discovery only after a successful
  pointer switch; existing Agent instances retain the old leased paths until dispose.
- Publish each Plugin as one content-addressed immutable complete closure under
  `userData/plugin-installations`, then select exact snapshot digests through the
  single global ActiveSet CAS pointer. Render third-party Web entries only from a
  current leased snapshot in `sandbox="allow-scripts"` iframes. Never use `webview`,
  import Web Plugin JS, or expose Electron/Node. The separately authorized Hook is
  exact closure content and is never imported by Desktop.
- Fetch the official remote Plugin/Skill Registry only in main from its fixed
  origin. Renderer IPC carries a catalog id, never an arbitrary URL, path or digest.
  Verify monotonic catalog sequence, compatibility, size, SHA-256 and a bounded safe
  ZIP inventory, then publish through the same immutable snapshot installer used by
  every provisioning source. Source identity never becomes runtime privilege.
  Catalog UI may display validated package and current-host companion byte counts.
  Open an official GitHub Release only through id-only Plugin IPC that re-resolves
  the Registry package and constructs the canonical page in main.
- A remote Tool Plugin executable is an optional Registry companion admitted into
  the Plugin's complete immutable closure. Select only an exact
  `process.platform`/`arch` target, verify its deterministic Release URL plus
  declared size/SHA-256, and publish it before the ActiveSet switch.
  Treat only the exact `#!/usr/bin/env convax-bun` header as an interpreted
  companion and launch its verified snapshot through the app-owned shared Bun
  runtime. Do not infer this mode from Plugin identity, filename, or manifest text.
  Preserve the previous ActiveSet on failure. Runtime resolves only the companion
  recorded in the leased snapshot descriptor, revalidates exact path/size/SHA-256,
  and never falls back to a mutable PATH executable or a legacy authorization
  receipt. Missing or changed closure bytes fail closed and require reinstall.
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
  submitting/running node runs to `failed` and never repeats the call.
- Tool-custom generation controls come from only the MCP tool's current
  `tools/list.inputSchema`. Main may keep one bounded, display-only, in-memory
  session snapshot of concrete generation models and their projected controls:
  warm it asynchronously after startup provisioning, invalidate and warm it after
  Plugin or service lifecycle changes, single-flight each epoch, and serve the
  prior same-epoch snapshot while an age-triggered refresh runs. Never persist this
  snapshot or move its ownership to renderer storage. A window may retain one
  display-only projection shared by Agent and card composers, but composer remounts
  must reuse ready values, bounded age revalidation must refresh Main first, and
  every committed result must notify both surfaces without replacing Main authority.
  Revalidate the selected
  tool's live schema in Main immediately before execution and never allow projected
  controls to replace the fixed generation-call envelope. Agent LLM provider
  admission is not display state and must continue to use live, fail-closed service
  status.
- One required top-level bounded string select on a manifest-declared model tool may
  explicitly opt into `x-convax-role: generation-model-id`. Check the owning service
  first, then let Main project its choices as concrete opaque model selections.
  `describeTool` must omit that selector, and preparation must reload the live schema,
  reject stale choices and bind the value without accepting a renderer override.
  Unmarked fields remain ordinary custom controls; do not guess by field name or
  branch on Plugin/provider identity.
- Keep the Agent-selected generation model as the user-global renderer default.
  A generation model is available only when its owning Plugin contributes the same
  model through a service and Main's bounded status check admits that service into
  the current display snapshot. Missing, disconnected, attention, unknown,
  timed-out, or invalid service status hides that service's models;
  service-independent operations remain manifest-driven. Preparation and dispatch
  must recheck live service availability even when the picker uses a cached
  snapshot. If no model is available, Agent and card composers route to Services
  and never synthesize an `auto` option. A card's output-scoped available model
  catalog remains visible regardless of its current `@` inputs. Non-empty text
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
- V8 Project/Canvas RPC is owned by one transport-neutral main broker. Bind every
  connection to the exact installed manifest identity and a host-issued Project
  scope; revalidate identity, grants and the live Canvas catalog on every call.
  Web MessagePorts and verified Tool sidecars may only adapt to this
  broker, never recreate its authorization or Canvas semantics.
- Bound each connection's concurrent requests and pending subscriptions before
  awaiting principal resolution. Serialize and deduplicate revision notifications,
  and recheck the exact Canvas remains in the live catalog before delivery.
- Web node methods remain bound to the exact MessagePort and Project/Canvas/node.
  Project/document methods are not authorized by node ownership: they carry an explicit
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
- Bind node-scoped v8 Plugin RPC to its MessagePort and exact Project/Canvas/node
  scope. Enforce the
  manifest allowlist and delegate to existing typed clients; never add a generic
  IPC/function-call escape hatch.
- Treat the closed, payload-free v8 `disconnect` envelope as lifecycle control for
  only its exact MessagePort connection. Close the existing renderer/Main
  connection and await that fixed disconnect when handling the envelope so Main
  revokes frame resources before dispatch completes; never accept caller-selected
  frame, Plugin, Project, Canvas, node, or connection identity.
- Treat connected media as a narrow input capability: derive it from direct incoming
  edges, use the bounded Main-owned typed Project-resource read, and reject stale or
  caller-selected paths.
- Give every connected-media session one owner-scoped abort lifecycle. Track each
  active audio/video response stream under that session so explicit close,
  frame/sender or Plugin revocation, Canvas invalidation, expiry cleanup, and
  dispose stop subsequent disk reads and release the stream-owned file descriptor.
  Already delivered or buffered bytes are not retractable. Image sessions hold
  bounded immutable memory snapshots: revocation blocks later fetches and
  validation, but cannot retract a response body already constructed from that
  snapshot.
- Connected-input metadata is pathless and read-only. Return only
  bounded direct-incoming media descriptors, send edge/source changes as
  invalidations, and never let an invalidation trigger upload or another external
  effect. Bytes still cross only the verified Main-owned tool staging boundary
  after explicit user intent.
- A manifest-declared direct-incoming Agent operation must require its owning Plugin
  node id, verify that node belongs to the same installed Plugin principal, and
  constrain every reference to live direct incoming edges before staging and again
  before execution. A return-delivery text operation reuses all normal execution
  guards but creates no Canvas resource or node.
- A return-delivery selection action is confirmation-only, has exactly
  one step, has no input binding, and accepts the exact image or video role declared
  by its target. Project one such action only while Main admits the exact installed,
  version-bound, authorized and enabled operation. Flush the authoritative Canvas,
  revalidate one Project-backed selected node, and cross cancellation before
  staging; never turn this into a provider-specific renderer call.
- Grant fullscreen or any future iframe feature-policy exception only when the
  installed manifest declares it; keep all unrelated denials unchanged.
- Keep connected image sessions in Main behind the generated
  `canvas.inputs.image.open`/`canvas.inputs.image.close` declarations and
  `canvas.connectedImages.read` grant. Resolve only opaque keys from the owning
  node's direct incoming edges, reuse the Project-owned stable image reader,
  perform bounded native decode validation, and revalidate the exact frame,
  Canvas revision, edge and resource identity after asynchronous work. Issue and
  revoke the handle against the sender/frame, but treat protocol GET/HEAD as a
  high-entropy bearer capability because Electron does not expose a trustworthy
  frame principal at that boundary; revalidate the live Plugin principal and
  direct edge on every fetch. Return only that revocable opaque Host URL and safe
  metadata, never image bytes over renderer IPC or a native path. Never widen
  `canvas.inputs.open` beyond its declared audio/video stream contract.
- Project `convax-connected-media:` into Plugin CSP per exact API: image open
  controls only `img-src`, while audio/video open controls only `media-src`.
  Missing declaration, missing grant and legacy schemas keep both closed; neither
  API widens `connect-src`.
- Treat custom URI schemes as fixed Host composition adapters, never as a Plugin
  registration surface or global resource service. Keep verified Plugin assets,
  trusted-renderer Project resources, connected-media bearer sessions and Pet
  assets in their distinct authority owners. If a second independent temporary
  bearer protocol is admitted, extract only a headless session kernel for codec,
  constant-time token verification, TTL, range, capacity and revocation; do not
  move domain authorization or resource validation into it.
- Project `convax-pet-asset:` into `img-src` only for the exact Pet overlay or
  settings document of a validated v8 snapshot that both contributes
  `convax.pet-host/1` and holds `pet.custom.manage`. Missing contribution, missing
  grant, legacy schema and unrelated Plugin documents stay closed. Do not widen
  `media-src` or `connect-src`, and do not branch on a concrete Pet Plugin id.
- Builtin and preinstalled are provisioning-source policies, never runtime
  privilege classes. They publish the same v8 snapshots, use the same grants and
  broker, and may not enable native behavior through concrete ids or host-authored
  provenance flags. Native external-editor behavior belongs to a verified generic
  companion Tool contribution in `convax-plugins`; platform support and failure
  derive from its target closure, not a Desktop product branch.
- Native Canvas media drag-out is destination-neutral and uses Electron's native
  `webContents.startDrag`; do not special-case Finder or drive third-party application UI. Renderer
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

Marketplace authority is Main-only. Persist Network and Local source graphs with
strict SourceKeys and accepted sequence/revision high-water decisions; cache bytes
are repairable only from an exact accepted catalog. Bind preview, confirmation and
install tokens to the invoking `webContents`, and never expose SourceKeys, receipts,
native paths, transport choices or raw failures to renderer. Installation must
preflight same-source identity, serialize its participants and leave a durable
recovery transition before any canonical Plugin, Skill or MCP publication side
effect. Network bytes use the pinned HTTPS transport (all DNS answers public,
socket address pinned and every redirect revalidated). Managed-stdio launches only
verified private snapshots with the app-owned absolute Bun runtime and a fixed
environment; product actions are the intersection of validated declarations,
advertised tools, fixed host handlers and durable grants. Packaging consumes only
the verified Marketplace product lock and its exact immutable bytes; it must not
reintroduce a mutable default-capability download.
