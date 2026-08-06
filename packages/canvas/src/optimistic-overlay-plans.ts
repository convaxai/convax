import { getCanvasNodePresentationSize } from "./document"
import type {
  CanvasGhostEdge,
  CanvasGhostNode,
  CanvasHideEntity,
  CanvasOptimisticOverlayItem,
  CanvasPresentationEntityGuard,
  CanvasReplacePresentation,
} from "./optimistic-overlay"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "./types"

export function createCanvasDuplicateOverlay(input: {
  readonly document: CanvasDocument
  readonly nodeIds: readonly string[]
  readonly offset?: CanvasPoint
  readonly createPresentationKey?: (kind: "edge" | "node") => string
}): readonly CanvasOptimisticOverlayItem[] {
  const createKey = input.createPresentationKey ?? ((kind) => `ghost-${kind}:${globalThis.crypto.randomUUID()}`)
  const selected = new Set(input.nodeIds)
  const sourceNodes = input.document.nodes.filter((node) => selected.has(node.id))
  const keys = new Map(sourceNodes.map((node) => [node.id, createKey("node")]))
  const offset = input.offset ?? { x: 32, y: 32 }
  const nodes: CanvasGhostNode[] = sourceNodes.map((node) => {
    const key = keys.get(node.id)!
    const parentPresentationKey = node.parentId ? keys.get(node.parentId) ?? node.parentId : undefined
    return Object.freeze({
      kind: "ghost-node" as const,
      presentationKey: key,
      ...(parentPresentationKey ? { parentPresentationKey } : {}),
      position: Object.freeze({ x: node.position.x + offset.x, y: node.position.y + offset.y }),
      presentation: Object.freeze(canvasNodePresentation(node)),
      size: Object.freeze(getCanvasNodePresentationSize(node)),
    })
  })
  const edges: CanvasGhostEdge[] = input.document.edges.flatMap((edge) => {
    const source = keys.get(edge.source)
    const target = keys.get(edge.target)
    if (!source || !target) return []
    return [Object.freeze({
      kind: "ghost-edge" as const,
      presentationKey: createKey("edge"),
      source: Object.freeze({ key: source, side: "output" as const }),
      target: Object.freeze({ key: target, side: "input" as const }),
    })]
  })
  return Object.freeze([...nodes, ...edges])
}

export function createCanvasConnectionGhost(
  sourcePresentationKey: string,
  targetPresentationKey: string,
  createPresentationKey = () => `ghost-edge:${globalThis.crypto.randomUUID()}`,
): CanvasGhostEdge {
  return Object.freeze({
    kind: "ghost-edge",
    presentationKey: createPresentationKey(),
    source: Object.freeze({ key: sourcePresentationKey, side: "output" }),
    target: Object.freeze({ key: targetPresentationKey, side: "input" }),
  })
}

export function createCanvasHideEntityOverlay(entity: CanvasPresentationEntityGuard): CanvasHideEntity {
  return Object.freeze({ kind: "hide-entity", entity: Object.freeze({ ...entity }) })
}

export function createCanvasReplacePresentationOverlay(input: Omit<CanvasReplacePresentation, "kind">): CanvasReplacePresentation {
  return Object.freeze({ kind: "replace-presentation", ...input, entity: Object.freeze({ ...input.entity }) })
}

function canvasNodePresentation(node: CanvasNode): CanvasGhostNode["presentation"] {
  const nodeType = node.data.kind === "text" ? "text" as const : "file" as const
  const mediaKind =
    node.data.kind === "audio" || node.data.kind === "image" || node.data.kind === "video"
      ? node.data.kind
      : nodeType === "file"
        ? "file" as const
        : undefined
  return {
    ...(mediaKind ? { mediaKind } : {}),
    ...(typeof node.data.mimeType === "string" ? { mimeType: node.data.mimeType } : {}),
    nodeType,
    title: typeof node.data.name === "string" && node.data.name ? node.data.name : node.data.label,
  }
}
