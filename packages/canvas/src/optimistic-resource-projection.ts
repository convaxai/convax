import { findOpenCanvasPoint } from "./application"
import { getCanvasTextFileFormat } from "./file-import"
import type { CanvasGhostNode } from "./optimistic-overlay"
import { projectCanvasGhostNodeForReactFlow } from "./optimistic-overlay-react-flow"
import type { CanvasDocument, CanvasPoint } from "./types"

const ghostGap = 32

/** Creates presentation-only resource ghosts from an authoritative snapshot. */
export function createOptimisticResourceGhosts(input: {
  anchor: CanvasPoint
  document: CanvasDocument
  files: readonly File[]
  parentPresentationKey?: string
  createPresentationKey?: () => string
}): readonly CanvasGhostNode[] {
  const createKey = input.createPresentationKey ?? (() => `ghost-resource:${globalThis.crypto.randomUUID()}`)
  const ghosts: CanvasGhostNode[] = []
  for (const [index, file] of input.files.entries()) {
    const mimeType = normalizedMimeType(file.type)
    const nodeType = getCanvasTextFileFormat({ name: file.name, type: mimeType }) ? "text" as const : "file" as const
    const mediaKind = nodeType === "file" ? mediaKindForMimeType(mimeType) : undefined
    const size = resourceGhostSize(nodeType, mediaKind)
    let preferred = { x: input.anchor.x + index * (size.width + ghostGap), y: input.anchor.y }
    let position = findOpenCanvasPoint(input.document, preferred, size, undefined, input.parentPresentationKey)
    while (ghosts.some((ghost) => intersects(position, size, ghost.position, ghost.size))) {
      preferred = { x: position.x + size.width + ghostGap, y: position.y }
      position = findOpenCanvasPoint(input.document, preferred, size, undefined, input.parentPresentationKey)
    }
    ghosts.push(Object.freeze({
      kind: "ghost-node",
      presentationKey: createKey(),
      ...(input.parentPresentationKey ? { parentPresentationKey: input.parentPresentationKey } : {}),
      position: Object.freeze(position),
      presentation: Object.freeze({
        ...(mediaKind ? { mediaKind } : {}),
        ...(mimeType ? { mimeType } : {}),
        nodeType,
        title: file.name,
      }),
      size: Object.freeze(size),
    }))
  }
  return Object.freeze(ghosts)
}

/** Final React Flow adapter. Its output must never be fed back to Canvas APIs. */
export const projectCanvasResourceGhostForReactFlow = projectCanvasGhostNodeForReactFlow

function resourceGhostSize(
  nodeType: CanvasGhostNode["presentation"]["nodeType"],
  mediaKind?: CanvasGhostNode["presentation"]["mediaKind"],
) {
  if (nodeType === "text") return { height: 300, width: 360 }
  if (mediaKind === "audio") return { height: 132, width: 360 }
  return { height: 260, width: 360 }
}

function intersects(
  leftPosition: CanvasPoint,
  leftSize: { height: number; width: number },
  rightPosition: CanvasPoint,
  rightSize: { height: number; width: number },
) {
  return !(
    leftPosition.x + leftSize.width + ghostGap <= rightPosition.x ||
    rightPosition.x + rightSize.width + ghostGap <= leftPosition.x ||
    leftPosition.y + leftSize.height + ghostGap <= rightPosition.y ||
    rightPosition.y + rightSize.height + ghostGap <= leftPosition.y
  )
}

function mediaKindForMimeType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image" as const
  if (mimeType.startsWith("video/")) return "video" as const
  if (mimeType.startsWith("audio/")) return "audio" as const
  return "file" as const
}

function normalizedMimeType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase()
}
