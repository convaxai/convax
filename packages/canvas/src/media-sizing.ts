import type { CanvasDocument, CanvasMediaNodeData, CanvasSize } from "./types"

export const defaultCanvasMediaBounds = { height: 320, width: 320 } as const

export function getCanvasResourcePresentationSize(
  kind: "audio" | "file" | "folder" | "image" | "text" | "video",
  intrinsic?: Readonly<{ height?: number; width?: number }>,
): CanvasSize {
  if ((kind === "image" || kind === "video") && intrinsic) {
    const fitted = fitCanvasMediaSizeWithinBounds(intrinsic.width, intrinsic.height)
    if (fitted) return fitted
  }
  if (kind === "text") return { height: 180, width: 320 }
  if (kind === "audio") return { height: 132, width: 360 }
  return { height: 180, width: 240 }
}

function positiveDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function fitCanvasMediaSizeWithinBounds(
  intrinsicWidth: unknown,
  intrinsicHeight: unknown,
  bounds: CanvasSize = defaultCanvasMediaBounds,
): CanvasSize | null {
  if (
    !positiveDimension(intrinsicWidth) ||
    !positiveDimension(intrinsicHeight) ||
    !positiveDimension(bounds.width) ||
    !positiveDimension(bounds.height)
  ) {
    return null
  }
  const scale = Math.min(bounds.width / intrinsicWidth, bounds.height / intrinsicHeight, 1)
  return {
    width: Math.max(1, Math.round(intrinsicWidth * scale)),
    height: Math.max(1, Math.round(intrinsicHeight * scale)),
  }
}

export function fitCanvasMediaNodeToIntrinsicSize(
  document: CanvasDocument,
  input: {
    height: number
    nodeId: string
    preserveFrame?: boolean
    sourceUrl: string
    width: number
  },
): CanvasDocument {
  const node = document.nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node || (node.data.kind !== "image" && node.data.kind !== "video")) {
    return document
  }

  const data = node.data as CanvasMediaNodeData
  if (data.resourceState?.url !== input.sourceUrl) return document
  if (!positiveDimension(input.width) || !positiveDimension(input.height)) return document

  const nextData = { ...data, height: input.height, width: input.width }
  if (data.fit === "cover" || input.preserveFrame) {
    return {
      ...document,
      nodes: document.nodes.map((candidate) =>
        candidate.id === node.id ? { ...candidate, data: nextData } : candidate,
      ),
    }
  }

  const currentWidth = positiveDimension(node.style?.width)
    ? node.style.width
    : positiveDimension(node.width)
      ? node.width
      : positiveDimension(node.measured?.width)
        ? node.measured.width
        : undefined
  const currentHeight = positiveDimension(node.style?.height)
    ? node.style.height
    : positiveDimension(node.height)
      ? node.height
      : positiveDimension(node.measured?.height)
        ? node.measured.height
        : undefined
  const alreadyKnowsIntrinsicSize = positiveDimension(data.width) && positiveDimension(data.height)
  const currentSizeWithinBounds =
    currentWidth !== undefined &&
    currentHeight !== undefined &&
    currentWidth <= defaultCanvasMediaBounds.width &&
    currentHeight <= defaultCanvasMediaBounds.height
  if (alreadyKnowsIntrinsicSize && currentSizeWithinBounds) return document

  const fitted = fitCanvasMediaSizeWithinBounds(input.width, input.height)
  if (!fitted) return document

  return {
    ...document,
    nodes: document.nodes.map((candidate) =>
      candidate.id === node.id
        ? {
            ...candidate,
            data: nextData,
            height: undefined,
            initialHeight: undefined,
            initialWidth: undefined,
            measured: undefined,
            style: { ...candidate.style, height: fitted.height, width: fitted.width },
            width: undefined,
          }
        : candidate,
    ),
  }
}
