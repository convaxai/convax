import type { GenerationRecoverySnapshot } from "./generation-recovery-protocol"
import type { GenerationInputSnapshot, GenerationInputSnapshotStore } from "./generation-input-snapshot-store"
import type {
  GenerationOperationLedger,
  GenerationOperationStore,
} from "./generation-operation-store"
import type { McpToolCallResult } from "./stdio-mcp-client"

type RecoveryIdentity = Pick<
  GenerationOperationLedger,
  "canvasId" | "nodeId" | "operationId" | "projectId"
>
type RecoveryRequest = {
  operationId: string
  requestDigest: string
  resultDigest?: string
  taskId?: string
}

export interface GenerationRecoveryRuntime {
  acknowledge(input: RecoveryRequest, signal?: AbortSignal): Promise<void>
  bindingDigest: string
  cancel(input: RecoveryRequest, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
  executionBindingDigest: string
  lookup(input: RecoveryRequest, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
  pluginPackageDigest: string
  query(input: RecoveryRequest, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
  replay(snapshot: GenerationInputSnapshot, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
  result(
    input: RecoveryRequest & { resultDigest: string },
    signal?: AbortSignal,
  ): Promise<{ result: McpToolCallResult; resultDigest: string }>
  runtimeAuthorizationDigest: string
  wait(input: RecoveryRequest, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
}

export interface GenerationRecoveryCanvasPort {
  commitResult(
    ledger: GenerationOperationLedger,
    result: McpToolCallResult,
    resultDigest: string,
    signal?: AbortSignal,
  ): Promise<void>
  finish(
    ledger: GenerationOperationLedger,
    status: "failed" | "cancelled" | "interrupted",
    retrySafety: "safe" | "unknown",
    signal?: AbortSignal,
  ): Promise<void>
  markTask(ledger: GenerationOperationLedger, taskId: string, signal?: AbortSignal): Promise<void>
  stillOwns(ledger: GenerationOperationLedger, signal?: AbortSignal): Promise<boolean>
}

export interface GenerationRecoveryCoordinatorOptions {
  canvas: GenerationRecoveryCanvasPort
  inputs: Pick<GenerationInputSnapshotStore, "open">
  operations: Pick<GenerationOperationStore, "transition">
  resolveRuntime(ledger: GenerationOperationLedger, signal?: AbortSignal): Promise<GenerationRecoveryRuntime>
}

function identity(ledger: GenerationOperationLedger): RecoveryIdentity {
  return {
    canvasId: ledger.canvasId,
    nodeId: ledger.nodeId,
    operationId: ledger.operationId,
    projectId: ledger.projectId,
  }
}

function request(ledger: GenerationOperationLedger, taskId = ledger.taskId): RecoveryRequest {
  return {
    operationId: ledger.operationId,
    requestDigest: ledger.requestDigest,
    ...(taskId === undefined ? {} : { taskId }),
  }
}

function runtimeMatches(ledger: GenerationOperationLedger, runtime: GenerationRecoveryRuntime) {
  return (
    runtime.bindingDigest === ledger.sidecarRecoveryBindingDigest &&
    runtime.executionBindingDigest === ledger.executionBindingDigest &&
    runtime.pluginPackageDigest === ledger.pluginPackageDigest &&
    runtime.runtimeAuthorizationDigest === ledger.runtimeAuthorizationDigest
  )
}

export class GenerationRecoveryCoordinator {
  readonly #active = new Map<string, Promise<{ outcome: string }>>()

  constructor(private readonly options: GenerationRecoveryCoordinatorOptions) {}

  recover(ledger: GenerationOperationLedger, signal?: AbortSignal): Promise<{ outcome: string }> {
    const key = JSON.stringify(identity(ledger))
    const existing = this.#active.get(key)
    if (existing) return existing
    const recovery = this.#recover(ledger, signal).finally(() => {
      if (this.#active.get(key) === recovery) this.#active.delete(key)
    })
    this.#active.set(key, recovery)
    return recovery
  }

  async #recover(initial: GenerationOperationLedger, signal?: AbortSignal): Promise<{ outcome: string }> {
    if (!(await this.options.canvas.stillOwns(initial, signal))) return { outcome: "orphaned" }
    let ledger = initial
    try {
      const snapshot = await this.options.inputs.open(ledger.inputSnapshotId)
      if (snapshot.id !== ledger.inputSnapshotId || snapshot.requestDigest !== ledger.requestDigest) {
        throw new Error("Generation recovery input snapshot changed")
      }
      const runtime = await this.options.resolveRuntime(ledger, signal)
      if (!runtimeMatches(ledger, runtime)) throw new Error("Generation recovery runtime binding changed")
      let state = await runtime.lookup(request(ledger), signal)
      for (let step = 0; step < 8; step += 1) {
        if (!(await this.options.canvas.stillOwns(ledger, signal))) return { outcome: "orphaned" }
        if (state.status === "absent" || state.status === "prepared") {
          ledger = await this.options.operations.transition(identity(ledger), { phase: "dispatching" })
          state = await runtime.replay(snapshot, signal)
          continue
        }
        if (state.status === "submitted" || state.status === "running") {
          ledger = await this.options.operations.transition(identity(ledger), {
            phase: "accepted",
            taskId: state.taskId,
          })
          await this.options.canvas.markTask(ledger, state.taskId, signal)
          state = await runtime.wait(request(ledger, state.taskId), signal)
          continue
        }
        if (state.status === "succeeded") {
          ledger = await this.options.operations.transition(identity(ledger), {
            phase: "result-ready",
            resultDigest: state.resultDigest,
            taskId: state.taskId,
          })
          const replayed = await runtime.result(
            { ...request(ledger, state.taskId), resultDigest: state.resultDigest },
            signal,
          )
          if (replayed.resultDigest !== state.resultDigest) {
            throw new Error("Generation recovery result digest changed")
          }
          await this.options.canvas.commitResult(ledger, replayed.result, replayed.resultDigest, signal)
          ledger = await this.options.operations.transition(identity(ledger), {
            phase: "committed",
            resultDigest: replayed.resultDigest,
            taskId: state.taskId,
          })
          await runtime.acknowledge(
            { ...request(ledger, state.taskId), resultDigest: replayed.resultDigest },
            signal,
          )
          return { outcome: "committed" }
        }
        if (state.status === "failed" || state.status === "cancelled") {
          await this.options.canvas.finish(ledger, state.status, "safe", signal)
          await this.options.operations.transition(identity(ledger), {
            phase: state.status,
            ...(state.taskId === undefined ? {} : { taskId: state.taskId }),
          })
          await runtime.acknowledge(request(ledger, state.taskId), signal)
          return { outcome: state.status }
        }
        await this.options.operations.transition(identity(ledger), { phase: "indeterminate" })
        await this.options.canvas.finish(ledger, "interrupted", "unknown", signal)
        return { outcome: "indeterminate" }
      }
      throw new Error("Generation recovery did not converge")
    } catch {
      try {
        await this.options.operations.transition(identity(ledger), { phase: "indeterminate" })
      } catch {
        // The original corruption remains the authoritative failure.
      }
      try {
        await this.options.canvas.finish(ledger, "interrupted", "unknown", signal)
      } catch {
        // A deleted or superseded target must not be revived.
      }
      return { outcome: "indeterminate" }
    }
  }
}
