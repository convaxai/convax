import { describe, expect, mock, test } from "bun:test"
import type { CanvasResource, CanvasUploadRequest } from "@convax/canvas"
import { PROJECT_ENTRY_DRAG_TYPE, serializeProjectEntryDrag } from "@convax/project-files/drag"
import { canvasProjectEntryReferenceKey, resolveCanvasUploadItems, type CanvasUploadHost } from "./canvas-upload"

function request(input: Partial<CanvasUploadRequest>): CanvasUploadRequest {
  return {
    context: { documentId: "canvas", selectedNodeIds: [], source: "test" },
    files: [],
    signal: new AbortController().signal,
    ...input,
  }
}

function mediaResource(kind: "image" | "video", name: string): CanvasResource {
  return {
    id: `resource_${name}`,
    kind,
    metadata: {},
    name,
    state: { status: "ready", url: `convax-asset://${name}` },
  }
}

function host(overrides: Partial<CanvasUploadHost> = {}): CanvasUploadHost {
  return {
    copyProjectMediaFiles: mock(async () => []),
    importLocalMediaFiles: mock(async () => []),
    projectId: "project-a",
    readProjectTextFile: mock(async () => ({ content: "", contentRevision: "" })),
    ...overrides,
  }
}

describe("desktop canvas uploads", () => {
  test("keeps local text and media files in drop order", async () => {
    const uploadHost = host({
      importLocalMediaFiles: mock(async () => [mediaResource("video", "clip.mp4")]),
    })
    const items = await resolveCanvasUploadItems(
      request({
        files: [
          new File(["# Brief"], "brief.md", { type: "text/markdown" }),
          new File(["video"], "clip.mp4", { type: "video/mp4" }),
        ],
      }),
      uploadHost,
    )

    expect(items.map((item) => item.kind)).toEqual(["text", "video"])
    expect(items[0]).toMatchObject({
      mimeType: "text/markdown",
      name: "brief.md",
      state: { status: "ready", text: "# Brief" },
    })
    expect(items[0]).not.toHaveProperty("format")
    expect(uploadHost.importLocalMediaFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "clip.mp4" })],
      expect.any(AbortSignal),
    )
  })

  test("reads project text in place and copies only project media", async () => {
    const copyProjectMediaFiles = mock(async () => [mediaResource("image", "cover.png")])
    const readProjectTextFile = mock(async () => ({ content: "Project brief", contentRevision: "revision-a" }))
    const uploadHost = host({ copyProjectMediaFiles, readProjectTextFile })
    const drag = serializeProjectEntryDrag({
      entries: [
        { kind: "file", name: "brief.md", path: "docs/brief.md" },
        { kind: "file", name: "cover.png", path: "assets/cover.png" },
      ],
      projectId: "project-a",
      version: 1,
    })
    const items = await resolveCanvasUploadItems(
      request({
        transfer: { data: { [PROJECT_ENTRY_DRAG_TYPE]: drag }, types: [PROJECT_ENTRY_DRAG_TYPE] },
      }),
      uploadHost,
    )

    expect(items.map((item) => item.kind)).toEqual(["text", "image"])
    expect(readProjectTextFile).toHaveBeenCalledWith("docs/brief.md", expect.any(AbortSignal))
    expect(copyProjectMediaFiles).toHaveBeenCalledWith(["assets/cover.png"], expect.any(AbortSignal))
  })

  test("ignores project transfers from another project", async () => {
    const uploadHost = host()
    const drag = serializeProjectEntryDrag({
      entries: [{ kind: "file", name: "brief.md", path: "brief.md" }],
      projectId: "project-b",
      version: 1,
    })
    const items = await resolveCanvasUploadItems(
      request({
        transfer: { data: { [PROJECT_ENTRY_DRAG_TYPE]: drag }, types: [PROJECT_ENTRY_DRAG_TYPE] },
      }),
      uploadHost,
    )

    expect(items).toEqual([])
    expect(uploadHost.readProjectTextFile).not.toHaveBeenCalled()
  })

  test("turns a dragged folder into one file-node resource without copying or reading it", async () => {
    const uploadHost = host()
    const drag = serializeProjectEntryDrag({
      entries: [{ kind: "directory", name: "design", path: "assets/design" }],
      projectId: "project-a",
      version: 1,
    })

    const items = await resolveCanvasUploadItems(
      request({
        transfer: { data: { [PROJECT_ENTRY_DRAG_TYPE]: drag }, types: [PROJECT_ENTRY_DRAG_TYPE] },
      }),
      uploadHost,
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: "folder",
      metadata: {
        [canvasProjectEntryReferenceKey]: { kind: "directory", path: "assets/design" },
      },
      name: "design",
      state: { status: "stale" },
    })
    expect(items[0]).not.toHaveProperty("path")
    expect(uploadHost.copyProjectMediaFiles).not.toHaveBeenCalled()
    expect(uploadHost.readProjectTextFile).not.toHaveBeenCalled()
  })
})
