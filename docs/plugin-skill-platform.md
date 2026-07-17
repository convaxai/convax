# Plugin and Skill Platform

Status: implementation contract for the first vertical slice.

This design deliberately uses two existing product concepts instead of combining
them into a generic extension framework:

- an **OpenCode Skill** is a trusted instruction bundle discovered and executed by
  OpenCode; it explains a workflow and selects typed tools but is not executable
  native product code;
- a **Convax Plugin** is an installed product surface or integration lifecycle
  composed by Desktop from existing Canvas, Project and Agent capabilities.

A Plugin may reference a companion Skill so users can install the UI/integration and
its Agent workflow together. They remain two capabilities with separate validation,
storage, receipts and removal. Neither inherits the other's authority.

OpenCode plugins are Agent-runtime hooks and are not Convax Plugins.

## Ownership

| Concern                                                                                                | Owner                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Skill discovery and execution                                                                          | `@convax/agent-runtime` through OpenCode   |
| Managed Skill validation/copy/removal                                                                  | `@convax/agent-runtime/node`               |
| Canvas renderer and node-toolbar registration                                                          | existing `@convax/canvas` registries       |
| Plugin package discovery, static assets, native import dialogs, trusted provenance and native adapters | Desktop main                               |
| Plugin iframe rendering and scoped host calls                                                          | Desktop renderer composition               |
| Global settings, language and capability management UI                                                 | Desktop renderer preferences/views         |
| Active Project and Canvas                                                                              | existing Project and Workbench controllers |
| Project/Canvas/Agent invariants                                                                        | their existing typed services and clients  |

There is no new Workspace aggregate, extension bus, service locator, Canvas node
role, or alternate Agent runtime. A Plugin renderer remains a Canvas `file` node.

## Persistence

```text
packages/desktop/resources/
  skills/<skill-name>/...                   checked-in built-in Skill packages
  plugins/<plugin-id>/...                   checked-in complete static Plugin packages

Packaged Convax application/
  built-in catalog assets                      read-only install sources

Electron userData/
  default-capabilities.json                    one-time default provisioning receipt
  capability-registry/index-v1.json            last-known-good official Registry cache
  opencode/
    skills/
      user/<skill-name>/...                 managed Skills, including explicitly installed companions
  plugins/
    <plugin-id>/
      manifest.json
      <static package files>
      .convax-builtin.json                  host-authored catalog provenance, built-ins only

macOS user Movies directory/
  JianyingPro/ConvaxImports/...             validated media staged for bounded JianYing transfer

Project root/
  .convax/canvases/.../document.json        plugin node reference and portable state

Browser storage/
  convax.desktop.app-language.v1            per-user UI language only
```

Built-ins follow the same validated copy lifecycle as imported capabilities. Most
items become visible in the catalog and require an explicit install. A catalog item
may opt into one-time default provisioning; Desktop copies it on first eligible
startup and records separate Plugin and companion-Skill receipts in
`default-capabilities.json`. The receipt prevents a later user uninstall from being
silently reversed. Runtime loading never reaches back through a source-tree path.
Built-in catalog code imports complete packages from Desktop `resources`, never from
`src/main` or `node_modules`. A companion Skill is a second copy into the managed
Skill root and remains independently removable.

Catalog Plugin ids are reserved from ordinary directory imports. A trusted built-in
installation receives a host-only provenance marker containing its id, version and
catalog bundle digest; package input cannot supply that reserved file. Native
enablement revalidates the marker, digest and installed files against the current
catalog bundle. Therefore an imported package that copies a built-in manifest cannot
become trusted or activate its native adapter. Catalog built-ins may be atomically
reconciled to a new checked-in bundle; arbitrary installed Plugin replacement
remains deferred.

At startup Desktop may claim an already-present pre-provenance built-in, but it never
installs a missing non-default item. Claiming requires the complete installed file
set to match either the current catalog bundle or an explicitly compiled historical
version plus canonical SHA-256. Unknown reserved-id packages, case-variant
provenance paths, same-version byte changes and post-marker tampering fail closed.

