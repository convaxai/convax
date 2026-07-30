import {
  CanvasNodeChrome,
  CanvasNodeToolbarButton,
  CanvasNodeToolbarDivider,
  useCanvasEditor,
  type CanvasFileRendererDefinition,
  type CanvasFileRendererPlugin,
} from "@convax/canvas"
import type { PortablePluginUiToolbarItem } from "@convax/plugin-sdk"
import { Copy, Puzzle, Trash2 } from "lucide-react"
import { type ComponentProps, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  requireWebPluginId,
  requireWebPluginRelativePath,
  type ActiveInstalledWebPluginCanvasSurface,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import { webPluginAssetUrl } from "../plugin-asset-contract"
import {
  matchesWebPluginCanvasNode,
  createWebPluginCanvasNode,
  webPluginCanvasRendererId,
  webPluginIdentityMetadataKey,
  webPluginStateMetadataKey,
} from "../plugin-canvas-node"
import { desktopPluginHostProtocolV8, type DesktopPluginHostConnect } from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry, type DesktopPluginFrameRef } from "./plugin-frame-registry"
import { RendererPluginHostConnection } from "./plugin-host-connection"
import { HostPointerReleaseGate } from "./host-pointer-gesture"
import type { AppLocale } from "./app-language"
import { DesktopPluginNodeCommandRegistry } from "./plugin-node-command-registry"
import { PluginNodeCommandSurfaces } from "./plugin-node-command-surfaces"

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
export { HostPointerReleaseGate as WebPluginPointerReleaseGate } from "./host-pointer-gesture"

const webPluginIframeBaseClassName = "size-full border-0 bg-background"

