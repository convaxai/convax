import {
  CanvasNodeChrome,
  CanvasNodeToolbarButton,
  CanvasNodeToolbarDivider,
  createCanvasId,
  updateCanvasNodeData,
  useCanvasEditor,
  type CanvasDocument,
  type CanvasFileRendererDefinition,
  type CanvasFileRendererPlugin,
  type CanvasNode,
} from "@convax/canvas"
import { Copy, Play, Puzzle, Trash2 } from "lucide-react"
import { type ComponentProps, useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  requireWebPluginId,
  requireWebPluginRelativePath,
  webPluginManifestSchemaV5,
  type InstalledWebPluginCanvasSurface,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import {
  connectedImageFingerprint,
  dispatchPluginHostRequest,
  getIncomingConnectedImageNodes,
} from "../plugin-canvas-host"
import {
  matchesWebPluginCanvasNode,
  webPluginCanvasRendererId,
  webPluginIdentityMetadataKey,
  webPluginNodeMetadata,
  webPluginStateMetadataKey,
} from "../plugin-canvas-node"
import type { PluginCanvasHost, PluginHostLimits, PluginNodeInvocationRef } from "../plugin-host-types"
import {
  desktopPluginConnectedImagesChangedCommand,
  desktopPluginHostProtocolForManifestSchema,
  type DesktopPluginHostConnect,
} from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry, type DesktopPluginFrameRef } from "./plugin-frame-registry"
import { isProjectCanvasCapabilityRequest, RendererPluginHostConnection } from "./plugin-host-connection"

export const webPluginIframeSandbox = "allow-scripts" as const
export const webPluginIframePermissions = [
  "camera 'none'",
  "clipboard-read 'none'",
  "clipboard-write 'none'",
  "display-capture 'none'",
  "geolocation 'none'",
  "microphone 'none'",
].join("; ")
export function webPluginIframeAllow(plugin: Pick<InstalledWebPluginSummary, "capabilities">) {
  return `${webPluginIframePermissions}; fullscreen ${plugin.capabilities.includes("ui.fullscreen") ? "*" : "'none'"}`
}
export {
  matchesWebPluginCanvasNode,
  webPluginCanvasRendererId,
  webPluginIdentityMetadataKey,
  webPluginStateMetadataKey,
} from "../plugin-canvas-node"

const webPluginIframeBaseClassName = "size-full border-0 bg-background"

/** Keep embedded Plugin input behind selection and the pointer gesture that selected it. */
export function webPluginIframeInteractionProps(input: {
  dragging?: boolean
  pointerReleasePending?: boolean
  selected: boolean
}) {
  const interactive = input.selected && !input.dragging && !input.pointerReleasePending
  return {
    className: interactive ? `nodrag nowheel ${webPluginIframeBaseClassName}` : webPluginIframeBaseClassName,
    style: {
      pointerEvents: interactive ? "auto" : "none",
      visibility: "visible",
    } as const,
    tabIndex: interactive ? 0 : -1,
  }
}

/** Tracks pointer gestures that began on the Canvas-owned host chrome, outside the iframe. */
export class WebPluginPointerReleaseGate {
  private pointerIds = new Set<number>()
  private waiting = false

  get pending() {
    return this.waiting
  }

  begin(pointerId: number) {
    const size = this.pointerIds.size
    this.waiting = true
    this.pointerIds.add(pointerId)
    return this.pointerIds.size !== size
  }

  release(pointerId: number) {
    if (!this.pointerIds.delete(pointerId)) return false
    return this.pointerIds.size === 0
  }

  releaseAll() {
    if (!this.waiting) return false
    this.pointerIds.clear()
    return true
  }

  complete() {
    if (!this.waiting || this.pointerIds.size > 0) return false
    this.waiting = false
    return true
  }
}

/** Transparent host-owned shield that keeps a live Plugin surface out of the drag gesture. */
export function WebPluginDragShield() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1] select-none bg-transparent"
      data-web-plugin-drag-shield=""
    />
  )
}

const webPluginFrameConnectFallbackMs = 100

export interface WebPluginFrameConnectClock {
  cancelFrame(id: number): void
  clearDelay(id: number): void
  requestFrame(callback: () => void): number
  setDelay(callback: () => void, delay: number): number
}

