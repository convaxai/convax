import {
  canvasFolderFocusEntryLimit,
  type CanvasDocument,
  type CanvasFolderBrowseService,
} from "@convax/canvas"
import { getProjectResourceReference, requireProjectResourceReference } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"

interface ActiveFolderBrowseScope {
  canvasId: string
  projectId: string
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Folder browsing was canceled", "AbortError")
}

function sameScope(left: ActiveFolderBrowseScope | null, right: ActiveFolderBrowseScope) {
  return left?.canvasId === right.canvasId && left.projectId === right.projectId
}

function requireActiveScope(
  currentScope: () => ActiveFolderBrowseScope | null,
  expected: ActiveFolderBrowseScope,
) {
  if (!sameScope(currentScope(), expected)) throw new Error("The active Canvas changed while browsing the folder")
}

function requireDirectoryId(value: string) {
  const reference = requireProjectResourceReference({ kind: "project-directory", path: value })
  if (reference.kind !== "project-directory") throw new Error("Project folder navigation requires a directory")
  return reference.path
}

function isSameOrDescendant(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(`${root}/`)
}

function folderPath(root: string, current: string) {
  const rootSegments = root.split("/")
  const currentSegments = current.split("/")
  return currentSegments.slice(rootSegments.length - 1).map((label, index) => {
    const segmentCount = rootSegments.length + index
    return { id: currentSegments.slice(0, segmentCount).join("/"), label }
  })
}

export function createProjectFolderBrowseService(input: {
  currentScope: () => ActiveFolderBrowseScope | null
  flush: () => Promise<CanvasDocument | undefined>
  projectFiles: Pick<ProjectFilesClient, "listDirectory" | "onDidChange">
}): CanvasFolderBrowseService {
  return {
    async list(request) {
      throwIfAborted(request.signal)
      const scope = input.currentScope()
      if (!scope || scope.canvasId !== request.context.documentId) {
        throw new Error("Open the active Project Canvas before browsing a folder")
      }
      const document = await input.flush()
      throwIfAborted(request.signal)
      requireActiveScope(input.currentScope, scope)
      if (!document || document.id !== scope.canvasId) {
        throw new Error("The authoritative Canvas document is unavailable")
      }
      const owner = document.nodes.find((node) => node.id === request.ownerNodeId)
      const reference = owner?.data.kind === "folder" ? getProjectResourceReference(owner.data.metadata) : null
      if (!reference || reference.kind !== "project-directory") {
        throw new Error("The Canvas folder no longer references a Project directory")
      }
      const directoryId = request.directoryId === undefined ? reference.path : requireDirectoryId(request.directoryId)
      if (!isSameOrDescendant(reference.path, directoryId)) {
        throw new Error("The requested directory is outside the owning folder")
      }

      const listing = await input.projectFiles.listDirectory({ path: directoryId, projectId: scope.projectId })
      throwIfAborted(request.signal)
      requireActiveScope(input.currentScope, scope)
      if (listing.projectId !== scope.projectId || listing.path !== directoryId) {
        throw new Error("Project Files returned a listing for a different directory")
      }
      for (const entry of listing.entries) {
        const expectedPath = `${directoryId}/${entry.name}`
        if (entry.parentPath !== directoryId || entry.path !== expectedPath) {
          throw new Error("Project Files returned an entry outside the requested directory")
        }
      }
      return {
        entries: listing.entries.slice(0, canvasFolderFocusEntryLimit).map((entry) => ({
          id: entry.path,
          kind: entry.kind === "directory" ? ("folder" as const) : ("file" as const),
          label: entry.name,
        })),
        path: folderPath(reference.path, directoryId),
        totalCount: listing.entries.length,
        truncated: listing.entries.length > canvasFolderFocusEntryLimit,
      }
    },
    subscribe(listener) {
      return input.projectFiles.onDidChange((event) => {
        const scope = input.currentScope()
        if (scope?.projectId === event.projectId) listener()
      })
    },
  }
}
