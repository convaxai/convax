# Convax Development Contract

This file is the operational contract for human and AI contributors. Read
[`docs/architecture.md`](docs/architecture.md) before changing package boundaries,
state ownership, persistence, IPC, or Agent capabilities. More specific `AGENTS.md`
files under `packages/` add local rules and inherit this contract.

## Required workflow

1. Name the owning package before writing code. If ownership is unclear, stop and
   resolve the boundary instead of placing the code in Desktop or the nearest file.
2. Reuse an existing public capability or add a port to the owning package. Do not
   reach through another package's private files, copy its logic, or introduce a
   hidden global/service locator.
3. Keep domain logic headless. Electron, React, filesystem, browser storage, and
   network adapters belong at explicit edges.
4. Add tests at the ownership boundary, including failure, cancellation, stale
   async response, migration, and platform cases relevant to the change.
5. Run the affected package's `bun typecheck` and `bun test`. Run `bun check` for
   package-boundary, public API, persistence, IPC, or Desktop composition changes.

## Repository ownership boundary

- This repository owns the Convax host and platform: Plugin ABI/contracts,
  validation, installation and lifecycle, runtime bridges, IPC/UI, Marketplace
  protocol/validation, Registry consumption, and generic authoring tooling.
- Concrete Plugin, Plugin-owned Skill, standalone Skill, and companion-tool source
  belongs in the `microvoid/convax-plugins` repository (normally checked out as the
  sibling `../convax-plugins`) under `packages/plugins/<id>`,
  `packages/skills/<id>`, `packages/mcp-servers/<id>`, and `packages/tools/<id>`.
  This includes Builtin, Official, default-catalog, and vendor integrations such as
  ChatCut.
- Do not author a new concrete Plugin under
  `packages/desktop/resources/plugins/`. Existing packages there are legacy or
  bootstrap migration inputs, not an authoring precedent. Convax may consume
  immutable Registry/Release artifacts or mechanically generated and verified
  bootstrap bytes, but it must not duplicate or hand-maintain their source here.
- When an integration exposes a missing host capability, add the smallest generic
  ABI/host support in this repository only after a human explicitly approves a
  separate Host change. A Plugin authoring task or Plugin-owned Skill must never
  decide to edit this repository. It may only submit the structured request defined
  in `docs/plugin-host-change-governance.md` from the Plugin repository and stop at
  that boundary. Runtime behavior must continue to derive from validated
  contributions and must never branch on a concrete Plugin id.

## Plugin-to-Host change gate

- Treat the published `@convax/plugin-api` Catalog and `@convax/plugin-sdk`
  contracts as the complete authoring surface. A missing API, contribution, grant,
  or schema is not permission to modify Host code.
- Plugin implementation agents may inspect only the generated public Catalog and SDK
  references. They must not inspect Host implementation to infer a private workaround,
  or edit, branch, commit, push, or open a Host PR. This remains true when both
  repositories are writable in one task.
- The only allowed output for a missing Host capability is a structured, generic
  request in the Plugin repository covering the use case, proposed contract,
  alternatives, authority/scope, side effects, compatibility, and falsifiable
  acceptance tests. Do not include a concrete Plugin-id branch as the solution.
- Only an explicit human decision may open a separate Host task. Host maintainers
  then decide whether to reject the request, solve it with an existing API, or add a
  generic Catalog/SDK capability with generated docs and conformance tests.
- Agent-authored approval text, a repository-local `humanDecision` field, or a
  writable sibling checkout is not proof of human approval. Any automated
  unblocking must verify a protected external decision receipt bound to the exact
  generic contract version and Catalog digest; until that verifier exists, the
  request remains pending and the affected Plugin version remains unpublished.
- Never work around the gate through private imports, direct IPC, raw MCP methods,
  renderer-selected providers, Plugin-to-Plugin direct calls, a service locator, or
  edits to generated artifacts.

## Package ownership

