import { describe, expect, test } from "bun:test"
import type { CanvasGenerateRequest, CanvasGenerateResult } from "@convax/canvas"
import {
  generationCanvasRevisionConflictCode,
  type GenerationCanvasRequest,
  type GenerationCanvasResult,
} from "../generation-contracts"
import {
  mediaOperationCancellationNotice,
  MediaOperationPartialError,
  type MediaOperationProgress,
  runMediaOperationSequence,
  runMediaOperationReturn,
} from "./media-operation-runner"

const signal = new AbortController().signal

function request(output: "audio" | "video"): CanvasGenerateRequest {
  return {
    anchor: { x: 0, y: 0 },
    context: { documentId: "canvas", selectedNodeIds: ["source"], source: "test" },
    expectedRevision: 3,
    output,
    prompt: output,
    references: [{ nodeId: "source", role: "reference_video" }],
    signal,
    toolId: `media/run.${output}`,
  }
}

function initialProgress(): MediaOperationProgress {
  return { createdNodeIds: [], nextRequestIndex: 0, revision: 3, warnings: [] }
}

function result(nodeId: string, revision: number): CanvasGenerateResult {
  return { createdNodeIds: [nodeId], revision, toolId: "media", warnings: [] }
}

describe("runMediaOperationSequence", () => {
  test("uses an honest cancellation notice even before the first result is confirmed", () => {
    expect(mediaOperationCancellationNotice("zh-CN", undefined)).toEqual({
      description: "操作已取消或结果状态未确认，插件可能已创建部分结果，请查看画布。",
      title: "媒体操作状态未确认",
    })
    expect(
      mediaOperationCancellationNotice("en", {
        createdNodeIds: ["silent-video"],
        nextRequestIndex: 1,
        revision: 4,
        warnings: [],
      }).title,
    ).toBe("Media operation partially completed")
  })

  test("runs video then audio and carries revision and relation anchors forward", async () => {
    const calls: CanvasGenerateRequest[] = []
    const snapshots: MediaOperationProgress[] = []
    const progress = await runMediaOperationSequence({
      generate: async (current) => {
        calls.push(current)
        return calls.length === 1 ? result("silent-video", 4) : result("audio", 5)
      },
      initialProgress: initialProgress(),
      onProgress: (current) => snapshots.push(current),
      partialFailureMessage: () => "partial",
      requests: [request("video"), request("audio")],
      signal,
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ expectedRevision: 3 })
    expect(calls[0].relationAnchorNodeIds).toBeUndefined()
    expect(calls[1]).toMatchObject({ expectedRevision: 4, relationAnchorNodeIds: ["silent-video"] })
    expect(snapshots.map((current) => current.nextRequestIndex)).toEqual([1, 2])
    expect(progress).toEqual({
      createdNodeIds: ["silent-video", "audio"],
      nextRequestIndex: 2,
      revision: 5,
      warnings: [],
    })
  })

  test("refreshes the authoritative Canvas revision before each later step", async () => {
    const calls: CanvasGenerateRequest[] = []
    const refreshed: MediaOperationProgress[] = []
    const progress = await runMediaOperationSequence({
      generate: async (current) => {
        calls.push(current)
        return calls.length === 1 ? result("silent-video", 4) : result("audio", 6)
      },
      initialProgress: initialProgress(),
      onProgress: () => undefined,
      partialFailureMessage: () => "partial",
      refreshProgress: async (current) => {
        refreshed.push(current)
        return { ...current, revision: 5 }
      },
      requests: [request("video"), request("audio")],
      signal,
    })

    expect(refreshed).toEqual([
      {
        createdNodeIds: ["silent-video"],
        nextRequestIndex: 1,
        revision: 4,
        warnings: [],
      },
    ])
    expect(calls[1]).toMatchObject({
      expectedRevision: 5,
      relationAnchorNodeIds: ["silent-video"],
    })
    expect(progress.revision).toBe(6)
  })

  test("safely retries a later step when Main rejects its revision before execution", async () => {
    const calls: CanvasGenerateRequest[] = []
    let refreshes = 0
    const progress = await runMediaOperationSequence({
      generate: async (current) => {
        calls.push(current)
        if (calls.length === 1) return result("silent-video", 4)
        if (calls.length === 2) {
          throw new Error(`${generationCanvasRevisionConflictCode}: expected 4, received 5`)
        }
        return result("audio", 6)
      },
      initialProgress: initialProgress(),
      onProgress: () => undefined,
      partialFailureMessage: () => "partial",
      refreshProgress: async (current) => {
        refreshes += 1
        return { ...current, revision: refreshes === 1 ? 4 : 5 }
      },
      requests: [request("video"), request("audio")],
      signal,
    })

    expect(calls.map((call) => call.expectedRevision)).toEqual([3, 4, 5])
    expect(progress).toMatchObject({
      createdNodeIds: ["silent-video", "audio"],
      nextRequestIndex: 2,
      revision: 6,
    })
  })

  test("does not run audio or report partial progress when video fails", async () => {
    const failure = new Error("video failed")
    let calls = 0
    const operation = runMediaOperationSequence({
      generate: async () => {
        calls += 1
        throw failure
      },
      initialProgress: initialProgress(),
      onProgress: () => undefined,
      partialFailureMessage: () => "partial",
      requests: [request("video"), request("audio")],
      signal,
    })

    expect(operation).rejects.toBe(failure)
    await operation.catch(() => undefined)
    expect(calls).toBe(1)
  })

  test("reports a typed partial failure and retries only audio", async () => {
    const saved: MediaOperationProgress[] = []
    let calls = 0
    const requests = [request("video"), request("audio")]
    const firstAttempt = runMediaOperationSequence({
      generate: async () => {
        calls += 1
        if (calls === 1) return result("silent-video", 4)
        throw new Error("audio failed")
      },
      initialProgress: initialProgress(),
      onProgress: (current) => saved.push(current),
      partialFailureMessage: (failure) => `partial: ${failure instanceof Error ? failure.message : String(failure)}`,
      requests,
      signal,
    })

    const failure = await firstAttempt.catch((caught: unknown) => caught)
    expect(failure).toBeInstanceOf(MediaOperationPartialError)
    if (!(failure instanceof MediaOperationPartialError)) throw failure
    expect(failure.message).toBe("partial: audio failed")
    expect(failure.progress.nextRequestIndex).toBe(1)

    const retryCalls: CanvasGenerateRequest[] = []
    const retried = await runMediaOperationSequence({
      generate: async (current) => {
        retryCalls.push(current)
        return result("audio", 10)
      },
      initialProgress: { ...saved.at(-1)!, revision: 9 },
      onProgress: (current) => saved.push(current),
      partialFailureMessage: () => "partial",
      requests,
      signal,
    })

    expect(retryCalls).toHaveLength(1)
    expect(retryCalls[0]).toMatchObject({
      expectedRevision: 9,
      output: "audio",
      relationAnchorNodeIds: ["silent-video"],
    })
    expect(retried.createdNodeIds).toEqual(["silent-video", "audio"])
    expect(retried.revision).toBe(10)
  })

  test("preserves completed progress when cancellation happens before audio", async () => {
    const controller = new AbortController()
    const saved: MediaOperationProgress[] = []
    let calls = 0
    const operation = runMediaOperationSequence({
      generate: async () => {
        calls += 1
        controller.abort(new DOMException("Canceled", "AbortError"))
        return result("silent-video", 4)
      },
      initialProgress: initialProgress(),
      onProgress: (current) => saved.push(current),
      partialFailureMessage: () => "partial",
      requests: [request("video"), request("audio")],
      signal: controller.signal,
    })

    expect(operation).rejects.toBeInstanceOf(DOMException)
    await operation.catch(() => undefined)
    expect(calls).toBe(1)
    expect(saved.at(-1)).toMatchObject({ createdNodeIds: ["silent-video"], nextRequestIndex: 1, revision: 4 })
  })
})

