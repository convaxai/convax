# Convax Architecture Contract

Status: canonical. This document describes the current architecture and the
decisions that new code must preserve. `AGENTS.md` turns these decisions into an
operational checklist, and `scripts/package-boundary-check.ts` enforces the parts
that can be checked statically.

## 1. Design principles

Convax is built from independently testable domain packages and one application
composition root. A package owns its state, invariants, and public capabilities.
Cross-domain behavior is assembled through injected ports; packages do not discover
each other through globals or mutate each other's persistence.

The recurring rules are:

1. One concept has one owner and one canonical state source.
2. Domain state machines are headless; hosts provide I/O and rendering adapters.
3. UI and Agent entry points execute the same application/business operations.
4. Portable Project state is separate from user/window preferences.
5. Every native path is treated as a trust boundary and works on Windows.

When a feature does not fit an existing owner, make the ownership decision explicit.
Do not default it into Desktop, Project, a `shared` folder, or a new `workspace`
package.

Convax host/platform source and concrete capability-package source are intentionally
split across repositories. This repository owns Plugin contracts, validation,
installation, lifecycle, runtime composition, UI/IPC, and Registry consumption.
The `microvoid/convax-plugins` repository owns every concrete Plugin, Skill, and
companion tool, including official and default-catalog integrations. A new
integration therefore adds generic host support here only when the ABI genuinely
lacks it, while its manifest, assets, workflow instructions, and executable source
are authored and released from `convax-plugins`.

`packages/desktop/resources/plugins` is a legacy/bootstrap migration surface, not
the canonical source tree for new Plugins. Long term, Desktop consumes immutable
Registry/Release artifacts or mechanically generated and verified bootstrap bytes;
it does not duplicate hand-maintained Plugin source. No runtime semantic may depend
on a concrete package id merely because a package was historically bundled here.

## 2. Terms

### Project

A Project is the durable product aggregate associated with one bound root directory.
It has a stable identity, a per-user binding, private namespaced storage, and a
catalog of capabilities such as Canvases. It is not merely a filesystem folder and
does not own the currently displayed UI.

### Project Files

Project Files is the scoped file capability for visible content below a Project root.
Its contract uses `projectId + project-relative portable path`. It owns file/tree UI
state and operations, not Project identity. The native adapter currently lives in
`@convax/project/node` because that adapter resolves Project bindings and real paths;
it implements the `ProjectFilesClient` contract without moving file semantics back
into `ProjectController`.

### Canvas

A Canvas is an independent document with its own schema, revision, commands,
business operations, queries, view commands, and editor. Project owns the catalog
relationship and persistence adapter, but it does not own Canvas document semantics.
Every connectable card has exactly one left-side input and one right-side output.
Canvas edges are directed from `source` (right/output) to `target` (left/input);
moving cards never changes those port roles. Structural groups are containers rather
than connectable cards, and new primitive or resource-relation commands reject a
group endpoint.

### Workbench

Workbench is window-scoped interaction state: the active Input, Input-scoped
Selection, derived Surface, guarded navigation, and generic top-level layout-part
transactions. It is the only source of the active Canvas/file. It does not persist
Project or Canvas data and has no DOM, React, Electron, or localStorage dependency.

### Workspace

There is no current Workspace aggregate. The term is reserved for a future feature
where one window/session genuinely coordinates multiple Projects. Legacy Workspace
catalog schemas are unsupported and are never migrated or rewritten.

### Skill and Plugin

An OpenCode Skill is a trusted instruction bundle discovered and executed by the
existing Agent runtime. A Convax Plugin is an installable product surface or
integration composed by Desktop from existing Canvas, Project and Agent
capabilities. Third-party Web Plugin code remains sandboxed. A built-in integration
may additionally have a trusted Desktop adapter, but its static package cannot invoke
that adapter and does not grant the same privilege to imported packages. Trusted
built-in status is host-authored provenance over the exact catalog bundle, never a
manifest id/version claim. A standalone Skill has its own package and lifecycle. The
top-level `skill` field retained by `convax.plugin/1` through `/3` names a legacy
independently managed companion. `convax.plugin/4` and later may own Skill directories
through `contributes.skills`; those directories are atomically published and removed
with the Plugin but remain ordinary OpenCode Skills at runtime. Skills describe Agent
workflows and select tools; they never implement UI or native behavior, inherit
Plugin authority, or implicitly turn Convax Plugins into OpenCode plugins. The
explicit exception is a manifest-declared `hooks` contribution: Desktop treats it
as executable Agent code, binds installation consent to its exact self-contained
JavaScript bytes, and gives OpenCode a private immutable snapshot. OpenCode still
owns the native Hook API and events; `@convax/agent-runtime` sees only a generic
file URL and never Plugin identity.

`convax.plugin/5` introduces the transport-neutral
`convax.plugin-capability/1` authority model. Project/Canvas access comes from an
exact installed Plugin principal plus explicit manifest grants, not from whether the
Plugin happens to render a Web node. A sandboxed iframe is one transport adapter;
verified Tool and built-in adapters must use the same main-owned broker instead of
growing another Canvas API.

`convax.plugin/6` adds a headless Agent integration contribution for one standard
remote MCP server. Desktop validates the installed declaration and derives a stable
namespaced server key; `@convax/agent-runtime` passes that generic configuration to
OpenCode. OpenCode remains the MCP client and owns Streamable HTTP/SSE negotiation,
OAuth discovery and token refresh, tool discovery/prefixing, and connection
lifecycle. Convax does not proxy the tools or implement provider-specific adapters.
The first schema permits HTTPS remote MCP only. A raw local command would bypass the
existing verified-companion receipt, launch-snapshot, and process-tree boundary, so
it is not admitted as an Agent MCP transport.

Capability Center reads a renderer-safe connection projection keyed only by the
installed Plugin id. It never receives OpenCode server keys, URLs, headers, OAuth
material, or raw diagnostics. OAuth credentials are OpenCode-owned and durable,
while MCP clients are directory-instance scoped; after a successful connection,
Desktop invalidates live OpenCode capability instances so every Project reconnects
with the stored credential. A connected headless Plugin exposes a generic Agent
entry: return to and focus the Agent composer, attaching its owned Skill only when
exactly one workflow is unambiguous. Navigation never invokes a vendor API.

## 3. Packages and dependency graph

| Package                  | Responsibility                                                                  |
| ------------------------ | ------------------------------------------------------------------------------- |
| `@convax/ui`             | Product-agnostic components, styling primitives, and theme                      |
| `@convax/project-files`  | Renderer-safe scoped file contracts, controller, and drag protocol              |
| `@convax/canvas`         | Canvas core, application/business layer, view layer, editor and plugins         |
| `@convax/project`        | Project lifecycle/registry/private storage and Project capability composition   |
| `@convax/project/canvas` | Project Canvas catalog, relationships, controller, drag and resource references |
| `@convax/project/node`   | Native Project, Project Files, private storage, and Canvas persistence adapters |
| `@convax/workbench`      | Headless window Input/Selection/Surface and layout state machines               |
| `@convax/agent-runtime`  | Host-agnostic OpenCode integration and protected execution boundary             |
| `@convax/desktop`        | Electron composition root, IPC, adapters, coordinators and product shell        |

