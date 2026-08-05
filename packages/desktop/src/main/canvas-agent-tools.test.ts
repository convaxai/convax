import { describe, expect, mock, test } from "bun:test"
import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
} from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import type { CanvasViewSnapshot } from "@convax/canvas/view"
import { parseActorIdV2, parseDigestV2, parseId128V2 } from "@convax/collaboration"
import type { BoundedOperationReceiptV2 } from "@convax/canvas/collaboration"
import type { ProjectCanvasCatalogProjectionV2 } from "@convax/project/canvas"

import { createCanvasAgentToolProvider } from "./canvas-agent-tools"

const projectId = "project-a"
const canvasId = "canvas-main"
const inactiveCanvasId = "canvas-inactive"
const document = createCanvasDocument({ id: canvasId })
const receipt: BoundedOperationReceiptV2 = {
  format: "convax.canvas-operation-receipt/2",
  actorId: parseActorIdV2("A".repeat(43)),
  operationId: parseId128V2("A".repeat(22)),
  intentDigest: parseDigestV2("d".repeat(64)),
  baseFrontierDigest: parseDigestV2("e".repeat(64)),
  intentKind: "canvas.nodes.set-geometry/2",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigestV2("f".repeat(64)),
}

describe("Canvas Agent tools", () => {
  test("uses the Project catalog and collaboration application as document authority", async () => {
    const execute = mock(async (request: CanvasApplicationCommandRequest) => commandResult(request.canvasId))
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: document }))
    const reloadDocument = mock(async () => true)
    const provider = createProvider({ execute, query, reloadDocument })
    const scope = { directory: "/project", scopeId: projectId }

    await expect(provider.callTool(scope, "canvas_query_nodes", { canvasId, limit: 10 })).resolves.toEqual({
      nodes: [], projection: document,
    })
    const result = await provider.callTool(scope, "canvas_apply_primitive", {
      canvasId,
      command: { delta: { x: 12, y: -3 }, nodeIds: ["node-a"], type: "nodes.move" },
      commandId: "move-node-a",
    })

    expect(result).toMatchObject({ changed: true, operationReceipt: receipt, sync: { reloaded: true } })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      canvasId,
      scopeId: projectId,
      envelope: expect.objectContaining({
        actor: { id: "opencode:project-a", kind: "agent" },
        commandId: "move-node-a",
      }),
    }))
    expect(reloadDocument).toHaveBeenCalledWith({ canvasId, scopeId: projectId })
  })

  test("allows document tools on another live Project route but keeps view commands mounted-only", async () => {
    const execute = mock(async () => commandResult(inactiveCanvasId))
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({
      nodes: [], projection: createCanvasDocument({ id: inactiveCanvasId }),
    }))
    const executeView = mock(async () => { throw new Error("must not execute") })
    const provider = createProvider({ execute, query, executeView })
    const scope = { directory: "/project", scopeId: projectId }

    await provider.callTool(scope, "canvas_query_nodes", { canvasId: inactiveCanvasId })
    await provider.callTool(scope, "canvas_apply_primitive", {
      canvasId: inactiveCanvasId,
      command: { delta: { x: 1, y: 1 }, nodeIds: ["node-a"], type: "nodes.move" },
      commandId: "inactive-move",
    })
    await expect(provider.callTool(scope, "canvas_view", {
      canvasId: inactiveCanvasId,
      command: { type: "selection.clear" },
    })).rejects.toThrow("canvasId must match the live active Canvas")
    expect(execute).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
    expect(executeView).not.toHaveBeenCalled()
  })

  test("lists only live routes from the host Project without a mounted renderer", async () => {
    const provider = createProvider({ getViewSnapshot: async () => null })
    await expect(provider.callTool(
      { directory: "/project", scopeId: projectId }, "canvas_list", {},
    )).resolves.toEqual({
      projectId,
      canvases: [
        { id: canvasId, name: "Main" },
        { id: inactiveCanvasId, name: "Inactive" },
      ],
    })
  })

  test("fails closed when a Canvas is outside the ProjectIndex live catalog", async () => {
    const execute = mock(async () => commandResult("missing"))
    const provider = createProvider({ execute })
    await expect(provider.callTool(
      { directory: "/project", scopeId: projectId },
      "canvas_apply_primitive",
      { canvasId: "missing", commandId: "missing", command: { type: "elements.remove", nodeIds: [] } },
    )).rejects.toThrow("not present in the current Agent Project catalog")
    expect(execute).not.toHaveBeenCalled()
  })

  test("does not expose the removed document-wide version/revision contract", async () => {
    const provider = createProvider()
    const definitions = await provider.listTools({ directory: "/project", scopeId: projectId })
    const schema = JSON.stringify(definitions)
    expect(schema).not.toContain("expectedRevision")
    expect(schema).not.toContain("storageVersion")
    expect(schema).not.toContain('"revision"')
    await expect(provider.callTool(
      { directory: "/project", scopeId: projectId }, "canvas_list", { version: 9 },
    )).rejects.toThrow("does not accept Project selection arguments")
  })

  test("keeps a durable mutation successful when renderer reload fails", async () => {
    const provider = createProvider({ reloadDocument: async () => { throw new Error("renderer gone") } })
    const result = await provider.callTool(
      { directory: "/project", scopeId: projectId },
      "canvas_apply_primitive",
      { canvasId, commandId: "move", command: { type: "elements.remove", nodeIds: [] } },
    )
    expect(result).toMatchObject({
      changed: true,
      operationReceipt: receipt,
      sync: { reloaded: false, warning: "renderer gone" },
    })
  })
})

