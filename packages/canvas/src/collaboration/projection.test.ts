import { describe, expect, test } from "bun:test"
import { buildCanvasProjectionIndex, obstacleProjectionDigest } from "./projection"
import { context, createAgent, newCanvas } from "./test-fixtures.test"
import { validateCanvasYDoc } from "./ydoc"

describe("Canvas projection snapshot cache", () => {
  test("reuses one immutable snapshot and misses after a Y.Doc mutation creates the next snapshot", () => {
    const document = newCanvas()
    const first = validateCanvasYDoc(document)
    const firstIndex = buildCanvasProjectionIndex(first)
    const firstObstacleDigest = obstacleProjectionDigest(first)

    expect(buildCanvasProjectionIndex(first)).toBe(firstIndex)
    expect(obstacleProjectionDigest(first)).toBe(firstObstacleDigest)

    createAgent(document, context(1, 1, 1), "created after snapshot")
    const second = validateCanvasYDoc(document)
    const secondIndex = buildCanvasProjectionIndex(second)

    expect(second).not.toBe(first)
    expect(secondIndex).not.toBe(firstIndex)
    expect(secondIndex.projection.nodes).toHaveLength(1)
    expect(obstacleProjectionDigest(second)).not.toBe(firstObstacleDigest)
  })
})
