import type { CanvasGenerateRequest, CanvasGenerateResult } from "@convax/canvas"
import type { GenerationCanvasRequest, GenerationCanvasResult } from "../generation-contracts"

export interface MediaOperationProgress {
  createdNodeIds: readonly string[]
  nextRequestIndex: number
  warnings: readonly string[]
}

export class MediaOperationPartialError extends Error {
  readonly progress: MediaOperationProgress

  constructor(message: string, progress: MediaOperationProgress, options?: ErrorOptions) {
    super(message, options)
    this.name = "MediaOperationPartialError"
    this.progress = progress
  }
}

export function mediaOperationCancellationNotice(locale: "en" | "zh-CN", progress: MediaOperationProgress | undefined) {
  const hasConfirmedResult = (progress?.nextRequestIndex ?? 0) > 0
  if (locale === "zh-CN") {
    return hasConfirmedResult
      ? {
          description: "已创建部分结果；剩余步骤已取消或状态未确认，请查看画布。",
          title: "媒体操作已部分完成",
        }
      : {
          description: "操作已取消或结果状态未确认，插件可能已创建部分结果，请查看画布。",
          title: "媒体操作状态未确认",
        }
  }
  return hasConfirmedResult
    ? {
        description:
          "Some results were created. Remaining steps were canceled or could not be confirmed; check the Canvas.",
        title: "Media operation partially completed",
      }
    : {
        description:
          "The operation was canceled or its result could not be confirmed. The Plugin may have created a partial result; check the Canvas.",
        title: "Media operation status unconfirmed",
      }
}

export async function runMediaOperationSequence(options: {
  generate: (request: CanvasGenerateRequest) => Promise<CanvasGenerateResult>
  initialProgress: MediaOperationProgress
  onProgress: (progress: MediaOperationProgress) => void
  partialFailureMessage: (failure: unknown) => string
  refreshProgress?: (progress: MediaOperationProgress) => Promise<MediaOperationProgress>
  requests: readonly CanvasGenerateRequest[]
  signal: AbortSignal
}): Promise<MediaOperationProgress> {
  let progress = options.initialProgress

  for (let index = progress.nextRequestIndex; index < options.requests.length; index += 1) {
    throwIfAborted(options.signal)
    let result: CanvasGenerateResult
    try {
      if (index > 0 && options.refreshProgress) {
        progress = await options.refreshProgress(progress)
        options.onProgress(progress)
        throwIfAborted(options.signal)
      }
      result = await options.generate({
        ...options.requests[index],
        ...(index > 0 && progress.createdNodeIds.length > 0
          ? { relationAnchorNodeIds: [...progress.createdNodeIds] }
          : {}),
      })
    } catch (failure) {
      if (progress.nextRequestIndex > 0 && !options.signal.aborted) {
        throw new MediaOperationPartialError(options.partialFailureMessage(failure), progress, { cause: failure })
      }
      throw failure
    }

    progress = {
      createdNodeIds: [...progress.createdNodeIds, ...result.createdNodeIds],
      nextRequestIndex: index + 1,
      warnings: [...progress.warnings, ...result.warnings],
    }
    options.onProgress(progress)
  }

  return progress
}

export async function runMediaOperationReturn(options: {
  cancel: (request: { operationId: string }) => Promise<void>
  generate: (request: GenerationCanvasRequest) => Promise<GenerationCanvasResult>
  request: GenerationCanvasRequest
  signal: AbortSignal
}): Promise<{ outputText: string; warnings: readonly string[] }> {
  throwIfAborted(options.signal)
  const cancel = () => {
    void options.cancel({ operationId: options.request.operationId }).catch(() => undefined)
  }
  options.signal.addEventListener("abort", cancel, { once: true })
  try {
    const result = await options.generate(options.request)
    throwIfAborted(options.signal)
    if (
      result.createdNodeIds.length !== 0 ||
      typeof result.outputText !== "string" ||
      result.outputText.length === 0
    ) {
      throw new Error("Return-delivery media operation did not produce one bounded text result")
    }
    return { outputText: result.outputText, warnings: result.warnings }
  } finally {
    options.signal.removeEventListener("abort", cancel)
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
