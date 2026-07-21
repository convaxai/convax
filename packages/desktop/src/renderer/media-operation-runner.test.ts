import { describe, expect, test } from "bun:test"
import type { CanvasGenerateRequest, CanvasGenerateResult } from "@convax/canvas"
import {
  mediaOperationCancellationNotice,
  MediaOperationPartialError,
  type MediaOperationProgress,
  runMediaOperationSequence,
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
