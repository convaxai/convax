import { describe, expect, test } from "bun:test"
import {
  createCanvasDocument,
  createCanvasSelectionActionContext,
  createMediaNode,
  createTextNode,
} from "@convax/canvas"
import { projectFileReferenceKey } from "@convax/project/canvas"
import type { JianyingCanvasExportRequest, JianyingRendererClient } from "../jianying-contracts"

import {
  canExportSelectionToJianying,
  exportCanvasMediaToJianying,
  normalizeJianyingRendererError,
} from "./jianying-selection-action"

const signal = new AbortController().signal
const image = createMediaNode({
  id: "image",
  position: { x: 0, y: 0 },
  resource: {
    id: "image-resource",
    kind: "image",
    metadata: { [projectFileReferenceKey]: { path: ".convax/assets/image.png" } },
    url: "convax-asset://project/image.png",
  },
})
const video = createMediaNode({
  id: "video",
  position: { x: 10, y: 0 },
  resource: {
    id: "video-resource",
    kind: "video",
    metadata: { [projectFileReferenceKey]: { path: ".convax/assets/video.mp4" } },
    url: "convax-asset://project/video.mp4",
  },
})
const text = createTextNode({ id: "text", position: { x: 20, y: 0 }, text: "No" })

function context(nodeIds: string[], edgeIds: string[] = []) {
  const base = createCanvasDocument({ id: "canvas", title: "Canvas" })
  return createCanvasSelectionActionContext({ ...base, nodes: [image, video, text] }, nodeIds, edgeIds, signal)
}

describe("canExportSelectionToJianying", () => {
  test("accepts one or more Project-backed images and videos", () => {
    expect(canExportSelectionToJianying(context(["image"]))).toBe(true)
    expect(canExportSelectionToJianying(context(["image", "video"]))).toBe(true)
  })

  test("rejects an empty selection, mixed content, missing nodes, and selected edges", () => {
    expect(canExportSelectionToJianying(context([]))).toBe(false)
    expect(canExportSelectionToJianying(context(["image", "text"]))).toBe(false)
    expect(canExportSelectionToJianying(context(["image", "missing"]))).toBe(false)
    expect(canExportSelectionToJianying(context(["image", "video"], ["edge"]))).toBe(false)
  })

  test("does not offer a guaranteed-to-fail export for remote-only or forged private media", () => {
    const remote = createMediaNode({
      id: "remote",
      position: { x: 0, y: 0 },
      resource: { id: "remote-resource", kind: "image", url: "https://example.com/image.png" },
    })
    const privateMedia = createMediaNode({
      id: "private",
      position: { x: 0, y: 0 },
      resource: {
        id: "private-resource",
        kind: "video",
        metadata: { [projectFileReferenceKey]: { path: ".convax/project.json" } },
        url: "",
      },
    })
    const base = createCanvasDocument({ id: "canvas", title: "Canvas" })
    const selection = createCanvasSelectionActionContext(
      { ...base, nodes: [remote, privateMedia] },
      ["remote", "private"],
      [],
      signal,
    )
    expect(canExportSelectionToJianying(selection)).toBe(false)
  })
})

describe("exportCanvasMediaToJianying", () => {
  test("keeps cancellation in the renderer realm and sends only an operation id", async () => {
    type ExportResult = Awaited<ReturnType<JianyingRendererClient["exportCanvasMedia"]>>
    let resolveExport!: (value: ExportResult) => void
    const exported = new Promise<ExportResult>((resolve) => {
      resolveExport = resolve
    })
    const canceled: string[] = []
    const envelopes: Parameters<JianyingRendererClient["exportCanvasMedia"]>[] = []
    const client: JianyingRendererClient = {
      cancelCanvasMediaExport: ({ operationId }) => canceled.push(operationId),
      exportCanvasMedia: async (...input) => {
        envelopes.push(input)
        return exported
      },
      getDraftStatus: async () => ({ status: "active" }),
    }
    const request: JianyingCanvasExportRequest = {
      expectedRevision: 1,
      nodeIds: ["image", "video"],
      ref: { canvasId: "canvas", scopeId: "project" },
      target: { kind: "current-or-new" },
    }
    const controller = new AbortController()
    const pending = exportCanvasMediaToJianying(client, request, controller.signal)
    controller.abort(new DOMException("Selection changed", "AbortError"))
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]![0]).toMatchObject({ request })
    expect(canceled).toEqual([envelopes[0]![0].operationId])
    resolveExport({
      createdDraft: false,
      draftName: "Current",
      importedMediaCount: 2,
      importStatus: "dispatched",
    })
    await expect(pending).resolves.toMatchObject({ importedMediaCount: 2 })
  })
})

describe("normalizeJianyingRendererError", () => {
  test("removes the Electron IPC wrapper while preserving the transport failure", () => {
    const raw = new Error(
      "Error invoking remote method 'jianying:canvas-media-export': Error: JianYing did not consume the dispatched media",
    )
    expect(normalizeJianyingRendererError(raw).message).toBe("JianYing did not consume the dispatched media")
  })
})
