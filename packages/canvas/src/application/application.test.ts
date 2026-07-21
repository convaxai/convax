import { describe, expect, test } from "bun:test"
import { connectCanvasNodes } from "../commands"
import { createAgentNode, createCanvasDocument, createGroupNode, createMediaNode, createTextNode } from "../document"
import type { CanvasAddResourcesCommand } from "./commands"
import {
  applyCanvasBusinessCommand,
  CanvasCommandValidationError,
  CanvasRevisionConflictError,
  createCanvasNodeContentGuard,
  executeCanvasBusinessCommand,
  findOpenCanvasPoint,
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
          metadata: { source: "docs/brief.md" },
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
    expect(applied.document.nodes.find((node) => node.id === "anchor")).toBe(anchor)
    expect(applied.document.nodes.find((node) => node.id === "anchor")?.style).toEqual({
      height: 180,
      width: 320,
    })
    expect(applied.document.revision).toBe(0)
    expect(applied.createdNodeIds).toEqual(["image_node", "text_node"])
    expect(applied.document.nodes.find((node) => node.id === "image_node")).toMatchObject({
      position: { x: 344, y: 0 },
      style: { height: 180, width: 320 },
    })
    expect(applied.document.nodes.find((node) => node.id === "text_node")).toMatchObject({
      data: { metadata: { source: "docs/brief.md" } },
      position: { x: 380, y: 36 },
      style: { height: 240, width: 360 },
    })
    expect(applied.document.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["anchor", "image_node"],
      ["anchor", "text_node"],
    ])
  })

  test("keeps searching for free placement after the old fixed candidate set is full", () => {
    const occupiedPoints = [
      [0, 0],
      [340, 0],
      [-340, 0],
      [0, 240],
      [340, 240],
      [-340, 240],
      [0, -240],
      [340, -240],
      [-340, -240],
    ] as const
    const nodes = occupiedPoints.map(([x, y], index) => ({
      ...createTextNode({ id: `occupied-${index}`, position: { x, y } }),
      style: { height: 200, width: 320 },
    }))

    const open = findOpenCanvasPoint(createCanvasDocument({ nodes }), { x: 0, y: 0 }, { height: 200, width: 320 })

    expect(open).not.toEqual({ x: 0, y: 0 })
    for (const node of nodes) {
      const overlaps =
        open.x < node.position.x + 320 + 24 &&
        open.x + 320 + 24 > node.position.x &&
        open.y < node.position.y + 200 + 24 &&
        open.y + 200 + 24 > node.position.y
      expect(overlaps).toBeFalse()
    }
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
    expect(
      applyCanvasBusinessCommand(document, {
        type: "elements.remove",
        edgeIds: ["missing_edge"],
        nodeIds: ["missing_node"],
      }).changed,
    ).toBeFalse()
    expect(() => applyCanvasBusinessCommand(document, addResourcesCommand())).toThrow(CanvasCommandValidationError)
    expect(applyCanvasBusinessCommand(document, { type: "nodes.layout", nodeIds: [] }).changed).toBeFalse()
  })

  test("adds folders as file nodes with the folder renderer discriminator", () => {
    const applied = applyCanvasBusinessCommand(createCanvasDocument(), {
      type: "resources.add",
      items: [
        {
          item: { id: "folder-resource", kind: "folder", name: "Design", path: "assets/design" },
          nodeId: "folder-node",
        },
      ],
      placement: { anchor: { x: 10, y: 20 } },
    })

    expect(applied.document.nodes[0]).toMatchObject({
      data: { kind: "folder", name: "Design", path: "assets/design" },
      id: "folder-node",
      type: "file",
    })
  })

  test("replaces only a guarded file node's type and data while preserving its identity, layout, and edges", () => {
    const parent = createGroupNode({ id: "group", height: 600, position: { x: 100, y: 200 }, width: 800 })
    const anchor = createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Keep the edge" })
    const owner = {
      ...createMediaNode({
        id: "owner",
        position: { x: 25, y: 35 },
        resource: { id: "old", kind: "image" as const, name: "old.png", url: "asset://old" },
      }),
      extent: "parent" as const,
      measured: { height: 210, width: 330 },
      parentId: parent.id,
      style: { height: 240, width: 360 },
      zIndex: 7,
    }
    const document = connectCanvasNodes(createCanvasDocument({ nodes: [parent, anchor, owner] }), {
      id: "edge",
      source: anchor.id,
      target: owner.id,
    })

    const replaced = applyCanvasBusinessCommand(document, {
      type: "resources.replace",
      expectedTarget: createCanvasNodeContentGuard(owner),
      item: {
        durationMs: 4_000,
        id: "generated-video",
        kind: "video",
        mimeType: "video/mp4",
        name: "generated.mp4",
        url: "asset://generated",
      },
      targetNodeId: owner.id,
    })

    expect(replaced.createdNodeIds).toEqual([])
    expect(replaced.affectedNodeIds).toEqual([owner.id])
    expect(replaced.document.edges).toEqual(document.edges)
    expect(replaced.document.nodes.find((node) => node.id === owner.id)).toEqual({
      ...owner,
      data: expect.objectContaining({
        durationMs: 4_000,
        kind: "video",
        mimeType: "video/mp4",
        name: "generated.mp4",
        url: "asset://generated",
      }),
      type: "file",
    })

    const video = replaced.document.nodes.find((node) => node.id === owner.id)!
    const asText = applyCanvasBusinessCommand(replaced.document, {
      type: "resources.replace",
      expectedTarget: createCanvasNodeContentGuard(video),
      item: { format: "markdown", id: "generated-text", kind: "text", text: "# Generated" },
      targetNodeId: owner.id,
    })
    expect(asText.document.nodes.find((node) => node.id === owner.id)).toMatchObject({
      data: { format: "markdown", kind: "text", text: "# Generated" },
      id: owner.id,
      measured: owner.measured,
      parentId: owner.parentId,
      position: owner.position,
      style: owner.style,
      zIndex: owner.zIndex,
    })
  })

  test("lets layout change around a replacement guard but rejects changed target content and non-file targets", () => {
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Original" })
    const guard = createCanvasNodeContentGuard(owner)
    const moved = { ...owner, position: { x: 300, y: 180 }, style: { height: 500, width: 600 } }
    const command = {
      type: "resources.replace" as const,
      expectedTarget: guard,
      item: { id: "replacement", kind: "image" as const, url: "asset://replacement" },
      targetNodeId: owner.id,
    }

    expect(
      applyCanvasBusinessCommand(createCanvasDocument({ nodes: [moved] }), command).document.nodes[0],
    ).toMatchObject({
      data: { kind: "image", url: "asset://replacement" },
      position: moved.position,
      style: moved.style,
    })
    expect(() =>
      applyCanvasBusinessCommand(
        createCanvasDocument({ nodes: [{ ...moved, data: { ...moved.data, text: "Edited" } }] }),
        command,
      ),
    ).toThrow("content changed")
    expect(() => applyCanvasBusinessCommand(createCanvasDocument(), command)).toThrow("was not found")
    expect(() =>
      applyCanvasBusinessCommand(
        createCanvasDocument({ nodes: [createAgentNode({ id: owner.id, position: { x: 0, y: 0 } })] }),
        {
          ...command,
          expectedTarget: createCanvasNodeContentGuard(createAgentNode({ id: owner.id, position: { x: 0, y: 0 } })),
        },
      ),
    ).toThrow("requires a file node")
  })
})

describe("canvas application queries", () => {
  test("finds serializable node summaries by text, kind, and relationships", () => {
    const first = createTextNode({
      id: "first",
      label: "Campaign Brief",
      position: { x: 10, y: 20 },
      text: "Summer launch",
    })
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
