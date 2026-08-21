import type { CanvasNode } from "../types"

export function resolveCanvasOnlyRenderVisibleElements(input: {
  assistantAvailable: boolean
  configured?: boolean
  editorAvailable: boolean
  selectedNodeKind?: CanvasNode["data"]["kind"]
}) {
  if (!(input.configured ?? true)) return false
  const keepsMediaComposerMounted =
    input.assistantAvailable &&
    input.editorAvailable &&
    (input.selectedNodeKind === "image" || input.selectedNodeKind === "video")
  return !keepsMediaComposerMounted
}
