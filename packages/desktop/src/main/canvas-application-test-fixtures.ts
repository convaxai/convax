import type {
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
  CanvasApplicationService,
} from "@convax/canvas/application"
import type { BoundedOperationReceipt } from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"

type CanvasProjectionSource = CanvasDocument | (() => CanvasDocument)

export function canvasOperationReceipt(
  operationId: string,
  actorId = "desktop-test",
): BoundedOperationReceipt {
  return { actorId, operationId } as never
}

export function canvasQueryResult(projection: CanvasDocument): CanvasApplicationQueryResult {
  return { nodes: [], projection: structuredClone(projection) }
}

export function canvasQueryApplication(
  source: CanvasProjectionSource,
): Pick<CanvasApplicationService, "query"> {
  return {
    async query() {
      return canvasQueryResult(typeof source === "function" ? source() : source)
    },
  }
}

export function canvasReadOnlyApplication(
  source: CanvasProjectionSource,
): Pick<CanvasApplicationService, "execute" | "query"> {
  return {
    ...canvasQueryApplication(source),
    async execute(): Promise<never> {
      throw new Error("Unexpected Canvas mutation in read-only test fixture")
    },
  }
}

export function canvasCommandResult(input: {
  createdNodeIds?: readonly string[]
  document: CanvasDocument
  operationId: string
}): CanvasApplicationCommandResult {
  const createdNodeIds = [...(input.createdNodeIds ?? [])]
  return {
    affectedNodeIds: [...createdNodeIds],
    changed: true,
    createdNodeIds,
    document: structuredClone(input.document),
    operationReceipt: canvasOperationReceipt(input.operationId),
    warnings: [],
  }
}