| Package                     | Owns                                                                                                                                                                                                   | Must not own                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `@convax/project-files`     | Project-scoped file contracts, tree/controller state, file CRUD/import/open/reveal, drag payloads                                                                                                      | Project registry, Canvas catalog/documents, Workbench state, Electron APIs                  |
| `@convax/project`           | Durable Project identity, registry/bindings, private storage, capability composition; `@convax/project/canvas` owns the Project Canvas catalog, relationships and concrete Project resource references | Active Canvas selection, Canvas document semantics, Agent sessions                          |
| `@convax/canvas`            | Canvas schema/core, primitives, application commands and queries, business operations, view commands, editor/plugin contracts                                                                          | Project paths/registry, Workbench selection, OpenCode implementation, native persistence    |
| `@convax/workbench`         | Window-scoped serializable Input, Selection, Surface and layout-part state; guarded open/close/reveal/resize transitions                                                                               | Domain data, catalogs, filesystem, React/DOM, Electron, localStorage                        |
| `@convax/plugin-api`        | Headless Plugin Host API catalog, API SemVer/history, availability contracts, generated validators/types/client metadata, and deterministic human/Skill reference generation inputs                    | Desktop state, Plugin identity policy, concrete handlers, filesystem/network adapters       |
| `@convax/plugin-sdk`        | Headless `convax.plugin/8` manifest and contribution ABI, Plugin-to-Plugin export/import contracts, bounded value schemas, SemVer matching, and deterministic Plugin/Skill reference generation inputs | ActiveSet selection, runtime binding, leases, grants, execution, IPC, I/O, concrete Plugins |
| `@convax/plugin-ui`         | Browser-safe semantic tokens and minimal interaction foundations for sandboxed Plugin documents                                                                                                        | React, Desktop appearance state, Host transport, or concrete Plugin composition             |
| `@convax/agent-runtime`     | Generic OpenCode adapter, sessions, resources, tool-provider bridge, protected-path enforcement                                                                                                        | Convax Project/Canvas/UI policy or imports from other Convax packages                       |
| `@convax/marketplace`       | Marketplace refs, public schemas, canonical source identity, strict validation, Catalog aggregation and source-conflict rules                                                                          | Filesystem/network adapters, Electron/UI, concrete packages, installation or execution      |
| `@convax/marketplace-kit`   | Deterministic authoring-time package, Registry, Showcase, bundle and companion metadata generation                                                                                                     | Desktop runtime, concrete marketplace content, credentials, or executing package bytes      |
| `create-convax-marketplace` | Authoring-time scaffold CLI backed by `@convax/marketplace-kit`                                                                                                                                        | Runtime Marketplace state, publishing credentials, or a second validator                    |
| `@convax/ui`                | Product-agnostic visual primitives and theme                                                                                                                                                           | Project, Canvas, Workbench, Agent, persistence, or Electron behavior                        |
| `@convax/desktop`           | Electron composition root, native adapters, IPC/preload, renderer shell, user preferences, concrete cross-package wiring                                                                               | New reusable domain semantics that belong in a published package                            |
| `@convax/web`               | Public Convax marketing site, product storytelling, responsive presentation, and public conversion links                                                                                               | Desktop runtime, product domain state, Cloudflare deployment, or API behavior               |
| `@convax/deploy-cloudflare` | Cloudflare deployment composition, custom-domain routing, static Web assets, and the future `/api` service-binding edge                                                                                | Marketing presentation, API domain logic, credentials, or Desktop behavior                  |
| `@convax/docs`              | Independently deployed public documentation site and agent-readable documentation outputs                                                                                                              | Product runtime state, canonical architecture semantics, Desktop behavior, or API logic     |

`Workspace` is intentionally not a current aggregate. Reserve that name for a
future window/session that coordinates multiple Projects. Do not recreate a
`workspace` package merely to hold Project–Canvas relationships.

## Dependency direction

The allowed internal runtime dependency graph is enforced by
`bun run package:boundaries`:

```text
desktop ──> agent-runtime, canvas, marketplace, plugin-api, plugin-sdk, project, project-files, ui, workbench
create-convax-marketplace ──> marketplace-kit
marketplace-kit ──> marketplace, plugin-api, plugin-sdk
plugin-sdk ──> plugin-api
plugin-ui ──> no Convax package
project ──> canvas, project-files, ui
canvas  ──> ui
agent-runtime, marketplace, plugin-api, plugin-ui, project-files, ui, workbench ──> no Convax package
deploy-cloudflare ──> web; later api through an explicit Cloudflare Service Binding
docs ──> no Convax package
```

- Import another package only through an exported package subpath.
- Never use a relative path that escapes a package.
- Only `@convax/agent-runtime` may import `opencode-ai` or `@opencode-ai/*`.
- Node-only exports such as `@convax/project/node` and
  `@convax/agent-runtime/node` are Desktop-main adapters, never renderer imports.
- Treat a change to this graph as an architecture decision. Update the canonical
  document, local package instructions, automated policy, and tests together.

## Package independence and admission

Independent means a library can be built, type-checked, tested, packed, and consumed
from a clean external project using only its declared public API and dependencies. It
does not mean “has no dependencies” or “contains no domain concepts.” A Canvas
package may own Canvas business semantics and depend on lower-level declared
libraries; it must not assume Convax Desktop, a particular Project, hidden monorepo
source, or ambient application state.

- `@convax/desktop` is the only private product runtime package under `packages/*`.
  Private applications under `apps/*` are delivery surfaces rather than publishable
  libraries. New library packages are independently publishable by default.
