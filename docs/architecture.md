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
| `@convax/media-generation` | Provider-neutral AI image/video generation contracts and model/job shapes     |
| `@convax/agent-runtime`  | Host-agnostic OpenCode integration and protected execution boundary             |
| `@convax/desktop`        | Electron composition root, IPC, adapters, coordinators and product shell        |

Allowed internal runtime dependencies:

```text
@convax/ui             -> none
@convax/project-files  -> none
@convax/workbench      -> none
@convax/media-generation -> none
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
  opencode/skills/user/<skill>/         Convax-managed OpenCode Skills
  plugins/<plugin-id>/                  validated static Plugin packages
    .convax-builtin.json                host-authored catalog provenance, when applicable

~/Movies/JianyingPro/ConvaxImports/     macOS media staged for bounded JianYing transfer

browser localStorage                    per-user Workbench/renderer preferences

<project root>/
  .convax/
    project.json                        stable Project identity only
    canvases/catalog.json               portable Canvas catalog, no selection
    canvases/<canvas-id>/document.json  Canvas document
    assets/                             managed Canvas resources
```

Private Project metadata is owned by `@convax/project/node`. Renderer, preload,
Agent tools, and general Project Files operations do not read or write its JSON.
Managed assets are the explicit exception: they are imported/copied through the
scoped Project Files capability into `.convax/assets`, while the rest of `.convax`
remains hidden and protected.

The remote capability catalog cache is Desktop-owned, user-global, and
non-authoritative. It contains only a previously validated official Registry
document plus transport metadata. Losing it never removes installed capabilities;
an invalid or rolled-back network response never replaces it.

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

### AI media provider boundary

`@convax/media-generation` defines contracts only. One outer provider adapter may
discover and execute many provider-owned model slugs. Image contracts preserve the
buffered or streamed lifecycle; video contracts preserve create, retrieve and
content as an asynchronous job lifecycle. The serializable request uses OpenRouter-
style fields, while execution-only cancellation stays in separate call options.

Desktop may later own concrete adapters, credentials, selection and fallback
orchestration, then adapt completed output into the existing Canvas resource flow.
The contract package does not implement HTTP, register providers, select defaults,
persist signed URLs, or expose Canvas/Project types.

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
action in an eligible single file-node toolbar or the multi-selection toolbar against
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
Project Canvas, Canvas documents/views, Agent runtime, and narrow trusted native
integrations such as `jianying`. The JianYing bridge accepts only a Project/Canvas
reference, revision, node ids and a constrained target; native paths remain in main.
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
