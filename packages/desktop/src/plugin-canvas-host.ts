import {
  getIncomingConnectedCanvasFileNodeIds,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeData,
} from "@convax/canvas"
import { getProjectFileReference, isManagedProjectAssetPath } from "@convax/project/canvas"
import type { WebPluginGenerationInputRole, WebPluginGenerationModality } from "./plugin-contracts"
import type { InstalledPlugin, PluginCapability } from "./plugin-api"
import {
  desktopPluginHostProtocolForManifestSchema,
  isDesktopPluginHostRequest,
  pluginHostFailure,
  pluginHostSuccess,
  type DesktopPluginHostRequest,
  type DesktopPluginHostResponse,
} from "./plugin-host-protocol"
import type {
  PluginGenerationCanvasResult,
  PluginGenerationResultMode,
  PluginGenerationReference,
  PluginGenerationToolSummary,
  PluginConnectedInputDescriptor,
  PluginHostRequestContext,
} from "./plugin-host-types"

const defaultRequestBytes = 256 * 1024
const defaultCanvasImageRequestBytes = 24 * 1024 * 1024
const defaultResponseBytes = 1024 * 1024
const defaultConnectedImageResponseBytes = 24 * 1024 * 1024
const defaultStateBytes = 256 * 1024
const maximumConnectedImageBytes = 16 * 1024 * 1024
const maximumCanvasImageBytes = 16 * 1024 * 1024
const maximumPromptLength = 20_000
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function metadataOf(data: CanvasNodeData) {
  return isRecord(data.metadata) ? data.metadata : undefined
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

function validateJsonValue(value: unknown, depth = 0, stack = new WeakSet()): void {
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
  const cloned: unknown = JSON.parse(JSON.stringify(value))
  if (!isRecord(cloned)) throw new Error("Plugin state must be an object")
  return cloned
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

const generationOutputs = new Set<WebPluginGenerationModality>(["text", "image", "video", "audio"])
const generationInputRoles = new Set<WebPluginGenerationInputRole>([
  "text",
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
])

function requireGenerationPrompt(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > maximumPromptLength || value.includes("\0")) {
    throw new Error(`Generation prompt must contain between 1 and ${maximumPromptLength} characters`)
  }
  return value
}

function isGenerationOutput(value: unknown): value is WebPluginGenerationModality {
  return value === "text" || value === "image" || value === "video" || value === "audio"
}

function isGenerationInputRole(value: unknown): value is WebPluginGenerationInputRole {
  return (
    value === "text" ||
    value === "reference_image" ||
    value === "reference_video" ||
    value === "first_frame" ||
    value === "last_frame" ||
    value === "audio"
  )
}

function requireGenerationOutput(value: unknown, label = "Generation output") {
  if (!isGenerationOutput(value) || !generationOutputs.has(value)) {
    throw new Error(`${label} is not supported`)
  }
  return value
}

function optionalGenerationOutput(value: unknown) {
  return value === undefined ? undefined : requireGenerationOutput(value)
}

function optionalPluginGenerationResultMode(value: unknown): PluginGenerationResultMode | undefined {
  if (value === undefined) return undefined
  if (value !== "create-pending-node") throw new Error("Generation result mode is not supported")
  return value
}

function requireGenerationIdentifier(value: unknown, label: string, maximum = 2_048) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function generationRoleForNode(node: CanvasNode): WebPluginGenerationInputRole | undefined {
  if (node.data.kind === "text") return "text"
  if (node.data.kind === "image") return "reference_image"
  if (node.data.kind === "video") return "reference_video"
  if (node.data.kind === "audio") return "audio"
  return undefined
}

function expectedGenerationNodeKind(role: WebPluginGenerationInputRole) {
  if (role === "text") return "text"
  if (role === "reference_video") return "video"
  if (role === "audio") return "audio"
  return "image"
}

function incomingGenerationNodes(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  return getIncomingConnectedCanvasFileNodeIds(document, ownerNodeId)
    .map((id) => nodes.get(id))
    .filter((node): node is CanvasNode => node !== undefined)
}

function requireGenerationReferences(
  value: unknown,
  document: CanvasDocument,
  ownerNodeId: string,
): readonly PluginGenerationReference[] {
  const incoming = incomingGenerationNodes(document, ownerNodeId)
  let references: readonly PluginGenerationReference[]
  if (value === undefined) {
    references = incoming.flatMap((node) => {
      const role = generationRoleForNode(node)
      return role ? [{ nodeId: node.id, role }] : []
    })
  } else {
    if (!Array.isArray(value) || value.length > 32) {
      throw new Error("Generation references must contain at most 32 items")
    }
    const incomingById = new Map(incoming.map((node) => [node.id, node]))
    const pairs = new Set<string>()
    references = value.map((candidate, index) => {
      const reference = exactRecord(candidate, ["nodeId", "role"], `Generation reference ${index}`)
      const nodeId = requireGenerationIdentifier(reference.nodeId, `Generation reference ${index} nodeId`)
      if (!isGenerationInputRole(reference.role) || !generationInputRoles.has(reference.role)) {
        throw new Error(`Generation reference ${index} role is not supported`)
      }
      const role = reference.role
      const node = incomingById.get(nodeId)
      if (!node) throw new Error("Generation references must be direct incoming Canvas file nodes")
      const expectedKind = expectedGenerationNodeKind(role)
      if (node.data.kind !== expectedKind) {
        throw new Error(`Generation role ${role} requires a direct incoming ${expectedKind} node`)
      }
      const pair = `${nodeId}\0${role}`
      if (pairs.has(pair)) throw new Error("Generation references contain a duplicate node and role")
      pairs.add(pair)
      return { nodeId, role }
    })
  }
  if (references.length > 32) throw new Error("Generation references must contain at most 32 items")
  for (const role of ["first_frame", "last_frame"] as const) {
    if (references.filter((reference) => reference.role === role).length > 1) {
      throw new Error(`Generation references contain more than one ${role}`)
    }
  }
  return references
}

function finiteNodeDimension(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
}

/** Places generated output beside the owning file node; sandbox requests cannot choose coordinates. */
export function generationAnchorForPluginNode(node: CanvasNode) {
  const width = finiteNodeDimension(node.measured?.width, node.width, node.style?.width) ?? 320
  return { x: node.position.x + width + 64, y: node.position.y }
}

function sanitizeGenerationTools(value: readonly PluginGenerationToolSummary[], output?: WebPluginGenerationModality) {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Generation tool catalog returned an invalid result")
  const ids = new Set<string>()
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("Generation tool catalog returned an invalid result")
    const id = requireGenerationIdentifier(candidate.id, `Generation tool ${index} id`, 256)
    if (ids.has(id)) throw new Error("Generation tool catalog returned duplicate ids")
    ids.add(id)
    const toolOutput = requireGenerationOutput(candidate.output, `Generation tool ${index} output`)
    if (output && output !== toolOutput) throw new Error("Generation tool catalog returned an unexpected output")
    if (candidate.kind !== "model" && candidate.kind !== "operation") {
      throw new Error("Generation tool catalog returned an invalid kind")
    }
    if (!Array.isArray(candidate.acceptedInputs) || candidate.acceptedInputs.length > generationInputRoles.size) {
      throw new Error("Generation tool catalog returned invalid accepted inputs")
    }
    const acceptedInputs = candidate.acceptedInputs.map((role) => {
      if (!isGenerationInputRole(role) || !generationInputRoles.has(role)) {
        throw new Error("Generation tool catalog returned invalid accepted inputs")
      }
      return role
    })
    if (new Set(acceptedInputs).size !== acceptedInputs.length) {
      throw new Error("Generation tool catalog returned invalid accepted inputs")
    }
    return {
      acceptedInputs,
      description: requireGenerationIdentifier(candidate.description, `Generation tool ${index} description`, 2_000),
      id,
      kind: candidate.kind,
      output: toolOutput,
      title: requireGenerationIdentifier(candidate.title, `Generation tool ${index} title`, 120),
    }
  })
}