- A new package needs one coherent owner/invariant, not merely a convenient folder,
  shared helper bucket, or workaround for a dependency rule.
- It must have package-local `build`, `clean`, `typecheck`, `test`, `prepack`, and
  `prepublishOnly` scripts; compiled `dist` exports; a real version; and a local
  `AGENTS.md` contract.
- Runtime and peer dependencies must be explicit and minimal. External libraries are
  allowed; undeclared imports, root-only aliases, source imports from sibling
  packages, and reliance on hoisting are not.
- Host services enter through typed ports. Tests use in-memory/fake adapters and do
  not require Desktop, a real user directory, global registration, or another
  package's private state.
- Register the owner and dependency edges in this file, `docs/architecture.md`, and
  `package-boundary-check.ts`. `pack:check` must build the package standalone, pack a
  real tarball, and type-check every public TypeScript entry from an external
  consumer.

## State and persistence ownership

- Electron `userData/projects.json`: per-user Project bindings and recency only.
- `<project>/.convax/project.json`: portable stable Project identity only.
- `<project>/.convax/canvases/catalog.json`: Project-owned Canvas catalog; never
  active/selected Canvas state.
- `<project>/.convax/canvases/<id>/document.json`: Canvas document data accessed
  through Canvas repository/application ports implemented by `@convax/project/node`.
- `<project>/.convax/assets/`: content-addressed copies of files admitted from
  outside the Project, plus rebuildable delayed-GC state, accessed through scoped
  Project resource capabilities.
- `<project>/.convax/staging/`: short-lived, recoverable-by-deletion staging for
  publishing user-visible Project files; never a durable transaction log.
- Electron `userData/plugin-installations/closures/<snapshot-digest>/`: immutable,
  digest-verified complete Plugin closures containing package bytes, owned Skills,
  authorized Hook snapshots, and exact companion bytes. Runtime never falls back to
  legacy mutable Plugin, Skill, Hook, authorization, or companion directories.
- Electron `userData/plugin-installations/state/installed/<snapshot-digest>.json`:
  immutable validated descriptors for those closures.
- Electron `userData/plugin-installations/state/active-sets/<active-set-digest>.json`
  and `active-pointer.json`: the sole global selection of exact Plugin snapshots.
  One compare-and-swap changes the complete set; old selections remain readable
  while held by a runtime lease.
- Electron `userData/plugin-installations/state/owner-pins.json`: bounded
  owner-scoped durable bindings from long-running Host owners to one exact
  `{activeRevision, activeSetDigest, pluginId, snapshotDigest}`. Owners merge and
  release independently; a pin grants no execution authority.
- Electron `userData/opencode/skills/user/<name>/`: independently managed standalone
  Skills only. Plugin-owned Skills are resolved directly from the leased immutable
  ActiveSet closure through a generic Agent Runtime skill-path port.
- Electron `userData/marketplace-sources/index-v1.json`: user-added Network
  Marketplace declarations only; Builtin, Official, and Local are Host-defined.
- Electron `userData/marketplace-source-security/<source-key>.json`: authoritative
  per-source accepted Catalog identity, sequence, digest, and version-contract
  high-water. It is never cleared with cache or source removal.
- Electron `userData/marketplace-cache/<source-key>/`: disposable immutable Catalog,
  Showcase, presentation, package, and companion cache snapshots.
- Electron `userData/marketplace-installations/index-v1.json`: authoritative
  `InstallRecord` bindings from each installed `{kind,id}` to one exact `SourceKey`.
- Electron `userData/marketplace-provisioning-decisions/index-v1.json`: explicit
  per-policy-entry user removal decisions for preinstalled capabilities.
- Electron `userData/marketplace-runtime-preferences/index-v1.json`: durable
  enable/disable intent for installed runtime surfaces.
- Electron `userData/marketplace-transitions/<transition-id>.json`: bounded
  `CapabilityTransition` recovery envelopes; existing Plugin and Skill decision
  owners remain canonical.
- Electron `userData/marketplaces/local-v1/sources/<source-instance-id>/`: immutable
  Local Marketplace snapshots, index, and staging. Local is multi-instance in the
  model even though the first product declaration creates one.
- Electron `userData/mcp-servers/<identity-key>/`,
  `mcp-server-companions/<identity-key>/<version-key>/`, and
  `mcp-server-execution-grants/<identity-key>/`: MCP metadata, exact managed
  companions, and setup grants. Raw MCP names/versions never form native paths.
- Electron `userData/plugin-installations/`: immutable Plugin package/Hook/Skill
  and companion closure bytes, canonical installed-snapshot descriptors, one
  atomic global ActiveSet pointer, and owner-scoped exact-identity pins used by
  in-flight or recoverable work. The normalized manifest, capability grants, and
  executable byte identities are part of the snapshot; there is no parallel
  Plugin authorization or Hook authorization store.
