# Desktop Main Process Contract

This file applies to `packages/desktop/src/main/**` and extends the Desktop package
contract. Main is the trusted composition and native-adapter edge. It owns host
authority and lifecycle coordination, not reusable domain semantics.

## Owns

- Electron application/window lifecycle and native integrations.
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
- Publish committed revision invalidations after domain success. Renderer reload,
  selection, reveal, or reconciliation is fallible projection work and cannot undo
  or misreport a durable mutation.
- Bind every IPC, MessagePort, tool, and external-operation request to its trusted
  sender/principal and current Project/Canvas scope. Recheck permissions, identity,
  catalog membership, revision, target, and cancellation after awaited preparation
  and immediately before persistence or an external side effect.
- Bound requests, queues, subscriptions, messages, staged bytes, retained receipts,
  diagnostics, and recovery state. Serialize mutations that share an identity or
  filesystem namespace.
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
- Host-authored portable failures may use only bounded validated display data. Raw
  sidecar, native, filesystem, network, credential, and recovery diagnostics never
  enter Canvas state or renderer-safe projections.

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

## Capability invariants

- Agent tools are thin adapters. Host Project scope is authoritative; document tools
  may name only a Canvas in that Project's live catalog, while view tools remain
  bound to the mounted active Canvas.
- Project-directory focus resolves its root from the authoritative Canvas node,
  delegates bounded descendant listing to the existing scoped Project Files port,
  and rechecks Project/Canvas/node scope after awaits. Never persist projected
  directory entries or add a second native listing surface.
- Connected inputs are direct incoming Canvas edges only. Return pathless bounded
  metadata until explicit user intent reaches the verified Main-owned staging
  boundary; invalidation alone never triggers upload, prompting, or execution.
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
- Generation has one Main-owned executor shared by Agent, UI, and Plugin callers.
  OpenCode is an Agent-side client, not the execution owner. Model/control display
  snapshots never authorize execution; reload and validate the live tool/service
  contract immediately before dispatch.
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

## Validation

- Before local ProjectIndex first registration, repeat the Project-owned portable
  cutover guard. A legacy recovery adapter may resolve only an exact pristine
  local-owner bootstrap through the Project/node verifier; path presence alone is
  neither Team evidence nor permission to reset current collaboration state.
- Opening a Project with no durable Team binding must not bootstrap, join, or open
  Team control-plane state. This keeps the shell local-first; mutation authority
  still comes only from the verified V11/R1 selector or its pinned historical V2
  dispatch, never from shell state.
- Compose V3 local-owner authority adapters only through the active V11/R1 release,
  its complete pinned V10/R5 dependency, and the verified dual-version dispatcher.
  R1 permits only promotion of a verified pristine, unshared V10 ProjectIndex into
  one local-owner V3 Project with one deterministic default Canvas. Direct-new V3,
  additional V3 Canvases, sharing, and ambiguous promotion remain fail-closed;
  Project/node record presence alone is not a runtime selector.
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
