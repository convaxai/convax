# Convax Development Contract

This is the repository-wide operational contract for human and AI contributors.
Keep it focused on routing, ownership, and rules that apply to every change.
[`docs/architecture.md`](docs/architecture.md) is the canonical architecture
contract; area and process-level `AGENTS.md` files add change-time instructions for
their own scope.

## Repository shape

- `packages/desktop`: private Electron application and composition root.
- `packages/agent-runtime`: host-agnostic OpenCode integration.
- `packages/canvas`, `packages/project`, `packages/project-files`, and
  `packages/workbench`: product domain and coordination packages.
- `packages/bounded-value`, `packages/uri`, and `packages/collaboration`: pure
  portable value, URI, and Yjs collaboration kernels.
- `packages/plugin-api`, `packages/plugin-sdk`, and `packages/plugin-ui`: published
  Plugin Host contracts, authoring ABI, and browser-safe Plugin UI foundations.
- `packages/marketplace`, `packages/marketplace-kit`, and
  `packages/create-convax-marketplace`: Marketplace protocol and authoring tools.
- `packages/ui`: product-agnostic visual primitives and theme.
- `apps/api`, `apps/web`, `apps/deploy-cloudflare`, and `apps/docs`: independent
  control-plane API, product Web, deployment, and documentation surfaces.

This repository owns the Convax Host and platform. Concrete Plugins, Plugin-owned
Skills, standalone Skills, MCP servers, and companion tools belong in the sibling
`../convax-plugins` repository. Existing packages under
`packages/desktop/resources/plugins` are legacy or mechanically generated bootstrap
inputs, not an authoring precedent.

## Instruction routing

Before planning or editing:

1. Read this file.
2. Read the closest `AGENTS.md` for every file in scope.
3. Follow the module-name routes below even when the request names a concept rather
   than a path.
4. Read only the routed architecture references needed for the task. Do not treat
   every architecture section as equal active context.

More specific files add local rules. They do not override repository ownership,
dependency direction, security, the Plugin-to-Host gate, or canonical architecture.
If instructions and canonical architecture appear inconsistent, stop and resolve
the contract instead of choosing the more convenient interpretation.

### Route by path

