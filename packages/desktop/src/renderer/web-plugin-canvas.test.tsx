import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, type CanvasNode } from "@convax/canvas"
import { renderToStaticMarkup } from "react-dom/server"
import type { InstalledWebPluginSummary, WebPluginCapability } from "../plugin-contracts"
import { desktopPluginHostProtocol } from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import {
  createWebPluginCanvasContribution,
  dispatchWebPluginHostRequest,
  getIncomingConnectedImageNodes,
  matchesWebPluginCanvasNode,
  scheduleWebPluginFrameConnect,
  updateWebPluginNodeState,
  webPluginIframeAllow,
  WebPluginDragShield,
  WebPluginPointerReleaseGate,
  webPluginCanvasRendererId,
  webPluginEntryUrl,
  webPluginFrameKey,
  webPluginIdentityMetadataKey,
  webPluginIframePermissions,
  webPluginIframeInteractionProps,
  webPluginIframeSandbox,
  webPluginStateMetadataKey,
  type WebPluginCanvasActiveContext,
  type WebPluginFrameConnectClock,
  type WebPluginHostRequestContext,
  type WebPluginProjectFileResult,
} from "./web-plugin-canvas"

function frameConnectClock() {
  let sequence = 0
  const frames: Array<{ callback(): void; canceled: boolean; id: number }> = []
  const delays: Array<{ callback(): void; canceled: boolean; delay: number; id: number }> = []
  const clock: WebPluginFrameConnectClock = {
    cancelFrame(id) {
      const frame = frames.find((candidate) => candidate.id === id)
      if (frame) frame.canceled = true
    },
    clearDelay(id) {
      const delay = delays.find((candidate) => candidate.id === id)
      if (delay) delay.canceled = true
    },
    requestFrame(callback) {
      const frame = { callback, canceled: false, id: ++sequence }
      frames.push(frame)
      return frame.id
    },
    setDelay(callback, delay) {
      const scheduled = { callback, canceled: false, delay, id: ++sequence }
      delays.push(scheduled)
      return scheduled.id
    },
  }
  return { clock, delays, frames }
}

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

function connectedImageNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    data: {
      height: 1024,
      kind: "image",
      label: "Panorama",
      metadata: {
        convaxProjectFile: { path: ".convax/assets/panorama.jpg" },
      },
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      url: "convax-asset://project-1/file?path=panorama.jpg",
      width: 2048,
    },
    id: "image-1",
    position: { x: -100, y: 20 },
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

function hostContext(installedPlugin: InstalledWebPluginSummary, overrides: Partial<WebPluginHostRequestContext> = {}) {
  const active: WebPluginCanvasActiveContext = {
    canvasId: "canvas-1",
    canvasName: "Storyboard",
    projectId: "project-1",
    projectName: "Film",
  }
  const controller = new AbortController()
  return {
    connectedImageReadGate: { active: false },
    frame: {
      canvasId: active.canvasId,
      nodeId: "node-1",
      pluginId: installedPlugin.id,
      projectId: active.projectId,
    },
    getActiveContext: () => active,
    getConnectedImageNodes: () => [],
    getNode: () => canvasNode(),
    plugin: installedPlugin,
    promptAgent: mock(async () => ({ text: "Use a wide shot." })),
    readManagedProjectImage: mock(async (input) => ({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      path: input.path,
      size: 1,
    })),
    readProjectText: mock(async (input) => ({ content: "hello", exists: true, path: input.path })),
    signal: controller.signal,
    updateNodeState: mock(() => undefined),
    ...overrides,
  } satisfies WebPluginHostRequestContext
}

