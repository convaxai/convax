import { describe, expect, test } from "bun:test"
import { applyNodeChanges, type NodeChange } from "@xyflow/react"
import { connectCanvasNodes } from "../commands"
import { createCanvasDocument, createTextNode } from "../document"
import type { CanvasNode } from "../types"
import { createCanvasDuplicateDragPlan, remapCanvasDuplicateDragChanges } from "./duplicate-drag"

function connectedDocument() {
  const source = createTextNode({ id: "source", position: { x: -320, y: 0 } })
  const original = createTextNode({ id: "original", position: { x: 0, y: 0 } })
  const target = createTextNode({ id: "target", position: { x: 320, y: 0 } })
  let document = createCanvasDocument({ nodes: [source, original, target] })
  document = connectCanvasNodes(document, { id: "incoming", source: source.id, target: original.id })
  document = connectCanvasNodes(document, { id: "outgoing", source: original.id, target: target.id })
  return document
}

describe("Canvas duplicate drag", () => {
  test("moves the created copy while leaving the original node and its connections in place", () => {
    const document = connectedDocument()
    const plan = createCanvasDuplicateDragPlan(document, ["original"], false)
    expect(plan).not.toBeNull()
    if (!plan) throw new Error("Duplicate drag plan was not created")

    const duplicateId = plan.duplicatedNodeIdBySourceId.get("original")
    expect(duplicateId).toBeString()
    const changes: NodeChange<CanvasNode>[] = [
      { id: "original", position: { x: 180, y: 120 }, type: "position" },
      { id: "original", selected: true, type: "select" },
    ]
    const nodes = applyNodeChanges(
      remapCanvasDuplicateDragChanges(changes, plan.duplicatedNodeIdBySourceId),
      plan.document.nodes,
    )

    expect(nodes.find((node) => node.id === "original")?.position).toEqual({ x: 0, y: 0 })
    expect(nodes.find((node) => node.id === duplicateId)?.position).toEqual({ x: 180, y: 120 })
    expect(plan.document.edges.map((edge) => edge.id).sort()).toEqual(["incoming", "outgoing"])
  })

  test("preserves connected edges for primary-modifier plus Alt drag", () => {
    const plan = createCanvasDuplicateDragPlan(connectedDocument(), ["original"], true)
    expect(plan).not.toBeNull()
    if (!plan) throw new Error("Duplicate drag plan was not created")
    const duplicateId = plan.duplicatedNodeIdBySourceId.get("original")
    const duplicateEdges = plan.document.edges.filter((edge) => !["incoming", "outgoing"].includes(edge.id))

    expect(duplicateEdges).toHaveLength(2)
    expect(duplicateEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "source", target: duplicateId }),
        expect.objectContaining({ source: duplicateId, target: "target" }),
      ]),
    )
  })
})
