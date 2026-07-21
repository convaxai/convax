import {
  createCanvasId,
  getCanvasTextFileFormat,
  type CanvasResource,
  type CanvasTextResource,
  type CanvasUploadItem,
  type CanvasUploadRequest,
} from "@convax/canvas"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE } from "@convax/project-files/drag"

export interface CanvasUploadHost {
  copyProjectMediaFiles: (paths: readonly string[], signal: AbortSignal) => Promise<readonly CanvasResource[]>
  importLocalMediaFiles: (files: readonly File[], signal: AbortSignal) => Promise<readonly CanvasResource[]>
  projectId: string
  readProjectTextFile: (path: string, signal: AbortSignal) => Promise<{ content: string; contentRevision: string }>
}

export const canvasProjectEntryReferenceKey = "convaxProjectEntry"

function createTextResource(input: {
  contentRevision?: string
  mimeType?: string
  name: string
  text: string
  metadata?: Record<string, unknown>
}): CanvasTextResource {
  return {
    id: createCanvasId("resource"),
    kind: "text",
    mimeType: input.mimeType,
    name: input.name,
    metadata: input.metadata ?? {},
    state: {
      ...(input.contentRevision === undefined ? {} : { contentRevision: input.contentRevision }),
      status: "ready",
      text: input.text,
    },
  }
}

function projectEntryMetadata(entry: { kind: "directory" | "file"; path: string }) {
  return { [canvasProjectEntryReferenceKey]: { kind: entry.kind, path: entry.path } }
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
  const localItems = await Promise.all(
    request.files.map(async (file) => {
      const format = getCanvasTextFileFormat(file)
      if (!format) return requireResource(importedMedia, localMediaIndex++, file.name)
      const text = await file.text()
      if (request.signal.aborted) throw request.signal.reason
      return createTextResource({ mimeType: file.type, name: file.name, text })
    }),
  )

  const dragged = parseProjectEntryDrag(request.transfer?.data[PROJECT_ENTRY_DRAG_TYPE] ?? "")
  const projectEntries = dragged?.projectId === host.projectId ? dragged.entries : []
  const projectMediaEntries = projectEntries.filter((entry) => entry.kind === "file" && !getCanvasTextFileFormat(entry))
  const copiedMedia =
    projectMediaEntries.length > 0
      ? await host.copyProjectMediaFiles(
          projectMediaEntries.map((entry) => entry.path),
          request.signal,
        )
      : []
  let projectMediaIndex = 0
  const projectItems = await Promise.all(
    projectEntries.map(async (entry) => {
      const metadata = projectEntryMetadata(entry)
      if (entry.kind === "directory") {
        return {
          id: createCanvasId("resource"),
          kind: "folder" as const,
          metadata,
          name: entry.name,
          state: { status: "stale" },
        }
      }
      const format = getCanvasTextFileFormat(entry)
      if (!format) {
        const resource = requireResource(copiedMedia, projectMediaIndex++, entry.name)
        return { ...resource, metadata: { ...resource.metadata, ...metadata } }
      }
      const text = await host.readProjectTextFile(entry.path, request.signal)
      if (request.signal.aborted) throw request.signal.reason
      return createTextResource({
        contentRevision: text.contentRevision,
        mimeType: format === "markdown" ? "text/markdown" : "text/plain",
        name: entry.name,
        text: text.content,
        metadata,
      })
    }),
  )

  return [...localItems, ...projectItems]
}
