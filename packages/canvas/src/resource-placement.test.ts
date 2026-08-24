import { describe, expect, test } from "bun:test"
import {
  bindCanvasDocumentPlacementIndex,
  canvasDocumentPlacementIndex,
  canvasPlacementWorkCounts,
  createCanvasPlacementIndex,
  resolveCanvasResourcePlacements,
  resolveIndexedCanvasResourcePlacements,
} from "./resource-placement"

describe("resource placement", () => {
  test("uses one deterministic positive-X lane for authority and presentation", () => {
    expect(
      resolveCanvasResourcePlacements({
        anchor: { x: 0, y: 0 },
        obstacles: [
          { height: 180, width: 320, x: 0, y: 0 },
          { height: 180, width: 240, x: 344, y: 0 },
        ],
        sizes: [
          { height: 180, width: 320 },
          { height: 180, width: 240 },
        ],
      }),
    ).toEqual([
      { x: 608, y: 0 },
      { x: 952, y: 0 },
    ])
  })

  test("rejects invalid geometry instead of producing divergent placement", () => {
    expect(
      resolveCanvasResourcePlacements({
        anchor: { x: Number.NaN, y: 0 },
        obstacles: [],
        sizes: [{ height: 180, width: 320 }],
      }),
    ).toBeNull()
  })

  for (const obstacleCount of [256, 1_024, 4_096]) {
    test(`keeps one normal Add Text lookup logarithmic at N=${obstacleCount}`, () => {
      const obstacles = Array.from({ length: obstacleCount }, (_, index) => ({
        key: `node-${String(index).padStart(5, "0")}`,
        x: index * 512,
        y: 1_000,
        width: 320,
        height: 180,
      }))
      const index = createCanvasPlacementIndex(obstacles)
      const document = { id: `canvas-${obstacleCount}`, metadata: {}, nodes: [], edges: [] }
      bindCanvasDocumentPlacementIndex(document, index)
      const before = canvasPlacementWorkCounts()

      const positions = resolveIndexedCanvasResourcePlacements({
        anchor: { x: 0, y: 0 },
        index: canvasDocumentPlacementIndex(document),
        sizes: [{ height: 180, width: 320 }],
      })

      expect(positions).toEqual([{ x: 0, y: 0 }])
      const after = canvasPlacementWorkCounts()
      expect(after.fullObstacleTraversals - before.fullObstacleTraversals).toBe(0)
      expect(after.obstacleSortComparisons - before.obstacleSortComparisons).toBe(0)
      expect(after.optimisticFullNodeVisits - before.optimisticFullNodeVisits).toBe(0)
      expect(after.spatialQueryVisits - before.spatialQueryVisits).toBeLessThanOrEqual(
        8 * Math.ceil(Math.log2(obstacleCount + 1)) + 8,
      )
    })
  }

  for (const obstacleCount of [1, 1_000, 10_000]) {
    test(`does not visit same-X history outside the Add Text row at N=${obstacleCount}`, () => {
      const index = createCanvasPlacementIndex(
        Array.from({ length: obstacleCount }, (_, obstacleIndex) => ({
          height: 180,
          key: `far-y-${obstacleIndex}`,
          width: 320,
          x: 0,
          y: 10_000 + obstacleIndex * 512,
        })),
      )
      const before = canvasPlacementWorkCounts()
      expect(resolveIndexedCanvasResourcePlacements({
        anchor: { x: 0, y: 0 },
        index,
        sizes: [{ height: 180, width: 320 }],
      })).toEqual([{ x: 0, y: 0 }])
      const after = canvasPlacementWorkCounts()
      expect(after.spatialQueryVisits - before.spatialQueryVisits).toBeLessThanOrEqual(
        8 * Math.ceil(Math.log2(obstacleCount + 1)) + 8,
      )
    })
  }

  for (const obstacleCount of [1, 1_000, 10_000]) {
    test(`jumps across one dense Add Text lane without walking ${obstacleCount} collisions`, () => {
      const obstacles = Array.from({ length: obstacleCount }, (_, obstacleIndex) => ({
        height: 180,
        key: `dense-${obstacleIndex}`,
        width: 320,
        x: obstacleIndex * 344,
        y: 0,
      }))
      const unkeyed = obstacles.map(({ key: _key, ...obstacle }) => obstacle)
      const index = createCanvasPlacementIndex(obstacles)
      const before = canvasPlacementWorkCounts()
      const indexed = resolveIndexedCanvasResourcePlacements({
        anchor: { x: 0, y: 0 },
        index,
        sizes: [{ height: 180, width: 320 }],
      })
      const after = canvasPlacementWorkCounts()

      expect(indexed).toEqual([{ x: obstacleCount * 344, y: 0 }])
      expect(indexed).toEqual(resolveCanvasResourcePlacements({
        anchor: { x: 0, y: 0 },
        obstacles: unkeyed,
        sizes: [{ height: 180, width: 320 }],
      }))
      expect(after.fullObstacleTraversals - before.fullObstacleTraversals).toBe(0)
      expect(after.optimisticFullNodeVisits - before.optimisticFullNodeVisits).toBe(0)
      expect(after.spatialQueryVisits - before.spatialQueryVisits).toBeLessThanOrEqual(16)
    })
  }
})