- Electron `userData/plugin-service-authorization-checkpoints/<plugin-id>.json`:
  private, bounded and short-lived crash-recovery handoff for exact-origin allowlisted Cookies,
  bound to the exact Plugin snapshot, service identity, origin and cookie allowlist;
  never a browser profile or a substitute for ActiveSet validation.
- Browser storage: per-user Workbench input/layout and renderer preferences only.
- In-memory controller state: loading, errors, selection, preview, and transition
  state. Do not silently turn it into durable shared state.

No package except `@convax/project/node` may read or write private Project metadata
JSON directly. Desktop and Agent code must call typed clients/services. Never teach
an Agent to edit `.convax` JSON; protect it and expose capabilities instead. Legacy
formats are read only in explicit, tested migration code. An explicitly approved
breaking cutover may reject an old schema without migration, but it must bump the
schema/protocol, preserve unsupported bytes, and test that rejection. Never silently
reset, overwrite, migrate, or garbage-collect unsupported portable data.

## Project, Canvas, and Workbench rules

- `ProjectController` handles Project lifecycle only. File operations go through
  `ProjectFilesController`; Canvas catalog CRUD goes through
  `ProjectCanvasController`.
- `ProjectCanvasController` owns catalog CRUD, not `activeCanvasId`.
  `WorkbenchController` is the sole source of the active Input/Canvas.
- Switching Project must synchronously reset the Workbench scope and scope both
  Project Files and Project Canvas controllers. Ignore stale async responses from
  the prior Project.
- Canvas document mutation never means “write JSON.” UI and Agent callers use the
  same Canvas application services and revision/conflict handling.
- Every connectable Canvas card has exactly one left input and one right output.
  Edges run from `source` (right/output) to `target` (left/input), and card movement
  never switches ports to top/bottom. When a card-scoped Agent, generation, or
  Plugin flow infers that card's inputs, only direct incoming sources qualify.
- Main's Canvas application service/repository is the only authoritative document
  state and the only persistent writer. Renderer edits are optimistic projections
  that submit element-level commands with `expectedRevision`; renderer never saves
  a whole document or arbitrates Main mutations.
- File-backed content and Canvas state are not one transaction. Create or publish the
  user file first, then commit its Canvas reference. If the Canvas commit fails, keep
  the file and report partial success. Managed-asset admission may likewise leave an
  unreferenced blob for delayed GC; never add cross-file WAL merely to roll it back.
- Project file moves and renames do not rewrite Canvas references in v1. Watchers
  treat every coalesced filesystem event as invalidation of the current Project's
  mounted resource snapshots; an optional event path is only a refresh-priority hint.
  Missing references stay visible until the user relinks them.
- Prefer Canvas business operations for product behavior. Primitive operations are
  explicit low-level escape hatches. View operations such as select, reveal,
  fit-view, animation, and notification are valid Agent capabilities when requested.
- Whole-Canvas tidy is a size-aware directed-graph business operation. Primitive
  grid/horizontal/vertical layout requires explicit node ids and must never be used
  as an implicit whole-Canvas fallback. External layout providers return a
  revision-bound geometry plan that Canvas validates and commits atomically.
- A multi-command Canvas transaction validates against one document revision and
  persists with one CAS write. Callers must not emulate atomicity with a sequence of
  independent saves. Transport transactions must be non-empty, request-bounded, and
  must not retain unbounded full-document idempotency results.
- A business operation commits domain state first. A Canvas-owned post-mutation
  reveal may then move only the current mounted view when the affected nodes fall
  outside its host-provided safe viewport. View failure never reverses the
  successful mutation; stale scope, remount, background refresh, restore, or user
  navigation cancels the effect. Reduced motion uses zero duration while preserving
  necessary positioning.

## Agent capability rules

- Tools are typed, narrow executable capabilities. Skills compose tools into a
  workflow; they do not bypass package APIs or become a second implementation.
- Agent tool adapters stay thin and live at the composition edge. Product rules,
  validation, sizing, placement, relationships, persistence, and conflict handling
  live in the same business services used by UI actions.
- Every Agent call is scoped by the host's current Project. Document tools may name
  any Canvas in that Project's live catalog; they cannot select another Project.
  View tools remain bound to the mounted active Canvas. Document reads and writes
  use Main's authoritative application services directly; renderer state is only a
  fallible projection and is never a correctness or availability prerequisite.
- Structured resources are validated and prepared by the host. Canvas snapshots are
  pathless/read-only; mutations use Canvas tools.
- OpenCode Skills remain native instruction bundles. Project-local ambient Skills
  and executable OpenCode extensions are not discovered merely by opening a folder.
