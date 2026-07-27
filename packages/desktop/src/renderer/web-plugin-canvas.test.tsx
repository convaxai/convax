import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, type CanvasNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { renderToStaticMarkup } from "react-dom/server"
import type { InstalledWebPluginCanvasSurface, WebPluginCapability } from "../plugin-contracts"
import {
  desktopPluginHostProtocol,
  desktopPluginHostProtocolV2,
  pluginCapabilityProtocolV1,
  type DesktopPluginHostProtocol,
} from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import { WebPluginGenerationProjectionCoordinator } from "./web-plugin-generation-projection"
import {
  dispatchWebPluginHostRequest,
  connectedInputFingerprint,
  generationAnchorForPluginNode,
  getIncomingConnectedImageNodes,
  getIncomingConnectedInputNodes,
} from "../plugin-canvas-host"
import type {
  WebPluginCanvasActiveContext,
  WebPluginGenerationCanvasResult,
  WebPluginGenerationToolSummary,
  WebPluginHostRequestContext,
  WebPluginConnectedImageResult,
} from "../plugin-host-types"
import {
  createWebPluginCanvasContribution,
  matchesWebPluginCanvasNode,
  scheduleWebPluginFrameConnect,
  updateWebPluginNodeState,
  waitForWebPluginCanvasStateWrite,
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
  type WebPluginFrameConnectClock,
} from "./web-plugin-node-renderer"

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

function plugin(capabilities: WebPluginCapability[] = []): InstalledWebPluginCanvasSurface {
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

function generationCallerPlugin(): InstalledWebPluginCanvasSurface {
  return {
    ...plugin(["generation.execute"]),
    schema: "convax.plugin/2",
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
      label: "Reference image",
      metadata: {
        [projectResourceReferenceKey]: {
          kind: "managed-asset",
          mediaType: "image/jpeg",
          name: "panorama.jpg",
          sha256: "a".repeat(64),
        },
      },
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      resourceState: { contentRevision: "a".repeat(64), status: "ready" },
      width: 2048,
    },
    id: "image-1",
    position: { x: -100, y: 20 },
    type: "file",
    ...overrides,
  }
}

function generationInputNode(kind: "text" | "video" | "audio", id: string): CanvasNode {
  return kind === "text"
    ? {
        data: {
          kind,
          label: "Notes",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/composition.md" },
          },
          mimeType: "text/markdown",
          name: "composition.md",
          resourceState: { status: "ready", text: "Keep the wide composition" },
        },
        id,
        position: { x: -200, y: 0 },
        type: "file",
      }
    : {
        data: {
          kind,
          label: kind === "video" ? "Reference clip" : "Soundtrack",
          metadata: {
            [projectResourceReferenceKey]: {
              kind: "project-file",
              path: kind === "video" ? "media/reference.mp4" : "media/soundtrack.mp3",
            },
          },
          mimeType: kind === "video" ? "video/mp4" : "audio/mpeg",
          name: kind === "video" ? "reference.mp4" : "soundtrack.mp3",
          resourceState: { status: "ready" },
        },
        id,
        position: { x: -200, y: 0 },
        type: "file",
      }
}

function request(method: string, params?: unknown, protocol: DesktopPluginHostProtocol = desktopPluginHostProtocol) {
  return {
    id: "request-1",
    method,
    ...(params === undefined ? {} : { params }),
    protocol,
    type: "request",
  }
}

function hostContext(
  installedPlugin: InstalledWebPluginCanvasSurface,
  overrides: Partial<WebPluginHostRequestContext> = {},
) {
  const active: WebPluginCanvasActiveContext = {
    canvasId: "canvas-1",
    canvasName: "Storyboard",
    projectId: "project-1",
    projectName: "Film",
  }
  const controller = new AbortController()
  const document = createCanvasDocument({ id: active.canvasId, nodes: [canvasNode()] })
  return {
    canvasImageWriteGate: { active: false },
    connectedImageReadGate: { active: false },
    executeCanvasGeneration: mock(async () => ({
      createdNodeIds: ["generated-1"],
      revision: 1,
      toolId: "generation-tools/image.generate",
      warnings: [],
    })),
    frame: {
      canvasId: active.canvasId,
      nodeId: "node-1",
      pluginId: installedPlugin.id,
      projectId: active.projectId,
    },
    generationGate: { active: false },
    nodeStateWriteGate: { active: false },
    getActiveContext: () => active,
    getConnectedImageNodes: () => [],
    getConnectedInputNodes: () => [],
    getDocument: () => document,
    getNode: () => canvasNode(),
    isCanvasWritable: () => true,
    listGenerationTools: mock(
      async (): Promise<readonly WebPluginGenerationToolSummary[]> => [
        {
          acceptedInputs: ["text", "reference_image"],
          description: "Generate an image",
          id: "generation-tools/image.generate",
          kind: "model",
          output: "image",
          title: "Generate image",
        },
      ],
    ),
    ownsNode: (node) => matchesWebPluginCanvasNode(installedPlugin, node.data),
    plugin: installedPlugin,
    promptAgent: mock(async () => ({ text: "Use a wide shot." })),
    readConnectedImage: mock(async () => ({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      size: 1,
    })),
    readProjectText: mock(async (input) => ({ content: "hello", exists: true, path: input.path })),
    signal: controller.signal,
    updateNodeState: mock(async () => undefined),
    ...overrides,
    createCanvasImage:
      overrides.createCanvasImage ?? mock(async () => ({ createdNodeId: "captured-image-1", revision: 1 })),
  } satisfies WebPluginHostRequestContext
}

