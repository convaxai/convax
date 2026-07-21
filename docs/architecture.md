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

### Workbench

Workbench is window-scoped interaction state: the active Input, Input-scoped
Selection, derived Surface, guarded navigation, and generic top-level layout-part
transactions. It is the only source of the active Canvas/file. It does not persist
Project or Canvas data and has no DOM, React, Electron, or localStorage dependency.

### Workspace

There is no current Workspace aggregate. The term is reserved for a future feature
where one window/session genuinely coordinates multiple Projects. The legacy schema
name `convax.canvas-workspace/1` exists only as a migration input.

### Skill and Plugin

An OpenCode Skill is a trusted instruction bundle discovered and executed by the
existing Agent runtime. A Convax Plugin is an installable product surface or
integration composed by Desktop from existing Canvas, Project and Agent
capabilities. Third-party Web Plugin code remains sandboxed. A built-in integration
may additionally have a trusted Desktop adapter, but its static package cannot invoke
that adapter and does not grant the same privilege to imported packages. Trusted
built-in status is host-authored provenance over the exact catalog bundle, never a
manifest id/version claim. Plugins may provide a separately managed companion Skill,
but they are not the same extension mechanism: Skills describe Agent workflows and
select tools; they never implement UI or native behavior, and Plugins never become
OpenCode plugins.

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
| Canvas document and revision                             | Canvas application service/repository        | Mutations use commands and conflict checks                               |
| Plugin node instance state                               | Owning Canvas `file` node                    | Bounded namespaced JSON inside the Canvas document; never iframe storage |
| Top-level sidebar size/visibility/resize transaction     | `WorkbenchLayoutController`                  | Desktop supplies pixels, events, animation and persistence               |
| Agent sessions                                           | `@convax/agent-runtime` scoped by the host   | Never stored in Project Canvas state                                     |
| OpenCode Skill discovery                                 | `@convax/agent-runtime`                      | Desktop owns only the managed install adapter and UI                     |
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
  opencode/skills/user/<skill>/         Convax-managed OpenCode Skills
  plugins/<plugin-id>/                  validated static Plugin packages
    .convax-builtin.json                host-authored catalog provenance, when applicable
  plugin-companions/<plugin-id>/<plugin-version>/
                                        Registry-verified host-owned Tool executables
  plugin-authorizations/<plugin-id>/
                                        install-time exact Tool execution receipts
  plugin-service-authorization-checkpoints/<plugin-id>.json
                                        private crash-recovery Cookie handoff; never a browser profile
  canvas-external-drags/                short-lived host-owned native drag copies

~/Movies/JianyingPro/ConvaxImports/     macOS media staged for bounded JianYing transfer

browser localStorage                    per-user Workbench/renderer preferences

<project root>/
  .convax/
    project.json                        stable Project identity only
    canvases/catalog.json               portable Canvas catalog, no selection
    canvases/<canvas-id>/document.json  Canvas document
    assets/                             managed Canvas resources