| Path                                    | Required local instruction                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/**`          | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md), then [`packages/desktop/src/main/AGENTS.md`](packages/desktop/src/main/AGENTS.md)         |
| `packages/desktop/src/preload/**`       | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md), then [`packages/desktop/src/preload/AGENTS.md`](packages/desktop/src/preload/AGENTS.md)   |
| `packages/desktop/src/renderer/**`      | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md), then [`packages/desktop/src/renderer/AGENTS.md`](packages/desktop/src/renderer/AGENTS.md) |
| Other `packages/desktop/**`             | [`packages/desktop/AGENTS.md`](packages/desktop/AGENTS.md)                                                                                            |
| `packages/plugin-api/**`                | [`packages/plugin-api/AGENTS.md`](packages/plugin-api/AGENTS.md)                                                                                      |
| `packages/plugin-sdk/**`                | [`packages/plugin-sdk/AGENTS.md`](packages/plugin-sdk/AGENTS.md)                                                                                      |
| `packages/plugin-ui/**`                 | [`packages/plugin-ui/AGENTS.md`](packages/plugin-ui/AGENTS.md)                                                                                        |
| `packages/agent-runtime/**`             | [`packages/agent-runtime/AGENTS.md`](packages/agent-runtime/AGENTS.md)                                                                                |
| `packages/canvas/**`                    | [`packages/canvas/AGENTS.md`](packages/canvas/AGENTS.md)                                                                                              |
| `packages/project/**`                   | [`packages/project/AGENTS.md`](packages/project/AGENTS.md)                                                                                            |
| `packages/project-files/**`             | [`packages/project-files/AGENTS.md`](packages/project-files/AGENTS.md)                                                                                |
| `packages/bounded-value/**`              | [`packages/bounded-value/AGENTS.md`](packages/bounded-value/AGENTS.md)                                                                                |
| `packages/uri/**`                        | [`packages/uri/AGENTS.md`](packages/uri/AGENTS.md)                                                                                                    |
| `packages/collaboration/**`              | [`packages/collaboration/AGENTS.md`](packages/collaboration/AGENTS.md)                                                                                |
| `packages/workbench/**`                 | [`packages/workbench/AGENTS.md`](packages/workbench/AGENTS.md)                                                                                        |
| `packages/marketplace/**`               | [`packages/marketplace/AGENTS.md`](packages/marketplace/AGENTS.md)                                                                                    |
| `packages/marketplace-kit/**`           | [`packages/marketplace-kit/AGENTS.md`](packages/marketplace-kit/AGENTS.md)                                                                            |
| `packages/create-convax-marketplace/**` | [`packages/create-convax-marketplace/AGENTS.md`](packages/create-convax-marketplace/AGENTS.md)                                                        |
| `packages/ui/**`                        | [`packages/ui/AGENTS.md`](packages/ui/AGENTS.md)                                                                                                      |
| `apps/api/**`                           | [`apps/api/AGENTS.md`](apps/api/AGENTS.md)                                                                                                            |
| `apps/web/**`                           | [`apps/web/AGENTS.md`](apps/web/AGENTS.md)                                                                                                            |
| `apps/deploy-cloudflare/**`             | [`apps/deploy-cloudflare/AGENTS.md`](apps/deploy-cloudflare/AGENTS.md)                                                                                |
| `apps/docs/**`                          | [`apps/docs/AGENTS.md`](apps/docs/AGENTS.md)                                                                                                          |

### Route by module name

| Request or changed concept                                                               | Read before planning or editing                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package ownership, dependency direction, new package, public exports                     | [`docs/architecture.md` §3](docs/architecture.md#3-packages-and-dependency-graph) and the owning area contract                                                                                                                                                                       |
| Project, Project Files, Canvas, Workbench, active input, selection, document persistence | [`docs/architecture.md` §§2, 4–6](docs/architecture.md#2-terms) and the relevant domain contracts                                                                                                                                                                                    |
| Host API, Catalog release, schema, API availability, generated Plugin API docs           | [`docs/plugin-host-change-governance.md`](docs/plugin-host-change-governance.md), [`packages/plugin-api/AGENTS.md`](packages/plugin-api/AGENTS.md), and [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md)                                                             |
| Plugin manifest, contribution, inter-Plugin export/import, SDK authoring                 | [`packages/plugin-sdk/AGENTS.md`](packages/plugin-sdk/AGENTS.md), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and [`docs/plugin-canvas-capabilities.md`](docs/plugin-canvas-capabilities.md)                                                                   |
| Plugin document styling, semantic tokens, sandbox-safe UI foundations                    | [`packages/plugin-ui/AGENTS.md`](packages/plugin-ui/AGENTS.md) and the Plugin SDK contract                                                                                                                                                                                           |
| Agent, OpenCode, Skill, Hook, Agent tool, protected path                                 | [`docs/architecture.md` §§7–8](docs/architecture.md#7-agent-tools-and-skills), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and [`packages/agent-runtime/AGENTS.md`](packages/agent-runtime/AGENTS.md)                                                          |
| MCP, Agent MCP, remote server, OAuth, managed stdio                                      | [`docs/architecture.md` “MCP Server runtime boundary”](docs/architecture.md#mcp-server-runtime-boundary), §§7–8, and the Agent Runtime/Desktop Main contracts                                                                                                                        |
| Collaboration, Yjs, ProjectIndex, Canvas shard, PeerJS, checkpoint, causal floor         | [`docs/architecture.md` §§2–6](docs/architecture.md#2-terms), the frozen R5 authority, and the Canvas/Collaboration/Project/Desktop/API contracts                                                                                                                                    |
| Marketplace, Registry, SourceKey, install, snapshot, ActiveSet, provisioning, recovery   | [`docs/architecture.md` §§5–6](docs/architecture.md#5-persistence-map), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and the Marketplace/Desktop Main contracts                                                                                                 |
| Plugin Host, iframe, broker, MessageChannel, Project/Canvas grant                        | [`docs/architecture.md` §8](docs/architecture.md#8-plugin-host-boundary), [`docs/plugin-canvas-capabilities.md`](docs/plugin-canvas-capabilities.md), and the Desktop process contracts touched                                                                                      |
| Generation, model selection, sidecar, service, LRO, `operationId`, `taskId`              | [`docs/architecture.md` “Generation tool boundary”](docs/architecture.md#generation-tool-boundary), [`docs/generation-tool-plugins.md`](docs/generation-tool-plugins.md), and [`docs/canvas-node-generation-state-persistence.md`](docs/canvas-node-generation-state-persistence.md) |
| Electron, IPC, preload, `window.convax`, protocol version                                | [`docs/architecture.md` §10](docs/architecture.md#10-electron-boundary) and all touched Desktop process contracts                                                                                                                                                                    |
| Portable/native paths, filesystem trust, Windows path handling                           | [`docs/architecture.md` §11](docs/architecture.md#11-portable-paths-and-trust-boundaries) and the owning native-adapter contract                                                                                                                                                     |
| External editor, retired built-in, native media drag-out                                 | [`docs/architecture.md` “Retired built-ins” and “Native Canvas media drag-out”](docs/architecture.md#retired-built-ins), then the Desktop Main/Renderer contracts                                                                                                                    |

## Required workflow

1. Name the owning package before writing code. If ownership is unclear, resolve the
   boundary instead of placing the change in Desktop, a nearby file, or a new helper
   bucket.
2. Trace the current public capability and its callers. Reuse it or add the smallest
   typed port to the owner; do not reach through private files, copy business logic,
   or introduce a hidden global/service locator.
3. Keep domain logic headless. Electron, React, filesystem, browser storage, and
   network behavior belong at explicit adapters.
4. Add tests at the ownership boundary. Cover the failure, cancellation, stale async
   response, migration, recovery, and platform cases relevant to the change.
5. Perform a documentation impact check. Update canonical architecture and local
   contracts in the same change when ownership, data flow, persistence, public
   protocol, directory responsibility, or validation requirements change.
6. Run focused checks during iteration, then the required package and repository
   checks before handoff.

## Frozen collaboration v10 authority

Collaboration v10 authority is selected only through
[`docs/superpowers/specs/collaboration-v10-active-authority.json`](docs/superpowers/specs/collaboration-v10-active-authority.json).
The pointer is separate from the selected release and may select the fixed Route F
revision directory
[`docs/superpowers/specs/authorities/collaboration-v10/r5/`](docs/superpowers/specs/authorities/collaboration-v10/r5/)
only after its complete release validates. R5's exact fifteen-file snapshot is the
seven whole-file members named by `authority.sha256`, that manifest itself,
`review-evidence.json`, and the three fixed report/receipt pairs under `reviews/`.
The active pointer is never a snapshot member.

The frozen R5 release identities are:

- `authority.sha256` SHA-256
  `2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed`;
- `review-evidence.json` SHA-256
  `9a781faaa3ed28963066ba3ef28eb4367611568042bb14929feab5c2c884d678`;
- `protocol-schema-bundle-v2.json` SHA-256
  `163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786`;
- `ProtocolSchemaBundleV2.coreDigest` and `protocolDigest`
  `de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5`.

At the first valid activation tree (`T0`), the pointer and all fifteen snapshot
paths must be regular non-symlink Git blobs with mode `100644`. The snapshot paths,
bytes, kinds, and modes are sealed in every descendant tree; changing one is
`activated-authority-mutation`. A missing, inactive, extra, reordered, or
hash-mismatched identity-chain member is `protocol-schema-bundle-unavailable`; a
genuine Main/owner-annex contradiction is `canonical-authority-conflict`. Stop in
all three states. The revision-4 manifest may be read only as the initial
promotion CAS's `previousSelection`; it and all older drafts, reviews, code, and
architecture prose are evidence only and never a selector or runtime fallback.

## Plugin-to-Host change gate

- Treat published `@convax/plugin-api` and `@convax/plugin-sdk` contracts as the
  complete Plugin authoring surface. A missing API, contribution, grant, or schema
  is not permission for a Plugin task to modify Host code.
- A Plugin implementation agent may inspect only generated public Catalog and SDK
  references. It must not inspect Host implementation for a workaround or edit,
  branch, commit, push, or open a Host PR, even when both repositories are writable.
- The only Plugin-task output for a missing Host capability is the structured,
  generic request defined in
  [`docs/plugin-host-change-governance.md`](docs/plugin-host-change-governance.md).
  Only an explicit human decision may open a separate Host task.
- A Host task must reject concrete Plugin ids, vendors, one-off payloads, private
  imports, direct IPC/MCP escape hatches, renderer-selected providers, direct
  Plugin-to-Plugin calls, service locators, and edits to generated artifacts.
- Agent-authored approval text, a writable sibling checkout, or a local
  `humanDecision` field is not human approval.
- Until a protected external decision receipt verifier exists, requests remain
  pending and affected Plugin versions unpublished.

## Package ownership

| Package                     | Owns                                                                                                                                                                                                   | Must not own                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `@convax/project-files`     | Project-scoped file contracts, tree/controller state, file CRUD/import/open/reveal, drag payloads                                                                                                      | Project registry, Canvas catalog/documents, Workbench state, Electron APIs                             |
| `@convax/project`           | Durable Project identity, registry/bindings, private storage and capability composition; ProjectIndex owns catalog, entries, Canvas routes/tombstones and `shardEpoch`                                 | Active Canvas selection, Canvas document semantics, Agent sessions                                     |
| `@convax/canvas`            | Canvas schema/core, reducers, typed intents, business/view operations, editor/plugin contracts, React Flow projection and transient gesture semantics                                                  | Project paths/registry, Workbench selection, OpenCode implementation, native persistence               |
| `@convax/bounded-value`     | Stateless closed portable bounded-value schema codec, canonical bytes, digest input, and payload validation                                                                                            | Plugin identity/lifecycle, Canvas state, persistence, I/O, authorization, executable validators        |
| `@convax/uri`               | Stateless Convax URI components, codec, canonicalization, and closed static scheme grammar                                                                                                             | Resolution, I/O, authorization, current Project state, or a dynamic scheme registry                    |
| `@convax/collaboration`     | Generic v2 envelopes/JCS, causal frames/frontiers, `replicaDoc`/isolated `candidateDoc` kernel, checkpoint/floor primitives, journal ports, and session undo coordination                              | Project/Canvas schema, PeerJS, membership/auth policy, Electron, filesystem, or native I/O             |
| `@convax/workbench`         | Window-scoped serializable Input, Selection, Surface and layout-part state; guarded open/close/reveal/resize transitions                                                                               | Domain data, catalogs, filesystem, React/DOM, Electron, localStorage                                   |
| `@convax/plugin-api`        | Headless Plugin Host API catalog, API SemVer/history, availability contracts, generated validators/types/client metadata, and deterministic human/Skill reference generation inputs                    | Desktop state, Plugin identity policy, concrete handlers, filesystem/network adapters                  |
| `@convax/plugin-sdk`        | Headless `convax.plugin/8` manifest and contribution ABI, Plugin-to-Plugin export/import contracts, bounded-value schema integration, SemVer matching, and deterministic Plugin/Skill reference inputs | ActiveSet selection, runtime binding, leases, grants, execution, IPC, I/O, concrete Plugins            |
| `@convax/plugin-ui`         | Browser-safe semantic tokens and minimal interaction foundations for sandboxed Plugin documents                                                                                                        | React, Desktop appearance state, Host transport, or concrete Plugin composition                        |
| `@convax/agent-runtime`     | Generic OpenCode adapter, sessions, resources, tool-provider bridge, protected-path enforcement                                                                                                        | Convax Project/Canvas/UI policy or imports from other Convax packages                                  |
| `@convax/marketplace`       | Marketplace refs, public schemas, canonical source identity, strict validation, Catalog aggregation and source-conflict rules                                                                          | Filesystem/network adapters, Electron/UI, concrete packages, installation or execution                 |
| `@convax/marketplace-kit`   | Deterministic authoring-time package, Registry, Showcase, bundle and companion metadata generation                                                                                                     | Desktop runtime, concrete marketplace content, credentials, or executing package bytes                 |
| `create-convax-marketplace` | Authoring-time scaffold CLI backed by `@convax/marketplace-kit`                                                                                                                                        | Runtime Marketplace state, publishing credentials, or a second validator                               |
| `@convax/ui`                | Product-agnostic visual primitives and theme                                                                                                                                                           | Project, Canvas, Workbench, Agent, persistence, or Electron behavior                                   |
| `@convax/desktop`           | Electron composition root, native adapters, PeerJS data plane, IPC/preload, renderer shell, user preferences, concrete cross-package wiring                                                            | New reusable domain semantics or a competing React Flow document store                                 |
| `@convax/api`               | Web-standard membership, replica enrollment/edit authorization, sessions/rendezvous, stateless attestation, checkpoint/floor, registry, and cutoff control-plane authority                             | Project/Canvas payload bytes, PeerJS transport, ordinary edit order, Desktop/UI, or deployment secrets |
| `@convax/web`               | Public Convax marketing site, product storytelling, responsive presentation, and public conversion links                                                                                               | Desktop runtime, product domain state, Cloudflare deployment, or API behavior                          |
| `@convax/deploy-cloudflare` | Cloudflare deployment composition, custom-domain routing, static Web assets, and the future `/api` service-binding edge                                                                                | Marketing presentation, API domain logic, credentials, or Desktop behavior                             |
| `@convax/docs`              | Independently deployed public documentation site and agent-readable documentation outputs                                                                                                              | Product runtime state, canonical architecture semantics, Desktop behavior, or API logic                |

`Workspace` is intentionally not a current aggregate. Reserve that name for a
future window/session that coordinates multiple Projects. Do not recreate a
`workspace` package merely to hold Project–Canvas relationships.

## Dependency direction

`bun run package:boundaries` enforces:

```text
desktop ──> agent-runtime, canvas, collaboration, marketplace, plugin-api, plugin-sdk, project, project-files, uri, ui, workbench
create-convax-marketplace ──> marketplace-kit
marketplace-kit ──> marketplace, plugin-api, plugin-sdk
plugin-sdk ──> bounded-value, plugin-api
plugin-ui ──> no Convax package
project ──> canvas, collaboration, project-files, uri, ui
canvas  ──> bounded-value, collaboration, uri, ui
project-files ──> uri
collaboration ──> no Convax package; it may declare external `yjs`
bounded-value, uri ──> no Convax package
agent-runtime, marketplace, plugin-api, plugin-ui, ui, workbench ──> no Convax package
apps/api ──> collaboration and the browser-safe project/collaboration-protocol export only
deploy-cloudflare ──> web; api only through an explicit Cloudflare Service Binding
docs ──> no Convax package
```

- Import another package only through an exported package subpath.
- Never use a relative path that escapes a package.
- Only `@convax/agent-runtime` may import `opencode-ai` or `@opencode-ai/*`.
- Node-only exports such as `@convax/project/node` and
  `@convax/agent-runtime/node` are Desktop Main adapters, never Renderer imports.
- A graph change is an architecture decision. Update this file, canonical
  architecture, local contracts, automated policy, and tests together.

Independent means a library can be built, type-checked, tested, packed, and consumed
from a clean external project using only declared public APIs and dependencies. New
library packages require one coherent owner, compiled `dist` exports, a real
version, explicit minimal dependencies, a local `AGENTS.md`, and package-local
`build`, `clean`, `typecheck`, `test`, `prepack`, and `prepublishOnly` scripts.
`@convax/desktop` is the only private product runtime package under `packages/*`;
private applications under `apps/*` are delivery surfaces. `@convax/bounded-value`,
`@convax/uri`, and `@convax/collaboration` are independently publishable headless
libraries; Collaboration may depend on external `yjs` but no Convax package. Tests use injected fakes
and never depend on Desktop, ambient monorepo state, global registration, or a real
user directory.

## Repository-wide hard rules

- UI, Agent, Plugin, and native entry points call the same owner-defined application
  or business operations. Edge adapters do not recreate domain invariants.
- Main's per-shard `replicaDoc`, rebuilt from accepted durable causal objects, is
  the sole local ProjectIndex/Canvas document authority. A command mutates only an
  isolated `candidateDoc`; the exact final signed frame crosses the
  object/outbox/journal/head barrier before entering `replicaDoc`.
- ProjectIndexYDoc is the only Project route/tombstone and current `shardEpoch`
  authority. The service registry is bounded anti-rollback/discovery metadata only;
  it never grants, denies, adds, removes, or blocks a Project floor scope. Each
  CanvasYDoc owns that Canvas; no JSON mirror or single revision counter spanning
  the document is a parallel authority.
- Checkpoint pruning requires both a service content certificate and exact causal
  floor ACK coverage from every active editor in the bound membership snapshot.
  Missing either gate retains history while editing and replication continue.
- React Flow document projection, measurements, selection, viewport, and gesture
  previews are transient and owned by `@convax/canvas`. UI, Agent, and Plugin callers
  submit the same closed typed intents; raw Yjs updates, full-state replacements,
  and caller-selected identities are forbidden.
- Offline commits create final frame bytes immediately. PeerJS reconnect transports
  those same bytes and never replays the business command, renumbers, or re-signs it.
- Renderer may retain and persist one bounded, versioned, last-complete Marketplace
  display projection so remounts and cold windows render immediately. It must
  revalidate through Main at window startup and never use that projection as
  installation, source, grant, or runtime authority.
- Renderer may likewise persist one bounded, versioned, last-complete Plugin Service
  display projection containing only validated summaries, status, credits, and
  optional usage history. It renders that projection immediately, refreshes status
  and usage independently in the background, and never treats it as authorization,
  execution availability, Checkout, or billing authority.
- `WorkbenchController` is the sole active Input/Canvas source.
  `ProjectCanvasController` owns catalog CRUD, never active selection.
- Only `@convax/project/node` may read or write private Project metadata. Renderer,
  Preload, Agent tools, and general file operations use typed capabilities and never
  edit `.convax` JSON.
- Unsupported portable data is never silently reset, overwritten, migrated, deleted,
  or garbage-collected. Breaking cutovers require an explicit schema/protocol bump,
  preserved bytes, and rejection tests.
- File publication and Canvas mutation are not one transaction. Publish without
  clobbering first; if Canvas commit fails, retain the file and report partial
  success rather than inventing a cross-file WAL.
- Generation input staging may accept an already validated Project resource while
  `.convax/staging` retains an unchanged positive hard-link count. Executable
  snapshots, sidecar outputs, and every other native copy remain single-link; any
  identity, count, size, timestamp, or real-path drift fails closed.
- `convax.plugin/8`, `convax.package/2`, and `convax.plugin-capability/3` are the only
  admitted runtime formats. Additive Host APIs evolve through the independent
  `@convax/plugin-api` SemVer Catalog, not another manifest or transport version.
- A Plugin installation is one content-addressed complete closure selected through
  one global ActiveSet CAS. Runtime principals and leases bind exact revisions,
  ActiveSet digests, and snapshot digests; never reconstruct authority by scanning
  mutable Plugin, Skill, Hook, companion, or authorization directories.
- Product-lock recovery artifacts are bounded offline inputs only for an explicit
  retired-major update whose inspected source, id, old version, archive identity,
  snapshot digest, and Host API major all match. They are never preinstalls,
  directory-discovered fallbacks, or executable before restart revalidation.
- Plugin contributions and Host API calls are orthogonal and grant no implicit
  authority to each other. Plugin-to-Plugin calls use only the typed Host broker;
  never expose direct objects, direct MessageChannels, service locators, or
  first-provider-wins lookup.
- Plugin identity is routing/namespacing data only. Runtime semantics derive from
  validated contributions and never branch on a concrete Plugin id, vendor, model,
  provider, or credential.
- Tools are narrow typed capabilities. Skills compose them; they do not bypass
  package APIs, grant Plugin/native authority, or become a second implementation.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, trusted sender
  validation, scope checks, protected paths, and least-authority IPC.
- Contract paths are normalized Project-relative POSIX paths. Native adapters alone
  convert them and validate containment, real paths, symlink replacement, Windows
  drive/UNC forms, traversal, device names, alternate streams, trailing dots/spaces,
  and case-insensitive `.convax`.
- Use Electron/OS directories and `pathToFileURL`; never concatenate file URLs or
  hard-code `/home`, `/tmp`, drive letters, or `/` as a native separator.
- The selected frozen collaboration R5 release must validate before decode, sign,
  reset, or mutation. Missing, drifted, extra, or contradictory authority fails
  closed; drafts and prior implementations are never runtime fallbacks.
- Preserve user changes and generated/local Project data. Never commit root
  `.convax/` runtime state.

## Validation

- Affected package or app: run its local `typecheck` and `test`; run `build` when its
  local contract requires it.
- Public exports or dependency changes: run root `bun run pack:check`.
- Package ownership or dependency changes: run root `bun run package:boundaries`.
- Desktop Main/Preload/Renderer changes: run Desktop `bun run build`.
- Project open, persistence, IPC, migration, or breaking cutover: run Desktop
  `bun run smoke:open-project`.
- Package-boundary, public API, persistence, IPC, or Desktop composition changes:
  run root `bun check` before handoff.

## Repository mechanics

- Use Bun and keep repository apps under `apps/*` and packages under `packages/*`.
- Convax integrates with published OpenCode packages only; do not copy or modify
  OpenCode source.
- Keep the `package-boundaries` push/PR check required. Do not weaken policy to make
  a branch pass.
- Keep commits coherent and reviewable. Use conventional messages such as
  `feat(workbench): add part layout guard`.
