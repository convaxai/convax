import { describe, expect, test } from "bun:test"
import { canvasHistoryReducer, createCanvasHistory } from "../history"
import { createCanvasDocument, createGroupNode, createTextNode, getCanvasNodeSize } from "../document"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "../types"
import { applyCanvasApplicationCommand, executeCanvasApplicationCommand } from "./commands"
import {
  applyCanvasLayoutPlan,
  computeBuiltinCanvasLayoutPlan,
  createCanvasLayoutSnapshot,
  planCanvasLayout,
} from "./layout"

function text(id: string, x: number, y: number, width = 100, height = 80): CanvasNode {
  return {
    ...createTextNode({ id, metadata: {}, position: { x, y }, resourceState: { status: "ready", text: id } }),
    style: { height, width },
  }
}

function edge(id: string, source: string, target: string) {
  return { id, source, target }
}

function positions(document: CanvasDocument, options?: Parameters<typeof planCanvasLayout>[1]) {
  return new Map(planCanvasLayout(document, options).positions.map((entry) => [entry.nodeId, entry.position]))
}

function nodeRect(node: CanvasNode, position: CanvasPoint) {
  const size = getCanvasNodeSize(node)
  return { maxX: position.x + size.width, maxY: position.y + size.height, minX: position.x, minY: position.y }
}

function overlaps(left: ReturnType<typeof nodeRect>, right: ReturnType<typeof nodeRect>, gap = 0) {
  return (
    left.minX < right.maxX + gap &&
    left.maxX + gap > right.minX &&
    left.minY < right.maxY + gap &&
    left.maxY + gap > right.minY
  )
}

