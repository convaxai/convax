import { describe, expect, test } from "bun:test"
import {
  CanvasViewDocumentMismatchError,
  CanvasViewNotFoundError,
  CanvasViewRevisionMismatchError,
  CanvasViewScopeMismatchError,
  createCanvasViewRegistry,
  type CanvasViewCommand,
  type CanvasViewSession,
  type CanvasViewSnapshot,
} from "./view"

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

    await expect(registry.execute({
      command: { type: "nodes.reveal", nodeIds: ["node_a"] },
      expectedDocumentId: "canvas_old",
      expectedScopeId: "project_one",
      viewId: "main",
    })).rejects.toBeInstanceOf(CanvasViewDocumentMismatchError)
  })

  test("rejects a command aimed at another project scope", async () => {
    const registry = createCanvasViewRegistry()
    registry.register(createSession("main", "shared_canvas", "project_new").session)

    await expect(registry.execute({
      command: { type: "selection.clear" },
      expectedDocumentId: "shared_canvas",
      expectedScopeId: "project_old",
      viewId: "main",
    })).rejects.toBeInstanceOf(CanvasViewScopeMismatchError)
  })

  test("rejects a command aimed at a stale document revision", async () => {
    const registry = createCanvasViewRegistry()
    registry.register(createSession("main", "canvas").session)

    await expect(registry.execute({
      command: { type: "selection.clear" },
      expectedDocumentId: "canvas",
      expectedRevision: 1,
      expectedScopeId: "project_one",
      viewId: "main",
    })).rejects.toBeInstanceOf(CanvasViewRevisionMismatchError)
  })

  test("waits for the mounted view to finish loading before validating and executing", async () => {
    const registry = createCanvasViewRegistry()
    const target = createSession("main", "canvas")
    let resolveReady!: () => void
    const ready = new Promise<void>((resolve) => { resolveReady = resolve })
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

    await expect(registry.execute({
      command: { type: "selection.clear" },
      expectedDocumentId: "canvas",
      expectedScopeId: "project_one",
      viewId: "main",
    })).rejects.toBeInstanceOf(CanvasViewNotFoundError)
  })
})
