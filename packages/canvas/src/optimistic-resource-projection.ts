import { findOpenCanvasPoint } from "./application"
import type { CanvasResourceAnchorOrigin } from "./application"
import { createMediaNode, createTextNode, getCanvasNodePresentationSize } from "./document"
import { classifyCanvasFileKind } from "./file-import"
import { getCanvasResourcePresentationSize } from "./media-sizing"
import type { CanvasGhostNode } from "./optimistic-overlay"
import { projectCanvasGhostNodeForReactFlow } from "./optimistic-overlay-react-flow"
import type { CanvasDocument, CanvasPoint } from "./types"

const ghostGap = 32

/** Creates presentation-only resource ghosts from an authoritative snapshot. */
export function createOptimisticResourceGhosts(input: {
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  document: CanvasDocument
  files: readonly File[]
  intrinsicSizes?: readonly ({ readonly height: number; readonly width: number } | null)[]
  parentPresentationKey?: string
  createPresentationKey?: () => string
}): readonly CanvasGhostNode[] {
  const createKey = input.createPresentationKey ?? (() => `ghost-resource:${globalThis.crypto.randomUUID()}`)
  const ghosts: CanvasGhostNode[] = []
  for (const [index, file] of input.files.entries()) {
    const mimeType = normalizedMimeType(file.type)
    const classifiedKind = classifyCanvasFileKind({ name: file.name, type: mimeType })
    const nodeType = classifiedKind === "text" ? ("text" as const) : ("file" as const)
    const mediaKind = classifiedKind === "text" ? undefined : classifiedKind
    const intrinsic = input.intrinsicSizes?.[index]
    const size = getCanvasResourcePresentationSize(
      nodeType === "text" ? "text" : (mediaKind ?? "file"),
      intrinsic ?? undefined,
    )
    let preferred = {
      x: input.anchor.x + index * (size.width + ghostGap) - (input.anchorOrigin === "center" ? size.width / 2 : 0),
      y: input.anchor.y - (input.anchorOrigin === "center" ? size.height / 2 : 0),
    }
    let position = findOpenCanvasPoint(input.document, preferred, size, undefined, input.parentPresentationKey)
    while (ghosts.some((ghost) => intersects(position, size, ghost.position, ghost.size))) {
      preferred = { x: position.x + size.width + ghostGap, y: position.y }
      position = findOpenCanvasPoint(input.document, preferred, size, undefined, input.parentPresentationKey)
    }
    ghosts.push(
      Object.freeze({
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
      }),
    )
  }
  return Object.freeze(ghosts)
}

export function isEmptyLocalCanvasResourceCreate(input: {
  files?: readonly File[]
  pending?: { kind: "image" | "video" }
  sources: readonly { kind: string }[]
}) {
  if (input.files && input.files.length > 0) return false
  if (input.pending) return true
  return input.sources.length > 0 && input.sources.every((source) => source.kind === "new-text")
}

/**
 * Immediate empty text/image/video cards. These must not invent a File, wait for
 * dropped-byte decoding, or pretend to be a generation job.
 */
export function createOptimisticEmptyNodeGhosts(input: {
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  document: CanvasDocument
  kind: "image" | "text" | "video"
  parentPresentationKey?: string
  createPresentationKey?: () => string
}): readonly CanvasGhostNode[] {
  const createKey = input.createPresentationKey ?? (() => `ghost-resource:${globalThis.crypto.randomUUID()}`)
  const placeholder =
    input.kind === "text"
      ? createTextNode({
          metadata: {},
          position: { x: 0, y: 0 },
          resourceState: { status: "ready", text: "" },
        })
      : createMediaNode({
          position: { x: 0, y: 0 },
          resource: { id: input.kind, kind: input.kind, metadata: {}, state: { status: "ready" } },
        })
  const size = getCanvasNodePresentationSize(placeholder)
  const preferred = {
    x: input.anchor.x - (input.anchorOrigin === "center" ? size.width / 2 : 0),
    y: input.anchor.y - (input.anchorOrigin === "center" ? size.height / 2 : 0),
  }
  const position = findOpenCanvasPoint(input.document, preferred, size, undefined, input.parentPresentationKey)
  const title = input.kind === "image" ? "Image" : input.kind === "video" ? "Video" : "Text"
  return Object.freeze([
    Object.freeze({
      kind: "ghost-node" as const,
      presentationKey: createKey(),
      ...(input.parentPresentationKey ? { parentPresentationKey: input.parentPresentationKey } : {}),
      position: Object.freeze(position),
      presentation: Object.freeze({
        emptyCard: true as const,
        ...(input.kind === "text" ? { nodeType: "text" as const } : { mediaKind: input.kind, nodeType: "file" as const }),
        title,
      }),
      size: Object.freeze(size),
    }),
  ])
}

/**
 * Best-effort renderer probe used only to size a presentation ghost. Main must
 * independently inspect the admitted Project resource before the durable create.
 */
export async function inspectDroppedCanvasResourcePresentations(
  files: readonly File[],
  signal?: AbortSignal,
): Promise<readonly ({ readonly height: number; readonly width: number } | null)[]> {
  return Promise.all(
    files.map(async (file) => {
      signal?.throwIfAborted()
      const mimeType = normalizedMimeType(file.type)
      if (mimeType.startsWith("image/")) return inspectImageFile(file, signal)
      return null
    }),
  )
}

async function inspectImageFile(file: File, signal?: AbortSignal) {
  if (file.size > 64 * 1024 * 1024 || typeof globalThis.createImageBitmap !== "function") return null
  try {
    const bitmap = await globalThis.createImageBitmap(file)
    try {
      signal?.throwIfAborted()
      return positiveIntrinsicSize(bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    return null
  }
}

function positiveIntrinsicSize(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? Object.freeze({ height, width })
    : null
}

/** Final React Flow adapter. Its output must never be fed back to Canvas APIs. */
export const projectCanvasResourceGhostForReactFlow = projectCanvasGhostNodeForReactFlow

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

function normalizedMimeType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase()
}
