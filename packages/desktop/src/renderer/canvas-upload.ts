import type { CanvasOptimisticResourcePresentation, CanvasResourceMutationRequest } from "@convax/canvas"
import type { CanvasResourceSource } from "@convax/canvas/application"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE, type ProjectEntryDragEntry } from "@convax/project-files/drag"
import type { CanvasResourceAddInput, CanvasResourceClient } from "../desktop-protocol"

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

export interface CanvasUploadMutationHost extends Pick<CanvasResourceClient, "add" | "createLocalFileToken"> {
  createCommandId(): string
  createSourceId(): string
  sessionId: CanvasResourceAddInput["sessionId"]
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

/**
 * Resolves presentation-only Project drag hints. The result is aligned with the
 * mutation's local files followed by its explicit and drag-resolved sources.
 */
export function resolveCanvasUploadPresentations(
  request: Pick<CanvasResourceMutationRequest, "files" | "signal" | "sources" | "transfer">,
  host: Pick<CanvasUploadHost, "projectId">,
): readonly (CanvasOptimisticResourcePresentation | null)[] {
  throwIfAborted(request.signal)
  const dragged = parseProjectEntryDrag(request.transfer?.data[PROJECT_ENTRY_DRAG_TYPE] ?? "")
  const draggedPresentations =
    dragged?.projectId === host.projectId ? dragged.entries.map(mapProjectEntryDragPresentation) : []
  return Object.freeze([
    ...(request.files ?? []).map(() => null),
    ...request.sources.map(() => null),
    ...draggedPresentations,
  ])
}

export function mapProjectEntryDragPresentation(
  entry: ProjectEntryDragEntry,
): CanvasOptimisticResourcePresentation | null {
  if (!entry.presentation) return null
  return Object.freeze({
    intrinsicSize: Object.freeze({
      height: entry.presentation.intrinsicHeight,
      width: entry.presentation.intrinsicWidth,
    }),
    mediaKind: entry.presentation.mediaKind,
    previewUrl: entry.presentation.thumbnailDataUrl,
    title: entry.name,
  })
}

export async function addCanvasUploadResources(request: CanvasUploadMutationRequest, host: CanvasUploadMutationHost) {
  throwIfAborted(request.signal)
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
    ...(request.anchorOrigin === undefined ? {} : { anchorOrigin: request.anchorOrigin }),
    canvasId: request.canvasId,
    commandId: host.createCommandId(),
    localFiles,
    ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
    ...(request.pending === undefined ? {} : { pending: request.pending }),
    projectId: request.projectId,
    sessionId: host.sessionId,
    ...(request.relation === undefined ? {} : { relation: request.relation }),
    sources: [...request.sources, ...transport.sources],
  })
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  }
}
