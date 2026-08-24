import type { CanvasResourceAnchorOrigin, CanvasResourceSource } from "./application"
import { getCanvasNodePresentationSize } from "./document"
import { classifyCanvasFileKind } from "./file-import"
import { getCanvasResourcePresentationSize } from "./media-sizing"
import type { CanvasGhostNode } from "./optimistic-overlay"
import { projectCanvasGhostNodeForReactFlow } from "./optimistic-overlay-react-flow"
import {
  canvasDocumentPlacementIndex,
  resolveIndexedCanvasResourcePlacements,
} from "./resource-placement"
import type { CanvasOptimisticResourcePresentation } from "./services"
import type { CanvasDocument, CanvasPoint, CanvasSize } from "./types"

export interface CanvasOptimisticResourceHandoffScheduler {
  cancelFrame(frameId: number): void
  requestFrame(callback: FrameRequestCallback): number
}

// The bound is only a recovery path for a renderer that never mounts. Four
// frames was shorter than an ordinary React Flow projection + selection commit,
// so it could remove the paint shield before the authority focus chrome existed.
export const CANVAS_OPTIMISTIC_HANDOFF_MAX_READINESS_FRAMES = 120

/**
 * Keeps the immediate ghost over an owner-derived node until that node has
 * mounted and completed one composited paint. requestAnimationFrame callbacks
 * run before paint, so a second frame is required after readiness is observed.
 */
export function scheduleCanvasOptimisticResourceHandoffAfterPaint(input: {
  isAuthorityReady?: () => boolean
  maximumReadinessFrames?: number
  onReady: () => void
  scheduler?: CanvasOptimisticResourceHandoffScheduler
}) {
  const scheduler =
    input.scheduler ??
    (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? ({
          cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
          requestFrame: (callback) => window.requestAnimationFrame(callback),
        } satisfies CanvasOptimisticResourceHandoffScheduler)
      : undefined)
  if (!scheduler) {
    input.onReady()
    return () => undefined
  }

  const maximumReadinessFrames = Math.max(
    1,
    Math.floor(input.maximumReadinessFrames ?? CANVAS_OPTIMISTIC_HANDOFF_MAX_READINESS_FRAMES),
  )
  let cancelled = false
  let frameId = 0
  let readinessFrames = 0
  let settled = false
  const settle = () => {
    if (cancelled || settled) return
    settled = true
    input.onReady()
  }
  const scheduleFrame = (callback: FrameRequestCallback) => {
    try {
      frameId = scheduler.requestFrame(callback)
      return true
    } catch {
      settle()
      return false
    }
  }
  const settleOnFollowingFrame = () => {
    scheduleFrame(settle)
  }
  const waitForAuthority = () => {
    if (cancelled) return
    readinessFrames += 1
    let authorityReady = true
    try {
      authorityReady = input.isAuthorityReady?.() ?? true
    } catch {
      settle()
      return
    }
    if (authorityReady || readinessFrames >= maximumReadinessFrames) {
      settleOnFollowingFrame()
      return
    }
    scheduleFrame(waitForAuthority)
  }
  scheduleFrame(waitForAuthority)

  return () => {
    cancelled = true
    if (frameId) scheduler.cancelFrame(frameId)
  }
}

/** Creates presentation-only resource ghosts from an authoritative snapshot. */
export function createOptimisticResourceGhosts(input: {
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  document: CanvasDocument
  files: readonly File[]
  intrinsicSizes?: readonly ({ readonly height: number; readonly width: number } | null)[]
  previewUrls?: readonly (string | null)[]
  parentPresentationKey?: string
  resolvedPositions?: readonly CanvasPoint[]
  createPresentationKey?: () => string
}): readonly CanvasGhostNode[] {
  return createGhostsFromSlots({
    ...input,
    slots: input.files.map((file, index) =>
      createLocalFileGhostSlot(file, input.intrinsicSizes?.[index], input.previewUrls?.[index]),
    ),
  })
}

/** Creates ghosts from a host-neutral cached presentation (for example a Project sidebar thumbnail). */
export function createOptimisticPreparedResourceGhosts(input: {
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  createPresentationKey?: () => string
  document: CanvasDocument
  parentPresentationKey?: string
  presentations: readonly CanvasOptimisticResourcePresentation[]
  resolvedPositions?: readonly CanvasPoint[]
}): readonly CanvasGhostNode[] {
  return createGhostsFromSlots({
    ...input,
    slots: input.presentations.map(createPreparedGhostSlot),
  })
}

