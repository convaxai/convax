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
import { createDefaultCanvasNodeRegistry } from "./builtin-registry"
import { createCanvasClipboardPayload, parseCanvasClipboard, pasteCanvasClipboard, serializeCanvasClipboard } from "./clipboard"
import { createCanvasDocument, createGroupNode, createMediaNode, createTextNode, parseCanvasDocument } from "./document"
import { canvasHistoryReducer, createCanvasHistory } from "./history"
import { createCanvasServices } from "./services"

describe("canvas history", () => {
  test("keeps a single built-in text node type", () => {
    expect(createDefaultCanvasNodeRegistry().list().map((definition) => definition.type)).toEqual([
      "text",
      "image",
      "video",
      "audio",
      "file",
      "group",
    ])
  })

  test("rejects malformed persisted documents before they reach the editor", () => {
    expect(parseCanvasDocument({})).toBeNull()
    expect(parseCanvasDocument(createCanvasDocument({ id: "one" }), "two")).toBeNull()
    expect(parseCanvasDocument(createCanvasDocument({ id: "one" }), "one")?.id).toBe("one")
    const first = createGroupNode({ id: "first", label: "First", position: { x: 0, y: 0 }, width: 100, height: 100, parentId: "second" })
    const second = createGroupNode({ id: "second", label: "Second", position: { x: 0, y: 0 }, width: 100, height: 100, parentId: "first" })
    expect(parseCanvasDocument(createCanvasDocument({ id: "cycle", nodes: [first, second] }))).toBeNull()
    const text = createTextNode({ id: "text", position: { x: 0, y: 0 } })
    expect(parseCanvasDocument({
      ...createCanvasDocument({ id: "rich-text", nodes: [text] }),
      nodes: [{ ...text, data: { ...text.data, richText: { type: "doc", content: "invalid" } } }],
    })).toBeNull()
  })
  test("migrates legacy notes into text nodes", () => {
    const legacy = createCanvasDocument({
      id: "legacy",
      nodes: [{
        id: "legacy_note",
        type: "note",
        position: { x: 20, y: 30 },
        data: { kind: "note", label: "Note", text: "Keep this thought", tone: "yellow" },
      }],
    })
    const parsed = parseCanvasDocument(legacy)

    expect(parsed?.nodes[0]).toMatchObject({
      data: { kind: "text", label: "Text", text: "Keep this thought" },
      type: "text",
    })
    expect(parsed?.nodes[0].data).not.toHaveProperty("tone")
    const media = createMediaNode({
      position: { x: 0, y: 0 },
      resource: { id: "empty-video", kind: "video", url: "" },
    })
    expect(parseCanvasDocument(createCanvasDocument({
      nodes: [{ ...media, data: { ...media.data, label: "Media" } }],
    }))?.nodes[0].data.label).toBe("Video")
  })

  test("preserves imported text formats", () => {
    const node = createTextNode({
      format: "markdown",
      label: "brief.md",
      position: { x: 0, y: 0 },
      text: "# Brief",
    })
    expect(parseCanvasDocument(createCanvasDocument({ nodes: [node] }))?.nodes[0].data).toMatchObject({
      format: "markdown",
      text: "# Brief",
    })
    expect(node.style).toEqual({ width: 360, height: 240 })
    expect(createTextNode({ position: { x: 0, y: 0 } }).data).toMatchObject({ text: "" })
    expect(createMediaNode({
      position: { x: 0, y: 0 },
      resource: { id: "empty", kind: "video", url: "" },
    }).data).toMatchObject({ label: "Video" })
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
    const withNode = addCanvasNodes(first.document, [createTextNode({ id: "typed", position: { x: 0, y: 0 } })]).document
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
        nodes: document.nodes.map((node) => node.id === "a" ? { ...node, position: { x: 8, y: 0 } } : node),
      }),
    })
    expect(committed.document.revision).toBe(1)
    expect(committed.past).toHaveLength(1)

    let previewed = canvasHistoryReducer(createCanvasHistory(initial), { type: "begin-gesture" })
    previewed = canvasHistoryReducer(previewed, {
      type: "preview-or-commit-update",
      update: (document) => ({
        ...document,
        nodes: document.nodes.map((node) => node.id === "a" ? { ...node, position: { x: 8, y: 0 } } : node),
      }),
    })
    expect(previewed.document.revision).toBe(0)
    previewed = canvasHistoryReducer(previewed, { type: "end-gesture" })
    expect(previewed.document.revision).toBe(1)
    expect(previewed.past).toHaveLength(1)
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

  test("aligns nodes against shared horizontal and vertical centers", () => {
    const first = { ...createTextNode({ id: "node_a", position: { x: 40, y: 30 } }), style: { width: 100, height: 80 } }
    const second = { ...createTextNode({ id: "node_b", position: { x: 300, y: 250 } }), style: { width: 200, height: 120 } }
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
    const second = { ...createTextNode({ id: "node_b", position: { x: 160, y: 120 } }), style: { width: 80, height: 60 } }
    const third = { ...createTextNode({ id: "node_c", position: { x: 400, y: 320 } }), style: { width: 100, height: 80 } }
    const initial = createCanvasDocument({ nodes: [first, second, third] })
    const horizontal = distributeCanvasNodes(initial, [first.id, second.id, third.id], "horizontal")
    const distributed = distributeCanvasNodes(horizontal, [first.id, second.id, third.id], "vertical")

    expect(distributed.nodes[1].position).toEqual({ x: 210, y: 170 })
    expect(layoutCanvasNodes(initial, { nodeIds: [first.id, second.id, third.id], layout: "horizontal", gap: 20 }).nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 240, y: 0 },
    ])
    expect(layoutCanvasNodes(initial, { nodeIds: [first.id, second.id, third.id], layout: "vertical", gap: 20 }).nodes.map((node) => node.position)).toEqual([
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
    const arranged = layoutCanvasNodes(
      createCanvasDocument({ nodes: [standalone, group, child] }),
      { layout: "horizontal", gap: 20 },
    )

    expect(arranged.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 420, y: 0 },
      { x: 40, y: 50 },
    ])
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
    expect(parseCanvasClipboard('{"version":1,"nodes":[{}],"edges":[]}')).toBeNull()
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
