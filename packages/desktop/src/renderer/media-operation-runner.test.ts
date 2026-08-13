import { describe, expect, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas"
import type {
  GenerationCanvasAdmissionRequest,
  GenerationCanvasResult,
  GenerationCanvasRequest,
} from "../generation-contracts"
import { runMediaOperationAdmission, runMediaOperationReturn } from "./media-operation-runner"

const signal = new AbortController().signal

const admissionRequest = {
  steps: [
    {
      request: {
        anchor: { x: 0, y: 0 },
        expectedOutputCount: 1,
        operationId: "video-operation",
        output: "video",
        prompt: "video",
        ref: { canvasId: "canvas", scopeId: "project" },
        references: [{ nodeId: "source", role: "reference_video" }],
        resultMode: { type: "create-pending-node" },
        toolId: "media/run.video",
      },
    },
    {
      relationAnchorStepIndexes: [0],
      request: {
        anchor: { x: 0, y: 224 },
        expectedOutputCount: 1,
        operationId: "audio-operation",
        output: "audio",
        prompt: "audio",
        ref: { canvasId: "canvas", scopeId: "project" },
        references: [{ nodeId: "source", role: "reference_video" }],
        resultMode: { type: "create-pending-node" },
        toolId: "media/run.audio",
      },
    },
  ],
} satisfies GenerationCanvasAdmissionRequest

describe("runMediaOperationAdmission", () => {
  test("returns only Main's durable admission receipt", async () => {
    const receipt = {
      operations: [
        { nodeId: "pending-video", operationId: "video-operation" },
        { nodeId: "pending-audio", operationId: "audio-operation" },
      ],
    }
    await expect(
      runMediaOperationAdmission({
        admit: async () => receipt,
        cancel: async () => undefined,
        request: admissionRequest,
        signal,
      }),
    ).resolves.toEqual(receipt)
  })

  test("crosses cancellation only while admission is pending", async () => {
    const controller = new AbortController()
    let rejectAdmission!: (failure: unknown) => void
    const pending = new Promise<never>((_resolve, reject) => {
      rejectAdmission = reject
    })
    const canceled: string[] = []
    const operation = runMediaOperationAdmission({
      admit: async () => pending,
      cancel: async ({ operationId }) => {
        canceled.push(operationId)
        rejectAdmission(new DOMException("Canceled", "AbortError"))
      },
      request: admissionRequest,
      signal: controller.signal,
    })

    controller.abort(new DOMException("Canceled", "AbortError"))
    await expect(operation).rejects.toBeInstanceOf(DOMException)
    expect(canceled).toEqual(["video-operation"])
  })
})

describe("runMediaOperationReturn", () => {
  const returnRequest = {
    anchor: { x: 0, y: 0 },
    expectedOutputCount: 1,
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
          operationReceipt: null,
          outputText: "Imported 1 media file.",
          projection: createCanvasDocument({ id: "canvas" }),
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
      operationReceipt: null,
      outputText: "stale success",
      projection: createCanvasDocument({ id: "canvas" }),
      toolId: "media/import-selected",
      warnings: [],
    })

    await expect(operation).rejects.toBeInstanceOf(DOMException)
    expect(canceled).toEqual(["return-operation"])
  })
})