describe("runMediaOperationReturn", () => {
  const returnRequest = {
    anchor: { x: 0, y: 0 },
    expectedOutputCount: 1,
    expectedRevision: 3,
    operationId: "return-operation",
    output: "text",
    prompt: "Import selected media",
    ref: { canvasId: "canvas", scopeId: "project" },
    references: [{ nodeId: "source", role: "reference_image" }],
    resultMode: { type: "return" },
    toolId: "media/import-selected",
  } satisfies GenerationCanvasRequest

  test("returns only the bounded text result produced by Main", async () => {
    const result = await runMediaOperationReturn({
      cancel: async () => undefined,
      generate: async () =>
        ({
          createdNodeIds: [],
          outputText: "Imported 1 media file.",
          revision: 3,
          toolId: "media/import-selected",
          warnings: [],
        }) satisfies GenerationCanvasResult,
      request: returnRequest,
      signal,
    })

    expect(result).toEqual({ outputText: "Imported 1 media file.", warnings: [] })
  })

  test("crosses cancellation to Main and ignores a stale successful completion", async () => {
    const controller = new AbortController()
    let resolve!: (result: GenerationCanvasResult) => void
    const pending = new Promise<GenerationCanvasResult>((done) => {
      resolve = done
    })
    const canceled: string[] = []
    const operation = runMediaOperationReturn({
      cancel: async ({ operationId }) => {
        canceled.push(operationId)
      },
      generate: async () => pending,
      request: returnRequest,
      signal: controller.signal,
    })

    controller.abort(new DOMException("Canceled", "AbortError"))
    resolve({
      createdNodeIds: [],
      outputText: "stale success",
      revision: 3,
      toolId: "media/import-selected",
      warnings: [],
    })

    await expect(operation).rejects.toBeInstanceOf(DOMException)
    expect(canceled).toEqual(["return-operation"])
  })
})
