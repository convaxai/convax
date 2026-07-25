import { randomUUID } from "node:crypto"

import type { CanvasAddResourceSourcesRequest, CanvasApplicationCommandResult } from "@convax/canvas/application"
import type { CanvasDocument, CanvasNode } from "@convax/canvas/core"
import type { PluginCanvasImageCreateRequest, PluginCanvasImageCreateResult } from "../plugin-canvas-image-contracts"
import { requireProjectResourceReference } from "@convax/project/canvas"
import { matchesWebPluginCanvasNode } from "../plugin-canvas-node"
import {
  hasWebPluginCanvasSurface,
  type InstalledWebPluginCanvasSurface,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"

interface PluginCanvasImageDocumentPort {
  load(ref: { canvasId: string; scopeId: string }): Promise<{ document: CanvasDocument | null }>
}

interface PluginCanvasImageProjectPort {
  publishGenerated(input: {
    bytes?: Uint8Array
    extension: string
    name?: string
    projectId: string
    sourcePath?: string
  }): Promise<{ path: string }>
}

interface PluginCanvasImageResourcePort {
  addResources(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult>
}

interface PluginCanvasImageIdentity {
  digest: string
  plugin: InstalledWebPluginSummary
}

interface PluginCanvasImageSurfaceIdentity extends PluginCanvasImageIdentity {
  plugin: InstalledWebPluginCanvasSurface
}

interface PluginCanvasImagePluginPort {
  resolveCapabilityIdentity(pluginId: string): Promise<PluginCanvasImageIdentity | null>
}

export interface PluginCanvasImageServiceOptions {
  documents: PluginCanvasImageDocumentPort
  plugins: PluginCanvasImagePluginPort
  projects: PluginCanvasImageProjectPort
  resources: PluginCanvasImageResourcePort
}

const maximumImageBytes = 16 * 1024 * 1024
const maximumImageDimension = 8192
const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const pluginIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/iu

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Plugin Canvas image operation was canceled", "AbortError")
}

function requireIdentifier(value: unknown, label: string, pattern = operationIdPattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function requireName(value: unknown) {
  const stem = typeof value === "string" ? (value.split(".")[0] ?? "") : ""
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 120 ||
    !value.toLowerCase().endsWith(".png") ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(value) ||
    /[. ]$/u.test(value) ||
    windowsReservedName.test(stem)
  ) {
    throw new Error("Plugin Canvas image name is invalid")
  }
  return value
}

function requireDataUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Plugin Canvas image data is invalid")
  const prefix = "data:image/png;base64,"
  if (value.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("Plugin Canvas image must be a base64 PNG")
  }
  const encoded = value.slice(prefix.length)
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    throw new Error("Plugin Canvas image is not canonical base64")
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  const decodedSize = (encoded.length / 4) * 3 - padding
  if (decodedSize < 24 || decodedSize > maximumImageBytes) {
    throw new Error(`Plugin Canvas image must contain at most ${maximumImageBytes / 1024 / 1024} MiB`)
  }
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.byteLength !== decodedSize || pngSignature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("Plugin Canvas image content is not a PNG")
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Plugin Canvas image PNG header is invalid")
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (
    !width ||
    !height ||
    width > maximumImageDimension ||
    height > maximumImageDimension ||
    width * height > maximumImageDimension * maximumImageDimension
  ) {
    throw new Error(
      `Plugin Canvas image dimensions must not exceed ${maximumImageDimension} × ${maximumImageDimension}`,
    )
  }
  return bytes
}

function requireIdentity(
  identity: PluginCanvasImageIdentity | null,
  request: PluginCanvasImageCreateRequest,
  expectedDigest?: string,
): PluginCanvasImageSurfaceIdentity {
  if (
    !identity ||
    identity.plugin.id !== request.pluginId ||
    identity.plugin.version !== request.pluginVersion ||
    (expectedDigest !== undefined && identity.digest !== expectedDigest) ||
    !hasWebPluginCanvasSurface(identity.plugin) ||
    !identity.plugin.capabilities.includes("canvas.image.write")
  ) {
    throw new Error("Plugin identity or Canvas image permission changed")
  }
  return { digest: identity.digest, plugin: identity.plugin }
}

function finiteNodeDimension(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
}

function imageAnchor(node: CanvasNode) {
  const width = finiteNodeDimension(node.measured?.width, node.width, node.style?.width) ?? 320
  return { x: node.position.x + width + 64, y: node.position.y }
}