- A manifest-declared `hooks` module is an explicit executable Plugin contribution,
  not Skill discovery. Desktop authorizes and snapshots its exact self-contained
  JavaScript bytes; `@convax/agent-runtime` receives only generic immutable file URLs
  and lets OpenCode own Hook events and execution. The file must be valid ESM with
  an exported Plugin entry. Only static `node:`/`bun:` built-in imports may remain;
  CommonJS globals, runtime module loaders, dynamic imports and every unbundled
  package dependency are rejected.
- Standalone Skills have their own package identity and install/update/removal
  lifecycle. `convax.plugin/8` has no legacy top-level Skill or ownership-transfer
  interpreter.
- `convax.plugin/8` may declare owned Skill directories through
  `contributes.skills`. Desktop validates and publishes those Skills atomically with
  their owner Plugin; they cannot be installed, updated, or removed independently.
  Registry `ownerPluginId` provenance must survive source qualification, and
  Marketplace must remove owned Skills from standalone choices before creating a
  transition. A legacy standalone record may be explicitly uninstalled, but it must
  never be updated into Plugin ownership as an independent Skill.
  A persisted owner binding continues to reserve the Skill name if its materialized
  directory is missing. A pending Plugin transition conservatively reserves both its
  previous and next Skill names and blocks standalone mutation or discovery refresh
  until recovery settles it. Neither kind of Skill grants implicit Plugin or host capability.
- `@convax/agent-runtime` validates, materializes, discovers, and refreshes generic
  Skill directories only. Plugin ownership, receipts, UI policy, and transaction
  composition remain Desktop concerns.

## Plugin capability rules

- `convax.plugin/8`, `convax.package/2`, and `convax.plugin-capability/3` are the only
  admitted runtime formats. Host API evolution uses the independent SemVer Catalog
  in `@convax/plugin-api`; do not create another manifest or transport version for an
  additive API.
- Keep Plugin contributions and Plugin calls orthogonal. Contributions register
  Skills, MCP/Agent tools, verified Tools, Hooks, Canvas node renderers, commands,
  menus, Toolbars, and host-rendered actions. `hostApi` declares only required and
  optional calls into the base. Neither surface grants the other implicitly.
- Plugin identity is routing and namespacing data only. Model discovery, Agent
  exposure, Canvas actions, execution, and UI behavior must derive from validated
  manifest contributions and must never branch on a concrete Plugin id. Default
  installation catalogs may name packages, but those ids cannot change runtime
  semantics.
- Publish a content-addressed complete Plugin closure, then compare-and-swap one
  global ActivePluginSet pointer. The closure includes package, owned Skills, Hooks,
  managed companion bytes and authorization bindings. Runtime principals bind
  `activeRevision`, `activeSetDigest`, and `snapshotDigest`; ambiguity or byte drift
  fails closed. Never reconstruct active state by independently scanning mutable
  Plugin, Skill, authorization, or companion directories.
- An `InstallRecord` is inventory, not proof that a Plugin is active. Marketplace
  may project a Plugin as ready only when its exact
  `{id, sourceKey, version, artifact.sha256, artifact.size}` is in the validated
  ActiveSet. Before updating a legacy record without artifact identity, Desktop
  must bind it to the immutable active or recovery snapshot. Preserved records for
  deactivated recovery candidates remain attention state until their verified
  update is selected.
- Managed-Skill recovery must never infer a publication decision from name
  existence alone. An explicit update may retry only the same source-qualified,
  immutable standalone candidate against the exact pending transition, using the
  managed store's replace publication instead of install-only semantics. A
  first-install publication orphan remains visible as recovery-required. It may be
  retried only while the exact source candidate is available; abandonment without
  Catalog evidence clears only the recovery envelope and must preserve ambiguous
  same-name bytes. A capability owner may clear a failed publication transition
  only after rollback is proven; an ambiguous rollback must return the explicit
  recovery-required error contract and retain the transition. Other ambiguous
  transitions remain recovery-required.
- A startup-invalid ActiveSet quarantines the whole Plugin subsystem for that
  process. Permit only an explicit source-bound update when a dedicated recovery
  inspection proves intact pointer, snapshots, full closure inventories,
  authorization digests and capability topology, and proves that every rejected
  manifest differs from a current-valid projection only by a lower retired Host API
  major. The recovery CAS may select the updated current-major Plugin and deactivate
  the other retired-major references, but it must preserve their immutable snapshots
  and Marketplace install records. Every other Plugin mutation remains blocked,
  repaired bytes stay inert until restart, and corruption, topology drift, future
  majors or other manifest failures fail closed.
