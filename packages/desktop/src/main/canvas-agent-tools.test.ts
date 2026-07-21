import { describe, expect, test } from "bun:test"
import {
  CanvasApplicationService,
  CanvasResourceBusinessService,
  CanvasRevisionConflictError,
  type CanvasDocumentRef,
  CanvasResourcePartialFailureError,
} from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import type { CanvasViewSnapshot } from "@convax/canvas/view"
import { createCanvasAgentToolProvider } from "./canvas-agent-tools"

const projectCanvases = {
  async getCanvasCatalog({ projectId }: { projectId: string }) {
    return {
      canvases: ["canvas-main", "canvas-inactive"].map((id, index) => ({
        createdAt: index,
        id,
        name: id === "canvas-main" ? "Main" : "Inactive",
        updatedAt: index,
      })),
      projectId,
    }
  },
}

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
    const viewed: unknown[] = []
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 4 }
    let liveRevision = 4
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
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
        async reloadDocument() {
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

  test("allows document tools on an inactive catalog Canvas while keeping view commands active-only", async () => {
    const calls = { execute: 0, query: 0, resources: 0, view: 0 }
    const snapshotViewIds: string[] = []
    const inactiveDocument = { ...createCanvasDocument({ id: "canvas-inactive" }), revision: 8 }
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
      application: {
        async execute() {
          calls.execute += 1
          return {
            affectedNodeIds: ["node-a"],
            changed: true,
            createdNodeIds: [],
            document: inactiveDocument,
            storageVersion: "v8",
            warnings: [],
          }
        },
        async query() {
          calls.query += 1
          return { nodes: [], revision: 7, storageVersion: "v7" }
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
          return {
            affectedNodeIds: ["created"],
            changed: true,
            createdNodeIds: ["created"],
            document: inactiveDocument,
            storageVersion: "v8",
            warnings: [],
          }
        },
      },
    })
    const scope = { directory: "/project", scopeId: "project-a" }

    await provider.callTool(scope, "canvas_query_nodes", { canvasId: "canvas-inactive" })
    await provider.callTool(scope, "canvas_apply_primitive", {
      canvasId: "canvas-inactive",
      command: { delta: { x: 1, y: 1 }, nodeIds: ["node-a"], type: "nodes.move" },
      commandId: "inactive-move",
      expectedRevision: 7,
    })
    await provider.callTool(scope, "canvas_add_resources", {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-inactive",
      commandId: "inactive-add",
      expectedRevision: 7,
      sources: [{ kind: "new-text", sourceId: "source", text: "Text" }],
    })
    await expect(
      provider.callTool(scope, "canvas_view", {
        canvasId: "canvas-inactive",
        command: { type: "selection.clear" },
        expectedRevision: 7,
      }),
    ).rejects.toThrow("canvasId must match the live active Canvas")

    expect(calls).toEqual({ execute: 1, query: 1, resources: 1, view: 0 })
    expect(snapshotViewIds).toEqual(["desktop-main", "desktop-main", "desktop-main"])
  })

  test("lists and reads Canvases from the host Project scope without requiring a mounted view", async () => {
    const catalogProjectIds: string[] = []
    let queryCalls = 0
    let returnedProjectId = "project-a"
    const provider = createCanvasAgentToolProvider({
      canvases: {
        async getCanvasCatalog({ projectId }) {
          catalogProjectIds.push(projectId)
          return { ...(await projectCanvases.getCanvasCatalog({ projectId })), projectId: returnedProjectId }
        },
      },
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
          throw new Error("Document reads must not require the mounted view")
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

    await expect(provider.callTool(scope, "canvas_list", { projectId: "project-b" })).rejects.toThrow(
      "does not accept Project selection arguments",
    )
    expect(await provider.callTool(scope, "canvas_list", {})).toMatchObject({
      canvases: [{ id: "canvas-main" }, { id: "canvas-inactive" }],
      projectId: "project-a",
    })
    await provider.callTool(scope, "canvas_query_nodes", { canvasId: "canvas-main" })
    await expect(
      provider.callTool(scope, "canvas_query_nodes", {
        canvasId: "canvas-missing",
      }),
    ).rejects.toThrow("current Agent Project catalog")
    expect(queryCalls).toBe(1)
    returnedProjectId = "project-b"
    await expect(provider.callTool(scope, "canvas_list", {})).rejects.toThrow("outside the Agent Project scope")
    expect(catalogProjectIds).toEqual(["project-a", "project-a", "project-a", "project-a"])
  })

  test("preserves application revision conflicts and mounted-view revision guards", async () => {
    const calls = { execute: 0, view: 0 }
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
      application: {
        async execute() {
          calls.execute += 1
          throw new CanvasRevisionConflictError(7, 8)
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
    await expect(
      provider.callTool(scope, "canvas_apply_primitive", {
        canvasId: "canvas-main",
        command: { delta: { x: 1, y: 1 }, nodeIds: ["node-a"], type: "nodes.move" },
        commandId: "stale-move",
        expectedRevision: 7,
      }),
    ).rejects.toThrow("Canvas revision conflict")
    await expect(
      provider.callTool(scope, "canvas_view", {
        canvasId: "canvas-main",
        command: { type: "selection.clear" },
        expectedRevision: 7,
      }),
    ).rejects.toThrow("expectedRevision does not match")
    expect(calls).toEqual({ execute: 1, view: 0 })
  })

  test("executes auto-layout as a business command for an inactive Canvas", async () => {
    const executed: unknown[] = []
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
      application: {
        async execute(request) {
          executed.push(request)
          return {
            affectedNodeIds: ["node-a", "node-b"],
            changed: true,
            createdNodeIds: [],
            document: { ...createCanvasDocument({ id: "canvas-inactive" }), revision: 6 },
            storageVersion: "v6",
            warnings: [],
          }
        },
        async query() {
          throw new Error("Unexpected query")
        },
      },
      renderer: {
        async getViewSnapshot() {
          throw new Error("Auto-layout must not require the mounted view")
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

    const result = await provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_auto_layout", {
      canvasId: "canvas-inactive",
      commandId: "layout-inactive",
      expectedRevision: 5,
      nodeIds: ["node-a", "node-b"],
      options: {
        componentPackingScale: 0.7,
        isolatedPlacement: "left",
        strategy: "vertical-directed-cluster",
      },
    })

    expect(result).toMatchObject({ changed: true, revision: 6, sync: { reloaded: false } })
    expect(executed).toMatchObject([
      {
        canvasId: "canvas-inactive",
        envelope: {
          actor: { id: "opencode:project-a", kind: "agent" },
          command: {
            nodeIds: ["node-a", "node-b"],
            options: {
              componentPackingScale: 0.7,
              isolatedPlacement: "left",
              strategy: "vertical-directed-cluster",
            },
            type: "canvas.auto-layout",
          },
          commandId: "layout-inactive",
          expectedRevision: 5,
        },
        scopeId: "project-a",
      },
    ])
  })

  test("exposes business tools by default while validating unsafe view values", async () => {
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
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
      "canvas_list",
      "canvas_query_nodes",
      "canvas_auto_layout",
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
      provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_view", {
        canvasId: "canvas-main",
        command: { maxZoom: 0.1, type: "viewport.fit" },
        expectedRevision: 0,
      }),
    ).rejects.toThrow("command.maxZoom")
    await expect(
      provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_view", {
        canvasId: "canvas-main",
        command: { position: { x: 0, y: 0 }, type: "viewport.center", zoom: 0.1 },
        expectedRevision: 0,
      }),
    ).rejects.toThrow("command.zoom")
    await expect(
      provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_view", {
        canvasId: "canvas-main",
        command: { type: "viewport.zoom", zoom: 3 },
        expectedRevision: 0,
      }),
    ).rejects.toThrow("command.zoom")
    await expect(
      provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_add_resources", {
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "invalid-view",
        expectedRevision: 0,
        sources: [{ kind: "new-text", sourceId: "source", text: "Text" }],
        view: { select: "yes" },
      }),
    ).rejects.toThrow("view.select")
  })

  test("publishes host file and directory source schemas without project-specific source kinds", async () => {
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
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
    expect(schema).toContain('"const":"new-text"')
    expect(schema).not.toContain("inline-text")
    expect(schema).not.toContain("remote-url")
    expect(schema).not.toContain("project-file")
    expect(schema).not.toContain("project-directory")
  })

  test("adds a host directory as a folder through the headless business path", async () => {
    let document = createCanvasDocument({ id: "canvas-main" })
    let storageVersion = "v0"
    const loadedRefs: unknown[] = []
    const savedRefs: unknown[] = []
    const preparationRequests: unknown[] = []
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
                metadata: {},
                name: "references",
                state: { status: "stale" as const },
              },
            ],
          }
        },
      },
      application,
    )
    const provider = createCanvasAgentToolProvider({
      application,
      canvases: projectCanvases,
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(document.revision)
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
    expect(document.nodes).toHaveLength(1)
    expect(document.nodes[0]).toMatchObject({
      data: { kind: "folder", name: "references" },
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
          return {
            items: [
              {
                id: "note",
                kind: "text" as const,
                metadata: {},
                state: { status: "ready" as const, text: "Latest context" },
              },
            ],
          }
        },
      },
      application,
    )
    const provider = createCanvasAgentToolProvider({
      application,
      canvases: projectCanvases,
      renderer: {
        async getViewSnapshot() {
          return activeCanvasSnapshot(document.revision)
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
      sources: [{ kind: "new-text", sourceId: "note", text: "Latest context" }],
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
      canvases: projectCanvases,
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
          return activeCanvasSnapshot(0)
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
    for (const source of [
      { kind: "inline-text", sourceId: "inline", text: "legacy" },
      { kind: "remote-url", sourceId: "remote", url: "https://example.com/file" },
      { kind: "host-file", path: "/tmp/private.txt", sourceId: "unix-native" },
      { kind: "host-file", path: "C:\\private\\file.txt", sourceId: "windows-native" },
      { kind: "host-file", path: ".CONVAX/assets/private", sourceId: "private-metadata" },
      { kind: "host-directory", path: "../outside", sourceId: "external-directory" },
    ]) {
      await expect(provider.callTool(scope, "canvas_add_resources", { ...base, sources: [source] })).rejects.toThrow(
        source.kind.startsWith("host-") ? "Project-relative" : "Unsupported Canvas resource source",
      )
    }
    expect(calls).toBe(0)
  })

  test("bounds resource-add failures while exposing only validated retained Notes labels", async () => {
    let resourceFailure: unknown = new CanvasResourcePartialFailureError(
      new Error("repository failed at /native/project/.convax/document.json"),
      [{ label: "Notes/Brief-a1.md" }],
    )
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
          return activeCanvasSnapshot(0)
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
          throw resourceFailure
        },
      },
    })
    const request = {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "bounded-resource-failure",
      expectedRevision: 0,
      sources: [{ kind: "new-text", sourceId: "source", text: "Saved" }],
    }
    const scope = { directory: "/project", scopeId: "project-a" }

    let failure: unknown
    try {
      await provider.callTool(scope, "canvas_add_resources", request)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    let message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain("Notes/Brief-a1.md")
    expect(message).not.toContain("/native/")

    resourceFailure = new CanvasResourcePartialFailureError(new Error("ENOENT: /native/private/source"), [
      { label: "Generated/private.md" },
    ])
    try {
      await provider.callTool(scope, "canvas_add_resources", { ...request, commandId: "malicious-partial" })
    } catch (error) {
      failure = error
    }
    message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toBe("Could not add resources to the Canvas")
    expect(message).not.toContain("Generated/private.md")
    expect(message).not.toContain("/native/")

    resourceFailure = new Error("EACCES: /native/private/source")
    try {
      await provider.callTool(scope, "canvas_add_resources", { ...request, commandId: "ordinary-failure" })
    } catch (error) {
      failure = error
    }
    message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toBe("Could not add resources to the Canvas")
    expect(message).not.toContain("/native/")
  })

  test("does not include renderer reload errors in Agent-visible sync warnings", async () => {
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 1 }
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
          return activeCanvasSnapshot(0)
        },
        async executeView() {
          throw new Error("Unexpected view")
        },
        async reloadDocument() {
          throw new Error("ENOENT: /native/private/document.json")
        },
      },
      resources: {
        async addResources() {
          return {
            affectedNodeIds: ["created"],
            changed: true,
            createdNodeIds: ["created"],
            document,
            storageVersion: "v1",
            warnings: [],
          }
        },
      },
    })

    const result = await provider.callTool({ directory: "/project", scopeId: "project-a" }, "canvas_add_resources", {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "reload-warning",
      expectedRevision: 0,
      sources: [{ kind: "new-text", sourceId: "source", text: "Saved" }],
    })

    expect(result).toMatchObject({
      sync: {
        reloaded: false,
        warning: "Canvas was updated, but the live editor could not be refreshed",
      },
    })
    expect(JSON.stringify(result)).not.toContain("/native/")
  })

  test("keeps a committed business mutation successful when its optional view update fails", async () => {
    const document = { ...createCanvasDocument({ id: "canvas-main" }), revision: 3 }
    const provider = createCanvasAgentToolProvider({
      canvases: projectCanvases,
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
          return activeCanvasSnapshot(document.revision)
        },
        async executeView() {
          throw new Error("View failed at /native/private/window-state.json")
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
      sources: [{ kind: "new-text", sourceId: "source", text: "Saved" }],
      view: { select: true },
    })

    expect(result).toMatchObject({
      changed: true,
      revision: 3,
      warnings: ["Canvas resources were saved, but the live view could not be updated."],
    })
    expect(JSON.stringify(result)).not.toContain("/native/")
  })

  test("does not start a durable Agent mutation when cancellation wins after catalog lookup", async () => {
    type Catalog = Awaited<ReturnType<typeof projectCanvases.getCanvasCatalog>>
    let resolveCatalog!: (catalog: Catalog) => void
    const catalog = new Promise<Catalog>((resolve) => {
      resolveCatalog = resolve
    })
    let executeCalls = 0
    const provider = createCanvasAgentToolProvider({
      canvases: {
        async getCanvasCatalog() {
          return catalog
        },
      },
      application: {
        async execute() {
          executeCalls += 1
          throw new Error("Canceled Agent mutation reached durable execution")
        },
        async query() {
          throw new Error("Unexpected query")
        },
      },
      renderer: {
        async executeView() {
          throw new Error("Unexpected view")
        },
        async getViewSnapshot() {
          return null
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
    const controller = new AbortController()
    const operation = provider.callTool(
      { directory: "/project", scopeId: "project-a" },
      "canvas_apply_primitive",
      {
        canvasId: "canvas-main",
        command: { delta: { x: 1, y: 1 }, nodeIds: ["node-a"], type: "nodes.move" },
        commandId: "canceled-move",
        expectedRevision: 0,
      },
      { signal: controller.signal },
    )
    await Promise.resolve()
    controller.abort(new DOMException("Agent stopped", "AbortError"))
    resolveCatalog(await projectCanvases.getCanvasCatalog({ projectId: "project-a" }))

    await expect(operation).rejects.toThrow("Agent stopped")
    expect(executeCalls).toBe(0)
  })
})
