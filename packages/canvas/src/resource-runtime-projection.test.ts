import { expect, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "./document"
import { projectCanvasResourceRuntimeStates } from "./resource-runtime-projection"

test("projects a large transient resource overlay in one node traversal", () => {
  const nodeCount = 10_000
  const document = createCanvasDocument({
    id: "large-runtime-overlay",
    nodes: Array.from({ length: nodeCount }, (_, index) =>
      createTextNode({
        id: `node-${index}`,
        metadata: { index },
        position: { x: index, y: index },
        resourceState: { status: "stale" },
      }),
    ),
  })
  const states = new Map(
    Array.from({ length: nodeCount / 2 }, (_, index) => [
      `node-${index * 2}`,
      { status: "ready" as const, text: `ready-${index}` },
    ]),
  )
  let resolverCalls = 0

  const projected = projectCanvasResourceRuntimeStates({
    document,
    resolve: (_node, state) => {
      resolverCalls += 1
      return state
    },
    states,
  })

  expect(resolverCalls).toBe(states.size)
  expect(projected.nodes).toHaveLength(nodeCount)
  expect(projected.nodes[0]!.data.resourceState).toEqual({ status: "ready", text: "ready-0" })
  expect(projected.nodes[1]).toBe(document.nodes[1])
  expect(projected.nodes.at(-1)).toBe(document.nodes.at(-1))
  expect(projected.nodes[0]!.data.metadata).toBe(document.nodes[0]!.data.metadata)
})
