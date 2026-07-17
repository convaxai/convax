import {
  CanvasNodeChrome,
  CanvasNodeToolbarButton,
  createCanvasId,
  getIncomingConnectedCanvasFileNodeIds,
  updateCanvasNodeData,
  useCanvasEditor,
  type CanvasDocument,
  type CanvasFileRendererDefinition,
  type CanvasFileRendererPlugin,
  type CanvasNode,
  type CanvasNodeData,
} from "@convax/canvas"
import { getProjectFileReference, isManagedProjectAssetPath } from "@convax/project/canvas"
import { Copy, Play, Puzzle, Trash2 } from "lucide-react"
import { type ComponentProps, useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  requireWebPluginId,
  requireWebPluginRelativePath,
  type InstalledWebPluginSummary,
  type WebPluginCapability,
} from "../plugin-contracts"
import {
  desktopPluginHostProtocol,
  desktopPluginConnectedImagesChangedCommand,
  isDesktopPluginHostRequest,
  pluginHostFailure,
  pluginHostSuccess,
  type DesktopPluginHostConnect,
  type DesktopPluginHostRequest,
  type DesktopPluginHostResponse,
} from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry, type DesktopPluginFrameRef } from "./plugin-frame-registry"

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
export const webPluginStateMetadataKey = "convaxPluginState" as const
export const webPluginIdentityMetadataKey = "convaxPlugin" as const

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

const defaultRequestBytes = 256 * 1024
const defaultResponseBytes = 1024 * 1024
const defaultConnectedImageResponseBytes = 24 * 1024 * 1024
const defaultStateBytes = 256 * 1024
const maximumConnectedImageBytes = 16 * 1024 * 1024
const maximumPromptLength = 20_000
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
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

export interface WebPluginCanvasActiveContext {
  canvasId: string
  canvasName?: string
  projectId: string
  projectName?: string
}

export interface WebPluginProjectTextResult {
  content: string
  exists: boolean
  path: string
}

export interface WebPluginProjectFileResult {
  dataUrl: string
  mimeType: string
  name: string
  path: string
  size: number
}

export interface WebPluginAgentPromptResult {
  text: string
}

/** Narrow product ports supplied by the Desktop App; the plugin host owns no globals. */
export interface WebPluginCanvasHost {
  getActiveContext(): WebPluginCanvasActiveContext | null
  promptAgent(
    input: DesktopPluginFrameRef & {
      pluginName: string
      signal: AbortSignal
      text: string
    },
  ): Promise<WebPluginAgentPromptResult>
  readProjectText(input: { path: string; projectId: string; signal: AbortSignal }): Promise<WebPluginProjectTextResult>
  readManagedProjectImage(input: {
    path: string
    projectId: string
    signal: AbortSignal
  }): Promise<WebPluginProjectFileResult>
}

export interface WebPluginCanvasHostLimits {
  connectedImageResponseBytes?: number
  requestBytes?: number
  responseBytes?: number
  stateBytes?: number
}

export interface WebPluginCanvasContributionOptions {
  frameRegistry: DesktopPluginFrameRegistry
  host: WebPluginCanvasHost
  limits?: WebPluginCanvasHostLimits
}

export interface WebPluginHostRequestContext {
  connectedImageReadGate: { active: boolean }
  frame: DesktopPluginFrameRef
  getActiveContext(): WebPluginCanvasActiveContext | null
  getConnectedImageNodes(): CanvasNode[]
  getNode(): CanvasNode | undefined
  limits?: WebPluginCanvasHostLimits
  plugin: InstalledWebPluginSummary
  promptAgent(
    input: DesktopPluginFrameRef & {
      pluginName: string
      signal: AbortSignal
      text: string
    },
  ): Promise<WebPluginAgentPromptResult>
  readProjectText(input: { path: string; projectId: string; signal: AbortSignal }): Promise<WebPluginProjectTextResult>
  readManagedProjectImage(input: {
    path: string
    projectId: string
    signal: AbortSignal
  }): Promise<WebPluginProjectFileResult>
  signal: AbortSignal
  updateNodeState(state: Record<string, unknown>): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const allowed = new Set(keys)
  const unsupported = Object.keys(value).find((key) => !allowed.has(key))
  if (unsupported) throw new Error(`${label} contains an unsupported field: ${unsupported}`)
  return value
}

