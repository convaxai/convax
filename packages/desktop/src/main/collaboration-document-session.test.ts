import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  type CollaborationLatencyDiagnostic,
} from "@convax/collaboration"

import {
  createMainCollaborationDocumentSession,
  createMainCollaborationLatencyDiagnosticsPort,
} from "./collaboration-document-session"

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

  test("production slow-command recording does not require an exact persistence sample", async () => {
    const records: CollaborationLatencyDiagnostic[] = []
    const port = createMainCollaborationLatencyDiagnosticsPort({
      write: (record) => records.push(record),
    })

    expect(port.shouldSample?.(diagnostic(501))).toBe(true)
    expect(port.sample).toBeUndefined()
    await port.record(diagnostic(501))
    expect(records).toHaveLength(1)
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

describe("main collaboration invalidation delivery", () => {
  test("returns the durable submit result before observer invalidations run", async () => {
    const scope = Object.freeze({
      projectId: parseProjectId("project-invalidation-order"),
      projectEpoch: parseId128(encodeBase64url(new Uint8Array(16).fill(1))),
      docKind: "canvas" as const,
      docId: parseCanvasId(`cv_${"1".repeat(64)}`),
      shardEpoch: parseId128(encodeBase64url(new Uint8Array(16).fill(2))),
    })
    const frameDigest = parseDigest("3".repeat(64))
    const operationId = parseId128(encodeBase64url(new Uint8Array(16).fill(4)))
    const order: string[] = []
    const session = await createMainCollaborationDocumentSession({
      scope,
      createOperationId: () => operationId,
      async openKernel(projection) {
        return {
          commitLocalIntent: async () => {
            projection.publish({ scope, frameDigest })
            return { status: "saved-locally" } as never
          },
          dispose() {},
          flush: async () => undefined,
          queryOwnerState: async () => { throw new Error("unused") },
        } as never
      },
    })
    session.subscribe(() => order.push("observer"))

    await session.submit({
      operationId,
      prepare: () => { throw new Error("unused") },
    })
    order.push("submitter")

    expect(order).toEqual(["submitter"])
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(order).toEqual(["submitter", "observer"])
    session.dispose()
  })
})
