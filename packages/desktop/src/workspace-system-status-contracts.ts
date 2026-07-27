export const workspaceSystemStatusIpcChannel = "desktop:workspace-system-status"

export interface WorkspaceSystemStatusSnapshot {
  appCpuPercent: number
  appMemoryBytes: number
  sampledAt: number
}

export interface WorkspaceSystemStatusClient {
  getSnapshot(): Promise<WorkspaceSystemStatusSnapshot>
}

export interface WorkspaceProcessMetricInput {
  cpu?: { percentCPUUsage?: number }
  memory?: { privateBytes?: number; workingSetSize?: number }
}

function boundedMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

export function aggregateWorkspaceProcessMetrics(
  metrics: readonly WorkspaceProcessMetricInput[],
  sampledAt = Date.now(),
): WorkspaceSystemStatusSnapshot {
  let appCpuPercent = 0
  let appMemoryKilobytes = 0
  for (const metric of metrics) {
    appCpuPercent += boundedMetric(metric.cpu?.percentCPUUsage)
    appMemoryKilobytes += boundedMetric(metric.memory?.privateBytes ?? metric.memory?.workingSetSize)
  }
  return {
    appCpuPercent: Math.round(appCpuPercent * 10) / 10,
    appMemoryBytes: Math.round(appMemoryKilobytes * 1024),
    sampledAt: Math.max(0, Math.round(boundedMetric(sampledAt))),
  }
}
