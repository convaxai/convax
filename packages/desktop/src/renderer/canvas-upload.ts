import type { CanvasResourceSource } from "@convax/canvas/application"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE } from "@convax/project-files/drag"

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