function sanitizeGenerationResult(value: PluginGenerationCanvasResult): PluginGenerationCanvasResult {
  if (!isRecord(value)) throw new Error("Generation executor returned an invalid result")
  if (!Array.isArray(value.createdNodeIds) || value.createdNodeIds.length === 0 || value.createdNodeIds.length > 32) {
    throw new Error("Generation executor returned invalid created node ids")
  }
  const createdNodeIds = value.createdNodeIds.map((id, index) =>
    requireGenerationIdentifier(id, `Generated node ${index} id`),
  )
  if (new Set(createdNodeIds).size !== createdNodeIds.length) {
    throw new Error("Generation executor returned duplicate created node ids")
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error("Generation executor returned an invalid revision")
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > 32) {
    throw new Error("Generation executor returned invalid warnings")
  }
  const warnings = value.warnings.map((warning, index) =>
    requireGenerationIdentifier(warning, `Generation warning ${index}`, 2_000),
  )
  return {
    createdNodeIds,
    revision: value.revision,
    toolId: requireGenerationIdentifier(value.toolId, "Generation result tool id", 256),
    warnings,
  }
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

function optionalConnectedInputText(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return undefined
  }
  return value
}

function optionalConnectedInputDimension(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function connectedInputDescriptor(node: CanvasNode): PluginConnectedInputDescriptor {
  const kind = optionalConnectedInputText(node.data.kind, 80) ?? "file"
  const label = optionalConnectedInputText(node.data.label, 512) ?? "Untitled"
  const name = optionalConnectedInputText(node.data.name, 512)
  const mimeType = optionalConnectedInputText(node.data.mimeType, 256)
  const status =
    node.data.status === "idle" || node.data.status === "pending" || node.data.status === "error"
      ? node.data.status
      : undefined
  const width = optionalConnectedInputDimension(node.data.width)
  const height = optionalConnectedInputDimension(node.data.height)
  const durationMs = optionalConnectedInputDimension(node.data.durationMs)
  return {
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(height === undefined ? {} : { height }),
    id: node.id,
    kind,
    label,
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(name === undefined ? {} : { name }),
    ...(status === undefined ? {} : { status }),
    ...(width === undefined ? {} : { width }),
  }
}

export function getIncomingConnectedInputNodes(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  return getIncomingConnectedCanvasFileNodeIds(document, ownerNodeId)
    .map((id) => nodes.get(id))
    .filter((node): node is CanvasNode => node !== undefined)
}

const connectedInputDataFingerprintCache = new WeakMap<
  object,
  {
    fingerprint: Promise<string>
    metadata: string
    source: string
  }
>()

function connectedInputDataFingerprint(data: CanvasNodeData) {
  const source = typeof data.url === "string" ? data.url : ""
  const metadata = JSON.stringify([
    data.kind,
    data.label,
    data.name,
    data.mimeType,
    data.status,
    data.width,
    data.height,
    data.durationMs,
    getProjectFileReference(metadataOf(data))?.path,
  ])
  const cached = connectedInputDataFingerprintCache.get(data)
  if (cached && cached.source === source && cached.metadata === metadata) return cached.fingerprint
  const fingerprint = sha256(`${metadata}\u0000${source}`)
  connectedInputDataFingerprintCache.set(data, { fingerprint, metadata, source })
  return fingerprint
}

export async function connectedInputFingerprint(document: CanvasDocument, ownerNodeId: string) {
  const parts = await Promise.all(
    getIncomingConnectedInputNodes(document, ownerNodeId).map(async (node) => [
      node.id,
      await connectedInputDataFingerprint(node.data),
    ]),
  )
  return sha256(JSON.stringify(parts))
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

export async function connectedImageFingerprint(document: CanvasDocument, ownerNodeId: string) {
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
  context: PluginHostRequestContext,
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

function requireCanvasImageDataUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Canvas image data is invalid")
  const prefix = "data:image/png;base64,"
  if (value.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("Canvas image data must be a base64 PNG")
  }
  const encoded = value.slice(prefix.length)
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Canvas image data is not canonical base64")
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  const decodedBytes = (encoded.length / 4) * 3 - padding
  if (decodedBytes < 24 || decodedBytes > maximumCanvasImageBytes) {
    throw new Error(`Canvas image must contain at most ${maximumCanvasImageBytes / 1024 / 1024} MiB`)
  }
  return value
}

function requireCanvasImageName(value: unknown) {
  const stem = typeof value === "string" ? (value.split(".")[0] ?? "") : ""
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 120 ||
    !value.toLowerCase().endsWith(".png") ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value) ||
    /[. ]$/.test(value) ||
    windowsReservedName.test(stem)
  ) {
    throw new Error("Canvas image name is invalid")
  }
  return value
}

