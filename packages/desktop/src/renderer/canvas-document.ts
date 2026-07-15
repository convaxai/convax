import { createCanvasDocument, type CanvasDocument } from "@convax/canvas"

export function createInitialCanvasDocument(input: {
  canvasId: string
  canvasName?: string
  projectName?: string
}): CanvasDocument {
  return createCanvasDocument({
    id: input.canvasId,
    title: input.canvasName ?? (input.projectName ? `${input.projectName} canvas` : "Untitled canvas"),
    description: input.projectName ? `Canvas for ${input.projectName}` : undefined,
  })
}
