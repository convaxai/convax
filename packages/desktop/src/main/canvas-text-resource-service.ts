import type { CanvasApplicationService, CanvasResourceBusinessService } from "@convax/canvas/application"
import { assertResourceRef, canvasProjectionResourceMetadataKey } from "@convax/canvas/collaboration"
import type { CanvasNode } from "@convax/canvas/core"
import { ordinarySha256, parseProjectId } from "@convax/collaboration"
import { projectIndexResourceReferenceDigest, type ProjectIndexCurrentBlobReferencePort } from "@convax/project"
import { isEditableProjectTextPath, projectResourceBindingsKey } from "@convax/project/canvas"
import type { ProjectCanvasResourcePreparation } from "@convax/project/node"
import { ProjectTextFileConflictError, type ProjectTextFileCompareAndReplacePort } from "@convax/project-files"

export interface CanvasTextResourceWriteRequest {
  readonly actor: { readonly id: string; readonly kind: "agent" | "renderer" }
  readonly beforeRelink?: () => Promise<void>
  readonly canvasId: string
  readonly commandId: string
  readonly content: string
  readonly expectedContentRevision?: string
  readonly nodeId: string
  readonly signal?: AbortSignal
  readonly scopeId: string
}

export interface CanvasTextResourceWriteResult {
  readonly contentRevision: string
  readonly warnings: readonly string[]
}

export class CanvasTextResourceWriteConflictError extends Error {
  constructor(
    readonly expectedContentRevision: string,
    readonly actualContentRevision: string | null,
  ) {
    super("Canvas text resource changed outside this operation")
    this.name = "CanvasTextResourceWriteConflictError"
  }
}

export interface CanvasTextResourceWriter {
  save(request: CanvasTextResourceWriteRequest): Promise<CanvasTextResourceWriteResult>
}

export function createCanvasTextResourceWriter(input: {
  readonly application: Pick<CanvasApplicationService, "query">
  readonly currentResources: Pick<ProjectIndexCurrentBlobReferencePort, "queryCurrentResources">
  readonly files: ProjectTextFileCompareAndReplacePort
  readonly preparation: Pick<ProjectCanvasResourcePreparation, "prepare">
  readonly resources: Pick<CanvasResourceBusinessService, "relinkPreparedResource">
}): CanvasTextResourceWriter {
  return {
    async save(request) {
      if (Buffer.byteLength(request.content, "utf8") > 16 * 1024 * 1024) {
        throw new Error("Canvas text content is too large")
      }
      if (request.expectedContentRevision !== undefined && !/^[a-f0-9]{64}$/.test(request.expectedContentRevision)) {
        throw new Error("Canvas text content revision is invalid")
      }
      throwIfAborted(request.signal)
      const document = (await input.application.query({ canvasId: request.canvasId, scopeId: request.scopeId }))
        .projection
      throwIfAborted(request.signal)
      const matches = document.nodes.filter((node) => node.id === request.nodeId)
      const node = matches.length === 1 ? matches[0] : undefined
      const resource = node ? canonicalCanvasTextResource(node) : null
      if (!node || !resource) throw new Error("Canvas text resource is not editable")

      const currentResources = await input.currentResources.queryCurrentResources({
        projectId: parseProjectId(request.scopeId),
      })
      throwIfAborted(request.signal)
      const resourceEntry = currentResources.find(
        ({ reference }) =>
          reference.canonicalUri === resource.uri &&
          reference.blob.digest === resource.contentDigest &&
          reference.blob.mime === resource.mime &&
          reference.blob.byteLength === resource.byteLength &&
          projectIndexResourceReferenceDigest(reference) === resource.ownerProofDigest,
      )
      const path = resourceEntry?.storageClass === "project-file" ? resourceEntry.materializedPath : null
      if (!path || !isEditableProjectTextPath(path)) throw new Error("Canvas text resource is not editable")

      const expectedRevision = request.expectedContentRevision ?? resource.contentDigest
      const contentRevision = ordinarySha256(new TextEncoder().encode(request.content))
      throwIfAborted(request.signal)
      try {
        const saved = await input.files.compareAndReplaceTextFile({
          content: request.content,
          expectedRevision,
          path,
          projectId: request.scopeId,
        })
        if (saved.contentRevision !== contentRevision) {
          throw new Error("Canvas text resource write returned an unexpected revision")
        }
      } catch (error) {
        if (!(error instanceof ProjectTextFileConflictError)) throw error
        if (error.actualRevision !== contentRevision) {
          throw new CanvasTextResourceWriteConflictError(expectedRevision, error.actualRevision)
        }
      }

      const prepared = await input.preparation.prepare({
        canvasId: request.canvasId,
        scopeId: request.scopeId,
        sources: [{ kind: "host-file", path, sourceId: "text-save" }],
      })
      if (prepared.items.length !== 1) {
        throw new Error("Canvas text resource preparation did not return one file")
      }
      await request.beforeRelink?.()
      const result = await input.resources.relinkPreparedResource(
        {
          actor: request.actor,
          canvasId: request.canvasId,
          commandId: request.commandId,
          metadataKeysToRemove: [projectResourceBindingsKey],
          nodeId: request.nodeId,
          scopeId: request.scopeId,
        },
        prepared,
      )
      return { contentRevision, warnings: result.warnings }
    },
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas text resource write was canceled", "AbortError")
}

function canonicalCanvasTextResource(node: CanvasNode) {
  if (node.type !== "file" || node.data.kind !== "text") return null
  const metadata = node.data.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[canvasProjectionResourceMetadataKey]
  try {
    assertResourceRef(value)
  } catch {
    return null
  }
  return value.mediaClass === "text" ? value : null
}