Allowed internal runtime dependencies:

```text
@convax/ui             -> none
@convax/project-files  -> none
@convax/workbench      -> none
@convax/agent-runtime  -> none
@convax/canvas         -> @convax/ui
@convax/project        -> @convax/canvas, @convax/project-files, @convax/ui
@convax/desktop        -> every package above
```

This is an allowlist, not a description generated from current manifests. Adding an
edge requires an intentional architecture update. All cross-package imports use
published `exports`; private `src/**` imports and relative package escapes are
forbidden.

### Package independence

Every library package is independently publishable and externally consumable.
“Independent” describes its delivery and runtime boundary, not an artificial ban on
dependencies or domain semantics:

- it owns a coherent capability and may contain the business rules for that domain;
- it builds, type-checks, tests, and packs from its own package root;
- its tarball contains compiled `dist` artifacts and resolvable declarations only;
- every runtime/peer dependency is declared, and every Convax dependency follows the
  allowlist above;
- it receives filesystem, persistence, network, clock, host scope, and view services
  through explicit ports where applicable;
- it has no dependency on Desktop composition, monorepo source aliases, hoisted
  undeclared modules, globals, or another package's private data.

External libraries such as React or an editor engine are valid declared dependencies.
Likewise, `@convax/canvas` legitimately contains Canvas business semantics. Moving
those semantics out merely to make the package look generic would weaken ownership.
The current exception to publishability is `@convax/desktop`, which is the private
application composition root.

Adding a package requires an architecture use case, an ownership row and dependency
policy, package-local `AGENTS.md`, local lifecycle scripts, public `dist` exports,
standalone tests, and inclusion in the real-tarball/external-consumer smoke. The
boundary checker fails closed until those admissions are complete.

## 4. Canonical state

| State                                                    | Canonical owner                              | Notes                                                                    |
| -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Active Project                                           | `ProjectController`                          | Project lifecycle only                                                   |
| Project file tree, expansion, file selection and preview | `ProjectFilesController`                     | Scoped and reset by Project id                                           |
| Project Canvas catalog                                   | `ProjectCanvasController`                    | CRUD/relationships only; no active Canvas                                |
| Active Canvas/file                                       | `WorkbenchController.activeInput/surface`    | Sole source for the displayed primary content                            |
| Canvas node selection                                    | Workbench selection plus mounted Canvas view | Always scoped to the corresponding Input/view                            |
| Canvas document and revision                             | Main Canvas application service/repository   | Sole persistent writer; renderer is an optimistic projection             |
| Node generation preference and latest run                | Owning Canvas `file` node                    | Separate bounded Canvas-owned namespaces; Main coordinates live work     |
| Plugin node instance state                               | Owning Canvas `file` node                    | Bounded namespaced JSON inside the Canvas document; never iframe storage |
| Top-level sidebar size/visibility/resize transaction     | `WorkbenchLayoutController`                  | Desktop supplies pixels, events, animation and persistence               |
| Agent sessions                                           | `@convax/agent-runtime` scoped by the host   | Never stored in Project Canvas state                                     |
| OpenCode Skill discovery                                 | `@convax/agent-runtime`                      | Runtime sees generic directories, never Desktop ownership metadata       |
| Managed Skill filesystem publication                     | `@convax/agent-runtime/node`                 | Generic reversible transaction; no Plugin ownership knowledge            |
| Standalone/Plugin-owned Skill management and provenance  | Desktop main                                 | Owner policy and atomic Plugin composition stay outside Agent runtime    |
| Installed Plugin packages                                | Desktop main                                 | Global static packages; no active Project/Canvas state                   |

A recovery preference such as “last Canvas for Project X” is not canonical state.
Desktop may read it to choose an initial Workbench Input, then Workbench becomes the
truth. Do not mirror active state into catalogs, React state, or another controller.

Within a mounted Canvas, `CanvasSelection` is the sole selected-element state.
`CanvasSelectionContext` classifies that set as none, single, multi or mixed so UI
surfaces can fail closed without inventing a primary node. Selection, editing mode,
DOM focus and command execution remain separate. See
[`canvas-selection-context.md`](canvas-selection-context.md) for the detailed
interaction contract and adapter rules.

## 5. Persistence map

```text
Electron userData/
  projects.json                         per-user bindings and recency
  default-capabilities.json             one-time default Plugin/Skill provisioning receipt
  capability-registry/index-v1.json     last-known-good official remote catalog cache
  capability-registry/showcase-v1.json  verified showcase index for the current catalog revision
  capability-registry/showcase-media-v1/<sha256>
                                        bounded content-addressed showcase media cache
  capability-registry/artifact-v1/<sha256>
                                        bounded verified Plugin/Skill/companion artifact cache
  opencode/skills/user/<skill>/         materialized standalone and Plugin-owned Skills
  plugin-skill-bindings/index-v1.json   Desktop-owned bindings plus one digest-bound recovery journal
  plugins/<plugin-id>/                  validated static Plugin packages
    .convax-builtin.json                host-authored catalog provenance, when applicable
  plugin-companions/<plugin-id>/<plugin-version>/
                                        Registry-verified host-owned Tool executables
  plugin-authorizations/<plugin-id>/
                                        install-time exact Tool execution receipts
  plugin-hook-authorizations/<plugin-id>/
                                        exact Hook receipts and private executable snapshots
  plugin-service-authorization-checkpoints/<plugin-id>.json
                                        private crash-recovery Cookie handoff; never a browser profile
  canvas-external-drags/                short-lived host-owned native drag copies

Packaged app Resources/
  default-capabilities/                 build-verified remote first-install seed;
                                        never built-in provenance or executable-in-place

browser localStorage                    per-user Workbench/renderer preferences

<project root>/
  Notes/                                user-visible Canvas-created text files
  Generated/                            user-visible generated output files
  .convax/
    project.json                        stable Project identity only
    canvases/catalog.json               portable Canvas catalog, no selection
    canvases/<canvas-id>/document.json  Canvas document
    assets/blobs/<sha256>               deduplicated copies admitted from outside the Project
    assets/.staging/                    short-lived managed-asset imports
    assets/gc.json                      rebuildable delayed-GC timing state
    staging/                            short-lived user-file publication staging
```

`Create Project` receives only a portable project name from renderer and creates a
new root at `<user Documents>/Convax/<project name>` without opening a native folder
picker. `Open Project` is the explicit path-binding flow and keeps the native folder
picker for an existing portable Project directory. The default creation directory is
a Desktop host policy; Project's native adapter still owns name validation, safe
directory creation, identity initialization, and registry publication.

