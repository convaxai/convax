# Plugin and Skill Platform

Status: implementation contract for the first vertical slice.

This design deliberately uses two existing product concepts instead of combining
them into a generic extension framework:

- an **OpenCode Skill** is a trusted instruction bundle discovered and executed by
  OpenCode;
- a **Convax Plugin** is an installed product surface composed by Desktop from
  existing Canvas, Project and Agent capabilities.

OpenCode plugins are Agent-runtime hooks and are not Convax Plugins.

## Ownership

| Concern | Owner |
| --- | --- |
| Skill discovery and execution | `@convax/agent-runtime` through OpenCode |
| Managed Skill validation/copy/removal | `@convax/agent-runtime/node` |
| Canvas renderer and node-toolbar registration | existing `@convax/canvas` registries |
| Plugin package discovery, static assets and native import dialogs | Desktop main |
| Plugin iframe rendering and scoped host calls | Desktop renderer composition |
| Global settings, language and capability management UI | Desktop renderer preferences/views |
| Active Project and Canvas | existing Project and Workbench controllers |
| Project/Canvas/Agent invariants | their existing typed services and clients |

There is no new Workspace aggregate, extension bus, service locator, Canvas node
role, or alternate Agent runtime. A Plugin renderer remains a Canvas `file` node.

## Persistence

```text
packages/desktop/resources/
  skills/<skill-name>/...                   checked-in built-in Skill packages
  plugins/<plugin-id>/...                   checked-in complete static Plugin packages

Packaged Convax application/
  built-in catalog assets                      read-only install sources, never active by shipping alone

Electron userData/
  opencode/
    skills/
      user/<skill-name>/...                 managed Skills, including explicitly installed companions
  plugins/
    <plugin-id>/
      manifest.json
      <static package files>

Project root/
  .convax/canvases/.../document.json        plugin node reference and portable state

Browser storage/
  convax.desktop.app-language.v1            per-user UI language only
```

Built-ins follow the same lifecycle as imported capabilities. Shipping an item in
the application only makes it visible in the catalog. An explicit install copies a
Plugin into `userData/plugins/<plugin-id>/` or a Skill into
`userData/opencode/skills/user/<skill-name>/`; runtime loading never reaches back
through a source-tree path. Built-in catalog code imports complete packages from
Desktop `resources`, never from `src/main` or `node_modules`. A Plugin companion
Skill is a second explicit copy into the managed Skill root and remains
independently removable.

An installed Plugin package is global to the user. A Canvas document stores only a
stable plugin id/version reference and namespaced portable instance state. Removing
a Plugin therefore does not destroy Canvas nodes; they fall back to the unknown-file
renderer and recover after reinstall.

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
  graph is stored in the owning Canvas node through `canvas.node.updateState`; its
  companion Skill reviews the same snapshot through normal Canvas Agent resources.

The 3D surface keeps the strict Plugin CSP and `sandbox="allow-scripts"`. The
non-open upstream mannequin asset is replaced by the procedural MIT implementation.
Local model import and browser downloads stay hidden until they have narrow host
capabilities; the integration does not widen network or iframe permissions merely
to preserve unsupported upstream buttons.

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
and an atomic rename; replacing an installed version is deferred until update policy
exists. The renderer never imports plugin JavaScript into the host bundle.

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

| Method | Required capability | Scope |
| --- | --- | --- |
| `host.context.get` | none | current Project, Canvas and own node |
| `canvas.node.get` | `canvas.node.read` | own node only |
| `canvas.node.updateState` | `canvas.node.write` | own namespaced state only |
| `project.file.readText` | `project.files.read` | current Project relative path |
| `agent.prompt` | `agent.prompt` | current Project with own node resource |

These are adapters over existing clients/controllers. They do not expose private
Project JSON, absolute paths, arbitrary target-node mutation, Electron, or a generic
function-call escape hatch.

## Agent relationship

Every file renderer already receives the Canvas file-assistant accessory. Attaching
a plugin node gives the Agent a validated read-only snapshot of that node and its
edges. Mutations still use typed Canvas tools.

A companion Skill may be installed explicitly into the same managed user Skill
store. It remains installed independently if the Plugin is removed, because Convax
does not yet persist a second ownership graph. It may explain the plugin workflow
and select existing business, primitive and view tools. It must not duplicate Canvas
or Project invariants. A
future plugin command exposed as an Agent tool must be a thin Desktop adapter over
the same typed operation used by the Plugin UI, with host-bound Project/Canvas/node
scope.

## Deliberately deferred

- cloud publishing, billing, reviews and automatic updates;
- npm/native/Python execution from third-party packages;
- arbitrary React code in the renderer;
- global viewport/selection toolbar registries without a concrete plugin need;
- plugin-wide access to all Canvas nodes or Chat sessions;
- project-local executable plugins or Skills;
- network access, OAuth, secrets, camera/microphone and filesystem writes;
- a general `@convax/plugin` or `@convax/extensions` package before a second host
  proves that the install/domain contract is reusable outside Desktop composition.