Installed built-ins are never overwritten on application startup. When the catalog
contains a newer SemVer, management shows the installed and target versions and the
user may explicitly update through the existing catalog-install action. The manager
fully validates a staging copy, switches same-root directories, and restores the old
directory if the second rename fails. Imported packages still cannot replace an
installed id, and equal-version or downgrade catalog replacements are rejected.

An installed Plugin package is global to the user. A Canvas document stores only a
stable plugin id/version reference and namespaced portable instance state. Removing
a Plugin therefore does not destroy Canvas nodes; they fall back to the unknown-file
renderer and recover after reinstall.

Portable instance state is a bounded, atomic JSON snapshot on the owning node. It
is the canonical state used by reload, node duplication, Canvas cloning and Agent
resources; iframe `localStorage`/`IndexedDB` is not. The Plugin adapter owns a schema
version and explicit migrations, and must fail closed without overwriting an unknown
or invalid snapshot. A Plugin may keep its domain document and portable presentation
state in separate fields of that snapshot—for example a 3D scene graph and the
director viewport camera—without turning selection, animation or transient errors
into Canvas state. Binary media is imported into managed Project assets and is
represented here only by portable references.

## Skill lifecycle

Convax mounts its managed OpenCode config directory with `OPENCODE_CONFIG_DIR`.
OpenCode continues to discover its normal global config and Skills. Project config
and ambient project `.agents`/`.claude` Skills stay disabled, so opening a folder
cannot silently add instructions or executable Agent extensions.

The installer accepts one local directory containing `SKILL.md`, validates the
frontmatter and every copied path, rejects links and Windows-unsafe names, applies
size limits, and commits through a staging rename. Convax may remove only content in
its own managed root. External global Skills are visible but read-only.

OpenCode caches Skill discovery per instance. A managed install or removal disposes
the volatile OpenCode instance state and clears host registrations, while preserving
durable sessions and messages. Refresh is deferred while a prompt is running.

Remote `skills.urls` is not exposed by this slice. Market downloads must be fetched,
validated and staged by Convax before entering the same local lifecycle.

## Official remote Registry

The official catalog is published by `microvoid/convax-plugins`. GitHub Pages hosts
the small versioned Registry index and immutable GitHub Release assets host one ZIP
per Plugin or Skill version. Desktop main is the only network client. It uses a
fixed index URL, validates a monotonic Registry sequence and exact supported host
schemas, and retains a last-known-good cache for offline listing.

The Registry repository and Release assets are public and anonymous; the Convax
application source repository may remain private. Desktop uses an Electron
`net.request` adapter for downloads because Electron cancels
`net.fetch(..., { redirect: "manual" })` instead of returning the GitHub Release
redirect. The adapter turns each native redirect event into a response that the
Registry client validates against its CDN allowlist before issuing the next request.

The renderer sees validated catalog summaries and submits only a stable item id.
Desktop downloads the selected immutable asset with a byte limit, follows only the
approved GitHub Release redirect hosts, verifies the declared size and SHA-256, and
decodes a bounded ZIP inventory. ZIP paths, file types, compression ratios,
checksums, duplicate/case-colliding names and expanded sizes are checked before the
files enter `WebPluginManager.installBundle` or
`DesktopSkillManager.installFromFiles`. Those managers remain the only durable
installation boundary and repeat their normal manifest/frontmatter/path checks.

Plugin ZIPs have `manifest.json` at their root and may carry a companion Skill at
the manifest's `skill` path. Standalone Skill ZIPs have `SKILL.md` at their root.
The catalog can present both together, but Plugin and Skill install, refresh,
receipt and removal outcomes remain independent. The first remote slice installs
only absent packages; replacement, downgrade and automatic update remain deferred.

## Management surface

