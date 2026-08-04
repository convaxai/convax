import type { CanvasEditorHandle, CanvasViewRegistry } from "@convax/canvas"
import { getProjectResourceReference } from "@convax/project/canvas"
import type { CanvasRendererDocumentClient } from "../canvas-document-contracts"

export interface ProjectFileCanvasRevealScope {
  canvasId: string
  projectId: string
}

interface MountedCanvasEditorScope extends ProjectFileCanvasRevealScope {
  handle: Pick<CanvasEditorHandle, "reloadAuthoritative">
}

export async function revealProjectFileOnCanvas(input: {
  currentScope: () => ProjectFileCanvasRevealScope | null
  documents: Pick<CanvasRendererDocumentClient, "load">
  editor: () => MountedCanvasEditorScope | null
  path: string
  scope: ProjectFileCanvasRevealScope
  views: Pick<CanvasViewRegistry, "execute" | "list">
}) {
  const ref = { canvasId: input.scope.canvasId, scopeId: input.scope.projectId }
  const loaded = await input.documents.load(ref)
  if (!sameScope(input.currentScope(), input.scope) || !sameScope(input.editor(), input.scope)) return "stale"

  const nodeIds = (loaded.projection?.nodes ?? [])
    .filter((node) => {
      const reference = getProjectResourceReference(node.data.metadata)
      return reference?.kind === "project-file" && reference.path === input.path
    })
    .map((node) => node.id)
  if (nodeIds.length === 0) return "not-found"

  const view = activeView(input.views, input.scope)
  if (!view) return "stale"

  await input.views.execute({
    command: {
      animation: "smooth",
      fit: nodeIds.length === 1 ? "center" : "contain",
      nodeIds,
      select: true,
      type: "nodes.reveal",
    },
    expectedDocumentId: input.scope.canvasId,
    expectedScopeId: input.scope.projectId,
    viewId: view.viewId,
  })
  return "revealed"
}

function activeView(
  views: Pick<CanvasViewRegistry, "list">,
  scope: ProjectFileCanvasRevealScope,
) {
  return views
    .list()
    .find(
      (candidate) =>
        candidate.viewId === "desktop-main" &&
        candidate.scopeId === scope.projectId &&
        candidate.documentId === scope.canvasId,
    )
}

function sameScope(
  current: ProjectFileCanvasRevealScope | null,
  expected: ProjectFileCanvasRevealScope,
) {
  return current?.canvasId === expected.canvasId && current.projectId === expected.projectId
}
