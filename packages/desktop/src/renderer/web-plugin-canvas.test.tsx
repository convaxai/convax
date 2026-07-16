import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, type CanvasNode } from "@convax/canvas"
import type { InstalledWebPluginSummary, WebPluginCapability } from "../plugin-contracts"
import { desktopPluginHostProtocol } from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import {
  createWebPluginCanvasContribution,
  dispatchWebPluginHostRequest,
  matchesWebPluginCanvasNode,
  updateWebPluginNodeState,
  webPluginCanvasRendererId,
  webPluginEntryUrl,
  webPluginIdentityMetadataKey,
  webPluginIframePermissions,
  webPluginIframeSandbox,
  webPluginStateMetadataKey,
  type WebPluginCanvasActiveContext,
  type WebPluginHostRequestContext,
} from "./web-plugin-canvas"

function plugin(capabilities: WebPluginCapability[] = []): InstalledWebPluginSummary {
  return {
    capabilities,
    contributes: {
      canvas: {
        renderer: {
          create: true,
          extensions: [".stage.json"],
          height: 460,
          mimeTypes: ["application/x-convax-stage"],
          nodeKinds: ["director-scene"],
          width: 720,
        },
        toolbar: [{ command: "scene.focus", id: "focus", title: "Focus scene" }],
      },
    },
    description: "A sandbox test plugin",
    entry: "surfaces/Director Stage.html",
    id: "director-stage",
    name: "Director Stage",
    schema: "convax.plugin/1",
    version: "1.2.3",
  }
}

function canvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    data: {
      kind: webPluginCanvasRendererId("director-stage"),
      label: "Scene",
      metadata: {
        existing: "kept",
        [webPluginIdentityMetadataKey]: {
          entry: "surfaces/Director Stage.html",
          id: "director-stage",
          version: "1.2.3",
        },
        [webPluginStateMetadataKey]: { scene: "old" },
      },
    },
    id: "node-1",
    position: { x: 10, y: 20 },
    selected: true,
    type: "file",
    ...overrides,
  }
}

function request(method: string, params?: unknown) {
  return {
    id: "request-1",
    method,
    ...(params === undefined ? {} : { params }),
    protocol: desktopPluginHostProtocol,
    type: "request",
  }
}

function hostContext(
  installedPlugin: InstalledWebPluginSummary,
  overrides: Partial<WebPluginHostRequestContext> = {},
) {
  const active: WebPluginCanvasActiveContext = {
    canvasId: "canvas-1",
    canvasName: "Storyboard",
    projectId: "project-1",
    projectName: "Film",
  }
  const controller = new AbortController()
  return {
    frame: {
      canvasId: active.canvasId,
      nodeId: "node-1",
      pluginId: installedPlugin.id,
      projectId: active.projectId,
    },
    getActiveContext: () => active,
    getNode: () => canvasNode(),
    plugin: installedPlugin,
    promptAgent: mock(async () => ({ text: "Use a wide shot." })),
    readProjectText: mock(async (input) => ({ content: "hello", exists: true, path: input.path })),
    signal: controller.signal,
    updateNodeState: mock(() => undefined),
    ...overrides,
  } satisfies WebPluginHostRequestContext
}

