import { createHash } from "node:crypto"
import path from "node:path"
import {
  assertResourceRefV2,
  canvasProjectionResourceMetadataKeyV2,
  type CanvasResourceRefV2,
} from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"
import { parseProjectIdV2 } from "@convax/collaboration"
import type { ProjectDirectoryListing, ProjectFileInfo, ProjectTextFileContents } from "@convax/project-files"
import type { ProjectIndexCurrentBlobReferencePortV2 } from "../../collaboration/blob-replication"
import {
  hydrateProjectCanvasDocument,
  hydrateStaleProjectCanvasResources,
  projectResourceReferenceKey,
  requireProjectResourceReference,
  type ProjectResourceReference,
  type ProjectResourceSnapshot,
} from "../../canvas/project-resources"
import { projectResourceReferenceDigestV2 } from "../../collaboration/project-index"
import { mimeTypeForPath } from "../project-manager-helpers"
import { readStableProjectFile, readStableProjectUtf8File } from "../stable-project-file"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

interface ProjectResourceFilePort {
  listDirectory(input: { path?: string; projectId: string }): Promise<ProjectDirectoryListing>
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  readTextFile(input: { path: string; projectId: string }): Promise<ProjectTextFileContents>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

export interface ProjectCanvasResourceUrlInput {
  contentRevision?: string
  projectId: string
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>
}

export type ProjectCanvasResourceUrlFactory = (input: ProjectCanvasResourceUrlInput) => string

export interface ProjectCanvasResourceHydratorOptions {
  currentResources?: ProjectIndexCurrentBlobReferencePortV2
  maximumMediaBytes?: number
  maximumTextBytes?: number
}

export interface ProjectCanvasImageRead {
  bytes: Uint8Array
  contentDigest: string
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  name: string
  size: number
}

export interface ProjectCanvasImageReadInput {
  maximumBytes: number
  projectId: string
  reference: ProjectResourceReference
  signal?: AbortSignal
}

export interface ProjectCanvasImageReadPort {
  readImage(input: ProjectCanvasImageReadInput): Promise<ProjectCanvasImageRead>
}

const defaultMaximumMediaBytes = 64 * 1024 * 1024
const defaultMaximumTextBytes = 16 * 1024 * 1024

export class ProjectCanvasResourceHydrator implements ProjectCanvasImageReadPort {
  readonly #currentResources?: ProjectIndexCurrentBlobReferencePortV2
  readonly #maximumMediaBytes: number
  readonly #maximumTextBytes: number

  constructor(
    private readonly files: ProjectResourceFilePort,
    private readonly assets: Pick<ProjectManagedAssetStore, "resolve">,
    private readonly createUrl: ProjectCanvasResourceUrlFactory,
    options: ProjectCanvasResourceHydratorOptions = {},
  ) {
    const maximumMediaBytes = options.maximumMediaBytes ?? defaultMaximumMediaBytes
    const maximumTextBytes = options.maximumTextBytes ?? defaultMaximumTextBytes
    if (!Number.isSafeInteger(maximumMediaBytes) || maximumMediaBytes < 1) {
      throw new Error("Project Canvas media hydration limit must be a positive integer")
    }
    if (!Number.isSafeInteger(maximumTextBytes) || maximumTextBytes < 1) {
      throw new Error("Project Canvas text hydration limit must be a positive integer")
    }
    this.#maximumMediaBytes = maximumMediaBytes
    this.#maximumTextBytes = maximumTextBytes
    this.#currentResources = options.currentResources
  }

  async hydrate(input: { document: CanvasDocument; projectId: string }) {
    const attachment = await this.#attachCurrentProjectFileReferences(input)
    const hydrated = await hydrateProjectCanvasDocument(attachment.document, (reference) =>
      this.resolve({ projectId: input.projectId, reference }),
    )
    return restoreUnavailableCanvasResourceStates(
      attachment.document,
      restoreCanvasResourceMetadata(input.document, hydrated),
      attachment.unavailableNodeIds,
    )
  }

  async hydrateStale(input: { document: CanvasDocument; projectId: string }) {
    const attachment = await this.#attachCurrentProjectFileReferences(input)
    const hydrated = await hydrateStaleProjectCanvasResources(attachment.document, (reference) =>
      this.resolve({ projectId: input.projectId, reference }),
    )
    return restoreUnavailableCanvasResourceStates(
      attachment.document,
      restoreCanvasResourceMetadata(input.document, hydrated),
      attachment.unavailableNodeIds,
    )
  }

