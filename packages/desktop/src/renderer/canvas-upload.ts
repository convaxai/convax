import {
  createCanvasId,
  getCanvasTextFileFormat,
  type CanvasResource,
  type CanvasTextFormat,
  type CanvasTextResource,
  type CanvasUploadItem,
  type CanvasUploadRequest,
} from "@convax/canvas"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE } from "@convax/project"

export interface CanvasUploadHost {
  copyProjectMediaFiles: (paths: readonly string[], signal: AbortSignal) => Promise<readonly CanvasResource[]>
  importLocalMediaFiles: (files: readonly File[], signal: AbortSignal) => Promise<readonly CanvasResource[]>
  projectId: string
  readProjectTextFile: (path: string, signal: AbortSignal) => Promise<string>
}

function createTextResource(input: {
  format: CanvasTextFormat
  mimeType?: string
  name: string
  text: string
}): CanvasTextResource {
  return {
    format: input.format,
    id: createCanvasId("resource"),
    kind: "text",
    mimeType: input.mimeType,
    name: input.name,
    text: input.text,
  }
}

function requireResource(resources: readonly CanvasResource[], index: number, name: string) {
  const resource = resources[index]
  if (resource) return resource
  throw new Error(`Could not import ${name}`)
}

export async function resolveCanvasUploadItems(
  request: CanvasUploadRequest,
  host: CanvasUploadHost,
): Promise<readonly CanvasUploadItem[]> {
  if (request.signal.aborted) throw request.signal.reason

  const localMediaFiles = request.files.filter((file) => !getCanvasTextFileFormat(file))
  const importedMedia = await host.importLocalMediaFiles(localMediaFiles, request.signal)
  let localMediaIndex = 0
  const localItems = await Promise.all(request.files.map(async (file) => {
    const format = getCanvasTextFileFormat(file)
    if (!format) return requireResource(importedMedia, localMediaIndex++, file.name)
    const text = await file.text()
    if (request.signal.aborted) throw request.signal.reason
    return createTextResource({ format, mimeType: file.type, name: file.name, text })
  }))

  const dragged = parseProjectEntryDrag(request.transfer?.data[PROJECT_ENTRY_DRAG_TYPE] ?? "")
  const projectEntries = dragged?.projectId === host.projectId
    ? dragged.entries.filter((entry) => entry.kind === "file")
    : []
  const projectMediaEntries = projectEntries.filter((entry) => !getCanvasTextFileFormat(entry))
  const copiedMedia = await host.copyProjectMediaFiles(
    projectMediaEntries.map((entry) => entry.path),
    request.signal,
  )
  let projectMediaIndex = 0
  const projectItems = await Promise.all(projectEntries.map(async (entry) => {
    const format = getCanvasTextFileFormat(entry)
    if (!format) return requireResource(copiedMedia, projectMediaIndex++, entry.name)
    const text = await host.readProjectTextFile(entry.path, request.signal)
    if (request.signal.aborted) throw request.signal.reason
    return createTextResource({
      format,
      mimeType: format === "markdown" ? "text/markdown" : "text/plain",
      name: entry.name,
      text,
    })
  }))

  return [...localItems, ...projectItems]
}