function browserWebPluginFrameConnectClock(): WebPluginFrameConnectClock {
  return {
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    clearDelay: (id) => window.clearTimeout(id),
    requestFrame: (callback) => window.requestAnimationFrame(() => callback()),
    setDelay: (callback, delay) => window.setTimeout(callback, delay),
  }
}

/** Let iframe scripts and React passive effects register their one-shot port listener. */
export function scheduleWebPluginFrameConnect(callback: () => void, clock = browserWebPluginFrameConnectClock()) {
  let active = true
  let frameId: number | null = null
  let settleDelayId: number | null = null
  let fallbackDelayId: number | null = null

  const clearScheduled = () => {
    if (frameId !== null) clock.cancelFrame(frameId)
    if (settleDelayId !== null) clock.clearDelay(settleDelayId)
    if (fallbackDelayId !== null) clock.clearDelay(fallbackDelayId)
    frameId = null
    settleDelayId = null
    fallbackDelayId = null
  }
  const finish = () => {
    if (!active) return
    active = false
    clearScheduled()
    callback()
  }

  frameId = clock.requestFrame(() => {
    frameId = null
    settleDelayId = clock.setDelay(() => {
      settleDelayId = null
      finish()
    }, 0)
  })
  fallbackDelayId = clock.setDelay(() => {
    fallbackDelayId = null
    finish()
  }, webPluginFrameConnectFallbackMs)

  return () => {
    if (!active) return
    active = false
    clearScheduled()
  }
}

interface WebPluginCanvasStateWriteEditor {
  document: CanvasDocument
  hydrating: boolean
  readOnly: boolean
}