function requireEmptyParams(value: unknown) {
  if (value === undefined) return
  const params = exactRecord(value, [], "Plugin request params")
  if (Object.keys(params).length) throw new Error("Plugin request params must be empty")
}

function serializedBytes(value: unknown, label: string) {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must be JSON-serializable`)
  }
  if (serialized === undefined) throw new Error(`${label} must be JSON-serializable`)
  return new TextEncoder().encode(serialized).byteLength
}

function requireLimit(value: number | undefined, fallback: number, label: string) {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`${label} must be a positive integer`)
  return limit
}

function assertMessageSize(value: unknown, maximum: number, label: string) {
  if (serializedBytes(value, label) > maximum) throw new Error(`${label} exceeds ${maximum} bytes`)
}

function validateJsonValue(value: unknown, depth = 0, stack = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Plugin state numbers must be finite")
    return
  }
  if (typeof value !== "object") throw new Error("Plugin state must contain only JSON values")
  if (depth >= 32) throw new Error("Plugin state is nested too deeply")
  if (stack.has(value)) throw new Error("Plugin state must not contain cycles")
  stack.add(value)
  if (Array.isArray(value)) {
    value.forEach((item) => validateJsonValue(item, depth + 1, stack))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Plugin state must contain only plain objects")
    }
    Object.values(value).forEach((item) => validateJsonValue(item, depth + 1, stack))
  }
  stack.delete(value)
}

function requirePluginState(value: unknown, maximumBytes: number) {
  if (!isRecord(value)) throw new Error("Plugin state must be an object")
  validateJsonValue(value)
  assertMessageSize(value, maximumBytes, "Plugin state")
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function requireProjectRelativePath(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 1_024 || value !== value.trim()) {
    throw new Error("Project file path must be a non-empty relative path")
  }
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    throw new Error("Project file path must use portable POSIX separators")
  }
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Project file path must not contain traversal")
  }
  if (
    segments.some((segment) => {
      const stem = segment.split(".")[0] ?? ""
      return /[:*?"<>|\u0000-\u001f\u007f]/.test(segment) || /[. ]$/.test(segment) || windowsReservedName.test(stem)
    })
  ) {
    throw new Error("Project file path contains a non-portable Windows segment")
  }
  if (segments.some((segment) => segment.replace(/[. ]+$/g, "").toLowerCase() === ".convax")) {
    throw new Error("Project private storage is not available to plugins")
  }
  return value
}

function requirePromptText(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > maximumPromptLength) {
    throw new Error(`Agent prompt must contain between 1 and ${maximumPromptLength} characters`)
  }
  return value
}

const connectedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])

type ConnectedImageSource = { kind: "embedded"; dataUrl: string; mimeType: string } | { kind: "project"; path: string }

function requireConnectedImageNodeId(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Connected image node id is invalid")
  }
  return value
}

function connectedImageSource(node: CanvasNode): ConnectedImageSource | null {
  const data = node.data
  const reference = getProjectFileReference(metadataOf(data))
  if (reference && isManagedProjectAssetPath(reference.path)) {
    return { kind: "project", path: reference.path }
  }
  if (typeof data.url !== "string") return null
  const match = /^data:([^;,]+);base64,/i.exec(data.url)
  const mimeType = match?.[1]?.toLowerCase()
  if (!mimeType || !connectedImageMimeTypes.has(mimeType)) return null
  if (typeof data.mimeType === "string" && data.mimeType.toLowerCase() !== mimeType) return null
  return { dataUrl: data.url, kind: "embedded", mimeType }
}

function sameConnectedImageSource(left: ConnectedImageSource | null, right: ConnectedImageSource) {
  if (!left || left.kind !== right.kind) return false
  if (left.kind === "project" && right.kind === "project") return left.path === right.path
  return (
    left.kind === "embedded" &&
    right.kind === "embedded" &&
    left.mimeType === right.mimeType &&
    left.dataUrl === right.dataUrl
  )
}

function connectedImageDescriptor(node: CanvasNode) {
  const data = node.data
  const source = connectedImageSource(node)
  const declaredMimeType = typeof data.mimeType === "string" ? data.mimeType.toLowerCase() : undefined
  return {
    height: typeof data.height === "number" ? data.height : undefined,
    id: node.id,
    mimeType: typeof data.mimeType === "string" ? data.mimeType : undefined,
    name: typeof data.name === "string" ? data.name : data.label,
    readable: Boolean(source && (!declaredMimeType || connectedImageMimeTypes.has(declaredMimeType))),
    width: typeof data.width === "number" ? data.width : undefined,
  }
}

const connectedImageDataFingerprintCache = new WeakMap<
  object,
  {
    fingerprint: Promise<string>
    metadata: string
    source: string
  }
>()

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function connectedImageDataFingerprint(data: CanvasNodeData) {
  const source = typeof data.url === "string" ? data.url : ""
  const metadata = JSON.stringify([
    data.name,
    data.mimeType,
    data.width,
    data.height,
    getProjectFileReference(metadataOf(data))?.path,
  ])
  const cached = connectedImageDataFingerprintCache.get(data)
  if (cached && cached.source === source && cached.metadata === metadata) return cached.fingerprint
  const fingerprint = sha256(`${metadata}\u0000${source}`)
  connectedImageDataFingerprintCache.set(data, { fingerprint, metadata, source })
  return fingerprint
}

async function connectedImageFingerprint(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const parts = await Promise.all(
    getIncomingConnectedCanvasFileNodeIds(document, ownerNodeId).map(async (id) => {
      const node = nodes.get(id)
      if (!node || node.data.kind !== "image") return null
      return [id, await connectedImageDataFingerprint(node.data)]
    }),
  )
  return sha256(JSON.stringify(parts.filter(Boolean)))
}

function requireCurrentConnectedImage(
  context: WebPluginHostRequestContext,
  nodeId: string,
  expectedSource: ConnectedImageSource,
) {
  assertCurrentFrame(context)
  const node = context.getConnectedImageNodes().find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error("Canvas image is no longer connected to this Plugin node")
  if (!sameConnectedImageSource(connectedImageSource(node), expectedSource)) {
    throw new Error("Canvas image source changed while the Plugin was reading it")
  }
  return node
}

function requireConnectedImageInfo(mimeType: unknown, size?: number) {
  if (typeof mimeType !== "string" || !connectedImageMimeTypes.has(mimeType.toLowerCase())) {
    throw new Error("Connected Canvas node is not a supported browser image")
  }
  if (typeof size === "number" && (!Number.isSafeInteger(size) || size < 0 || size > maximumConnectedImageBytes)) {
    throw new Error(`Connected image exceeds the ${maximumConnectedImageBytes / 1024 / 1024} MB Plugin limit`)
  }
  return mimeType.toLowerCase()
}

function requireConnectedImageDataUrl(value: unknown, mimeType: unknown, size?: number) {
  const normalizedMimeType = requireConnectedImageInfo(mimeType, size)
  if (typeof value !== "string") throw new Error("Connected image data is invalid")
  const prefix = `data:${normalizedMimeType};base64,`
  if (value.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("Connected image data is not a supported base64 image")
  }
  const encoded = value.slice(prefix.length)
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Connected image data is not canonical base64")
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  const decodedBytes = (encoded.length / 4) * 3 - padding
  if (decodedBytes > maximumConnectedImageBytes) {
    throw new Error(`Connected image exceeds the ${maximumConnectedImageBytes / 1024 / 1024} MB Plugin limit`)
  }
  if (typeof size === "number" && decodedBytes !== size) {
    throw new Error("Connected image data does not match its declared size")
  }
  return value
}

function requireCapability(plugin: InstalledWebPluginSummary, capability: WebPluginCapability) {
  if (!plugin.capabilities.includes(capability)) throw new Error(`Plugin capability is not granted: ${capability}`)
}

export function webPluginCanvasRendererId(pluginId: string) {
  return `plugin.${requireWebPluginId(pluginId)}`
}

function metadataOf(data: CanvasNodeData) {
  return isRecord(data.metadata) ? data.metadata : undefined
}

export function matchesWebPluginCanvasNode(plugin: InstalledWebPluginSummary, data: CanvasNodeData) {
  const renderer = plugin.contributes.canvas.renderer
  const rendererId = webPluginCanvasRendererId(plugin.id)
  if (data.kind === rendererId) return true
  const metadata = metadataOf(data)
  const identity = metadata?.[webPluginIdentityMetadataKey]
  if (isRecord(identity) && identity.id === plugin.id) return true
  if (renderer.nodeKinds?.includes(data.kind)) return true
  const mimeType = typeof data.mimeType === "string" ? data.mimeType.toLowerCase() : undefined
  if (mimeType && renderer.mimeTypes?.includes(mimeType)) return true
  const projectPath = getProjectFileReference(metadata)?.path
  const names = [data.name, data.path, data.label, projectPath].filter(
    (value): value is string => typeof value === "string",
  )
  return Boolean(renderer.extensions?.some((extension) => names.some((name) => name.toLowerCase().endsWith(extension))))
}

function pluginNodeSnapshot(node: CanvasNode) {
  return structuredClone({
    data: node.data,
    id: node.id,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
    position: node.position,
    style: node.style,
    type: node.type ?? "file",
  })
}

export function updateWebPluginNodeState(
  document: CanvasDocument,
  input: { canvasId: string; nodeId: string; plugin: InstalledWebPluginSummary },
  state: Record<string, unknown>,
) {
  if (document.id !== input.canvasId) return document
  const node = document.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node || !matchesWebPluginCanvasNode(input.plugin, node.data)) return document
  return updateCanvasNodeData(document, input.nodeId, (data) => ({
    ...data,
    metadata: {
      ...metadataOf(data),
      [webPluginIdentityMetadataKey]: {
        entry: input.plugin.entry,
        id: input.plugin.id,
        version: input.plugin.version,
      },
      [webPluginStateMetadataKey]: state,
    },
  }))
}

function assertCurrentFrame(context: WebPluginHostRequestContext) {
  if (context.signal.aborted) throw context.signal.reason ?? new Error("Plugin frame was closed")
  const active = context.getActiveContext()
  if (!active || active.projectId !== context.frame.projectId || active.canvasId !== context.frame.canvasId) {
    throw new Error("Plugin frame is no longer in the active Project and Canvas")
  }
  const node = context.getNode()
  if (!node || node.id !== context.frame.nodeId || !matchesWebPluginCanvasNode(context.plugin, node.data)) {
    throw new Error("Plugin frame no longer owns this Canvas node")
  }
  return { active, node }
}

async function executeHostRequest(request: DesktopPluginHostRequest, context: WebPluginHostRequestContext) {
  const current = assertCurrentFrame(context)
  if (request.method === "host.context.get") {
    requireEmptyParams(request.params)
    return {
      canvas: {
        id: current.active.canvasId,
        ...(current.active.canvasName ? { name: current.active.canvasName } : {}),
      },
      node: pluginNodeSnapshot(current.node),
      plugin: { id: context.plugin.id, name: context.plugin.name, version: context.plugin.version },
      project: {
        id: current.active.projectId,
        ...(current.active.projectName ? { name: current.active.projectName } : {}),
      },
    }
  }
  if (request.method === "canvas.connectedImages.list") {
    requireEmptyParams(request.params)
    requireCapability(context.plugin, "canvas.connectedImages.read")
    return { images: context.getConnectedImageNodes().map(connectedImageDescriptor) }
  }
  if (request.method === "canvas.connectedImage.read") {
    requireCapability(context.plugin, "canvas.connectedImages.read")
    if (context.connectedImageReadGate.active) {
      throw new Error("A connected image read is already in progress for this Plugin frame")
    }
    context.connectedImageReadGate.active = true
    try {
      const params = exactRecord(request.params, ["nodeId"], "Connected image request")
      const nodeId = requireConnectedImageNodeId(params.nodeId)
      const node = context.getConnectedImageNodes().find((candidate) => candidate.id === nodeId)
      if (!node) throw new Error("Canvas image is not directly connected to this Plugin node")
      const source = connectedImageSource(node)
      if (!source) {
        throw new Error("Canvas image is not backed by a readable managed Project asset or embedded image")
      }
      if (typeof node.data.mimeType === "string") requireConnectedImageInfo(node.data.mimeType)
      if (source.kind === "embedded") {
        return {
          ...connectedImageDescriptor(node),
          dataUrl: requireConnectedImageDataUrl(source.dataUrl, source.mimeType),
        }
      }
      const result = await context.readManagedProjectImage({
        path: source.path,
        projectId: context.frame.projectId,
        signal: context.signal,
      })
      const latestNode = requireCurrentConnectedImage(context, nodeId, source)
      if (result.path !== source.path || typeof result.name !== "string") {
        throw new Error("Project file provider returned an invalid connected image")
      }
      return {
        ...connectedImageDescriptor(latestNode),
        dataUrl: requireConnectedImageDataUrl(result.dataUrl, result.mimeType, result.size),
        mimeType: result.mimeType,
        name: result.name,
        size: result.size,
      }
    } finally {
      context.connectedImageReadGate.active = false
    }
  }
  if (request.method === "canvas.node.get") {
    requireEmptyParams(request.params)
    requireCapability(context.plugin, "canvas.node.read")
    return pluginNodeSnapshot(current.node)
  }
  if (request.method === "canvas.node.updateState") {
    requireCapability(context.plugin, "canvas.node.write")
    const params = exactRecord(request.params, ["state"], "Canvas node state request")
    if (!("state" in params)) throw new Error("Canvas node state request is missing state")
    const state = requirePluginState(
      params.state,
      requireLimit(context.limits?.stateBytes, defaultStateBytes, "Plugin state byte limit"),
    )
    context.updateNodeState(state)
    assertCurrentFrame(context)
    return { updated: true }
  }
  if (request.method === "project.file.readText") {
    requireCapability(context.plugin, "project.files.read")
    const params = exactRecord(request.params, ["path"], "Project text request")
    const result = await context.readProjectText({
      path: requireProjectRelativePath(params.path),
      projectId: context.frame.projectId,
      signal: context.signal,
    })
    assertCurrentFrame(context)
    if (typeof result.content !== "string" || typeof result.exists !== "boolean" || typeof result.path !== "string") {
      throw new Error("Project text provider returned an invalid result")
    }
    return result
  }
  requireCapability(context.plugin, "agent.prompt")
  const params = exactRecord(request.params, ["text"], "Agent prompt request")
  const result = await context.promptAgent({
    ...context.frame,
    pluginName: context.plugin.name,
    signal: context.signal,
    text: requirePromptText(params.text),
  })
  assertCurrentFrame(context)
  if (!result || typeof result.text !== "string") throw new Error("Agent prompt provider returned an invalid result")
  return result
}

function requestId(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 128) return null
  return value.id
}

/** Validate and execute one port message. Messages without a safe id are ignored. */
export async function dispatchWebPluginHostRequest(
  value: unknown,
  context: WebPluginHostRequestContext,
): Promise<DesktopPluginHostResponse | null> {
  const id = requestId(value)
  if (!id) return null
  try {
    assertMessageSize(
      value,
      requireLimit(context.limits?.requestBytes, defaultRequestBytes, "Plugin request byte limit"),
      "Plugin request",
    )
    exactRecord(value, ["id", "method", "params", "protocol", "type"], "Plugin host request")
    if (!isDesktopPluginHostRequest(value)) throw new Error("Invalid plugin host request")
    const result = await executeHostRequest(value, context)
    const response = pluginHostSuccess(id, result)
    assertMessageSize(
      response,
      value.method === "canvas.connectedImage.read"
        ? requireLimit(
            context.limits?.connectedImageResponseBytes,
            defaultConnectedImageResponseBytes,
            "Plugin connected image response byte limit",
          )
        : requireLimit(context.limits?.responseBytes, defaultResponseBytes, "Plugin response byte limit"),
      "Plugin response",
    )
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 512) : "Plugin host request failed"
    return pluginHostFailure(id, message)
  }
}

export function webPluginEntryUrl(plugin: Pick<InstalledWebPluginSummary, "entry" | "id">) {
  const id = requireWebPluginId(plugin.id)
  const entry = requireWebPluginRelativePath(plugin.entry, "Plugin entry")
  const url = new URL(`convax-plugin://${id}/`)
  url.pathname = `/${entry.split("/").map(encodeURIComponent).join("/")}`
  return url.href
}

