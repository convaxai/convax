import { describe, expect, test } from "bun:test"
import { connectCanvasNodes } from "../commands"
import { createAgentNode, createCanvasDocument, createGroupNode, createMediaNode, createTextNode } from "../document"
import { getCanvasResourcePresentationSize } from "../media-sizing"
import type { CanvasAddResourcesCommand } from "./commands"
import {
  applyCanvasBusinessCommand,
  CanvasCommandValidationError,
  createCanvasGenerationTargetGuard,
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
          metadata: { source: "Generated/Poster.png" },
          name: "Poster.png",
          state: { status: "ready", url: "asset://poster" },
          width: 1_000,
          height: 500,
        },
        nodeId: "image_node",
      },
      {
        item: {
          id: "resource_brief",
          kind: "text",
          metadata: { source: "docs/brief.md" },
          mimeType: "text/markdown",
          name: "Brief.md",
          state: { status: "ready", text: "# Campaign brief" },
        },
        nodeId: "text_node",
      },
    ],
    placement: { anchor: { x: 0, y: 0 }, strategy: "avoid-overlap-cascade" },
    relation: { anchorNodeIds: ["anchor"], direction: "from-anchor", mode: "connect" },
  }
}

describe("canvas application commands", () => {
  test("keeps content guards stable when persistence omits transient resource state", () => {
    const pending = createMediaNode({
      id: "pending",
      position: { x: 0, y: 0 },
      resource: { id: "pending", kind: "image", metadata: {}, state: { status: "ready", url: "" } },
    })
    pending.data.status = "pending"
    const guard = createCanvasNodeContentGuard(pending)
    const persisted = {
      ...pending,
      data: {
        kind: "image" as const,
        label: "Image",
        metadata: {},
        status: "pending" as const,
      },
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

  test("adds prepared resources with product sizing, placement, and explicit relations", () => {
    const anchor = {
      ...createTextNode({
        id: "anchor",
        metadata: { source: "Notes/anchor.md" },
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "Anchor" },
      }),
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
    expect(applied.document).not.toHaveProperty("revision")
    expect(applied.createdNodeIds).toEqual(["image_node", "text_node"])
    expect(applied.document.nodes.find((node) => node.id === "image_node")).toMatchObject({
      position: { x: 344, y: 0 },
      style: { height: 160, width: 320 },
    })
    expect(applied.document.nodes.find((node) => node.id === "text_node")).toMatchObject({
      data: {
        metadata: { source: "docs/brief.md" },
        mimeType: "text/markdown",
        name: "Brief.md",
        resourceState: { status: "ready", text: "# Campaign brief" },
      },
      position: { x: 380, y: 36 },
      style: { height: 180, width: 320 },
    })
    expect(applied.document.nodes.find((node) => node.id === "text_node")?.data).not.toHaveProperty("format")
    expect(applied.document.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["anchor", "image_node"],
      ["anchor", "text_node"],
    ])
  })

  test("atomically materializes one top-level file node beside a matching source and connects it", () => {
    const source = {
      ...createMediaNode({
        id: "video-source",
        position: { x: 20, y: 40 },
        resource: {
          id: "video-resource",
          kind: "video",
          metadata: {},
          state: { status: "ready", url: "asset://source" },
        },
      }),
      style: { height: 180, width: 320 },
    }
    const plugin = {
      ...createTextNode({
        id: "plugin-node",
        metadata: {},
        position: { x: -1000, y: -1000 },
        resourceState: { status: "ready", text: "" },
      }),
      data: { kind: "plugin.editor", label: "Editor", metadata: { plugin: "editor" } },
      style: { height: 500, width: 700 },
    }
    const document = createCanvasDocument({ id: "materialize", nodes: [source] })
    const committed = executeCanvasBusinessCommand(document, {
      actor: { id: "plugin:editor", kind: "host" },
      command: {
        type: "nodes.materialize-connected",
        node: plugin,
        sourceKind: "video",
        sourceNodeId: source.id,
      },
      commandId: "materialize-editor",
    })

    expect(committed.document).not.toHaveProperty("revision")
    expect(committed.createdNodeIds).toEqual([plugin.id])
    expect(committed.document.nodes.find((node) => node.id === plugin.id)).toMatchObject({
      data: { kind: "plugin.editor" },
      position: { x: 364, y: 40 },
    })
    expect(committed.document.edges).toEqual([expect.objectContaining({ source: source.id, target: plugin.id })])
    expect(committed.document.nodes.find((node) => node.id === source.id)).toEqual(source)
    expect(() =>
      executeCanvasBusinessCommand(document, {
        actor: { id: "plugin:editor", kind: "host" },
        command: {
          type: "nodes.materialize-connected",
          node: plugin,
          sourceKind: "audio",
          sourceNodeId: source.id,
        },
        commandId: "wrong-source-kind",
      }),
    ).toThrow("requires a audio file node")
  })

  test("creates a generic Plugin surface without a caller-selected id or position", () => {
    const occupied = {
      ...createTextNode({
        id: "occupied",
        metadata: {},
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "" },
      }),
      style: { height: 200, width: 300 },
    }
    const document = createCanvasDocument({ id: "plugin-surface", nodes: [occupied] })
    const committed = executeCanvasBusinessCommand(document, {
      actor: { id: "host", kind: "host" },
      command: {
        type: "plugin.surface.create",
        label: "Storyboard",
        size: { height: 320, width: 480 },
        plugin: {
          id: "acme.storyboard",
          snapshotDigest: "a".repeat(64),
          pluginStateSchemaDigest: "b".repeat(64),
          validationArtifact: {
            owner: "plugin",
            format: "convax.plugin-validation-artifact",
            artifactDigest: "b".repeat(64),
          },
          state: { board: "empty" },
        },
      },
      commandId: "create-storyboard",
    })

    expect(committed.createdNodeIds).toHaveLength(1)
    const created = committed.document.nodes.find((node) => node.id === committed.createdNodeIds[0])!
    expect(created.type).toBe("file")
    expect(created.parentId).toBeUndefined()
    expect(created.data.kind).toBe("plugin.acme.storyboard")
    expect(created.data.metadata).toMatchObject({ convaxPluginState: { board: "empty" } })
    expect(created.position).not.toEqual(occupied.position)
    expect(committed.document.edges).toEqual([])
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
      ...createTextNode({
        id: `occupied-${index}`,
        metadata: {},
        position: { x, y },
        resourceState: { status: "ready" },
      }),
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

  test("keeps a viewport-scoped placement inside the visible world bounds", () => {
    const occupied = {
      ...createTextNode({
        id: "occupied",
        metadata: {},
        position: { x: 400, y: 100 },
        resourceState: { status: "ready" },
      }),
      style: { height: 150, width: 200 },
    }

    const open = findOpenCanvasPoint(
      createCanvasDocument({ nodes: [occupied] }),
      { x: 400, y: 100 },
      { height: 150, width: 200 },
      { bottom: 400, left: 0, right: 600, top: 0 },
    )

    expect(open.x).toBeGreaterThanOrEqual(0)
    expect(open.y).toBeGreaterThanOrEqual(0)
    expect(open.x + 200).toBeLessThanOrEqual(600)
    expect(open.y + 150).toBeLessThanOrEqual(400)
    expect(open).not.toEqual({ x: 400, y: 100 })
  })

  test("keeps an empty command as a no-op and validates referenced nodes", () => {
    const document = createCanvasDocument({ id: "canvas_noop" })
    const empty = executeCanvasBusinessCommand(document, {
      actor: { id: "ui", kind: "ui" },
      command: { type: "resources.add", items: [], placement: { anchor: { x: 0, y: 0 } } },
      commandId: "empty",
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
          item: {
            id: "folder-resource",
            kind: "folder",
            metadata: { source: "assets/design" },
            name: "Design",
            state: { status: "ready" },
          },
          nodeId: "folder-node",
        },
      ],
      placement: { anchor: { x: 10, y: 20 } },
    })

    expect(applied.document.nodes[0]).toMatchObject({
      data: { kind: "folder", name: "Design", resourceState: { status: "ready" } },
      id: "folder-node",
      type: "file",
    })
  })

  test("connects whole structural groups while preserving nested resource placement", () => {
    const group = createGroupNode({ id: "group", height: 300, position: { x: 0, y: 0 }, width: 400 })
    const card = createTextNode({
      id: "card",
      metadata: {},
      position: { x: 500, y: 0 },
      resourceState: { status: "ready", text: "Card" },
    })
    const document = createCanvasDocument({ id: "canvas-groups", nodes: [group, card] })

    const connected = applyCanvasBusinessCommand(document, {
      connection: { source: group.id, target: card.id },
      type: "nodes.connect",
    })
    expect(connected.document.edges).toEqual([expect.objectContaining({ source: group.id, target: card.id })])

    const related = applyCanvasBusinessCommand(document, {
      items: [
        {
          item: { id: "text", kind: "text", metadata: {}, state: { status: "ready", text: "New" } },
          nodeId: "new-text",
        },
      ],
      placement: { anchor: { x: 0, y: 0 } },
      relation: { anchorNodeIds: [group.id], mode: "connect" },
      type: "resources.add",
    })
    expect(related.document.edges).toEqual([expect.objectContaining({ source: group.id, target: "new-text" })])

    const nested = applyCanvasBusinessCommand(document, {
      items: [
        {
          item: { id: "nested-text", kind: "text", metadata: {}, state: { status: "ready", text: "Nested" } },
          nodeId: "nested-text",
        },
      ],
      placement: { anchor: { x: 32, y: 48 }, parentId: group.id },
      type: "resources.add",
    })
    expect(nested.document.nodes.find((node) => node.id === "nested-text")).toMatchObject({
      extent: "parent",
      parentId: group.id,
      position: { x: 32, y: 48 },
    })
    expect(() =>
      applyCanvasBusinessCommand(document, {
        items: [
          {
            item: { id: "invalid", kind: "text", metadata: {}, state: { status: "ready", text: "Invalid" } },
            nodeId: "invalid",
          },
        ],
        placement: { anchor: { x: 0, y: 0 }, parentId: card.id },
        type: "resources.add",
      }),
    ).toThrow("is not a structural group")
  })

  test("reparents through the typed application command and rejects group cycles", () => {
    const outer = createGroupNode({
      id: "outer",
      height: 300,
      position: { x: 100, y: 80 },
      width: 400,
    })
    const inner = createGroupNode({
      id: "inner",
      height: 180,
      parentId: outer.id,
      position: { x: 40, y: 30 },
      width: 240,
    })
    const card = createTextNode({
      id: "card",
      metadata: {},
      position: { x: 600, y: 300 },
      resourceState: { status: "ready", text: "Card" },
    })
    const document = createCanvasDocument({ id: "canvas-reparent", nodes: [outer, inner, card] })

    const applied = applyCanvasBusinessCommand(document, {
      nodeIds: [card.id],
      parentId: inner.id,
      type: "nodes.reparent",
    })
    expect(applied.affectedNodeIds).toEqual([card.id])
    expect(applied.document.nodes.find((node) => node.id === card.id)).toMatchObject({
      extent: "parent",
      parentId: inner.id,
      position: { x: 460, y: 190 },
    })

    expect(() =>
      applyCanvasBusinessCommand(document, {
        nodeIds: [outer.id],
        parentId: inner.id,
        type: "nodes.reparent",
      }),
    ).toThrow("would create a group cycle")
    expect(() =>
      applyCanvasBusinessCommand(document, {
        nodeIds: [card.id],
        parentId: "",
        type: "nodes.reparent",
      }),
    ).toThrow("Canvas reparent target id is required")
  })

  test.each(["text", "image", "video", "audio"] as const)(
    "creates a host-neutral pending %s file resource with placement and relations",
    (kind) => {
      const anchor = createTextNode({
        id: "anchor",
        metadata: {},
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "Source" },
      })
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
          metadata: {},
          resourceState: { status: "ready", ...(kind === "text" ? { text: "" } : { url: "" }) },
        },
        position: { x: 344, y: 0 },
        style: getCanvasResourcePresentationSize(kind),
        type: "file",
      })
      expect(applied.document.edges).toEqual([
        expect.objectContaining({ source: anchor.id, target: `pending-${kind}` }),
      ])
    },
  )

  test("fails an exact pending target and lets normal replacement clear persisted lifecycle state", () => {
    const anchor = createTextNode({
      id: "anchor",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "Source" },
    })
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
      data: {
        error: "Generation could not be completed",
        kind: "image",
        resourceState: { status: "ready", url: "" },
        status: "error",
      },
      position: pending.position,
    })

    const replacementTarget = failed.document.nodes.find((node) => node.id === pending.id)!
    const replaced = applyCanvasBusinessCommand(failed.document, {
      type: "resources.replace",
      expectedTarget: createCanvasNodeContentGuard(replacementTarget),
      item: {
        height: 1_600,
        id: "generated",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "asset://generated" },
        width: 800,
      },
      targetNodeId: replacementTarget.id,
    })
    const finalNode = replaced.document.nodes.find((node) => node.id === pending.id)!
    expect(finalNode.id).toBe(pending.id)
    expect(finalNode.position).toEqual(pending.position)
    expect(replaced.document.edges).toEqual(failed.document.edges)
    expect(finalNode.data).toMatchObject({
      kind: "image",
      resourceState: { status: "ready", url: "asset://generated" },
    })
    expect(finalNode.style).toEqual({ height: 320, width: 160 })
    expect(finalNode.data).not.toHaveProperty("status")
    expect(finalNode.data).not.toHaveProperty("error")
  })

  test("keeps a pending generation's requested visual frame through generated replacement", () => {
    const created = applyCanvasBusinessCommand(createCanvasDocument(), {
      type: "resources.pending-generation.create",
      generation: { operationId: "cutout-one", prompt: "Remove the background", toolId: "image-tools/remove" },
      kind: "image",
      label: "Cutout",
      nodeId: "pending-cutout",
      placement: { anchor: { x: 20, y: 30 } },
      size: { height: 206, width: 480 },
    })
    const pending = created.document.nodes[0]!
    expect(pending.style).toEqual({ height: 206, width: 480 })

    const replaced = applyCanvasBusinessCommand(created.document, {
      expectedTarget: createCanvasGenerationTargetGuard(pending),
      item: {
        height: 821,
        id: "cutout-result",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "asset://cutout-result" },
        width: 1_915,
      },
      operationId: "cutout-one",
      targetNodeId: pending.id,
      type: "resources.replace-generated",
    })

    expect(replaced.document.nodes[0]).toMatchObject({
      data: { kind: "image", resourceState: { status: "ready", url: "asset://cutout-result" } },
      position: pending.position,
      style: { height: 206, width: 480 },
    })
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
    const anchor = createTextNode({
      id: "anchor",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "Keep the edge" },
    })
    const owner = {
      ...createMediaNode({
        id: "owner",
        position: { x: 25, y: 35 },
        resource: {
          id: "old",
          kind: "image" as const,
          metadata: { source: "old.png" },
          name: "old.png",
          state: { status: "ready", url: "asset://old" },
        },
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
        metadata: { source: "generated.mp4" },
        mimeType: "video/mp4",
        name: "generated.mp4",
        state: { status: "ready", url: "asset://generated" },
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
        resourceState: { status: "ready", url: "asset://generated" },
      }),
      type: "file",
    })

    const video = replaced.document.nodes.find((node) => node.id === owner.id)!
    const asText = applyCanvasBusinessCommand(replaced.document, {
      type: "resources.replace",
      expectedTarget: createCanvasNodeContentGuard(video),
      item: {
        id: "generated-text",
        kind: "text",
        metadata: { source: "generated.md" },
        mimeType: "text/markdown",
        name: "generated.md",
        state: { status: "ready", text: "# Generated" },
      },
      targetNodeId: owner.id,
    })
    expect(asText.document.nodes.find((node) => node.id === owner.id)).toMatchObject({
      data: {
        kind: "text",
        metadata: { source: "generated.md" },
        mimeType: "text/markdown",
        name: "generated.md",
        resourceState: { status: "ready", text: "# Generated" },
      },
      id: owner.id,
      measured: owner.measured,
      parentId: owner.parentId,
      position: owner.position,
      style: owner.style,
      zIndex: owner.zIndex,
    })
  })

  test("lets layout change around a replacement guard but rejects changed target content and non-file targets", () => {
    const owner = createTextNode({
      id: "owner",
      metadata: { source: "owner.md" },
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "Original" },
    })
    const guard = createCanvasNodeContentGuard(owner)
    const moved = { ...owner, position: { x: 300, y: 180 }, style: { height: 500, width: 600 } }
    const command = {
      type: "resources.replace" as const,
      expectedTarget: guard,
      item: {
        id: "replacement",
        kind: "image" as const,
        metadata: { source: "replacement.png" },
        state: { status: "ready" as const, url: "asset://replacement" },
      },
      targetNodeId: owner.id,
    }

    expect(
      applyCanvasBusinessCommand(createCanvasDocument({ nodes: [moved] }), command).document.nodes[0],
    ).toMatchObject({
      data: { kind: "image", resourceState: { status: "ready", url: "asset://replacement" } },
      position: moved.position,
      style: moved.style,
    })
    expect(() =>
      applyCanvasBusinessCommand(
        createCanvasDocument({
          nodes: [{ ...moved, data: { ...moved.data, label: "Edited" } }],
        }),
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
      metadata: { source: "Notes/first.md" },
      position: { x: 10, y: 20 },
      resourceState: { status: "ready", text: "Summer launch" },
    })
    const second = createTextNode({
      id: "second",
      label: "Review",
      metadata: { source: "Notes/second.md" },
      position: { x: 40, y: 20 },
      resourceState: { status: "ready", text: "Approve assets" },
    })
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
