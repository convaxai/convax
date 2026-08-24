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
- `.agents/skills`: repository-local contributor workflow instructions and bounded
  automation; these are not product-installed standalone or Plugin-owned Skills.

This repository owns the Convax Host and platform. Concrete Plugins, Plugin-owned
Skills, standalone Skills, MCP servers, and companion tools belong in the sibling
`../convax-plugins` repository. Existing packages under
`packages/desktop/resources/plugins` are legacy or mechanically generated bootstrap
inputs, not an authoring precedent.

The repository-local `solo-task` contributor workflow may create an isolated Git
worktree, copy only local `.env*` regular files, use the repository package-manager
cache through a frozen install, and deliver a reviewed branch and pull request. It
must never symlink another checkout's dependency tree, merge, release, force-push,
or treat a contributor workflow Skill as a shipped Convax capability.

### Repository contributor Skills

| Skill                                                                              | Canonical use                                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`solo-task`](.agents/skills/solo-task/SKILL.md)                                   | Isolated worktree preparation, validation, commit, push, and pull-request delivery.                                                         |
| [`govern-convax-architecture`](.agents/skills/govern-convax-architecture/SKILL.md) | Package ownership, dependency, public contract, state, persistence, trust-boundary, and architecture-document governance.                   |
| [`find-simplifications`](.agents/skills/find-simplifications/SKILL.md)             | Evidence-backed dead/duplicate/speculative surface audits, consumer classification, lifecycle review, and bounded simplification decisions. |