Global capabilities are managed from Desktop Settings, not from the no-Project
empty state and not from a floating Canvas action. Once a Project is active, the
Project sidebar injects a Desktop-owned **Local workspace** menu; both its expanded
and collapsed forms can open Settings or jump directly to Skill and Plugin
management. No Account identity, quota, or logout state is implied.

Settings is a Desktop overlay rather than a Workbench Input, so the active Canvas
stays mounted and keeps its Project/Canvas scope. The initial global sections are
General (English by default or Simplified Chinese UI language) and Skill & Plugin.
Language is a renderer preference, never Project metadata. Host-owned settings and
capability copy is localized; Plugin manifest content and independent package UI are
left untouched.

## First built-in workflows

The catalog validates useful end-to-end behavior instead of shipping placeholder
surfaces:

- **Storyboard Builder** turns a script or brief into ordered shot cards by composing
  the existing Canvas query, resource business, primitive and view tools.
- **3D Director Desk** embeds the MIT-licensed StoryAI director surface for spatial
  character, geometry, camera, panorama and shot-preview work. Its portable scene
  graph and director viewport camera are stored as separate fields in the owning
  Canvas node through `canvas.node.updateState`; its companion Skill reviews the
  same snapshot through normal Canvas Agent resources.
- **Panorama Viewer** is an original offline WebGL2 surface for equirectangular 360°
  images. It accepts JPEG, PNG and WebP files selected in the sandbox or reads only
  image nodes connected into its own Canvas node through a narrow host capability.
  The selected connected-node preference and view settings are portable; local file
  pixels remain session-local and are never stored in Plugin state.
- **JianYing Editor** is default-provisioned as a trusted built-in Plugin plus a
  separately receipted companion Skill. The package controls lifecycle and describes
  the workflow; its native implementation remains compiled into Desktop main.

The 3D surface keeps the strict Plugin CSP and `sandbox="allow-scripts"`. The
non-open upstream mannequin asset is replaced by the procedural MIT implementation.
Local model import and browser downloads stay hidden until they have narrow host
capabilities; the integration does not widen network or iframe permissions merely
to preserve unsupported upstream buttons.

## JianYing native integration

The current JianYing adapter is macOS-only. The default package may remain installed
and visible in capability management on another platform, but Desktop must not show
its Canvas action or advertise its Agent tools there. The native adapter keeps an
explicit Windows WIP boundary whose implementation fails closed as unsupported; it
must not fall back to UI automation. On macOS those entry points are enabled only
while the exact trusted catalog bundle is installed; id and version matching alone
are insufficient.

The direct toolbar flow is deliberately narrower than Plugin RPC:

1. Canvas shows **Import to JianYing** for one or more selected Project-backed
   image/video nodes whose portable references are below `.convax/assets`. A single
   media node uses its node toolbar; multiple media nodes use the selection toolbar.
   Selections containing remote-only resources, edges, mixed node kinds or private
   `.convax` metadata are not eligible.
2. Desktop flushes the Canvas, passes ids plus its expected revision, and main checks
   that the reference still matches the host's live active Canvas. Main reloads the
   document, validates every node, managed path, media MIME and regular native file,
   then stages copies without exposing an absolute path to renderer or Plugin code.
3. If one active draft is observed, the toolbar dispatches the batch to it. If
   JianYing is not running or no draft is active, Desktop first sends the native
   force-create route and proves a newly created draft became active. Only then does
   it send the normal current-draft import. Ambiguous, unavailable or unsafe
   observations fail instead of guessing, and media is never sent to an unverified
   destination. Creating a new draft while another draft is open remains an explicit
   macOS WIP and fails before any native mutation; the user can return JianYing to
   its home screen and retry from a no-active observation.

