import { describe, expect, test } from "bun:test"
import { connectCanvasNodes } from "../commands"
import { createCanvasDocument, createTextNode } from "../document"
import type { CanvasAddResourcesCommand } from "./commands"
import {
  applyCanvasBusinessCommand,
  CanvasCommandValidationError,
  CanvasRevisionConflictError,
  executeCanvasBusinessCommand,
} from "./commands"
import { queryCanvasNodes } from "./queries"

function addResourcesCommand(): CanvasAddResourcesCommand {
  return {
    type: "resources.add",
    items: [
      {
        item: {
          id: "resource_image",
          kind: "image",
          name: "Poster.png",
          url: "asset://poster",
          width: 1_000,
          height: 500,
        },
        nodeId: "image_node",
      },
      {
        item: {
          format: "markdown",
          id: "resource_brief",
          kind: "text",
          name: "Brief.md",
          text: "# Campaign brief",
        },
        nodeId: "text_node",
      },
    ],
    placement: { anchor: { x: 0, y: 0 }, strategy: "avoid-overlap-cascade" },
    relation: { anchorNodeIds: ["anchor"], direction: "from-anchor", mode: "connect" },
  }
}

describe("canvas application commands", () => {
  test("adds prepared resources with product sizing, placement, and explicit relations", () => {
    const anchor = {
      ...createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Anchor" }),
      style: { height: 180, width: 320 },
    }
    const document = createCanvasDocument({ id: "canvas_resources", nodes: [anchor] })
    const applied = applyCanvasBusinessCommand(document, addResourcesCommand())

    expect(document.nodes).toHaveLength(1)
    expect(applied.document.revision).toBe(0)
    expect(applied.createdNodeIds).toEqual(["image_node", "text_node"])
    expect(applied.document.nodes.find((node) => node.id === "image_node")).toMatchObject({
      position: { x: 0, y: 240 },
      style: { height: 180, width: 320 },
    })
    expect(applied.document.nodes.find((node) => node.id === "text_node")).toMatchObject({
      position: { x: 36, y: 276 },
      style: { height: 240, width: 360 },
    })
    expect(applied.document.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["anchor", "image_node"],
      ["anchor", "text_node"],
    ])
  })

  test("commits one logical revision and rejects a stale caller", () => {
    const document = createCanvasDocument({
      id: "canvas_revision",
      nodes: [createTextNode({ id: "anchor", position: { x: 0, y: 0 } })],
    })
    const envelope = {
      actor: { id: "agent_one", kind: "agent" as const },
      command: addResourcesCommand(),
      commandId: "command_one",
      expectedRevision: 0,
    }
    const committed = executeCanvasBusinessCommand(document, envelope)

    expect(committed.document.revision).toBe(1)
    expect(() => executeCanvasBusinessCommand(committed.document, envelope)).toThrow(CanvasRevisionConflictError)
  })

  test("keeps an empty command as a no-op and validates referenced nodes", () => {
    const document = createCanvasDocument({ id: "canvas_noop" })
    const empty = executeCanvasBusinessCommand(document, {
      actor: { id: "ui", kind: "ui" },
      command: { type: "resources.add", items: [], placement: { anchor: { x: 0, y: 0 } } },
      commandId: "empty",
      expectedRevision: 0,
    })
    expect(empty.changed).toBeFalse()
    expect(empty.document).toBe(document)
    expect(applyCanvasBusinessCommand(document, {
      type: "elements.remove",
      edgeIds: ["missing_edge"],
      nodeIds: ["missing_node"],
    }).changed).toBeFalse()
    expect(() => applyCanvasBusinessCommand(document, addResourcesCommand())).toThrow(CanvasCommandValidationError)
    expect(applyCanvasBusinessCommand(document, { type: "nodes.layout", nodeIds: [] }).changed).toBeFalse()
  })
})

describe("canvas application queries", () => {
  test("finds serializable node summaries by text, kind, and relationships", () => {
    const first = createTextNode({ id: "first", label: "Campaign Brief", position: { x: 10, y: 20 }, text: "Summer launch" })
    const second = createTextNode({ id: "second", label: "Review", position: { x: 40, y: 20 }, text: "Approve assets" })
    const document = connectCanvasNodes(createCanvasDocument({ nodes: [first, second] }), {
      id: "edge",
      source: first.id,
      target: second.id,
    })

    expect(queryCanvasNodes(document, { text: "SUMMER" }).map((node) => node.id)).toEqual(["first"])
    expect(queryCanvasNodes(document, { kinds: ["text"], relatedToNodeIds: ["first"] })).toEqual([
      expect.objectContaining({ id: "second", incomingNodeIds: ["first"] }),
    ])
    expect(queryCanvasNodes(document, { limit: 1 })).toHaveLength(1)
  })
})