/**
 * Projects every resource mutation slot in the service port's stable order:
 * local Files, explicit sources, then host-resolved drag sources. Null host
 * hints still reserve and paint a generic slot so later previews cannot overlap
 * or move when the authoritative batch arrives.
 */
export function createOptimisticAlignedResourceGhosts(input: {
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  createPresentationKey?: () => string
  document: CanvasDocument
  files: readonly File[]
  intrinsicSizes?: readonly ({ readonly height: number; readonly width: number } | null)[]
  parentPresentationKey?: string
  presentations: readonly (CanvasOptimisticResourcePresentation | null)[]
  previewUrls?: readonly (string | null)[]
  resolvedPositions?: readonly CanvasPoint[]
  sources: readonly CanvasResourceSource[]
}): readonly CanvasGhostNode[] {
  const minimumSlotCount = input.files.length + input.sources.length
  const slotCount = Math.max(minimumSlotCount, input.presentations.length)
  const slots = Array.from({ length: slotCount }, (_, index) => {
    if (index < input.files.length) {
      return createLocalFileGhostSlot(input.files[index]!, input.intrinsicSizes?.[index], input.previewUrls?.[index])
    }
    const prepared = input.presentations[index]
    if (prepared) return createPreparedGhostSlot(prepared)
    return createFallbackSourceGhostSlot(input.sources[index - input.files.length])
  })
  return createGhostsFromSlots({ ...input, slots })
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
  resolvedPositions?: readonly CanvasPoint[]
  createPresentationKey?: () => string
}): readonly CanvasGhostNode[] {
  const createKey = input.createPresentationKey ?? (() => `ghost-resource:${globalThis.crypto.randomUUID()}`)
  // Empty text becomes a proof-backed text resource; empty image/video becomes
  // the manual pending placeholder. Both authoritative paths use this policy.
  const size = getCanvasResourcePresentationSize(input.kind)
  const anchor = normalizeResourceAnchor(input.anchor, input.anchorOrigin, size)
  const [position] = input.resolvedPositions ??
    resolveGhostPlacements(input.document, anchor, [size], input.parentPresentationKey)
  const title = input.kind === "image" ? "Image" : input.kind === "video" ? "Video" : "Text"
  return Object.freeze([
    Object.freeze({
      kind: "ghost-node" as const,
      presentationKey: createKey(),
      ...(input.parentPresentationKey ? { parentPresentationKey: input.parentPresentationKey } : {}),
      position,
      presentation: Object.freeze({
        emptyCard: true as const,
        ...(input.kind === "text"
          ? { nodeType: "text" as const }
          : { mediaKind: input.kind, nodeType: "file" as const }),
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
      if (mimeType.startsWith("video/")) return inspectVideoFile(file, signal)
      return null
    }),
  )
}

async function inspectVideoFile(file: File, signal?: AbortSignal) {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return null
  }
  let url: string
  try {
    url = URL.createObjectURL(file)
  } catch {
    return null
  }
  const video = document.createElement("video")
  video.muted = true
  video.preload = "metadata"
  return new Promise<ReturnType<typeof positiveIntrinsicSize>>((resolve) => {
    let settled = false
    const finish = (size: ReturnType<typeof positiveIntrinsicSize>) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      video.removeAttribute("src")
      try {
        video.load()
      } catch {}
      URL.revokeObjectURL(url)
      resolve(size)
    }
    const onAbort = () => finish(null)
    const timeout = setTimeout(() => finish(null), 80)
    video.addEventListener("loadedmetadata", () => finish(positiveIntrinsicSize(video.videoWidth, video.videoHeight)), {
      once: true,
    })
    video.addEventListener("error", () => finish(null), { once: true })
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()
    else video.src = url
  })
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

interface CanvasOptimisticResourceGhostSlot {
  readonly presentation: CanvasGhostNode["presentation"]
  readonly size: CanvasSize
}

function createLocalFileGhostSlot(
  file: File,
  intrinsic: { readonly height: number; readonly width: number } | null | undefined,
  previewUrl: string | null | undefined,
): CanvasOptimisticResourceGhostSlot {
  const mimeType = normalizedMimeType(file.type)
  const classifiedKind = classifyCanvasFileKind({ name: file.name, type: mimeType })
  const nodeType = classifiedKind === "text" ? ("text" as const) : ("file" as const)
  const mediaKind = classifiedKind === "text" ? undefined : classifiedKind
  return Object.freeze({
    presentation: Object.freeze({
      ...(mediaKind ? { mediaKind } : {}),
      ...(mimeType ? { mimeType } : {}),
      nodeType,
      ...(previewUrl ? { previewUrl } : {}),
      title: file.name,
    }),
    size: Object.freeze(
      getCanvasResourcePresentationSize(nodeType === "text" ? "text" : (mediaKind ?? "file"), intrinsic ?? undefined),
    ),
  })
}

function createPreparedGhostSlot(
  presentation: CanvasOptimisticResourcePresentation,
): CanvasOptimisticResourceGhostSlot {
  return Object.freeze({
    presentation: Object.freeze({
      mediaKind: presentation.mediaKind,
      nodeType: "file" as const,
      ...(presentation.previewUrl ? { previewUrl: presentation.previewUrl } : {}),
      title: presentation.title,
    }),
    size: Object.freeze(getCanvasResourcePresentationSize(presentation.mediaKind, presentation.intrinsicSize)),
  })
}

function createFallbackSourceGhostSlot(source: CanvasResourceSource | undefined): CanvasOptimisticResourceGhostSlot {
  const isText = source?.kind === "new-text"
  return Object.freeze({
    presentation: Object.freeze(
      isText
        ? { nodeType: "text" as const, title: source.name ?? "Text" }
        : { mediaKind: "file" as const, nodeType: "file" as const, title: "Resource" },
    ),
    size: Object.freeze(getCanvasResourcePresentationSize(isText ? "text" : "file")),
  })
}

function createGhostsFromSlots(input: {
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  createPresentationKey?: () => string
  document: CanvasDocument
  parentPresentationKey?: string
  resolvedPositions?: readonly CanvasPoint[]
  slots: readonly CanvasOptimisticResourceGhostSlot[]
}): readonly CanvasGhostNode[] {
  if (input.slots.length === 0) return Object.freeze([])
  const createKey = input.createPresentationKey ?? (() => `ghost-resource:${globalThis.crypto.randomUUID()}`)
  const anchor = normalizeResourceAnchor(input.anchor, input.anchorOrigin, input.slots[0]?.size)
  const positions = input.resolvedPositions ??
    resolveGhostPlacements(
      input.document,
      anchor,
      input.slots.map(({ size }) => size),
      input.parentPresentationKey,
    )
  if (positions.length !== input.slots.length || positions.some((position) => !finiteGhostPoint(position))) {
    throw new RangeError("Optimistic resource placement is invalid")
  }
  return Object.freeze(
    input.slots.map(({ presentation, size }, index) =>
      Object.freeze({
        kind: "ghost-node" as const,
        presentationKey: createKey(),
        ...(input.parentPresentationKey ? { parentPresentationKey: input.parentPresentationKey } : {}),
        position: positions[index]!,
        presentation,
        size,
      }),
    ),
  )
}

function normalizeResourceAnchor(
  anchor: CanvasPoint,
  origin: CanvasResourceAnchorOrigin | undefined,
  firstSize: { height: number; width: number } | undefined,
) {
  if (origin !== "center" || !firstSize) return anchor
  return { x: anchor.x - firstSize.width / 2, y: anchor.y - firstSize.height / 2 }
}

function resolveGhostPlacements(
  document: CanvasDocument,
  anchor: CanvasPoint,
  sizes: readonly { height: number; width: number }[],
  parentPresentationKey?: string,
) {
  const positions = resolveIndexedCanvasResourcePlacements({
    anchor,
    index: canvasDocumentPlacementIndex(document, parentPresentationKey),
    sizes,
  })
  if (!positions) throw new RangeError("Optimistic resource placement is unavailable")
  return positions
}

function finiteGhostPoint(value: CanvasPoint) {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

function normalizedMimeType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase()
}