describe("Canvas Web Plugin contribution", () => {
  test("waits for an immediate post-generation state write until the authoritative projection settles", async () => {
    const frame = {
      canvasId: "canvas-1",
      nodeId: "node-1",
      pluginId: "multi-angle",
      projectId: "project-1",
    }
    const controller = new AbortController()
    const coordinator = new WebPluginGenerationProjectionCoordinator()
    let releaseProjection!: () => void
    const projection = new Promise<void>((resolve) => {
      releaseProjection = resolve
    })
    await coordinator.execute(
      frame,
      async () => ({ revision: 1 }),
      () => projection,
    )
    const editor = {
      document: createCanvasDocument({ id: "canvas-1" }),
      hydrating: false,
      readOnly: false,
    }
    let settled = false

    const waiting = waitForWebPluginCanvasStateWrite({
      frame,
      getActiveContext: () => ({ canvasId: "canvas-1", projectId: "project-1" }),
      getEditor: () => editor,
      signal: controller.signal,
      waitForGenerationProjection: (input) => coordinator.wait(input, input.signal),
    }).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()

    expect(settled).toBeFalse()
    releaseProjection()
    await expect(waiting).resolves.toBe(editor)
  })

  test("waits for the hydrated renderer controller before allowing a Plugin state write", async () => {
    const controller = new AbortController()
    let editor = {
      document: createCanvasDocument({ id: "canvas-1" }),
      hydrating: true,
      readOnly: true,
    }
    let releaseRender!: () => void
    const render = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    let settled = false

    const waiting = waitForWebPluginCanvasStateWrite(
      {
        frame: {
          canvasId: "canvas-1",
          nodeId: "node-1",
          pluginId: "multi-angle",
          projectId: "project-1",
        },
        getActiveContext: () => ({ canvasId: "canvas-1", projectId: "project-1" }),
        getEditor: () => editor,
        signal: controller.signal,
        waitForGenerationProjection: async () => undefined,
      },
      async () => render,
    ).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    expect(settled).toBeFalse()

    editor = { ...editor, hydrating: false, readOnly: false }
    releaseRender()
    await expect(waiting).resolves.toBe(editor)
  })

  test("rechecks Plugin scope after waiting for a hydrated renderer controller", async () => {
    const controller = new AbortController()
    let activeProjectId = "project-1"
    let releaseRender!: () => void
    const render = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    const waiting = waitForWebPluginCanvasStateWrite(
      {
        frame: {
          canvasId: "canvas-1",
          nodeId: "node-1",
          pluginId: "multi-angle",
          projectId: "project-1",
        },
        getActiveContext: () => ({ canvasId: "canvas-1", projectId: activeProjectId }),
        getEditor: () => ({
          document: createCanvasDocument({ id: "canvas-1" }),
          hydrating: true,
          readOnly: true,
        }),
        signal: controller.signal,
        waitForGenerationProjection: async () => undefined,
      },
      async () => render,
    )

    activeProjectId = "project-2"
    releaseRender()

    await expect(waiting).rejects.toThrow("Plugin call is no longer in the active Project and Canvas")
  })

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
        createCanvasImage: async () => ({ createdNodeId: "captured-image-1", revision: 1 }),
        executeCanvasGeneration: async () => ({
          createdNodeIds: [],
          revision: 0,
          toolId: "",
          warnings: [],
        }),
        getActiveContext: () => null,
        listGenerationTools: async () => [],
        promptAgent: async () => ({ text: "" }),
        readConnectedImage: async () => ({
          dataUrl: "data:image/png;base64,",
          mimeType: "image/png",
          name: "image.png",
          size: 0,
        }),
        readProjectText: async (input) => ({ content: "", exists: false, path: input.path }),
        waitForGenerationProjection: async () => undefined,
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
    expect(renderer.toolbar).toBeUndefined()
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
  test("fails closed for V5 capability methods that are not handled by the legacy node adapter", async () => {
    const installedPlugin = {
      ...plugin(["projects.read"]),
      schema: "convax.plugin/5",
    } satisfies InstalledWebPluginCanvasSurface
    const context = hostContext(installedPlugin)

    const response = await dispatchWebPluginHostRequest(
      request("projects.list", undefined, pluginCapabilityProtocolV1),
      context,
    )

    expect(response).toMatchObject({
      error: "Plugin host method is not available in this capability adapter: projects.list",
      ok: false,
    })
    expect(context.promptAgent).not.toHaveBeenCalled()
  })

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
    const updateNodeState = mock(async () => undefined)
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

  test("does not confirm a state write until its Canvas projection barrier settles", async () => {
    let releaseStateWrite!: () => void
    const stateWrite = new Promise<void>((resolve) => {
      releaseStateWrite = resolve
    })
    const updateNodeState = mock(async () => stateWrite)
    const context = hostContext(plugin(["canvas.node.write"]), { updateNodeState })
    let settled = false

    const response = dispatchWebPluginHostRequest(
      request("canvas.node.updateState", { state: { status: "success" } }),
      context,
    ).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()

    expect(updateNodeState).toHaveBeenCalledTimes(1)
    expect(settled).toBeFalse()

    releaseStateWrite()
    await expect(response).resolves.toMatchObject({ ok: true, result: { updated: true } })
  })

  test("allows only one Canvas node state write in flight per Plugin frame", async () => {
    let releaseStateWrite!: () => void
    const stateWrite = new Promise<void>((resolve) => {
      releaseStateWrite = resolve
    })
    const updateNodeState = mock(async () => stateWrite)
    const context = hostContext(plugin(["canvas.node.write"]), { updateNodeState })

    const first = dispatchWebPluginHostRequest(
      request("canvas.node.updateState", { state: { status: "running" } }),
      context,
    )
    await Promise.resolve()
    expect(context.nodeStateWriteGate.active).toBeTrue()

    const second = await dispatchWebPluginHostRequest(
      {
        ...request("canvas.node.updateState", { state: { status: "success" } }),
        id: "request-2",
      },
      context,
    )
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining("already in progress") })
    expect(updateNodeState).toHaveBeenCalledTimes(1)

    releaseStateWrite()
    await expect(first).resolves.toMatchObject({ ok: true, result: { updated: true } })
    expect(context.nodeStateWriteGate.active).toBeFalse()

    await expect(
      dispatchWebPluginHostRequest(
        {
          ...request("canvas.node.updateState", { state: { status: "success" } }),
          id: "request-3",
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: true, result: { updated: true } })
    expect(updateNodeState).toHaveBeenCalledTimes(2)
  })

  test("creates a bounded PNG Canvas image only with the explicit write capability", async () => {
    const dataUrl = `data:image/png;base64,${Buffer.alloc(24).toString("base64")}`
    const createCanvasImage = mock(async () => ({ createdNodeId: "captured-image-1", revision: 2 }))
    const context = hostContext(plugin(["canvas.image.write"]), { createCanvasImage })

    const response = await dispatchWebPluginHostRequest(
      request("canvas.image.create", { dataUrl, name: "viewport-capture.png" }),
      context,
    )

    expect(response).toMatchObject({
      ok: true,
      result: { createdNodeId: "captured-image-1", revision: 2 },
    })
    expect(createCanvasImage).toHaveBeenCalledWith(
      expect.objectContaining({
        dataUrl,
        name: "viewport-capture.png",
        pluginVersion: "1.2.3",
      }),
    )

    const denied = await dispatchWebPluginHostRequest(
      request("canvas.image.create", { dataUrl, name: "viewport-capture.png" }),
      hostContext(plugin()),
    )
    expect(denied).toMatchObject({ ok: false, error: "Plugin capability is not granted: canvas.image.write" })
  })

  test("lists and reads only directly connected typed Project images through the scoped Canvas port", async () => {
    const image = connectedImageNode()
    const readConnectedImage = mock(
      async (_input: Parameters<WebPluginHostRequestContext["readConnectedImage"]>[0]) => ({
        dataUrl: "data:image/jpeg;base64,eHl6",
        mimeType: "image/jpeg",
        name: "panorama.jpg",
        size: 3,
      }),
    )
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [image],
      readConnectedImage,
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
    expect(JSON.stringify(listed)).not.toContain("managed-asset")
    expect(JSON.stringify(listed)).not.toContain("sha256")

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
    expect(readConnectedImage).toHaveBeenCalledWith({
      canvasId: "canvas-1",
      expectedRevision: 0,
      nodeId: "image-1",
      ownerNodeId: "node-1",
      projectId: "project-1",
      signal: context.signal,
    })
    expect(JSON.stringify(readConnectedImage.mock.calls[0]?.[0])).not.toMatch(/path|reference|sha256|dataUrl/)
    expect(readConnectedImage).toHaveBeenCalledTimes(1)
  })

  test("lists pathless direct incoming media metadata in edge order", async () => {
    const video: CanvasNode = {
      data: {
        durationMs: 12_500,
        kind: "video",
        label: "Opening clip",
        metadata: { projectFile: { path: ".convax/assets/opening.mp4" } },
        mimeType: "video/mp4",
        name: "opening.mp4",
        url: "convax-asset://project-1/opening",
      },
      id: "video-1",
      position: { x: -200, y: 0 },
      type: "file",
    }
    const image = connectedImageNode()
    const context = hostContext(plugin(["canvas.connectedInputs.read"]), {
      getConnectedInputNodes: () => [video, image],
    })

    const listed = await dispatchWebPluginHostRequest(request("canvas.connectedInputs.list"), context)

    expect(listed).toMatchObject({
      ok: true,
      result: {
        inputs: [
          {
            durationMs: 12_500,
            id: "video-1",
            kind: "video",
            label: "Opening clip",
            mimeType: "video/mp4",
            name: "opening.mp4",
          },
          {
            height: 1024,
            id: "image-1",
            kind: "image",
            label: "Reference image",
            mimeType: "image/jpeg",
            name: "panorama.jpg",
            width: 2048,
          },
        ],
      },
    })
    expect(JSON.stringify(listed)).not.toContain(".convax/assets")
    expect(JSON.stringify(listed)).not.toContain("convax-asset:")

    const denied = await dispatchWebPluginHostRequest(
      request("canvas.connectedInputs.list"),
      hostContext(plugin(), { getConnectedInputNodes: () => [video] }),
    )
    expect(denied).toMatchObject({
      error: "Plugin capability is not granted: canvas.connectedInputs.read",
      ok: false,
    })
  })

  test("derives connected-input order and fingerprints source changes without exposing source data", async () => {
    const owner = canvasNode()
    const video = generationInputNode("video", "video-1")
    const image = connectedImageNode()
    const outgoing = generationInputNode("video", "video-output")
    const document = createCanvasDocument({
      edges: [
        { id: "edge-video", source: video.id, target: owner.id },
        { id: "edge-image", source: image.id, target: owner.id },
        { id: "edge-duplicate", source: video.id, target: owner.id },
        { id: "edge-output", source: owner.id, target: outgoing.id },
      ],
      id: "canvas-1",
      nodes: [owner, video, image, outgoing],
    })

    expect(getIncomingConnectedInputNodes(document, owner.id).map((node) => node.id)).toEqual(["video-1", "image-1"])
    const initial = await connectedInputFingerprint(document, owner.id)
    const outgoingChanged = await connectedInputFingerprint(
      {
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === outgoing.id
            ? { ...node, data: { ...node.data, url: "convax-asset://project-1/output-replaced" } }
            : node,
        ),
      },
      owner.id,
    )
    const changed = await connectedInputFingerprint(
      {
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === video.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  resourceState: { contentRevision: "replaced", status: "ready" },
                },
              }
            : node,
        ),
      },
      owner.id,
    )
    expect(outgoingChanged).toBe(initial)
    expect(changed).not.toBe(initial)
    expect(initial).not.toContain(".convax")
  })

  test("denies missing connected-image capability and arbitrary node ids", async () => {
    const readConnectedImage = mock(async () => ({
      dataUrl: "data:image/jpeg;base64,",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
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
        readConnectedImage,
      }),
    )
    expect(disconnected).toMatchObject({
      ok: false,
      error: "Canvas image is not a direct incoming input to this Plugin node",
    })
    expect(readConnectedImage).not.toHaveBeenCalled()
  })

  test("defensively rejects an oversized result from the bounded connected-image port", async () => {
    const readConnectedImage = mock(async () => ({
      dataUrl: "data:image/jpeg;base64,",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      size: 16 * 1024 * 1024 + 1,
    }))
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readConnectedImage,
    })

    const response = await dispatchWebPluginHostRequest(
      request("canvas.connectedImage.read", { nodeId: "image-1" }),
      context,
    )
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("16 MB") })
    expect(readConnectedImage).toHaveBeenCalledTimes(1)
  })

  test("accepts an exact 16 MiB padded base64 image and rejects a false size declaration", async () => {
    const encoded = `${"A".repeat(22_369_622)}==`
    const exactContext = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readConnectedImage: mock(async () => ({
        dataUrl: `data:image/jpeg;base64,${encoded}`,
        mimeType: "image/jpeg",
        name: "panorama.jpg",
        size: 16 * 1024 * 1024,
      })),
    })
    expect(
      await dispatchWebPluginHostRequest(request("canvas.connectedImage.read", { nodeId: "image-1" }), exactContext),
    ).toMatchObject({ ok: true })

    const mismatchedContext = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readConnectedImage: mock(async () => ({
        dataUrl: "data:image/jpeg;base64,eA==",
        mimeType: "image/jpeg",
        name: "panorama.jpg",
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

  test("rejects missing, directory, forged-private, or malformed connected image references before host reads", async () => {
    const readConnectedImage = mock(async () => ({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "secret.jpg",
      size: 1,
    }))

    for (const metadata of [
      {},
      { [projectResourceReferenceKey]: { kind: "project-file", path: ".convax/canvases/private.png" } },
      { [projectResourceReferenceKey]: { kind: "project-directory", path: "media" } },
      {
        [projectResourceReferenceKey]: {
          kind: "managed-asset",
          mediaType: "image/jpeg",
          name: "secret.jpg",
          sha256: "not-a-digest",
        },
      },
    ]) {
      const base = connectedImageNode()
      const image = connectedImageNode({
        data: {
          ...base.data,
          metadata,
        },
      })
      const context = hostContext(plugin(["canvas.connectedImages.read"]), {
        getConnectedImageNodes: () => [image],
        readConnectedImage,
      })
      const listed = await dispatchWebPluginHostRequest(request("canvas.connectedImages.list"), context)
      expect(listed).toMatchObject({ ok: true, result: { images: [{ readable: false }] } })
      expect(
        await dispatchWebPluginHostRequest(request("canvas.connectedImage.read", { nodeId: image.id }), context),
      ).toMatchObject({ ok: false, error: expect.stringContaining("typed Project file") })
    }

    expect(readConnectedImage).not.toHaveBeenCalled()
  })

  test("rejects a connected image whose typed source changes during its scoped read", async () => {
    let image = connectedImageNode()
    let resolveImage!: (value: WebPluginConnectedImageResult) => void
    const readConnectedImage = mock(
      () =>
        new Promise<WebPluginConnectedImageResult>((resolve) => {
          resolveImage = resolve
        }),
    )
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [image],
      readConnectedImage,
    })
    const responsePromise = dispatchWebPluginHostRequest(
      request("canvas.connectedImage.read", { nodeId: image.id }),
      context,
    )
    const replacement = connectedImageNode()
    image = connectedImageNode({
      data: {
        ...replacement.data,
        metadata: {
          [projectResourceReferenceKey]: {
            kind: "managed-asset",
            mediaType: "image/jpeg",
            name: "replacement.jpg",
            sha256: "b".repeat(64),
          },
        },
      },
    })
    resolveImage({
      dataUrl: "data:image/jpeg;base64,eA==",
      mimeType: "image/jpeg",
      name: "panorama.jpg",
      size: 1,
    })

    expect(await responsePromise).toMatchObject({
      ok: false,
      error: expect.stringContaining("source changed"),
    })
    expect(readConnectedImage).toHaveBeenCalledTimes(1)
  })

  test("allows only one connected image read in flight per Plugin frame", async () => {
    let resolveImage!: (value: WebPluginConnectedImageResult) => void
    const readConnectedImage = mock(
      () =>
        new Promise<WebPluginConnectedImageResult>((resolve) => {
          resolveImage = resolve
        }),
    )
    const context = hostContext(plugin(["canvas.connectedImages.read"]), {
      getConnectedImageNodes: () => [connectedImageNode()],
      readConnectedImage,
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
    const agentPlugin: InstalledWebPluginCanvasSurface = {
      ...plugin(["agent.prompt"]),
      contributes: {
        ...plugin(["agent.prompt"]).contributes,
        skills: [{ name: "director-stage", path: "skills/director-stage" }],
      },
      schema: "convax.plugin/6",
    }
    const context = hostContext(agentPlugin, { promptAgent })
    const response = await dispatchWebPluginHostRequest(
      request("agent.prompt", { text: "Suggest a shot" }, pluginCapabilityProtocolV1),
      context,
    )
    expect(response).toMatchObject({ ok: true, result: { text: "Use a wide shot." } })
    expect(promptAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: "canvas-1",
        nodeId: "node-1",
        pluginId: "director-stage",
        pluginName: "Director Stage",
        projectId: "project-1",
        skillName: "director-stage",
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

  test("keeps generation calls on plugin-host/2 and capability-gates both narrow methods", async () => {
    const caller = generationCallerPlugin()
    const listGenerationTools = mock(async () => [
      {
        acceptedInputs: ["reference_image"] as const,
        description: "Generate a still image",
        id: "image-tools/generate",
        kind: "model" as const,
        output: "image" as const,
        title: "Generate image",
      },
    ])
    const context = hostContext(caller, { listGenerationTools })

    const legacy = await dispatchWebPluginHostRequest(
      request("generation.tools.list", undefined, desktopPluginHostProtocol),
      context,
    )
    expect(legacy).toMatchObject({
      ok: false,
      protocol: desktopPluginHostProtocolV2,
      error: expect.stringContaining("Invalid plugin host request"),
    })

    const listed = await dispatchWebPluginHostRequest(
      request("generation.tools.list", { output: "image" }, desktopPluginHostProtocolV2),
      context,
    )
    expect(listed).toEqual({
      id: "request-1",
      ok: true,
      protocol: desktopPluginHostProtocolV2,
      result: {
        tools: [
          {
            acceptedInputs: ["reference_image"],
            description: "Generate a still image",
            id: "image-tools/generate",
            kind: "model",
            output: "image",
            title: "Generate image",
          },
        ],
      },
      type: "response",
    })
    expect(listGenerationTools).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: "canvas-1",
        nodeId: "node-1",
        output: "image",
        pluginId: caller.id,
        projectId: "project-1",
        signal: expect.any(AbortSignal),
      }),
    )

    const executableWithoutCallerCapability = {
      ...caller,
      capabilities: [] as WebPluginCapability[],
      contributes: {
        ...caller.contributes,
        generation: {
          tools: [
            {
              acceptedInputs: ["text" as const],
              description: "Generate text",
              id: "text.generate",
              output: "text" as const,
              title: "Generate text",
            },
          ],
        },
      },
      runtime: { command: "generation-mcp", type: "mcp-stdio" as const },
    }
    const denied = await dispatchWebPluginHostRequest(
      request("generation.tools.list", undefined, desktopPluginHostProtocolV2),
      hostContext(executableWithoutCallerCapability),
    )
    expect(denied).toMatchObject({
      ok: false,
      error: "Plugin capability is not granted: generation.execute",
    })
  })

  test("derives generation scope, placement, and explicit references without trusting the renderer revision", async () => {
    const owner = canvasNode({ style: { height: 460, width: 720 } })
    const image = connectedImageNode()
    const video = generationInputNode("video", "video-1")
    const audio = generationInputNode("audio", "audio-1")
    const document = {
      ...createCanvasDocument({
        edges: [
          { id: "edge-image", source: image.id, target: owner.id, type: "canvas" },
          { id: "edge-video", source: video.id, target: owner.id, type: "canvas" },
          { id: "edge-audio", source: audio.id, target: owner.id, type: "canvas" },
        ],
        id: "canvas-1",
        nodes: [owner, image, video, audio],
      }),
      revision: 7,
    }
    const executeCanvasGeneration = mock(async () => ({
      createdNodeIds: ["generated-image"],
      revision: 8,
      toolId: "image-tools/generate",
      warnings: [],
    }))
    const context = hostContext(generationCallerPlugin(), {
      executeCanvasGeneration,
      getDocument: () => document,
      getNode: () => owner,
    })

    const response = await dispatchWebPluginHostRequest(
      request(
        "generation.canvas.execute",
        {
          output: "image",
          prompt: "Paint the next frame",
          references: [
            { nodeId: image.id, role: "first_frame" },
            { nodeId: audio.id, role: "audio" },
          ],
          resultMode: "create-pending-node",
          toolId: "image-tools/generate",
        },
        desktopPluginHostProtocolV2,
      ),
      context,
    )

    expect(response).toMatchObject({
      ok: true,
      protocol: desktopPluginHostProtocolV2,
      result: { createdNodeIds: ["generated-image"], revision: 8, toolId: "image-tools/generate" },
    })
    expect(generationAnchorForPluginNode(owner)).toEqual({ x: 794, y: 20 })
    expect(executeCanvasGeneration).toHaveBeenCalledWith({
      anchor: { x: 794, y: 20 },
      canvasId: "canvas-1",
      nodeId: "node-1",
      output: "image",
      pluginId: "director-stage",
      projectId: "project-1",
      prompt: "Paint the next frame",
      references: [
        { nodeId: "image-1", role: "first_frame" },
        { nodeId: "audio-1", role: "audio" },
      ],
      resultMode: "create-pending-node",
      signal: expect.any(AbortSignal),
      toolId: "image-tools/generate",
    })

    const authorityInjection = await dispatchWebPluginHostRequest(
      request(
        "generation.canvas.execute",
        {
          anchor: { x: 0, y: 0 },
          expectedRevision: 0,
          projectId: "another-project",
          prompt: "escape",
        },
        desktopPluginHostProtocolV2,
      ),
      context,
    )
    expect(authorityInjection).toMatchObject({ ok: false, error: expect.stringContaining("unsupported field") })
    const unsupportedResultMode = await dispatchWebPluginHostRequest(
      request(
        "generation.canvas.execute",
        { prompt: "escape", resultMode: "replace-node" },
        desktopPluginHostProtocolV2,
      ),
      context,
    )
    expect(unsupportedResultMode).toMatchObject({
      ok: false,
      error: expect.stringContaining("result mode is not supported"),
    })
    expect(executeCanvasGeneration).toHaveBeenCalledTimes(1)
  })

  test("returns bounded text from a Plugin-owned generation tool without mutating Canvas", async () => {
    const owner = canvasNode()
    const document = {
      ...createCanvasDocument({
        id: "canvas-1",
        nodes: [owner],
      }),
      revision: 7,
    }
    const executeCanvasGeneration = mock(async () => ({
      createdNodeIds: [],
      outputText: '{"state":"active"}',
      revision: 7,
      toolId: "editor-tools/draft.status",
      warnings: [],
    }))
    const context = hostContext(generationCallerPlugin(), {
      executeCanvasGeneration,
      getDocument: () => document,
      getNode: () => owner,
    })

    const response = await dispatchWebPluginHostRequest(
      request(
        "generation.canvas.execute",
        {
          output: "text",
          prompt: "Inspect the editor",
          references: [],
          resultMode: "return",
          toolId: "editor-tools/draft.status",
        },
        desktopPluginHostProtocolV2,
      ),
      context,
    )

    expect(response).toEqual({
      id: "request-1",
      ok: true,
      protocol: desktopPluginHostProtocolV2,
      result: {
        createdNodeIds: [],
        outputText: '{"state":"active"}',
        revision: 7,
        toolId: "editor-tools/draft.status",
        warnings: [],
      },
      type: "response",
    })
    expect(executeCanvasGeneration).toHaveBeenCalledWith({
      anchor: { x: 394, y: 20 },
      canvasId: "canvas-1",
      nodeId: "node-1",
      output: "text",
      pluginId: "director-stage",
      projectId: "project-1",
      prompt: "Inspect the editor",
      references: [],
      resultMode: "return",
      signal: expect.any(AbortSignal),
      toolId: "editor-tools/draft.status",
    })
  })

  test("infers semantic references only from direct incoming file nodes in edge order", async () => {
    const owner = canvasNode()
    const image = connectedImageNode()
    const video = generationInputNode("video", "video-1")
    const audio = generationInputNode("audio", "audio-1")
    const text = generationInputNode("text", "text-1")
    const disconnected = connectedImageNode({ id: "image-disconnected" })
    const outgoing = connectedImageNode({ id: "image-outgoing" })
    const document = createCanvasDocument({
      edges: [
        { id: "edge-text", source: text.id, target: owner.id, type: "canvas" },
        { id: "edge-image", source: image.id, target: owner.id, type: "canvas" },
        { id: "edge-video", source: video.id, target: owner.id, type: "canvas" },
        { id: "edge-audio", source: audio.id, target: owner.id, type: "canvas" },
        { id: "edge-outgoing", source: owner.id, target: outgoing.id, type: "canvas" },
      ],
      id: "canvas-1",
      nodes: [owner, disconnected, outgoing, audio, image, text, video],
    })
    const executeCanvasGeneration = mock(async () => ({
      createdNodeIds: ["generated-1"],
      revision: 1,
      toolId: "mixed/generate",
      warnings: [],
    }))
    const context = hostContext(generationCallerPlugin(), {
      executeCanvasGeneration,
      getDocument: () => document,
      getNode: () => owner,
    })

    expect(
      await dispatchWebPluginHostRequest(
        request("generation.canvas.execute", { prompt: "Continue" }, desktopPluginHostProtocolV2),
        context,
      ),
    ).toMatchObject({ ok: true })
    expect(executeCanvasGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          { nodeId: "text-1", role: "text" },
          { nodeId: "image-1", role: "reference_image" },
          { nodeId: "video-1", role: "reference_video" },
          { nodeId: "audio-1", role: "audio" },
        ],
        resultMode: "create-pending-node",
      }),
    )
  })

  test("rejects more than 32 inferred incoming generation references before the port", async () => {
    const owner = canvasNode()
    const inputs = Array.from({ length: 33 }, (_, index) => generationInputNode("text", `text-${index}`))
    const document = createCanvasDocument({
      edges: inputs.map((input, index) => ({
        id: `edge-${index}`,
        source: input.id,
        target: owner.id,
        type: "canvas" as const,
      })),
      id: "canvas-1",
      nodes: [owner, ...inputs],
    })
    const executeCanvasGeneration = mock(async () => ({
      createdNodeIds: ["generated-1"],
      revision: 1,
      toolId: "text/generate",
      warnings: [],
    }))

    const response = await dispatchWebPluginHostRequest(
      request("generation.canvas.execute", { prompt: "Continue" }, desktopPluginHostProtocolV2),
      hostContext(generationCallerPlugin(), {
        executeCanvasGeneration,
        getDocument: () => document,
        getNode: () => owner,
      }),
    )

    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("at most 32") })
    expect(executeCanvasGeneration).not.toHaveBeenCalled()
  })

  test("rejects disconnected, mismatched, duplicate, and read-only generation references before the port", async () => {
    const owner = canvasNode()
    const image = connectedImageNode()
    const document = createCanvasDocument({
      edges: [{ id: "edge-image", source: image.id, target: owner.id, type: "canvas" }],
      id: "canvas-1",
      nodes: [owner, image, connectedImageNode({ id: "other-image" })],
    })
    const executeCanvasGeneration = mock(async () => ({
      createdNodeIds: ["generated-1"],
      revision: 1,
      toolId: "image/generate",
      warnings: [],
    }))
    const base = {
      executeCanvasGeneration,
      getDocument: () => document,
      getNode: () => owner,
    }
    for (const references of [
      [{ nodeId: "other-image", role: "reference_image" }],
      [{ nodeId: image.id, role: "audio" }],
      [
        { nodeId: image.id, role: "reference_image" },
        { nodeId: image.id, role: "reference_image" },
      ],
    ]) {
      const response = await dispatchWebPluginHostRequest(
        request("generation.canvas.execute", { prompt: "Continue", references }, desktopPluginHostProtocolV2),
        hostContext(generationCallerPlugin(), base),
      )
      expect(response).toMatchObject({ ok: false })
    }
    const readOnly = await dispatchWebPluginHostRequest(
      request("generation.canvas.execute", { prompt: "Continue" }, desktopPluginHostProtocolV2),
      hostContext(generationCallerPlugin(), { ...base, isCanvasWritable: () => false }),
    )
    expect(readOnly).toMatchObject({ ok: false, error: expect.stringContaining("not writable") })
    expect(executeCanvasGeneration).not.toHaveBeenCalled()
  })

  test("allows one generation in flight and rejects a stale result after the active Canvas changes", async () => {
    let active: WebPluginCanvasActiveContext = { canvasId: "canvas-1", projectId: "project-1" }
    let resolveGeneration!: (value: {
      createdNodeIds: readonly string[]
      revision: number
      toolId: string
      warnings: readonly string[]
    }) => void
    const executeCanvasGeneration = mock(
      () =>
        new Promise<WebPluginGenerationCanvasResult>((resolve) => {
          resolveGeneration = resolve
        }),
    )
    const context = hostContext(generationCallerPlugin(), {
      executeCanvasGeneration,
      getActiveContext: () => active,
    })
    const first = dispatchWebPluginHostRequest(
      request("generation.canvas.execute", { prompt: "Continue" }, desktopPluginHostProtocolV2),
      context,
    )
    const second = await dispatchWebPluginHostRequest(
      { ...request("generation.canvas.execute", { prompt: "Again" }, desktopPluginHostProtocolV2), id: "request-2" },
      context,
    )
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining("already in progress") })

    active = { canvasId: "canvas-2", projectId: "project-1" }
    resolveGeneration({ createdNodeIds: ["generated-1"], revision: 1, toolId: "image/generate", warnings: [] })
    expect(await first).toMatchObject({
      ok: false,
      error: expect.stringContaining("no longer in the active Project and Canvas"),
    })
    expect(context.generationGate.active).toBe(false)
    expect(executeCanvasGeneration).toHaveBeenCalledTimes(1)
  })

  test("does not expose native paths or sidecar stderr through generation failures", async () => {
    const executeCanvasGeneration = mock(async () => {
      throw new Error("/private/var/tmp/convax-generation/secret.png: API_TOKEN=secret")
    })
    const context = hostContext(generationCallerPlugin(), { executeCanvasGeneration })

    const response = await dispatchWebPluginHostRequest(
      request("generation.canvas.execute", { prompt: "Generate" }, desktopPluginHostProtocolV2),
      context,
    )

    expect(response).toMatchObject({ ok: false, error: "Canvas generation could not be completed" })
    expect(JSON.stringify(response)).not.toContain("/private/var")
    expect(JSON.stringify(response)).not.toContain("API_TOKEN")
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
