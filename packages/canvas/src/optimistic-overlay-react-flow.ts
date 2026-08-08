import { createMediaNode, createTextNode } from "./document"
import type { CanvasGhostEdge, CanvasGhostNode, CanvasReplacePresentation } from "./optimistic-overlay"
import type { CanvasEdge, CanvasNode } from "./types"

/** Last-mile adapter only. Returned values are never Canvas command inputs. */
export function projectCanvasGhostNodeForReactFlow(ghost: CanvasGhostNode): CanvasNode {
  if (ghost.snapshot) {
    return {
      id: ghost.presentationKey,
      type: ghost.snapshot.nodeType,
      position: ghost.snapshot.position,
      ...(ghost.snapshot.parentPresentationKey ? { parentId: ghost.snapshot.parentPresentationKey } : {}),
      data: { ...structuredClone(ghost.snapshot.data), status: "pending" },
      style: { height: ghost.snapshot.size.height, width: ghost.snapshot.size.width, opacity: 0.64 },
      ...(ghost.snapshot.zIndex === undefined ? {} : { zIndex: ghost.snapshot.zIndex }),
      connectable: false,
      deletable: false,
      draggable: false,
      focusable: false,
      selectable: false,
      selected: false,
    } as CanvasNode
  }
  const base =
    ghost.presentation.nodeType === "text"
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
    data: ghost.label === undefined ? {} : { label: ghost.label },
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
  if (replacement.snapshot) {
    return {
      ...node,
      type: replacement.snapshot.nodeType,
      position: replacement.snapshot.position,
      ...(replacement.snapshot.parentPresentationKey
        ? { parentId: replacement.snapshot.parentPresentationKey }
        : { parentId: undefined }),
      data: structuredClone(replacement.snapshot.data) as CanvasNode["data"],
      style: {
        ...node.style,
        height: replacement.snapshot.size.height,
        width: replacement.snapshot.size.width,
        opacity: 0.64,
      },
      zIndex: replacement.snapshot.zIndex,
    }
  }
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
