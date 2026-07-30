import type { CanvasResourceMutationRequest } from "@convax/canvas"
import type { CanvasResourceSource } from "@convax/canvas/application"
import type { CanvasDocument } from "@convax/canvas/core"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE } from "@convax/project-files/drag"
import type { CanvasResourceClient } from "../desktop-protocol"

export interface CanvasUploadSources {
  localFiles: Array<{ file: File; mediaType?: string; name: string; sourceId: string }>
  sources: CanvasResourceSource[]
}

export interface CanvasUploadHost {
  createSourceId(): string
  projectId: string
}

export interface CanvasUploadRequest {
  files: readonly File[]
  signal: AbortSignal
  transfer?: {
    data: Readonly<Record<string, string>>
    types: readonly string[]
  }
}

export interface CanvasUploadMutationRequest extends CanvasResourceMutationRequest {
  canvasId: string
  projectId: string
}

export interface CanvasUploadMutationHost
  extends Pick<CanvasResourceClient, "add" | "createLocalFileToken"> {
  createCommandId(): string
  createSourceId(): string
  flushAuthoritativeCanvas(): Promise<Pick<CanvasDocument, "id" | "revision"> | undefined>
}

export function resolveCanvasUploadItems(request: CanvasUploadRequest, host: CanvasUploadHost): CanvasUploadSources {
  if (request.signal.aborted) throw request.signal.reason
  const localFiles = request.files.map((file) => ({
    file,
    ...(file.type ? { mediaType: file.type } : {}),
    name: file.name,
    sourceId: host.createSourceId(),
  }))
  const dragged = parseProjectEntryDrag(request.transfer?.data[PROJECT_ENTRY_DRAG_TYPE] ?? "")
  const sources: CanvasResourceSource[] =
    dragged?.projectId === host.projectId
      ? dragged.entries.map((entry) => ({
          kind: entry.kind === "directory" ? ("host-directory" as const) : ("host-file" as const),
          path: entry.path,
          sourceId: host.createSourceId(),
        }))
      : []
  return { localFiles, sources }
}

export async function addCanvasUploadResources(
  request: CanvasUploadMutationRequest,
  host: CanvasUploadMutationHost,
) {
  throwIfAborted(request.signal)
  const authoritativeDocument = await host.flushAuthoritativeCanvas()
  throwIfAborted(request.signal)
  if (!authoritativeDocument || authoritativeDocument.id !== request.canvasId) {
    throw new Error("Canvas upload could not resolve Main's authoritative document")
  }
  const transport = resolveCanvasUploadItems(
    {
      files: request.files ?? [],
      signal: request.signal,
      transfer: request.transfer,
    },
    { createSourceId: () => host.createSourceId(), projectId: request.projectId },
  )
  const localFiles = transport.localFiles.map(({ file, ...source }) => {
    const sourceToken = host.createLocalFileToken(file)
    if (!sourceToken) throw new Error("Only files from the local disk can be added to a Project Canvas")
    return { ...source, sourceToken }
  })
  throwIfAborted(request.signal)
  return host.add({
    anchor: request.anchor,
    canvasId: request.canvasId,
    commandId: host.createCommandId(),
    expectedRevision: authoritativeDocument.revision,
    localFiles,
    projectId: request.projectId,
    ...(request.relation === undefined ? {} : { relation: request.relation }),
    sources: [...request.sources, ...transport.sources],
  })
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  }
}