  async #attachCurrentProjectFileReferences(input: {
    document: CanvasDocument
    projectId: string
  }): Promise<{ document: CanvasDocument; unavailableNodeIds: ReadonlySet<string> }> {
    if (!this.#currentResources) return { document: input.document, unavailableNodeIds: new Set() }
    const resources = new Map<number, CanvasResourceRefV2>()
    input.document.nodes.forEach((node, index) => {
      if (!node.data.metadata || typeof node.data.metadata !== "object" || Array.isArray(node.data.metadata)) return
      const candidate = (node.data.metadata as Record<string, unknown>)[canvasProjectionResourceMetadataKeyV2]
      try {
        assertResourceRefV2(candidate)
        resources.set(index, candidate)
      } catch {
        // The ordinary hydrator below projects a bounded corrupt state.
      }
    })
    if (resources.size === 0) return { document: input.document, unavailableNodeIds: new Set() }

    const projectId = parseProjectIdV2(input.projectId)
    const currentResources = await this.#currentResources.queryCurrentResources({ projectId })
    const currentByUri = new Map(
      currentResources.map((entry) => [entry.reference.canonicalUri, entry] as const),
    )
    let changed = false
    const unavailableNodeIds = new Set<string>()
    const nodes = input.document.nodes.map((node, index) => {
      const resource = resources.get(index)
      if (!resource) return node
      const current = currentByUri.get(resource.uri)
      if (
        !current ||
        current.reference.blob.mime !== resource.mime ||
        current.reference.blob.byteLength !== resource.byteLength ||
        current.reference.blob.digest !== resource.contentDigest ||
        projectResourceReferenceDigestV2(current.reference) !== resource.ownerProofDigest
      ) {
        return node
      }
      const runtimeReference: ProjectResourceReference | undefined =
        current.storageClass === "managed-blob"
          ? {
              kind: "managed-asset",
              mediaType: resource.mime,
              name: node.data.label || resource.contentDigest,
              sha256: resource.contentDigest,
            }
          : current.materializedPath === null
            ? undefined
            : { kind: "project-file", path: current.materializedPath }
      if (runtimeReference === undefined) {
        unavailableNodeIds.add(node.id)
        changed = true
        return { ...node, data: { ...node.data, resourceState: { status: "missing" as const } } }
      }
      changed = true
      return {
        ...node,
        data: {
          ...node.data,
          metadata: {
            ...(node.data.metadata as Record<string, unknown>),
            [projectResourceReferenceKey]: runtimeReference,
          },
        },
      }
    })
    return {
      document: changed ? { ...input.document, nodes } : input.document,
      unavailableNodeIds,
    }
  }

  async readImage(input: ProjectCanvasImageReadInput): Promise<ProjectCanvasImageRead> {
    if (
      !Number.isSafeInteger(input.maximumBytes) ||
      input.maximumBytes < 1 ||
      input.maximumBytes > this.#maximumMediaBytes
    ) {
      throw new Error("Project Canvas image read limit exceeds the configured media limit")
    }
    const reference = requireProjectResourceReference(input.reference)
    if (reference.kind === "project-directory") throw new Error("Project directories cannot be read as images")

    let absolutePath: string
    let declaredMediaType: string
    let name: string
    if (reference.kind === "project-file") {
      input.signal?.throwIfAborted()
      const info = await this.files.readFileInfo({ path: reference.path, projectId: input.projectId })
      input.signal?.throwIfAborted()
      absolutePath = await this.files.resolveEntryPath({ path: reference.path, projectId: input.projectId })
      declaredMediaType = info.mimeType.toLowerCase()
      name = info.name
    } else {
      input.signal?.throwIfAborted()
      absolutePath = await this.assets.resolve({ projectId: input.projectId, reference })
      declaredMediaType = (reference.mediaType ?? mimeTypeForPath(reference.name)).toLowerCase()
      name = reference.name
    }

    const { bytes } = await readStableProjectFile(
      absolutePath,
      imageReadLabel(reference),
      input.maximumBytes,
      input.signal,
    )
    input.signal?.throwIfAborted()
    const mimeType = imageMimeTypeForBytes(bytes)
    if (!mimeType || mimeType !== declaredMediaType) {
      throw new Error("Project image MIME type does not match its byte signature")
    }
    const contentDigest = createHash("sha256").update(bytes).digest("hex")
    if (reference.kind === "managed-asset" && contentDigest !== reference.sha256) {
      throw new Error("Managed image digest does not match its typed reference")
    }
    return { bytes, contentDigest, mimeType, name, size: bytes.byteLength }
  }

  async resolve(input: { projectId: string; reference: ProjectResourceReference }): Promise<ProjectResourceSnapshot> {
    let reference: ProjectResourceReference
    try {
      reference = requireProjectResourceReference(input.reference)
    } catch {
      return { error: "Project resource reference is invalid", status: "corrupt" }
    }

    if (reference.kind === "project-directory") {
      try {
        await this.files.listDirectory({ path: reference.path, projectId: input.projectId })
        return { name: path.posix.basename(reference.path), status: "ready" }
      } catch (error) {
        return isMissing(error)
          ? { status: "missing" }
          : { error: "Project directory is unavailable", status: "corrupt" }
      }
    }

    if (reference.kind === "project-file") return this.#resolveProjectFile(input.projectId, reference)
    return this.#resolveManagedAsset(input.projectId, reference)
  }

  async #resolveProjectFile(
    projectId: string,
    reference: Extract<ProjectResourceReference, { kind: "project-file" }>,
  ): Promise<ProjectResourceSnapshot> {
    const mediaType = mimeTypeForPath(reference.path)
    const name = path.posix.basename(reference.path)
    if (isEditableTextPath(reference.path)) {
      try {
        const contents = await this.files.readTextFile({ path: reference.path, projectId })
        if (!contents.exists) return { status: "missing" }
        return {
          contentRevision: contents.contentRevision,
          editableText: true,
          mediaType,
          name,
          status: "ready",
          text: contents.content,
        }
      } catch (error) {
        if (isMissing(error)) return { status: "missing" }
        return { error: "Project text resource is corrupt", status: "corrupt" }
      }
    }

    try {
      const info = await this.files.readFileInfo({ path: reference.path, projectId })
      if (!isUrlResourceMediaType(info.mimeType)) return { status: "unsupported" }
      const absolutePath = await this.files.resolveEntryPath({ path: reference.path, projectId })
      const { bytes } = await readStableProjectFile(absolutePath, reference.path, this.#maximumMediaBytes)
      const contentRevision = createHash("sha256").update(bytes).digest("hex")
      return {
        contentRevision,
        mediaType: info.mimeType,
        name: info.name,
        status: "ready",
        url: this.createUrl({ contentRevision, projectId, reference }),
      }
    } catch (error) {
      return isMissing(error) ? { status: "missing" } : { error: "Project resource is corrupt", status: "corrupt" }
    }
  }

  async #resolveManagedAsset(
    projectId: string,
    reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>,
  ): Promise<ProjectResourceSnapshot> {
    let absolutePath: string
    try {
      absolutePath = await this.assets.resolve({ projectId, reference })
    } catch (error) {
      return isMissing(error) ? { status: "missing" } : { error: "Managed resource is corrupt", status: "corrupt" }
    }

    const mediaType = reference.mediaType ?? mimeTypeForPath(reference.name)
    if (isEditableTextPath(reference.name)) {
      try {
        const contents = await readStableProjectUtf8File(
          absolutePath,
          `managed:${reference.sha256}`,
          this.#maximumTextBytes,
        )
        if (contents.contentRevision !== reference.sha256) {
          return { error: "Managed resource is corrupt", status: "corrupt" }
        }
        return {
          canSaveEditableCopy: true,
          contentRevision: contents.contentRevision,
          editableText: false,
          mediaType,
          name: reference.name,
          status: "ready",
          text: contents.content,
        }
      } catch {
        return { error: "Managed resource is corrupt", status: "corrupt" }
      }
    }

    if (!isUrlResourceMediaType(mediaType)) return { status: "unsupported" }
    try {
      return {
        mediaType,
        name: reference.name,
        status: "ready",
        url: this.createUrl({ projectId, reference }),
      }
    } catch {
      return { error: "Managed resource is corrupt", status: "corrupt" }
    }
  }
}