function waitForRendererTask(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Plugin frame was closed"))
  return new Promise<void>((resolve, reject) => {
    const delayId = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, 0)
    const onAbort = () => {
      globalThis.clearTimeout(delayId)
      reject(signal.reason ?? new Error("Plugin frame was closed"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export async function waitForWebPluginCanvasStateWrite<Editor extends WebPluginCanvasStateWriteEditor>(
  input: {
    frame: PluginNodeInvocationRef
    getActiveContext: PluginCanvasHost["getActiveContext"]
    getEditor: () => Editor
    signal: AbortSignal
  },
  waitForRender: (signal: AbortSignal) => Promise<void> = waitForRendererTask,
): Promise<Editor> {
  while (true) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error("Plugin frame was closed")
    const active = input.getActiveContext()
    if (active?.projectId !== input.frame.projectId || active.canvasId !== input.frame.canvasId) {
      throw new Error("Plugin call is no longer in the active Project and Canvas")
    }
    const editor = input.getEditor()
    if (editor.document.id !== input.frame.canvasId) {
      throw new Error("Canvas is not writable in the current scope")
    }
    if (!editor.hydrating) {
      if (editor.readOnly) throw new Error("Canvas is not writable in the current scope")
      return editor
    }
    await waitForRender(input.signal)
  }
}

type WebPluginNodeProps = ComponentProps<CanvasFileRendererDefinition["component"]>

export interface WebPluginCanvasContributionOptions {
  frameRegistry: DesktopPluginFrameRegistry
  host: PluginCanvasHost
  limits?: PluginHostLimits
}

export function updateWebPluginNodeState(
  document: CanvasDocument,
  input: { canvasId: string; nodeId: string; plugin: InstalledWebPluginCanvasSurface },
  state: Record<string, unknown>,
) {
  if (document.id !== input.canvasId) return document
  const node = document.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node || !matchesWebPluginCanvasNode(input.plugin, node.data)) return document
  return updateCanvasNodeData(document, input.nodeId, (data) => ({
    ...data,
    metadata: {
      ...webPluginNodeMetadata(data),
      [webPluginIdentityMetadataKey]: {
        entry: input.plugin.entry,
        id: input.plugin.id,
        version: input.plugin.version,
      },
      [webPluginStateMetadataKey]: state,
    },
  }))
}
export function webPluginEntryUrl(plugin: Pick<InstalledWebPluginCanvasSurface, "entry" | "id">) {
  const id = requireWebPluginId(plugin.id)
  const entry = requireWebPluginRelativePath(plugin.entry, "Plugin entry")
  const url = new URL(`convax-plugin://${id}/`)
  url.pathname = `/${entry.split("/").map(encodeURIComponent).join("/")}`
  return url.href
}

/** Force an installed Plugin upgrade to replace the live opaque-origin frame. */
export function webPluginFrameKey(plugin: Pick<InstalledWebPluginCanvasSurface, "entry" | "id" | "version">) {
  return `${requireWebPluginId(plugin.id)}:${plugin.version}:${requireWebPluginRelativePath(plugin.entry, "Plugin entry")}`
}

function createPluginNode(
  plugin: InstalledWebPluginCanvasSurface,
  input: Parameters<NonNullable<CanvasFileRendererDefinition["create"]>>[0],
): CanvasNode {
  const renderer = plugin.contributes.canvas.renderer
  const inputData = input.data ?? {}
  const inputMetadata = webPluginNodeMetadata(inputData) ?? {}
  return {
    data: {
      ...inputData,
      kind: webPluginCanvasRendererId(plugin.id),
      label: typeof inputData.label === "string" ? inputData.label : plugin.name,
      metadata: {
        ...inputMetadata,
        [webPluginIdentityMetadataKey]: {
          entry: plugin.entry,
          id: plugin.id,
          version: plugin.version,
        },
        [webPluginStateMetadataKey]: {},
      },
    },
    id: input.id ?? createCanvasId("plugin"),
    position: input.position,
    style: {
      height: Math.max(96, renderer.height ?? 420),
      width: Math.max(160, renderer.width ?? 640),
    },
    type: "file",
  }
}

function WebPluginCanvasNode(
  props: WebPluginNodeProps & {
    options: WebPluginCanvasContributionOptions
    plugin: InstalledWebPluginCanvasSurface
  },
) {
  const editor = useCanvasEditor()
  const editorRef = useRef(editor)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pendingConnectCleanupRef = useRef<(() => void) | null>(null)
  const canvasImageWriteGateRef = useRef({ active: false })
  const connectedImageReadGateRef = useRef({ active: false })
  const generationGateRef = useRef({ active: false })
  const nodeStateWriteGateRef = useRef({ active: false })
  const connectedImageFingerprintRef = useRef<string | null>(null)
  const pointerGateRef = useRef(new WebPluginPointerReleaseGate())
  const pointerReleaseFrameRef = useRef<number | null>(null)
  const pointerReleaseListenersRef = useRef<(() => void) | null>(null)
  const [pointerReleasePending, setPointerReleasePending] = useState(false)
  const interactionPending = pointerGateRef.current.pending || pointerReleasePending
  const iframeInteractive = props.selected && !props.dragging && !interactionPending
  const iframeInteraction = webPluginIframeInteractionProps({
    dragging: props.dragging,
    pointerReleasePending: interactionPending,
    selected: props.selected,
  })
  editorRef.current = editor

  const canReadConnectedImages = props.plugin.capabilities.includes("canvas.connectedImages.read")
  const hostProtocol = desktopPluginHostProtocolForManifestSchema(props.plugin.schema)

  useEffect(
    () => () => {
      pendingConnectCleanupRef.current?.()
      cleanupRef.current?.()
    },
    [],
  )
  useEffect(() => {
    const iframe = iframeRef.current
    if (iframeInteractive || !iframe || iframe !== document.activeElement) return
    iframe.blur()
  }, [iframeInteractive])
  useEffect(
    () => () => {
      pointerReleaseListenersRef.current?.()
      const frame = pointerReleaseFrameRef.current
      if (frame !== null) window.cancelAnimationFrame(frame)
    },
    [],
  )

  const finishHostPointerGesture = () => {
    const removeListeners = pointerReleaseListenersRef.current
    pointerReleaseListenersRef.current = null
    removeListeners?.()
    const scheduledFrame = pointerReleaseFrameRef.current
    if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame)
    // The window capture listener runs before React Flow handles pointerup. Keep
    // the iframe inert through the rest of that dispatch and its synthetic click.
    pointerReleaseFrameRef.current = window.requestAnimationFrame(() => {
      pointerReleaseFrameRef.current = null
      if (!pointerGateRef.current.complete()) return
      setPointerReleasePending(false)
    })
  }

  const beginHostPointerGesture = (pointerId: number) => {
    if (!pointerGateRef.current.begin(pointerId)) return
    const iframe = iframeRef.current
    iframe?.blur()
    if (iframe) iframe.style.pointerEvents = "none"
    const scheduledFrame = pointerReleaseFrameRef.current
    if (scheduledFrame !== null) {
      window.cancelAnimationFrame(scheduledFrame)
      pointerReleaseFrameRef.current = null
    }
    setPointerReleasePending(true)
    if (pointerReleaseListenersRef.current) return

    const releasePointer = (event: PointerEvent) => {
      if (!pointerGateRef.current.release(event.pointerId)) return
      finishHostPointerGesture()
    }
    const releaseAllPointers = () => {
      if (!pointerGateRef.current.releaseAll()) return
      finishHostPointerGesture()
    }
    const removeListeners = () => {
      window.removeEventListener("pointerup", releasePointer, true)
      window.removeEventListener("pointercancel", releasePointer, true)
      window.removeEventListener("blur", releaseAllPointers, true)
    }
    window.addEventListener("pointerup", releasePointer, true)
    window.addEventListener("pointercancel", releasePointer, true)
    window.addEventListener("blur", releaseAllPointers, true)
    pointerReleaseListenersRef.current = removeListeners
  }

  useEffect(() => {
    if (!canReadConnectedImages) return () => undefined
    let canceled = false
    const document = editor.document
    void connectedImageFingerprint(document, props.id)
      .then((fingerprint) => {
        if (canceled || connectedImageFingerprintRef.current === fingerprint) return
        connectedImageFingerprintRef.current = fingerprint
        const active = props.options.host.getActiveContext()
        if (!active || active.canvasId !== document.id) return
        const frame = {
          canvasId: active.canvasId,
          nodeId: props.id,
          pluginId: props.plugin.id,
          projectId: active.projectId,
        }
        if (!props.options.frameRegistry.has(frame)) return
        try {
          props.options.frameRegistry.send(frame, {
            command: desktopPluginConnectedImagesChangedCommand,
            protocol: hostProtocol,
            type: "command",
          })
        } catch {
          // The frame may unmount between the digest and this command.
        }
      })
      .catch(() => {
        // Web Crypto is a renderer primitive; initial Plugin listing still fails safe if unavailable.
      })
    return () => {
      canceled = true
    }
  }, [
    canReadConnectedImages,
    editor.document,
    props.id,
    props.options.frameRegistry,
    props.options.host,
    props.plugin.id,
    hostProtocol,
  ])

  const connectFrame = () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    const iframeWindow = iframeRef.current?.contentWindow
    const active = props.options.host.getActiveContext()
    const currentEditor = editorRef.current
    const node = currentEditor.document.nodes.find((candidate) => candidate.id === props.id)
    if (
      !iframeWindow ||
      !active ||
      active.canvasId !== currentEditor.document.id ||
      !node ||
      !matchesWebPluginCanvasNode(props.plugin, node.data)
    )
      return

    const controller = new AbortController()
    const channel = new MessageChannel()
    const connectedImageReadGate = connectedImageReadGateRef.current
    const canvasImageWriteGate = canvasImageWriteGateRef.current
    const generationGate = generationGateRef.current
    const nodeStateWriteGate = nodeStateWriteGateRef.current
    const frame: DesktopPluginFrameRef = {
      canvasId: active.canvasId,
      nodeId: props.id,
      pluginId: props.plugin.id,
      projectId: active.projectId,
    }
    let unregister: () => void = () => undefined
    let capabilityConnection: RendererPluginHostConnection | null = null
    const cleanup = () => {
      if (controller.signal.aborted) return
      controller.abort(new Error("Plugin frame was closed"))
      capabilityConnection?.close()
      channel.port1.onmessage = null
      channel.port1.close()
      unregister()
    }
    try {
      unregister = props.options.frameRegistry.register({
        ...frame,
        send(command) {
          if (controller.signal.aborted) return
          try {
            channel.port1.postMessage(command)
          } catch {
            cleanup()
          }
        },
      })
    } catch {
      controller.abort(new Error("Plugin frame registration failed"))
      channel.port1.close()
      channel.port2.close()
      return
    }
    if (props.plugin.schema === webPluginManifestSchemaV5) {
      capabilityConnection = new RendererPluginHostConnection(
        window.convax.pluginCapabilities,
        {
          pluginId: props.plugin.id,
          pluginVersion: props.plugin.version,
          projectId: active.projectId,
          runtime: "web",
        },
        (command) => {
          if (controller.signal.aborted) return
          try {
            channel.port1.postMessage(command)
          } catch {
            cleanup()
          }
        },
      )
    }
    cleanupRef.current = cleanup
    channel.port1.onmessage = (event) => {
      const response =
        capabilityConnection && isProjectCanvasCapabilityRequest(event.data)
          ? capabilityConnection.dispatch(event.data)
          : dispatchPluginHostRequest(event.data, {
              canvasImageWriteGate,
              connectedImageReadGate,
              createCanvasImage: (input) => props.options.host.createCanvasImage(input),
              executeCanvasGeneration: (input) => props.options.host.executeCanvasGeneration(input),
              frame,
              generationGate,
              nodeStateWriteGate,
              getActiveContext: () => props.options.host.getActiveContext(),
              getConnectedImageNodes: () => {
                const latest = editorRef.current
                if (latest.document.id !== frame.canvasId) return []
                return getIncomingConnectedImageNodes(latest.document, frame.nodeId)
              },
              getNode: () => {
                const latest = editorRef.current
                if (latest.document.id !== frame.canvasId) return undefined
                return latest.document.nodes.find((candidate) => candidate.id === frame.nodeId)
              },
              getDocument: () => {
                const latest = editorRef.current
                return latest.document.id === frame.canvasId ? latest.document : undefined
              },
              isCanvasWritable: () => {
                const latest = editorRef.current
                return !latest.readOnly && latest.document.id === frame.canvasId
              },
              limits: props.options.limits,
              listGenerationTools: (input) => props.options.host.listGenerationTools(input),
              ownsNode: (candidate) => matchesWebPluginCanvasNode(props.plugin, candidate.data),
              plugin: props.plugin,
              promptAgent: (input) => props.options.host.promptAgent(input),
              readManagedProjectImage: (input) => props.options.host.readManagedProjectImage(input),
              readProjectText: (input) => props.options.host.readProjectText(input),
              signal: controller.signal,
              updateNodeState: async (state) => {
                await props.options.host.waitForGenerationProjection({ ...frame, signal: controller.signal })
                const latest = await waitForWebPluginCanvasStateWrite({
                  frame,
                  getActiveContext: () => props.options.host.getActiveContext(),
                  getEditor: () => editorRef.current,
                  signal: controller.signal,
                })
                const latestNode = latest.document.nodes.find((candidate) => candidate.id === frame.nodeId)
                if (!latestNode || !matchesWebPluginCanvasNode(props.plugin, latestNode.data)) {
                  throw new Error("Plugin frame no longer owns this Canvas node")
                }
                latest.commit((document) =>
                  updateWebPluginNodeState(
                    document,
                    {
                      canvasId: frame.canvasId,
                      nodeId: frame.nodeId,
                      plugin: props.plugin,
                    },
                    state,
                  ),
                )
              },
            })
      void response.then((response) => {
        if (!response || controller.signal.aborted) return
        try {
          channel.port1.postMessage(response)
        } catch {
          cleanup()
        }
      })
    }
    channel.port1.start()
    const connect = {
      pluginId: props.plugin.id,
      protocol: hostProtocol,
      type: "connect",
    } satisfies DesktopPluginHostConnect
    // Sandboxed frames have an opaque origin; the transferred port is the scoped capability token.
    try {
      iframeWindow.postMessage(connect, "*", [channel.port2])
    } catch {
      cleanup()
    }
  }

  const scheduleConnectFrame = () => {
    pendingConnectCleanupRef.current?.()
    pendingConnectCleanupRef.current = null
    cleanupRef.current?.()
    cleanupRef.current = null
    pendingConnectCleanupRef.current = scheduleWebPluginFrameConnect(() => {
      pendingConnectCleanupRef.current = null
      connectFrame()
    })
  }

  const contributedToolbar = props.plugin.contributes.canvas.toolbar?.length ? (
    <>
      <WebPluginCanvasToolbarButtons {...props} />
      <CanvasNodeToolbarDivider />
    </>
  ) : null
  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      {contributedToolbar}
      <CanvasNodeToolbarButton icon={<Copy />} label="Duplicate" onClick={() => editor.duplicateNode(props.id)} />
      <CanvasNodeToolbarButton
        destructive
        icon={<Trash2 />}
        label="Delete"
        onClick={() => editor.removeNode(props.id)}
      />
    </div>
  )
  return (
    <div className="size-full" onPointerDownCapture={(event) => beginHostPointerGesture(event.pointerId)}>
      <CanvasNodeChrome icon={<Puzzle />} label={props.plugin.name} node={props} toolbar={toolbar}>
        <div className="relative size-full">
          <iframe
            allow={webPluginIframeAllow(props.plugin)}
            {...iframeInteraction}
            key={webPluginFrameKey(props.plugin)}
            onLoad={scheduleConnectFrame}
            ref={iframeRef}
            referrerPolicy="no-referrer"
            sandbox={webPluginIframeSandbox}
            src={webPluginEntryUrl(props.plugin)}
            title={`${props.plugin.name} plugin`}
          />
          {props.dragging ? <WebPluginDragShield /> : null}
        </div>
      </CanvasNodeChrome>
    </div>
  )
}

