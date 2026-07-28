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

function sameProjectionValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameProjectionValue(value, right[index]))
    )
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
  const leftKeys = Object.keys(left).filter((key) => Reflect.get(left, key) !== undefined)
  const rightKeys = Object.keys(right).filter((key) => Reflect.get(right, key) !== undefined)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && sameProjectionValue(Reflect.get(left, key), Reflect.get(right, key)),
    )
  )
}

function sameNodeSemanticVector(current: CanvasDocument["nodes"], next: CanvasDocument["nodes"]) {
  return (
    current === next ||
    (current.length === next.length &&
      current.every((node, index) => {
        const candidate = next[index]
        return (
          candidate !== undefined &&
          node.id === candidate.id &&
          node.type === candidate.type &&
          node.parentId === candidate.parentId &&
          node.data === candidate.data
        )
      }))
  )
}

function isGeometryOnlyCanvasPreview(current: CanvasDocument, next: CanvasDocument) {
  return (
    current.id === next.id &&
    current.revision === next.revision &&
    sameProjectionValue(current.metadata, next.metadata) &&
    sameProjectionValue(current.edges, next.edges) &&
    sameNodeSemanticVector(current.nodes, next.nodes)
  )
}

/**
 * Keeps same-revision geometry previews local to the mounted editor. Renderer
 * hydration and other semantic changes may intentionally retain the revision,
 * so they still have to reach Desktop-wide projections.
 */
export function promoteCanvasDocumentProjection(
  current: CanvasDocument | null,
  next: CanvasDocument,
  activeCanvasId: string | undefined,
) {
  if (next.id !== activeCanvasId) return current
  if (current && isGeometryOnlyCanvasPreview(current, next)) return current
  return next
}