```

`Create Project` receives only a portable project name from renderer and creates a
new root at `<user Documents>/Convax/<project name>` without opening a native folder
picker. `Open Project` is the explicit path-binding flow and keeps the native folder
picker for an existing portable Project directory. The default creation directory is
a Desktop host policy; Project's native adapter still owns name validation, safe
directory creation, identity initialization, and registry publication.

Private Project metadata is owned by `@convax/project/node`. Renderer, preload,
Agent tools, and general Project Files operations do not read or write its JSON.
Managed assets are the explicit exception: they are imported/copied through the
scoped Project Files capability into `.convax/assets`, while the rest of `.convax`
remains hidden and protected.

The remote capability catalog and showcase caches are Desktop-owned, user-global,
and non-authoritative. Catalog reads may return the validated local snapshot
immediately while Main single-flights a bounded background ETag revalidation;
install/update operations still request a network-first Registry view. Showcase
indexes publish monotonically with their Registry identity. Media is cached across
restarts by its verified SHA-256 in a bounded LRU and is rechecked for declared size,
digest and MIME bytes on every admission. Losing any cache never removes installed
capabilities; an invalid or rolled-back network response never replaces it.

Canvas JSON is an implementation detail behind `CanvasDocumentRepository` and Canvas
application services. A schema change needs a version, a migration path, and tests
using real old data. Never “fix” an incompatibility by deleting or silently resetting
portable data.

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
models, captures, and other binary payloads belong in managed Project assets; node
state stores only portable references to them.

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
`CanvasResourceBusinessService`, imported into managed `.convax/assets/`, and then
referenced by the existing Canvas `file` node flow.

Executable integrations use `convax.plugin/2` or declarative `convax.plugin/3`: a
validated manifest declares generation tools and a separately installed bare
`mcp-stdio` command. V3 maps pure model names and optional Agent/Canvas operation
surfaces to those tools, so core code never identifies an operation by Plugin id. An official
Registry entry may additionally bind that exact command to immutable executable
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

Desktop copies validated Canvas inputs into a short-lived directory and gives the
tool only those copies plus a dedicated output directory. It admits only bounded,
signature-checked results from that output directory, then removes the temporary
tree. Scope, revision, placement, native Project paths, Canvas persistence and
generated-node creation remain host-owned. Sandboxed Plugin callers receive only
the `generation.execute` methods in the host protocol matching their manifest; the host derives their
scope and references from the live owning node and its direct incoming edges.

Tool-custom generation controls come only from the selected sidecar's current MCP
`tools/list.inputSchema`, never the Plugin manifest or a parallel provider/model
registry. Main lazily describes one explicitly selected tool, projects only bounded
top-level scalar fields across preload, and revalidates caller values against the
same live tool definition before execution. Those validated fields extend the
`convax.generation-call/1` object without being allowed to replace its fixed
host-reserved envelope; tools without extensions keep the original payload.

The Agent generation model is a user-global renderer preference. Without an owning
node override, a file card inherits that preference only when its output matches the
card's intrinsic text/image/video/audio kind. The card catalog contains only tools
with that output, and mismatched Agent defaults or persisted overrides fail closed.
A manual card choice stores only the opaque host tool id in versioned, namespaced
Canvas node metadata; clearing it restores automatic resolution. The node override
is portable and undoable with the Canvas document, never updates the Agent preference
in reverse, and fails closed when its tool is no longer installed or compatible.

Direct Generate-tab calls include Canvas references only when the user explicitly
mentions those nodes. Merely opening generation from an image, video, audio or text
card never turns the owning card into an implicit input. Agent mode may prepare its
own scoped Canvas context, but every media reference that reaches generation still
passes the same managed-asset and live-revision guards.
Known file-card modalities also constrain the direct model catalog and result: an
image card accepts only image tools, a video card only video tools, and a mismatched
Agent default or persisted card override fails closed. This output constraint is
independent from Agent-mode references, where an explicitly mentioned image may
still be a valid input to a video tool.

A direct file-card generation is transiently owned by that mounted file node, not by
the selected-card composer. Submit dismisses the composer immediately while the file
card keeps a pending surface for arbitrarily long non-terminal work. Selection
changes do not cancel that work; removing the owner or leaving its Canvas disposes
it. Terminal failures remain recoverable on the card, while success clears the
transient activity after the normal Canvas business operation commits.

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

### Canvas mutation from UI or Agent

```text
UI action or typed Agent tool
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
- Desktop prepares structured resources, binds the active Project scope, and exposes
  the MCP/tool schema. `@convax/agent-runtime` remains unaware of Convax semantics.
- Tool arguments cannot select another Project or Canvas or expand the host-provided
  scope. A Canvas-specific tool resolves the live active Canvas from the host and
  treats any model-provided Canvas id/revision only as a consistency assertion.
- Canvas attachments are validated read-only snapshots. Agents mutate through tools,
  never by shell/file edits under `.convax`.
- Opening a Project must not discover project-local `.agents`/`.claude` Skills or
  executable OpenCode extensions. Managed Skill changes refresh volatile OpenCode
  discovery state without replacing durable sessions.
- Skill management may inspect a selected managed or globally discovered Skill as a
  bounded, non-executable directory for its file tree and text preview. Global Skills
  remain read-only, symlinks fail closed, and renderer IPC identifies the Skill but
  never carries a native path. Showcase media is separate presentation metadata:
  fixed bundled assets for built-ins or digest-verified Release sidecars for remote
  Skills, loaded lazily and played only while visible.
