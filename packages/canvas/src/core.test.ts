import { describe, expect, test } from "bun:test"
import {
  addCanvasNodes,
  alignCanvasNodes,
  connectCanvasNodes,
  distributeCanvasNodes,
  duplicateCanvasSelection,
  groupCanvasNodes,
  layoutCanvasNodes,
  removeCanvasElements,
  ungroupCanvasNode,
} from "./commands"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "./builtin-registry"
import {
  canvasClipboardHasScopeConflict,
  createCanvasClipboardPayload,
  parseCanvasClipboard,
  pasteCanvasClipboard,
  readCanvasClipboard,
  serializeCanvasClipboard,
  writeCanvasClipboard,
} from "./clipboard"
import { getConnectedCanvasFileNodeIds, getIncomingConnectedCanvasFileNodeIds } from "./connections"
import {
  cloneCanvasDocument,
  createAgentNode,
  createCanvasDocument,
  createFolderNode as createCanvasFolderNode,
  createGroupNode,
  createMediaNode as createCanvasMediaNode,
  createTextNode as createCanvasTextNode,
  parseCanvasDocument,
} from "./document"
import { canvasHistoryReducer, createCanvasHistory } from "./history"
import { createCanvasServices } from "./services"

type TestTextNodeInput = Omit<Parameters<typeof createCanvasTextNode>[0], "metadata" | "resourceState"> & {
  metadata?: Record<string, unknown>
  resourceState?: Parameters<typeof createCanvasTextNode>[0]["resourceState"]
  text?: string
}

function createTextNode({ text, ...input }: TestTextNodeInput) {
  return createCanvasTextNode({
    ...input,
    metadata: input.metadata ?? {},
    resourceState: input.resourceState ?? { status: "ready", ...(text === undefined ? {} : { text }) },
  })
}

function createMediaNode(input: Omit<Parameters<typeof createCanvasMediaNode>[0], "resource"> & {
  resource: Partial<Parameters<typeof createCanvasMediaNode>[0]["resource"]>
    & Pick<Parameters<typeof createCanvasMediaNode>[0]["resource"], "id" | "kind">
}) {
  return createCanvasMediaNode({
    ...input,
    resource: {
      ...input.resource,
      metadata: input.resource.metadata ?? {},
      state: input.resource.state ?? { status: "ready" },
    },
  })
}

function createFolderNode(input: Omit<Parameters<typeof createCanvasFolderNode>[0], "resource"> & {
  resource: Partial<Parameters<typeof createCanvasFolderNode>[0]["resource"]>
    & Pick<Parameters<typeof createCanvasFolderNode>[0]["resource"], "id" | "kind" | "name">
}) {
  return createCanvasFolderNode({
    ...input,
    resource: {
      ...input.resource,
      metadata: input.resource.metadata ?? {},
      state: input.resource.state ?? { status: "ready" },
    },
  })
}

