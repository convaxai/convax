import type { CanvasEditorHandle } from "@convax/canvas"
import type { ProjectFilesClient } from "@convax/project-files"

export function subscribeMountedCanvasResourceInvalidation(input: {
  currentEditor(): Pick<CanvasEditorHandle, "invalidateResources"> | null
  currentProjectId(): string | null
  projectFiles: Pick<ProjectFilesClient, "onDidChange">
}) {
  return input.projectFiles.onDidChange((event) => {
    if (event.projectId !== input.currentProjectId()) return
    void input.currentEditor()?.invalidateResources()
  })
}
