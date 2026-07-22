import { describe, expect, test } from "bun:test"
import { connectCanvasNodes } from "../commands"
import { createAgentNode, createCanvasDocument, createGroupNode, createMediaNode, createTextNode } from "../document"
import type { CanvasAddResourcesCommand } from "./commands"
import {
  applyCanvasBusinessCommand,
  CanvasCommandValidationError,
  CanvasRevisionConflictError,
  createCanvasDocumentPatchCommand,
  createCanvasNodeContentGuard,
  executeCanvasBusinessCommand,
  findOpenCanvasPoint,
  matchesCanvasNodeContentGuard,
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
  test("keeps content guards stable when persistence omits undefined media fields", () => {
    const pending = createMediaNode({
      id: "pending",
      position: { x: 0, y: 0 },
      resource: { id: "pending", kind: "image", url: "" },
    })
    pending.data.status = "pending"
    const guard = createCanvasNodeContentGuard(pending)
    const persisted = {
      ...pending,
      data: { kind: "image" as const, label: "Image", status: "pending" as const, url: "" },
    }

    expect(matchesCanvasNodeContentGuard(persisted, guard)).toBeTrue()
    const failed = applyCanvasBusinessCommand(createCanvasDocument({ id: "canvas", nodes: [persisted] }), {
      expectedTarget: guard,
      message: "Generation could not be completed",
      targetNodeId: persisted.id,
      type: "resources.pending.fail",
    })
    expect(failed.document.nodes[0]?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
  })

  test("commits a renderer element patch without accepting a whole replacement document", () => {
    const first = createTextNode({ id: "first", position: { x: 0, y: 0 }, text: "Before" })
    const removed = createTextNode({ id: "removed", position: { x: 200, y: 0 }, text: "Remove" })
    const base = createCanvasDocument({ id: "canvas-patch", nodes: [first, removed], title: "Before" })
    const added = createTextNode({ id: "added", position: { x: 400, y: 0 }, text: "Added" })
    const target = connectCanvasNodes(
      {
        ...base,
        metadata: { ...base.metadata, title: "After" },
        nodes: [{ ...first, data: { ...first.data, text: "After" } }, added],
      },
      { id: "edge-added", source: first.id, target: added.id },
    )
    const command = createCanvasDocumentPatchCommand(base, target)

    expect(command).toMatchObject({
      addedNodes: [{ id: added.id }],
      metadata: { title: "After" },
      removedNodeIds: [removed.id],
      updatedNodes: [{ id: first.id }],
    })
    expect("document" in command).toBeFalse()

    const committed = executeCanvasBusinessCommand(base, {
      actor: { id: "renderer-one", kind: "renderer" },
      command,
      commandId: "renderer-patch-one",
      expectedRevision: 0,
    })
    expect(committed.document).toMatchObject({
      metadata: { title: "After" },
      revision: 1,
    })
    expect(committed.document.nodes.map((node) => node.id)).toEqual([first.id, added.id])
    expect(committed.document.nodes[0]?.data).toMatchObject({ text: "After" })
    expect(committed.document.edges).toEqual([
      expect.objectContaining({ id: "edge-added", source: first.id, target: added.id }),
    ])
  })

  test("rejects malformed renderer patches and stale revisions", () => {
    const node = createTextNode({ id: "node", position: { x: 0, y: 0 } })
    const base = createCanvasDocument({ id: "canvas-patch-guard", nodes: [node] })
    const command = createCanvasDocumentPatchCommand(base, {
      ...base,
      nodes: [{ ...node, position: { x: 20, y: 30 } }],
    })
    expect(() =>
      executeCanvasBusinessCommand(base, {
        actor: { id: "renderer-one", kind: "renderer" },
        command,
        commandId: "renderer-patch-stale",
        expectedRevision: 1,
      }),
    ).toThrow(CanvasRevisionConflictError)
    expect(() =>
      applyCanvasBusinessCommand(base, {
        ...command,
        removedNodeIds: [node.id],
        updatedNodes: [{ ...node, position: { x: 20, y: 30 } }],
      }),
    ).toThrow("cannot be removed and updated")
  })

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
    expect(() =>
      applyCanvasBusinessCommand(document, {
        type: "nodes.layout",
      } as never),
    ).toThrow("requires explicit node ids")
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

  test.each(["text", "image", "video", "audio"] as const)(
    "creates a host-neutral pending %s file resource with placement and relations",
    (kind) => {
      const anchor = createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Source" })
      const document = createCanvasDocument({ id: "canvas-pending", nodes: [anchor] })
      const applied = applyCanvasBusinessCommand(document, {
        type: "resources.pending.create",
        kind,
        label: `Pending ${kind}`,
        nodeId: `pending-${kind}`,
        placement: { anchor: { x: 0, y: 0 }, strategy: "avoid-overlap-cascade" },
        relation: { anchorNodeIds: [anchor.id], mode: "connect" },
      })

      expect(applied.createdNodeIds).toEqual([`pending-${kind}`])
      expect(applied.document.nodes.find((node) => node.id === `pending-${kind}`)).toMatchObject({
        data: {
          kind,
          label: `Pending ${kind}`,
          status: "pending",
          ...(kind === "text" ? { text: "" } : { url: "" }),
        },
        position: { x: 304, y: 0 },
        type: "file",
      })
      expect(applied.document.edges).toEqual([
        expect.objectContaining({ source: anchor.id, target: `pending-${kind}` }),
      ])
    },
  )

  test("fails an exact pending target and lets normal replacement clear persisted lifecycle state", () => {
    const anchor = createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Source" })
    const created = applyCanvasBusinessCommand(createCanvasDocument({ nodes: [anchor] }), {
      type: "resources.pending.create",
      kind: "image",
      label: "Relit image",
      nodeId: "pending-image",
      placement: { anchor: { x: 0, y: 0 } },
      relation: { anchorNodeIds: [anchor.id], mode: "connect" },
    })
    const pending = created.document.nodes.find((node) => node.id === "pending-image")!
    const failed = applyCanvasBusinessCommand(created.document, {
      type: "resources.pending.fail",
      expectedTarget: createCanvasNodeContentGuard(pending),
      message: "Generation could not be completed",
      targetNodeId: pending.id,
    })

    expect(failed.document.edges).toEqual(created.document.edges)
    expect(failed.document.nodes.find((node) => node.id === pending.id)).toMatchObject({
      data: { error: "Generation could not be completed", kind: "image", status: "error", url: "" },
      position: pending.position,
    })

    const replacementTarget = failed.document.nodes.find((node) => node.id === pending.id)!
    const replaced = applyCanvasBusinessCommand(failed.document, {
      type: "resources.replace",
      expectedTarget: createCanvasNodeContentGuard(replacementTarget),
      item: { id: "generated", kind: "image", url: "asset://generated" },
      targetNodeId: replacementTarget.id,
    })
    const finalNode = replaced.document.nodes.find((node) => node.id === pending.id)!
    expect(finalNode.id).toBe(pending.id)
    expect(finalNode.position).toEqual(pending.position)
    expect(replaced.document.edges).toEqual(failed.document.edges)
    expect(finalNode.data).toMatchObject({ kind: "image", url: "asset://generated" })
    expect(finalNode.data).not.toHaveProperty("status")
    expect(finalNode.data).not.toHaveProperty("error")
  })

  test("rejects pending failure after deletion or any content change", () => {
    const created = applyCanvasBusinessCommand(createCanvasDocument(), {
      type: "resources.pending.create",
      kind: "image",
      label: "Generated image",
      nodeId: "pending-image",
      placement: { anchor: { x: 0, y: 0 } },
    })
    const pending = created.document.nodes[0]
    if (!pending) throw new Error("Pending resource was not created")
    const command = {
      type: "resources.pending.fail" as const,
      expectedTarget: createCanvasNodeContentGuard(pending),
      message: "Generation could not be completed",
      targetNodeId: pending.id,
    }

    expect(() => applyCanvasBusinessCommand(createCanvasDocument(), command)).toThrow("was not found")
    expect(() =>
      applyCanvasBusinessCommand(
        createCanvasDocument({ nodes: [{ ...pending, data: { ...pending.data, label: "Changed" } }] }),
        command,
      ),
    ).toThrow("content changed")
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
