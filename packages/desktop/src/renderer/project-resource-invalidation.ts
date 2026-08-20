import type { CanvasDocument, CanvasEditorHandle } from "@convax/canvas"
import { getProjectResourceReference } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type {
  CanvasResourceClient,
  CanvasResourceHydrationTarget,
  CanvasResourceRuntimePatch,
} from "../desktop-protocol"

const canvasResourceHydrationBatchSize = 256

export async function hydrateCanvasResourceTargetsInBatches(input: {
  canvasId: string
  client: Pick<CanvasResourceClient, "hydrateStale">
  sessionId: Parameters<CanvasResourceClient["hydrateStale"]>[0]["sessionId"]
  signal: AbortSignal
  targets: readonly CanvasResourceHydrationTarget[]
}): Promise<readonly CanvasResourceRuntimePatch[]> {
  const patches: CanvasResourceRuntimePatch[] = []
  for (let offset = 0; offset < input.targets.length; offset += canvasResourceHydrationBatchSize) {
    if (input.signal.aborted) throw input.signal.reason
    const batch = input.targets.slice(offset, offset + canvasResourceHydrationBatchSize)
    const result = await input.client.hydrateStale({
      canvasId: input.canvasId,
      sessionId: input.sessionId,
      targets: batch,
    })
    patches.push(...result.patches)
  }
  if (input.signal.aborted) throw input.signal.reason
  return patches
}

export function subscribeMountedCanvasResourceInvalidation(input: {
  currentEditor(): Pick<CanvasEditorHandle, "invalidateResources"> | null
  currentProjectId(): string | null
  currentSession(): { getProjection(): CanvasDocument } | null
  projectFiles: Pick<ProjectFilesClient, "onDidChange">
}) {
  return input.projectFiles.onDidChange((event) => {
    if (event.projectId !== input.currentProjectId()) return
    const editor = input.currentEditor()
    if (!editor) return
    if (event.path === undefined) {
      void editor.invalidateResources()
      return
    }
    const projection = input.currentSession()?.getProjection()
    if (!projection) {
      void editor.invalidateResources()
      return
    }
    const nodeIds = projection.nodes.flatMap((node) => {
      const reference = getProjectResourceReference(node.data.metadata)
      if (!reference || !("path" in reference)) return []
      const matches =
        reference.kind === "project-directory"
          ? portablePathContains(reference.path, event.path!) || portablePathContains(event.path!, reference.path)
          : portablePathContains(event.path!, reference.path)
      return matches ? [node.id] : []
    })
    if (nodeIds.length > 0) void editor.invalidateResources(nodeIds)
  })
}

function portablePathContains(ancestor: string, candidate: string): boolean {
  const normalizedAncestor = ancestor.normalize("NFC").toLowerCase()
  const normalizedCandidate = candidate.normalize("NFC").toLowerCase()
  return normalizedAncestor === normalizedCandidate ||
    (normalizedAncestor.length > 0 && normalizedCandidate.startsWith(`${normalizedAncestor}/`))
}