function WebPluginCanvasToolbarButtons(
  props: WebPluginNodeProps & {
    options: WebPluginCanvasContributionOptions
    plugin: InstalledWebPluginCanvasSurface
  },
) {
  const editor = useCanvasEditor()
  const hostProtocol = desktopPluginHostProtocolForManifestSchema(props.plugin.schema)
  useSyncExternalStore(
    props.options.frameRegistry.subscribe,
    props.options.frameRegistry.getVersion,
    props.options.frameRegistry.getVersion,
  )
  const active = props.options.host.getActiveContext()
  const frame =
    active && active.canvasId === editor.document.id
      ? {
          canvasId: active.canvasId,
          nodeId: props.id,
          pluginId: props.plugin.id,
          projectId: active.projectId,
        }
      : null
  const mounted = Boolean(frame && props.options.frameRegistry.has(frame))
  return (
    <>
      {props.plugin.contributes.canvas.toolbar?.map((item) => (
        <CanvasNodeToolbarButton
          disabled={!mounted}
          icon={item.icon === "play" ? <Play /> : undefined}
          key={item.id}
          label={item.title}
          onClick={() => {
            const current = props.options.host.getActiveContext()
            if (!current || current.canvasId !== editor.document.id) return
            const currentFrame = {
              canvasId: current.canvasId,
              nodeId: props.id,
              pluginId: props.plugin.id,
              projectId: current.projectId,
            }
            try {
              props.options.frameRegistry.send(currentFrame, {
                command: item.command,
                protocol: hostProtocol,
                type: "command",
              })
            } catch {
              // A failed sandbox command must not break the Canvas toolbar.
            }
          }}
          visibleLabel={item.icon === undefined}
        />
      ))}
    </>
  )
}

export function createWebPluginCanvasContribution(
  plugin: InstalledWebPluginCanvasSurface,
  options: WebPluginCanvasContributionOptions,
): CanvasFileRendererPlugin {
  const renderer = plugin.contributes.canvas.renderer
  const Component = (props: WebPluginNodeProps) => <WebPluginCanvasNode {...props} options={options} plugin={plugin} />
  return {
    id: `desktop.${plugin.id}`,
    renderers: [
      {
        component: Component,
        ...(renderer.create ? { create: (input) => createPluginNode(plugin, input) } : {}),
        id: webPluginCanvasRendererId(plugin.id),
        label: plugin.name,
        matches: (data) => matchesWebPluginCanvasNode(plugin, data),
        priority: 1_000,
      },
    ],
  }
}