describe("Canvas Web Plugin contribution", () => {
  test("stays a file renderer and creates only a portable plugin node reference", () => {
    const installedPlugin = plugin()
    const contribution = createWebPluginCanvasContribution(installedPlugin, {
      frameRegistry: new DesktopPluginFrameRegistry(),
      host: {
        getActiveContext: () => null,
        promptAgent: async () => ({ text: "" }),
        readProjectText: async (input) => ({ content: "", exists: false, path: input.path }),
      },
    })
    const renderer = contribution.renderers[0]!
    const created = renderer.create?.({ position: { x: 4, y: 8 } })

    expect(contribution.id).toBe("desktop.director-stage")
    expect(renderer.id).toBe("plugin.director-stage")
    expect(created).toMatchObject({
      data: {
        kind: "plugin.director-stage",
        label: "Director Stage",
        metadata: {
          convaxPlugin: {
            entry: "surfaces/Director Stage.html",
            id: "director-stage",
            version: "1.2.3",
          },
          convaxPluginState: {},
        },
      },
      position: { x: 4, y: 8 },
      style: { height: 460, width: 720 },
      type: "file",
    })
    expect(renderer.toolbar).toBeDefined()
    expect(webPluginIframeSandbox).toBe("allow-scripts")
    expect(webPluginIframePermissions).toContain("camera 'none'")
    expect(webPluginIframePermissions).toContain("microphone 'none'")
  })

  test("matches its identity, extension, MIME type, or declared file-node kind", () => {
    const installedPlugin = plugin()
    expect(matchesWebPluginCanvasNode(installedPlugin, canvasNode().data)).toBe(true)
    expect(matchesWebPluginCanvasNode(installedPlugin, {
      kind: "text",
      label: "Opening.stage.json",
    })).toBe(true)
    expect(matchesWebPluginCanvasNode(installedPlugin, {
      kind: "file",
      label: "Opening",
      mimeType: "application/x-convax-stage",
    })).toBe(true)
    expect(matchesWebPluginCanvasNode(installedPlugin, {
      kind: "director-scene",
      label: "Opening",
    })).toBe(true)
    expect(matchesWebPluginCanvasNode(installedPlugin, {
      kind: "text",
      label: "notes.md",
    })).toBe(false)
  })

  test("encodes portable entry segments and never turns backslashes into host paths", () => {
    expect(webPluginEntryUrl(plugin())).toBe("convax-plugin://director-stage/surfaces/Director%20Stage.html")
    expect(() => webPluginEntryUrl({ entry: "surfaces\\index.html", id: "director-stage" })).toThrow("portable")
  })
})

