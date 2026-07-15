import { describe, expect, test } from "bun:test"

import { prepareAgentCanvasContext, prepareAgentResources } from "./agent-resource-preparation"

describe("prepareAgentCanvasContext", () => {
  test("normalizes the host-provided active Canvas identity", () => {
    expect(prepareAgentCanvasContext({ canvasId: " canvas-main ", name: " Canvas 1 " })).toEqual({
      canvasId: "canvas-main",
      name: "Canvas 1",
    })
  })

  test("rejects an invalid active Canvas id", () => {
    expect(() => prepareAgentCanvasContext({ canvasId: "../document.json" })).toThrow("canvas reference is invalid")
  })
})

describe("prepareAgentResources", () => {
  test("resolves Canvas references through the snapshot port without reading a project path", async () => {
    const projectRequests: unknown[] = []
    const snapshotRequests: unknown[] = []
    const resources = await prepareAgentResources(
      {
        resolveEntryPath: async (input) => {
          projectRequests.push(input)
          return "/project"
        },
      },
      {
        resolveCanvasSnapshot: async (input) => {
          snapshotRequests.push(input)
          return { content: "{\"id\":\"canvas-1\"}", name: "Stored name" }
        },
      },
      "project-1",
      [{ canvasId: "canvas-1", kind: "canvas", name: "Attached name" }],
    )

    expect(projectRequests).toEqual([])
    expect(snapshotRequests).toEqual([{ canvasId: "canvas-1", projectId: "project-1" }])
    expect(resources).toEqual([{
      canvasId: "canvas-1",
      content: "{\"id\":\"canvas-1\"}",
      kind: "canvas",
      mime: "application/json",
      name: "Attached name",
    }])
    expect("path" in resources[0]!).toBe(false)
  })

  test("keeps ordinary file and directory resources project-relative", async () => {
    const requests: unknown[] = []
    const resources = await prepareAgentResources(
      {
        resolveEntryPath: async (input) => {
          requests.push(input)
          return `/project/${input.path ?? ""}`
        },
      },
      undefined,
      "project-1",
      [
        { kind: "file", path: "src/index.ts" },
        { kind: "directory", path: "assets" },
      ],
    )

    expect(requests).toEqual([
      { path: "src/index.ts", projectId: "project-1" },
      { path: "assets", projectId: "project-1" },
    ])
    expect(resources.map((resource) => resource.kind)).toEqual(["file", "directory"])
  })

  test("rejects private storage disguised as a normal file attachment", async () => {
    await expect(prepareAgentResources(
      { resolveEntryPath: async () => "/project/.convax/canvases/x/document.json" },
      undefined,
      "project-1",
      [{ kind: "file", path: ".convax/canvases/x/document.json" }],
    )).rejects.toThrow("private storage")
  })

  test("rejects Windows absolute paths and backslash private-storage paths", async () => {
    const manager = { resolveEntryPath: async () => "unused" }
    await expect(prepareAgentResources(
      manager,
      undefined,
      "project-1",
      [{ kind: "file", path: "C:\\project\\src\\index.ts" }],
    )).rejects.toThrow("project reference is invalid")
    await expect(prepareAgentResources(
      manager,
      undefined,
      "project-1",
      [{ kind: "file", path: "nested\\.CONVAX\\document.json" }],
    )).rejects.toThrow("private storage")
  })

  test("fails closed when Canvas snapshots are not wired", async () => {
    await expect(prepareAgentResources(
      { resolveEntryPath: async () => "/project" },
      undefined,
      "project-1",
      [{ canvasId: "canvas-1", kind: "canvas" }],
    )).rejects.toThrow("snapshots are unavailable")
  })
})