Private Project metadata is owned by `@convax/project/node`. Renderer, preload,
Agent tools, and general Project Files operations do not read or write its JSON.
Managed assets are the explicit exception: scoped Project resource capabilities copy
only files admitted from outside the Project into deterministic content-addressed
paths below `.convax/assets`. Files already inside the Project are referenced
directly. The rest of `.convax` remains hidden and protected.

The remote capability catalog and showcase caches are Desktop-owned, user-global,
and non-authoritative. Catalog reads may return the validated local snapshot
immediately while Main single-flights a bounded background ETag revalidation.
Ordinary install/update operations request a network-first Registry view. A packaged
build may carry a target-specific first-install seed downloaded and verified from
that same fixed Registry during packaging. Startup reads it only through a local
Registry port and publishes it with the normal remote installer transaction, so its
Plugin package, companion, authorization and owned Skills enter `userData` exactly
like an online install and never gain built-in provenance. Once the first window is
created, Main checks Registry metadata in the background and downloads artifacts only
when a newer version exists. Showcase
indexes publish monotonically with their Registry identity. Media is cached across
restarts by its verified SHA-256 in a bounded LRU and is rechecked for declared size,
digest and MIME bytes on every admission. Immutable Plugin, Skill, and companion
artifacts use a separate bounded content-addressed cache and receive one fresh-URL
retry after a transient transport failure; every hit is rechecked against the
current Registry size and SHA-256 before use. Losing any cache never removes installed
capabilities; an invalid or rolled-back network response never replaces it.

Canvas JSON is an implementation detail behind `CanvasDocumentRepository` and Canvas
application services. A schema change needs a new version and tests. It provides a
migration path using real old data by default. An explicitly approved breaking
cutover may instead reject the old version without migration. Rejection must preserve
unsupported bytes and keep them outside new mutation and GC paths.

The Project asset single-source transition is one approved breaking cutover under
this rule. Its authoritative scope and safeguards are recorded in
[the Project asset single-source design](superpowers/specs/2026-07-21-project-asset-single-source-design.md).
Canvas owns generic resource-slot and application semantics. Project Canvas owns the
concrete `project-file`, `project-directory` and `managed-asset` union stored in
host-owned node metadata, plus Project validation, traversal and hydration. The new
persistence rejects legacy path-only references, inline text and remote URLs instead
of migrating them.

Canvas-created text is a normal UTF-8 Markdown file below `Notes/`; generated output
is a normal user-visible Project file below `Generated/`. Both flows publish the file
first and commit its Canvas reference second. If the Canvas commit fails, the file is
retained and the UI reports partial success. Canvas undo never rewrites an already
saved user file.

Managed assets are immutable SHA-256-addressed value copies. The original external
path is not persisted or watched after admission. Desktop composes one
`ProjectManagedAssetStore` shared by preparation, repositories and GC; Project Node
serializes import, reference admission and GC with its in-process per-Project asset
mutex. GC derives liveness by scanning typed references in every supported Canvas document, records the
first unreferenced time, waits seven days and completes another full scan before
deletion. It atomically saves the next `gc.json` timing state before unlinking due
blobs; stale records after a crash are removed by the next scan. Any unreadable Canvas
document, corrupt state or digest mismatch stops deletion conservatively.

Every coalesced Project filesystem event marks the current Project's mounted resource
snapshots stale; an optional path only prioritizes lazy refresh. Watcher events are not
an event log. File and directory moves do not rewrite Canvas references in v1. Users
explicitly relink missing nodes.

Installed Plugins are user-global. Canvas documents persist only the existing file
node kind plus a stable Plugin reference and namespaced portable instance state.
Uninstalling a Plugin therefore leaves recoverable Canvas data and falls back to the
unknown-file renderer. Managed Skills are copied into Convax's OpenCode config root;
normal external global Skills remain visible and read-only.

Plugin node state is one atomic, bounded JSON snapshot. The Plugin adapter owns its
schema version and migrations; an unknown or invalid schema is preserved and must
not be replaced with defaults. Node/Canvas copy carries the latest snapshot already
committed to Canvas. Continuous iframe edits may be throttled, but semantic gesture
completion and frame teardown must request an immediate commit. Large images,
models, captures, and other binary payloads use host-owned typed resource bindings on
the node. Opaque Plugin state cannot keep an asset alive merely by containing a path
or hash string.

Portable Plugin presentation state may share that namespaced snapshot while staying
separate from the Plugin's domain document. A 3D director camera/orbit is portable;
focus, hover, in-progress gestures, animation and error notices are transient. A
newer installed Plugin stamps its version reference only when it successfully writes
the migrated node snapshot; installation itself never rewrites Canvas documents.

## 6. Core flows

### Project creation and opening

```text
Create Project(name)
  -> Desktop injects the user-visible Documents/Convax parent
  -> @convax/project/node creates and initializes one new child directory
  -> registry binding is published and the Project is activated

Open Project
  -> Desktop asks the user for an existing directory
  -> @convax/project/node validates or initializes its Project identity
  -> registry binding is published and the Project is activated
```

Creation never asks the renderer for a native path and never falls back to the Open
Project picker. An existing portable directory is not overwritten or silently
adopted by Create; the user opens it explicitly through Open Project.

### Project activation

```text
ProjectController activates Project
  -> Desktop synchronously scopes Workbench to Project
  -> Desktop scopes ProjectFilesController
  -> Desktop scopes ProjectCanvasController
  -> catalog loads
  -> Desktop coordinator restores a valid user Canvas preference or fallback
  -> Workbench opens the chosen Canvas
```

Controllers use request generations/identities so late responses from the previous
Project cannot overwrite current state.

### Generation tool boundary

Generation is an installed Tool Plugin capability, not a built-in provider
framework. Convax packages never hard-code vendor names, model ids, credentials,
model catalogs, or routing. Each installed Tool Plugin and its explicitly authorized
external command compose the complete concrete integration behind the declared tool
contract; there is no parallel provider registry.

Agent, Toolbar/UI, and sandboxed Plugin entry points call the same scoped generation
tool executor owned by Desktop main. OpenCode is only the Agent-side tool client: it
does not own generation execution, and direct product actions do not require an
OpenCode session. Successful media output is prepared through
`CanvasResourceBusinessService` after Main atomically publishes it as a user-visible
Project file under `Generated/`; the existing Canvas `file` node flow then references
that Project file. A failed Canvas commit retains the published output and reports
the partial success instead of deleting user data.

