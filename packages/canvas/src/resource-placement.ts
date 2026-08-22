import type { CanvasPoint, CanvasSize } from "./types"

export interface CanvasPlacementObstacle extends CanvasPoint, CanvasSize {}

/**
 * Resolves the deterministic top-level resource placement shared by the
 * authoritative reducer and presentation-only ghosts.
 *
 * Every item starts at the same anchor and moves only along the positive X axis
 * until it clears the current Canvas obstacles and the items placed before it.
 */
export function resolveCanvasResourcePlacements(input: {
  anchor: CanvasPoint
  gap?: number
  obstacles: readonly CanvasPlacementObstacle[]
  sizes: readonly CanvasSize[]
}): readonly CanvasPoint[] | null {
  const gap = input.gap ?? 24
  if (
    !finitePoint(input.anchor) ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    input.obstacles.some((obstacle) => !finiteRect(obstacle)) ||
    input.sizes.some((size) => !finiteSize(size))
  ) {
    return null
  }

  const obstacles = input.obstacles.map((obstacle) => ({ ...obstacle }))
  const positions: CanvasPoint[] = []
  for (const size of input.sizes) {
    let position = { ...input.anchor }
    let iterations = 0
    while (true) {
      const collisions = obstacles.filter((obstacle) => intersectsWithGap(position, size, obstacle, gap))
      if (collisions.length === 0) break
      position = {
        x: Math.max(...collisions.map((obstacle) => obstacle.x + obstacle.width + gap)),
        y: position.y,
      }
      if (++iterations > obstacles.length + 1 || !Number.isFinite(position.x) || position.x > 10_000_000) {
        return null
      }
    }
    obstacles.push({ ...position, ...size })
    positions.push(position)
  }
  return Object.freeze(positions.map((position) => Object.freeze(position)))
}

function intersectsWithGap(position: CanvasPoint, size: CanvasSize, obstacle: CanvasPlacementObstacle, gap: number) {
  return (
    position.x < obstacle.x + obstacle.width + gap &&
    position.x + size.width + gap > obstacle.x &&
    position.y < obstacle.y + obstacle.height + gap &&
    position.y + size.height + gap > obstacle.y
  )
}

function finitePoint(value: CanvasPoint) {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

function finiteSize(value: CanvasSize) {
  return Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0
}

function finiteRect(value: CanvasPlacementObstacle) {
  return finitePoint(value) && finiteSize(value)
}
