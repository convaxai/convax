import { describe, expect, test } from "bun:test"
import {
  CanvasViewDocumentMismatchError,
  CanvasViewNotFoundError,
  CanvasViewRevisionMismatchError,
  CanvasViewScopeMismatchError,
  createCanvasViewRegistry,
  resolveCanvasDocumentFitEffect,
  resolveCanvasFitViewport,
  resolveCanvasFitTargetNodeIds,
  type CanvasViewCommand,
  type CanvasViewSession,
  type CanvasViewSnapshot,
} from "./view"
import type { CanvasDocument, CanvasNode } from "./types"

function createNode(
  id: string,
  position: { x: number; y: number },
  size: { height: number; width: number },
  parentId?: string,
): CanvasNode {
  return {
    id,
    data: { kind: "test", label: id },
    parentId,
    position,
    style: size,
    type: "file",
  }
}

function createDocument(nodes: CanvasNode[]): CanvasDocument {
  return {
    edges: [],
    id: "canvas",
    metadata: { title: "Canvas" },
    nodes,
    revision: 0,
  }
}

function createSession(viewId: string, documentId: string, scopeId = "project_one") {
  let snapshot: CanvasViewSnapshot = {
    documentId,
    revision: 0,
    scopeId,
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId,
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const commands: CanvasViewCommand[] = []
  const guards: unknown[] = []
  const session: CanvasViewSession = {
    async execute(command, guard) {
      commands.push(command)
      guards.push(guard)
      if (command.type === "selection.set") {
        snapshot = {
          ...snapshot,
          selectedEdgeIds: [...(command.edgeIds ?? [])],
          selectedNodeIds: [...(command.nodeIds ?? [])],
        }
      }
      return { foundNodeIds: [], missingNodeIds: [], snapshot }
    },
    getSnapshot: () => snapshot,
    whenReady: async () => undefined,
    viewId,
  }
  return { commands, guards, session }
}

describe("canvas fit viewport", () => {
  test("fits document geometry with fractional padding", () => {
    const document = createDocument([
      createNode("a", { x: 100, y: 50 }, { width: 100, height: 50 }),
      createNode("b", { x: 300, y: 150 }, { width: 100, height: 50 }),
    ])

    expect(
      resolveCanvasFitViewport({
        bounds: { width: 900, height: 600, maxZoom: 4 },
        document,
        maxZoom: 4,
        nodeIds: ["a", "b"],
        padding: 0.25,
      }),
    ).toEqual({ x: -50, y: 50, zoom: 2 })
  })

  test("keeps a request zoom ceiling inside the viewport ceiling", () => {
    const document = createDocument([createNode("small", { x: 0, y: 0 }, { width: 10, height: 10 })])

    expect(
      resolveCanvasFitViewport({
        bounds: { width: 1_000, height: 1_000, maxZoom: 2.5 },
        document,
        maxZoom: 10,
      }),
    ).toEqual({ x: 487.5, y: 487.5, zoom: 2.5 })
  })

  test("resolves omitted and empty targets to every node while preserving explicit misses", () => {
    const document = createDocument([
      createNode("group", { x: 0, y: 0 }, { width: 100, height: 100 }),
      createNode("child", { x: 20, y: 20 }, { width: 50, height: 50 }, "group"),
    ])

    expect(resolveCanvasFitTargetNodeIds(document)).toEqual({
      explicit: false,
      foundNodeIds: ["group", "child"],
      missingNodeIds: [],
    })
    expect(resolveCanvasFitTargetNodeIds(document, [])).toEqual(resolveCanvasFitTargetNodeIds(document))
    expect(resolveCanvasFitTargetNodeIds(document, ["missing", "child", "child"])).toEqual({
      explicit: true,
      foundNodeIds: ["child"],
      missingNodeIds: ["missing"],
    })
  })

  test("uses document viewport geometry for mounted hosts and preserves only scoped static fallbacks", () => {
    const document = createDocument([createNode("node", { x: 100, y: 50 }, { width: 100, height: 50 })])

    expect(
      resolveCanvasDocumentFitEffect({
        bounds: { height: 300, maxZoom: 2.5, minZoom: 0.15, width: 600 },
        document,
        maxZoom: 1,
        nodeIds: ["node"],
        padding: 0.18,
      }),
    ).toEqual({ kind: "viewport", viewport: { x: 150, y: 75, zoom: 1 } })
    expect(
      resolveCanvasDocumentFitEffect({
        document,
        maxZoom: 1,
        nodeIds: ["node"],
        padding: 0.18,
      }),
    ).toEqual({ kind: "renderer-fallback", maxZoom: 1, nodeIds: ["node"], padding: 0.18 })
    expect(resolveCanvasDocumentFitEffect({ document, maxZoom: 1, nodeIds: [], padding: 0.18 })).toEqual({
      kind: "renderer-fallback",
      maxZoom: 1,
      padding: 0.18,
    })
    expect(
      resolveCanvasDocumentFitEffect({
        bounds: { height: 0, maxZoom: 2.5, minZoom: 0.15, width: 600 },
        document,
        nodeIds: ["node"],
      }),
    ).toEqual({ kind: "none" })
  })

  test("uses parent world coordinates and ignores duplicate or missing node ids", () => {
    const document = createDocument([
      createNode("group", { x: 100, y: 200 }, { width: 400, height: 300 }),
      createNode("child", { x: 20, y: 30 }, { width: 50, height: 40 }, "group"),
    ])

    expect(
      resolveCanvasFitViewport({
        bounds: { width: 290, height: 500 },
        document,
        maxZoom: 1,
        nodeIds: ["missing", "child", "child"],
      }),
    ).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  test("fits every document node when the target list is omitted or empty", () => {
    const document = createDocument([
      createNode("a", { x: -100, y: -50 }, { width: 50, height: 50 }),
      createNode("b", { x: 100, y: 50 }, { width: 50, height: 50 }),
    ])
    const input = { bounds: { width: 500, height: 300, maxZoom: 2 }, document }

    expect(resolveCanvasFitViewport(input)).toEqual(resolveCanvasFitViewport({ ...input, nodeIds: [] }))
    expect(resolveCanvasFitViewport(input)).toEqual({ x: 200, y: 100, zoom: 2 })
  })

  test("honors the viewport minimum zoom", () => {
    const document = createDocument([createNode("large", { x: 0, y: 0 }, { width: 1_000, height: 1_000 })])

    expect(
      resolveCanvasFitViewport({
        bounds: { width: 100, height: 100, minZoom: 0.25, maxZoom: 2 },
        document,
        nodeIds: ["large"],
      }),
    ).toEqual({ x: -75, y: -75, zoom: 0.25 })
  })

  test("returns undefined without a valid viewport or target node", () => {
    const document = createDocument([createNode("node", { x: 0, y: 0 }, { width: 100, height: 100 })])

    expect(resolveCanvasFitViewport({ bounds: { width: 0, height: 100 }, document, nodeIds: ["node"] })).toBeUndefined()
    expect(
      resolveCanvasFitViewport({ bounds: { width: 100, height: 100 }, document, nodeIds: ["missing"] }),
    ).toBeUndefined()
    expect(resolveCanvasFitViewport({ bounds: { width: 100, height: 100 }, document, maxZoom: -1 })).toBeUndefined()
    expect(
      resolveCanvasFitViewport({ bounds: { width: 100, height: 100, minZoom: 0.25 }, document, maxZoom: 0.1 }),
    ).toBeUndefined()
    expect(resolveCanvasFitViewport({ bounds: { width: 100, height: 100 }, document, padding: -0.1 })).toBeUndefined()
  })
})

describe("canvas view registry", () => {
  test("targets one explicit view without changing another", async () => {
    const registry = createCanvasViewRegistry()
    const first = createSession("first", "canvas_a")
    const second = createSession("second", "canvas_b")
    registry.register(first.session)
    registry.register(second.session)

    const result = await registry.execute({
      command: { type: "selection.set", nodeIds: ["node_a"] },
      expectedDocumentId: "canvas_a",
      expectedScopeId: "project_one",
      viewId: "first",
    })

    expect(result.snapshot.selectedNodeIds).toEqual(["node_a"])
    expect(first.commands).toHaveLength(1)
    expect(first.guards[0]).toMatchObject({
      expectedDocumentId: "canvas_a",
      expectedScopeId: "project_one",
    })
    expect(second.commands).toHaveLength(0)
  })

  test("rejects a late command after the view changes documents", async () => {
    const registry = createCanvasViewRegistry()
    const { session } = createSession("main", "canvas_new")
    registry.register(session)

    await expect(
      registry.execute({
        command: { type: "nodes.reveal", nodeIds: ["node_a"] },
        expectedDocumentId: "canvas_old",
        expectedScopeId: "project_one",
        viewId: "main",
      }),
    ).rejects.toBeInstanceOf(CanvasViewDocumentMismatchError)
  })

  test("rejects a command aimed at another project scope", async () => {
    const registry = createCanvasViewRegistry()
    registry.register(createSession("main", "shared_canvas", "project_new").session)

    await expect(
      registry.execute({
        command: { type: "selection.clear" },
        expectedDocumentId: "shared_canvas",
        expectedScopeId: "project_old",
        viewId: "main",
      }),
    ).rejects.toBeInstanceOf(CanvasViewScopeMismatchError)
  })

  test("rejects a command aimed at a stale document revision", async () => {
    const registry = createCanvasViewRegistry()
    registry.register(createSession("main", "canvas").session)

    await expect(
      registry.execute({
        command: { type: "selection.clear" },
        expectedDocumentId: "canvas",
        expectedRevision: 1,
        expectedScopeId: "project_one",
        viewId: "main",
      }),
    ).rejects.toBeInstanceOf(CanvasViewRevisionMismatchError)
  })

  test("waits for the mounted view to finish loading before validating and executing", async () => {
    const registry = createCanvasViewRegistry()
    const target = createSession("main", "canvas")
    let resolveReady!: () => void
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    registry.register({ ...target.session, whenReady: () => ready })

    const pending = registry.execute({
      command: { type: "selection.set", nodeIds: ["node_a"] },
      expectedDocumentId: "canvas",
      expectedRevision: 0,
      expectedScopeId: "project_one",
      viewId: "main",
    })
    await Promise.resolve()
    expect(target.commands).toHaveLength(0)

    resolveReady()
    await pending
    expect(target.commands).toHaveLength(1)
  })

  test("unregisters a closed view", async () => {
    const registry = createCanvasViewRegistry()
    const unregister = registry.register(createSession("main", "canvas").session)
    unregister()

    await expect(
      registry.execute({
        command: { type: "selection.clear" },
        expectedDocumentId: "canvas",
        expectedScopeId: "project_one",
        viewId: "main",
      }),
    ).rejects.toBeInstanceOf(CanvasViewNotFoundError)
  })
})