function restoreCanvasResourceMetadata(source: CanvasDocument, hydrated: CanvasDocument): CanvasDocument {
  const sourceById = new Map(source.nodes.map((node) => [node.id, node] as const))
  let changed = false
  const nodes = hydrated.nodes.map((node) => {
    const sourceNode = sourceById.get(node.id)
    if (!sourceNode || node.data.metadata === sourceNode.data.metadata) return node
    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        metadata: sourceNode.data.metadata,
      },
    }
  })
  return changed ? { ...hydrated, nodes } : hydrated
}

function restoreUnavailableCanvasResourceStates(
  attached: CanvasDocument,
  hydrated: CanvasDocument,
  unavailableNodeIds: ReadonlySet<string>,
): CanvasDocument {
  if (unavailableNodeIds.size === 0) return hydrated
  const attachedById = new Map(attached.nodes.map((node) => [node.id, node] as const))
  const nodes = hydrated.nodes.map((node) => {
    if (!unavailableNodeIds.has(node.id)) return node
    const state = attachedById.get(node.id)?.data.resourceState
    return { ...node, data: { ...node.data, resourceState: state } }
  })
  return { ...hydrated, nodes }
}

function isEditableTextPath(value: string) {
  const extension = path.posix.extname(value).toLowerCase()
  return extension === ".md" || extension === ".txt"
}

function imageReadLabel(reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>) {
  return reference.kind === "project-file" ? reference.path : `managed:${reference.sha256}`
}

function imageMimeTypeForBytes(bytes: Uint8Array): ProjectCanvasImageRead["mimeType"] | null {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png"
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg"
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp"
  }
  return null
}

function isUrlResourceMediaType(mediaType: string) {
  return /^(?:audio|image|video)\//.test(mediaType) || mediaType === "application/pdf"
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}
