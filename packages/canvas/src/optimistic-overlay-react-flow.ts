import { createMediaNode, createTextNode } from "./document"
import type { CanvasGhostEdge, CanvasGhostNode, CanvasReplacePresentation } from "./optimistic-overlay"
import type { CanvasEdge, CanvasNode } from "./types"

/** Last-mile adapter only. Returned values are never Canvas command inputs. */
export function projectCanvasGhostNodeForReactFlow(ghost: CanvasGhostNode): CanvasNode {
  const base = ghost.presentation.nodeType === "text"
    ? createTextNode({
        id: ghost.presentationKey,
        metadata: {},
        mimeType: ghost.presentation.mimeType,
        name: ghost.presentation.title,
        position: ghost.position,
        resourceState: { status: "ready", text: "" },
      })
    : createMediaNode({
        id: ghost.presentationKey,
        position: ghost.position,
        resource: {
          id: ghost.presentationKey,
          kind: ghost.presentation.mediaKind ?? "file",
          metadata: {},
          mimeType: ghost.presentation.mimeType,
          name: ghost.presentation.title,
          state: { status: "ready", url: "" },
        },
      })
  return {
    ...base,
    connectable: false,
    deletable: false,
    draggable: false,
    focusable: false,
    ...(ghost.parentPresentationKey ? { parentId: ghost.parentPresentationKey } : {}),
    selectable: false,
    selected: false,
    style: { ...base.style, height: ghost.size.height, width: ghost.size.width, opacity: 0.64 },
    data: { ...base.data, status: "pending" },
  }
}

export function projectCanvasGhostEdgeForReactFlow(ghost: CanvasGhostEdge): CanvasEdge {
  return {
    id: ghost.presentationKey,
    source: ghost.source.key,
    target: ghost.target.key,
    animated: true,
    deletable: false,
    focusable: false,
    selectable: false,
    style: { opacity: 0.64 },
    type: "canvas",
  }
}

export function applyCanvasReplacePresentation(
  node: CanvasNode,
  replacement: CanvasReplacePresentation | undefined,
): CanvasNode {
  if (!replacement) return node
  return {
    ...node,
    ...(replacement.position ? { position: replacement.position } : {}),
    ...(replacement.title ? { data: { ...node.data, label: replacement.title } } : {}),
    style: {
      ...node.style,
      ...(replacement.size ? { height: replacement.size.height, width: replacement.size.width } : {}),
      opacity: 0.64,
    },
  }
}
