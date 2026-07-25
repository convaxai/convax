import { createCanvasDocument, createCanvasSelectionActionContext, createTextNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { describe, expect, mock, test } from "bun:test"
import { createAddSelectionToConversationAction } from "./agent-selection-action"

describe("add Canvas selection to Agent conversation", () => {
  const first = createTextNode({
    id: "first/node",
    label: "First",
    metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/first.md" } },
    position: { x: 0, y: 0 },
    resourceState: { status: "ready", text: "First" },
  })
  const second = createTextNode({
    id: "second",
    label: "Second",
    metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/second.md" } },
    position: { x: 40, y: 0 },
    resourceState: { status: "ready", text: "Second" },
  })
  const document = createCanvasDocument({ id: "canvas main", nodes: [first, second] })

  test("preserves selection order and creates scoped semantic node resources", () => {
    const addResources = mock(() => undefined)
    const action = createAddSelectionToConversationAction({
      addResources,
      canvasId: document.id,
      label: "Add to conversation",
    })
    const context = createCanvasSelectionActionContext(
      document,
      [second.id, first.id],
      [],
      new AbortController().signal,
    )

    expect(action.visible?.(context)).toBeTrue()
    action.execute(context)

    expect(addResources).toHaveBeenCalledWith([
      { kind: "resource", name: "Second", uri: "convax://canvas/canvas%20main/node/second" },
      { kind: "resource", name: "First", uri: "convax://canvas/canvas%20main/node/first%2Fnode" },
    ])
  })

  test("fails closed for mixed, incomplete, stale, or aborted contexts", () => {
    const addResources = mock(() => undefined)
    const action = createAddSelectionToConversationAction({
      addResources,
      canvasId: document.id,
      label: "Add to conversation",
    })
    const mixed = createCanvasSelectionActionContext(document, [first.id], ["edge"], new AbortController().signal)
    const incomplete = createCanvasSelectionActionContext(
      document,
      [first.id, "missing"],
      [],
      new AbortController().signal,
    )
    const stale = createCanvasSelectionActionContext(
      { ...document, id: "other-canvas" },
      [first.id],
      [],
      new AbortController().signal,
    )
    const controller = new AbortController()
    controller.abort()
    const aborted = createCanvasSelectionActionContext(document, [first.id], [], controller.signal)

    expect(action.visible?.(mixed)).toBeFalse()
    expect(action.visible?.(incomplete)).toBeFalse()
    action.execute(stale)
    action.execute(aborted)
    expect(addResources).not.toHaveBeenCalled()
  })
})
