import { describe, expect, test } from "bun:test"
import {
  createCanvasDocument,
  createGroupNode,
  createMediaNode,
  createTextNode,
  setCanvasGroupAppearance,
  setCanvasGroupFolded,
} from "@convax/canvas"
import {
  loadProjectCanvasSidebarNodes,
  projectCanvasSidebarNodes,
  sameProjectCanvasNodeProjection,
} from "./project-canvas-sidebar-projection"

describe("Project Canvas sidebar projection", () => {
  test("reuses the active session projection without starting a compatibility document load", async () => {
    const document = createCanvasDocument({
      id: "active-canvas",
      nodes: [createTextNode({
        id: "note",
        label: "Session note",
        metadata: {},
        position: { x: 0, y: 0 },
        resourceState: { status: "ready" },
      })],
    })
    let compatibilityLoads = 0
    const loadDocument = async () => {
      compatibilityLoads += 1
      return document
    }

    expect(await loadProjectCanvasSidebarNodes({
      activeDocument: null,
      canvasId: document.id,
      loadDocument,
      projectId: "project",
    })).toEqual([])
    expect(await loadProjectCanvasSidebarNodes({
      activeDocument: document,
      canvasId: document.id,
      loadDocument,
      projectId: "project",
    })).toEqual([expect.objectContaining({ id: "note", label: "Session note" })])
    expect(compatibilityLoads).toBe(0)
  })

  test("keeps compatibility loading for an inactive Canvas", async () => {
    const document = createCanvasDocument({ id: "inactive-canvas" })
    let compatibilityLoads = 0

    expect(await loadProjectCanvasSidebarNodes({
      activeDocument: undefined,
      canvasId: document.id,
      loadDocument: async (ref) => {
        compatibilityLoads += 1
        expect(ref).toEqual({ canvasId: document.id, scopeId: "project" })
        return document
      },
      projectId: "project",
    })).toEqual([])
    expect(compatibilityLoads).toBe(1)
  })

  test("reuses the Canvas outline hierarchy and decorates nested media previews", () => {
    const group = createGroupNode({
      height: 320,
      id: "group",
      label: "Research",
      position: { x: 100, y: 100 },
      width: 420,
    })
    const nested = createGroupNode({
      height: 180,
      id: "nested",
      label: "References",
      parentId: group.id,
      position: { x: 40, y: 80 },
      width: 240,
    })
    const image = {
      ...createMediaNode({
        id: "image",
        label: "Moodboard",
        position: { x: 20, y: 20 },
        resource: {
          id: "image-resource",
          kind: "image" as const,
          metadata: {},
          state: { status: "ready" as const, url: "asset://moodboard" },
        },
      }),
      parentId: nested.id,
    }
    const note = {
      ...createTextNode({
        id: "note",
        label: "Question",
        metadata: {},
        position: { x: 20, y: 20 },
        resourceState: { status: "ready" },
      }),
      parentId: group.id,
    }

    let document = createCanvasDocument({ nodes: [image, nested, note, group] })
    document = setCanvasGroupAppearance(document, group.id, { color: "green", emoji: "leaf" })
    document = setCanvasGroupFolded(document, group.id, true)

    expect(projectCanvasSidebarNodes(document)).toEqual([
      expect.objectContaining({
        children: [
          expect.objectContaining({ id: "note" }),
          expect.objectContaining({
            children: [
              expect.objectContaining({
                id: "image",
                previewType: "image",
                previewUrl: "asset://moodboard",
              }),
            ],
            id: "nested",
          }),
        ],
        folderColor: "green",
        folderEmoji: "leaf",
        id: "group",
      }),
    ])
  })

  test("detects nested content, preview, and folder color changes", () => {
    const base = {
      canvasId: "canvas",
      nodes: [
        {
          children: [{ id: "image", kind: "image", label: "Image", previewUrl: "asset://first" }],
          folderColor: "green" as const,
          folderEmoji: "leaf" as const,
          id: "group",
          kind: "group",
          label: "Group",
        },
      ],
      projectId: "project",
    }

    expect(sameProjectCanvasNodeProjection(base, structuredClone(base))).toBe(true)
    expect(
      sameProjectCanvasNodeProjection(base, {
        ...base,
        nodes: [
          {
            ...base.nodes[0]!,
            children: [{ ...base.nodes[0]!.children[0]!, previewUrl: "asset://second" }],
          },
        ],
      }),
    ).toBe(false)
    expect(
      sameProjectCanvasNodeProjection(base, {
        ...base,
        nodes: [{ ...base.nodes[0]!, folderColor: "blue" }],
      }),
    ).toBe(false)
    expect(
      sameProjectCanvasNodeProjection(base, {
        ...base,
        nodes: [{ ...base.nodes[0]!, folderEmoji: "sparkles" }],
      }),
    ).toBe(false)
  })
})
