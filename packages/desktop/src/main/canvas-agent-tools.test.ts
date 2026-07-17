import { describe, expect, test } from "bun:test"
import { CanvasApplicationService, CanvasResourceBusinessService } from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import type { CanvasViewSnapshot } from "@convax/canvas/view"
import { createCanvasAgentToolProvider } from "./canvas-agent-tools"

function activeCanvasSnapshot(
  revision: number,
  input: { canvasId?: string; scopeId?: string } = {},
): CanvasViewSnapshot {
  return {
    documentId: input.canvasId ?? "canvas-main",
    revision,
    scopeId: input.scopeId ?? "project-a",
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId: "desktop-main",
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

describe("Canvas Agent tools", () => {
  test("maps the Agent scope to generic Canvas document and live-view scopes", async () => {
    const executed: unknown[] = []
    const queried: unknown[] = []
    const reloaded: unknown[] = []
    const viewed: unknown[] = []
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 4 }
    let liveRevision = 4
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute(request) {
          executed.push(request)
          liveRevision = 5
          return {
            affectedNodeIds: ["node-a"],
            changed: true,
            createdNodeIds: [],
            document: { ...document, revision: 5 },
            storageVersion: "v5",
            warnings: [],
          }
        },
        async query(ref, query) {
          queried.push({ query, ref })
          return { nodes: [], revision: 4, storageVersion: "v4" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(liveRevision)
        },
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

    await provider.callTool(scope, "canvas_query_nodes", {
      canvasId: "canvas-main",
      limit: 10,
    })
    expect(queried).toEqual([
      {
        query: { ids: undefined, kinds: undefined, limit: 10, relatedToNodeIds: undefined, text: undefined },
        ref: { canvasId: "canvas-main", scopeId: "project-a" },
      },
    ])

    const result = await provider.callTool(scope, "canvas_apply_primitive", {
      canvasId: "canvas-main",
      command: { delta: { x: 12, y: -3 }, nodeIds: ["node-a"], type: "nodes.move" },
      commandId: "move-node-a",
      expectedRevision: 4,
    })

    expect(result).toMatchObject({ changed: true, revision: 5, sync: { reloaded: true } })
    expect(executed).toMatchObject([
      {
        canvasId: "canvas-main",
        envelope: {
          actor: { id: "opencode:project-a", kind: "agent" },
          command: { type: "nodes.move" },
          expectedRevision: 4,
        },
        scopeId: "project-a",
      },
    ])
    expect(reloaded).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])

    await provider.callTool(scope, "canvas_view", {
      canvasId: "canvas-main",
      command: { nodeIds: ["node-a"], select: true, type: "nodes.reveal" },
      expectedRevision: 5,
    })
    expect(viewed).toMatchObject([
      {
        expectedDocumentId: "canvas-main",
        expectedRevision: 5,
        expectedScopeId: "project-a",
        viewId: "desktop-main",
      },
    ])
  })

  test("rejects model-selected inactive Canvas ids for every Canvas tool", async () => {
    const calls = { execute: 0, query: 0, resources: 0, view: 0 }
    const snapshotViewIds: string[] = []
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          calls.execute += 1
          throw new Error("Unexpected execute")
        },
        async query() {
          calls.query += 1
          throw new Error("Unexpected query")
        },
      },
      renderer: {
        async getViewSnapshot(viewId) {
          snapshotViewIds.push(viewId)
          return activeCanvasSnapshot(7)
        },
        async executeView() {
          calls.view += 1
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return false
        },
      },
      resources: {
        async addResources() {
          calls.resources += 1
          throw new Error("Unexpected resources")
        },
      },
    })
    const scope = { directory: "/project", scopeId: "project-a" }
    const requests = [
      ["canvas_query_nodes", { canvasId: "canvas-inactive" }],
      [
        "canvas_add_resources",
        {
          anchor: { x: 0, y: 0 },
          canvasId: "canvas-inactive",
          commandId: "inactive-add",
          expectedRevision: 7,
          sources: [{ kind: "inline-text", sourceId: "source", text: "Text" }],
        },
      ],
      [
        "canvas_apply_primitive",
        {
          canvasId: "canvas-inactive",
          command: { delta: { x: 1, y: 1 }, nodeIds: ["node-a"], type: "nodes.move" },
          commandId: "inactive-move",
          expectedRevision: 7,
        },
      ],
      [
        "canvas_view",
        {
          canvasId: "canvas-inactive",
          command: { type: "selection.clear" },
          expectedRevision: 7,
        },
      ],
    ] as const

    for (const [name, request] of requests) {
      await expect(provider.callTool(scope, name, request)).rejects.toThrow(
        "canvasId must match the live active Canvas",
      )
    }
    expect(calls).toEqual({ execute: 0, query: 0, resources: 0, view: 0 })
    expect(snapshotViewIds).toEqual(requests.map(() => "desktop-main"))
  })

  test("fails closed without a live Canvas or when the live Canvas belongs to another Project", async () => {
    let liveSnapshot: CanvasViewSnapshot | null = null
    let queryCalls = 0
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          throw new Error("Unexpected execute")
        },
        async query() {
          queryCalls += 1
          return { nodes: [], revision: 0, storageVersion: "v0" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return liveSnapshot
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return false
        },
      },
      resources: {
        async addResources() {
          throw new Error("Unexpected resources")
        },
      },
    })
    const scope = { directory: "/project", scopeId: "project-a" }

    await expect(
      provider.callTool(scope, "canvas_query_nodes", {
        canvasId: "canvas-main",
      }),
    ).rejects.toThrow("No live active Canvas")

    liveSnapshot = activeCanvasSnapshot(0, { scopeId: "project-b" })
    await expect(
      provider.callTool(scope, "canvas_query_nodes", {
        canvasId: "canvas-main",
      }),
    ).rejects.toThrow("outside the Agent Project scope")
    expect(queryCalls).toBe(0)
  })

  test("rejects stale revisions before primitive mutation or view execution", async () => {
    const calls = { execute: 0, view: 0 }
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          calls.execute += 1
          throw new Error("Unexpected execute")
        },
        async query() {
          return { nodes: [], revision: 8, storageVersion: "v8" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(8)
        },
        async executeView() {
          calls.view += 1
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return false
        },
      },
      resources: {
        async addResources() {
          throw new Error("Unexpected resources")
        },
      },
    })
    const scope = { directory: "/project", scopeId: "project-a" }
    const requests = [
      [
        "canvas_apply_primitive",
        {
          canvasId: "canvas-main",
          command: { delta: { x: 1, y: 1 }, nodeIds: ["node-a"], type: "nodes.move" },
          commandId: "stale-move",
          expectedRevision: 7,
        },
      ],
      [
        "canvas_view",
        {
          canvasId: "canvas-main",
          command: { type: "selection.clear" },
          expectedRevision: 7,
        },
      ],
    ] as const

    for (const [name, request] of requests) {
      await expect(provider.callTool(scope, name, request)).rejects.toThrow("expectedRevision does not match")
    }
    expect(calls).toEqual({ execute: 0, view: 0 })
  })

  test("exposes business tools by default while validating unsafe view values", async () => {
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          throw new Error("Unexpected execute")
        },
        async query() {
          return { nodes: [], revision: 0, storageVersion: "v0" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return null
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return false
        },
      },
      resources: {
        async addResources() {
          throw new Error("Unexpected resources")
        },
      },
    })
    const definitions = await provider.listTools({ directory: "/project", scopeId: "project-a" })
    expect(definitions.map((tool) => tool.name)).toEqual([
      "canvas_query_nodes",
      "canvas_add_resources",
      "canvas_apply_primitive",
      "canvas_view",
    ])
    await expect(
      provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_view", {
        canvasId: "canvas-main",
        command: { type: "viewport.zoom", zoom: 0 },
        expectedRevision: 0,
      }),
    ).rejects.toThrow("command.zoom")
    await expect(
      provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_add_resources", {
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "invalid-view",
        expectedRevision: 0,
        sources: [{ kind: "inline-text", sourceId: "source", text: "Text" }],
        view: { select: "yes" },
      }),
    ).rejects.toThrow("view.select")
  })

  test("publishes host file and directory source schemas without project-specific source kinds", async () => {
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          throw new Error("Unexpected execute")
        },
        async query() {
          return { nodes: [], revision: 0, storageVersion: "v0" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return null
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return false
        },
      },
      resources: {
        async addResources() {
          throw new Error("Unexpected resources")
        },
      },
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
    const resources = new CanvasResourceBusinessService(
      {
        async prepare(request) {
          preparationRequests.push(request)
          return {
            items: [
              {
                id: "folder-source",
                kind: "folder" as const,
                name: "references",
                path: "design/references",
              },
            ],
          }
        },
      },
      application,
    )
    const provider = createCanvasAgentToolProvider({
      application,
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(0)
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument(ref) {
          reloadedRefs.push(ref)
          return true
        },
      },
      resources,
    })

    const result = await provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_add_resources", {
      anchor: { x: 80, y: 120 },
      canvasId: "canvas-main",
      commandId: "add-folder",
      expectedRevision: 0,
      sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder-source" }],
    })

    expect(result).toMatchObject({ changed: true, revision: 1, sync: { reloaded: true } })
    expect(preparationRequests).toEqual([
      {
        canvasId: "canvas-main",
        scopeId: "project-a",
        sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder-source" }],
      },
    ])
    expect(loadedRefs).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])
    expect(savedRefs).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])
    expect(reloadedRefs).toEqual([{ canvasId: "canvas-main", scopeId: "project-a" }])
    expect(document.nodes).toHaveLength(1)
    expect(document.nodes[0]).toMatchObject({
      data: { kind: "folder", name: "references", path: "design/references" },
      type: "file",
    })
  })

  test("replays a stale resource addition on the latest Canvas revision", async () => {
    let document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 1 }
    let storageVersion = "v1"
    let preparationCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return { document, storageVersion }
      },
      async save(request) {
        document = request.document
        storageVersion = "v2"
        return { storageVersion }
      },
    })
    const resources = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [{ id: "note", kind: "text" as const, text: "Latest context" }] }
        },
      },
      application,
    )
    const provider = createCanvasAgentToolProvider({
      application,
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(1)
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return true
        },
      },
      resources,
    })

    const result = await provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_add_resources", {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "stale-resource-add",
      expectedRevision: 0,
      sources: [{ kind: "inline-text", sourceId: "note", text: "Latest context" }],
    })

    expect(result).toMatchObject({
      changed: true,
      revision: 2,
      sync: { reloaded: true },
      warnings: [
        "Canvas changed while resources were being added; replayed from revision 0 on revision 1 after 1 conflict retry.",
      ],
    })
    expect(preparationCalls).toBe(1)
    expect(document.nodes).toHaveLength(1)
  })

  test("rejects malformed and legacy project-specific resource inputs before business execution", async () => {
    let calls = 0
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          throw new Error("Unexpected execute")
        },
        async query() {
          return { nodes: [], revision: 0, storageVersion: "v0" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return null
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          return false
        },
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

    await expect(
      provider.callTool(scope, "canvas_add_resources", {
        ...base,
        sources: [{ kind: "host-directory", sourceId: "folder" }],
      }),
    ).rejects.toThrow("sources[0].path")
    await expect(
      provider.callTool(scope, "canvas_add_resources", {
        ...base,
        sources: [{ kind: "project-directory", path: "design", sourceId: "folder" }],
      }),
    ).rejects.toThrow("Unsupported Canvas resource source: project-directory")
    await expect(
      provider.callTool(scope, "canvas_add_resources", {
        ...base,
        sources: [{ kind: "host-file", path: "readme.md", sourceId: 1 }],
      }),
    ).rejects.toThrow("sources[0].sourceId")
    await expect(
      provider.callTool(scope, "canvas_add_resources", {
        ...base,
        sources: [{ kind: "remote-url", sourceId: "remote", url: "file:///tmp/private" }],
      }),
    ).rejects.toThrow("must use HTTP or HTTPS")
    expect(calls).toBe(0)
  })

  test("keeps a committed business mutation successful when its optional view update fails", async () => {
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 3 }
    const provider = createCanvasAgentToolProvider({
      application: {
        async execute() {
          throw new Error("Unexpected execute")
        },
        async query() {
          return { nodes: [], revision: 2, storageVersion: "v2" }
        },
      },
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(2)
        },
        async executeView() {
          throw new Error("View changed before reveal")
        },
        async reloadDocument() {
          return true
        },
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

    const result = await provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_add_resources", {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "add-once",
      expectedRevision: 2,
      sources: [{ kind: "inline-text", sourceId: "source", text: "Saved" }],
      view: { select: true },
    })

    expect(result).toMatchObject({
      changed: true,
      revision: 3,
      warnings: [expect.stringContaining("resources were saved")],
    })
  })
})