describe("canvas history", () => {
  test("resource factories keep prepared bytes only in transient resource state", () => {
    const text = createTextNode({
      format: "markdown",
      metadata: { source: "Notes/brief.md" },
      position: { x: 0, y: 0 },
      resourceState: { contentRevision: "rev-text", status: "ready", text: "# Brief" },
    })
    const image = createMediaNode({
      position: { x: 320, y: 0 },
      resource: {
        id: "image",
        kind: "image",
        metadata: { source: "Generated/hero.png" },
        state: { posterUrl: "blob:poster", status: "ready", url: "blob:image" },
      },
    })
    const folder = createFolderNode({
      position: { x: 640, y: 0 },
      resource: {
        id: "folder",
        kind: "folder",
        metadata: { source: "references" },
        name: "references",
        state: { status: "stale" },
      },
    })

    expect(text.data).toMatchObject({
      metadata: { source: "Notes/brief.md" },
      resourceState: { contentRevision: "rev-text", status: "ready", text: "# Brief" },
    })
    expect(text.data).not.toHaveProperty("text")
    expect(image.data).toMatchObject({ resourceState: { posterUrl: "blob:poster", status: "ready", url: "blob:image" } })
    expect(image.data).not.toHaveProperty("url")
    expect(image.data).not.toHaveProperty("posterUrl")
    expect(folder.data).toMatchObject({ resourceState: { status: "stale" } })
    expect(folder.data).not.toHaveProperty("path")
  })

  test("clones portable Plugin node state with the Canvas document", () => {
    const pluginState = { directorProject: { objects: [{ id: "cube" }] }, schemaVersion: 1 }
    const node = createTextNode({
      id: "director-node",
      metadata: { convaxPluginState: pluginState },
      position: { x: 10, y: 20 },
    })
    const cloned = cloneCanvasDocument(createCanvasDocument({ id: "canvas-clone", nodes: [node] }))

    expect(cloned.nodes[0]?.data.metadata).toEqual(node.data.metadata)
    expect(cloned.nodes[0]?.data.metadata).not.toBe(node.data.metadata)
  })

  test("hydrates a persisted revision without turning it into an undoable edit", () => {
    const initial = createCanvasDocument({ id: "canvas_hydrate" })
    const hydrated = canvasHistoryReducer(createCanvasHistory(initial), {
      type: "hydrate",
      document: {
        ...initial,
        revision: 7,
        nodes: [createTextNode({ id: "persisted", position: { x: 0, y: 0 }, text: "Saved" })],
      },
    })

    expect(hydrated.document.revision).toBe(7)
    expect(hydrated.document.nodes.map((node) => node.id)).toEqual(["persisted"])
    expect(hydrated.past).toEqual([])
    expect(hydrated.future).toEqual([])
  })

  test("keeps file and agent as internal roles while hiding generic and agent insertion", () => {
    const registry = createDefaultCanvasNodeRegistry()
    expect(registry.list().map((definition) => definition.type)).toEqual(["file", "agent"])
    expect(registry.get("agent")?.hidden).toBeTrue()
    const fileDefinition = registry.get("file")!
    expect(() => registry.register({ ...fileDefinition, type: "plugin-role" as "file" })).toThrow("file or agent")
    expect(
      createDefaultCanvasFileRendererRegistry()
        .list()
        .map((definition) => definition.id),
    ).toEqual(["audio", "file", "folder", "image", "text", "video"])
    expect(createDefaultCanvasFileRendererRegistry().get("file")?.hidden).toBeTrue()
    expect(createTextNode({ position: { x: 0, y: 0 } }).type).toBe("file")
    expect(createMediaNode({ position: { x: 0, y: 0 }, resource: { id: "image", kind: "image" } }).type).toBe(
      "file",
    )
    expect(createAgentNode({ position: { x: 0, y: 0 } }).type).toBe("agent")

    const text = createTextNode({ position: { x: 0, y: 0 } })
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "legacy-role", nodes: [text] }),
        nodes: [{ ...text, type: "legacy-plugin-role" }],
      })?.nodes[0].type,
    ).toBe("file")
  })

  test("rejects malformed persisted documents before they reach the editor", () => {
    expect(parseCanvasDocument({})).toBeNull()
    expect(parseCanvasDocument(createCanvasDocument({ id: "one" }), "two")).toBeNull()
    expect(parseCanvasDocument(createCanvasDocument({ id: "one" }), "one")?.id).toBe("one")
    const first = createGroupNode({
      id: "first",
      label: "First",
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      parentId: "second",
    })
    const second = createGroupNode({
      id: "second",
      label: "Second",
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      parentId: "first",
    })
    expect(parseCanvasDocument(createCanvasDocument({ id: "cycle", nodes: [first, second] }))).toBeNull()
    const text = createTextNode({ id: "text", position: { x: 0, y: 0 } })
    const { metadata: _metadata, ...textWithoutMetadata } = text.data
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "missing-resource-metadata", nodes: [text] }),
        nodes: [{ ...text, data: textWithoutMetadata }],
      }),
    ).toBeNull()
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "rich-text", nodes: [text] }),
        nodes: [{ ...text, data: { ...text.data, richText: { type: "doc", content: "invalid" } } }],
      }),
    ).toBeNull()
    const image = createMediaNode({
      position: { x: 0, y: 0 },
      resource: { id: "image", kind: "image", metadata: {}, state: { status: "ready" } },
    })
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "legacy-media-url", nodes: [image] }),
        nodes: [{ ...image, data: { ...image.data, url: "blob:legacy" } }],
      }),
    ).toBeNull()
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "bad-folder", nodes: [text] }),
        nodes: [{ ...text, data: { kind: "folder", label: "Folder", name: {} } }],
      }),
    ).toBeNull()
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "bad-agent", nodes: [text] }),
        nodes: [{ ...text, data: { agentId: [], kind: "agent", label: "Agent" } }],
      }),
    ).toBeNull()
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "bad-status", nodes: [text] }),
        nodes: [{ ...text, data: { ...text.data, status: "running" } }],
      }),
    ).toBeNull()
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "bad-error", nodes: [text] }),
        nodes: [{ ...text, data: { ...text.data, error: { raw: "unsafe" }, status: "error" } }],
      }),
    ).toBeNull()
    expect(
      parseCanvasDocument({
        ...createCanvasDocument({ id: "pending", nodes: [text] }),
        nodes: [{ ...text, data: { ...text.data, status: "pending" } }],
      })?.nodes[0]?.data.status,
    ).toBe("pending")
  })
  test("rejects legacy note inputs instead of migrating inline content", () => {
    const legacy = {
      ...createCanvasDocument({ id: "legacy" }),
      nodes: [
        {
          id: "legacy_note",
          type: "note",
          position: { x: 20, y: 30 },
          data: { kind: "note", label: "Note", text: "Keep this thought", tone: "yellow" },
        },
      ],
    }
    expect(parseCanvasDocument(legacy)).toBeNull()
  })

  test("preserves resource view metadata without durable text", () => {
    const node = createTextNode({
      format: "markdown",
      label: "brief.md",
      metadata: { source: "Notes/brief.md" },
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "# Brief" },
    })
    expect(parseCanvasDocument(createCanvasDocument({ nodes: [node] }))?.nodes[0].data).toMatchObject({
      format: "markdown",
      metadata: { source: "Notes/brief.md" },
      resourceState: { status: "ready", text: "# Brief" },
    })
    expect(node.style).toEqual({ width: 360, height: 240 })
    expect(
      createMediaNode({
        position: { x: 0, y: 0 },
        resource: { id: "empty", kind: "video", metadata: {}, state: { status: "stale" } },
      }).data,
    ).toMatchObject({ label: "Video", resourceState: { status: "stale" } })
  })
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

  test("persists committed gesture previews while keeping one undo entry", () => {
    const initial = createCanvasDocument({ id: "canvas_typing" })
    const first = canvasHistoryReducer(createCanvasHistory(initial), { type: "begin-gesture" })
    const withNode = addCanvasNodes(first.document, [
      createTextNode({ id: "typed", position: { x: 0, y: 0 } }),
    ]).document
    const previewed = canvasHistoryReducer(first, { type: "commit", document: withNode })
    expect(previewed.document.revision).toBe(1)
    expect(previewed.past).toHaveLength(0)
    const finished = canvasHistoryReducer(previewed, { type: "end-gesture" })
    expect(finished.past).toHaveLength(1)
    expect(canvasHistoryReducer(finished, { type: "undo" }).document.nodes).toEqual([])
  })

  test("commits keyboard-style position changes outside a gesture", () => {
    const initial = createCanvasDocument({ nodes: [createTextNode({ id: "a", position: { x: 0, y: 0 }, text: "A" })] })
    const committed = canvasHistoryReducer(createCanvasHistory(initial), {
      type: "preview-or-commit-update",
      update: (document) => ({
        ...document,
        nodes: document.nodes.map((node) => (node.id === "a" ? { ...node, position: { x: 8, y: 0 } } : node)),
      }),
    })
    expect(committed.document.revision).toBe(1)
    expect(committed.past).toHaveLength(1)

    let previewed = canvasHistoryReducer(createCanvasHistory(initial), { type: "begin-gesture" })
    previewed = canvasHistoryReducer(previewed, {
      type: "preview-or-commit-update",
      update: (document) => ({
        ...document,
        nodes: document.nodes.map((node) => (node.id === "a" ? { ...node, position: { x: 8, y: 0 } } : node)),
      }),
    })
    expect(previewed.document.revision).toBe(0)
    previewed = canvasHistoryReducer(previewed, { type: "end-gesture" })
    expect(previewed.document.revision).toBe(1)
    expect(previewed.past).toHaveLength(1)
  })
})