Main transports the validated staged batch through JianYing's macOS Deep Links; the
product does not depend on Accessibility permission, Apple Events, JXA, `AXPress`,
window state or localized UI. A new-draft export uses two ordered calls: force-create
and verify, then material import. Before the import call, main starts a server bound
only to `127.0.0.1` on a random port and assigns every media item an independent,
unguessable opaque-token URL. The import payload contains only these loopback URLs;
the server exposes no directory listing, caller-chosen path or other route. It
remains alive while the bounded operation awaits every requested transfer, then
closes after all items complete or when the bounded operation fails.

JianYing's currently verified Deep Link behavior adds each imported image or video
to both the material panel and the timeline. No panel-only parameter is available,
so the toolbar and Agent tool must describe this exact behavior rather than claim a
material-list-only import. The scheme also provides no positive completion
acknowledgement: dispatch success is reported as dispatched unless an independent
observation can prove the result.

The Agent flow uses the same main service but not the toolbar's automatic target.
The status tool returns a short-lived opaque observation token. When a draft is
active, the companion Skill tells the Agent to ask whether to use it or create a new
draft. Current-draft export uses that explicit choice and token. If the user chooses
new, the Agent explains the active-to-new WIP boundary, asks them to return JianYing
home, and calls the status tool again; new-draft export proceeds only from a
no-active/not-running observation. The export schema accepts node ids and an
expected revision, not Project/Canvas ids. Desktop resolves and injects the mounted
active Canvas, rejecting missing, switched or stale view scope.

Canvas aborts the action signal when its immutable document/selection snapshot is
replaced or unmounted. Renderer pairs that signal with a fresh `operationId` and
sends only cloneable start/cancel values through preload; live `AbortSignal` objects
never cross `contextBridge`. Main keys the controller by trusted sender plus
operation id, remembers cancel-before-start races, rejects duplicate/stale
operations, and aborts queued, validation and staging work when the renderer closes.
Cancellation is checked immediately before Deep Link dispatch and is safe before
that point. After dispatch may have produced a JianYing side effect, the bounded
transfer finishes and returns its observable outcome; unknown or partial outcomes
must not be retried automatically. An `operationId` is lifecycle correlation, not
authority and not a way to select scope.

## Plugin package

The first schema is `convax.plugin/1`. Its manifest uses the MiniMax-proven core of
`id`, `name`, `description`, `version`, and an HTML `entry`, then adds only the
contributions required by this product slice:

- Canvas file matching by extension or MIME;
- an optional creatable Canvas plugin node;
- node-toolbar commands delivered to the mounted surface;
- an explicit capability allowlist;
- an optional companion `SKILL.md` path.

Plugin ids are kebab-case. All package paths are relative and validated inside the
package root. Installation rejects symlinks/reparse-point escapes, traversal,
Windows reserved names and alternate data stream syntax. Installation uses staging
and a same-root directory switch with rollback. Only an explicit newer built-in
catalog version may replace an installation; automatic updates and imported-package
replacement remain disallowed. A host-authored built-in provenance marker is not
part of the manifest schema and is reserved from imported packages. The renderer
never imports plugin JavaScript into the host bundle.

## Web surface isolation

A Plugin entry is rendered in an iframe with `sandbox="allow-scripts"`; it never
uses Electron `<webview>`, Node integration, or same-origin access to the host.
Static files are served only from the installed package through a dedicated secure
protocol with containment checks, fixed MIME handling, CSP and `nosniff` headers.

The host creates a fresh `MessageChannel` for each mounted node. The transferred
port is the capability token: toolbar and RPC traffic cannot address another frame
or node. Requests are versioned, size-limited, validated, and checked against both
the manifest allowlist and current host scope.

The initial direct-call surface is intentionally narrow:

