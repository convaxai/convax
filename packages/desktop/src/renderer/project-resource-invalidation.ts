import type { CanvasEditorHandle } from "@convax/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type {
  CanvasResourceClient,
  CanvasResourceHydrationTarget,
  CanvasResourceRuntimePatch,
} from "../desktop-protocol"
import { projectResourceHierarchySegments } from "../project-resource-hierarchy-key"

const canvasResourceHydrationBatchSize = 256

export async function hydrateCanvasResourceTargetsInBatches(input: {
  client: Pick<CanvasResourceClient, "hydrateStale">
  ref: Parameters<CanvasResourceClient["hydrateStale"]>[0]["ref"]
  sessionId: Parameters<CanvasResourceClient["hydrateStale"]>[0]["sessionId"]
  signal: AbortSignal
  targets: readonly CanvasResourceHydrationTarget[]
}): Promise<readonly CanvasResourceRuntimePatch[]> {
  const patches: CanvasResourceRuntimePatch[] = []
  for (let offset = 0; offset < input.targets.length; offset += canvasResourceHydrationBatchSize) {
    if (input.signal.aborted) throw input.signal.reason
    const batch = input.targets.slice(offset, offset + canvasResourceHydrationBatchSize)
    const result = await input.client.hydrateStale({
      ref: input.ref,
      sessionId: input.sessionId,
      targets: batch,
    })
    patches.push(...result.patches)
  }
  if (input.signal.aborted) throw input.signal.reason
  return patches
}

export function subscribeMountedCanvasResourceInvalidation(input: {
  currentEditor(): Pick<CanvasEditorHandle, "invalidateResources" | "invalidateResourcesAtHierarchyKey"> | null
  currentProjectId(): string | null
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
    void editor.invalidateResourcesAtHierarchyKey({
      segments: projectResourceHierarchySegments(event.path),
    })
  })
}