function createProvider(overrides: {
  execute?: (request: CanvasApplicationCommandRequest) => Promise<CanvasApplicationCommandResult>
  query?: () => Promise<CanvasApplicationQueryResult>
  executeView?: () => Promise<never>
  getViewSnapshot?: () => Promise<CanvasViewSnapshot | null>
  reloadDocument?: () => Promise<boolean>
} = {}) {
  return createCanvasAgentToolProvider({
    canvases: { async getCanvasCatalog() { return catalog() } },
    application: {
      execute: overrides.execute ?? (async (request) => commandResult(request.canvasId)),
      query: overrides.query ?? (async () => ({ nodes: [], projection: document })),
    },
    renderer: {
      executeView: overrides.executeView ?? (async () => ({
        foundNodeIds: [], missingNodeIds: [], snapshot: viewSnapshot(),
      })),
      getActiveWorkbenchRef: async () => null,
      getViewSnapshot: overrides.getViewSnapshot ?? (async () => viewSnapshot()),
      reloadDocument: overrides.reloadDocument ?? (async () => true),
    },
    resources: { async addResources(request) { return commandResult(request.canvasId) } },
  })
}

function commandResult(id: string): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: ["node-a"],
    changed: true,
    createdNodeIds: [],
    document: createCanvasDocument({ id }),
    operationReceipt: receipt,
    warnings: [],
  }
}

function catalog(): ProjectCanvasCatalogProjectionV2 {
  const routes = [
    route(canvasId, "Main", "1"),
    route(inactiveCanvasId, "Inactive", "2"),
  ]
  return {
    format: "convax.project-canvas-catalog-projection/2",
    creationAvailability: "available",
    projectId: projectId as never,
    projectEpoch: id128(8),
    routes,
    visibleCanvases: routes,
  }
}

function route(id: string, title: string, digit: string) {
  return {
    canvasId: id as never,
    state: "live" as const,
    title,
    shardEpoch: id128(Number(digit)),
    activationDigest: parseDigestV2(digit.repeat(64)),
    routeProjectionDigest: parseDigestV2(digit.repeat(64)),
  }
}

function id128(byte: number) {
  return parseId128V2(Buffer.alloc(16, byte).toString("base64url"))
}

function viewSnapshot(): CanvasViewSnapshot {
  return {
    documentId: canvasId,
    scopeId: projectId,
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId: "desktop-main",
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}