| Method                        | Required capability           | Scope                                                                                                     |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `host.context.get`            | none                          | current Project, Canvas and own node                                                                      |
| `canvas.connectedImages.list` | `canvas.connectedImages.read` | metadata for image nodes connected into the own node only                                                 |
| `canvas.connectedImage.read`  | `canvas.connectedImages.read` | one listed embedded image or managed Project image, atomically type-checked and limited to 16 MiB in main |
| `canvas.node.get`             | `canvas.node.read`            | own node only                                                                                             |
| `canvas.node.updateState`     | `canvas.node.write`           | own namespaced state only                                                                                 |
| `project.file.readText`       | `project.files.read`          | current Project relative path                                                                             |
| `agent.prompt`                | `agent.prompt`                | current Project with own node resource                                                                    |

These are adapters over existing clients/controllers. They do not expose private
Project JSON, absolute paths, arbitrary target-node mutation, Electron, or a generic
function-call escape hatch.

`canvas.node.updateState` replaces the Plugin's own snapshot atomically. A surface
may throttle continuous changes, but must flush after pointer/keyboard gesture end,
when hidden, and before teardown; failures use finite retry and visible error UI.
Copies include the latest snapshot accepted by Canvas, not uncommitted iframe memory.
The host delays its one-shot MessagePort transfer until iframe scripts and passive
effects have installed their listener, while new surfaces register that listener
before rendering.

The optional `ui.fullscreen` capability does not add an RPC method. It only lets the
host add `fullscreen *` to that Plugin iframe's feature policy and set
`allowFullScreen`; frames without the capability retain `fullscreen 'none'`.
Connected-image access recognizes incoming Canvas edges only, never accepts a
Project path from Plugin code, and rechecks the exact edge plus source reference
after the asynchronous read. While that capability is granted, the host may also
send `canvas.connectedImages.changed` on the same scoped port; frames without the
capability receive no connection-change signal.

## Skill presentation and inspection

The management surface presents marketplace, Convax-managed and globally discovered
Skills with the same media card and detail dialog. Managed Skills may be removed;
globally discovered Skills are explicitly read-only. Details for an installed Skill
come from its actual local directory, not from similarly named catalog metadata.
The Agent Runtime reads that directory as a bounded, non-executable bundle, rejects
symlinks and unsafe paths, and returns bytes to Desktop for a size-limited plain-text
preview. No preview operation evaluates Skill scripts or grants new capabilities.

Showcase media is presentation metadata rather than installable Skill content.
Checked-in Skills use fixed host-bundled assets, while remote Skills use the verified
Registry sidecar and immutable Release assets. Main reads or downloads the selected
poster or animation; renderer requests carry only a typed Skill identity and media
kind. Media loads lazily, an animation plays only while its card is visible, and a
reduced-motion preference keeps the poster static. A discovered Skill without known
presentation metadata uses the neutral placeholder but still exposes its real file
tree and content preview.

## Agent relationship

Every file renderer already receives the Canvas file-assistant accessory. Attaching
a plugin node gives the Agent a validated read-only snapshot of that node and its
edges. Mutations still use typed Canvas tools.

A companion Skill may be installed explicitly, or provisioned once by a default
built-in catalog item, into the same managed user Skill store. It remains installed
independently if the Plugin is removed; the provisioning receipt is not an ownership
graph. It may explain the Plugin workflow and select existing business, primitive
and view tools. It does not expose native code, register tools, confer trusted
built-in provenance, or duplicate Canvas/Project invariants. A future Plugin command
exposed as an Agent tool must be a thin Desktop adapter over the same typed operation
used by the Plugin UI, with host-bound Project/Canvas/node scope.

## Deliberately deferred

- billing, reviews and automatic updates;
- npm/native/Python execution from third-party packages;
- arbitrary React code in the renderer;
- a generic global viewport/selection toolbar registry; the concrete host-owned
  selection action slot is intentionally narrower;
- plugin-wide access to all Canvas nodes or Chat sessions;
- project-local executable plugins or Skills;
- network access, OAuth, secrets, camera/microphone and filesystem writes;
- a general `@convax/plugin` or `@convax/extensions` package before a second host
  proves that the install/domain contract is reusable outside Desktop composition.