describe("canvas agent context", () => {
  test("collects connected file nodes in both directions without duplicates", () => {
    const agent = createAgentNode({ id: "agent", position: { x: 0, y: 0 } })
    const first = createTextNode({ id: "first", position: { x: 0, y: 0 } })
    const second = createMediaNode({
      id: "second",
      position: { x: 0, y: 0 },
      resource: { id: "image", kind: "image" },
    })
    const otherAgent = createAgentNode({ id: "other-agent", position: { x: 0, y: 0 } })
    const group = createGroupNode({ id: "group", height: 100, position: { x: 0, y: 0 }, width: 100 })
    const document = createCanvasDocument({
      edges: [
        { id: "one", source: agent.id, target: first.id },
        { id: "two", source: second.id, target: agent.id },
        { id: "duplicate", source: first.id, target: agent.id },
        { id: "agent-link", source: agent.id, target: otherAgent.id },
        { id: "group-link", source: group.id, target: agent.id },
      ],
      nodes: [agent, first, second, otherAgent, group],
    })

    expect(getConnectedCanvasFileNodeIds(document, agent.id)).toEqual([first.id, second.id])
  })

  test("collects only incoming file nodes for data-flow inputs", () => {
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 } })
    const incoming = createMediaNode({
      id: "incoming",
      position: { x: 0, y: 0 },
      resource: { id: "image", kind: "image" },
    })
    const outgoing = createTextNode({ id: "outgoing", position: { x: 0, y: 0 } })
    const document = createCanvasDocument({
      edges: [
        { id: "input", source: incoming.id, target: owner.id },
        { id: "duplicate", source: incoming.id, target: owner.id },
        { id: "output", source: owner.id, target: outgoing.id },
      ],
      nodes: [owner, incoming, outgoing],
    })

    expect(getIncomingConnectedCanvasFileNodeIds(document, owner.id)).toEqual([incoming.id])
  })
})

