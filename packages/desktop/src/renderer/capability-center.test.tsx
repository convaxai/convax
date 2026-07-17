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