function requireCapability(plugin: InstalledPlugin, capability: PluginCapability) {
  if (!plugin.capabilities.includes(capability)) throw new Error(`Plugin capability is not granted: ${capability}`)
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

function assertCurrentFrame(context: PluginHostRequestContext) {
  if (context.signal.aborted) throw context.signal.reason ?? new Error("Plugin frame was closed")
  const active = context.getActiveContext()
  if (!active || active.projectId !== context.frame.projectId || active.canvasId !== context.frame.canvasId) {
    throw new Error("Plugin frame is no longer in the active Project and Canvas")
  }
  const node = context.getNode()
  if (!node || node.id !== context.frame.nodeId || !context.ownsNode(node)) {
    throw new Error("Plugin frame no longer owns this Canvas node")
  }
  return { active, node }
}

async function executeHostRequest(request: DesktopPluginHostRequest, context: PluginHostRequestContext) {
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
  if (request.method === "canvas.connectedInputs.list") {
    requireEmptyParams(request.params)
    requireCapability(context.plugin, "canvas.connectedInputs.read")
    return { inputs: context.getConnectedInputNodes().map(connectedInputDescriptor) }
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
    if (context.nodeStateWriteGate.active) {
      throw new Error("A Canvas node state write is already in progress for this Plugin frame")
    }
    context.nodeStateWriteGate.active = true
    try {
      const params = exactRecord(request.params, ["state"], "Canvas node state request")
      if (!("state" in params)) throw new Error("Canvas node state request is missing state")
      const state = requirePluginState(
        params.state,
        requireLimit(context.limits?.stateBytes, defaultStateBytes, "Plugin state byte limit"),
      )
      await context.updateNodeState(state)
      assertCurrentFrame(context)
      return { updated: true }
    } finally {
      context.nodeStateWriteGate.active = false
    }
  }
  if (request.method === "canvas.image.create") {
    requireCapability(context.plugin, "canvas.image.write")
    if (context.canvasImageWriteGate.active) {
      throw new Error("A Canvas image write is already in progress for this Plugin frame")
    }
    if (!context.isCanvasWritable()) throw new Error("Canvas is not writable in the current scope")
    context.canvasImageWriteGate.active = true
    try {
      const params = exactRecord(request.params, ["dataUrl", "name"], "Canvas image request")
      const result = await context.createCanvasImage({
        ...context.frame,
        dataUrl: requireCanvasImageDataUrl(params.dataUrl),
        name: requireCanvasImageName(params.name),
        pluginVersion: context.plugin.version,
        signal: context.signal,
      })
      assertCurrentFrame(context)
      if (
        !result ||
        typeof result.createdNodeId !== "string" ||
        !result.createdNodeId ||
        !Number.isSafeInteger(result.revision) ||
        result.revision < 0
      ) {
        throw new Error("Canvas image provider returned an invalid result")
      }
      return result
    } finally {
      context.canvasImageWriteGate.active = false
    }
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
  if (request.method === "generation.tools.list") {
    requireCapability(context.plugin, "generation.execute")
    const params =
      request.params === undefined ? {} : exactRecord(request.params, ["output"], "Generation tool list request")
    const output = optionalGenerationOutput(params.output)
    const tools = await context.listGenerationTools({
      ...context.frame,
      ...(output === undefined ? {} : { output }),
      signal: context.signal,
    })
    assertCurrentFrame(context)
    return { tools: sanitizeGenerationTools(tools, output) }
  }
  if (request.method === "generation.canvas.execute") {
    requireCapability(context.plugin, "generation.execute")
    if (context.generationGate.active) {
      throw new Error("A Canvas generation is already in progress for this Plugin frame")
    }
    context.generationGate.active = true
    try {
      if (!context.isCanvasWritable()) throw new Error("Canvas is not writable in the current scope")
      const params = exactRecord(
        request.params,
        ["output", "prompt", "references", "resultMode", "toolId"],
        "Canvas generation request",
      )
      const document = context.getDocument()
      if (!document || document.id !== context.frame.canvasId) {
        throw new Error("Plugin frame is no longer attached to its Canvas document")
      }
      const output = optionalGenerationOutput(params.output)
      const resultMode = optionalPluginGenerationResultMode(params.resultMode)
      const toolId =
        params.toolId === undefined ? undefined : requireGenerationIdentifier(params.toolId, "Generation tool id", 256)
      const references = requireGenerationReferences(params.references, document, context.frame.nodeId)
      let result: PluginGenerationCanvasResult
      try {
        result = await context.executeCanvasGeneration({
          ...context.frame,
          anchor: generationAnchorForPluginNode(current.node),
          ...(output === undefined ? {} : { output }),
          prompt: requireGenerationPrompt(params.prompt),
          references,
          ...(resultMode === undefined ? {} : { resultMode }),
          signal: context.signal,
          ...(toolId === undefined ? {} : { toolId }),
        })
      } catch {
        if (context.signal.aborted) throw new Error("Plugin frame was closed")
        throw new Error("Canvas generation could not be completed")
      }
      assertCurrentFrame(context)
      return sanitizeGenerationResult(result)
    } finally {
      context.generationGate.active = false
    }
  }
  if (request.method === "agent.prompt") {
    requireCapability(context.plugin, "agent.prompt")
    const params = exactRecord(request.params, ["text"], "Agent prompt request")
    const ownedSkills = context.plugin.contributes.skills ?? []
    const result = await context.promptAgent({
      ...context.frame,
      pluginName: context.plugin.name,
      ...(ownedSkills.length === 1 ? { skillName: ownedSkills[0]!.name } : {}),
      signal: context.signal,
      text: requirePromptText(params.text),
    })
    assertCurrentFrame(context)
    if (!result || typeof result.text !== "string") {
      throw new Error("Agent prompt provider returned an invalid result")
    }
    return result
  }
  throw new Error(`Plugin host method is not available in this capability adapter: ${request.method}`)
}

function requestId(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 128) return null
  return value.id
}

/** Validate and execute one transport request. Messages without a safe id are ignored. */
export async function dispatchPluginHostRequest(
  value: unknown,
  context: PluginHostRequestContext,
): Promise<DesktopPluginHostResponse | null> {
  const id = requestId(value)
  if (!id) return null
  const protocol = desktopPluginHostProtocolForManifestSchema(context.plugin.schema)
  try {
    const imageRequest = isRecord(value) && value.method === "canvas.image.create"
    assertMessageSize(
      value,
      imageRequest
        ? requireLimit(
            context.limits?.canvasImageRequestBytes,
            defaultCanvasImageRequestBytes,
            "Plugin Canvas image request byte limit",
          )
        : requireLimit(context.limits?.requestBytes, defaultRequestBytes, "Plugin request byte limit"),
      "Plugin request",
    )
    exactRecord(value, ["id", "method", "params", "protocol", "type"], "Plugin host request")
    if (!isDesktopPluginHostRequest(value)) throw new Error("Invalid plugin host request")
    if (value.protocol !== protocol) throw new Error("Plugin host protocol does not match the installed Plugin schema")
    const result = await executeHostRequest(value, context)
    const response = pluginHostSuccess(id, result, protocol)
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
    return pluginHostFailure(id, message, protocol)
  }
}
export function getIncomingConnectedImageNodes(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  return getIncomingConnectedCanvasFileNodeIds(document, ownerNodeId)
    .map((id) => nodes.get(id))
    .filter((node): node is CanvasNode => node !== undefined && node.data.kind === "image")
}

/** Backwards-compatible name used by the original Web MessageChannel adapter. */
export const dispatchWebPluginHostRequest = dispatchPluginHostRequest
