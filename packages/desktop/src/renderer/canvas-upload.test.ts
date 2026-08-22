import { describe, expect, mock, test } from "bun:test"
import { PROJECT_ENTRY_DRAG_TYPE, serializeProjectEntryDrag } from "@convax/project-files/drag"
import {
  addCanvasUploadResources,
  resolveCanvasUploadPresentations,
  resolveCanvasUploadItems,
  type CanvasUploadRequest,
} from "./canvas-upload"

function request(input: Partial<CanvasUploadRequest>): CanvasUploadRequest {
  return {
    files: [],
    signal: new AbortController().signal,
    ...input,
  }
}

function host() {
  let nextId = 0
  return { createSourceId: () => `source-${++nextId}`, projectId: "project-a" }
}

describe("desktop Canvas resource transport", () => {
  test("submits one operation-identified upload without an authoritative pre-query", async () => {
    const order: string[] = []
    const file = new File(["image"], "frame.png", { type: "image/png" })
    const add = mock(async (input: unknown) => {
      order.push("add")
      return { createdNodeIds: ["frame"], warnings: [], input }
    })

    const result = await addCanvasUploadResources(
      {
        anchor: { x: 20, y: 40 },
        anchorOrigin: "center",
        canvasId: "canvas-a",
        files: [file],
        projectId: "project-a",
        relation: undefined,
        signal: new AbortController().signal,
        sources: [],
      },
      {
        add: add as never,
        createCommandId: () => "renderer:add",
        createLocalFileToken(selected) {
          order.push("token")
          expect(selected).toBe(file)
          return "opaque-file-token"
        },
        createSourceId: () => "source-a",
        sessionId: "AQEBAQEBAQEBAQEBAQEBAQ" as never,
      },
    )

    expect(order).toEqual(["token", "add"])
    expect(add).toHaveBeenCalledWith({
      anchor: { x: 20, y: 40 },
      anchorOrigin: "center",
      canvasId: "canvas-a",
      commandId: "renderer:add",
      localFiles: [
        {
          mediaType: "image/png",
          name: "frame.png",
          sourceId: "source-a",
          sourceToken: "opaque-file-token",
        },
      ],
      projectId: "project-a",
      sessionId: "AQEBAQEBAQEBAQEBAQEBAQ",
      sources: [],
    })
    expect(result).toMatchObject({ createdNodeIds: ["frame"] })
  })

  test("does not mint file authority or invoke Main when already canceled", async () => {
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    const createLocalFileToken = mock(() => "must-not-run")
    const add = mock(async () => ({ createdNodeIds: [], warnings: [] }))

    let rejected: unknown
    try {
      await addCanvasUploadResources(
        {
          anchor: { x: 0, y: 0 },
          canvasId: "canvas-a",
          files: [new File(["image"], "frame.png", { type: "image/png" })],
          projectId: "project-a",
          relation: undefined,
          signal: controller.signal,
          sources: [],
        },
        {
          add: add as never,
          createCommandId: () => "renderer:add",
          createLocalFileToken,
          createSourceId: () => "source-a",
          sessionId: "AQEBAQEBAQEBAQEBAQEBAQ" as never,
        },
      )
    } catch (error) {
      rejected = error
    }
    expect(rejected).toBeInstanceOf(Error)
    if (!(rejected instanceof Error)) throw new Error("Expected cancellation error")
    expect(rejected.message).toBe("cancelled")
    expect(createLocalFileToken).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  test("keeps every local disk File opaque for the preload token boundary", () => {
    const files = [
      new File(["# Brief"], "brief.md", { type: "text/markdown" }),
      new File(["video"], "clip.mp4", { type: "video/mp4" }),
    ]

    const result = resolveCanvasUploadItems(request({ files }), host())

    expect(result.sources).toEqual([])
    expect(result.localFiles).toEqual([
      { file: files[0], mediaType: "text/markdown", name: "brief.md", sourceId: "source-1" },
      { file: files[1], mediaType: "video/mp4", name: "clip.mp4", sourceId: "source-2" },
    ])
  })

  test("turns current-Project file and directory drags into portable host sources without copying or reading", () => {
    const drag = serializeProjectEntryDrag({
      entries: [
        { kind: "file", name: "brief.md", path: "docs/brief.md" },
        { kind: "file", name: "cover.png", path: "assets/cover.png" },
        { kind: "directory", name: "references", path: "design/references" },
      ],
      projectId: "project-a",
      version: 1,
    })

    const result = resolveCanvasUploadItems(
      request({
        transfer: { data: { [PROJECT_ENTRY_DRAG_TYPE]: drag }, types: [PROJECT_ENTRY_DRAG_TYPE] },
      }),
      host(),
    )

    expect(result.localFiles).toEqual([])
    expect(result.sources).toEqual([
      { kind: "host-file", path: "docs/brief.md", sourceId: "source-1" },
      { kind: "host-file", path: "assets/cover.png", sourceId: "source-2" },
      { kind: "host-directory", path: "design/references", sourceId: "source-3" },
    ])
  })

  test("maps only bounded current-Project drag hints to host-neutral optimistic presentations", () => {
    const drag = serializeProjectEntryDrag({
      entries: [
        {
          kind: "file",
          name: "cover.png",
          path: "assets/cover.png",
          presentation: {
            intrinsicHeight: 900,
            intrinsicWidth: 1_600,
            mediaKind: "image",
            thumbnailDataUrl: "data:image/png;base64,cHJldmlldw==",
          },
        },
        { kind: "file", name: "brief.md", path: "docs/brief.md" },
      ],
      projectId: "project-a",
      version: 1,
    })

    expect(
      resolveCanvasUploadPresentations(
        {
          files: [new File(["local"], "local.png", { type: "image/png" })],
          signal: new AbortController().signal,
          sources: [{ kind: "host-file", path: "existing.png", sourceId: "existing" }],
          transfer: { data: { [PROJECT_ENTRY_DRAG_TYPE]: drag }, types: [PROJECT_ENTRY_DRAG_TYPE] },
        },
        { projectId: "project-a" },
      ),
    ).toEqual([
      null,
      null,
      {
        intrinsicSize: { height: 900, width: 1_600 },
        mediaKind: "image",
        previewUrl: "data:image/png;base64,cHJldmlldw==",
        title: "cover.png",
      },
      null,
    ])
  })

  test("ignores Project drag payloads from another active Project", () => {
    const drag = serializeProjectEntryDrag({
      entries: [{ kind: "file", name: "brief.md", path: "brief.md" }],
      projectId: "project-b",
      version: 1,
    })

    expect(
      resolveCanvasUploadItems(
        request({
          transfer: { data: { [PROJECT_ENTRY_DRAG_TYPE]: drag }, types: [PROJECT_ENTRY_DRAG_TYPE] },
        }),
        host(),
      ),
    ).toEqual({ localFiles: [], sources: [] })
  })
})
