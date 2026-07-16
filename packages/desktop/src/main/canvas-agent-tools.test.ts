import { describe, expect, test } from "bun:test"
import { CanvasApplicationService, CanvasResourceBusinessService } from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import { createCanvasAgentToolProvider } from "./canvas-agent-tools"

describe("Canvas Agent tools", () => {
  test("maps the Agent scope to generic Canvas document and live-view scopes", async () => {
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
      scopeId: "project-a",
    }])
    expect(reloaded).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])

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

  test("publishes host file and directory source schemas without project-specific source kinds", async () => {
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
    const schema = JSON.stringify(definitions.find((tool) => tool.name === "canvas_add_resources")?.inputSchema)
    expect(schema).toContain('"const":"host-file"')
    expect(schema).toContain('"const":"host-directory"')
    expect(schema).not.toContain("project-file")
    expect(schema).not.toContain("project-directory")
  })

  test("adds a host directory as a folder through the headless business path", async () => {
    let document = createCanvasDocument({ id: "canvas-main" })
    let storageVersion = "v0"
    const loadedRefs: unknown[] = []
    const savedRefs: unknown[] = []
    const preparationRequests: unknown[] = []
    const reloadedRefs: unknown[] = []
    const application = new CanvasApplicationService({
      async load(ref) {
        loadedRefs.push(ref)
        return { document, storageVersion }
      },
      async save(request) {
        savedRefs.push(request.ref)
        document = request.document
        storageVersion = "v1"
        return { storageVersion }
      },
    })
    const resources = new CanvasResourceBusinessService({
      async prepare(request) {
        preparationRequests.push(request)
        return {
          items: [{
            id: "folder-source",
            kind: "folder" as const,
            name: "references",
            path: "design/references",
          }],
        }
      },
    }, application)
    const provider = createCanvasAgentToolProvider({
      application,
      renderer: {
        async executeView() { throw new Error("Unexpected view") },
        async reloadDocument(ref) {
          reloadedRefs.push(ref)
          return true
        },
      },
      resources,
    })

    const result = await provider.callTool(
      { directory: "/project", scopeId: "project-a" },
      "canvas_add_resources",
      {
        anchor: { x: 80, y: 120 },
        canvasId: "canvas-main",
        commandId: "add-folder",
        expectedRevision: 0,
        sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder-source" }],
      },
    )

    expect(result).toMatchObject({ changed: true, revision: 1, sync: { reloaded: true } })
    expect(preparationRequests).toEqual([{
      canvasId: "canvas-main",
      scopeId: "project-a",
      sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder-source" }],
    }])
    expect(loadedRefs).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])
    expect(savedRefs).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])
    expect(reloadedRefs).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])
    expect(document.nodes).toHaveLength(1)
    expect(document.nodes[0]).toMatchObject({
      data: { kind: "folder", name: "references", path: "design/references" },
      type: "file",
    })
  })

  test("rejects malformed and legacy project-specific resource inputs before business execution", async () => {
    let calls = 0
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() { throw new Error("Unexpected execute") },
        async query() { return { nodes: [], revision: 0, storageVersion: "v0" } },
      },
      renderer: {
        async executeView() { throw new Error("Unexpected view") },
        async reloadDocument() { return false },
      },
      resources: {
        async addResources() {
          calls += 1
          throw new Error("Unexpected resources")
        },
      },
    })
    const base = {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "invalid-resource",
      expectedRevision: 0,
    }
    const scope = { directory: "/project", scopeId: "project-a" }

    await expect(provider.callTool(scope, "canvas_add_resources", {
      ...base,
      sources: [{ kind: "host-directory", sourceId: "folder" }],
    })).rejects.toThrow("sources[0].path")
    await expect(provider.callTool(scope, "canvas_add_resources", {
      ...base,
      sources: [{ kind: "project-directory", path: "design", sourceId: "folder" }],
    })).rejects.toThrow("Unsupported Canvas resource source: project-directory")
    await expect(provider.callTool(scope, "canvas_add_resources", {
      ...base,
      sources: [{ kind: "host-file", path: "readme.md", sourceId: 1 }],
    })).rejects.toThrow("sources[0].sourceId")
    await expect(provider.callTool(scope, "canvas_add_resources", {
      ...base,
      sources: [{ kind: "remote-url", sourceId: "remote", url: "file:///tmp/private" }],
    })).rejects.toThrow("must use HTTP or HTTPS")
    expect(calls).toBe(0)
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
