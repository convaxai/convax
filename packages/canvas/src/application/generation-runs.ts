import type { CanvasCommandActor, CanvasNodeGenerationRunCommand } from "./commands"
import type { CanvasDocumentRef } from "./persistence"
import type { CanvasApplicationCommandResult, CanvasApplicationService } from "./service"

interface CanvasNodeGenerationRunRequestBase extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  signal?: AbortSignal
}

export interface CanvasStartNodeGenerationRunRequest extends CanvasNodeGenerationRunRequestBase {
  nodeId: string
  operationId: string
  prompt: string
  toolId: string
}

export interface CanvasMarkNodeGenerationRunRunningRequest extends CanvasNodeGenerationRunRequestBase {
  nodeId: string
  operationId: string
  taskId?: string
}

export interface CanvasFinishNodeGenerationRunRequest extends CanvasNodeGenerationRunRequestBase {
  failureMessage?: string
  nodeId: string
  operationId: string
}

export interface CanvasInterruptInactiveGenerationRunsRequest extends CanvasNodeGenerationRunRequestBase {
  liveRuns: readonly { nodeId: string; operationId: string }[]
}

type CanvasGenerationRunApplication = Pick<CanvasApplicationService, "execute" | "query">

/** Headless Canvas-owned run state orchestration shared by every host entry point. */
export class CanvasNodeGenerationRunBusinessService {
  constructor(private readonly application: CanvasGenerationRunApplication) {}

  start(request: CanvasStartNodeGenerationRunRequest) {
    return this.execute(request, {
      nodeId: request.nodeId,
      operationId: request.operationId,
      prompt: request.prompt,
      toolId: request.toolId,
      type: "generation.run.start",
    })
  }

  markRunning(request: CanvasMarkNodeGenerationRunRunningRequest) {
    return this.execute(request, {
      nodeId: request.nodeId,
      operationId: request.operationId,
      ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
      type: "generation.run.mark-running",
    })
  }

  finish(request: CanvasFinishNodeGenerationRunRequest) {
    return this.execute(request, {
      ...(request.failureMessage === undefined ? {} : { failureMessage: request.failureMessage }),
      nodeId: request.nodeId,
      operationId: request.operationId,
      type: "generation.run.finish",
    })
  }

  interruptInactive(request: CanvasInterruptInactiveGenerationRunsRequest) {
    return this.execute(request, {
      liveRuns: request.liveRuns.map((run) => ({ ...run })),
      type: "generation.runs.interrupt-inactive",
    })
  }

  private async execute(
    request: CanvasNodeGenerationRunRequestBase,
    command: CanvasNodeGenerationRunCommand,
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    return this.application.execute({
      canvasId: request.canvasId,
      envelope: { actor: request.actor, command, commandId: request.commandId },
      scopeId: request.scopeId,
      ...(request.signal ? { signal: request.signal } : {}),
    })
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas generation run operation was canceled", "AbortError")
}