describe("built-in Canvas layout provider", () => {
  test("uses directed edges and heterogeneous node sizes for horizontal layers", () => {
    const a = text("a", 600, 300, 420, 100)
    const b = text("b", 20, 10, 90, 260)
    const c = text("c", 40, 20, 240, 70)
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
      nodes: [a, b, c],
    })

    const planned = positions(document)

    expect(planned.get("b")!.x - planned.get("a")!.x).toBeGreaterThanOrEqual(420)
    expect(planned.get("c")!.x - planned.get("b")!.x).toBeGreaterThanOrEqual(90)
    expect(overlaps(nodeRect(a, planned.get("a")!), nodeRect(b, planned.get("b")!))).toBeFalse()
    expect(overlaps(nodeRect(b, planned.get("b")!), nodeRect(c, planned.get("c")!))).toBeFalse()
  })

  test("supports vertical directed clusters", () => {
    const a = text("a", 300, 400, 300, 180)
    const b = text("b", 0, 0, 120, 90)
    const document = createCanvasDocument({ edges: [edge("ab", "a", "b")], nodes: [a, b] })

    const planned = positions(document, { options: { strategy: "vertical-directed-cluster" } })

    expect(planned.get("b")!.y - planned.get("a")!.y).toBeGreaterThanOrEqual(180)
    expect(overlaps(nodeRect(a, planned.get("a")!), nodeRect(b, planned.get("b")!))).toBeFalse()
  })

  test("folds child edges onto their top-level group owners", () => {
    const first = createGroupNode({ id: "first", height: 420, position: { x: 500, y: 0 }, width: 500 })
    const second = createGroupNode({ id: "second", height: 300, position: { x: 0, y: 20 }, width: 260 })
    const firstChild = { ...text("first-child", 30, 40), extent: "parent" as const, parentId: first.id }
    const secondChild = { ...text("second-child", 20, 30), extent: "parent" as const, parentId: second.id }
    const document = createCanvasDocument({
      edges: [edge("children", firstChild.id, secondChild.id)],
      nodes: [firstChild, second, secondChild, first],
    })

    const plan = planCanvasLayout(document)
    const planned = new Map(plan.positions.map((entry) => [entry.nodeId, entry.position]))

    expect([...planned.keys()].sort()).toEqual(["first", "second"])
    expect(planned.get("second")!.x).toBeGreaterThanOrEqual(planned.get("first")!.x + 500)
  })

  test("offers an explicit preserve mode for distant isolates", () => {
    const a = text("a", 0, 0)
    const b = text("b", 10, 0)
    const c = text("c", 1_200, 500)
    const d = text("d", 1_210, 500)
    const isolated = text("isolated", 2_200, -400)
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b"), edge("cd", "c", "d")],
      nodes: [isolated, d, b, c, a],
    })

    const planned = positions(document, { options: { isolatedPlacement: "preserve" } })
    const firstCenter = (planned.get("a")!.x + planned.get("b")!.x + 100) / 2
    const secondCenter = (planned.get("c")!.x + planned.get("d")!.x + 100) / 2

    expect(firstCenter).toBe(secondCenter)
    expect(planned.get("c")!.y).toBeGreaterThan(planned.get("a")!.y)
    expect(planned.get("isolated")).toEqual(isolated.position)
    expect(overlaps(nodeRect(a, planned.get("a")!), nodeRect(c, planned.get("c")!))).toBeFalse()
  })

  test("preserves isolates when requested and moves only a colliding isolate nearby", () => {
    const a = text("a", 0, 0)
    const b = text("b", 0, 0)
    const colliding = text("colliding", 180, 0)
    const distant = text("distant", 1_000, 600)
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b")],
      nodes: [a, b, colliding, distant],
    })

    const planned = positions(document, { options: { isolatedPlacement: "preserve" } })
    const connectedBounds = {
      maxX: Math.max(nodeRect(a, planned.get("a")!).maxX, nodeRect(b, planned.get("b")!).maxX),
      maxY: Math.max(nodeRect(a, planned.get("a")!).maxY, nodeRect(b, planned.get("b")!).maxY),
      minX: Math.min(nodeRect(a, planned.get("a")!).minX, nodeRect(b, planned.get("b")!).minX),
      minY: Math.min(nodeRect(a, planned.get("a")!).minY, nodeRect(b, planned.get("b")!).minY),
    }

    expect(planned.get("distant")).toEqual(distant.position)
    expect(planned.get("colliding")).not.toEqual(colliding.position)
    expect(overlaps(connectedBounds, nodeRect(colliding, planned.get("colliding")!), 160)).toBeFalse()
  })

  test("compacts an edge-free canvas along the cross axis and stays idempotent", () => {
    const document = createCanvasDocument({
      nodes: [text("c", 900, -200, 160, 90), text("a", 400, 600, 100, 80), text("b", -300, 100, 220, 120)],
    })

    const firstPlan = planCanvasLayout(document)
    const first = applyCanvasLayoutPlan(document, firstPlan)
    const firstPositions = new Map(firstPlan.positions.map((entry) => [entry.nodeId, entry.position]))
    const second = applyCanvasLayoutPlan(first, planCanvasLayout(first))

    expect(new Set([...firstPositions.values()].map((position) => position.x))).toEqual(new Set([-300]))
    expect(firstPositions.get("b")!.y - firstPositions.get("a")!.y).toBe(160)
    expect(firstPositions.get("c")!.y - firstPositions.get("b")!.y).toBe(200)
    expect(first.nodes.map((node) => node.position)).not.toEqual(document.nodes.map((node) => node.position))
    expect(second.nodes.map((node) => node.position)).toEqual(first.nodes.map((node) => node.position))
    expect(second).toBe(first)
  })

  test("places unrelated cards in a deterministic shelf left of the connected graph", () => {
    const a = text("a", 400, 100, 180, 100)
    const b = text("b", 20, 500, 120, 80)
    const firstIsolate = text("isolate-a", 1_400, 800, 140, 60)
    const secondIsolate = text("isolate-b", -800, -300, 100, 120)
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b")],
      nodes: [secondIsolate, b, firstIsolate, a],
    })

    const planned = positions(document)
    const connectedLeft = Math.min(planned.get("a")!.x, planned.get("b")!.x)
    const isolatedRight = Math.max(
      planned.get("isolate-a")!.x + getCanvasNodeSize(firstIsolate).width,
      planned.get("isolate-b")!.x + getCanvasNodeSize(secondIsolate).width,
    )

    expect(isolatedRight).toBeLessThanOrEqual(connectedLeft - 240)
    expect(
      overlaps(
        nodeRect(firstIsolate, planned.get("isolate-a")!),
        nodeRect(secondIsolate, planned.get("isolate-b")!),
        80,
      ),
    ).toBeFalse()

    const first = applyCanvasLayoutPlan(document, planCanvasLayout(document))
    const second = applyCanvasLayoutPlan(first, planCanvasLayout(first))
    expect(second.nodes.map((node) => node.position)).toEqual(first.nodes.map((node) => node.position))
  })

  test("uses a horizontal shelf for an edge-free vertical directed layout", () => {
    const document = createCanvasDocument({ nodes: [text("b", 900, 500), text("a", -100, -200)] })
    const planned = positions(document, { options: { strategy: "vertical-directed-cluster" } })

    expect(planned.get("a")!.y).toBe(-200)
    expect(planned.get("b")!.y).toBe(-200)
    expect(planned.get("b")!.x - planned.get("a")!.x).toBe(180)
  })

  test("offers conservative collision packing without replacing the graph with a grid", () => {
    const a = text("a", 0, 0)
    const b = text("b", 900, 100)
    const c = text("c", 450, 700)
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
      nodes: [a, b, c],
    })
    const planned = positions(document, { options: { strategy: "component-packing" } })

    expect(planned.get("a")!.x).toBeLessThan(planned.get("b")!.x)
    expect(planned.get("b")!.y).toBeLessThan(planned.get("c")!.y)
    expect(overlaps(nodeRect(a, planned.get("a")!), nodeRect(b, planned.get("b")!), 40)).toBeFalse()
    expect(overlaps(nodeRect(b, planned.get("b")!), nodeRect(c, planned.get("c")!), 40)).toBeFalse()
    expect(planned.get("a")).toEqual(a.position)
    expect(planned.get("b")).toEqual(b.position)
    expect(planned.get("c")).toEqual(c.position)

    const first = applyCanvasLayoutPlan(
      document,
      planCanvasLayout(document, { options: { strategy: "component-packing" } }),
    )
    const second = applyCanvasLayoutPlan(first, planCanvasLayout(first, { options: { strategy: "component-packing" } }))
    expect(second.nodes.map((node) => node.position)).toEqual(first.nodes.map((node) => node.position))
    expect(second).toBe(first)
  })

  test("resolves component-packing collisions in one bounded pass", () => {
    const a = text("a", 0, 0, 180, 100)
    const b = text("b", 20, 20, 120, 160)
    const c = text("c", 30, 40, 240, 80)
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
      nodes: [a, b, c],
    })

    const first = applyCanvasLayoutPlan(
      document,
      planCanvasLayout(document, { options: { strategy: "component-packing" } }),
    )
    const second = applyCanvasLayoutPlan(first, planCanvasLayout(first, { options: { strategy: "component-packing" } }))
    const planned = new Map(first.nodes.map((node) => [node.id, node.position]))

    expect(overlaps(nodeRect(a, planned.get("a")!), nodeRect(b, planned.get("b")!), 30)).toBeFalse()
    expect(overlaps(nodeRect(b, planned.get("b")!), nodeRect(c, planned.get("c")!), 30)).toBeFalse()
    expect(second).toBe(first)
  })

  test("tolerates cycles and is deterministic across input order", () => {
    const document = createCanvasDocument({
      edges: [edge("ca", "c", "a"), edge("ab", "a", "b"), edge("bc", "b", "c")],
      nodes: [text("c", 200, 0), text("a", 0, 0), text("b", 100, 0)],
    })
    const snapshot = createCanvasLayoutSnapshot(document)
    const reversed = {
      ...snapshot,
      edges: [...snapshot.edges].reverse(),
      nodes: [...snapshot.nodes].reverse(),
    }

    const first = computeBuiltinCanvasLayoutPlan({ options: {}, snapshot })
    const second = computeBuiltinCanvasLayoutPlan({ options: {}, snapshot: reversed })
    const planned = new Map(first.positions.map((entry) => [entry.nodeId, entry.position]))

    expect(second).toEqual(first)
    expect(planned.get("a")!.x).toBeLessThan(planned.get("b")!.x)
    expect(planned.get("b")!.x).toBeLessThan(planned.get("c")!.x)
  })

  test("is geometrically idempotent after the first tidy", () => {
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b"), edge("ac", "a", "c")],
      nodes: [text("c", 20, 900), text("a", 700, 300), text("b", -100, 0)],
    })
    const first = applyCanvasLayoutPlan(document, planCanvasLayout(document))
    const secondPlan = planCanvasLayout(first)
    const second = applyCanvasLayoutPlan(first, secondPlan)

    expect(second.nodes.map((node) => node.position)).toEqual(first.nodes.map((node) => node.position))
    expect(second).toBe(first)
  })

  test("reaches a stable packing for multiple disconnected directed components", () => {
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b"), edge("cd", "c", "d")],
      nodes: [text("a", 0, 0), text("b", 400, 0), text("c", 2_000, 0), text("d", 2_400, 0)],
    })

    const first = applyCanvasLayoutPlan(document, planCanvasLayout(document))
    const second = applyCanvasLayoutPlan(first, planCanvasLayout(first))

    expect(second.nodes.map((node) => node.position)).toEqual(first.nodes.map((node) => node.position))
    expect(second).toBe(first)
  })

  test.each(["horizontal-directed-cluster", "vertical-directed-cluster"] as const)(
    "keeps a heterogeneous multi-branch graph exactly stable for %s",
    (strategy) => {
      const document = createCanvasDocument({
        edges: [
          edge("01", "n0", "n1"),
          edge("03", "n0", "n3"),
          edge("05", "n0", "n5"),
          edge("07", "n0", "n7"),
          edge("14", "n1", "n4"),
          edge("56", "n5", "n6"),
        ],
        nodes: [
          text("n7", 1_400, -900, 330, 100),
          text("n3", -200, 800, 120, 260),
          text("n0", 700, 500, 420, 80),
          text("n6", 40, -300, 190, 170),
          text("n1", 900, -500, 80, 210),
          text("n5", -800, 40, 260, 90),
          text("n4", 300, 1_200, 150, 130),
        ],
      })
      const options = { strategy }
      const first = applyCanvasLayoutPlan(document, planCanvasLayout(document, { options }))
      const second = applyCanvasLayoutPlan(first, planCanvasLayout(first, { options }))

      expect(second).toBe(first)
    },
  )

  test("validates stale provider plans before applying geometry", () => {
    const document = createCanvasDocument({ nodes: [text("a", 0, 0), text("b", 0, 0)] })
    const plan = planCanvasLayout(document)

    expect(() => applyCanvasLayoutPlan({ ...document, revision: 1 }, plan)).toThrow("revision conflict")
    expect(() =>
      applyCanvasLayoutPlan(document, {
        ...plan,
        positions: [{ nodeId: "missing", position: { x: 0, y: 0 } }],
      }),
    ).toThrow("was not found")
    expect(
      applyCanvasLayoutPlan(document, {
        ...plan,
        positions: [{ nodeId: "a", position: { x: 20, y: 30 }, size: { height: 300, width: 400 } }],
      }).nodes[0],
    ).toMatchObject({
      position: { x: 20, y: 30 },
      style: { height: 300, width: 400 },
    })
  })

  test("fails closed for cancelled computation and mixed coordinate spaces", () => {
    const group = createGroupNode({ id: "group", height: 400, position: { x: 0, y: 0 }, width: 500 })
    const child = { ...text("child", 20, 20), extent: "parent" as const, parentId: group.id }
    const root = text("root", 800, 0)
    const snapshot = createCanvasLayoutSnapshot(createCanvasDocument({ nodes: [group, child, root] }))
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))

    expect(() => computeBuiltinCanvasLayoutPlan({ options: {}, snapshot }, controller.signal)).toThrow("cancelled")
    expect(() =>
      computeBuiltinCanvasLayoutPlan({
        layoutNodeIds: [child.id, root.id],
        options: {},
        snapshot,
      }),
    ).toThrow("share one parent")
  })
})

