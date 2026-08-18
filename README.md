# Convax

**English** · [简体中文](README-CN.md)

Convax is an open-source visual workspace for human and AI work.

It uses an **everything-is-a-Plugin architecture**, bringing real project files, editable Canvases, a context-aware Agent, and installable creative tools into one desktop workspace.

[Website](https://convax.microvoid.io/) · [GitHub](https://github.com/convaxai/convax) · [Issues](https://github.com/convaxai/convax/issues)

## Developer Preview

Convax is currently in Developer Preview and evolving rapidly. Breaking changes will happen.

![Convax workspace with Project files, an infinite Canvas, and Agent context](docs/images/convax-workspace.jpg)

## One workspace, three connected areas

| Area                | What it is for                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Project sidebar** | Switch Canvases, browse the real file tree, preview assets, and drag material into the workspace.             |
| **Infinite Canvas** | Keep briefs, references, relationships, generated results, and specialist tools in one visible working model. |
| **Agent panel**     | Converse with the exact files, nodes, and Canvas context currently relevant to the task.                      |

The Project and Agent sidebars can be resized or collapsed, and the Files and Canvases sections can be adjusted to fit the current task.

## What you can do with Convax

### Work directly with real project files

- Create a new Project or open an existing local folder.
- Browse, preview, import, rename, move, delete, open, and reveal files without leaving the workspace.
- Drag files and folders onto a Canvas or attach them to Agent context.
- Keep generated media and Canvas-created notes as ordinary, user-visible Project files.

![Project files stay connected and can be moved onto the Canvas](docs/images/convax-projects.jpg)

### Keep the whole process editable on an infinite Canvas

- Use multiple independent Canvases inside one Project.
- Arrange and connect text, images, audio, video, files, folders, and interactive tools.
- Move, resize, group, duplicate, organize, and reveal work without flattening it into a static export.
- Reopen the Project and continue from the same persisted Canvas state.

![Connected briefs, references, directions, and results on a Canvas](docs/images/convax-canvas.jpg)

### Collaborate with an Agent that sees the context you choose

- Attach selected nodes, files, folders, Skills, or a complete Canvas to a conversation.
- Ask the Agent to inspect content, create resources, update relationships, organize nodes, or bring relevant work into view.
- Keep context explicit and scoped to the Project and Canvas material you select.
- Use the built-in coding Agent powered by [OpenCode](https://opencode.ai/).

![Agent working with selected Canvas context](docs/images/convax-agent.jpg)

### Add specialist workflows with Skills and Plugins

- Install Skills that give the Agent reusable workflows.
- Install Plugins that add generation tools, Canvas actions, custom cards, services, and interactive creative surfaces.
- Grant each Plugin only the Project, Canvas, or Agent capabilities it needs.
- Preserve portable Plugin node state when reopening a Project or duplicating a node.

![Skills and Plugins add scoped capabilities to Convax](docs/images/convax-extensions.jpg)

Convax Account connects chat and live image generation, ChatCut provides an editable video workflow, FFmpeg Tools runs reviewed media transforms, and 3D Director Desk provides interactive scene blocking for characters, props, panoramas, and cameras.

## Common workflows

- **Creative direction:** connect briefs, references, shot ideas, and generated assets without losing the reasoning between them.
- **Image workflows:** keep source material, generation, comparison, and review on the same Canvas.
- **Video production:** organize media, transforms, timelines, and specialist tools around one Project.
- **Research and planning:** turn files, notes, web material, and Agent output into a structure you can revisit and continue editing.

## Run Convax from source

Install [Bun](https://bun.sh/) and run:

```bash
bun install
bun dev
```

Useful development commands:

```bash
bun check             # Run the repository validation suite
bun run build         # Compile the workspace
bun run package       # Build native distribution media for this platform
bun run smoke:packaged
```

Local and pull-request packages are intentionally unsigned. `CONVAX_CHANNEL`
selects the side-by-side `dev`, `beta`, or `prod` identity. A public release is
built on each target platform with signing credentials, an exact SemVer, and a
public generic HTTPS update feed:

```bash
CONVAX_CHANNEL=prod \
CONVAX_RELEASE=true \
CONVAX_RELEASE_VERSION=1.0.0 \
CONVAX_UPDATE_BASE_URL=https://updates.example.com/desktop/prod \
bun run package
```

The release gate requires code signing where the platform supports it and enables
macOS notarization. It is not required for source development or packaged smoke.
Release credentials live only in GitHub; see [Desktop Releases and Client
Updates](docs/desktop-builds.md).

## Architecture

Convax is a Bun monorepo. Headless packages own Project, Canvas, collaboration, Agent-runtime, Plugin, Marketplace, and UI contracts; the Electron desktop package composes those capabilities with native adapters, while the API, Web, deployment, and documentation apps remain separate delivery surfaces. See [Architecture](docs/architecture.md) for the full ownership and dependency contract.

Related references:

- [Plugin and Skill platform](docs/plugin-skill-platform.md)
- [Plugin-to-Host change governance](docs/plugin-host-change-governance.md)
- [DeepSeek Harness migration assessment](docs/deepseek-harness-migration-assessment.md)
- [Canvas selection and actions](docs/canvas-selection-context.md)
