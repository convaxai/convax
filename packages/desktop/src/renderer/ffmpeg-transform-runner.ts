import type { CanvasGenerateRequest, CanvasGenerateResult } from "@convax/canvas"

export interface FfmpegTransformProgress {
  createdNodeIds: readonly string[]
  nextRequestIndex: number
  revision: number
  warnings: readonly string[]
}

export class FfmpegPartialTransformError extends Error {
  readonly progress: FfmpegTransformProgress

  constructor(message: string, progress: FfmpegTransformProgress, options?: ErrorOptions) {
    super(message, options)
    this.name = "FfmpegPartialTransformError"
    this.progress = progress
  }
}

export function ffmpegSeparationCancellationNotice(
  locale: "en" | "zh-CN",
  progress: FfmpegTransformProgress | undefined,
) {
  const hasConfirmedVideo = (progress?.nextRequestIndex ?? 0) > 0
  if (locale === "zh-CN") {
    return hasConfirmedVideo
      ? {
          description: "已创建无声视频；独立音频已取消或状态未确认，请查看画布。",
          title: "音视频分离已部分完成",
        }
      : {
          description: "操作已取消或结果状态未确认，FFmpeg 可能已创建部分结果，请查看画布。",
          title: "音视频分离状态未确认",
        }
  }
  return hasConfirmedVideo
    ? {
        description:
          "The silent video was created. The independent audio was canceled or its status could not be confirmed; check the Canvas.",
        title: "Audio/video separation partially completed",
      }
    : {
        description:
          "The operation was canceled or its result could not be confirmed. FFmpeg may have created a partial result; check the Canvas.",
        title: "Audio/video separation status unconfirmed",
      }
}

export async function runFfmpegTransformSequence(options: {
  generate: (request: CanvasGenerateRequest) => Promise<CanvasGenerateResult>
  initialProgress: FfmpegTransformProgress
  onProgress: (progress: FfmpegTransformProgress) => void
  partialFailureMessage: (failure: unknown) => string
  requests: readonly CanvasGenerateRequest[]
  signal: AbortSignal
}): Promise<FfmpegTransformProgress> {
  let progress = options.initialProgress

  for (let index = progress.nextRequestIndex; index < options.requests.length; index += 1) {
    throwIfAborted(options.signal)
    let result: CanvasGenerateResult
    try {
      result = await options.generate({
        ...options.requests[index],
        expectedRevision: progress.revision,
        ...(index > 0 && progress.createdNodeIds.length > 0
          ? { relationAnchorNodeIds: [...progress.createdNodeIds] }
          : {}),
      })
    } catch (failure) {
      if (progress.nextRequestIndex > 0 && !options.signal.aborted) {
        throw new FfmpegPartialTransformError(options.partialFailureMessage(failure), progress, { cause: failure })
      }
      throw failure
    }

    progress = {
      createdNodeIds: [...progress.createdNodeIds, ...result.createdNodeIds],
      nextRequestIndex: index + 1,
      revision: result.revision,
      warnings: [...progress.warnings, ...result.warnings],
    }
    options.onProgress(progress)
  }

  return progress
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
