# Desktop Main Process Contract

This file applies to `packages/desktop/src/main/**` and extends the Desktop package
contract. Main is the trusted composition and native-adapter edge. It owns host
authority and lifecycle coordination, not reusable domain semantics.

## Owns

- Electron application/window lifecycle and native integrations.
- Packaged macOS/Windows update checks, native update UI, verified download,
  cancellation/retry, and installation lifecycle.
- Filesystem/network adapters, private host storage, trusted protocols, and IPC
  handlers.
- Project Node repositories and composition of Project, Canvas, Workbench, and Agent
  capabilities.
- Installed Marketplace/Plugin/Skill/MCP authority, immutable Plugin closures,
  ActiveSet selection and leases, verified executable lifecycle, and Agent runtime
  configuration.
- Main-owned cancellation, recovery, sender binding, and runtime disposal.

## Baseline rules

- Keep packaged Main as one self-contained CommonJS dependency bundle. Only Electron
  and Node built-ins may remain external; a bare package import or packaged
  `node_modules` dependency is a build failure.
- Call domain packages through exported typed ports. Do not implement Canvas,
  Project, Workbench, Marketplace-schema, or Agent-runtime invariants in Main.
- Main's Canvas application service/repository is the sole authoritative document
  writer. Use revision/CAS commands and transactions; never ask Renderer to flush,
  lock, approve, or arbitrate a Main read or mutation.
- Publish committed frame-digest invalidations after domain success. Session-local
  responses return the complete projection and accepted frame digest so Renderer
  can suppress the matching query while retaining a trailing remote refresh. Renderer reload,
  selection, reveal, or reconciliation is fallible projection work and cannot undo
  or misreport a durable mutation.
- Compose Project's stable resource reader with Electron's image decoder before a
  Canvas image-create command. Decode only the admitted Project file or verified
  managed blob, bound memory, fail closed to the Canvas default size, and never use
  renderer-supplied intrinsic dimensions as authority.
- Forward the closed resource anchor-origin marker with the prepared resource so
  Canvas can normalize a pointer center from the Main-authoritative final size.
  Main never computes viewport coordinates or accepts Renderer sizing authority.
- Bind every IPC, MessagePort, tool, and external-operation request to its trusted
  sender/principal and current Project/Canvas scope. Recheck permissions, identity,
  catalog membership, revision, target, and cancellation after awaited preparation
  and immediately before persistence or an external side effect.
- Treat the Web Plugin locale as bounded ephemeral connection presentation state.
  Accept it only from the trusted owning Renderer sender, emit changes only to that
  exact connection, and never persist it or use it for authorization/routing.
- Bound requests, queues, subscriptions, messages, staged bytes, retained receipts,
  diagnostics, and recovery state. Serialize mutations that share an identity or
  filesystem namespace.
- Bind UI semantic roots only to the originating renderer lease. Agent, Plugin and
  background commits invalidate mounted projections but never mutate renderer undo
  stacks. Resource commit delivery verifies the operation receipt against the live
  owner and returns `unavailable` for a stale lease without reversing the commit.
- Keep native paths and private storage behind typed scoped capabilities. Renderer,
  Preload, Agent tools, sandboxed frames, and companions never receive paths merely
  because Main resolved them.
- Treat caches as disposable and authoritative decisions as durable. Publish one
  content-addressed complete Plugin closure, then compare-and-swap the global
  ActiveSet. On failure, keep the prior ActiveSet current. Runtime leases bind exact
  active revisions, ActiveSet digests, and snapshot digests; ambiguity and changed
  bytes fail closed.
- Never reconstruct Plugin authority by scanning mutable package, Skill, Hook,
  companion, or authorization directories. Plugin-owned content resolves from the
  leased closure; standalone Skills retain their independent namespace.
- Plugin ids, providers, vendors, model names, and filenames are never behavior
  switches. Runtime behavior derives from validated manifests, advertised tools,
  verified bytes, fixed host handlers, and durable grants.
- Optional Plugin service usage history is a fixed bounded read projection. A
  missing or invalid history tool degrades to unavailable without evicting the
  sidecar or replacing a valid status; stale Plugin identity still fails closed.
- External execution uses the exact install-authorized and re-fingerprinted
  entrypoint or immutable host-owned snapshot. Terminate the owned process tree on
  disposal and fail closed when the platform cannot guarantee ownership.
