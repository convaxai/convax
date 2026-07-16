import { describe, expect, test } from "bun:test"

import {
  parseAgentCanvasResourceUri,
  parseAgentCanvasNodeResourceUri,
  prepareAgentResources,
} from "./agent-resource-preparation"

function canvasSnapshot() {
  return JSON.stringify({
    edges: [
      { id: "edge-related", source: "node-1", target: "node-2" },
      { id: "edge-unrelated", source: "node-2", target: "node-3" },
    ],
    id: "canvas-1",
    metadata: { title: "Canvas 1" },
    nodes: [
      {
        data: { kind: "file", label: "Launch brief", url: "" },
        id: "node-1",
        position: { x: 0, y: 0 },
        type: "file",
      },
      {
        data: { kind: "text", label: "Related", text: "Related text" },
        id: "node-2",
        position: { x: 320, y: 0 },
        type: "text",
      },
      {
        data: { kind: "text", label: "Unrelated", text: "Unrelated text" },
        id: "node-3",
        position: { x: 640, y: 0 },
        type: "text",
      },
    ],
    revision: 4,
  })
}

describe("prepareAgentResources", () => {
  test("resolves a scoped Canvas node mention into a read-only structured resource", async () => {
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
          return { content: canvasSnapshot(), name: "Stored Canvas" }
        },
      },
      "project-1",
      [{ kind: "resource", uri: "convax://canvas/canvas-1/node/node-1" }],
    )

    expect(projectRequests).toEqual([])
    expect(snapshotRequests).toEqual([{ canvasId: "canvas-1", projectId: "project-1" }])
    expect(resources[0]).toMatchObject({
      clientName: "convax",
      kind: "resource",
      mime: "application/json",
      name: "Launch brief",
      uri: "convax://canvas/canvas-1/node/node-1",
    })
    if (resources[0]?.kind !== "resource") throw new Error("Expected a structured resource")
    const content = JSON.parse(resources[0].content)
    expect(content).toMatchObject({
      canvas: { id: "canvas-1", name: "Stored Canvas", revision: 4 },
      node: { id: "node-1" },
      type: "convax.canvas-node",
      version: 1,
    })
    expect(content.edges.map((edge: { id: string }) => edge.id)).toEqual(["edge-related"])
  })

  test("resolves a full Canvas as a generic structured resource", async () => {
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
          return { content: canvasSnapshot(), name: "Stored name" }
        },
      },
      "project-1",
      [{ kind: "resource", name: "Attached name", uri: "convax://canvas/canvas-1" }],
    )

    expect(projectRequests).toEqual([])
    expect(snapshotRequests).toEqual([{ canvasId: "canvas-1", projectId: "project-1" }])
    expect(resources[0]).toMatchObject({
      clientName: "convax",
      kind: "resource",
      mime: "application/json",
      name: "Attached name",
      uri: "convax://canvas/canvas-1",
    })
    if (resources[0]?.kind !== "resource") throw new Error("Expected a structured resource")
    expect(JSON.parse(resources[0].content)).toMatchObject({
      canvas: { id: "canvas-1", revision: 4 },
      name: "Stored name",
      type: "convax.canvas",
      version: 1,
    })
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
      [{ kind: "resource", uri: "convax://canvas/canvas-1" }],
    )).rejects.toThrow("resources are unavailable")
  })

  test("rejects malformed or unsupported structured resource URIs", () => {
    for (const uri of [
      "https://example.com/canvas-1/node/node-1",
      "convax://project/canvas-1/node/node-1",
      "convax://user@canvas/canvas-1/node/node-1",
      "convax://canvas/canvas-1/node/node-1?project=other",
      "convax://canvas/canvas-1/node/node-1/extra",
    ]) {
      expect(() => parseAgentCanvasNodeResourceUri(uri)).toThrow("invalid")
    }
    expect(parseAgentCanvasResourceUri("convax://canvas/canvas-1")).toEqual({
      canvasId: "canvas-1",
      uri: "convax://canvas/canvas-1",
    })
    expect(parseAgentCanvasNodeResourceUri("convax://canvas/canvas-1/node/plugin%2Fnamespace%3Aitem")).toEqual({
      canvasId: "canvas-1",
      nodeId: "plugin/namespace:item",
      uri: "convax://canvas/canvas-1/node/plugin%2Fnamespace%3Aitem",
    })
  })

  test("rejects a missing Canvas node and an invalid snapshot", async () => {
    const manager = { resolveEntryPath: async () => "unused" }
    const resource = [{ kind: "resource" as const, uri: "convax://canvas/canvas-1/node/missing" }]
    await expect(prepareAgentResources(
      manager,
      { resolveCanvasSnapshot: async () => ({ content: canvasSnapshot() }) },
      "project-1",
      resource,
    )).rejects.toThrow("Canvas node was not found")
    await expect(prepareAgentResources(
      manager,
      { resolveCanvasSnapshot: async () => ({ content: "{not-json" }) },
      "project-1",
      resource,
    )).rejects.toThrow("Canvas snapshot is invalid")
  })
})
