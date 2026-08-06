export const collaborationLatencyStages = [
  "queue",
  "operation-lookup",
  "head-check",
  "prepare/facts",
  "candidate-clone",
  "reducer",
  "canonicalize",
  "sign",
  "object",
  "outbox",
  "journal",
  "head",
  "post-head-check",
  "replica-apply",
  "projection",
] as const

export type CollaborationLatencyStage = typeof collaborationLatencyStages[number]

export interface CollaborationLatencySample {
  readonly historyCount?: number
  readonly outboxCount?: number
  readonly cacheHit?: boolean
}

export interface CollaborationLatencyDiagnostic {
  readonly format: "convax.collaboration-latency-diagnostic"
  readonly outcome: "succeeded" | "failed"
  readonly totalDurationMs: number
  readonly stages: Readonly<Record<CollaborationLatencyStage, number>>
  readonly sample?: CollaborationLatencySample
}

/**
 * Optional, process-local telemetry only. Implementations must not attach scope,
 * Project, Canvas, entity identity, intent bytes, document bytes, or frame bytes.
 */
export interface CollaborationLatencyDiagnosticsPort {
  sample?(): CollaborationLatencySample | Promise<CollaborationLatencySample>
  record(diagnostic: CollaborationLatencyDiagnostic): void | Promise<void>
}
