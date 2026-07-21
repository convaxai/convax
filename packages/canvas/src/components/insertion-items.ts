import type { CanvasConnectionNodeType } from "../editor-context"
import type { CanvasFileRendererRegistry } from "../file-renderer-registry"
import type { CanvasNodeRegistry } from "../node-registry"

export function getCanvasNodeInsertionItems(
  fileRendererRegistry: CanvasFileRendererRegistry,
  nodeRegistry: CanvasNodeRegistry,
): readonly CanvasConnectionNodeType[] {
  return [
    ...fileRendererRegistry
      .list()
      .filter((definition) => !definition.hidden && definition.create)
      .map((definition) => ({ label: definition.label, type: definition.id })),
    ...nodeRegistry
      .list()
      .filter((definition) => !definition.hidden && definition.type === "agent")
      .map((definition) => ({ label: definition.label, type: definition.type })),
  ]
}
