import { describe, expect, test } from "bun:test"

import {
  assertCanvasDuplicateFastPathAcceptance,
  canvasBenchmarkId,
  canvasDuplicateFastPathAcceptance,
  runCanvasDuplicateBenchmarkCell,
} from "./canvas-duplicate-durable-benchmark"
import { durableBusinessStages } from "./project-index-durable-benchmark"

describe.skipIf(process.platform === "win32")("ordinary Canvas duplicate durable benchmark", () => {
  test("allocates distinct operation ids beyond the one-byte boundary", () => {
    expect(canvasBenchmarkId(255)).not.toBe(canvasBenchmarkId(256))
    expect(() => canvasBenchmarkId(0x1_0000_0000)).toThrow("uint32")
  })

  test("keeps the acceptance cell pinned to 512 nodes, real warm persistence, and 20 samples", () => {
    expect(canvasDuplicateFastPathAcceptance.selectedCell).toEqual({
      mode: "real",
      temperature: "warm",
      nodeCount: 512,
      retainedFrames: 32,
      samples: 20,
    })
  })

  test("defines fail-closed fast-path and fallback acceptance", () => {
    expect(() =>
      assertCanvasDuplicateFastPathAcceptance({
        fastDuplicateFullValidationCalls: 0,
        fallbackOtherIntentFullValidationCalls: 1,
        fallbackTransactionTamperFullValidationCalls: 1,
      }),
    ).not.toThrow()
    expect(() =>
      assertCanvasDuplicateFastPathAcceptance({
        fastDuplicateFullValidationCalls: 1,
        fallbackOtherIntentFullValidationCalls: 1,
        fallbackTransactionTamperFullValidationCalls: 1,
      }),
    ).toThrow("fast path")
    expect(() =>
      assertCanvasDuplicateFastPathAcceptance({
        fastDuplicateFullValidationCalls: 0,
        fallbackOtherIntentFullValidationCalls: 0,
        fallbackTransactionTamperFullValidationCalls: 1,
      }),
    ).toThrow("fallback")
  })

  test("records the current duplicate owner protocol baseline", async () => {
    const result = await runCanvasDuplicateBenchmarkCell({ mode: "no-op", temperature: "warm", nodeCount: 1 })
    expect(result.actual.ownerFullValidateCalls).toBe(0)
    // The durable-head-certified replica cache removes the defensive base pair;
    // candidate canonical proof is issuer-branded incremental JCS evidence.
    expect(result.actual.ownerCanonicalStateCalls).toBe(0)
  })

  test("keeps an unrelated intent on the full-validation fallback", async () => {
    const result = await runCanvasDuplicateBenchmarkCell({
      mode: "no-op",
      temperature: "warm",
      nodeCount: 1,
      timedOperation: "set-title",
    })
    expect(result.actual.nodesAfter).toBe(1)
    expect(result.actual.ownerFullValidateCalls).toBeGreaterThanOrEqual(1)
  })
  for (const nodeCount of [1, 32] as const) {
    for (const mode of ["no-op", "real"] as const) {
      for (const temperature of ["cold", "warm"] as const) {
        test(`${nodeCount} nodes ${mode}/${temperature} duplicates one live node through the owner/kernel`, async () => {
          const result = await runCanvasDuplicateBenchmarkCell({ mode, temperature, nodeCount })
          expect(result.actual.nodesBefore).toBe(nodeCount)
          expect(result.actual.nodesAfter).toBe(nodeCount + 1)
          expect(result.actual.retainedFrames).toBe(1)
          expect(result.actual.materializerDelta).toBe(0)
          expect(result.actual.physicalSyncCount).toBe(mode === "real" ? 1 : 0)
          expect(Object.keys(result.stages)).toEqual([...durableBusinessStages])
        }, 30_000)
      }
    }
  }

  for (const canvasCount of [1, 8, 32] as const) {
    for (const mode of ["no-op", "real"] as const) {
      test(`${canvasCount} live Canvas shards ${mode}/warm times only route zero`, async () => {
        const cell = await runCanvasDuplicateBenchmarkCell({
          mode,
          temperature: "warm",
          nodeCount: 1,
          canvasCount,
        })
        expect(cell.actual.requestedCanvasCount).toBe(canvasCount)
        expect(cell.actual.openedCanvasShards).toBe(canvasCount)
        expect(cell.actual.nodesBefore).toBe(1)
        expect(cell.actual.nodesAfter).toBe(2)
        expect(
          Object.values(cell.stages).every(({ processedSetSizes }) =>
            processedSetSizes.canvasCount === canvasCount),
        ).toBeTrue()
      }, 180_000)
    }
  }
})