- A Plugin companion Skill uses the same managed Skill lifecycle. User-installed
  companions are explicit. A catalog item may request one-time default provisioning;
  Desktop records the completed Plugin and Skill independently so later user removal
  is respected. A companion never gains extra Plugin permissions or bypasses typed
  capabilities.
- The official remote Registry is fetched only by Desktop main from its fixed
  origin. Renderer requests carry stable catalog ids, never URLs, paths or digests.
  Desktop verifies catalog sequence, compatibility, immutable artifact metadata,
  bounded download size, SHA-256 and a safe ZIP inventory before calling the same
  local Plugin and managed-Skill installers used by checked-in bundles.

## 8. Plugin host boundary

Canvas already owns the file renderer and node-toolbar registries. Desktop may map a
validated Plugin manifest into those registries; it must not add another extension
bus, Canvas node role, or parallel mutation API. A Plugin surface remains a `file`
node and calls existing clients/controllers through a narrow host adapter.

Canvas also exposes one explicit host-neutral selection action slot. It renders an
action in an eligible single-node toolbar or the multi-selection toolbar against
an immutable document/selection snapshot, isolates visibility failures, prevents
duplicate execution, and aborts stale work. Desktop may use this slot for a concrete
trusted integration such as JianYing. This is not a manifest
function-call bridge: sandboxed Plugin frames cannot register or invoke selection
actions, receive native paths, or select a native adapter by string.

Third-party Plugin code is static HTML/JavaScript rendered in an iframe with exactly
`sandbox="allow-scripts"`. It is never imported into the renderer bundle, loaded as
an Electron `webview`, or given Node, Electron, same-origin, arbitrary network, or
absolute-path access. A dedicated static protocol performs containment checks and
fixed MIME/CSP handling.

Each mounted node receives a fresh `MessageChannel`. The port is bound to the exact
installed Plugin, active Project, active Canvas and owning node. Every direct call is
versioned, size-limited, manifest-authorized and delegated to an existing typed
Project/Canvas/Agent capability. Plugin state writes may update only that node's
namespaced portable state.

A Plugin may read image bytes only when its manifest declares the connected-image
capability and the image feeds the owning node through a direct incoming Canvas
edge. Desktop derives the managed Project file reference from that node, preflights
the exact `.convax/assets` reference, and delegates one bounded read to Main. Main
opens one no-follow handle, enforces JPEG/PNG/WebP plus the 16 MiB ceiling, performs
a fixed-length read and rejects identity changes before returning bytes. Desktop
then rechecks scope, connectivity and the exact source reference. The Plugin never
supplies a Project path and never receives a general Canvas snapshot. Browser
features such as fullscreen are likewise enabled per manifest; all other iframe
feature-policy denials remain in force.

### JianYing trusted built-in

JianYing is a concrete trusted built-in integration, not a new Plugin RPC capability.
Its static Plugin package participates in install/uninstall and companion-Skill
lifecycle only; native detection, staging and Deep Link dispatch are compiled into
Desktop main. Runtime enablement requires macOS and a byte-for-byte match with the
catalog bundle's host-authored provenance. Ordinary imports cannot use the reserved
id, author the provenance marker, or enable the native adapter by matching a
version. Catalog installation presence remains separate from this trust decision: a
valid legacy sandboxed Plugin is still shown as installed, but cannot enable native
tools.

This is legacy architecture debt, not a pattern for Plugin authors. Its package is
currently only an install-state switch for code compiled into Desktop, so adding a
second integration of this shape would require new core contracts, IPC, preload,
Agent, renderer, and native service code. It must either be presented solely as an
optional built-in integration or migrate its native behavior to a verified companion
behind a generic external-operation contract. Do not add another identity-gated
Plugin path or encode `jianying` as a nominal generic capability.

Marker-free catalog installations from an older Convax build are claimed only after
their complete canonical digest matches the current bundle or a compiled historical
fingerprint. Missing packages remain missing, so this migration cannot undo a user
uninstall.

