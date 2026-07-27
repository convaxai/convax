import { describe, expect, test } from "bun:test"
import {
  aggregateWorkspaceProcessMetrics,
  workspaceSystemStatusIpcChannel,
} from "./workspace-system-status-contracts"

describe("workspace system status contracts", () => {
  test("aggregates bounded Convax process CPU and private memory", () => {
    expect(
      aggregateWorkspaceProcessMetrics(
        [
          { cpu: { percentCPUUsage: 3.24 }, memory: { privateBytes: 128, workingSetSize: 999 } },
          { cpu: { percentCPUUsage: 1.31 }, memory: { workingSetSize: 64 } },
        ],
        1_234.6,
      ),
    ).toEqual({
      appCpuPercent: 4.6,
      appMemoryBytes: 192 * 1024,
      sampledAt: 1_235,
    })
  })

  test("fails closed for invalid native metrics", () => {
    expect(
      aggregateWorkspaceProcessMetrics(
        [
          { cpu: { percentCPUUsage: Number.NaN }, memory: { privateBytes: -1 } },
          { cpu: { percentCPUUsage: Number.POSITIVE_INFINITY }, memory: { workingSetSize: Number.NaN } },
        ],
        -10,
      ),
    ).toEqual({ appCpuPercent: 0, appMemoryBytes: 0, sampledAt: 0 })
    expect(workspaceSystemStatusIpcChannel).toBe("desktop:workspace-system-status")
  })
})