- Registry-managed companions must match the exact host
  `process.platform`/`process.arch`, immutable URL, size, and SHA-256. A required
  managed artifact never falls back to `PATH`; the exact
  `#!/usr/bin/env convax-bun` header alone selects the app-owned Bun runtime.
- Do not impose an absolute deadline on accepted long-running generation work.
  Bound control-plane requests and inactivity, propagate progress/cancellation, and
  leave terminal execution state to the admitted LRO contract.
- Canvas-delivery selection actions use one bounded Main admission operation. Run
  tool lease/schema preflight before pending creation, resolve prior-step relations
  only from committed Canvas-owned ids, and keep every external call behind one
  gate until all independent pending nodes/runs are durable. The admission receipt
  is not a terminal result; sender teardown after it must not cancel retained work.
- Host-authored portable failures may use only bounded validated display data. Raw
  sidecar, native, filesystem, network, credential, and recovery diagnostics never
  enter Canvas state or renderer-safe projections.
- Admit development task identity only from the bounded Main environment contract.
  Bind it to an absolute task-id userData child before startup, own platform-native
  and window branding here, and ignore the entire mode when packaged. Renderer may
  receive the label and id only as non-authoritative presentation data.
- Keep application updates out of Preload and Renderer. Contact the one configured
  public HTTPS feed only from a packaged supported platform, expose bounded release
  facts through native UI, and use the updater's cancellation and signature/hash
  verification. Installation must await the shared Main shutdown drain; a failed
  preparation or installer start must preserve or relaunch the current version.
  Never read signing, notarization, storage, or publication credentials at runtime.

## Mandatory module routes

This process contract intentionally does not repeat every capability lifecycle.
For any matching change, read the full routed reference before planning or editing.

