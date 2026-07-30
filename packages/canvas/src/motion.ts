import type { CSSProperties } from "react"

type CanvasMotionStyle = CSSProperties & {
  "--canvas-motion-edge-loop": string
  "--canvas-motion-ease-elastic": string
  "--canvas-motion-ease-enter": string
  "--canvas-motion-ease-standard": string
  "--canvas-motion-feedback": string
  "--canvas-motion-generation-panel": string
  "--canvas-motion-menu": string
  "--canvas-motion-node-enter": string
  "--canvas-motion-port": string
  "--canvas-motion-press": string
  "--canvas-motion-selection-toolbar": string
  "--canvas-motion-surface": string
  "--canvas-motion-viewport": string
}

/**
 * One Canvas-owned motion scale shared by scripted viewport movement and CSS.
 * Values describe interaction priority rather than individual components.
 */
export const CANVAS_MOTION_DURATION = {
  doubleClickZoom: 250,
  edgeLoop: 500,
  feedback: 140,
  fit: 300,
  generationPanel: 200,
  menu: 100,
  nodeEnter: 220,
  postMutationReveal: 400,
  port: 156,
  press: 80,
  selectionToolbar: 150,
  stepZoom: 200,
  surface: 180,
  viewport: 300,
} as const

export const CANVAS_MOTION_EASING = {
  elastic: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  enter: "cubic-bezier(0.16, 1, 0.3, 1)",
  standard: "cubic-bezier(0.2, 0, 0, 1)",
} as const

export const CANVAS_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"
export const CANVAS_FORCED_COLORS_QUERY = "(forced-colors: active)"
export const CANVAS_NODE_ENTRY_TRACK_LIMIT = 512

export function resolveCanvasReducedMotion(hostPreference: boolean | undefined, osPreference: boolean) {
  return hostPreference ?? osPreference
}

export function resolveCanvasMotionDuration(duration: number, prefersReducedMotion: boolean) {
  return prefersReducedMotion ? 0 : duration
}

/**
 * Remembers explicit creation evidence separately from document hydration.
 * A bounded presented-id history prevents a virtualized node from replaying its
 * entrance when React Flow mounts it again.
 */
export class CanvasNodeEntryTracker {
  readonly limit: number
  #pending = new Set<string>()
  #presented = new Set<string>()
  #scopeKey: string

  constructor(scopeKey: string, presentedNodeIds: readonly string[] = [], limit = CANVAS_NODE_ENTRY_TRACK_LIMIT) {
    this.#scopeKey = scopeKey
    this.limit = Math.max(1, Math.trunc(limit))
    this.#rememberPresented(presentedNodeIds)
  }

  get scopeKey() {
    return this.#scopeKey
  }

  get pendingCount() {
    return this.#pending.size
  }

  hasPresented(nodeId: string) {
    return this.#presented.has(nodeId)
  }

  reset(scopeKey: string, presentedNodeIds: readonly string[] = []) {
    this.#scopeKey = scopeKey
    this.#pending.clear()
    this.#presented.clear()
    this.#rememberPresented(presentedNodeIds)
  }