function validateRequest(request: PluginCanvasImageCreateRequest) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Plugin Canvas image request is invalid")
  }
  requireIdentifier(request.operationId, "Plugin Canvas image operation id")
  requireIdentifier(request.ownerNodeId, "Plugin Canvas image owner node id")
  requireIdentifier(request.pluginId, "Plugin Canvas image Plugin id", pluginIdPattern)
  requireIdentifier(request.pluginVersion, "Plugin Canvas image Plugin version", versionPattern)
  requireIdentifier(request.ref?.canvasId, "Plugin Canvas image Canvas id")
  requireIdentifier(request.ref?.scopeId, "Plugin Canvas image Project id")
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new Error("Plugin Canvas image expected revision is invalid")
  }
  return { bytes: requireDataUrl(request.dataUrl), name: requireName(request.name) }
}

function requireGeneratedPublicationPath(value: string) {
  const reference = requireProjectResourceReference({ kind: "project-file", path: value })
  if (reference.kind !== "project-file" || !reference.path.startsWith("Generated/")) {
    throw new Error("Plugin Canvas image publisher returned a path outside Generated")
  }
  if (reference.path.split("/").length !== 2 || reference.path.length > 320) {
    throw new Error("Plugin Canvas image publisher returned an invalid Generated path")
  }
  return reference.path
}

export class PluginCanvasImagePublicationPartialSuccessError extends Error {
  readonly publishedPaths: readonly string[]

  constructor(publishedPath: string, cause: unknown) {
    const path = requireGeneratedPublicationPath(publishedPath)
    super(`Plugin screenshot was saved, but the Canvas update could not be confirmed. Saved file: ${path}`, { cause })
    this.name = "PluginCanvasImagePublicationPartialSuccessError"
    this.publishedPaths = Object.freeze([path])
  }
}

export class PluginCanvasImageService {
  readonly #documents: PluginCanvasImageDocumentPort
  readonly #plugins: PluginCanvasImagePluginPort
  readonly #projects: PluginCanvasImageProjectPort
  readonly #resources: PluginCanvasImageResourcePort

  constructor(options: PluginCanvasImageServiceOptions) {
    this.#documents = options.documents
    this.#plugins = options.plugins
    this.#projects = options.projects
    this.#resources = options.resources
  }

  async create(request: PluginCanvasImageCreateRequest, signal?: AbortSignal): Promise<PluginCanvasImageCreateResult> {
    const { bytes, name } = validateRequest(request)
    throwIfAborted(signal)
    const identity = requireIdentity(await this.#plugins.resolveCapabilityIdentity(request.pluginId), request)
    const snapshot = await this.#documents.load(request.ref)
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${request.ref.canvasId}`)
    if (snapshot.document.revision !== request.expectedRevision) {
      throw new Error("Canvas changed before the Plugin screenshot could be created")
    }
    const owner = snapshot.document.nodes.find((node) => node.id === request.ownerNodeId)
    if (!owner || !matchesWebPluginCanvasNode(identity.plugin, owner.data)) {
      throw new Error("Plugin screenshot owner node is no longer available")
    }

    throwIfAborted(signal)
    const published = await this.#projects.publishGenerated({
      bytes,
      extension: ".png",
      name,
      projectId: request.ref.scopeId,
    })
    const publishedPath = requireGeneratedPublicationPath(published.path)
    try {
      throwIfAborted(signal)
      const currentIdentity = requireIdentity(
        await this.#plugins.resolveCapabilityIdentity(request.pluginId),
        request,
        identity.digest,
      )
      const current = await this.#documents.load(request.ref)
      if (!current.document || current.document.revision !== request.expectedRevision) {
        throw new Error("Canvas changed before the Plugin screenshot could be created")
      }
      const currentOwner = current.document.nodes.find((node) => node.id === request.ownerNodeId)
      if (!currentOwner || !matchesWebPluginCanvasNode(currentIdentity.plugin, currentOwner.data)) {
        throw new Error("Plugin screenshot owner node is no longer available")
      }
      throwIfAborted(signal)
      const result: CanvasApplicationCommandResult = await this.#resources.addResources({
        actor: { id: request.pluginId, kind: "plugin" },
        anchor: imageAnchor(currentOwner),
        canvasId: request.ref.canvasId,
        commandId: `plugin-image:${request.operationId}`,
        conflictPolicy: "reject",
        expectedRevision: request.expectedRevision,
        relation: {
          anchorNodeIds: [request.ownerNodeId],
          direction: "from-anchor",
          mode: "connect",
        },
        scopeId: request.ref.scopeId,
        ...(signal ? { signal } : {}),
        sources: [{ kind: "host-file", path: publishedPath, sourceId: randomUUID() }],
      })
      const createdNodeId = result.createdNodeIds[0]
      if (!createdNodeId || result.createdNodeIds.length !== 1) {
        throw new Error("Plugin screenshot did not create exactly one Canvas image node")
      }
      return { createdNodeId, revision: result.document.revision }
    } catch (error) {
      throw new PluginCanvasImagePublicationPartialSuccessError(publishedPath, error)
    }
  }
}
