import { describe, expect, test } from "bun:test"
import {
  addCanvasNodes,
  connectCanvasNodes,
  duplicateCanvasSelection,
  groupCanvasNodes,
  removeCanvasElements,
  ungroupCanvasNode,
} from "./commands"
import { createCanvasClipboardPayload, parseCanvasClipboard, pasteCanvasClipboard, serializeCanvasClipboard } from "./clipboard"
import { createCanvasDocument, createTextNode } from "./document"
import { canvasHistoryReducer, createCanvasHistory } from "./history"
import { createCanvasServices } from "./services"

describe("canvas history", () => {
  test("undoes and redoes committed documents", () => {
    const initial = createCanvasDocument({ id: "canvas_test" })
    const node = createTextNode({ id: "node_a", position: { x: 20, y: 30 } })
    const committed = canvasHistoryReducer(createCanvasHistory(initial), {
      type: "commit",
      document: addCanvasNodes(initial, [node]).document,
    })

    expect(committed.document.revision).toBe(1)
    expect(committed.document.nodes).toHaveLength(1)
    const undone = canvasHistoryReducer(committed, { type: "undo" })
    expect(undone.document.revision).toBe(2)
    expect(undone.document.nodes).toHaveLength(0)
    const redone = canvasHistoryReducer(undone, { type: "redo" })
    expect(redone.document.revision).toBe(3)
    expect(redone.document.nodes.map((item) => item.id)).toEqual(["node_a"])
  })

  test("records a gesture as one history entry", () => {
    const node = createTextNode({ id: "node_a", position: { x: 0, y: 0 } })
    const initial = createCanvasDocument({ id: "canvas_test", nodes: [node] })
    const started = canvasHistoryReducer(createCanvasHistory(initial), { type: "begin-gesture" })
    const movedOnce = canvasHistoryReducer(started, {
      type: "replace",
      document: { ...initial, nodes: [{ ...node, position: { x: 20, y: 10 } }] },
    })
    const movedTwice = canvasHistoryReducer(movedOnce, {
      type: "replace",
      document: { ...initial, nodes: [{ ...node, position: { x: 80, y: 40 } }] },
    })
    const finished = canvasHistoryReducer(movedTwice, { type: "end-gesture" })

    expect(finished.past).toHaveLength(1)
    expect(finished.document.nodes[0].position).toEqual({ x: 80, y: 40 })
    expect(canvasHistoryReducer(finished, { type: "undo" }).document.nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})

describe("canvas commands", () => {
  test("groups and ungroups without changing world positions", () => {
    const first = createTextNode({ id: "node_a", position: { x: 20, y: 50 } })
    const second = createTextNode({ id: "node_b", position: { x: 360, y: 90 } })
    const initial = createCanvasDocument({ nodes: [first, second] })
    const grouped = groupCanvasNodes(initial, [first.id, second.id])
    const group = grouped.document.nodes.find((node) => node.type === "group")

    expect(group).toBeDefined()
    if (!group) throw new Error("Group was not created")
    expect(grouped.selectedNodeIds).toEqual([group.id])
    const ungrouped = ungroupCanvasNode(grouped.document, group.id)
    expect(ungrouped.document.nodes.map((node) => [node.id, node.position])).toEqual([
      [first.id, first.position],
      [second.id, second.position],
    ])
  })

  test("duplicates selected nodes and remaps their internal edges", () => {
    const first = createTextNode({ id: "node_a", position: { x: 0, y: 0 } })
    const second = createTextNode({ id: "node_b", position: { x: 320, y: 0 } })
    const initial = connectCanvasNodes(createCanvasDocument({ nodes: [first, second] }), {
      id: "edge_a",
      source: first.id,
      target: second.id,
    })
    const result = duplicateCanvasSelection(initial, [first.id, second.id])
    const clones = result.document.nodes.filter((node) => ![first.id, second.id].includes(node.id))
    const cloneEdge = result.document.edges.find((edge) => edge.id !== "edge_a")

    expect(initial.edges[0]?.type).toBe("canvas")
    expect(clones).toHaveLength(2)
    if (!cloneEdge) throw new Error("Cloned edge was not created")
    expect(result.selectedNodeIds).toEqual(clones.map((node) => node.id))
    expect(clones.map((node) => node.id)).toContain(cloneEdge.source)
    expect(clones.map((node) => node.id)).toContain(cloneEdge.target)
  })

  test("recursively removes group descendants and connected edges", () => {
    const first = createTextNode({ id: "node_a", position: { x: 0, y: 0 } })
    const second = createTextNode({ id: "node_b", position: { x: 320, y: 0 } })
    const grouped = groupCanvasNodes(createCanvasDocument({ nodes: [first, second] }), [first.id, second.id])
    const groupId = grouped.selectedNodeIds[0]
    const withEdge = connectCanvasNodes(grouped.document, { source: first.id, target: second.id })
    const removed = removeCanvasElements(withEdge, { nodeIds: [groupId] })

    expect(removed.nodes).toHaveLength(0)
    expect(removed.edges).toHaveLength(0)
  })
})

describe("canvas clipboard", () => {
  test("round trips a graph fragment with fresh identifiers", () => {
    const first = createTextNode({ id: "node_a", position: { x: 0, y: 0 } })
    const second = createTextNode({ id: "node_b", position: { x: 320, y: 0 } })
    const initial = connectCanvasNodes(createCanvasDocument({ nodes: [first, second] }), {
      source: first.id,
      target: second.id,
    })
    const payload = createCanvasClipboardPayload(initial, [first.id, second.id])
    const parsed = payload ? parseCanvasClipboard(serializeCanvasClipboard(payload)) : null

    expect(parsed).not.toBeNull()
    if (!parsed) throw new Error("Clipboard payload did not parse")
    const pasted = pasteCanvasClipboard(initial, parsed, { x: 40, y: 40 })
    expect(pasted.document.nodes).toHaveLength(4)
    expect(pasted.document.edges).toHaveLength(2)
    expect(pasted.selectedNodeIds.every((id) => ![first.id, second.id].includes(id))).toBeTrue()
  })

  test("rejects unrelated clipboard data", () => {
    expect(parseCanvasClipboard("plain text")).toBeNull()
    expect(parseCanvasClipboard('{"version":2,"nodes":[],"edges":[]}')).toBeNull()
  })
})

describe("canvas services", () => {
  test("restores the previous registration when an override is disposed", () => {
    const first = { show() {} }
    const second = { show() {} }
    const services = createCanvasServices({ notify: first })
    const version = services.getVersion()
    const dispose = services.register("notify", second)

    expect(services.require("notify")).toBe(second)
    expect(services.getVersion()).toBe(version + 1)
    dispose()
    expect(services.require("notify")).toBe(first)
    expect(services.getVersion()).toBe(version + 2)
  })
})