The Canvas toolbar action appears for one or more selected image/video nodes backed
by managed Project references under `.convax/assets`: single media uses its node
toolbar and multiple media use the selection toolbar. Main reloads the live active
Canvas, checks the expected revision and selected nodes,
validates matching image/video MIME and regular contained files, and only then
resolves native paths and stages copies. Remote-only media and other private
`.convax` paths are ineligible. On an active draft the toolbar imports directly. If
there is no active draft, Desktop first dispatches JianYing's force-create route and
proves that a newly created directory became active before sending any media.
Creating a new draft while another draft is open is an explicit macOS WIP and fails
before native mutation; the Agent asks the user to return JianYing home, inspects
again, and proceeds only from a no-active/not-running observation. Ambiguous or
unsafe draft observations fail closed, and an unverified create never falls back to
the previously active draft.

Desktop does not drive JianYing UI and requires no Accessibility, Apple Events, JXA
or `AXPress` access. New-draft export uses two ordered native Deep Links: force-create
and verify, then the same current-draft material import used by toolbar export. For
the duration of the material dispatch, main binds a media server to `127.0.0.1` on a
random port. Each staged item is exposed only at its own unguessable opaque-token
URL, and the import payload contains only those loopback URLs. Unknown routes and
unscoped files remain inaccessible. Main keeps the server alive while the bounded
operation awaits every requested transfer, then closes it after all items complete
or when the bounded operation fails.
The currently supported JianYing Deep Link imports each item into both the material
panel and the timeline; it exposes no verified panel-only parameter, so Convax must
not promise panel-only behavior.

The native adapter boundary reserves Windows explicitly, but its current Windows
implementation is WIP and fails closed as unsupported without attempting a fallback
automation path. This platform limitation does not widen the static Plugin package
or companion Skill.

The companion Agent workflow first inspects draft state. If a draft is active, the
Agent asks the user to choose that draft or a new one and submits the short-lived
observation token for a current-draft export. If the user chooses new, the Agent
explains the active-to-new WIP boundary, asks the user to return JianYing home, then
inspects again before submitting a new-draft export. Its tool schema does not accept
a Project or Canvas id; Desktop injects the currently mounted Canvas and rejects a
stale revision. The companion Skill explains this workflow but grants no tool or
native permission and remains independently installable/removable from the Plugin.

### Native Canvas media drag-out

Canvas exposes a host-neutral selection drag-source lifecycle next to its existing
selection actions. Desktop contributes that source only when the complete selection
contains managed image, video or audio file nodes and no edges. Preparation is
not started by selection alone: the user holds `Command-Shift` on macOS
(`Control-Shift` reserved for Windows) and drags any selected node body. Either
modifier release, window focus loss, Escape, scope changes and expiry cancel the
gesture. The held chord is tracked at the window boundary, independently of
focus and current selection eligibility. A user may therefore hold first and
then point at or select one eligible media node; changing an eligible multi-selection
while the chord remains held replaces only the prepared selection. Preparation is asynchronous,
abortable and bound to the immutable document/selection snapshot; `dragstart` only
consumes an already prepared source synchronously.

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
Services, and narrow trusted native integrations such as `jianying`. Plugin Services
accept only an installed Plugin id through fixed actions. The JianYing bridge accepts only a Project/Canvas
reference, revision, node ids and a constrained target; native paths remain in main.
The Canvas native-drag bridge is a two-phase exception required by Electron: an
async prepare call returns only an opaque sender-scoped ticket, then a synchronous
`dragstart` message consumes it. Main rechecks the active Canvas selection before
preparation and never exposes staged paths through preload.
Renderer assigns every export an opaque `operationId`; it keeps the live
`AbortSignal` in the renderer realm and sends only cloneable start/cancel messages
through preload. Cancellation is scoped to the originating trusted renderer and is
honored through validation, staging and the final pre-dispatch check. Cancellation
before Deep Link dispatch is safe. Once dispatch may have produced a JianYing side
effect, Desktop lets the bounded transfer finish and reports its observable outcome;
an unknown or partial post-dispatch outcome must never be retried automatically.
Main also cancels pre-dispatch work on renderer destruction or IPC disposal and
re-resolves the live active Canvas before starting.
Incompatible bridge changes must bump the Desktop protocol version so stale
main/preload/renderer combinations fail visibly instead of hanging.

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