| Changed capability or filename theme                                          | Required contracts                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project-*`, `canvas-*`, resource publishing, managed assets, GC              | [`docs/architecture.md` §§4–6](../../../../docs/architecture.md#4-canonical-state), Project, Project Files, Canvas, and Workbench `AGENTS.md` files as applicable                                                                                              |
| `agent-*`, `canvas-agent-tools`, `composite-agent-tools`, OpenCode            | [`docs/architecture.md` §7](../../../../docs/architecture.md#7-agent-tools-and-skills) and [`packages/agent-runtime/AGENTS.md`](../../../agent-runtime/AGENTS.md)                                                                                              |
| Skill discovery/management, Plugin-owned Skills, Hook loading                 | [`docs/plugin-skill-platform.md`](../../../../docs/plugin-skill-platform.md), [`docs/architecture.md` §§7–8](../../../../docs/architecture.md#7-agent-tools-and-skills), and Agent Runtime contract                                                            |
| Agent MCP, managed MCP, OAuth, stdio runtime                                  | [`docs/architecture.md` “MCP Server runtime boundary”](../../../../docs/architecture.md#mcp-server-runtime-boundary), §§7–8, Agent Runtime, and Marketplace contracts                                                                                          |
| Marketplace source/cache/install, snapshot closure, ActiveSet, product lock   | [`docs/architecture.md` §§5–6 and §8](../../../../docs/architecture.md#5-persistence-map), [`docs/plugin-skill-platform.md`](../../../../docs/plugin-skill-platform.md), and Marketplace contract                                                              |
| Plugin Host API, availability, generated Catalog contract                     | [`docs/plugin-host-change-governance.md`](../../../../docs/plugin-host-change-governance.md), Plugin API/SDK package contracts, and [`docs/plugin-skill-platform.md`](../../../../docs/plugin-skill-platform.md)                                               |
| Plugin installation/runtime, companions, service host, Web asset protocol     | [`docs/architecture.md` §8](../../../../docs/architecture.md#8-plugin-host-boundary), [`docs/plugin-skill-platform.md`](../../../../docs/plugin-skill-platform.md), and [`docs/plugin-canvas-capabilities.md`](../../../../docs/plugin-canvas-capabilities.md) |
| Plugin capability broker, imports/exports, Host API dispatch                  | [`docs/plugin-canvas-capabilities.md`](../../../../docs/plugin-canvas-capabilities.md), Plugin API/SDK contracts, and [`docs/architecture.md` §8](../../../../docs/architecture.md#8-plugin-host-boundary)                                                     |
| `generation-*`, model/service controls, pending nodes, recovery/LRO           | [`docs/generation-tool-plugins.md`](../../../../docs/generation-tool-plugins.md), [`docs/canvas-node-generation-state-persistence.md`](../../../../docs/canvas-node-generation-state-persistence.md), and Canvas contract                                      |
| Plugin Project/Canvas broker, MessagePort, connected media, selection actions | [`docs/plugin-canvas-capabilities.md`](../../../../docs/plugin-canvas-capabilities.md) and [`docs/architecture.md` §8](../../../../docs/architecture.md#8-plugin-host-boundary)                                                                                |
| Browser-cookie or external service authorization                              | [`docs/architecture.md` generation and Plugin host boundaries](../../../../docs/architecture.md#generation-tool-boundary) and [`docs/generation-tool-plugins.md`](../../../../docs/generation-tool-plugins.md)                                                 |
| External editor, retired built-in, native media drag                          | [`docs/architecture.md` “Retired built-ins” and “Native Canvas media drag-out”](../../../../docs/architecture.md#retired-built-ins)                                                                                                                            |
| Any `*-ipc` or protocol handler                                               | [`docs/architecture.md` §10](../../../../docs/architecture.md#10-electron-boundary) plus the Preload and Renderer contracts                                                                                                                                    |
| Electron Vite, packaged entry, dependency externalization                     | [`docs/architecture.md` §10](../../../../docs/architecture.md#10-electron-boundary) and the Desktop build/packaging tests                                                                                                                                      |
| Application update, `electron-updater`, signing, notarization, release feed   | [`docs/architecture.md` “Desktop application update” and §10](../../../../docs/architecture.md#desktop-application-update) plus [`docs/desktop-builds.md`](../../../../docs/desktop-builds.md)                                                                 |

## Capability invariants

- Agent tools are thin adapters. Host Project scope is authoritative; document tools
  may name only a Canvas in that Project's live catalog, while view tools remain
  bound to the mounted active Canvas.
- Agent replacement of an existing editable Canvas text node must use the shared
  Main text-resource writer: compare-and-replace the materialized Project file,
  publish its ProjectIndex version, relink the same Canvas node, then optionally
  reload the mounted view. Never report a direct shell write as a Canvas mutation.
- Project-directory focus resolves its root from the authoritative Canvas node,
  delegates bounded descendant listing to the existing scoped Project Files port,
  and rechecks Project/Canvas/node scope after awaits. Never persist projected
  directory entries or add a second native listing surface.
- Connected inputs are direct incoming Canvas edges only. Return pathless bounded
  metadata until explicit user intent reaches the verified Main-owned staging
  boundary; that boundary resolves the canonical Canvas owner proof through the live
  ProjectIndex current-resource projection before opening native bytes. Invalidation
  alone never triggers upload, prompting, or execution.
- Skills remain native OpenCode instruction bundles. Desktop owns installation
  policy and ActiveSet selection; Agent Runtime receives generic leased Skill
  directories, immutable Hook URLs, MCP configuration, and typed tool providers
  only.
- Third-party Web code is static content in an iframe with exactly
  `sandbox="allow-scripts"`. Never import it into the host, use `webview`, enable
  same-origin/Node/Electron access, or expose a generic function-call bridge.
- Marketplace authority is Main-only. Renderer supplies opaque selections/tokens,
  never arbitrary URLs, paths, digests, SourceKeys, or transport configuration.
  Network access and immutable artifacts follow the accepted source identity and
  security high-water decisions.
- Preserve Registry `ownerPluginId` through source qualification and remove
  Plugin-owned Skills from standalone choices before creating a transition. Managed
  Skill recovery never infers publication from a directory name: retry only the
  exact pending source-qualified candidate, preserve ambiguous bytes, and retain
  recovery state until rollback is proven.
- Treat `InstallRecord` as inventory, not execution authority. A Plugin is ready only
  when its exact source, version, artifact identity, and immutable snapshot occur in
  the validated ActiveSet. Legacy records must first bind to an exact active or
  recovery snapshot; deactivated records remain attention state.
- A startup-invalid ActiveSet quarantines the Plugin subsystem for the process. The
  only update path requires a dedicated inspection proving intact pointer, closure,
  authorization, topology, and retired-major-only incompatibility. All other
  mutations stay blocked and repaired bytes remain inert until restart.
- A packaged recovery artifact may supply bytes to that update only when its exact
  product-lock binding matches the inspected retired source, Plugin id, old version,
  archive SHA-256/size, snapshot digest, and retired Host API major, and the candidate
  matches the lock-derived current Official SourceKey. That exact one-way lineage is
  the only admitted `InstallRecord` source migration. Never expose it to
  preinstall/fresh install, scan for it, or infer a match from a directory.
- Tool Plugin installation/update consent is part of the exact immutable closure and
  snapshot descriptor. Background refresh never expands execution authority.
  Builtin/preinstalled are provisioning sources, not runtime privilege classes; the
  product-lock automatic-setup exception remains exact, managed, credential-free,
  and fail-closed.
- A user-confirmed install/update or explicit Local import publishes its exact
  execution authorization in the same transition. Static Web Plugins bind that
  authorization to the capability contract, source, version, and artifact even
  without a companion or Hook. Missing or changed bytes require exact-source
  reinstall/update; Plugin setup never repairs them.
- Contributions and `hostApi` calls are orthogonal. Bind Host API availability and
  Plugin-to-Plugin imports/exports from the exact ActiveSet through the typed broker;
  validate caller/provider principals and schemas, propagate cancellation, bound
  depth/re-entry, and never inherit caller grants.
- Plugin surface creation accepts only Project, Canvas, and Plugin ids from a trusted
  sender. Main resolves one exact current ActiveSet lease and derives the renderer,
  size, Plugin requirement, schema, validation artifact, snapshot digest, and initial
  state from that leased manifest alone, then rechecks the same lease immediately
  before the durable commit. A stale lease, missing validation artifact, or invalid
  initial state writes nothing. Main calls the Canvas business command and never
  assembles a complete Canvas node, chooses a node id or position, reuses a generic
  node-insert or connected-materialization path for this root, or branches on a
  concrete Plugin id. A failed renderer refresh never rolls back a durable creation,
  and uninstalling the Plugin leaves the node and its portable state intact.
- Generation has one Main-owned executor shared by Agent, UI, and Plugin callers.
  OpenCode is an Agent-side client, not the execution owner. Admit installed models
  to the display snapshot from exact manifest/service membership and the bounded
  current tool schema without waiting for or filtering on `service.status`.
  Model/control display snapshots never authorize execution; reload and validate
  the live tool/service contract immediately before dispatch.
- Generated files publish without clobbering under the Project before Canvas commit.
  Preserve files on partial success. Pending nodes, node run state, target guards,
  and legal transitions go through Canvas business services.
- Generation input staging may accept a multiply-linked source only after the typed
  Project resource port validates it and only while its positive link count and
  complete native snapshot stay unchanged. Every other stable-copy caller remains
  single-link.
- Keep host `operationId` and downstream `taskId` distinct. Without the complete
  admitted recovery contract, restart marks orphaned active runs failed and
  never repeats a potentially billable call.
- Browser-cookie authorization uses a fresh non-persistent sandboxed session, exact
  HTTPS origin and allowlisted cookies, one fixed completion action, and a bounded
  Main-only recovery checkpoint bound to the exact Plugin snapshot. No browser
  profile, URL, request, or cookie crosses IPC.
- Treat the payload-free v8 `disconnect` envelope as lifecycle control for only the
  exact MessagePort connection. Close that existing renderer/Main connection and
  await its fixed disconnect so frame-owned work and media sessions are revoked;
  never accept caller-selected connection or scope identity.
- Give every connected-media session one owner-scoped abort lifecycle. Revocation,
  close, Canvas invalidation, expiry, or disposal stops later audio/video reads and
  releases stream-owned descriptors. Connected images are bounded immutable memory
  snapshots; revocation blocks later fetches but cannot retract an already built
  response body.
- Connected image open/close remains separate from audio/video stream open. Require
  the generated declarations and grant, resolve only opaque direct-input keys, use
  the Project-owned stable reader and bounded decode validation, and return only a
  revocable high-entropy bearer URL plus safe metadata. Revalidate the live Plugin,
  edge, resource, frame, and Canvas around asynchronous work.
- Custom URI schemes are fixed Host adapters, not a Plugin registration surface.
  `convax-connected-media:` widens only the exact declared `img-src` or `media-src`
  capability and never `connect-src`; `convax-pet-asset:` widens only `img-src` for
  a validated Pet contribution with `pet.custom.manage`. Keep Plugin assets,
  Project resources, connected media, and Pet assets under distinct authorities.
- Vendor-specific native behavior belongs to verified generic companion
  contributions in `convax-plugins`, not Desktop product branches. Native media
  drag-out remains destination-neutral; never substitute Accessibility/UI automation
  or silently retry an unknown/partial native side effect.

## IPC and lifecycle

- Use the established namespace and channel families; add narrow typed methods
  instead of generic routing or caller-selected method names.
- Validate the sender before resolving authority. Bind concurrent work and
  subscriptions before awaiting principal or connection setup.
- Use cloneable start/cancel messages for cross-process cancellation. Abort queued
  or filesystem work when the sender is destroyed. An opaque operation id correlates
  lifecycle only and never selects scope.
- Drain durable authorization/recovery handoffs before disposing their shared
  runtime. Disposal must close local transports, child processes, temporary servers,
  sessions, and staged state deterministically.
- For incompatible bridge changes, update Main, Preload, Renderer,
  `desktopProtocolVersion`, and compatibility tests together.
- Project file-tree previews use their own sender-scoped opaque lease protocol.
  Resolve a Project-relative path to one stable regular-file identity before minting
  the URL, serve GET/HEAD byte ranges only, and abort open streams on close,
  replacement, navigation, renderer loss, or disposal. Keep thumbnail-purpose
  leases bounded and independent from the one replaceable hover-preview lease.
  Thumbnail IPC is bounded and never substitutes a complete media data URL.

## Validation

- Before local ProjectIndex first registration, repeat the Project-owned portable
  cutover guard. A legacy recovery adapter may resolve only an exact pristine
  local-owner bootstrap through the Project/node verifier; path presence alone is
  neither Team evidence nor permission to reset current collaboration state.
- The explicit user-confirmed unshared-local reset branch requires no
  sharing-handoff or Team/control namespace and exact `missing` from the durable
  Team authority store. It never decodes unsupported bytes or requires an empty
  bootstrap. Prepare a fresh owner binding, keep it inert through genesis publication
  and byte-exact `.convax-archive-*` verification, then activate it; interruption
  keeps the old binding or recovery state fail-closed. Any active or rejected Team
  state requires control-plane rollover.
- Opening a Project with no durable Team binding must not bootstrap, join, or open
  Team control-plane state. This keeps the shell local-first; mutation authority
  comes from the exact durable local-owner binding under the validated current
  protocol descriptor, never from shell state. That owner must authorize ProjectIndex
  edits, Canvas edits, and Canvas genesis without network or Team state.
- Compose one local-first authority source: durable Team state selects Team signing;
  only an exact `missing` Team state permits local-owner signing. Rejected or
  ambiguous Team state fails closed, and UI adapters never synthesize authorization.
- When an editable Project has no live Canvas, Desktop coordination may invoke the
  Project-owned typed Canvas-create command and open its committed result. It must
  not fabricate a route or document projection. Register the exact Canvas owner
  materializer before genesis durability, release it after the barrier, and observe
  each accepted frame in the live causal index before accepting dependent frames.
- Resolve Canvas `current-resources` facts only from the live ProjectIndex
  current-resource projection and verify the exact URI, blob tuple, owner-proof
  digest, and MIME-derived media class. A native path, prepared UI item, or retained
  file alone is not current-owner authority.
- Resolve Canvas `retained-resources` facts only by composing Canvas's exact retained
  proof with Project's project-scoped digest-and-length blob availability port.
  Missing material stays pending; availability never substitutes for current-owner
  authority and unexpected or duplicate availability results fail closed.
- Compose local-owner authority adapters only through the one packaged current
  protocol descriptor. Load it once, verify its exact digest against the build, and
  build one kernel, one codec, and one document session type from it. Never load an
  archived authority release, keep a predecessor decoder, dispatch between protocol
  versions, or select a protocol from a directory, filename, or durable record shape;
  new, open, recover, and share all use that same composition, and unsupported bytes
  return `unsupported-project-data`.
- Retain the canonical Project root and local actor binding across zero-lease writer
  disposal. Admit a changed binding only after the serialized close/reset operation
  succeeds; failure keeps the prior binding and makes later acquisition fail closed.

- Run `bun typecheck && bun test` from `packages/desktop`.
- Run focused tests for the changed capability and its failure/recovery path.
- Run `bun run build` for Main or IPC changes.
- Run `bun run smoke:open-project` for Project open, persistence, IPC, migration, or
  breaking-cutover work.
- Run root `bun check` for persistence, IPC, installation, public capability, or
  composition changes.
