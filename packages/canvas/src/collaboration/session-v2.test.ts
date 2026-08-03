import { describe, expect, test } from "bun:test"
import { CanvasIntentApplicationServiceV2, CanvasReactFlowTransientStateV2 } from "./session"
import type { CanvasCallerIntentV2, CanvasIntentCommitPortV2 } from "./session"
import { context, createAgent, id128, newCanvas, U0 } from "./test-fixtures.test"
import { derivedNodeRefV2 } from "./validation"
import { projectCanvasV2 } from "./projection"
import { validateCanvasYDocV2 } from "./ydoc"

describe("Canvas v2 caller and React Flow boundaries", () => {
  test("UI, Agent and Plugin use the same typed-intent commit service", async () => {
    const calls: CanvasCallerIntentV2[] = []
    const port: CanvasIntentCommitPortV2 = {
      async commit(intent) {
        calls.push(intent)
        return {
          operationId: id128(99),
          projection: projectCanvasV2(validateCanvasYDocV2(newCanvas())),
          semanticRootOperationId: id128(98),
        }
      },
    }
    const service = new CanvasIntentApplicationServiceV2(port)
    const intent = nodeCreate()
    for (const caller of ["ui", "agent", "plugin"] as const) await service.apply(caller, intent)
    expect(calls).toEqual([intent, intent, intent])
  })

  test("pre-commit cancellation and commit failure do not fabricate a projection", async () => {
    let commits = 0
    const service = new CanvasIntentApplicationServiceV2({
      async commit() {
        commits += 1
        throw new Error("durability-failed")
      },
    })
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(service.apply("ui", nodeCreate(), controller.signal)).rejects.toThrow("cancelled")
    expect(commits).toBe(0)
    await expect(service.apply("agent", nodeCreate())).rejects.toThrow("durability-failed")
    expect(commits).toBe(1)
  })

  test("selection, measured size, drag preview and viewport remain disposable transient state", () => {
    const document = newCanvas()
    const node = createAgent(document, context(1, 1, 1))
    const projection = projectCanvasV2(validateCanvasYDocV2(document))
    const key = `node/${node.id}/${node.incarnation}`
    const transient = new CanvasReactFlowTransientStateV2()
    transient.setMeasured(key, { width: 999, height: 888 })
    transient.setSelected([key])
    transient.beginDrag(key, 10, 20)
    transient.setConnectionPreview({ sourceKey: key, targetPoint: { x: 30, y: 40 } })
    transient.setViewport({ x: 50, y: 60, zoom: 2 })
    expect(JSON.stringify(projection)).not.toContain("999")
    expect(JSON.stringify(projection)).not.toContain("viewport")
    expect(transient.snapshot().selected.has(key)).toBeTrue()

    transient.reconcile({ ...projection, nodes: [] })
    expect(transient.snapshot().selected.size).toBe(0)
    expect(transient.snapshot().measured.size).toBe(0)
    expect(transient.snapshot().drag).toBeNull()
    expect(transient.snapshot().connectionPreview).toBeNull()
    expect(transient).not.toHaveProperty("undoManager")
  })

  test("scope reset clears every React Flow cache without creating durable state", () => {
    const document = newCanvas()
    const node = createAgent(document, context(2, 1, 1))
    const projection = projectCanvasV2(validateCanvasYDocV2(document))
    const key = `node/${node.id}/${node.incarnation}`
    const transient = new CanvasReactFlowTransientStateV2()
    transient.setMeasured(key, { width: 999, height: 888 })
    transient.setSelected([key])
    transient.beginDrag(key, 10, 20)
    transient.setConnectionPreview({ sourceKey: key, targetPoint: { x: 30, y: 40 } })
    transient.setViewport({ x: 50, y: 60, zoom: 2 })

    transient.resetScope()

    expect(transient.snapshot()).toEqual({
      measured: new Map(),
      selected: new Set(),
      drag: null,
      connectionPreview: null,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    expect(JSON.stringify(projection)).not.toContain("999")
  })
})

function nodeCreate(): CanvasCallerIntentV2 {
  const operationContext = context(1, 1, 1)
  const node = derivedNodeRefV2(operationContext, U0)
  return {
    format: "convax.typed-intent/2",
    kind: "canvas.nodes.create/2",
    guard: { ordinal: U0, node, expectedAbsent: true },
    body: {
      node: {
        ordinal: U0,
        nodeId: node.id,
        incarnation: node.incarnation,
        role: "agent",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        data: { format: "convax.canvas-node-data/2", kind: "agent", title: "agent", instructions: null },
        plugin: null,
      },
    },
  }
}