describe("Canvas Web Plugin contribution", () => {
  test("connects after a frame and task barrier, with one fallback and cancellation", () => {
    const normal = frameConnectClock()
    const onNormalConnect = mock(() => undefined)
    scheduleWebPluginFrameConnect(onNormalConnect, normal.clock)
    expect(onNormalConnect).not.toHaveBeenCalled()
    normal.frames[0]!.callback()
    expect(onNormalConnect).not.toHaveBeenCalled()
    normal.delays.find((delay) => delay.delay === 0)!.callback()
    expect(onNormalConnect).toHaveBeenCalledTimes(1)
    normal.delays.find((delay) => delay.delay > 0)!.callback()
    expect(onNormalConnect).toHaveBeenCalledTimes(1)

    const fallback = frameConnectClock()
    const onFallbackConnect = mock(() => undefined)
    scheduleWebPluginFrameConnect(onFallbackConnect, fallback.clock)
    fallback.delays[0]!.callback()
    fallback.frames[0]!.callback()
    expect(onFallbackConnect).toHaveBeenCalledTimes(1)

    const canceled = frameConnectClock()
    const onCanceledConnect = mock(() => undefined)
    const cancel = scheduleWebPluginFrameConnect(onCanceledConnect, canceled.clock)
    cancel()
    canceled.frames[0]!.callback()
    canceled.delays[0]!.callback()
    expect(onCanceledConnect).not.toHaveBeenCalled()
    expect(canceled.frames[0]!.canceled).toBe(true)
    expect(canceled.delays[0]!.canceled).toBe(true)
  })

  test("stays a file renderer and creates only a portable plugin node reference", () => {
    const installedPlugin = plugin()
    const contribution = createWebPluginCanvasContribution(installedPlugin, {
      frameRegistry: new DesktopPluginFrameRegistry(),
      host: {
        getActiveContext: () => null,
        promptAgent: async () => ({ text: "" }),
        readManagedProjectImage: async (input) => ({
          dataUrl: "data:image/png;base64,",
          mimeType: "image/png",
          name: "image.png",
          path: input.path,
          size: 0,
        }),
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
    expect(webPluginIframeAllow(installedPlugin)).toContain("fullscreen 'none'")
    expect(webPluginIframeAllow(plugin(["ui.fullscreen"]))).toContain("fullscreen *")
  })

  test("keeps the Canvas in control until the selection pointer is released", () => {
    const pointerGate = new WebPluginPointerReleaseGate()
    const inactive = webPluginIframeInteractionProps({ selected: false })
    expect(pointerGate.begin(7)).toBe(true)
    const selectedDuringPointerGesture = webPluginIframeInteractionProps({
      pointerReleasePending: pointerGate.pending,
      selected: true,
    })
    const selectedDuringDrag = webPluginIframeInteractionProps({ dragging: true, selected: true })
    const active = webPluginIframeInteractionProps({ selected: true })
    const inactiveAgain = webPluginIframeInteractionProps({ selected: false })

    expect(inactive).toMatchObject({
      style: { pointerEvents: "none", visibility: "visible" },
      tabIndex: -1,
    })
    expect(inactive.className).not.toContain("nodrag")
    expect(inactive.className).not.toContain("nowheel")
    expect(selectedDuringPointerGesture).toEqual(inactive)
    expect(selectedDuringDrag).toMatchObject({
      style: { pointerEvents: "none", visibility: "visible" },
      tabIndex: -1,
    })
    expect(pointerGate.release(8)).toBe(false)
    expect(pointerGate.pending).toBe(true)
    expect(pointerGate.release(7)).toBe(true)
    expect(pointerGate.pending).toBe(true)
    expect(pointerGate.complete()).toBe(true)
    expect(pointerGate.pending).toBe(false)
    expect(active).toMatchObject({
      style: { pointerEvents: "auto", visibility: "visible" },
      tabIndex: 0,
    })
    expect(active.className).toContain("nodrag")
    expect(active.className).toContain("nowheel")
    expect(inactiveAgain).toEqual(inactive)
  })

  test("keeps the live Plugin surface visible behind a transparent host drag shield", () => {
    const markup = renderToStaticMarkup(<WebPluginDragShield />)

    expect(markup).toContain("data-web-plugin-drag-shield")
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain("pointer-events-none")
    expect(markup).toContain("bg-transparent")
    expect(markup).not.toContain("Moving plugin surface")
  })

  test("waits for every tracked pointer and can recover from pointer cancellation", () => {
    const pointerGate = new WebPluginPointerReleaseGate()
    expect(pointerGate.begin(1)).toBe(true)
    expect(pointerGate.begin(2)).toBe(true)
    expect(pointerGate.release(1)).toBe(false)
    expect(pointerGate.complete()).toBe(false)
    expect(pointerGate.releaseAll()).toBe(true)
    expect(pointerGate.complete()).toBe(true)
    expect(pointerGate.begin(3)).toBe(true)
  })

  test("matches its identity, extension, MIME type, or declared file-node kind", () => {
    const installedPlugin = plugin()
    expect(matchesWebPluginCanvasNode(installedPlugin, canvasNode().data)).toBe(true)
    expect(
      matchesWebPluginCanvasNode(installedPlugin, {
        kind: "text",
        label: "Opening.stage.json",
      }),
    ).toBe(true)
    expect(
      matchesWebPluginCanvasNode(installedPlugin, {
        kind: "file",
        label: "Opening",
        mimeType: "application/x-convax-stage",
      }),
    ).toBe(true)
    expect(
      matchesWebPluginCanvasNode(installedPlugin, {
        kind: "director-scene",
        label: "Opening",
      }),
    ).toBe(true)
    expect(
      matchesWebPluginCanvasNode(installedPlugin, {
        kind: "text",
        label: "notes.md",
      }),
    ).toBe(false)
  })

  test("encodes portable entry segments and never turns backslashes into host paths", () => {
    expect(webPluginEntryUrl(plugin())).toBe("convax-plugin://director-stage/surfaces/Director%20Stage.html")
    expect(() => webPluginEntryUrl({ entry: "surfaces\\index.html", id: "director-stage" })).toThrow("portable")
  })

  test("changes the live frame identity when an installed Plugin is upgraded", () => {
    const installed = plugin()
    expect(webPluginFrameKey({ ...installed, version: "1.2.4" })).not.toBe(webPluginFrameKey(installed))
  })

  test("keeps incoming image inputs in edge order instead of Canvas node order", () => {
    const owner = canvasNode()
    const first = connectedImageNode({ id: "image-first" })
    const second = connectedImageNode({ id: "image-second" })
    const document = createCanvasDocument({
      edges: [
        { id: "edge-first", source: first.id, target: owner.id, type: "canvas" },
        { id: "edge-second", source: second.id, target: owner.id, type: "canvas" },
      ],
      id: "canvas-1",
      nodes: [owner, second, first],
    })

    expect(getIncomingConnectedImageNodes(document, owner.id).map((node) => node.id)).toEqual([
      "image-first",
      "image-second",
    ])
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

  test("lists and reads only directly connected browser images through the managed Project port", async () => {
    const image = connectedImageNode()
    const readManagedProjectImage = mock(async (input: { path: string }) => ({
      dataUrl: "data:image/jpeg;base64,eHl6",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      path: input.path,
      size: 3,
    }))
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [image],
      readManagedProjectImage,
    })

    const listed = await dispatchWebPluginHostRequest(request("canvas.connectedImages.list"), context)
    expect(listed).toMatchObject({
      ok: true,
      result: {
        images: [
          {
            height: 1024,
            id: "image-1",
            mimeType: "image/jpeg",
            name: "panorama.jpg",
            readable: true,
            width: 2048,
          },
        ],
      },
    })
    expect(JSON.stringify(listed)).not.toContain(".convax/assets")
    expect(JSON.stringify(listed)).not.toContain("convax-asset:")

    const read = await dispatchWebPluginHostRequest(
      request("canvas.connectedImage.read", { nodeId: "image-1" }),
      context,
    )
    expect(read).toMatchObject({
      ok: true,
      result: {
        dataUrl: "data:image/jpeg;base64,eHl6",
        id: "image-1",
        name: "panorama.jpg",
      },
    })
    expect(readManagedProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".convax/assets/panorama.jpg",
        projectId: "project-1",
      }),
    )
    expect(readManagedProjectImage).toHaveBeenCalledTimes(1)
  })

  test("denies missing connected-image capability and arbitrary node ids", async () => {
    const readManagedProjectImage = mock(async () => ({
      dataUrl: "data:image/jpeg;base64,",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      path: ".convax/assets/panorama.jpg",
      size: 0,
    }))
    const denied = await dispatchWebPluginHostRequest(
      request("canvas.connectedImages.list"),
      hostContext(plugin(), { getConnectedImageNodes: () => [connectedImageNode()] }),
    )
    expect(denied).toMatchObject({
      ok: false,
      error: "Plugin capability is not granted: canvas.connectedImages.read",
    })

    const disconnected = await dispatchWebPluginHostRequest(
      request("canvas.connectedImage.read", { nodeId: "image-2" }),
      hostContext(plugin(["canvas.connectedImages.read"]), {
        getConnectedImageNodes: () => [connectedImageNode()],
        readManagedProjectImage,
      }),
    )
    expect(disconnected).toMatchObject({
      ok: false,
      error: "Canvas image is not directly connected to this Plugin node",
    })
    expect(readManagedProjectImage).not.toHaveBeenCalled()
  })

  test("defensively rejects an oversized result from the bounded managed-image port", async () => {
    const readManagedProjectImage = mock(async () => ({
      dataUrl: "data:image/jpeg;base64,",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      path: ".convax/assets/panorama.jpg",
      size: 16 * 1024 * 1024 + 1,
    }))
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readManagedProjectImage,
    })

    const response = await dispatchWebPluginHostRequest(
      request("canvas.connectedImage.read", { nodeId: "image-1" }),
      context,
    )
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("16 MB") })
    expect(readManagedProjectImage).toHaveBeenCalledTimes(1)
  })

  test("accepts an exact 16 MiB padded base64 image and rejects a false size declaration", async () => {
    const encoded = `${"A".repeat(22_369_622)}==`
    const exactContext = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readManagedProjectImage: mock(async () => ({
        dataUrl: `data:image/jpeg;base64,${encoded}`,
        mimeType: "image/jpeg",
        name: "panorama.jpg",
        path: ".convax/assets/panorama.jpg",
        size: 16 * 1024 * 1024,
      })),
    })
    expect(
      await dispatchWebPluginHostRequest(request("canvas.connectedImage.read", { nodeId: "image-1" }), exactContext),
    ).toMatchObject({ ok: true })

    const mismatchedContext = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readManagedProjectImage: mock(async () => ({
        dataUrl: "data:image/jpeg;base64,eA==",
        mimeType: "image/jpeg",
        name: "panorama.jpg",
        path: ".convax/assets/panorama.jpg",
        size: 2,
      })),
    })
    expect(
      await dispatchWebPluginHostRequest(
        request("canvas.connectedImage.read", { nodeId: "image-1" }),
        mismatchedContext,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("declared size") })
  })

  test("rejects forged or non-portable connected image references before Project file ports", async () => {
    const readManagedProjectImage = mock(async () => ({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "secret.jpg",
      path: "docs/secret.jpg",
      size: 1,
    }))

    for (const path of [
      "docs/secret.jpg",
      ".convax/canvases/private.png",
      ".convax/assets/../project.json",
      "C:/secret.jpg",
      "\\\\server\\secret.jpg",
    ]) {
      const base = connectedImageNode()
      const image = connectedImageNode({
        data: {
          ...base.data,
          metadata: { convaxProjectFile: { path } },
        },
      })
      const context = hostContext(plugin(["canvas.connectedImages.read"]), {
        getConnectedImageNodes: () => [image],
        readManagedProjectImage,
      })
      const listed = await dispatchWebPluginHostRequest(request("canvas.connectedImages.list"), context)
      expect(listed).toMatchObject({ ok: true, result: { images: [{ readable: false }] } })
      expect(
        await dispatchWebPluginHostRequest(request("canvas.connectedImage.read", { nodeId: image.id }), context),
      ).toMatchObject({ ok: false, error: expect.stringContaining("managed Project asset") })
    }

    expect(readManagedProjectImage).not.toHaveBeenCalled()
  })

  test("rejects a connected image whose source changes during its managed read", async () => {
    let image = connectedImageNode()
    let resolveImage!: (value: { dataUrl: string; mimeType: string; name: string; path: string; size: number }) => void
    const readManagedProjectImage = mock(
      () =>
        new Promise<WebPluginProjectFileResult>((resolve) => {
          resolveImage = resolve
        }),
    )
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [image],
      readManagedProjectImage,
    })
    const responsePromise = dispatchWebPluginHostRequest(
      request("canvas.connectedImage.read", { nodeId: image.id }),
      context,
    )
    const replacement = connectedImageNode()
    image = connectedImageNode({
      data: {
        ...replacement.data,
        metadata: { convaxProjectFile: { path: ".convax/assets/replacement.jpg" } },
      },
    })
    resolveImage({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      path: ".convax/assets/panorama.jpg",
      size: 1,
    })

    expect(await responsePromise).toMatchObject({
      ok: false,
      error: expect.stringContaining("source changed"),
    })
    expect(readManagedProjectImage).toHaveBeenCalledTimes(1)
  })

  test("allows only one connected image read in flight per Plugin frame", async () => {
    let resolveImage!: (value: { dataUrl: string; mimeType: string; name: string; path: string; size: number }) => void
    const readManagedProjectImage = mock(
      () =>
        new Promise<WebPluginProjectFileResult>((resolve) => {
          resolveImage = resolve
        }),
    )
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readManagedProjectImage,
    })
    const first = dispatchWebPluginHostRequest(request("canvas.connectedImage.read", { nodeId: "image-1" }), context)
    const second = await dispatchWebPluginHostRequest(
      { ...request("canvas.connectedImage.read", { nodeId: "image-1" }), id: "request-2" },
      context,
    )
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining("already in progress") })

    resolveImage({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      path: ".convax/assets/panorama.jpg",
      size: 1,
    })
    expect(await first).toMatchObject({ ok: true })
  })

  test("the Canvas update preserves node data, geometry, edges, and unrelated metadata", () => {
    const installedPlugin = plugin(["canvas.node.write"])
    const node = canvasNode()
    const document = createCanvasDocument({
      edges: [{ id: "edge-1", source: "node-1", target: "node-2", type: "canvas" }],
      id: "canvas-1",
      nodes: [node, canvasNode({ id: "node-2" })],
    })
    const next = updateWebPluginNodeState(
      document,
      {
        canvasId: "canvas-1",
        nodeId: "node-1",
        plugin: installedPlugin,
      },
      { scene: "new" },
    )
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

  test("stamps the installed Plugin version only after that version commits node state", () => {
    const installedPlugin = plugin(["canvas.node.write"])
    const node = canvasNode()
    node.data.metadata = {
      ...(node.data.metadata as Record<string, unknown>),
      convaxPlugin: { entry: "legacy.html", id: installedPlugin.id, version: "1.0.0" },
      convaxPluginState: { scene: "legacy" },
    }
    const document = createCanvasDocument({ id: "canvas-1", nodes: [node] })

    const next = updateWebPluginNodeState(
      document,
      {
        canvasId: document.id,
        nodeId: node.id,
        plugin: installedPlugin,
      },
      { scene: "migrated" },
    )

    expect(next.nodes[0]?.data.metadata).toMatchObject({
      convaxPlugin: {
        entry: installedPlugin.entry,
        id: installedPlugin.id,
        version: installedPlugin.version,
      },
      convaxPluginState: { scene: "migrated" },
    })
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
    const response = await dispatchWebPluginHostRequest(request("agent.prompt", { text: "Suggest a shot" }), context)
    expect(response).toMatchObject({ ok: true, result: { text: "Use a wide shot." } })
    expect(promptAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: "canvas-1",
        nodeId: "node-1",
        pluginId: "director-stage",
        pluginName: "Director Stage",
        projectId: "project-1",
        text: "Suggest a shot",
      }),
    )
  })

  test("rejects an async result when the active Canvas becomes stale", async () => {
    let active: WebPluginCanvasActiveContext = { canvasId: "canvas-1", projectId: "project-1" }
    let resolvePrompt!: (value: { text: string }) => void
    const promptAgent = () =>
      new Promise<{ text: string }>((resolve) => {
        resolvePrompt = resolve
      })
    const context = hostContext(plugin(["agent.prompt"]), {
      getActiveContext: () => active,
      promptAgent,
    })
    const responsePromise = dispatchWebPluginHostRequest(request("agent.prompt", { text: "Suggest a shot" }), context)
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
    expect(
      await dispatchWebPluginHostRequest({ ...request("host.context.get"), unexpected: true }, context),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("unsupported field"),
    })
    expect(
      await dispatchWebPluginHostRequest({ ...request("host.context.get"), extra: "x".repeat(300) }, context),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("exceeds"),
    })
    expect(await dispatchWebPluginHostRequest({ type: "request" }, context)).toBeNull()
  })
})