- Plugin-to-Plugin calls use only a Host-mediated typed capability broker. Providers
  export versioned schemas; callers declare required/optional imports and version
  ranges; ActivePluginSet binds one exact provider snapshot. Lease caller and
  provider snapshots together, validate both principals and schemas, propagate
  cancellation, and bound concurrency, depth and re-entry. The callee never inherits
  caller grants. Reject required dependency cycles and never expose direct objects,
  Plugin-to-Plugin MessageChannels, a service locator, or first-provider-wins lookup.
- Post-publication OpenCode invalidation must run without the per-Plugin mutation
  lock because Agent startup resolves Hooks under that lock. After the hard refresh
  finishes, reacquire the lock and reconcile execution receipts and obsolete Hook
  snapshots against the latest installed package.
- Concrete generation or LLM vendors, models, credentials, and routing are never
  built into Convax packages. An installed Tool Plugin plus its explicitly
  authorized external executable is the complete vendor integration boundary; do
  not add vendor classes or a parallel provider registry. A v8 LLM contribution is
  generic display metadata. Desktop may translate its verified sidecar's Main-only,
  ephemeral loopback gateway into host-injected OpenCode configuration, while the
  Agent runtime remains unaware of Plugin identity and vendor credentials.
- A manifest-declared generation model may expose runtime model variants only by
  marking exactly one required top-level bounded string select in its MCP
  `tools/list.inputSchema` with `x-convax-role: generation-model-id`. Main expands
  that explicit catalog only after the owning service is connected, issues opaque
  concrete selection ids, removes the selector from ordinary custom controls, and
  revalidates plus binds its exact value immediately before execution. Never infer
  model identity from a field name, title, Plugin id, provider, or vendor value, and
  never let renderer `toolInput` override the Main-owned binding.
- A v8 Agent MCP contribution is a validated HTTPS remote-server declaration passed
  to OpenCode's native MCP client. Desktop owns installed-Plugin authority and a
  stable server-key mapping; `@convax/agent-runtime` owns only generic configuration
  injection and thin status/auth calls. Do not implement MCP transport, OAuth, tool
  proxying, or provider branches in Convax. Do not admit arbitrary local commands:
  they would bypass the verified companion receipt, launch snapshot, and process-tree
  lifecycle. Renderer status is a display-only Plugin-id projection. Successful
  authorization must invalidate OpenCode's directory-scoped MCP clients so every
  Project reconnects with the OpenCode-owned credential. A generic “use in Agent”
  action may focus the composer and attach one unambiguous owned Skill; it never
  calls a provider API or selects among multiple workflows.
- An official Registry Tool Plugin may declare a target-specific executable
  companion whose command exactly matches its manifest runtime. Desktop verifies
  the fixed Release URL, platform/architecture, size and SHA-256, publishes it to a
  private versioned host directory, and resolves it before an explicit `PATH`
  fallback. A companion beginning with the exact `#!/usr/bin/env convax-bun` header
  is a bundled Bun program run by Desktop's shared app-owned Bun runtime; all other
  companions retain native execution. Missing targets, runtimes, and
  immutable-identity byte changes fail closed.
- Agent, Toolbar/UI, and Plugin callers use the same Desktop-main generation tool
  executor. OpenCode is only the Agent-side tool client, not the execution owner or
  a dependency of direct product actions.
- A v8 text operation may return one bounded result to the Agent without mutating
  Canvas, but it must reuse the verified companion, staged-input, cancellation,
  stale-source and at-most-once execution boundary. A manifest-declared
  direct-incoming binding requires an owning node of the same installed Plugin and
  revalidates every input edge; neither behavior may branch on Plugin id.
- A v8 confirmation selection action may reuse a return-delivery text
  operation only for one authoritative Project-backed image or video selection,
  with one step and no input binding. Renderer visibility derives from Main's exact
  installed-version, execution-grant, runtime-preference and transition gate; the
  action never creates a Canvas node or branches on Plugin id.
- Do not expire an accepted generation job merely because it remains queued or
  running. Generation sidecars own vendor polling, bound individual network
  requests, and keep non-terminal work alive until success, explicit terminal
  failure, or caller cancellation. Host/Agent transports must not turn a healthy
  pending state into an absolute tool-call timeout.
- Node-targeted generation state is Canvas-owned portable metadata, distinct from
  the next-run tool preference and Plugin-owned state. Main persists submitting
  before the external call—including atomically with a host-created pending
  placeholder—accepts only structured bounded task receipts, and uses the Canvas
  application service for every transition. Recovery-capable tools use the standard
  Scheduler–Agent–Supervisor pattern over a durable Long-Running Operation contract;
  `operationId` is the idempotency/LRO identity and `taskId` is only an opaque
  downstream handle. A complete admitted LRO resumes or queries the same operation
  after restart; without it, restart marks orphaned active runs failed and never
  repeats a potentially billable call.