/** Keep embedded Plugin input behind selection and the pointer gesture that selected it. */
export function webPluginIframeInteractionProps(input: {
  dragging?: boolean
  pointerReleasePending?: boolean
  selected: boolean
}) {
  const interactive = input.selected && !input.dragging && !input.pointerReleasePending
  return {
    "data-web-plugin-iframe": "",
    className: interactive ? `nodrag nowheel ${webPluginIframeBaseClassName}` : webPluginIframeBaseClassName,
    style: {
      pointerEvents: interactive ? "auto" : "none",
      visibility: "visible",
    } as const,
    tabIndex: interactive ? 0 : -1,
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

type WebPluginNodeProps = ComponentProps<CanvasFileRendererDefinition["component"]>

export interface WebPluginCanvasContributionOptions {
  frameRegistry: DesktopPluginFrameRegistry
  getActiveProjectId(): string | null
  locale: AppLocale
}
export function webPluginEntryUrl(
  plugin: Pick<
    ActiveInstalledWebPluginCanvasSurface,
    "activeRevision" | "activeSetDigest" | "entry" | "id" | "snapshotDigest" | "version"
  >,
) {
  requireWebPluginId(plugin.id)
  const entry = requireWebPluginRelativePath(plugin.entry, "Plugin entry")
  return webPluginAssetUrl(plugin, entry)
}

/** Force every exact ActiveSet/snapshot transition to replace the live frame. */
export function webPluginFrameKey(
  plugin: Pick<
    ActiveInstalledWebPluginCanvasSurface,
    "activeRevision" | "activeSetDigest" | "entry" | "id" | "snapshotDigest" | "version"
  >,
) {
  return JSON.stringify([
    requireWebPluginId(plugin.id),
    plugin.version,
    plugin.activeRevision,
    plugin.activeSetDigest,
    plugin.snapshotDigest,
    requireWebPluginRelativePath(plugin.entry, "Plugin entry"),
  ])
}

function WebPluginCanvasNode(
  props: WebPluginNodeProps & {
    options: WebPluginCanvasContributionOptions
    plugin: ActiveInstalledWebPluginCanvasSurface
  },
) {
  const editor = useCanvasEditor()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pendingConnectCleanupRef = useRef<(() => void) | null>(null)
  const pointerGateRef = useRef(new HostPointerReleaseGate())
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

  const connectFrame = () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    const iframeWindow = iframeRef.current?.contentWindow
    const projectId = props.options.getActiveProjectId()
    if (!iframeWindow || !projectId) return

    const controller = new AbortController()
    const channel = new MessageChannel()
    const frame: DesktopPluginFrameRef = {
      activeRevision: props.plugin.activeRevision,
      activeSetDigest: props.plugin.activeSetDigest,
      canvasId: editor.document.id,
      nodeId: props.id,
      pluginId: props.plugin.id,
      pluginVersion: props.plugin.version,
      projectId,
      snapshotDigest: props.plugin.snapshotDigest,
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
    capabilityConnection = new RendererPluginHostConnection(
      window.convax.pluginCapabilities,
      {
        activeRevision: props.plugin.activeRevision,
        activeSetDigest: props.plugin.activeSetDigest,
        canvasId: frame.canvasId,
        nodeId: frame.nodeId,
        pluginId: props.plugin.id,
        pluginVersion: props.plugin.version,
        projectId,
        runtime: "web",
        snapshotDigest: props.plugin.snapshotDigest,
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
    cleanupRef.current = cleanup
    channel.port1.onmessage = (event) => {
      const response = capabilityConnection?.dispatch(event.data, controller.signal) ?? Promise.resolve(null)
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
      protocol: desktopPluginHostProtocolV8,
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

  const hasCommandPlacements = Boolean(
    props.plugin.contributes.canvas.menus?.length || props.plugin.contributes.canvas.toolbar?.length,
  )
  const contributedToolbar = hasCommandPlacements ? (
    <>
      <WebPluginCanvasCommandSurfaces {...props} />
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

function WebPluginCanvasCommandSurfaces(
  props: WebPluginNodeProps & {
    options: WebPluginCanvasContributionOptions
    plugin: ActiveInstalledWebPluginCanvasSurface
  },
) {
  const editor = useCanvasEditor()
  useSyncExternalStore(
    props.options.frameRegistry.subscribe,
    props.options.frameRegistry.getVersion,
    props.options.frameRegistry.getVersion,
  )
  const commandContribution = useMemo(() => {
    const toolbar = props.plugin.contributes.canvas.toolbar ?? []
    if (toolbar.some((item) => "title" in item)) {
      throw new Error("convax.plugin/8 Canvas toolbar must reference canonical UI commands")
    }
    return {
      commands: props.plugin.contributes.canvas.commands ?? [],
      menus: props.plugin.contributes.canvas.menus ?? [],
      toolbar: toolbar as readonly PortablePluginUiToolbarItem[],
    }
  }, [props.plugin])
  const commandRegistry = useMemo(
    () => new DesktopPluginNodeCommandRegistry(props.plugin.id, commandContribution, props.options.frameRegistry),
    [commandContribution, props.options.frameRegistry, props.plugin.id],
  )
  const activeProjectId = props.options.getActiveProjectId()
  const frame = activeProjectId
    ? {
        activeRevision: props.plugin.activeRevision,
        activeSetDigest: props.plugin.activeSetDigest,
        canvasId: editor.document.id,
        nodeId: props.id,
        pluginId: props.plugin.id,
        pluginVersion: props.plugin.version,
        projectId: activeProjectId,
        snapshotDigest: props.plugin.snapshotDigest,
      }
    : null
  const projection = commandRegistry.project(frame, props.options.locale)
  return (
    <PluginNodeCommandSurfaces
      canExecute={() => {
        if (!frame) return false
        return props.options.getActiveProjectId() === frame.projectId && editor.document.id === frame.canvasId
      }}
      moreLabel={props.options.locale === "zh-CN" ? "更多插件操作" : "More Plugin actions"}
      projection={projection}
      registry={commandRegistry}
    />
  )
}

export function createWebPluginCanvasContribution(
  plugin: ActiveInstalledWebPluginCanvasSurface,
  options: WebPluginCanvasContributionOptions,
): CanvasFileRendererPlugin {
  const renderer = plugin.contributes.canvas.renderer
  const Component = (props: WebPluginNodeProps) => <WebPluginCanvasNode {...props} options={options} plugin={plugin} />
  return {
    id: `desktop.${plugin.id}`,
    renderers: [
      {
        component: Component,
        ...(renderer.create ? { create: (input) => createWebPluginCanvasNode(plugin, input) } : {}),
        id: webPluginCanvasRendererId(plugin.id),
        label: plugin.name,
        matches: (data) => matchesWebPluginCanvasNode(plugin, data),
        priority: 1_000,
      },
    ],
  }
}