describe("Canvas Web Plugin host requests", () => {
  test("returns only active own-node context and applies capability checks", async () => {
    const context = hostContext(plugin())
    const contextResponse = await dispatchWebPluginHostRequest(request("host.context.get"), context)
    expect(contextResponse).toMatchObject({
      ok: true,
      result: {
        canvas: { id: "canvas-1", name: "Storyboard" },
        node: { id: "node-1", type: "file" },
        plugin: { id: "director-stage", version: "1.2.3" },
        project: { id: "project-1", name: "Film" },
      },
    })
    if (contextResponse?.ok) {
      expect((contextResponse.result as { node: Record<string, unknown> }).node).not.toHaveProperty("selected")
    }

    const denied = await dispatchWebPluginHostRequest(request("canvas.node.get"), context)
    expect(denied).toMatchObject({ ok: false, error: "Plugin capability is not granted: canvas.node.read" })
  })

  test("writes only validated namespaced state and cannot target another node", async () => {
    const updateNodeState = mock(() => undefined)
    const installedPlugin = plugin(["canvas.node.write"])
    const context = hostContext(installedPlugin, { updateNodeState })
    const response = await dispatchWebPluginHostRequest(
      request("canvas.node.updateState", { state: { camera: { fov: 35 }, selected: ["hero"] } }),
      context,
    )
    expect(response).toMatchObject({ ok: true, result: { updated: true } })
    expect(updateNodeState).toHaveBeenCalledWith({ camera: { fov: 35 }, selected: ["hero"] })

    const targeted = await dispatchWebPluginHostRequest(
      request("canvas.node.updateState", { nodeId: "node-2", state: {} }),
      context,
    )
    expect(targeted).toMatchObject({ ok: false, error: expect.stringContaining("unsupported field") })
    expect(updateNodeState).toHaveBeenCalledTimes(1)
  })

  test("the Canvas update preserves node data, geometry, edges, and unrelated metadata", () => {
    const installedPlugin = plugin(["canvas.node.write"])
    const node = canvasNode()
    const document = createCanvasDocument({
      edges: [{ id: "edge-1", source: "node-1", target: "node-2", type: "canvas" }],
      id: "canvas-1",
      nodes: [node, canvasNode({ id: "node-2" })],
    })
    const next = updateWebPluginNodeState(document, {
      canvasId: "canvas-1",
      nodeId: "node-1",
      plugin: installedPlugin,
    }, { scene: "new" })
    const updated = next.nodes[0]!

    expect(updated.position).toEqual(node.position)
    expect(updated.data.kind).toBe(node.data.kind)
    expect(updated.data.label).toBe(node.data.label)
    expect(updated.data.metadata).toMatchObject({
      existing: "kept",
      convaxPlugin: { id: "director-stage", version: "1.2.3" },
      convaxPluginState: { scene: "new" },
    })
    expect(next.edges).toBe(document.edges)
    expect(next.nodes[1]).toBe(document.nodes[1])
  })

  test("rejects private, traversing, native, and backslash Project paths before the port", async () => {
    const readProjectText = mock(async (input: { path: string }) => ({ content: "", exists: false, path: input.path }))
    const context = hostContext(plugin(["project.files.read"]), { readProjectText })
    for (const path of [
      ".convax/project.json",
      "docs/../secret.txt",
      "C:/secret.txt",
      "docs\\secret.txt",
      "exports/file:stream",
      "CON/readme.md",
      "docs/trailing. ",
    ]) {
      const response = await dispatchWebPluginHostRequest(request("project.file.readText", { path }), context)
      expect(response).toMatchObject({ ok: false })
    }
    expect(readProjectText).not.toHaveBeenCalled()
  })

  test("binds Agent prompts to the exact Project, Canvas, plugin, and own node", async () => {
    const promptAgent = mock(async () => ({ text: "Use a wide shot." }))
    const context = hostContext(plugin(["agent.prompt"]), { promptAgent })
    const response = await dispatchWebPluginHostRequest(
      request("agent.prompt", { text: "Suggest a shot" }),
      context,
    )
    expect(response).toMatchObject({ ok: true, result: { text: "Use a wide shot." } })
    expect(promptAgent).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: "canvas-1",
      nodeId: "node-1",
      pluginId: "director-stage",
      pluginName: "Director Stage",
      projectId: "project-1",
      text: "Suggest a shot",
    }))
  })

  test("rejects an async result when the active Canvas becomes stale", async () => {
    let active: WebPluginCanvasActiveContext = { canvasId: "canvas-1", projectId: "project-1" }
    let resolvePrompt!: (value: { text: string }) => void
    const promptAgent = () => new Promise<{ text: string }>((resolve) => { resolvePrompt = resolve })
    const context = hostContext(plugin(["agent.prompt"]), {
      getActiveContext: () => active,
      promptAgent,
    })
    const responsePromise = dispatchWebPluginHostRequest(
      request("agent.prompt", { text: "Suggest a shot" }),
      context,
    )
    active = { canvasId: "canvas-2", projectId: "project-1" }
    resolvePrompt({ text: "Stale answer" })
    expect(await responsePromise).toMatchObject({
      ok: false,
      error: expect.stringContaining("no longer in the active Project and Canvas"),
    })
  })

  test("rejects malformed and oversized messages without widening the protocol", async () => {
    const context = hostContext(plugin(), { limits: { requestBytes: 180 } })
    expect(await dispatchWebPluginHostRequest({ ...request("host.unknown"), id: "bad" }, context)).toMatchObject({
      id: "bad",
      ok: false,
      error: "Invalid plugin host request",
    })
    expect(await dispatchWebPluginHostRequest({ ...request("host.context.get"), unexpected: true }, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining("unsupported field"),
    })
    expect(await dispatchWebPluginHostRequest({ ...request("host.context.get"), extra: "x".repeat(300) }, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining("exceeds"),
    })
    expect(await dispatchWebPluginHostRequest({ type: "request" }, context)).toBeNull()
  })
})