describe("Canvas auto-layout business operation", () => {
  test("commits one application revision and is one undo step", () => {
    const document = createCanvasDocument({
      edges: [edge("ab", "a", "b")],
      nodes: [text("a", 500, 300), text("b", 0, 0)],
    })
    const applied = applyCanvasApplicationCommand(document, { type: "canvas.auto-layout" })
    const committed = executeCanvasApplicationCommand(document, {
      actor: { id: "ui", kind: "ui" },
      command: { type: "canvas.auto-layout" },
      commandId: "tidy",
      expectedRevision: 0,
    })
    const withHistory = canvasHistoryReducer(createCanvasHistory(document), {
      document: applied.document,
      type: "commit",
    })
    const undone = canvasHistoryReducer(withHistory, { type: "undo" })

    expect(applied.changed).toBeTrue()
    expect(committed.document.revision).toBe(1)
    expect(withHistory.past).toHaveLength(1)
    expect(undone.document.nodes.map((node) => node.position)).toEqual(document.nodes.map((node) => node.position))
  })

  test("uses strict absolute batch geometry with optional persistent sizes", () => {
    const document = createCanvasDocument({ nodes: [text("a", 0, 0), text("b", 100, 100)] })
    const committed = executeCanvasApplicationCommand(document, {
      actor: { id: "plugin", kind: "plugin" },
      command: {
        type: "nodes.setGeometry",
        updates: [
          { nodeId: "a", position: { x: 40, y: 50 }, size: { height: 222, width: 333 } },
          { nodeId: "b", position: { x: -20, y: 70 } },
        ],
      },
      commandId: "geometry",
      expectedRevision: 0,
    })

    expect(committed.document).toMatchObject({
      revision: 1,
      nodes: [
        { id: "a", position: { x: 40, y: 50 }, style: { height: 222, width: 333 } },
        { id: "b", position: { x: -20, y: 70 } },
      ],
    })
    expect(getCanvasNodeSize(committed.document.nodes[0]!)).toEqual({ height: 222, width: 333 })
    expect(() =>
      executeCanvasApplicationCommand(document, {
        actor: { id: "plugin", kind: "plugin" },
        command: {
          type: "nodes.setGeometry",
          updates: [{ nodeId: "a", position: { x: 1, y: 2 } }],
        },
        commandId: "stale-geometry",
        expectedRevision: 1,
      }),
    ).toThrow("revision conflict")
    expect(() =>
      applyCanvasApplicationCommand(document, {
        type: "nodes.setGeometry",
        updates: [{ nodeId: "missing", position: { x: 0, y: 0 } }],
      }),
    ).toThrow("was not found")
    expect(() =>
      applyCanvasApplicationCommand(document, {
        type: "nodes.setGeometry",
        updates: [
          { nodeId: "a", position: { x: 0, y: 0 } },
          { nodeId: "a", position: { x: 1, y: 1 } },
        ],
      }),
    ).toThrow("duplicate")
  })

  test("refits a selected group's children without changing their laid-out world positions", () => {
    const group = createGroupNode({ id: "group", height: 200, position: { x: 100, y: 200 }, width: 500 })
    const first = { ...text("a", 20, 20), extent: "parent" as const, parentId: group.id }
    const second = { ...text("b", 200, 20), extent: "parent" as const, parentId: group.id }
    const document = createCanvasDocument({ nodes: [group, first, second] })
    const plan = planCanvasLayout(document, { nodeIds: [first.id, second.id] })
    const planned = new Map(plan.positions.map((entry) => [entry.nodeId, entry.position]))

    const applied = applyCanvasApplicationCommand(document, {
      nodeIds: [first.id, second.id],
      options: { strategy: "horizontal-directed-cluster" },
      type: "canvas.auto-layout",
    }).document
    const nextGroup = applied.nodes.find((node) => node.id === group.id)!
    const nextFirst = applied.nodes.find((node) => node.id === first.id)!
    const nextSecond = applied.nodes.find((node) => node.id === second.id)!
    const childBounds = [nextFirst, nextSecond].map((node) => nodeRect(node, node.position))

    expect(nextGroup.position.x + nextFirst.position.x).toBe(group.position.x + planned.get(first.id)!.x)
    expect(nextGroup.position.y + nextSecond.position.y).toBe(group.position.y + planned.get(second.id)!.y)
    expect(Math.min(...childBounds.map((bounds) => bounds.minX))).toBe(40)
    expect(Math.min(...childBounds.map((bounds) => bounds.minY))).toBe(40)
    expect(Math.max(...childBounds.map((bounds) => bounds.maxX))).toBe(getCanvasNodeSize(nextGroup).width - 40)
    expect(Math.max(...childBounds.map((bounds) => bounds.maxY))).toBe(getCanvasNodeSize(nextGroup).height - 40)
  })

  test("refits nested group ancestors and remains idempotent for vertical flow", () => {
    const outer = createGroupNode({ id: "outer", height: 500, position: { x: 100, y: 100 }, width: 500 })
    const inner = {
      ...createGroupNode({ id: "inner", height: 160, parentId: outer.id, position: { x: 20, y: 30 }, width: 220 }),
      extent: "parent" as const,
    }
    const first = { ...text("a", 10, 10), extent: "parent" as const, parentId: inner.id }
    const second = { ...text("b", 40, 50), extent: "parent" as const, parentId: inner.id }
    const document = createCanvasDocument({ nodes: [outer, inner, first, second] })
    const command = {
      nodeIds: [first.id, second.id],
      options: { strategy: "vertical-directed-cluster" as const },
      type: "canvas.auto-layout" as const,
    }

    const firstResult = applyCanvasApplicationCommand(document, command).document
    const secondResult = applyCanvasApplicationCommand(firstResult, command).document
    const nextOuter = firstResult.nodes.find((node) => node.id === outer.id)!
    const nextInner = firstResult.nodes.find((node) => node.id === inner.id)!
    const innerChildren = firstResult.nodes.filter((node) => node.parentId === inner.id)

    expect(nextInner.position).toEqual({ x: 40, y: 40 })
    expect(Math.min(...innerChildren.map((node) => node.position.x))).toBe(40)
    expect(Math.min(...innerChildren.map((node) => node.position.y))).toBe(40)
    expect(getCanvasNodeSize(nextOuter)).toEqual({
      height: getCanvasNodeSize(nextInner).height + 80,
      width: getCanvasNodeSize(nextInner).width + 80,
    })
    expect(secondResult).toBe(firstResult)
  })

  test("repairs a manually resized group even when its children are already tidy", () => {
    const group = createGroupNode({ id: "group", height: 200, position: { x: 100, y: 200 }, width: 500 })
    const first = { ...text("a", 20, 20), extent: "parent" as const, parentId: group.id }
    const second = { ...text("b", 200, 20), extent: "parent" as const, parentId: group.id }
    const command = {
      nodeIds: [first.id, second.id],
      options: { strategy: "horizontal-directed-cluster" as const },
      type: "canvas.auto-layout" as const,
    }
    const tidy = applyCanvasApplicationCommand(
      createCanvasDocument({ nodes: [group, first, second] }),
      command,
    ).document
    const tidyGroup = tidy.nodes.find((node) => node.id === group.id)!
    const resized = {
      ...tidy,
      nodes: tidy.nodes.map((node) =>
        node.id === group.id
          ? { ...node, style: { ...node.style, height: getCanvasNodeSize(node).height + 300, width: 900 } }
          : node,
      ),
    }

    const repaired = applyCanvasApplicationCommand(resized, command)
    const repairedGroup = repaired.document.nodes.find((node) => node.id === group.id)!

    expect(repaired.changed).toBeTrue()
    expect(getCanvasNodeSize(repairedGroup)).toEqual(getCanvasNodeSize(tidyGroup))
    expect(repaired.document.nodes.filter((node) => node.parentId === group.id).map((node) => node.position)).toEqual(
      tidy.nodes.filter((node) => node.parentId === group.id).map((node) => node.position),
    )
  })

  test("reports refitted groups and shifted siblings as affected nodes", () => {
    const group = createGroupNode({ id: "group", height: 600, position: { x: 100, y: 200 }, width: 800 })
    const first = { ...text("a", 200, 200), extent: "parent" as const, parentId: group.id }
    const second = { ...text("b", 400, 200), extent: "parent" as const, parentId: group.id }
    const sibling = { ...text("sibling", 20, 500), extent: "parent" as const, parentId: group.id }

    const result = applyCanvasApplicationCommand(createCanvasDocument({ nodes: [group, first, second, sibling] }), {
      nodeIds: [first.id, second.id],
      options: { strategy: "horizontal-directed-cluster" },
      type: "canvas.auto-layout",
    })

    expect(new Set(result.affectedNodeIds)).toEqual(new Set(["a", "b", "group", "sibling"]))
  })
})
