import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { WebPluginClient, WebPluginInventory } from "../plugin-contracts"
import type { DesktopSkillClient, DesktopSkillInventory } from "../skill-management-contracts"
import { CapabilityManagementSurface } from "./capability-center"

const emptySkills: DesktopSkillInventory = { catalog: [], skills: [] }
const remoteEditor = {
  activeRevision: 1,
  activeSetDigest: "a".repeat(64),
  capabilities: ["agent.prompt" as const],
  contributes: {
    agent: {
      mcp: {
        oauth: "auto" as const,
        type: "remote" as const,
        url: "https://editor.example/mcp",
      },
    },
    canvas: { renderer: { create: true } },
    skills: [{ name: "remote-editor", path: "skills/remote-editor" }],
  },
  description: "Edit remote media projects.",
  entry: "index.html",
  hostApi: { major: 1 as const, optional: [], required: ["host.context.get"] },
  id: "remote-editor",
  name: "Remote Editor",
  schema: "convax.plugin/8" as const,
  snapshotDigest: "b".repeat(64),
  version: "1.0.0",
}
const pluginInventory: WebPluginInventory = {
  catalog: [{ ...remoteEditor, installed: true }],
  installed: [remoteEditor],
}

function skillClient(listSkills = mock(async () => emptySkills)): DesktopSkillClient {
  return {
    getSkillDetails: mock(async () => {
      throw new Error("Not used by this test")
    }),
    getSkillShowcase: mock(async () => null),
    importSkill: mock(async () => null),
    installCatalogSkill: mock(async () => {
      throw new Error("Not used by this test")
    }),
    listSkills,
    onDidChange: mock(() => () => undefined),
    openSkill: mock(async () => undefined),
    uninstallSkill: mock(async () => false),
  }
}

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })

  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

test("reconciles the real MCP status after Connect before releasing the busy state", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  let connected = false
  const connectAgentMcp = mock(async () => {
    connected = true
  })
  const listAgentMcpStatuses = mock(async () => ({
    "remote-editor": connected ? ("connected" as const) : ("needs_auth" as const),
  }))
  const pluginClient: WebPluginClient = {
    connectAgentMcp,
    importPlugin: mock(async () => null),
    installCatalogPlugin: mock(async () => remoteEditor),
    listAgentMcpStatuses,
    listPlugins: mock(async () => pluginInventory),
    onDidChange: mock(() => () => undefined),
    openCatalogPluginRelease: mock(async () => true),
    uninstallPlugin: mock(async () => false),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CapabilityManagementSurface
          activeProjectId="project-1"
          initialTab="plugins"
          pluginClient={pluginClient}
          skillClient={skillClient()}
        />,
      )
      await settle()
    })

    const connect = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Connect"))
    expect(connect).toBeDefined()
    await act(async () => {
      connect?.click()
      await settle()
    })

    expect(connectAgentMcp).toHaveBeenCalledWith({ id: "remote-editor" })
    expect(listAgentMcpStatuses).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("Use in Agent")
    expect(document.body.textContent).not.toContain("Connect account")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps a successful MCP status when an unrelated inventory read fails", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  const pluginClient: WebPluginClient = {
    connectAgentMcp: mock(async () => undefined),
    importPlugin: mock(async () => null),
    installCatalogPlugin: mock(async () => remoteEditor),
    listAgentMcpStatuses: mock(async () => ({ "remote-editor": "connected" as const })),
    listPlugins: mock(async () => pluginInventory),
    onDidChange: mock(() => () => undefined),
    openCatalogPluginRelease: mock(async () => true),
    uninstallPlugin: mock(async () => false),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CapabilityManagementSurface
          activeProjectId="project-1"
          initialTab="plugins"
          pluginClient={pluginClient}
          skillClient={skillClient(mock(async () => Promise.reject(new Error("Skill inventory unavailable"))))}
        />,
      )
      await settle()
    })

    expect(document.body.textContent).toContain("Skill inventory unavailable")
    expect(document.body.textContent).toContain("Use in Agent")
    expect(document.body.textContent).not.toContain("Connect account")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("routes an installed creatable Plugin directly to the active Canvas without waiting for MCP connection", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  const onUsePluginOnCanvas = mock(() => undefined)
  const pluginClient: WebPluginClient = {
    connectAgentMcp: mock(async () => undefined),
    importPlugin: mock(async () => null),
    installCatalogPlugin: mock(async () => remoteEditor),
    listAgentMcpStatuses: mock(async () => ({ "remote-editor": "needs_auth" as const })),
    listPlugins: mock(async () => pluginInventory),
    onDidChange: mock(() => () => undefined),
    openCatalogPluginRelease: mock(async () => true),
    uninstallPlugin: mock(async () => false),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CapabilityManagementSurface
          activeCanvasId="canvas-1"
          activeProjectId="project-1"
          initialTab="plugins"
          onUsePluginOnCanvas={onUsePluginOnCanvas}
          pluginClient={pluginClient}
          skillClient={skillClient()}
        />,
      )
      await settle()
    })

    const addToCanvas = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add to Canvas",
    )
    expect(addToCanvas).toBeDefined()
    expect(addToCanvas?.disabled).toBeFalse()
    await act(async () => addToCanvas?.click())

    expect(onUsePluginOnCanvas).toHaveBeenCalledWith(remoteEditor)
    expect(document.body.textContent).toContain("Connect")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("opens a requested managed Skill directly in the capability detail surface", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  const inventory: DesktopSkillInventory = {
    catalog: [],
    skills: [
      {
        description: "Review changes",
        displayName: "Review",
        location: "/managed/review/SKILL.md",
        management: { kind: "standalone" },
        managed: true,
        name: "review",
        source: "managed",
      },
    ],
  }
  const getSkillDetails = mock(async () => ({
    description: "Review changes",
    files: [{ content: "# Review", kind: "text" as const, path: "SKILL.md", size: 8 }],
    id: "review",
    name: "Review",
  }))
  const managedSkillClient = skillClient(mock(async () => inventory))
  managedSkillClient.getSkillDetails = getSkillDetails
  const pluginClient: WebPluginClient = {
    connectAgentMcp: mock(async () => undefined),
    importPlugin: mock(async () => null),
    installCatalogPlugin: mock(async () => remoteEditor),
    listAgentMcpStatuses: mock(async () => ({})),
    listPlugins: mock(async () => ({ catalog: [], installed: [] })),
    onDidChange: mock(() => () => undefined),
    openCatalogPluginRelease: mock(async () => true),
    uninstallPlugin: mock(async () => false),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CapabilityManagementSurface
          activeProjectId="project-1"
          initialSkillName="review"
          pluginClient={pluginClient}
          skillClient={managedSkillClient}
        />,
      )
      await settle()
      await settle()
    })

    expect(getSkillDetails).toHaveBeenCalledWith({
      target: { kind: "installed", name: "review", source: "managed" },
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Review")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