  queue(scopeKey: string, nodeIds: readonly string[]) {
    if (scopeKey !== this.#scopeKey) return
    for (const nodeId of nodeIds) {
      if (!nodeId || this.#presented.has(nodeId) || this.#pending.has(nodeId)) continue
      this.#pending.add(nodeId)
      while (this.#pending.size > this.limit) {
        const oldest = this.#pending.values().next().value
        if (oldest === undefined) break
        this.#pending.delete(oldest)
      }
    }
  }

  activate(scopeKey: string, availableNodeIds: ReadonlySet<string>) {
    if (scopeKey !== this.#scopeKey) return []
    const entering: string[] = []
    for (const nodeId of this.#pending) {
      if (!availableNodeIds.has(nodeId)) continue
      entering.push(nodeId)
      this.#pending.delete(nodeId)
    }
    this.#rememberPresented(entering)
    return entering
  }

  cancel(scopeKey: string, nodeIds: readonly string[]) {
    if (scopeKey !== this.#scopeKey) return
    for (const nodeId of nodeIds) this.#pending.delete(nodeId)
  }

  #rememberPresented(nodeIds: readonly string[]) {
    for (const nodeId of nodeIds) {
      if (!nodeId) continue
      this.#presented.delete(nodeId)
      this.#presented.add(nodeId)
      while (this.#presented.size > this.limit) {
        const oldest = this.#presented.values().next().value
        if (oldest === undefined) break
        this.#presented.delete(oldest)
      }
    }
  }
}

interface CanvasMotionRect {
  height: number
  left: number
  top: number
  width: number
}

export function resolveCanvasRectEnterTransform(source: CanvasMotionRect, target: CanvasMotionRect) {
  if (
    ![source.height, source.left, source.top, source.width, target.height, target.left, target.top, target.width].every(
      Number.isFinite,
    ) ||
    source.width <= 0 ||
    source.height <= 0 ||
    target.width <= 0 ||
    target.height <= 0
  ) {
    return undefined
  }
  const sourceCenterX = source.left + source.width / 2
  const sourceCenterY = source.top + source.height / 2
  const targetCenterX = target.left + target.width / 2
  const targetCenterY = target.top + target.height / 2
  return {
    transform: `translate3d(${sourceCenterX - targetCenterX}px, ${sourceCenterY - targetCenterY}px, 0) scale(${source.width / target.width}, ${source.height / target.height})`,
    transformOrigin: "center",
  } as const
}

export function canvasMotionStyle(prefersReducedMotion: boolean): CanvasMotionStyle {
  const duration = (value: number) => `${resolveCanvasMotionDuration(value, prefersReducedMotion)}ms`
  return {
    "--canvas-motion-edge-loop": duration(CANVAS_MOTION_DURATION.edgeLoop),
    "--canvas-motion-feedback": duration(CANVAS_MOTION_DURATION.feedback),
    "--canvas-motion-generation-panel": duration(CANVAS_MOTION_DURATION.generationPanel),
    "--canvas-motion-menu": duration(CANVAS_MOTION_DURATION.menu),
    "--canvas-motion-node-enter": duration(CANVAS_MOTION_DURATION.nodeEnter),
    "--canvas-motion-port": duration(CANVAS_MOTION_DURATION.port),
    "--canvas-motion-press": duration(CANVAS_MOTION_DURATION.press),
    "--canvas-motion-selection-toolbar": duration(CANVAS_MOTION_DURATION.selectionToolbar),
    "--canvas-motion-surface": duration(CANVAS_MOTION_DURATION.surface),
    "--canvas-motion-viewport": duration(CANVAS_MOTION_DURATION.viewport),
    "--canvas-motion-ease-elastic": CANVAS_MOTION_EASING.elastic,
    "--canvas-motion-ease-enter": CANVAS_MOTION_EASING.enter,
    "--canvas-motion-ease-standard": CANVAS_MOTION_EASING.standard,
  }
}

export function canvasViewportEase(progress: number) {
  const bounded = Math.min(1, Math.max(0, progress))
  return bounded < 0.5 ? 4 * bounded ** 3 : 1 - (-2 * bounded + 2) ** 3 / 2
}

export function resolveCanvasCenteredZoomViewport(input: {
  bounds: { height: number; width: number }
  targetZoom: number
  viewport: { x: number; y: number; zoom: number }
}) {
  if (
    !Number.isFinite(input.targetZoom) ||
    input.targetZoom <= 0 ||
    !Number.isFinite(input.viewport.zoom) ||
    input.viewport.zoom <= 0 ||
    !Number.isFinite(input.bounds.width) ||
    !Number.isFinite(input.bounds.height) ||
    input.bounds.width <= 0 ||
    input.bounds.height <= 0
  ) {
    return undefined
  }
  const centerX = input.bounds.width / 2
  const centerY = input.bounds.height / 2
  const flowCenterX = (centerX - input.viewport.x) / input.viewport.zoom
  const flowCenterY = (centerY - input.viewport.y) / input.viewport.zoom
  return {
    x: centerX - flowCenterX * input.targetZoom,
    y: centerY - flowCenterY * input.targetZoom,
    zoom: input.targetZoom,
  }
}