describe("canvas commands", () => {
  test("applies async-style updates to the latest history document", () => {
    const initial = createCanvasDocument({ id: "canvas_async" })
    const concurrent = createTextNode({ id: "concurrent", position: { x: 0, y: 0 } })
    const uploaded = createTextNode({ id: "uploaded", position: { x: 20, y: 20 } })
    const afterEdit = canvasHistoryReducer(createCanvasHistory(initial), {
      type: "commit",
      document: addCanvasNodes(initial, [concurrent]).document,
    })
    const afterUpload = canvasHistoryReducer(afterEdit, {
      type: "commit-update",
      update: (document) => addCanvasNodes(document, [uploaded]).document,
    })

    expect(afterUpload.document.nodes.map((node) => node.id)).toEqual(["concurrent", "uploaded"])
  })
  test("groups and ungroups without changing world positions", () => {
    const first = createTextNode({ id: "node_a", position: { x: 20, y: 50 } })
    const second = createTextNode({ id: "node_b", position: { x: 360, y: 90 } })
    const initial = createCanvasDocument({ nodes: [first, second] })
    const grouped = groupCanvasNodes(initial, [first.id, second.id])
    const group = grouped.document.nodes.find((node) => node.data.kind === "group")

    expect(group).toBeDefined()
    if (!group) throw new Error("Group was not created")
    expect(group.type).toBe("file")
    expect(grouped.selectedNodeIds).toEqual([group.id])
    const ungrouped = ungroupCanvasNode(grouped.document, group.id)
    expect(ungrouped.document.nodes.map((node) => [node.id, node.position])).toEqual([
      [first.id, first.position],
      [second.id, second.position],
    ])
  })

  test("duplicates selected nodes and remaps their internal edges", () => {
    const pluginState = {
      directorProject: { objects: [{ id: "cube" }] },
      schemaVersion: 1,
    }
    const first = createTextNode({
      id: "node_a",
      metadata: { convaxPluginState: pluginState },
      position: { x: 0, y: 0 },
    })
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
    expect(clones[0]?.data.metadata).toEqual(first.data.metadata)
    expect(clones[0]?.data.metadata).not.toBe(first.data.metadata)
  })

  test("duplicates connected edges by default and can create a detached copy", () => {
    const source = createTextNode({ id: "source", position: { x: -320, y: 0 } })
    const selected = createTextNode({ id: "selected", position: { x: 0, y: 0 } })
    const target = createTextNode({ id: "target", position: { x: 320, y: 0 } })
    let initial = createCanvasDocument({ nodes: [source, selected, target] })
    initial = connectCanvasNodes(initial, { id: "incoming", source: source.id, target: selected.id })
    initial = connectCanvasNodes(initial, { id: "outgoing", source: selected.id, target: target.id })

    const connected = duplicateCanvasSelection(initial, [selected.id])
    const connectedId = connected.duplicatedNodeIdBySourceId.get(selected.id)
    const duplicatedEdges = connected.document.edges.filter((edge) => !["incoming", "outgoing"].includes(edge.id))
    expect(duplicatedEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: source.id, target: connectedId }),
        expect.objectContaining({ source: connectedId, target: target.id }),
      ]),
    )

    const detached = duplicateCanvasSelection(initial, [selected.id], { x: 0, y: 0 }, { edgeScope: "internal" })
    expect(detached.document.edges).toEqual(initial.edges)
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

  test("aligns nodes against shared horizontal and vertical centers", () => {
    const first = { ...createTextNode({ id: "node_a", position: { x: 40, y: 30 } }), style: { width: 100, height: 80 } }
    const second = {
      ...createTextNode({ id: "node_b", position: { x: 300, y: 250 } }),
      style: { width: 200, height: 120 },
    }
    const initial = createCanvasDocument({ nodes: [first, second] })
    const centered = alignCanvasNodes(initial, [first.id, second.id], "center")
    const aligned = alignCanvasNodes(centered, [first.id, second.id], "middle")

    expect(aligned.nodes.map((node) => node.position)).toEqual([
      { x: 220, y: 160 },
      { x: 170, y: 140 },
    ])
  })

  test("distributes and lays out selected nodes on both axes", () => {
    const first = { ...createTextNode({ id: "node_a", position: { x: 0, y: 0 } }), style: { width: 100, height: 80 } }
    const second = {
      ...createTextNode({ id: "node_b", position: { x: 160, y: 120 } }),
      style: { width: 80, height: 60 },
    }
    const third = {
      ...createTextNode({ id: "node_c", position: { x: 400, y: 320 } }),
      style: { width: 100, height: 80 },
    }
    const initial = createCanvasDocument({ nodes: [first, second, third] })
    const horizontal = distributeCanvasNodes(initial, [first.id, second.id, third.id], "horizontal")
    const distributed = distributeCanvasNodes(horizontal, [first.id, second.id, third.id], "vertical")

    expect(distributed.nodes[1].position).toEqual({ x: 210, y: 170 })
    expect(
      layoutCanvasNodes(initial, { nodeIds: [first.id, second.id, third.id], layout: "horizontal", gap: 20 }).nodes.map(
        (node) => node.position,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 240, y: 0 },
    ])
    expect(
      layoutCanvasNodes(initial, { nodeIds: [first.id, second.id, third.id], layout: "vertical", gap: 20 }).nodes.map(
        (node) => node.position,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 200 },
    ])
  })

  test("lays out every root node while preserving nested positions", () => {
    const standalone = createTextNode({ id: "node_a", position: { x: 0, y: 0 } })
    const group = createGroupNode({ id: "group_a", position: { x: 500, y: 120 }, width: 400, height: 300 })
    const child = {
      ...createTextNode({ id: "node_b", position: { x: 40, y: 50 } }),
      extent: "parent" as const,
      parentId: group.id,
    }
    const arranged = layoutCanvasNodes(createCanvasDocument({ nodes: [standalone, group, child] }), {
      layout: "horizontal",
      gap: 20,
    })

    expect(arranged.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 420, y: 0 },
      { x: 40, y: 50 },
    ])
  })
})

