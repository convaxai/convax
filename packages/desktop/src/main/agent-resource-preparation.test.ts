import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createGroupNode, createTextNode } from "@convax/canvas/core"

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
        data: {
          kind: "file",
          label: "Launch brief",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Docs/launch.pdf" } },
        },
        id: "node-1",
        position: { x: 0, y: 0 },
        type: "file",
      },
      {
        data: {
          kind: "text",
          label: "Related",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/related.md" } },
        },
        id: "node-2",
        position: { x: 320, y: 0 },
        type: "file",
      },
      {
        data: {
          kind: "text",
          label: "Unrelated",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/unrelated.md" } },
        },
        id: "node-3",
        position: { x: 640, y: 0 },
        type: "file",
      },
    ],
    revision: 4,
  })
}

function nestedGroupCanvasSnapshot() {
  const group = createGroupNode({
    height: 400,
    id: "group-1",
    label: "Research",
    position: { x: 0, y: 0 },
    width: 600,
  })
  const childA = {
    ...createTextNode({ id: "child-a", label: "Child A", position: { x: 20, y: 20 } }),
    parentId: group.id,
  }
  const childB = {
    ...createGroupNode({
      height: 180,
      id: "child-b",
      label: "Child B",
      position: { x: 20, y: 160 },
      width: 240,
    }),
    parentId: group.id,
  }
  const nestedChild = {
    ...createTextNode({ id: "nested-child", label: "Nested", position: { x: 10, y: 10 } }),
    parentId: childB.id,
  }
  const unrelated = createTextNode({ id: "unrelated", label: "Unrelated", position: { x: 800, y: 0 } })
  return JSON.stringify(
    createCanvasDocument({
      edges: [
        { id: "edge-child", source: "child-a", target: "child-b" },
        { id: "edge-nested", source: "nested-child", target: "unrelated" },
      ],
      id: "canvas-1",
      nodes: [group, childA, childB, nestedChild, unrelated],
      title: "Nested groups",
    }),
  )
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
    expect(content).not.toHaveProperty("children")
  })

  test("prepares a selected group with only its direct children", async () => {
    const prepared = await prepareAgentResources(
      { resolveEntryPath: async () => "unused" },
      { resolveCanvasSnapshot: async () => ({ content: nestedGroupCanvasSnapshot() }) },
      "project-1",
      [{ kind: "resource", uri: "convax://canvas/canvas-1/node/group-1" }],
    )

    if (prepared[0]?.kind !== "resource") throw new Error("Expected a structured resource")
    const content = JSON.parse(prepared[0].content)
    expect(content.node.id).toBe("group-1")
    expect(content.children.map((node: { id: string }) => node.id)).toEqual(["child-a", "child-b"])
    expect(content.children.map((node: { id: string }) => node.id)).not.toContain("nested-child")
    expect(content.children.map((node: { id: string }) => node.id)).not.toContain("unrelated")
    expect(content.edges.map((edge: { id: string }) => edge.id)).toEqual(["edge-child"])
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
    await expect(
      prepareAgentResources(
        { resolveEntryPath: async () => "/project/.convax/canvases/x/document.json" },
        undefined,
        "project-1",
        [{ kind: "file", path: ".convax/canvases/x/document.json" }],
      ),
    ).rejects.toThrow("private storage")
  })

  test("rejects Windows absolute paths and backslash private-storage paths", async () => {
    const manager = { resolveEntryPath: async () => "unused" }
    await expect(
      prepareAgentResources(manager, undefined, "project-1", [{ kind: "file", path: "C:\\project\\src\\index.ts" }]),
    ).rejects.toThrow("project reference is invalid")
    await expect(
      prepareAgentResources(manager, undefined, "project-1", [
        { kind: "file", path: "nested\\.CONVAX\\document.json" },
      ]),
    ).rejects.toThrow("private storage")
  })

  test("fails closed when Canvas snapshots are not wired", async () => {
    await expect(
      prepareAgentResources({ resolveEntryPath: async () => "/project" }, undefined, "project-1", [
        { kind: "resource", uri: "convax://canvas/canvas-1" },
      ]),
    ).rejects.toThrow("resources are unavailable")
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
    await expect(
      prepareAgentResources(
        manager,
        { resolveCanvasSnapshot: async () => ({ content: canvasSnapshot() }) },
        "project-1",
        resource,
      ),
    ).rejects.toThrow("Canvas node was not found")
    await expect(
      prepareAgentResources(
        manager,
        { resolveCanvasSnapshot: async () => ({ content: "{not-json" }) },
        "project-1",
        resource,
      ),
    ).rejects.toThrow("Canvas snapshot is invalid")
  })
})