/** Force an installed Plugin upgrade to replace the live opaque-origin frame. */
export function webPluginFrameKey(plugin: Pick<InstalledWebPluginSummary, "entry" | "id" | "version">) {
  return `${requireWebPluginId(plugin.id)}:${plugin.version}:${requireWebPluginRelativePath(plugin.entry, "Plugin entry")}`
}

function createPluginNode(
  plugin: InstalledWebPluginSummary,
  input: Parameters<NonNullable<CanvasFileRendererDefinition["create"]>>[0],
): CanvasNode {
  const renderer = plugin.contributes.canvas.renderer
  const inputData = input.data ?? {}
  const inputMetadata = isRecord(inputData.metadata) ? inputData.metadata : {}
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
    plugin: InstalledWebPluginSummary
  },
) {
  const editor = useCanvasEditor()
  const editorRef = useRef(editor)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pendingConnectCleanupRef = useRef<(() => void) | null>(null)
  const connectedImageReadGateRef = useRef({ active: false })
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
    if (!canReadConnectedImages) return
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
            protocol: desktopPluginHostProtocol,
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
    const frame: DesktopPluginFrameRef = {
      canvasId: active.canvasId,
      nodeId: props.id,
      pluginId: props.plugin.id,
      projectId: active.projectId,
    }
    let unregister: () => void = () => undefined
    const cleanup = () => {
      if (controller.signal.aborted) return
      controller.abort(new Error("Plugin frame was closed"))
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
    cleanupRef.current = cleanup
    channel.port1.onmessage = (event) => {
      void dispatchWebPluginHostRequest(event.data, {
        connectedImageReadGate,
        frame,
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
        limits: props.options.limits,
        plugin: props.plugin,
        promptAgent: (input) => props.options.host.promptAgent(input),
        readManagedProjectImage: (input) => props.options.host.readManagedProjectImage(input),
        readProjectText: (input) => props.options.host.readProjectText(input),
        signal: controller.signal,
        updateNodeState: (state) => {
          const latest = editorRef.current
          if (latest.readOnly || latest.document.id !== frame.canvasId) {
            throw new Error("Canvas is not writable in the current scope")
          }
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
      }).then((response) => {
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
      protocol: desktopPluginHostProtocol,
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

  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
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
      <CanvasNodeChrome icon={<Puzzle />} label={props.data.label} node={props} toolbar={toolbar}>
        <div className="relative size-full">
          <iframe
            allow={webPluginIframeAllow(props.plugin)}
            allowFullScreen={props.plugin.capabilities.includes("ui.fullscreen")}
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

export function getIncomingConnectedImageNodes(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  return getIncomingConnectedCanvasFileNodeIds(document, ownerNodeId)
    .map((id) => nodes.get(id))
    .filter((node): node is CanvasNode => node !== undefined && node.data.kind === "image")
}

function WebPluginCanvasToolbar(
  props: WebPluginNodeProps & {
    options: WebPluginCanvasContributionOptions
    plugin: InstalledWebPluginSummary
  },
) {
  const editor = useCanvasEditor()
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
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      {props.plugin.contributes.canvas.toolbar?.map((item) => (
        <CanvasNodeToolbarButton
          disabled={!mounted}
          icon={<Play />}
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
                protocol: desktopPluginHostProtocol,
                type: "command",
              })
            } catch {
              // A failed sandbox command must not break the Canvas toolbar.
            }
          }}
        />
      ))}
    </div>
  )
}

export function createWebPluginCanvasContribution(
  plugin: InstalledWebPluginSummary,
  options: WebPluginCanvasContributionOptions,
): CanvasFileRendererPlugin {
  const renderer = plugin.contributes.canvas.renderer
  const Component = (props: WebPluginNodeProps) => <WebPluginCanvasNode {...props} options={options} plugin={plugin} />
  const Toolbar = plugin.contributes.canvas.toolbar?.length
    ? (props: WebPluginNodeProps) => <WebPluginCanvasToolbar {...props} options={options} plugin={plugin} />
    : undefined
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
        ...(Toolbar ? { toolbar: Toolbar } : {}),
      },
    ],
  }
}