Executable integrations use `convax.plugin/2` or declarative `convax.plugin/3` through
`/6`: a validated manifest declares generation tools and a separately installed bare
`mcp-stdio` command. V3-v6 map pure model names and optional Agent/Canvas operation
surfaces to those tools, so core code never identifies an operation by Plugin id. V4
adds owned Skill lifecycle metadata without changing generation execution; v5 retains
that behavior while adding the independent `convax.plugin-capability/1` boundary; v6
retains both while independently adding the remote Agent MCP contribution.
V6 operations may also declare `delivery: "return"` for bounded text effects and
`inputBinding: "direct-incoming"` for Canvas sink semantics. These are generic tool
contracts: neither field changes behavior based on a concrete Plugin id.
An official Registry entry may additionally bind that exact command to immutable executable
companions for specific `platform`/`arch` targets. Desktop verifies the deterministic
Release URL, 128 MiB ceiling, exact size and SHA-256 before atomically publishing the
selected bytes below private, versioned `userData/plugin-companions`; a missing exact
target fails the Plugin install without replacing the working installation. Orphans
are reconciled on startup, update and uninstall. A managed companion is resolved
first, while an explicitly installed executable in the host `PATH` remains the
fallback for Plugins without one. Choosing install or update is the execution
consent event. Before package publication, Desktop resolves the exact managed or
PATH binding and transactionally coordinates a private receipt keyed by the normalized
manifest fingerprint, binding kind, real path, size and SHA-256 with the package
switch. The old and new receipts may coexist during an update; any crash-partial or
orphaned state is non-executable and startup reconciliation removes it. A Registry install
that declares a managed companion cannot fall back to a same-named PATH command.
Missing and changed bindings fail installation without replacing a working version.
Listing or installing never starts the command.
Desktop stages bounded typed Canvas references, rechecks live scope and revision
before the external call, admits only bounded signature-checked results, and commits
generated content through `CanvasResourceBusinessService` after publishing it without
overwriting an existing object as a user-visible Project file under `Generated/`.
If Canvas insertion fails, the generated file remains available for a later retry;
unpublished staging is best-effort cleanup rather than a durable transaction. Tool-
specific controls come only from the selected MCP tool's current
`tools/list.inputSchema`; Main projects bounded scalar fields across preload and
validates them again immediately before execution.

On execution Desktop silently resolves and fingerprints the binding again and
requires the matching persisted receipt; missing, tampered or drifted state fails
closed with a bounded request to reinstall, never a first-call permission dialog.
Application restart does not invalidate unchanged installation consent. Desktop
copies the verified entrypoint bytes to a unique launch snapshot in a private
temporary directory outside the immutable companion or `PATH` installation, runs
that snapshot without a shell and with an allowlisted environment, and checks that MCP `tools/list` exposes
every invoked declared tool before staging large inputs. The prepared execution is
bound to that Plugin fingerprint and tool declaration; an update during staging
fails before `tools/call`. This process runs
with the user's OS authority; the installation receipt and staged-input protocol are trust
boundaries, not an operating-system sandbox. The snapshot prevents normal
replacement of the verified `PATH` entry; processes already running as the same OS
user remain inside the same trust domain and require a future signed sidecar plus
OS sandbox for stronger isolation.

A managed companion whose bytes begin with the exact
`#!/usr/bin/env convax-bun` header is an interpreted Bun program. Desktop records
that mode with the immutable companion receipt, snapshots the script exactly like a
native entrypoint, and invokes it through the app-owned Bun runtime already shipped
for OpenCode. The Plugin authorization identity includes the interpreted mode while
remaining bound to the downloaded script path, size, and SHA-256. No Plugin id or
Registry schema branch selects this behavior, native companions remain unchanged,
and a missing shared runtime fails before process start.

Desktop copies validated Canvas inputs into a short-lived directory and gives the
tool only those copies plus a dedicated output directory. It admits only bounded,
signature-checked results from that output directory, then removes the temporary
tree. Scope, revision, placement, native Project paths, Canvas persistence and
generated-node creation remain host-owned. Sandboxed Plugin callers receive only
the `generation.execute` methods in the host protocol matching their manifest; the host derives their
scope and references from the live owning node and its direct incoming edges.

A return-delivery operation reuses the same verified executable, input staging,
revision/source rechecks, cancellation, and at-most-once execution boundary, but
returns one bounded text result to the Agent and performs no Canvas resource import
or node mutation. It cannot be a model or selection action. A direct-incoming Agent
operation requires an owning Canvas node id; Main verifies that the node belongs to
the same installed Plugin principal and that every reference remains a direct
incoming file node before staging and immediately before execution. This makes
graph edges enforceable authority rather than prompt-only convention.

A sandboxed Plugin may request the host-owned pending-result mode when the user
expects immediate Canvas feedback. Canvas creates exactly one typed pending `file`
node through its resource business service; the Plugin cannot choose its id or a
replacement target. Desktop commits that node in Main before invoking the external
generation tool, advances the guarded request to the committed revision, and
rechecks the same Main-owned reference, asset and target snapshots before the
potentially billable call. Renderer refresh/reveal is asynchronous projection work
and cannot delay or veto the tool call. A successful admitted result replaces the
pending resource in place, preserving its id, placement and edges. Failure or
cancellation keeps the node and marks it with a bounded host-authored error. If the
node is removed, edited or otherwise no longer matches its exact content guard,
Desktop fails closed and never recreates or writes through it.

Tool-custom generation controls come only from the selected sidecar's current MCP
`tools/list.inputSchema`, never the Plugin manifest or a parallel provider/model
registry. Main lazily describes one explicitly selected tool, projects only bounded
top-level scalar fields across preload, and revalidates caller values against the
same live tool definition before execution. Those validated fields extend the
`convax.generation-call/1` object without being allowed to replace its fixed
host-reserved envelope; tools without extensions keep the original payload.

The Agent generation model is a user-global renderer preference. Without an owning
node override, a file card inherits that preference only when its output matches the
card's intrinsic text/image/video/audio kind and accepts the current media references.
If that preference is absent, mismatched, or temporarily incompatible, the card prefers
the first compatible concrete model. A model enters the output-scoped available
catalog only when the owning Plugin contributes the same model through a service and
Main's bounded live status reports that service connected. Missing, disconnected,
attention, unknown, timed-out, or invalid service status hides that service's models;
service-independent operations remain manifest-driven. When no model is available,
Agent and card composers offer the Services route instead of synthesizing an `auto`
choice. The available catalog is never pruned by current `@` inputs: when no model
accepts all inputs, the card still shows a concrete matching Agent default or first
available model and blocks execution until the user removes incompatible inputs or
chooses a compatible model. A manual card choice stores only the opaque host tool id
in versioned, namespaced Canvas node metadata; clearing it restores host-default
resolution. The node override is portable
and undoable with the Canvas document, never updates the Agent preference in reverse,
and requires an exact available output match. Input incompatibility keeps that exact
model visible but fails closed at submission; missing or output-mismatched ids remain
unavailable.

