import { describe, expect, test } from "bun:test"
import { connectCanvasNodes } from "./commands"
import { createCanvasDocument, createGroupNode, createMediaNode, createTextNode } from "./document"
import { setCanvasGroupFolded } from "./group-fold"
import { projectCanvasGroupFocus, resolveCanvasGroupFocusForNodes } from "./group-focus"

function textNode(id: string, parentId?: string) {
  return {
    ...createTextNode({
      id,
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: id },
    }),
    parentId,
  }
}

describe("Canvas group focus projection", () => {
  test("shows only the current scope and keeps cross-scope edges out of the render projection", () => {
    const group = createGroupNode({
      height: 480,
      id: "group",
      position: { x: 300, y: 100 },
      width: 640,
    })
    const insideA = textNode("inside-a", group.id)
    const insideB = textNode("inside-b", group.id)
    const outside = textNode("outside")
    let document = setCanvasGroupFolded(
      createCanvasDocument({ nodes: [outside, insideA, group, insideB] }),
      group.id,
      true,
    )
    document = connectCanvasNodes(document, { id: "internal", source: insideA.id, target: insideB.id })
    document = connectCanvasNodes(document, { id: "incoming", source: outside.id, target: insideA.id })
    document = connectCanvasNodes(document, { id: "group-outgoing", source: group.id, target: outside.id })

    const overview = projectCanvasGroupFocus(document)
    expect([...overview.scopeNodeIds]).toEqual(["outside", "group"])
    expect([...overview.visibleNodeIds]).toEqual(["outside", "group"])
    expect(overview.edges.map((edge) => edge.id)).toEqual(["group-outgoing"])

    const focused = projectCanvasGroupFocus(document, group.id)
    expect([...focused.scopeNodeIds]).toEqual(["inside-a", "inside-b"])
    expect([...focused.visibleNodeIds]).toEqual(["inside-a", "group", "inside-b"])
    expect(focused.edges.map((edge) => edge.id)).toEqual(["internal"])
    expect(focused.summaries.get(group.id)).toMatchObject({
      externalIncomingCount: 1,
      externalOutgoingCount: 1,
      itemCount: 2,
      nestedGroupCount: 0,
    })
  })

  test("keeps expanded Group descendants and their visible relations in the overview", () => {
    const group = createGroupNode({ height: 480, id: "group", position: { x: 300, y: 100 }, width: 640 })
    const insideA = textNode("inside-a", group.id)
    const insideB = textNode("inside-b", group.id)
    const outside = textNode("outside")
    let document = createCanvasDocument({ nodes: [outside, insideA, group, insideB] })
    document = connectCanvasNodes(document, { id: "internal", source: insideA.id, target: insideB.id })
    document = connectCanvasNodes(document, { id: "cross-scope", source: outside.id, target: insideA.id })

    const overview = projectCanvasGroupFocus(document)

    expect([...overview.scopeNodeIds]).toEqual(["outside", "group"])
    expect([...overview.visibleNodeIds]).toEqual(["outside", "inside-a", "group", "inside-b"])
    expect(overview.edges.map((edge) => edge.id)).toEqual(["internal", "cross-scope"])
  })

  test("builds a nested breadcrumb and limits folder previews to four useful materials", () => {
    const outer = createGroupNode({
      height: 640,
      id: "outer",
      label: "Campaign",
      position: { x: 0, y: 0 },
      width: 900,
    })
    const inner = createGroupNode({
      height: 420,
      id: "inner",
      label: "References",
      parentId: outer.id,
      position: { x: 40, y: 40 },
      width: 600,
    })
    const image = {
      ...createMediaNode({
        id: "image",
        position: { x: 0, y: 0 },
        resource: {
          id: "image-resource",
          kind: "image",
          metadata: {},
          state: { status: "ready", url: "asset://image" },
        },
      }),
      parentId: inner.id,
    }
    const video = {
      ...createMediaNode({
        id: "video",
        position: { x: 0, y: 0 },
        resource: {
          id: "video-resource",
          kind: "video",
          metadata: {},
          state: { posterUrl: "asset://poster", status: "ready", url: "asset://video" },
        },
      }),
      parentId: inner.id,
    }
    const document = createCanvasDocument({
      nodes: [
        outer,
        inner,
        textNode("one", inner.id),
        textNode("two", inner.id),
        textNode("three", inner.id),
        video,
        image,
      ],
    })

    const focused = projectCanvasGroupFocus(document, inner.id)
    expect(focused.focusPath).toEqual([
      { id: "outer", label: "Campaign" },
      { id: "inner", label: "References" },
    ])
    expect(focused.parentGroupId).toBe(outer.id)
    expect(focused.summaries.get(outer.id)).toMatchObject({ itemCount: 5, nestedGroupCount: 1 })
    expect(focused.summaries.get(inner.id)?.previews).toEqual([
      { id: "image", kind: "image", label: "Image", url: "asset://image" },
      { id: "video", kind: "video", label: "Video", url: "asset://poster" },
      { id: "one", kind: "text", label: "Text" },
      { id: "two", kind: "text", label: "Text" },
    ])
  })

  test("resolves a reveal to the common direct group scope", () => {
    const group = createGroupNode({ height: 300, id: "group", position: { x: 0, y: 0 }, width: 400 })
    const first = textNode("first", group.id)
    const second = textNode("second", group.id)
    const outside = textNode("outside")
    const document = createCanvasDocument({ nodes: [group, first, second, outside] })

    expect(resolveCanvasGroupFocusForNodes(document, [first.id, second.id])).toBe(group.id)
    expect(resolveCanvasGroupFocusForNodes(document, [outside.id])).toBeNull()
    expect(resolveCanvasGroupFocusForNodes(document, [first.id, outside.id])).toBeUndefined()
    expect(resolveCanvasGroupFocusForNodes(document, ["missing"])).toBeUndefined()
  })
})
