import { describe, expect, test } from "bun:test"

import type { McpToolCallResult } from "./stdio-mcp-client"
import {
  GenerationRecoveryCoordinator,
  type GenerationRecoveryCanvasPort,
  type GenerationRecoveryRuntime,
} from "./generation-recovery-coordinator"
import type { GenerationInputSnapshot } from "./generation-input-snapshot-store"
import type { GenerationOperationLedger } from "./generation-operation-store"

function ledger(overrides: Partial<GenerationOperationLedger> = {}): GenerationOperationLedger {
  return {
    canvasId: "canvas-one",
    createdAt: 1,
    executionBindingDigest: "a".repeat(64),
    inputSnapshotId: "b".repeat(64),
    nodeId: "node-one",
    operationId: "operation-one",
    phase: "prepared",
    pluginPackageDigest: "c".repeat(64),
    projectId: "project-one",
    requestDigest: "d".repeat(64),
    runtimeAuthorizationDigest: "e".repeat(64),
    schema: "convax.generation-operation-ledger/1",
    sidecarRecoveryBindingDigest: "f".repeat(64),
    targetGuardDigest: "1".repeat(64),
    toolId: "tools/image",
    updatedAt: 1,
    ...overrides,
  }
}

const snapshot: GenerationInputSnapshot = {
  files: [],
  id: "b".repeat(64),
  request: { prompt: "Draw a fox" },
  requestDigest: "d".repeat(64),
}
const result: McpToolCallResult = { content: [{ text: "result", type: "text" }] }

function harness(statuses: Array<Record<string, unknown>>) {
  const transitions: Array<Record<string, unknown>> = []
  const canvasEvents: Array<Record<string, unknown>> = []
  let replayCount = 0
  let lookupCount = 0
  const runtime: GenerationRecoveryRuntime = {
    acknowledge: async () => {
      canvasEvents.push({ type: "acknowledge" })
    },
    bindingDigest: "f".repeat(64),
    cancel: async () => statuses.shift() as never,
    executionBindingDigest: "a".repeat(64),
    lookup: async () => {
      lookupCount += 1
      return statuses.shift() as never
    },
    pluginPackageDigest: "c".repeat(64),
    query: async () => statuses.shift() as never,
    replay: async () => {
      replayCount += 1
      return statuses.shift() as never
    },
    result: async (_input) => ({ result, resultDigest: "2".repeat(64) }),
    runtimeAuthorizationDigest: "e".repeat(64),
    wait: async () => statuses.shift() as never,
  }
  const canvas: GenerationRecoveryCanvasPort = {
    async commitResult() {
      canvasEvents.push({ type: "commit" })
    },
    async finish(_ledger, status, retrySafety) {
      canvasEvents.push({ retrySafety, status, type: "finish" })
    },
    async markTask(_ledger, taskId) {
      canvasEvents.push({ taskId, type: "task" })
    },
    async stillOwns() {
      return true
    },
  }
  const operations = {
    async transition(_identity: unknown, patch: Record<string, unknown>) {
      transitions.push(patch)
      return { ...ledger(), ...patch }
    },
  }
  const coordinator = new GenerationRecoveryCoordinator({
    canvas,
    inputs: { async open() { return snapshot } },
    operations,
    resolveRuntime: async () => runtime,
  })
  return {
    canvasEvents,
    coordinator,
    lookupCount: () => lookupCount,
    replayCount: () => replayCount,
    transitions,
  }
}

describe("Generation exactly-once recovery coordinator", () => {
  test("replays the same operation only after durable absent proof, then commits and acknowledges", async () => {
    const h = harness([
      { schema: "convax.generation-recovery-snapshot/1", status: "absent" },
      {
        resultDigest: "2".repeat(64),
        schema: "convax.generation-recovery-snapshot/1",
        status: "succeeded",
        taskId: "task_123",
      },
    ])
    await expect(h.coordinator.recover(ledger())).resolves.toEqual({ outcome: "committed" })
    expect(h.replayCount()).toBe(1)
    expect(h.canvasEvents).toEqual([{ type: "commit" }, { type: "acknowledge" }])
    expect(h.transitions.map((item) => item.phase)).toEqual(["dispatching", "result-ready", "committed"])
  })

  test("reattaches a submitted task without replaying a billable call", async () => {
    const h = harness([
      {
        schema: "convax.generation-recovery-snapshot/1",
        status: "running",
        taskId: "task_123",
      },
      {
        resultDigest: "2".repeat(64),
        schema: "convax.generation-recovery-snapshot/1",
        status: "succeeded",
        taskId: "task_123",
      },
    ])
    await expect(h.coordinator.recover(ledger({ phase: "dispatching" }))).resolves.toEqual({
      outcome: "committed",
    })
    expect(h.replayCount()).toBe(0)
    expect(h.canvasEvents[0]).toEqual({ taskId: "task_123", type: "task" })
  })

  test("marks unknown outcomes indeterminate and disables retry", async () => {
    const h = harness([{ schema: "convax.generation-recovery-snapshot/1", status: "unknown" }])
    await expect(h.coordinator.recover(ledger({ phase: "dispatching" }))).resolves.toEqual({
      outcome: "indeterminate",
    })
    expect(h.replayCount()).toBe(0)
    expect(h.canvasEvents).toEqual([{ retrySafety: "unknown", status: "interrupted", type: "finish" }])
  })

  test("persists safe failed and cancelled terminals without repeating generation", async () => {
    for (const status of ["failed", "cancelled"] as const) {
      const h = harness([
        status === "failed"
          ? {
              error: { code: "generation_failed", message: "Generation failed safely" },
              schema: "convax.generation-recovery-snapshot/1",
              status,
            }
          : { schema: "convax.generation-recovery-snapshot/1", status },
      ])
      await expect(h.coordinator.recover(ledger({ phase: "accepted", taskId: "task_123" }))).resolves.toEqual({
        outcome: status,
      })
      expect(h.canvasEvents[0]).toEqual({ retrySafety: "safe", status, type: "finish" })
      expect(h.replayCount()).toBe(0)
    }
  })

  test("never revives a deleted or superseded Canvas owner", async () => {
    const coordinator = new GenerationRecoveryCoordinator({
      canvas: {
        async commitResult() {
          throw new Error("must not commit")
        },
        async finish() {},
        async markTask() {},
        async stillOwns() {
          return false
        },
      },
      inputs: { async open() { return snapshot } },
      operations: { async transition(_identity, patch) { return { ...ledger(), ...patch } } },
      resolveRuntime: async () => {
        throw new Error("must not launch runtime")
      },
    })
    await expect(coordinator.recover(ledger())).resolves.toEqual({ outcome: "orphaned" })
  })

  test("fails closed before lookup when snapshot or exact runtime binding changed", async () => {
    const h = harness([])
    await expect(h.coordinator.recover(ledger({ requestDigest: "9".repeat(64) }))).resolves.toEqual({
      outcome: "indeterminate",
    })
    expect(h.lookupCount()).toBe(0)
    expect(h.replayCount()).toBe(0)
  })
})