Opening an Agent or Generate conversation on a card preloads its direct incoming file
nodes as removable `@` references in edge order. Removing a reference excludes it
from that submission. The owning card remains separate host context or the generation
replacement target and never becomes its own implicit input. Generate carries each
non-empty text mention as a prompt-context node id; Main reads its authoritative
Canvas text, appends it to the prompt in mention order, and never exposes that text
node as a model reference or gates it on `acceptedInputs`. Materialized image, video,
and audio mentions become typed tool references and remain subject to model input
compatibility. Main revalidates that both prompt-context nodes and media references
are still direct incoming edges, and that their authoritative content is unchanged,
before and after external execution. Agent mode may prepare its own scoped Canvas
context, but every media reference that reaches generation still passes the same
managed-asset and live-revision guards.
Known file-card modalities also constrain the direct model catalog and result: an
image card accepts only image tools, a video card only video tools, and a mismatched
Agent default or persisted card override fails closed. This output constraint is
independent from Agent-mode references, where an explicitly mentioned image may
still be a valid input to a video tool.

A direct file-card generation persists a Canvas-owned, versioned run on the target
node, separate from its next-run tool preference and from Plugin-owned state. The run
retains the complete prompt, host operation id, resolved host-opaque tool id, bounded
status, and an optional host-safe opaque sidecar task receipt. Main writes
`submitting` before the external call, updates lifecycle state through Canvas
application services, and commits generated resource replacement plus `succeeded`
in one guarded Canvas CAS. The dedicated target guard omits only the host-owned run
namespace; it continues to protect real resource content and all other metadata.
For host-owned pending-result mode, Canvas creates the pending file node and the
`submitting` run in one application command/CAS. That node then follows the same
running, task-receipt, guarded replacement, terminal and restart-reconciliation
state machine as an existing card; a restart cannot leave a placeholder permanently
pending.

The distributed execution uses the standard Scheduler–Agent–Supervisor pattern.
Desktop Main is the Scheduler/Process Manager, the verified Tool Plugin sidecar is
the execution Agent/Worker, and its Main-owned reconciliation phase is the
Supervisor.
Canvas run state plus the private Main operation ledger form the durable state
store. The generic sidecar API is a Long-Running Operation resource with fixed
get/wait/cancel/result/acknowledge methods. `operationId` is the idempotency key and
host LRO identity; `taskId` is only an opaque downstream operation handle. Startup
uses a reconciliation loop, while Canvas revision/CAS and the generation target
guard provide optimistic concurrency control. The guarantee is stated as at-most-once
provider task creation plus idempotent observation and result commit, never as an
unqualified exactly-once architecture.

The mounted node and composer are presentation surfaces, not task owners. Unmount,
selection changes, and panel switches do not cancel accepted work; explicit cancel
crosses queue, preparation and sidecar boundaries. Hydration derives active and
terminal presentation from the persisted run. If startup finds `submitting` or
`running` without either a matching live Main execution or a complete admitted LRO
binding, it marks the run `interrupted` and never repeats a potentially billable
call. A persisted task id alone is not restart recovery. A recovery-capable v7 tool
must provide the complete generic LRO contract and pinned immutable runtime binding;
partial or legacy implementations remain fail-closed.

The complete manifest, MCP call/result, cancellation and security contract is in
[`generation-tool-plugins.md`](generation-tool-plugins.md). The concrete local media
composition is specified in [`ffmpeg-tool-plugin.md`](ffmpeg-tool-plugin.md).

The same executable Tool Plugin may optionally contribute a user-global service
surface. This does not create a second runtime or provider registry: Desktop reuses
the already verified MCP sidecar and calls only fixed `service.status` and explicitly
manifest-authorized `service.*` actions. Main reduces results to bounded account,
credential-verification, credit and usage fields; unsupported data remains explicitly
unavailable. Renderer settings receive no token, cookie, AK/SK, URL, native path,
raw content or arbitrary MCP method. Destructive sign-out remains a host-rendered,
confirmed action. An authorization action may request the one fixed main-only
browser-cookie exchange in a fresh non-persistent sandboxed Electron session.

Desktop exposes one read-only service catalog to the application menu and Services
settings. Plugin service capabilities and displayed model rows are derived from that
same installed manifest's generation tools; dynamic account, credit and usage data
still comes only from the bounded service status. The existing OpenCode Agent runtime
contributes a safe display-only projection of its connected LLM model catalog through
`@convax/agent-runtime`. This composition has no execute or provider-resolution API:
generation continues to select a generation tool id and Agent prompts continue to
select an OpenCode provider/model pair.

The Services page may display installed model rows while a service is disconnected so
the user can understand and configure that installation. Executable model catalogs are
stricter: Main joins each model back to the exact service projection, performs a
bounded live status check, and exposes it to Agent, card, Plugin and IPC callers only
while that service is connected.

`convax.plugin/5` adds one generic LLM contribution without introducing a built-in
vendor registry. Desktop derives a namespaced OpenCode provider id from the validated
Plugin manifest, verifies and starts the same authorized companion lifecycle, and
calls only `llm.gateway.start`. The sidecar returns a Main-only, ephemeral
`127.0.0.1` OpenAI-compatible base URL and random bearer key. OpenCode receives that
connection material only in its in-memory host configuration; renderer, service
status, manifests, and durable config never receive it. The sidecar retains upstream
URLs, routing headers, vendor credentials and Cookies, and owns streaming,
backpressure and cancellation. Plugin changes dispose the exact sidecar and cause the
Agent runtime to rebuild its lazy OpenCode connection without deleting sessions.
Choosing Configure and personally completing the service sign-in is the explicit
authorization: an allowlisted cookie add/update triggers an exact-origin cookie
check and continues automatically, without a second confirmation dialog. Closing
the window performs the same check, completing only when an approved cookie exists
and otherwise canceling. HTTPS sign-in popups preserve their opener relationship,
but reuse the same temporary session and recursively inherit the host's navigation,
permission, sandbox and Node-denial guards; closing a child popup never settles the
root authorization. The broker independently re-reads and filters only the
requested cookie names visible to that exact HTTPS origin, then sends them through a
one-shot `service.authorization.complete` continuation bound to the unchanged Plugin
and sidecar. Before clearing the non-persistent Chromium session, Main atomically
checkpoints only that bounded, short-lived Cookie envelope, bound to the exact manifest and
install-authorized executable identity. Successful sidecar persistence removes the
checkpoint; an interrupted handoff can be retried with a fresh authorization id
without another sign-in. Explicit cancel/sign-out and Plugin update/uninstall remove
it. Cancellation, timeout and identity changes fail closed; no authorization URL or
cookie crosses preload. Quit drains any in-flight checkpoint/sidecar handoff before
the shared Tool Plugin runtime is disposed.

### Canvas mutation from UI, Agent or Plugin

```text
UI action, typed Agent tool, or principal-bound Plugin call
  -> Canvas business operation (preferred) or explicit primitive
  -> CanvasApplicationService
  -> load document + revision
  -> validate/apply command
  -> CanvasDocumentRepository port
  -> @convax/project/node persistence adapter
  -> optional mounted-view refresh/reveal
```

The domain mutation commits before optional view behavior. Selection, reveal,
fit-view, zoom, animation, and notification are legitimate Agent view capabilities;
they remain explicitly scoped to the mounted view and cannot rewrite domain history.
Ordinary UI mutations such as adding, importing, duplicating, or generating nodes
preserve the user's current viewport. Moving, fitting, centering, or zooming the view
requires a separate explicit user action or view command.