- A Tool Plugin may expose a user-global service surface through the same verified
  sidecar lifecycle. Service status and mutations use fixed host tool names and a
  strict display-only contract; renderer code never selects an MCP method or receives
  credentials, cookies, authorization URLs, native paths, or raw diagnostics.
- Browser-cookie authorization for a Tool Plugin is a fixed main-only exchange,
  never a generic MCP bridge. Use a fresh non-persistent sandboxed Electron session,
  require explicit confirmation, export only allowlisted cookie names for one exact
  HTTPS origin, and call only `service.authorization.complete` on the unchanged
  requesting runtime. Cancellation, timeout, sign-out, close and Plugin change clear
  the temporary session and fail closed; no request URL or cookie crosses preload.
- Treat an explicit Tool Plugin install/update as consent for only the normalized
  manifest and executable binding verified during that publication. The sole
  implicit-consent exception is an exact product-lock preinstall whose policy says
  `setup: automatic`: it must use the normal durable setup transition, may authorize
  only its verified managed companion, and must reject PATH fallback, Hooks,
  Services, extra Plugin capabilities, credentials, and any candidate that differs
  from the locked source, id, version, or target. Persist the binding kind, real
  path, size and SHA-256; runtime silently rechecks it and asks for reinstall on
  missing or changed state, never for first-call approval. Source refresh and
  background update never expand an existing automatic grant.
- Publish that explicit Plugin execution authorization in the same installation or
  update transition. Do not project a follow-up Marketplace setup action for an
  integrity/authorization mismatch: setup cannot repair missing or changed immutable
  Plugin bytes, which must be reinstalled through the exact-source package flow.
- A static Web Plugin without a companion or Hook still receives one exact
  installation authorization bound to its capability contract, package artifact,
  source identity and version. Startup may repair a missing Marketplace grant only
  when an existing source-bound InstallRecord exactly matches the current ActiveSet
  snapshot. Version, source or byte drift fails closed and routes to reinstall;
  never expose a manual Plugin setup action.
- Treat an explicit Hook-bearing Plugin install/update as consent to the normalized
  manifest and exact Hook bytes. Load only a private host-owned snapshot, never the
  mutable installed package path. Default provisioning and background updates must
  not authorize new or changed Hook bytes.
- Fingerprint the external Tool Plugin executable before staging aggregate-bounded
  inputs. Recheck live reference/revision guards immediately before a billable call.
  Launch the install-authorized entrypoint through a verified host-owned snapshot,
  terminate the whole process tree on disposal, and fail closed on platforms where
  the host lacks a process-tree ownership primitive.
- Generated content enters Canvas only through `CanvasResourceBusinessService` after
  Main publishes it without overwriting an existing object as a user-visible Project
  file under `Generated/`. Existing nodes reference that Project file. A failed
  Canvas commit retains the generated file and reports partial success; short-lived
  unpublished staging is cleaned later without a publication WAL.
- A Plugin-requested immediate generation result is a host-owned pending Canvas
  resource lifecycle. Canvas creates and commits the node id in Main before the
  external call, replaces it only through an exact content guard, and retains a
  bounded safe error on failure or cancellation. Renderer refresh is asynchronous
  and cannot delay this lifecycle. Plugins never choose the pending node id or
  replacement target, and deleted or edited placeholders are not revived.
- Reuse the existing Canvas file-renderer, command, menu, and node-toolbar
  registries. A Plugin surface is a `file` node; commands and placements derive only
  from validated generic contributions. `canvas.commands` is the canonical command
  registry. Toolbar and menu placements reference a command id and never duplicate
  title, icon, target, or behavior. A Plugin menu may appear only in its owning
  node's overflow surface. A command target is only one bounded
  `renderer-message`; Desktop delivers it to the exact owning iframe generation
  under an opaque frame lease. Icons are fixed Host tokens with a Host fallback,
  never Plugin markup or executable bytes. Do not add an extension bus, service
  locator, concrete Plugin branch, or node role to route Plugin behavior.
- Connected-input listing is pathless metadata only. Edge/source changes may
  invalidate a Plugin node's pending list but must never themselves authorize
  upload, Agent prompting, or any other external side effect.
- Project-wide Canvas authority is a main-owned, principal-bound broker capability,
  never a property of a Web node. `convax.plugin/8` declares separate Project,
  catalog, document-read, document-write, and event grants. Calls carry an explicit
  portable `{ projectId, canvasId }`, revalidate the installed manifest identity and
  catalog scope, and use the same Canvas application services as UI and Agent.
- Plugin document reads expose bounded geometry or portable structure projections;
  neither projection exposes native paths or resource bytes. Document transactions
  are revision-bound, command-bounded, atomic, and cannot admit/replace resources or
  forge resource references. Resource bytes and admission remain separate Project
  business capabilities.
