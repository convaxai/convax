export const collaborationLatencyStages = [
  "queue",
  "operation-lookup",
  "head-check",
  "authority-prepare",
  "owner-prepare",
  "base-validation",
  "base-state-encode",
  "candidate-clone",
  "reducer",
  "delta-encode",
  "canonical-delta-validation",
  "canonical-state-digest",
  "sign",
  "frame-encode",
  "frame-decode",
  "object",
  "outbox",
  "journal",
  "head",
  "post-head-check",
  "replica-apply",
  "projection",
] as const

export type CollaborationLatencyStage = typeof collaborationLatencyStages[number]

export interface CollaborationLatencyStageMeasurement {
  readonly durationMs: number
  readonly callCount: number
}

export interface CollaborationLatencySample {
  readonly historyCount?: number
  readonly outboxCount?: number
  readonly cacheHit?: boolean
}

export interface CollaborationLatencyDiagnostic {
  readonly format: "convax.collaboration-latency-diagnostic"
  readonly version: 2
  /** Non-identifying shard class used to separate ProjectIndex and Canvas roots. */
  readonly ownerKind: "canvas" | "project-index"
  readonly outcome: "succeeded" | "failed"
  /** Queue admission through the durable command outcome; excludes diagnostics sampling and recording. */
  readonly totalDurationMs: number
  /** Queue admission through synchronous diagnostics dispatch immediately before the API result settles. */
  readonly apiObservedDurationMs: number
  /** Asynchronous diagnostics sampling only; absent when no sample was requested. */
  readonly sampleDurationMs?: number
  readonly stages: Readonly<Record<CollaborationLatencyStage, CollaborationLatencyStageMeasurement>>
  readonly sample?: CollaborationLatencySample
}

/**
 * Optional, process-local telemetry only. Implementations must not attach scope,
 * Project, Canvas, entity identity, intent bytes, document bytes, or frame bytes.
 * The bounded ownerKind is a shard class, not a document identity.
 */
export interface CollaborationLatencyDiagnosticsPort {
  /** Synchronous gate evaluated before sample(), so production can avoid per-command diagnostic I/O. */
  shouldSample?(diagnostic: CollaborationLatencyDiagnostic): boolean
  sample?(): CollaborationLatencySample | Promise<CollaborationLatencySample>
  record(diagnostic: CollaborationLatencyDiagnostic): void | Promise<void>
}