Canvas application transactions execute a non-empty ordered command list against
one starting revision, advance the revision once, and use one repository CAS save. This is the
atomic boundary used by Plugin and advanced Agent callers; transports do not compose
atomicity from repeated saves. Resource admission/replacement is deliberately outside
the generic document transaction because it has separate Project lifecycle,
managed-asset, guard, and rollback semantics.

Whole-Canvas tidy is the `canvas.auto-layout` business operation. The built-in engine
uses directed edges, heterogeneous node sizes, group ownership, cycle-tolerant
layering and connected components. Directed strategies place otherwise unrelated
nodes on a deterministic shelf so tidy remains visible on an edge-free media Canvas;
the explicit conservative component-packing strategy preserves their mental map. Explicit
grid/horizontal/vertical primitives require caller-selected node ids. The geometry
phase of a future role- or domain-specific layout engine may implement the
host-neutral layout-provider port and return a revision-bound geometry plan; Canvas
remains the validator and atomic commit owner. When a complete role workflow also
needs to create, reparent, resize, or remove groups, those operations must first be
admitted as Canvas-owned structural commands and then compose with the geometry
updates in one Canvas transaction instead of being hidden inside the provider.

Fit and reveal compute world-space bounds from the authoritative Canvas document and
set the viewport directly. They do not depend on React Flow nodes becoming measured
after an arbitrary number of animation frames; this also keeps post-reload focus
correct for newly added or moved off-screen nodes.

### Adding a resource to Canvas

Resource insertion is a business operation, not a series reimplemented by each
caller. Host resource preparation, media inspection, card sizing, placement,
relationship creation, revision handling, persistence, and optional view refresh are
composed once. The UI and Agent call that same operation. A primitive remains
available for precise low-level edits, but it is not the default product path.

### Canvas navigation and deletion

`ProjectCanvasWorkbenchCoordinator` is a Desktop coordinator because the flow spans
catalog, document-save guard, Workbench navigation, user preference, and rollback.
Neither Project nor Workbench imports the other to implement this flow.

## 7. Agent tools and skills

- A tool is a typed executable capability backed by an owner package's port.
- A skill is a workflow that chooses and sequences tools. It must not contain a
  second implementation of domain invariants.
- Business tools are preferred so Agent and product UI remain behaviorally equal.
- Primitive and view tools remain available when the request needs exact control.
- Desktop prepares structured resources, binds the current Project scope, and exposes
  the MCP/tool schema. `@convax/agent-runtime` remains unaware of Convax semantics.
- Tool arguments cannot select another Project or expand the host-provided scope.
  Document tools may explicitly select any Canvas from the current Project's live
  catalog and still require revision guards. View tools resolve the live mounted
  Canvas and fail when their requested Canvas is not active. All document reads and
  mutations use Main's authoritative application/repository boundary directly;
  mounted and inactive Canvases have identical domain semantics.
- Canvas attachments are validated read-only snapshots. Agents mutate through tools,
  never by shell/file edits under `.convax`.
- Opening a Project must not discover project-local `.agents`/`.claude` Skills or
  executable OpenCode extensions. Managed Skill changes refresh volatile OpenCode
  discovery state without replacing durable sessions.
- Installed v6 Agent MCP declarations are another host-provided OpenCode
  configuration input, not project discovery. The installed Plugin manifest is the
  configuration authority; OpenCode's native credential store is the OAuth
  authority. Install, update, and uninstall rebuild the lazy OpenCode configuration
  after existing prompts finish without deleting durable sessions. Authentication
  UI addresses a Plugin id only; renderer code never supplies a server name, URL,
  headers, callback, or token.
- Skill management may inspect a selected managed or globally discovered Skill as a
  bounded, non-executable directory for its file tree and text preview. Global Skills
  remain read-only, symlinks fail closed, and renderer IPC identifies the Skill but
  never carries a native path. Showcase media is separate presentation metadata:
  fixed bundled assets for built-ins or digest-verified Release sidecars for remote
  Skills, loaded lazily and played only while visible.
- Standalone Skills use an independent managed lifecycle. A top-level Plugin `skill`
  in schema v1-v3 is a legacy companion with the same independent behavior; one-time
  default provisioning records the Plugin and Skill separately so later user removal
  is respected.
- A v4-or-later `contributes.skills` directory is owned by the declaring Plugin. Desktop
  validates its complete Skill tree and exact name, rejects global/standalone/other-owner
  name collisions, and composes Skill publication with Plugin publication. Prepare
  stages bytes; pre-switch `publish` journals exact receipts; post-switch `activate`
  exposes ownership before Skill bytes; `commit` records a durable forward decision
  before cleanup. Normal pre-decision failures restore the previous package, bytes,
  and bindings. After a crash, Plugin-package recovery first selects the validated
  installed package; the Skill journal then moves forward when that package is the
  target version or rolls back otherwise. Startup finally reconciles declarations,
  bindings, and exact materialized bytes. The shared OpenCode discovery directory
  does not imply independent ownership.
- Package rollback and dependent rollback are one ordered boundary. Desktop rolls
  back Skills, Tool/Hook executable authorization, and managed companions only after every
  package rename has restored the old/absent state. If any rename fails, the
  capability transaction is deferred: durable receipts and partial Skill publication
  remain intact, its in-process lock is released, and a typed error requires a clean
  startup. Package recovery then selects canonical, backup, or uninstall-tombstone
  state before the retained Skill, authorization, and companion state converges.
- Same-id Plugin package mutations are serialized. Startup first resolves validated
  staging, replacement, and uninstall remnants; unresolved package state blocks
  dependent Skill recovery. A validated uninstall tombstone selects forward removal
  and is never restored. The owned-Skill decision precedes best-effort authorization
  and backup cleanup, and Agent Skill discovery refreshes after default provisioning.
- A Plugin owner binding reserves its global Skill name even if the materialized
  directory is missing. A pending transition reserves the union of previous and next
  names. Standalone install/uninstall and Agent discovery refresh recheck settled
  ownership under the shared mutation coordinator; they cannot observe or mutate a
  partially published Plugin Skill tree.
- Updating a v1-v3 legacy companion to a v4-or-later owned Skill is allowed only when the
  current managed Skill tree exactly matches the old validated Plugin package. That
  verified transition is journaled before the package switch, so recovery can finish
  the staged owned Skill when the new package survives. Modified or unrelated same-name
  Skills are never adopted.
- Neither standalone nor Plugin-owned Skills gain extra Plugin permissions or bypass
  typed capabilities. `@convax/agent-runtime` sees only generic Skill directories and
  never receives Plugin ids or ownership policy.