These Skills are complementary. `find-simplifications` owns candidate evidence and
decision quality, `govern-convax-architecture` owns architecture impact, and
`solo-task` remains the only contributor workflow for worktree and pull-request
delivery. They never become product-installed Skills or runtime authority.

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
| `packages/bounded-value/**`             | [`packages/bounded-value/AGENTS.md`](packages/bounded-value/AGENTS.md)                                                                                |
| `packages/uri/**`                       | [`packages/uri/AGENTS.md`](packages/uri/AGENTS.md)                                                                                                    |
| `packages/collaboration/**`             | [`packages/collaboration/AGENTS.md`](packages/collaboration/AGENTS.md)                                                                                |
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
| Collaboration, Yjs, ProjectIndex, Canvas shard, PeerJS, checkpoint, causal floor         | [`docs/architecture.md` §§2–6](docs/architecture.md#2-terms), the single current protocol descriptor, and the Canvas/Collaboration/Project/Desktop/API contracts                                                                                                                     |
| Marketplace, Registry, SourceKey, install, snapshot, ActiveSet, provisioning, recovery   | [`docs/architecture.md` §§5–6](docs/architecture.md#5-persistence-map), [`docs/plugin-skill-platform.md`](docs/plugin-skill-platform.md), and the Marketplace/Desktop Main contracts                                                                                                 |
| Plugin Host, iframe, broker, MessageChannel, Project/Canvas grant                        | [`docs/architecture.md` §8](docs/architecture.md#8-plugin-host-boundary), [`docs/plugin-canvas-capabilities.md`](docs/plugin-canvas-capabilities.md), and the Desktop process contracts touched                                                                                      |
| Generation, model selection, sidecar, service, LRO, `operationId`, `taskId`              | [`docs/architecture.md` “Generation tool boundary”](docs/architecture.md#generation-tool-boundary), [`docs/generation-tool-plugins.md`](docs/generation-tool-plugins.md), and [`docs/canvas-node-generation-state-persistence.md`](docs/canvas-node-generation-state-persistence.md) |
| Electron, IPC, preload, `window.convax`, protocol version                                | [`docs/architecture.md` §10](docs/architecture.md#10-electron-boundary) and all touched Desktop process contracts                                                                                                                                                                    |
| Desktop application update, signing, notarization, release feed                          | [`docs/architecture.md` §§6 and 10](docs/architecture.md#desktop-application-update), [`docs/desktop-builds.md`](docs/desktop-builds.md), and the Desktop Main contract                                                                                                              |
| Portable/native paths, filesystem trust, Windows path handling                           | [`docs/architecture.md` §11](docs/architecture.md#11-portable-paths-and-trust-boundaries) and the owning native-adapter contract                                                                                                                                                     |
| External editor, retired built-in, native media drag-out                                 | [`docs/architecture.md` “Retired built-ins” and “Native Canvas media drag-out”](docs/architecture.md#retired-built-ins), then the Desktop Main/Renderer contracts                                                                                                                    |
| Simplification, cleanup, dead code, duplicate state, dependency replacement              | [`.agents/skills/find-simplifications/SKILL.md`](.agents/skills/find-simplifications/SKILL.md), the relevant architecture sections, and every affected owner contract                                                                                                                |

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
7. For simplification work, classify production, non-production, and
   ambiguous/dynamic consumers before removal. Static-analysis output is a lead,
   not proof across published, persisted, generated, or dynamically registered
   surfaces.

## Single current collaboration protocol

Convax ships exactly one current collaboration protocol. `@convax/collaboration`
owns one kernel, one frame codec, one restricted JCS canonicalization, and one
current protocol descriptor whose exact `protocolDigest` is the only protocol
identity. Canvas owns one Canvas schema and reducer, Project owns one ProjectIndex
schema and reducer, and Desktop packages and loads that one descriptor.

- There is no authority selector, active/pinned release pair, dual-version
  dispatcher, promotion bridge, successor runtime, or predecessor decoder on an
  opened Project. A sealed migration-only reader may recognize the one exact
  immediate predecessor during the pre-open gate; it is not a selectable runtime
  protocol and cannot decode any other identity.
  Production runtime, build, and packaging never derive protocol behavior from a
  release directory, a pointer file, a durable record shape, or directory presence.
- Each current schema artifact is a generated exact restricted-JCS review record
  containing its owner, semantic contract and sorted exact-file SHA-256 source
  closure. Repository checks reproduce the artifact bytes, their domain-separated
  digests and the one descriptor anchor. Runtime never reads those source manifests;
  they make the current literals auditable without activating an archived release.
- A new Project creates its current ProjectIndex genesis directly and each new
  Canvas creates its current Canvas genesis directly. There is no earlier genesis
  followed by a later promotion, and sharing does not change protocol.
- The same current frame and Canvas-genesis codecs carry an explicit
  `local-project-owner` or `team-replica` signer-authority mode. An unshared durable
  local owner may create/edit ProjectIndex and Canvas data offline; a durable Team
  binding disables new local-owner signing but never selects another protocol.
- Local and Team signing private keys are explicit user-managed files below Electron
  `userData`; Desktop never calls a system credential vault. If an unshared
  Project's current local key is missing, Desktop durably creates a fresh
  replica/actor binding in the same Project epoch, archives the prior public binding
  for historical verification, atomically makes the new binding current, and keeps
  editing. It never reads retired vault ciphertext, rewrites or re-signs history, or
  treats key rotation as a protocol or Project reset.
- Frame magic, wire format, and `protocolDigest` must equal the built descriptor
  after the pre-open gate. The gate may migrate only the code-pinned exact immediate
  predecessor: it validates the complete old causal/signature closure, rebuilds
  semantic owner state under the one current protocol in a same-filesystem staging
  tree, verifies that tree by reopening it, and atomically publishes it. Successful
  publication removes the transient rollback tree; it does not retain an archive.
  Unknown identities, corrupt bytes, missing Team authority, and any failed or
  ambiguous migration remain unchanged and become recovery/unsupported data. They
  are never guessed, reset, deleted, re-signed as a local owner, or passed to a
  second runtime decoder.
- Version-suffixed identifiers still present in this repository are legacy names of
  that one current implementation. Renaming them is mechanical cleanup and never
  admits a second protocol, decoder, kernel, or reducer.
- Independent contracts such as `convax.plugin/8` and `convax.plugin/9`,
  `convax.package/2`, the
  `@convax/plugin-api` Catalog SemVer, Marketplace Registry v2, and
  `desktopProtocolVersion` are separate release lines. This rule neither renumbers
  them nor lets them become collaboration decoders.

### Frozen collaboration authority archive

[`docs/superpowers/specs/collaboration-v11-active-authority.json`](docs/superpowers/specs/collaboration-v11-active-authority.json)
and every release below `docs/superpowers/specs/authorities/**`, including
[`R1`](docs/superpowers/specs/authorities/collaboration-v11/r1/) with its
sixteen verified snapshot paths and its pinned predecessor chain, are
**non-runtime archive and review material**. They record a retired multi-release
model. Production runtime, build scripts, and packaging must not read, stage, copy,
or import them, and no code may select behavior from their presence.

Their sealed bytes stay unchanged. The archived identities remain recorded so a
reviewer can recognize tampering: pointer SHA-256
`2c7ecc4c9a3d1b339c2f135babe874900e53af1a2d06379e67ab4fcacf2ad0f6`, manifest
SHA-256 `351634036ae88bbe843430bb11b3e9d46e6b9bcd865df4aaf55e50fe55dfb1b4`,
`review-evidence.json` SHA-256
`ef820d44a350303fb5eb1f2d4bb1179c1800e7bc407e3debba52d7588c317dc2`, protocol-bundle
SHA-256 `180199f3e77e5f4daa9c914f97b8e9a08293ba70e201656efe3bd0c10af70d6c`, its
recorded protocol digest
`5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f`, pin SHA-256
`ac17fd5a5ee5b989909266bc58d616a1476a286ea7f27f7cda5819c0a857f369`, predecessor
pointer SHA-256 `f1b6f1e09dba629ab06530b2e21c6ac451cd4c04c82ed21cd7cabfb9b7e78398`,
and predecessor protocol digest
`de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5`. Editing an
archived byte is `activated-authority-mutation` and is rejected as archive
tampering. None of these files, digests, drafts, or prior reviews is a protocol
selector or runtime fallback.

## Generic Plugin Canvas surface ownership

- `@convax/canvas` owns the host-neutral plugin-surface node kind, its business
  command, and the one atomic typed intent that creates it. Adding a Plugin changes
  only a validated manifest and schema-valid state; it never adds a Plugin-specific
  intent, node kind, role, or reducer branch.
- One intent creates one independent top-level `file` node with Canvas-derived id
  and incarnation, a Canvas-computed deterministic position, one candidate
  transaction, one durable frame, and one semantic history root. It carries no
  source, edge, parent, creation group, caller-selected id, raw Yjs, actor, or
  digest.
- Desktop Main derives the Plugin requirement, renderer, size, schema, validation
  artifact, snapshot, and initial state from one exact current ActiveSet lease and
  rechecks that lease immediately before the durable commit. A missing artifact or
  invalid state writes nothing.
- Renderer and Preload submit only Project, Canvas, and Plugin ids through a narrow
  trusted IPC method. They never send a version, snapshot or schema digest, node
  id, position, complete node, or initial state, and no caller outside the owner
  builds a full Canvas node.
- Host behavior never branches on a concrete Plugin id, vendor, or model.
- Uninstalling or unloading a Plugin retains its node and portable state. The
  projection degrades to the unknown-file fallback and never resets that data.

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

| Package                     | Owns                                                                                                                                                                                                                        | Must not own                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@convax/project-files`     | Project-scoped file contracts, tree/controller state, file CRUD/import/open/reveal, drag payloads                                                                                                                           | Project registry, Canvas catalog/documents, Workbench state, Electron APIs                                          |
| `@convax/project`           | Durable Project identity, registry/bindings, private storage and capability composition; ProjectIndex owns catalog, entries, Canvas routes/tombstones, `shardEpoch`, and current-resource/materialization projections       | Active Canvas selection, Canvas document semantics, Agent sessions                                                  |
| `@convax/canvas`            | Canvas schema/core, reducers, typed intents, business/view operations, editor/plugin contracts, React Flow projection and transient gesture semantics                                                                       | Project paths/registry, Workbench selection, OpenCode implementation, native persistence                            |
| `@convax/bounded-value`     | Stateless closed portable bounded-value schema codec, canonical bytes, digest input, and payload validation                                                                                                                 | Plugin identity/lifecycle, Canvas state, persistence, I/O, authorization, executable validators                     |
| `@convax/uri`               | Stateless Convax URI components, codec, canonicalization, and closed static scheme grammar                                                                                                                                  | Resolution, I/O, authorization, current Project state, or a dynamic scheme registry                                 |
| `@convax/collaboration`     | One current protocol descriptor/digest, one envelope+JCS codec, one causal frame/frontier model, one `replicaDoc`/isolated `candidateDoc` kernel, checkpoint/floor primitives, journal ports, and session undo coordination | Project/Canvas schema, PeerJS, membership/auth policy, Electron, filesystem, native I/O, or a second decoder/kernel |
| `@convax/workbench`         | Window-scoped serializable Input, Selection, Surface and layout-part state; guarded open/close/reveal/resize transitions                                                                                                    | Domain data, catalogs, filesystem, React/DOM, Electron, localStorage                                                |
| `@convax/plugin-api`        | Headless Plugin Host API catalog, API SemVer/history, availability contracts, generated validators/types/client metadata, and deterministic human/Skill reference generation inputs                                         | Desktop state, Plugin identity policy, concrete handlers, filesystem/network adapters                               |
| `@convax/plugin-sdk`        | Headless v8/v9 manifest/contribution and localization ABIs, Plugin-to-Plugin export/import contracts, bounded-value integration, SemVer matching, and deterministic Plugin/Skill references                                 | ActiveSet selection, runtime binding, leases, grants, execution, IPC, I/O, concrete Plugins                         |
| `@convax/plugin-ui`         | Browser-safe semantic tokens and minimal interaction foundations for sandboxed Plugin documents                                                                                                                             | React, Desktop appearance state, Host transport, or concrete Plugin composition                                     |
| `@convax/agent-runtime`     | Generic OpenCode adapter, sessions, resources, tool-provider bridge, protected-path enforcement                                                                                                                             | Convax Project/Canvas/UI policy or imports from other Convax packages                                               |
| `@convax/marketplace`       | Marketplace refs, public schemas, canonical source identity, strict validation, bounded Plugin-category display taxonomy, Catalog aggregation and source-conflict rules                                                     | Filesystem/network adapters, Electron/UI, concrete packages, installation or execution                              |
| `@convax/marketplace-kit`   | Deterministic authoring-time package, Registry, Showcase, bundle and companion metadata generation                                                                                                                          | Desktop runtime, concrete marketplace content, credentials, or executing package bytes                              |
| `create-convax-marketplace` | Authoring-time scaffold CLI backed by `@convax/marketplace-kit`                                                                                                                                                             | Runtime Marketplace state, publishing credentials, or a second validator                                            |
| `@convax/ui`                | Product-agnostic visual primitives and theme                                                                                                                                                                                | Project, Canvas, Workbench, Agent, persistence, or Electron behavior                                                |
| `@convax/desktop`           | Electron composition root, native adapters, PeerJS data plane, IPC/preload, renderer shell, user preferences, signed application-update lifecycle, concrete cross-package wiring                                            | New reusable domain semantics, release secrets, or a competing React Flow document store                            |
| `@convax/api`               | Web-standard membership, replica enrollment/edit authorization, sessions/rendezvous, stateless attestation, checkpoint/floor, registry, and cutoff control-plane authority                                                  | Project/Canvas payload bytes, PeerJS transport, ordinary edit order, Desktop/UI, or deployment secrets              |
| `@convax/web`               | Public Convax marketing site, product storytelling, responsive presentation, and public conversion links                                                                                                                    | Desktop runtime, product domain state, Cloudflare deployment, or API behavior                                       |
| `@convax/deploy-cloudflare` | Cloudflare deployment composition, custom-domain routing, static Web assets, and the future `/api` service-binding edge                                                                                                     | Marketing presentation, API domain logic, credentials, or Desktop behavior                                          |
| `@convax/docs`              | Independently deployed public documentation site and agent-readable documentation outputs                                                                                                                                   | Product runtime state, canonical architecture semantics, Desktop behavior, or API logic                             |

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

- Desktop Main creates and shows one inert local startup window immediately after
  Electron readiness, before product-runtime restoration. That document is never a
  trusted Renderer or capability principal; Main loads the trusted Renderer into
  the same window only after required bridges are ready, and required initialization
  failure replaces indefinite loading with a bounded local failure surface.
- UI, Agent, Plugin, and native entry points call the same owner-defined application
  or business operations. Edge adapters do not recreate domain invariants.
- Main's per-shard `replicaDoc`, rebuilt from accepted durable causal objects, is
  the sole local ProjectIndex/Canvas document authority. A command mutates only an
  isolated `candidateDoc`; the exact final signed frame and owner-certified head
  transition cross the one atomic accepted-frame persistence port before entering
  `replicaDoc`. The current native layout makes a normal local root visible through
  one checksummed WAL record and one file sync; it never exposes partially advanced
  object, outbox, journal, or head state.
- ProjectIndexYDoc is the only Project route/tombstone and current `shardEpoch`
  authority. The service registry is bounded anti-rollback/discovery metadata only;
  it never grants, denies, adds, removes, or blocks a Project floor scope. Each
  CanvasYDoc owns that Canvas; no JSON mirror or single revision counter spanning
  the document is a parallel authority.
- Fixed-size mutation hot paths are bounded by changed bytes and changed keys, not
  retained document or history cardinality. Add Text must not enumerate unrelated
  Canvas nodes, ProjectIndex entries, canonical pairs, accepted frames, or renderer
  entities. Cold open/recovery/checkpoint/export and genuinely bulk commands may do
  work proportional to the state or output they explicitly process.
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
- Plugin Marketplace categories are a bounded display projection derived from the
  exact validated manifest: Service contribution, image/video generation output,
  and owned Skills. They are never an author-selected Registry label, contribution,
  grant, installation decision, or execution authority; Renderer filtering is local
  presentation only.
- Renderer may likewise persist one bounded, versioned, last-complete Plugin Service
  display projection containing only validated summaries, status, credits, and
  optional usage history. It renders that projection immediately, refreshes status
  and usage independently in the background, and never treats it as authorization,
  execution availability, Checkout, or billing authority.
- Renderer may persist only the bounded versioned presentation step, completion,
  and deferred flag for first-run account onboarding. The automatic full-screen
  flow applies only after a successful empty Project-registry read, selects an
  account surface from generic advertised Service actions, and derives account,
  Plan, Credits, Checkout and entitlement display from live Service status. A
  deferred incomplete flow may remain as a non-blocking bottom-left task and reopen
  only on explicit user action. Existing local Projects bypass automatic onboarding
  and remain openable while offline, signed out or unsubscribed.
- External public-client authorization is companion-owned. Direct Resource Server
  access requires an Access Token whose audience is that exact resource or an
  explicitly bound first-party Application trust domain. An arbitrary or unbound
  client-audience Access Token, ID Token, Cookie, Refresh Credential, or Management
  credential is never accepted. Only a rotating Refresh Credential may be durable
  in companion-owned private credential storage, which may be an operating-system
  credential service or a private same-user application-data file. Access Tokens
  remain in memory and no credential bytes or native storage path ever cross Main,
  Preload or Renderer.
- A first-party Resource Server integration may be preconfigured on the upstream
  Application so one Application login uses the same Application Access Token with
  an integration-owned capability scope. Its binding and subject JIT access remain
  server-side; Host, Renderer and companion never expose a second end-user resource
  login/connect step or call the integration Management API.
- Enabling that integration may redirect an authorized Application administrator
  through a short-lived signed handoff to the Resource Server Console. The
  administrator selects Resource Server-owned Workspace, Plan and provider facts
  there; the integration id is the external uniqueness key, retries reuse the same
  aggregate, disable retains history, re-enable retains identity, and the upstream
  Application stores none of those product facts.
- `WorkbenchController` is the sole active Input/Canvas source.
  `ProjectCanvasController` owns catalog CRUD, never active selection.
- Editable Canvas text drafts are transient Canvas-owned write-behind state keyed by
  scope/Canvas/node. Ordinary Canvas navigation starts background save without a
  prompt or wait; Desktop drains the store before Project teardown and validates the
  originating renderer lease rather than retargeting the later active Canvas.
- Only `@convax/project/node` may read or write private Project metadata. Renderer,
  Preload, Agent tools, and general file operations use typed capabilities and never
  edit `.convax` JSON.
- Unsupported portable data is never silently reset, overwritten, deleted, or
  garbage-collected. The sole migration exception is the code-pinned exact immediate
  predecessor at the Project pre-open gate. It must preserve ordinary Project files,
  validate and rebuild all collaboration semantics into a fully verified current
  staging tree, and use a crash-recoverable same-filesystem switch. Unknown or
  damaged formats remain byte-exact and closed; there is no archive-as-runtime,
  best-effort import, local-owner downgrade, or confirmation-driven data reset.
- File publication and Canvas mutation are not one transaction. Publish without
  clobbering first; if Canvas commit fails, retain the file and report partial
  success rather than inventing a cross-file WAL.
- Generation input staging may accept an already validated Project resource while
  `.convax/staging` retains an unchanged positive hard-link count. Executable
  snapshots, sidecar outputs, and every other native copy remain single-link; any
  identity, count, size, timestamp, or real-path drift fails closed.
- Canvas projects every terminal generation failure as the same read-only
  modality-icon plus `生成失败` surface. Selecting that card preserves ordinary
  selection and dragging but never restores its prompt or exposes upload, retry, or
  failure-detail actions; portable failure metadata remains non-UI state.
- `convax.plugin/8`, `convax.plugin/9`, `convax.package/2`, and
  `convax.plugin-capability/3` are the only admitted runtime formats. The v8
  manifest remains a closed, accepted singleton-Service ABI; it is never rewritten
  or reinterpreted as v9. V9 keeps one Plugin artifact but may declare multiple
  service-scoped runtime profiles. Additive Host APIs evolve through the independent
  `@convax/plugin-api` SemVer Catalog, not another manifest or transport version.
- A Plugin installation is one content-addressed complete closure selected through
  one global ActiveSet CAS. Runtime principals and leases bind exact revisions,
  ActiveSet digests, and snapshot digests; never reconstruct authority by scanning
  mutable Plugin, Skill, Hook, companion, or authorization directories.
- Retired-major recovery uses only an ordinary exact-source Marketplace update.
  Desktop ships no product-selected Marketplace bytes, default installations, or
  cross-source recovery authority; repaired bytes remain inert until restart
  revalidation.
- Plugin contributions and Host API calls are orthogonal and grant no implicit
  authority to each other. Plugin-to-Plugin calls use only the typed Host broker;
  never expose direct objects, direct MessageChannels, service locators, or
  first-provider-wins lookup.
- Plugin localization resources, keys, and fallback belong to `@convax/plugin-sdk`;
  `host.locale.get` belongs to the API Catalog; Renderer owns the user preference.
  Main may mirror it only per exact Web connection, and language switching must not
  reload the iframe or change Plugin authority.
- Plugin identity is routing/namespacing data only. Runtime semantics derive from
  validated contributions and never branch on a concrete Plugin id, vendor, model,
  provider, or credential.
- Tools are narrow typed capabilities. Skills compose them; they do not bypass
  package APIs, grant Plugin/native authority, or become a second implementation.
- Preserve `contextIsolation`, disabled Node integration, sandboxing, trusted sender
  validation, scope checks, protected paths, and least-authority IPC.
- Desktop application updates are packaged Main-only native operations. Publish
  signed/notarized immutable installers before mutable channel metadata, verify the
  package before install, and cross the ordinary Main shutdown drain first. Keep
  signing, notarization, storage, and publication credentials exclusively in
  protected GitHub Actions settings; never commit or package them.
- Contract paths are normalized Project-relative POSIX paths. Native adapters alone
  convert them and validate containment, real paths, symlink replacement, Windows
  drive/UNC forms, traversal, device names, alternate streams, trailing dots/spaces,
  and case-insensitive `.convax`.
- Use Electron/OS directories and `pathToFileURL`; never concatenate file URLs or
  hard-code `/home`, `/tmp`, drive letters, or `/` as a native separator.
- The packaged current protocol descriptor must equal the built descriptor digest
  before decode, sign, reset, or mutation. A missing, drifted, or contradictory
  descriptor fails closed as `unsupported-project-data`; archives, drafts, and prior
  implementations are never runtime fallbacks.
- Canvas owns the generic plugin-surface node and its atomic creation intent, Main
  derives every Plugin-bound fact from one exact ActiveSet lease, and Renderer sends
  only Project/Canvas/Plugin ids. No caller outside the owner assembles a Canvas
  node, and no Host branch names a concrete Plugin.
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
