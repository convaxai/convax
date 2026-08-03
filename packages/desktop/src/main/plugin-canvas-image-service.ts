import { randomUUID } from "node:crypto"

import type {
  CanvasAddResourceSourcesRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationService,
} from "@convax/canvas/application"
import type { CanvasNode } from "@convax/canvas/core"
import type { PluginCanvasImageCreateRequest, PluginCanvasImageCreateResult } from "../plugin-canvas-image-contracts"
import { requireProjectResourceReference } from "@convax/project/canvas"
import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { PluginHostMutationCheckpoint, PluginHostNodeBinding } from "../plugin-host-api-main-contracts"
import { matchesWebPluginCanvasNode } from "../plugin-canvas-node"
import {
  hasWebPluginCanvasSurface,
  type InstalledWebPluginCanvasSurface,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import { PluginHostApiError } from "../plugin-host-errors"
import { projectPluginCanvasStructureDocument } from "./plugin-canvas-projection"

type PluginCanvasImageApplicationPort = Pick<CanvasApplicationService, "query">

interface PluginCanvasImageProjectPort {
  publishGenerated(input: {
    beforePublish?: () => Promise<void>
    bytes?: Uint8Array
    extension: string
    name?: string
    projectId: string
    signal?: AbortSignal
    sourcePath?: string
  }): Promise<{ path: string }>
}

interface PluginCanvasImageResourcePort {
  addResources(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult>
}

interface PluginCanvasImageIdentity {
  activeRevision?: number
  activeSetDigest?: string
  digest: string
  manifestDigest?: string
  plugin: InstalledWebPluginSummary
  snapshotDigest?: string
}

interface PluginCanvasImageSurfaceIdentity extends PluginCanvasImageIdentity {
  plugin: InstalledWebPluginCanvasSurface
}

interface PluginCanvasImagePluginPort {
  resolveCapabilityIdentity(pluginId: string): Promise<PluginCanvasImageIdentity | null>
}

export interface PluginCanvasImageServiceOptions {
  application: PluginCanvasImageApplicationPort
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
  principal?: PluginPrincipal,
): PluginCanvasImageSurfaceIdentity {
  if (
    !identity ||
    identity.plugin.id !== request.pluginId ||
    identity.plugin.version !== request.pluginVersion ||
    (expectedDigest !== undefined && identity.digest !== expectedDigest) ||
    (principal !== undefined &&
      (identity.activeRevision !== principal.activeRevision ||
        identity.activeSetDigest !== principal.activeSetDigest ||
        (identity.manifestDigest ?? identity.digest) !== principal.manifestDigest ||
        identity.snapshotDigest !== principal.snapshotDigest)) ||
    !hasWebPluginCanvasSurface(identity.plugin) ||
    !identity.plugin.capabilities.includes("canvas.image.write")
  ) {
    if (principal !== undefined) {
      throw new PluginHostApiError("stale-context", "Plugin identity or Canvas image permission changed")
    }
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
  readonly #application: PluginCanvasImageApplicationPort
  readonly #plugins: PluginCanvasImagePluginPort
  readonly #projects: PluginCanvasImageProjectPort
  readonly #resources: PluginCanvasImageResourcePort

  constructor(options: PluginCanvasImageServiceOptions) {
    this.#application = options.application
    this.#plugins = options.plugins
    this.#projects = options.projects
    this.#resources = options.resources
  }

  async create(request: PluginCanvasImageCreateRequest, signal?: AbortSignal): Promise<PluginCanvasImageCreateResult> {
    return this.#create(request, signal)
  }

  async createForHostApi(
    input: {
      binding: PluginHostNodeBinding
      checkpoint: PluginHostMutationCheckpoint
      dataUrl: string
      name: string
      operationId: string
      principal: PluginPrincipal
    },
    signal?: AbortSignal,
  ): Promise<PluginCanvasImageCreateResult> {
    if (input.principal.runtime !== "web") {
      throw new Error("Plugin Canvas image Host API requires a Web principal")
    }
    await input.checkpoint.checkpoint()
    return this.#create(
      {
        dataUrl: input.dataUrl,
        name: input.name,
        operationId: input.operationId,
        ownerNodeId: input.binding.nodeId,
        pluginId: input.principal.pluginId,
        pluginVersion: input.principal.pluginVersion,
        ref: { canvasId: input.binding.canvasId, scopeId: input.binding.projectId },
      },
      signal,
      input.principal,
      input.checkpoint,
    )
  }

  async #create(
    request: PluginCanvasImageCreateRequest,
    signal?: AbortSignal,
    principal?: PluginPrincipal,
    checkpoint?: PluginHostMutationCheckpoint,
  ): Promise<PluginCanvasImageCreateResult> {
    const { bytes, name } = validateRequest(request)
    throwIfAborted(signal)
    const identity = requireIdentity(
      await this.#plugins.resolveCapabilityIdentity(request.pluginId),
      request,
      undefined,
      principal,
    )
    const snapshot = await this.#application.query(request.ref)
    const owner = snapshot.projection.nodes.find((node) => node.id === request.ownerNodeId)
    if (!owner || !matchesWebPluginCanvasNode(identity.plugin, owner.data)) {
      throw new Error("Plugin screenshot owner node is no longer available")
    }

    throwIfAborted(signal)
    const published = await this.#projects.publishGenerated({
      beforePublish: async () => {
        throwIfAborted(signal)
        await checkpoint?.checkpoint()
        requireIdentity(
          await this.#plugins.resolveCapabilityIdentity(request.pluginId),
          request,
          identity.digest,
          principal,
        )
        throwIfAborted(signal)
      },
      bytes,
      extension: ".png",
      name,
      projectId: request.ref.scopeId,
      signal,
    })
    const publishedPath = requireGeneratedPublicationPath(published.path)
    try {
      throwIfAborted(signal)
      await checkpoint?.checkpoint()
      const currentIdentity = requireIdentity(
        await this.#plugins.resolveCapabilityIdentity(request.pluginId),
        request,
        identity.digest,
        principal,
      )
      const current = await this.#application.query(request.ref)
      const currentOwner = current.projection.nodes.find((node) => node.id === request.ownerNodeId)
      if (!currentOwner || !matchesWebPluginCanvasNode(currentIdentity.plugin, currentOwner.data)) {
        throw new Error("Plugin screenshot owner node is no longer available")
      }
      throwIfAborted(signal)
      const result: CanvasApplicationCommandResult = await this.#resources.addResources({
        actor: { id: request.pluginId, kind: "plugin" },
        anchor: imageAnchor(currentOwner),
        ...(checkpoint ? { beforeCommit: () => checkpoint.checkpoint().then(() => undefined) } : {}),
        canvasId: request.ref.canvasId,
        commandId: `plugin-image:${request.operationId}`,
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
      return {
        createdNodeId,
        operationReceipt: structuredClone(result.operationReceipt),
        projection: projectPluginCanvasStructureDocument(result.document),
      }
    } catch (error) {
      throw new PluginCanvasImagePublicationPartialSuccessError(publishedPath, error)
    }
  }
}