describe("canvas clipboard", () => {
  test("blocks scope-backed files and folders from resolving in another scope", () => {
    const folder = createFolderNode({
      id: "folder",
      position: { x: 0, y: 0 },
      resource: { id: "folder", kind: "folder", name: "docs" },
    })
    const sourcedText = createTextNode({
      id: "text",
      metadata: { sourcePath: "README.md" },
      position: { x: 0, y: 0 },
    })
    const inlineText = createTextNode({ id: "inline", position: { x: 0, y: 0 } })

    expect(canvasClipboardHasScopeConflict({ version: 1, scope: "one", nodes: [folder], edges: [] }, "two")).toBeTrue()
    expect(
      canvasClipboardHasScopeConflict({ version: 1, scope: "one", nodes: [sourcedText], edges: [] }, "two"),
    ).toBeTrue()
    expect(
      canvasClipboardHasScopeConflict({ version: 1, scope: "one", nodes: [inlineText], edges: [] }, "two"),
    ).toBeFalse()
    expect(canvasClipboardHasScopeConflict({ version: 1, scope: "one", nodes: [folder], edges: [] }, "one")).toBeFalse()
  })

  test("round trips a graph fragment with fresh identifiers", () => {
    const pluginState = {
      directorProject: { objects: [{ id: "cube" }] },
      schemaVersion: 1,
    }
    const first = createTextNode({
      id: "node_a",
      metadata: { convaxPluginState: pluginState },
      position: { x: 0, y: 0 },
    })
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
    const pastedFirst = pasted.document.nodes.find((node) => node.id === pasted.selectedNodeIds[0])
    expect(pastedFirst?.data.metadata).toEqual(first.data.metadata)
  })

  test("rejects unrelated clipboard data", () => {
    expect(parseCanvasClipboard("plain text")).toBeNull()
    expect(parseCanvasClipboard('{"version":2,"nodes":[],"edges":[]}')).toBeNull()
    expect(parseCanvasClipboard('{"version":1,"nodes":[{}],"edges":[]}')).toBeNull()
  })

  test("round trips a graph fragment through native clipboard data across Canvas instances", () => {
    const values = new Map<string, string>()
    const clipboardData = {
      getData: (type: string) => values.get(type) ?? "",
      setData: (type: string, value: string) => values.set(type, value),
    } as unknown as DataTransfer
    const source = createCanvasDocument({
      nodes: [createTextNode({ id: "shared", position: { x: 20, y: 40 }, text: "Across canvases" })],
    })
    const payload = createCanvasClipboardPayload(source, ["shared"], "project-one")
    expect(payload).not.toBeNull()
    if (!payload) throw new Error("Clipboard payload was not created")

    writeCanvasClipboard(clipboardData, payload)
    const restored = readCanvasClipboard(clipboardData)

    expect(restored).toEqual(payload)
    expect(canvasClipboardHasScopeConflict(restored!, "project-one")).toBeFalse()
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

  test("never resurrects an override disposed out of order", () => {
    const base = { show() {} }
    const middle = { show() {} }
    const latest = { show() {} }
    const services = createCanvasServices({ notify: base })
    const disposeMiddle = services.register("notify", middle)
    const disposeLatest = services.register("notify", latest)

    disposeMiddle()
    expect(services.require("notify")).toBe(latest)
    disposeLatest()
    expect(services.require("notify")).toBe(base)
  })
})
