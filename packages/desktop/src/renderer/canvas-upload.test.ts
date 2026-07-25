import { describe, expect, test } from "bun:test"
import { PROJECT_ENTRY_DRAG_TYPE, serializeProjectEntryDrag } from "@convax/project-files/drag"
import { resolveCanvasUploadItems, type CanvasUploadRequest } from "./canvas-upload"

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
