# Convax

**English** · [简体中文](README-CN.md)

Convax is a desktop visual workspace for turning project files, ideas, and AI-assisted work into connected, editable canvases. It brings local files, multiple canvases, an Agent, and installable creative tools into one focused workspace.

## Highlights

### Work with real projects

- Create a clean Project or open an existing local folder.
- Browse files and folders in a hierarchical tree, with hover previews for supported files.
- Create, import, rename, move, and delete Project files in Convax, or open and reveal them with your system tools.
- Move files and folders within the Project tree, or drag them from the tree onto the Canvas and into Agent context.

### Organize work across multiple canvases

- Keep multiple independent Canvases inside each Project.
- Switch Projects together with their files and Canvas collection.
- Arrange text, images, audio, video, files, folders, and Agent nodes on an infinite Canvas.
- Connect, move, resize, duplicate, and remove nodes, then pan, zoom, reveal, or fit the view as needed.
- Reopen a Project and continue from its persisted Canvas documents.

### Collaborate with a project-aware Agent

- Attach Project files, folders, Canvases, and Skills directly to a conversation.
- Ask the Agent to inspect Canvas content, add resources, update relationships, or bring relevant nodes into view.
- Use the same Canvas operations from the Agent and the visual interface, so automated work follows product behavior.

The built-in coding Agent is powered by OpenCode.

### Extend Convax with Skills and Plugins

- Discover and manage reusable Agent Skills from the global capability center.
- Add Plugins that contribute custom Canvas cards, toolbar actions, and interactive creative surfaces.
- Let authorized Plugins work with the active Project, Canvas, or Agent through scoped capabilities.
- Keep portable Plugin node state with the Canvas, including when a node is duplicated or a Project is reopened.

The built-in example is:

- **3D Director Desk** for arranging characters, props, and cameras in an interactive 3D scene whose state stays with the Canvas node.

### Shape the workspace around your task

- Resize or collapse the Project and Agent sidebars while keeping part of the Canvas visible.
- Adjust the Files and Canvases sections in the Project sidebar.
- Manage language, Skills, and Plugins from global Settings.

## Run from source

Convax uses Bun for workspace scripts.

```bash
bun install
bun dev
```

Run the full validation suite with:

```bash
bun check
```

Compile the workspace, build native distribution media for the current platform,
or run automation against the final packaged executable instead of the Electron SDK:

```bash
bun run build
bun run package
bun run smoke:packaged
```

`build` compiles code only. `package` writes the current platform's DMG/ZIP,
NSIS, or Linux distribution media below `packages/desktop/dist/`.
During packaging, Convax downloads the current `ffmpeg-tools` Plugin ZIP and the
exact host companion from the fixed official Registry, verifies their declared
size, SHA-256, target, and safe ZIP contents, and embeds them as a remote-provenance
first-install seed. A missing target or failed verification fails the package build.
`smoke:packaged` produces only the unpacked application to keep CI fast, then
temporarily enables a loopback-only DevTools Protocol endpoint for assertions;
that endpoint is not embedded in or enabled by the artifact. It uses a fresh
profile and verifies that FFmpeg installs from the embedded seed while Registry
network access is unavailable. On macOS, smoke uses Electron's test Keychain and
never reads or mutates the developer's login Keychain. The smoke prints the retained
application and executable paths when it finishes.

Local and pull-request packages are intentionally unsigned. `CONVAX_CHANNEL`
selects the side-by-side `dev`, `beta`, or `prod` identity. A public release is
built on each target platform with signing credentials and the release gate enabled:

```bash
CONVAX_CHANNEL=prod CONVAX_RELEASE=true bun run package
```

The release gate requires code signing where the platform supports it and enables
macOS notarization. It is not required for source development or packaged smoke.

### Build-time feature switches

The Services and Skill & Plugin settings are included by default. Product builds can hide either setting in both
global Settings and the lower-left application menu by setting these compile-time environment variables to `false`
or `0`:

- `CONVAX_FEATURE_SERVICES`
- `CONVAX_FEATURE_SKILLS_AND_PLUGINS`

For example, to hide both settings in a Desktop build:

```bash
CONVAX_FEATURE_SERVICES=0 CONVAX_FEATURE_SKILLS_AND_PLUGINS=0 bun --cwd packages/desktop build
```

Only `true`, `false`, `1`, and `0` are accepted so a misspelled value fails the build.

## Documentation

Preview the documentation site locally:

```bash
bun run dev:docs
```

- [Architecture](docs/architecture.md)
- [Plugin and Skill platform](docs/plugin-skill-platform.md)
- [FFmpeg Tool Plugin](docs/ffmpeg-tool-plugin.md)
- [Canvas selection and actions](docs/canvas-selection-context.md)
