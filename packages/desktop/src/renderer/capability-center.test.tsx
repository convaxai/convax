import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { WebPluginClient, WebPluginInventory } from "../plugin-contracts"
import type { DesktopSkillClient, DesktopSkillDetails, DesktopSkillInventory } from "../skill-management-contracts"
import { appMessage } from "./app-language"
import {
  CapabilityCenter,
  CapabilityCenterDialog,
  CapabilityManagementSurface,
  type CapabilityCenterDialogProps,
} from "./capability-center"

const noop = () => undefined

const skillDetails: DesktopSkillDetails = {
  description: "Plan a visual sequence with Canvas tools.",
  files: [{ content: "# Canvas Storyboard", kind: "text", path: "SKILL.md", size: 19 }],
  id: "storyboard",
  name: "Canvas Storyboard",
  version: "0.1.0",
}

const baseDialogProps = {
  busy: null,
  error: null,
  loading: false,
  onClose: noop,
  onImportPlugin: noop,
  onImportSkill: noop,
  onInstallPlugin: noop,
  onInstallPluginSkill: noop,
  onInstallSkill: noop,
  onLoadSkillDetails: mock(async () => skillDetails),
  onLoadSkillShowcase: mock(async () => null),
  onTabChange: noop,
  onUninstallPlugin: noop,
  onUninstallSkill: noop,
  plugins: { catalog: [], installed: [] },
  skills: { catalog: [], skills: [] },
  tab: "skills",
} satisfies CapabilityCenterDialogProps

const skillInventory: DesktopSkillInventory = {
  catalog: [
    {
      description: "Plan a visual sequence with Canvas tools.",
      id: "storyboard",
      installed: true,
      name: "Canvas Storyboard",
    },
  ],
  skills: [
    {
      description: "Installed by Convax",
      displayName: "Canvas Storyboard",
      location: "/managed/storyboard/SKILL.md",
      managed: true,
      name: "storyboard",
      source: "managed",
    },
    {
      description: "Discovered from OpenCode",
      location: "/global/review/SKILL.md",
      managed: false,
      name: "review",
      source: "global",
    },
  ],
}

const pluginInventory: WebPluginInventory = {
  catalog: [
    {
      capabilities: ["canvas.node.read", "agent.prompt"],
      contributes: { canvas: { renderer: { create: true } } },
      description: "Compose shots in a sandboxed director surface.",
      entry: "index.html",
      id: "director-stage",
      installed: true,
      name: "3D Director Stage",
      schema: "convax.plugin/1",
      skill: "SKILL.md",
      version: "1.0.0",
    },
  ],
  installed: [
    {
      capabilities: [],
      contributes: { canvas: { renderer: { nodeKinds: ["timeline"] } } },
      description: "An imported timeline renderer.",
      entry: "timeline.html",
      id: "timeline-viewer",
      name: "Timeline Viewer",
      schema: "convax.plugin/1",
      version: "0.2.0",
    },
  ],
}

const skillClient: DesktopSkillClient = {
  getSkillDetails: mock(async () => skillDetails),
  getSkillShowcase: mock(async () => null),
  importSkill: mock(async () => null),
  installCatalogSkill: mock(async () => skillInventory.skills[0]!),
  installPluginSkill: mock(async () => skillInventory.skills[0]!),
  listSkills: mock(async () => skillInventory),
  onDidChange: mock(() => noop),
  openSkill: mock(async () => undefined),
  uninstallSkill: mock(async () => true),
}

const pluginClient: WebPluginClient = {
  importPlugin: mock(async () => null),
  installCatalogPlugin: mock(async () => pluginInventory.installed[0]!),
  listPlugins: mock(async () => pluginInventory),
  onDidChange: mock(() => noop),
  uninstallPlugin: mock(async () => true),
}

