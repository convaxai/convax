import { describe, expect, test } from "bun:test"
import type { CollaborationLatencyDiagnostic } from "@convax/collaboration"

import { createMainCollaborationLatencyDiagnosticsPort } from "./collaboration-document-session"

function diagnostic(totalDurationMs: number): CollaborationLatencyDiagnostic {
  return {
    format: "convax.collaboration-latency-diagnostic",
    version: 2,
    ownerKind: "canvas",
    outcome: "succeeded",
    totalDurationMs,
    apiObservedDurationMs: totalDurationMs,
    stages: {} as CollaborationLatencyDiagnostic["stages"],
  }
}

describe("main collaboration latency diagnostics", () => {
  test("production rejects fast commands before diagnostic sampling", () => {
    let samples = 0
    const records: CollaborationLatencyDiagnostic[] = []
    const port = createMainCollaborationLatencyDiagnosticsPort({
      sample: () => { samples += 1; return { historyCount: 1 } },
      write: (record) => records.push(record),
    })

    expect(port.shouldSample?.(diagnostic(500))).toBe(false)
    expect(samples).toBe(0)
    expect(records).toEqual([])
    expect(port.shouldSample?.(diagnostic(501))).toBe(true)
  })

  test("benchmark recordAll admits every sample and record", async () => {
    let samples = 0
    const records: CollaborationLatencyDiagnostic[] = []
    const port = createMainCollaborationLatencyDiagnosticsPort({
      recordAll: true,
      sample: () => { samples += 1; return { historyCount: samples } },
      write: (record) => records.push(record),
    })

    const fast = diagnostic(1)
    expect(port.shouldSample?.(fast)).toBe(true)
    const sample = await port.sample?.()
    await port.record({ ...fast, sample })
    expect(samples).toBe(1)
    expect(records).toHaveLength(1)
  })
})