- The official remote Registry is fetched only by Desktop main from its fixed
  origin. Renderer requests carry stable catalog ids, never URLs, paths or digests.
  Desktop verifies catalog sequence, compatibility, immutable artifact metadata,
  bounded download size, SHA-256 and a safe ZIP inventory before calling the same
  local Plugin and managed-Skill installers used by checked-in bundles.
  Catalog presentation may expose the validated package size plus the exact
  current-host companion sizes. Opening its GitHub Release remains an id-only
  renderer request: main re-resolves the package and constructs the canonical
  official Release page before handing it to Electron.
- The packaging script may use the same verifier to retain the exact Registry,
  Plugin ZIP and current-target companion bytes as a packaged first-install seed.
  Runtime revalidates that self-describing seed and still routes it through
  `RemoteCapabilityInstaller`; it is not a checked-in bundle, built-in identity,
  executable search path or second publication mechanism. Missing/corrupt seed data
  fails closed and the post-window network phase may recover it.
- A Plugin `hooks` path names one self-contained JavaScript ESM OpenCode Plugin
  module. Explicit install/update snapshots and fingerprints the exact bytes in the
  private Hook authorization store before package publication. OpenCode receives
  only those immutable file URLs, in stable Plugin-id order after base Plugins and
  before the strong protected-path guard. Changed bytes disable that Plugin Hook
  and require reinstall without disabling other authorized Hooks. Authorization
  parses but never executes the module; it requires valid ESM with an exported
  OpenCode Plugin entry. Static `node:`/`bun:` built-ins are the only imports that
  may remain, except runtime module-loader APIs such as `node:module`. CommonJS
  globals and every other dependency must be bundled out of the declared file.
  Default/background provisioning may check metadata but must recheck the parsed
  candidate and cannot authorize new Hook bytes.
  Post-publication Agent invalidation runs outside the per-Plugin mutation lock so
  an in-flight Agent startup can finish Hook resolution. Desktop then reacquires
  that lock, reads the latest installed identity, reconciles execution state, and
  removes superseded snapshots only after the old generation has disposed.

## 8. Plugin host boundary

Canvas already owns the file renderer and node-toolbar registries. Desktop may map a
validated Plugin manifest into those registries; it must not add another extension
bus, Canvas node role, or parallel mutation API. A Plugin surface remains a `file`
node and calls existing clients/controllers through a narrow host adapter. The Web
renderer is therefore a presentation contribution, not the owner of Plugin identity,
permissions, Canvas transactions, or Project scope.

Canvas also exposes one explicit host-neutral selection action slot. It renders an
action in an eligible single-node toolbar or the multi-selection toolbar against
an immutable document/selection snapshot, isolates visibility failures, prevents
duplicate execution, and aborts stale work. Desktop maps only validated manifest
selection-action declarations onto fixed host editors and generation operations.
Sandboxed Plugin frames cannot register arbitrary callbacks, receive native paths,
or select a native adapter by string.

Third-party Web Plugin code is static HTML/JavaScript rendered in an iframe with exactly
`sandbox="allow-scripts"`. It is never imported into the renderer bundle, loaded as
an Electron `webview`, or given Node, Electron, same-origin, arbitrary network, or
absolute-path access. A dedicated static protocol performs containment checks and
fixed MIME/CSP handling.

A declared Agent Hook is a separate executable boundary, not a Web surface. Desktop
does not import it; OpenCode loads the authorized private snapshot as a native Plugin.
The first ABI permits one self-contained `.js`/`.mjs` file with no dynamic or
unbundled package imports, so dependencies cannot escape the authorized byte
identity. Hook modules are user-global but OpenCode instantiates them per workspace
directory. A synchronous client-use lease makes configuration refresh wait for
admitted calls and blocks new calls before disposal begins. Superseded snapshots
remain available until the old generation completes bounded disposal and server
close; only then may reconciliation collect them.

Each mounted node receives a fresh `MessageChannel`. Legacy node-scoped methods bind
that port to the exact installed Plugin, active Project, active Canvas and owning
node. Plugin instance-state writes may update only that node's namespaced portable
state.

V5 Project/Canvas methods leave the Web renderer immediately through an opaque,
sender-scoped main connection. The main broker binds the connection to the exact
installed manifest digest and a host-issued Project scope, then revalidates identity,
grant, Project binding and Canvas catalog membership on every call. The independent
grants are `projects.read`, `canvas.catalog.read`, `canvas.document.read`,
`canvas.document.write`, and `canvas.events.subscribe`; a node or iframe never
becomes the authorization root. A Plugin without `projects.read` remains scoped to
the presentation Project, while that explicit grant permits pathless discovery of
all currently bound Projects.

An already-running verified v5 Tool sidecar may reach the same broker through a
fixed reverse-MCP method family. Because it has no presentation Project, the adapter
is created only with `projects.read`, uses an all-bound-Projects scope, and still
filters every method by its independent Canvas grant. It extends an existing
generation/service runtime rather than creating an implicit Canvas-only process
lifecycle; runtime disposal closes the connection and all subscriptions. Built-in
principal validation exists, while a direct built-in transport adapter remains
future work.

Document reads use bounded `geometry` or `structure` projections. Geometry contains
only ids, topology, positions and sizes. Structure may add portable metadata and
Project-relative resource references, but neither projection carries native paths,
runtime URLs or resource bytes. Writes are bounded, revision-checked, resource-free
Canvas application transactions. Resource read/admission is a separate Project
business capability so a document command cannot forge a file reference or bypass
asset lifecycle rules. Change events are revision-only invalidations; consumers
re-query the projection they need.

Broker reads and writes go directly through Main's Canvas application/repository
boundary. Revision and storage CAS serialize persistence; exact content/reference
guards protect long-running work. A mounted editor keeps only gesture state and an
optimistic projection, submits element-level commands with `expectedRevision`, and
never persists a whole document. Every Main commit publishes a revision-only
invalidation through `CanvasDocumentChangeBus`; renderer reloads the authoritative
document without first saving its stale projection. Delayed or failed renderer
synchronization cannot block or reverse a Main commit. Agent and Tool signals are
rechecked before durable Canvas saves.

A Plugin may read image bytes only when its manifest declares the connected-image
capability and the image feeds the owning node through a direct incoming Canvas
edge. Desktop derives the typed Project-file or managed-asset reference from that
node and delegates one scoped request to Main. Main performs two bounded physical
reads; each opens a no-follow handle, enforces JPEG/PNG/WebP plus the 16 MiB ceiling,
performs a fixed-length read and rejects identity changes. Main rechecks the active
scope, direct edge and exact typed reference after each read, then requires matching
content digests and metadata before returning bytes. The Plugin never supplies a
Project path. This legacy connected-image method does not return a document
projection; separately granted v5 document reads use the bounded broker projections
described above. Browser features such as
fullscreen are likewise enabled per manifest; all other iframe feature-policy
denials remain in force.

