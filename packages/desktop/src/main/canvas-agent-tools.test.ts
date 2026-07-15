import { describe, expect, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas/core"
import { createCanvasAgentToolProvider } from "./canvas-agent-tools"

describe("Canvas Agent tools", () => {
  test("scopes primitive document changes and live view actions to one project", async () => {
    const executed: unknown[] = []
    const reloaded: unknown[] = []
    const viewed: unknown[] = []
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 4 }
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute(request) {
          executed.push(request)
          return {
            affectedNodeIds: ["node-a"],
            changed: true,
            createdNodeIds: [],
            document: { ...document, revision: 5 },
            storageVersion: "v5",
            warnings: [],
          }
        },
        async query() {
          return { nodes: [], revision: 4, storageVersion: "v4" }
        },
      },
      renderer: {
        async executeView(input) {
          viewed.push(input)
          return {
            foundNodeIds: ["node-a"],
            missingNodeIds: [],
            snapshot: {
              documentId: "canvas-main",
              revision: 5,
              scopeId: "project-a",
              selectedEdgeIds: [],
              selectedNodeIds: ["node-a"],
              viewId: "desktop-main",
              viewport: { x: 0, y: 0, zoom: 1 },
            },
          }
        },
        async reloadDocument(ref) {
          reloaded.push(ref)
          return true
        },
      },
      resources: {
        async addResources() {
          throw new Error("Unexpected resource call")
        },
      },
    })
    const scope = { directory: "/project/a", scopeId: "project-a" }

    const result = await provider.callTool(scope, "canvas_apply_primitive", {
      canvasId: "canvas-main",
      command: { delta: { x: 12, y: -3 }, nodeIds: ["node-a"], type: "nodes.move" },
      commandId: "move-node-a",
      expectedRevision: 4,
    })

    expect(result).toMatchObject({ changed: true, revision: 5, sync: { reloaded: true } })
    expect(executed).toMatchObject([{
      canvasId: "canvas-main",
      envelope: {
        actor: { id: "opencode:project-a", kind: "agent" },
        command: { type: "nodes.move" },
        expectedRevision: 4,
      },
      projectId: "project-a",
    }])
    expect(reloaded).toEqual([{ canvasId: "canvas-main", projectId: "project-a" }])

    await provider.callTool(scope, "canvas_view", {
      canvasId: "canvas-main",
      command: { nodeIds: ["node-a"], select: true, type: "nodes.reveal" },
      expectedRevision: 5,
    })
    expect(viewed).toMatchObject([{
      expectedDocumentId: "canvas-main",
      expectedRevision: 5,
      expectedScopeId: "project-a",
      viewId: "desktop-main",
    }])
  })

  test("exposes business tools by default while validating unsafe view values", async () => {
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() { throw new Error("Unexpected execute") },
        async query() { return { nodes: [], revision: 0, storageVersion: "v0" } },
      },
      renderer: {
        async executeView() { throw new Error("Unexpected view") },
        async reloadDocument() { return false },
      },
      resources: { async addResources() { throw new Error("Unexpected resources") } },
    })
    const definitions = await provider.listTools({ directory: "/project", scopeId: "project-a" })
    expect(definitions.map((tool) => tool.name)).toEqual([
      "canvas_query_nodes",
      "canvas_add_resources",
      "canvas_apply_primitive",
      "canvas_view",
    ])
    await expect(provider.callTool(
      { directory: "/project", scopeId: "project-a" },
      "canvas_view",
      { canvasId: "canvas-main", command: { type: "viewport.zoom", zoom: 0 }, expectedRevision: 0 },
    )).rejects.toThrow("command.zoom")
    await expect(provider.callTool(
      { directory: "/project", scopeId: "project-a" },
      "canvas_add_resources",
      {
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "invalid-view",
        expectedRevision: 0,
        sources: [{ kind: "inline-text", sourceId: "source", text: "Text" }],
        view: { select: "yes" },
      },
    )).rejects.toThrow("view.select")
  })

  test("keeps a committed business mutation successful when its optional view update fails", async () => {
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 3 }
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() { throw new Error("Unexpected execute") },
        async query() { return { nodes: [], revision: 2, storageVersion: "v2" } },
      },
      renderer: {
        async executeView() { throw new Error("View changed before reveal") },
        async reloadDocument() { return true },
      },
      resources: {
        async addResources() {
          return {
            affectedNodeIds: ["created"],
            changed: true,
            createdNodeIds: ["created"],
            document,
            storageVersion: "v3",
            warnings: [],
          }
        },
      },
    })

    const result = await provider.callTool(
      { directory: "/project", scopeId: "project-a" },
      "canvas_add_resources",
      {
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "add-once",
        expectedRevision: 2,
        sources: [{ kind: "inline-text", sourceId: "source", text: "Saved" }],
        view: { select: true },
      },
    )

    expect(result).toMatchObject({
      changed: true,
      revision: 3,
      warnings: [expect.stringContaining("resources were saved")],
    })
  })
})