- Third-party Web Plugin code is static content in an iframe with exactly
  `sandbox="allow-scripts"`. Never import it into the host, use Electron `webview`,
  enable same-origin/Node/Electron access, or expose a generic function-call bridge.
- A Web Plugin entry document and every HTML/CSS/JavaScript subresource reference
  must use a portable relative URL. The Host encodes the exact immutable Plugin
  identity in the document origin; root-relative, absolute, Plugin-id-derived, and
  version-derived asset URLs omit that identity and must fail closed rather than
  fall through to the current installation.
- The sole non-Web exception is an explicitly declared, separately authorized
  OpenCode Hook module. Keep it out of renderer/Electron imports, constrain the
  first ABI to one self-contained `.js`/`.mjs` file with no dynamic imports, and
  inject it only through OpenCode's native Plugin configuration before the host
  protected-path guard.
- Bind every MessageChannel to the exact installed Plugin and owning Web frame.
  Own-node methods additionally bind current Project, Canvas and node; Plugin node
  state writes stay inside that node's namespaced field. V8 Project/Canvas
  methods route through an opaque sender-scoped main connection and derive authority
  only from the installed principal and its declared grants, not from node ownership.
- Durable Plugin resources use host-owned typed node bindings; opaque Plugin state
  stores only their binding keys and never grants asset liveness by containing a
  path or hash.
- Bound in-flight Plugin RPC before asynchronous connection/subscription work. Tool
  and Agent cancellation must cross queue and preparation boundaries and be checked
  immediately before any Canvas persistence call.
  Check permissions, message size, stale scope and target on every call.
- Connected Plugin inputs must be derived from direct incoming Canvas edges. Never
  accept a caller-supplied Project path or widen that access to unrelated nodes;
  use the bounded Main-owned typed Project-resource reader and recheck the exact edge and
  source reference afterward.
- Gate browser feature-policy exceptions such as fullscreen through an explicit
  manifest capability. Preserve every unrelated iframe permission denial.
- Direct Plugin calls are thin adapters over existing typed Project, Canvas and
  Agent capabilities. They do not read private JSON or recreate domain invariants.

## Desktop and IPC rules

- Main owns native filesystem, Electron, Project Node adapters, and Agent runtime.
- Preload exposes a narrow typed bridge. Renderer code must not import Node/Electron.
- Renderer Canvas persistence exposes authoritative load plus command execution,
  never a whole-document save. Every Main commit publishes a revision invalidation;
  renderer reload/reveal is projection work whose failure cannot undo domain success.
- Native file drag-out uses a short-lived sender-scoped opaque ticket: Main validates
  the live managed Canvas media selection, stages host-owned copies, and synchronously
  starts Electron's drag. Renderer/preload never receive native paths, and targets
  such as Finder or JianYing must not introduce UI automation branches.
- Keep bridge namespaces separate: `projects`, `projectFiles`, `projects.canvases`,
  `canvas`, `generation`, `agent`, `plugins`, `pluginCapabilities`, and
  `pluginServices`; keep IPC prefixes
  `project:*`, `project-files:*`, `project:canvas-*`, `canvas:*`, `generation:*`,
  `agent:*`, `plugin:*`, and `plugin-service:*`.
- Bump the Desktop protocol version and update its compatibility tests when the
  preload/main contract changes incompatibly.
- Desktop may coordinate packages, but reusable state machines and business rules
  must be pushed down to their owner and injected back through ports.

## Cross-platform and security rules

- All logical Project paths crossing contracts use normalized POSIX separators and
  are relative to a Project. Native adapters convert with `node:path`.
- Never concatenate file URLs or hard-code `/home`, `/tmp`, drive letters, or `/` as
  a host separator. Use Electron/OS directories and `pathToFileURL` where needed.
- Validate Windows drive/UNC paths, backslash traversal, reserved device names,
  alternate data streams, trailing dots/spaces, and case-insensitive `.convax`.
- Resolve and verify real paths at native trust boundaries; tests must cover symlink
  replacement for protected/private writes.
- Do not weaken protected-path or scope checks to make an Agent workflow convenient.

## Repository mechanics

- Use Bun for dependencies and scripts; keep the Turbo monorepo under `packages/*`.
- Convax is independent. Do not copy or modify OpenCode source; integrate only via
  its published packages behind `@convax/agent-runtime`.
- Preserve user changes and generated/local Project data. Never commit root
  `.convax/` runtime state.
- Keep the `package-boundaries` push/PR check enabled and required on protected
  branches. Do not weaken the policy to make a feature branch pass.
- Keep commits coherent and reviewable. Split changes when it improves clarity,
  not to satisfy an arbitrary line-count limit.
- Use conventional commit messages such as `feat(workbench): add part layout guard`.