V6 Web nodes may separately request `canvas.connectedInputs.read`. Its fixed
`canvas.connectedInputs.list` method returns pathless, bounded metadata for direct
incoming file nodes in edge order: node id, media kind, display label/name, MIME,
status, and basic dimensions/duration. It never returns bytes, Project-relative or
native paths, URLs, or credentials. The
`canvas.connectedInputs.changed` command is only an invalidation signal; it does
not authorize transfer or trigger a Tool/Agent call. External transfer requires an
explicit user action and runs through the verified Main-owned operation boundary.
Here and in document projections, an input means only an edge whose `target` is the
owning Plugin node: the source card's right-side output feeds the Plugin card's
left-side input. Outgoing neighbors are outputs and are never included as inputs.

A node-scoped Plugin may add one current-frame PNG only when its manifest declares
`canvas.image.write` and calls `canvas.image.create`. The iframe supplies bounded
PNG data and a portable filename, never a Project path, Canvas node id, position,
or relation target.
Desktop revalidates the exact installed Plugin identity, owning node, current
revision, writable scope, and one-in-flight frame gate, then forwards the bytes over
a cancellable sender-scoped IPC operation. Main takes the external-document
mutation lease, stages and imports the bytes into managed `.convax/assets`, and
calls the shared Canvas resource business operation to place the image and connect
it from the owning Plugin node. Any failed Canvas commit removes the newly admitted
asset; renderer destruction, scope changes, and caller cancellation fail closed.

### Retired built-ins

Removing an id from the built-in catalog removes its host trust and default
installation immediately. An older provenance-marked package may remain visible as
an ordinary installed static Plugin so the user can update or uninstall it. Only an
explicit update may replace that exact digest-verified retired package with a newer
Registry package; the replacement drops the host-only provenance marker. Retired
ids grant no native behavior, reserved routing, Agent tools, or preload namespace.

Vendor-specific desktop integrations belong in Registry Tool Plugins. Their Web
surface, owned Skill and reviewed executable companion are released together.
Desktop supplies only generic connected-input staging, principal-bound execution,
cancellation and return-delivery contracts. The companion receives bounded
host-staged inputs and owns vendor process, protocol or Deep Link behavior without
importing Convax packages. No vendor id, model, executable or workflow is compiled
into Desktop.

### Native Canvas media drag-out

Canvas exposes a host-neutral selection drag-source lifecycle next to its existing
selection actions. Desktop contributes that source only when the complete selection
contains managed image, video or audio file nodes and no edges. Preparation begins
only after an explicit drag-out intent. The primary UI is the persistent **Drag to
Other Apps** Canvas mode; `Command-Shift` on macOS (`Control-Shift` reserved for
Windows) remains a transient compatibility gesture. The persistent mode preserves
normal selection, box selection, pan and zoom, but disables in-Canvas node movement:
dragging a ready selected media node publishes the complete selection to the operating
system instead. Canvas keeps a top reminder and explicit exit action while the mode
is active, and prepares a fresh one-use source after each completed native drag.
Escape, explicit exit, scope changes and read-only transitions leave the mode.
Modifier release and window focus loss cancel only the transient chord gesture.
Selection changes synchronously update the live view snapshot and replace the
prepared immutable multi-selection. Preparation is asynchronous and abortable;
`dragstart` only consumes an already prepared source synchronously.

Renderer and preload never receive a native path. Main re-resolves the live active
Canvas and exact selection, verifies revision, managed `.convax/assets` references,
MIME/signature, regular-file identity and aggregate limits, then stages private
copies below `userData/canvas-external-drags`. It returns a one-use, sender-scoped,
short-lived opaque ticket. Before publication, Main derives a bounded native preview
from the first staged material; multi-selection adds a count badge, while video and
audio may use the operating-system thumbnail or associated file icon. Electron's
native `webContents.startDrag` publishes those copies and the prepared preview to the
operating system, so Finder, JianYing and other file-drop consumers
share the same path without destination-specific UI automation. Expired, canceled,
consumed and crash-left stages are bounded and removed by Main. Windows remains an
explicit native-drag WIP until its behavior is verified; no automation fallback is
allowed.

## 9. Workbench layout boundary

Workbench owns the generic state transition: part size, visibility, collapse
threshold, begin/update/end/cancel resize, and restoration of an expanded size.
Desktop owns viewport budgets, concrete pixel values, pointer/keyboard listeners,
responsive overlay rules, CSS transitions, reduced-motion behavior, and localStorage
adapters. Project Sidebar still owns its internal vertical Canvases/Files split.

This distinction applies to future panels: add generic state only when it is reusable
window coordination; keep the product's visual implementation in the host.

## 10. Electron boundary

- Main: native I/O, Electron lifecycle, Project Node adapters, Canvas repositories,
  Agent runtime, and trusted IPC handlers.
- Preload: the narrow typed `window.convax` bridge; no business state.
- Renderer: React shell, controllers, coordinators, view adapters, and preferences;
  no Node/Electron imports.

The public bridge keeps separate namespaces for Project lifecycle, Project Files,
Project Canvas, Canvas documents/views, Agent runtime, Plugin management, Plugin
capabilities, and Plugin Services. Plugin Services accept only an installed Plugin
id through fixed actions.
The Canvas native-drag bridge is a two-phase exception required by Electron: an
async prepare call returns only an opaque sender-scoped ticket, then a synchronous
`dragstart` message consumes it. Main rechecks the active Canvas selection before
preparation and never exposes staged paths through preload.
Incompatible bridge changes must bump the Desktop protocol version so stale
main/preload/renderer combinations fail visibly instead of hanging.

The Canvas document bridge exposes authoritative `load` and application-command
`execute` only. Renderer translates local optimistic edits into an element-level
`document.patch` command and supplies the last acknowledged Main revision. Main
derives the renderer actor identity, applies the command through
`CanvasApplicationService`, persists through repository CAS, and returns the
authoritative document. Main-originated commits publish invalidations; renderer
projection refresh and optional view effects are best-effort consumers.

## 11. Portable paths and trust boundaries

Contracts carry only normalized POSIX-style Project-relative paths. Native adapters
join them with the bound root using `node:path`, validate containment, and defend
against symlink replacement. No portable document stores a machine absolute path.

Windows is a first-class target. Validate drive-absolute and UNC paths, backslash
traversal, reserved device names including superscript forms, alternate data streams,
trailing dots/spaces, case-insensitive reserved paths, and cross-device moves. Use
`pathToFileURL` instead of constructing file URLs.

## 12. Adding a capability

Before implementation, answer:

1. Which package uniquely owns the invariant and canonical state?
2. Is this a domain capability, host adapter, window coordinator, or visual primitive?
3. Can callers use an existing public API? If not, what is the smallest typed port?
4. Does UI and Agent need the same business operation?
5. Is state user-specific, Project-portable, or transient?
6. Does the change introduce a forbidden dependency or Node/browser leak?
7. What migration, stale-response, rollback, Windows, and symlink tests are needed?

If the answer changes this contract, update this document, the relevant
`AGENTS.md`, `package-boundary-check.ts`, and tests in the same change.
