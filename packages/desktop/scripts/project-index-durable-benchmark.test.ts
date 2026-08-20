import { describe, expect, test } from "bun:test"
import type { CollaborationLatencyDiagnostic } from "@convax/collaboration"

import { createMainCollaborationLatencyDiagnosticsPort } from "../src/main/collaboration-document-session"
import {
  assertProjectIndexBenchmarkCell,
  durableBusinessStages,
  parseBenchmarkModeOverride,
  parseBenchmarkTemperatureOverride,
  runProjectIndexDurableBenchmark,
} from "./project-index-durable-benchmark"

describe("ProjectIndex durable benchmark", () => {
  test("runs the fixed real/no-op, resource and cold/warm matrix through timed candidate bases", async () => {
    const report = await runProjectIndexDurableBenchmark({ samples: 1 })
    const cells = report.cells
    expect(cells).toHaveLength(16)
    expect(report.metadata).toMatchObject({
      benchmark: "project-index",
      matrix: "smoke",
      setupExcludedFromTiming: true,
    })
    expect(report.complexity["resources-32-to-512"].status).toBe("unsupported")
    expect(report.complexity["retained-frames-32-to-512"].status).toBe("unsupported")
    expect(report.complexity["canvas-count-1-to-32"].status).toBe("unsupported")
    expect(report.unsupported).toEqual([
      expect.objectContaining({ operation: "ordinary-canvas-duplicate", canvasCount: 1 }),
    ])
    expect(new Set(cells.map((cell) => cell.operation))).toEqual(new Set(["new-text", "new-image"]))
    for (const mode of ["no-op", "real"] as const) {
      for (const temperature of ["cold", "warm"] as const) {
        const one = cells.find(
          (cell) => cell.mode === mode && cell.temperature === temperature && cell.resources === 1,
        )!
        const thirtyTwo = cells.find(
          (cell) => cell.mode === mode && cell.temperature === temperature && cell.resources === 32,
        )!
        expect(thirtyTwo.fullUpdateBytes).toBeGreaterThan(one.fullUpdateBytes)
        expect(one.successfulSemanticRoots).toBe(1)
        expect(thirtyTwo.successfulSemanticRoots).toBe(1)
        expect(Object.keys(one.stages)).toEqual([...durableBusinessStages])
        // The exact-base local candidate proof removes the former
        // canonical-delta-validation pass. The grouped stage now contains
        // only base validation and final frame decode.
        expect(one.stages.validate.callCount).toBe(2)
        expect(thirtyTwo.stages.validate.callCount).toBe(2)
        // Queue-free warm consumes the exact-head standby and therefore does
        // not copy the full base update. Cold reopen retains that fallback.
        const expectedStateEncodeCalls = temperature === "warm" ? 4 : 5
        expect(one.stages["state-encode"].callCount).toBe(expectedStateEncodeCalls)
        expect(thirtyTwo.stages["state-encode"].callCount).toBe(expectedStateEncodeCalls)
        expect(one.stages["candidate-clone"].processedSetSizes).toEqual(
          expect.objectContaining({ resources: 1, retainedFrames: 1, canvasCount: 1 }),
        )
        expect(thirtyTwo.stages["candidate-clone"].processedSetSizes).toEqual(
          expect.objectContaining({ resources: 32, retainedFrames: 1, canvasCount: 1 }),
        )
        expect(one.actual).toEqual({
          resources: 1,
          operations: 2,
          retainedFrames: 1,
          retainedFramesAfterTimedCommit: 2,
          canvasCount: 1,
        })
        expect(thirtyTwo.actual).toEqual({
          resources: 32,
          operations: 2,
          retainedFrames: 1,
          retainedFramesAfterTimedCommit: 2,
          canvasCount: 1,
        })
        expect(one.kernelDurabilityStages.object.callCount).toBe(1)
        expect(thirtyTwo.kernelDurabilityStages.head.callCount).toBe(1)
        if (mode === "no-op") {
          expect(one.durability.physicalSyncCount).toBe(0)
          expect(one.durability.barriers).toEqual([])
          expect(thirtyTwo.durability.barriers).toEqual([])
        } else {
          expect(one.durability.physicalSyncCount).toBe(10)
          const expected = [
            ["object-frame", "file-sync"],
            ["object-frame", "directory-sync"],
            ["object-operation-sidecar", "file-sync"],
            ["object-operation-sidecar", "directory-sync"],
            ["outbox", "file-sync"],
            ["outbox", "directory-sync"],
            ["journal", "file-sync"],
            ["journal", "directory-sync"],
            ["head", "file-sync"],
            ["head", "directory-sync"],
          ]
          expect(one.durability.barriers.map(({ stage, kind }) => [stage, kind])).toEqual(expected)
          expect(thirtyTwo.durability.barriers.map(({ stage, kind }) => [stage, kind])).toEqual(expected)
          const groupCounts = (barriers: typeof one.durability.barriers) => ({
            object: barriers.filter(({ stage }) => stage === "object-frame" || stage === "object-operation-sidecar")
              .length,
            outbox: barriers.filter(({ stage }) => stage === "outbox").length,
            journal: barriers.filter(({ stage }) => stage === "journal").length,
            head: barriers.filter(({ stage }) => stage === "head").length,
          })
          expect(groupCounts(one.durability.barriers)).toEqual({ object: 4, outbox: 2, journal: 2, head: 2 })
          expect(groupCounts(thirtyTwo.durability.barriers)).toEqual({ object: 4, outbox: 2, journal: 2, head: 2 })
        }
      }
    }
  }, 30_000)

  test("strict persisted-cell schema rejects unknown stages", async () => {
    const report = await runProjectIndexDurableBenchmark({
      samples: 1,
      resources: [1],
      retainedFrames: [1],
      canvasCounts: [1],
      operations: ["new-text"],
    })
    const cell = report.cells[0]!
    expect(() => assertProjectIndexBenchmarkCell(cell)).not.toThrow()
    expect(() =>
      assertProjectIndexBenchmarkCell({ ...cell, stages: { ...cell.stages, invented: cell.stages.queue } }),
    ).toThrow("unknown or missing closed stage")
    const { queue: _queue, ...missingQueue } = cell.stages
    expect(() => assertProjectIndexBenchmarkCell({ ...cell, stages: missingQueue })).toThrow(
      "unknown or missing closed stage",
    )
    expect(() =>
      assertProjectIndexBenchmarkCell({
        ...cell,
        stages: { ...cell.stages, queue: { ...cell.stages.queue, callCount: -1 } },
      }),
    ).toThrow("callCount")
  }, 30_000)

  test("varies retained frames independently of the timed ProjectIndex resource base", async () => {
    const report = await runProjectIndexDurableBenchmark({
      samples: 1,
      resources: [1],
      retainedFrames: [1, 32],
      canvasCounts: [1],
      operations: ["new-text"],
    })
    for (const mode of ["no-op", "real"] as const)
      for (const temperature of ["cold", "warm"] as const) {
        const one = report.cells.find(
          (cell) => cell.mode === mode && cell.temperature === temperature && cell.retainedFrames === 1,
        )!
        const thirtyTwo = report.cells.find(
          (cell) => cell.mode === mode && cell.temperature === temperature && cell.retainedFrames === 32,
        )!
        expect(one.actual.resources).toBe(1)
        expect(thirtyTwo.actual.resources).toBe(1)
        expect(one.actual.retainedFrames).toBe(1)
        expect(thirtyTwo.actual.retainedFrames).toBe(32)
        expect(one.fullUpdateBytes).not.toBe(thirtyTwo.fullUpdateBytes)
      }
    expect(report.unsupported).toEqual([])
  }, 30_000)

  test("recordAll retains a sub-500ms diagnostic for benchmark collection", async () => {
    const written: CollaborationLatencyDiagnostic[] = []
    const port = createMainCollaborationLatencyDiagnosticsPort({
      sample: () => ({}),
      recordAll: true,
      write: (diagnostic) => written.push(diagnostic),
    })
    await port.record({
      format: "convax.collaboration-latency-diagnostic",
      version: 2,
      outcome: "succeeded",
      totalDurationMs: 1,
      stages: {} as CollaborationLatencyDiagnostic["stages"],
    })
    expect(written).toHaveLength(1)
  })

  test("filters modes and temperatures and publishes each completed cell immediately", async () => {
    const observed: string[] = []
    const progress: string[] = []
    const report = await runProjectIndexDurableBenchmark({
      samples: 1,
      resources: [1],
      retainedFrames: [1],
      canvasCounts: [1],
      operations: ["new-text"],
      modes: ["no-op"],
      temperatures: ["warm"],
      onCell: async (cell) => {
        observed.push(`${cell.mode}:${cell.temperature}`)
      },
      onProgress: async (event) => {
        progress.push(`${event.boundary}:${event.phase}`)
        expect(event.elapsedMs).toBeGreaterThanOrEqual(0)
        if (event.phase === "end") expect(event.durationMs).toBeGreaterThanOrEqual(0)
      },
    })
    expect(observed).toEqual(["no-op:warm"])
    expect(report.cells.map(({ mode, temperature }) => `${mode}:${temperature}`)).toEqual(observed)
    expect(progress).toEqual([
      "fixture-build:start",
      "fixture-build:end",
      "store-setup:start",
      "store-setup:end",
      "retained-setup:start",
      "retained-setup:end",
      "warm-preflight:start",
      "warm-preflight:end",
      "timed-commit:start",
      "timed-commit:end",
    ])
  })

  test("strictly parses mode and temperature overrides", () => {
    expect(parseBenchmarkModeOverride("real,no-op")).toEqual(["real", "no-op"])
    expect(parseBenchmarkTemperatureOverride("warm")).toEqual(["warm"])
    expect(() => parseBenchmarkModeOverride("real,real")).toThrow("unique subset")
    expect(() => parseBenchmarkTemperatureOverride("hot")).toThrow("unique subset")
  })
})