describe("CapabilityCenter", () => {
  test("renders a compact entry without opening the management surface", () => {
    const markup = renderToStaticMarkup(<CapabilityCenter pluginClient={pluginClient} skillClient={skillClient} />)

    expect(markup).toContain("Skill &amp; Plugin")
    expect(markup).not.toContain('role="dialog"')
  })

  test("embeds the same management surface without an entry button or modal", () => {
    const markup = renderToStaticMarkup(
      <CapabilityManagementSurface pluginClient={pluginClient} skillClient={skillClient} />,
    )

    expect(markup).toContain(`aria-label="${appMessage("en", "capabilities.title").replace("&", "&amp;")}"`)
    expect(markup).toContain('role="tablist"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain("Close capability center")
  })

  test("distinguishes managed Skills from global read-only Skills", () => {
    const markup = renderToStaticMarkup(<CapabilityCenterDialog {...baseDialogProps} skills={skillInventory} />)

    expect(markup).toContain("Canvas Storyboard")
    expect(markup).toContain("View details")
    expect(markup).toContain("Global · read only")
    expect(markup).toContain("Discovered from OpenCode")
    expect(markup).toContain("Uninstall")
    expect(markup.match(/aspect-video/g)).toHaveLength(3)
    expect(markup).not.toContain("/global/review")
  })

  test("gives a discovered global Skill the same preview interaction without mutation actions", () => {
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} skills={{ catalog: [], skills: [skillInventory.skills[1]!] }} />,
    )

    expect(markup).toContain("review")
    expect(markup).toContain("Discovered from OpenCode")
    expect(markup).toContain("Global · read only")
    expect(markup).toContain("View details")
    expect(markup).toContain("aspect-video")
    expect(markup).not.toContain("Install Skill")
    expect(markup).not.toContain("Uninstall")
  })

  test("keeps a Plugin companion Skill as an explicit separate install", () => {
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} plugins={pluginInventory} tab="plugins" />,
    )

    expect(markup).toContain("3D Director Stage")
    expect(markup).toContain("Timeline Viewer")
    expect(markup).toContain("Install companion Skill")
    expect(markup).toContain("Plugin installed")
    expect(markup).toContain("Global · this device")
    expect(markup).toContain(
      "Ready on Canvas · Return to Canvas, then right-click or press Tab to add 3D Director Stage.",
    )
    expect(markup).toContain(appMessage("en", "capabilities.pluginsDescription"))
  })

  test("makes an explicit Plugin import the executable consent point", () => {
    const english = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} plugins={pluginInventory} tab="plugins" />,
    )
    const chinese = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} locale="zh-CN" plugins={pluginInventory} tab="plugins" />,
    )

    expect(english).toContain("choosing Install or Import authorizes the exact declared, fingerprinted local executable")
    expect(english).toContain("Import Plugin")
    expect(chinese).toContain("选择“安装”或“导入”即授权其声明并经指纹校验的本地可执行文件")
    expect(chinese).toContain("导入插件")
    expect(`${english}${chinese}`).not.toContain("Run Tool")
  })

  test("shows an installed companion Skill without offering a duplicate install", () => {
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog
        {...baseDialogProps}
        plugins={{
          catalog: [
            {
              ...pluginInventory.catalog[0]!,
              id: "jianying-editor",
              skill: "skills/jianying-editor/SKILL.md",
            },
          ],
          installed: [],
        }}
        skills={{
          catalog: [],
          skills: [
            {
              location: "/managed/jianying-editor/SKILL.md",
              managed: true,
              name: "jianying-editor",
              source: "managed",
            },
          ],
        }}
        tab="plugins"
      />,
    )

    expect(markup).toContain("Installed")
    expect(markup).not.toContain("Install companion Skill")
  })

  test("names install actions by capability type instead of using an ambiguous generic action", () => {
    const pluginMarkup = renderToStaticMarkup(
      <CapabilityCenterDialog
        {...baseDialogProps}
        plugins={{
          catalog: [{ ...pluginInventory.catalog[0]!, installed: false }],
          installed: [],
        }}
        tab="plugins"
      />,
    )
    const skillMarkup = renderToStaticMarkup(
      <CapabilityCenterDialog
        {...baseDialogProps}
        skills={{
          catalog: [{ ...skillInventory.catalog[0]!, installed: false }],
          skills: [],
        }}
      />,
    )

    expect(pluginMarkup).toContain("Install Plugin")
    expect(pluginMarkup).not.toContain("Ready on Canvas")
    expect(skillMarkup).toContain("Install Skill")
  })

  test("discloses install-time local execution consent for a headless Tool Plugin in both locales", () => {
    const toolPlugin = {
      capabilities: [],
      contributes: {
        generation: {
          tools: [
            {
              acceptedInputs: ["reference_image" as const],
              description: "Generate an image.",
              id: "image.generate",
              output: "image" as const,
              title: "Image Generator",
            },
          ],
        },
      },
      description: "A headless image generation tool.",
      id: "image-generator",
      installed: false,
      name: "Image Generator",
      runtime: { command: "example-image-tool", type: "mcp-stdio" as const },
      schema: "convax.plugin/2" as const,
      version: "1.0.0",
    }
    const plugins = { catalog: [toolPlugin], installed: [] }
    const englishMarkup = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} plugins={plugins} tab="plugins" />,
    )
    const chineseMarkup = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} locale="zh-CN" plugins={plugins} tab="plugins" />,
    )

    expect(englishMarkup).toContain(
      appMessage("en", "capabilities.installToolConsent", { command: "example-image-tool" }),
    )
    expect(chineseMarkup).toContain(
      appMessage("zh-CN", "capabilities.installToolConsent", { command: "example-image-tool" }),
    )
  })

  test("does not show local execution consent for an ordinary static Plugin", () => {
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog
        {...baseDialogProps}
        plugins={{
          catalog: [{ ...pluginInventory.catalog[0]!, installed: false }],
          installed: [],
        }}
        tab="plugins"
      />,
    )

    expect(markup).not.toContain("Installing authorizes the local tool")
  })

  test("discloses that an explicit Tool Plugin update authorizes the updated executable", () => {
    const toolPlugin = {
      capabilities: [],
      contributes: {
        generation: {
          tools: [{
            acceptedInputs: [],
            description: "Generate an image.",
            id: "image.generate",
            output: "image" as const,
            title: "Image Generator",
          }],
        },
      },
      description: "A headless image generation tool.",
      id: "image-generator",
      installed: true,
      installedVersion: "1.0.0",
      name: "Image Generator",
      runtime: { command: "example-image-tool", type: "mcp-stdio" as const },
      schema: "convax.plugin/2" as const,
      updateAvailable: true,
      version: "1.1.0",
    }
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog
        {...baseDialogProps}
        plugins={{ catalog: [toolPlugin], installed: [toolPlugin] }}
        tab="plugins"
      />,
    )

    expect(markup).toContain(
      appMessage("en", "capabilities.installToolConsent", { command: "example-image-tool" }),
    )
  })

  test("shows an explicit catalog update without pretending the target version is installed", () => {
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog
        {...baseDialogProps}
        plugins={{
          catalog: [
            {
              ...pluginInventory.catalog[0]!,
              installedVersion: "0.9.0",
              updateAvailable: true,
            },
          ],
          installed: [],
        }}
        tab="plugins"
      />,
    )

    expect(markup).toContain("Installed v0.9.0")
    expect(markup).toContain("Update available")
    expect(markup).toContain("Update Plugin")
    expect(markup).toContain("v1.0.0")
  })

  test("localizes host copy without changing Plugin-owned metadata", () => {
    const markup = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} locale="zh-CN" plugins={pluginInventory} tab="plugins" />,
    )

    expect(markup).toContain(appMessage("zh-CN", "capabilities.pluginsDescription"))
    expect(markup).toContain(appMessage("zh-CN", "capabilities.installCompanionSkill"))
    expect(markup).toContain(appMessage("zh-CN", "capabilities.pluginInstalled"))
    expect(markup).toContain(appMessage("zh-CN", "capabilities.globalThisDevice"))
    expect(markup).toContain(appMessage("zh-CN", "capabilities.pluginReady", { name: "3D Director Stage" }))
    expect(markup).toContain("3D Director Stage")
    expect(markup).toContain("Compose shots in a sandboxed director surface.")
  })

  test("renders loading and error states without inventing catalog content", () => {
    const loading = renderToStaticMarkup(
      <CapabilityCenterDialog {...baseDialogProps} loading plugins={null} skills={null} />,
    )
    const failed = renderToStaticMarkup(<CapabilityCenterDialog {...baseDialogProps} error="Skill discovery failed" />)

    expect(loading).toContain("Loading capabilities")
    expect(failed).toContain("Skill discovery failed")
    expect(failed).toContain("The Skill marketplace is empty")
  })
})
