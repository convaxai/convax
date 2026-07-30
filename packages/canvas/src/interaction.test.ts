import { describe, expect, test } from "bun:test"
import {
  CANVAS_CONNECTION_RADIUS,
  CANVAS_MULTI_SELECTION_KEYS,
  resolveCanvasInteractionPolicy,
} from "./interaction"

describe("Canvas interaction policy", () => {
  test("keeps the connection target and multi-selection gesture explicit", () => {
    expect(CANVAS_CONNECTION_RADIUS).toBe(120)
    expect(CANVAS_MULTI_SELECTION_KEYS).toEqual(["Meta", "Shift"])
  })

  test.each([
    { readOnly: false, selectionDragChordHeld: false, spacePanning: false, tool: "hand" as const },
    { readOnly: false, selectionDragChordHeld: false, spacePanning: true, tool: "select" as const },
    { readOnly: true, selectionDragChordHeld: false, spacePanning: false, tool: "select" as const },
  ])("makes navigation modes non-selecting and non-mutating", (input) => {
    const policy = resolveCanvasInteractionPolicy(input)
    expect(policy.navigationOnly || input.readOnly).toBeTrue()
    expect(policy.selectionEnabled).toBeFalse()
    expect(policy.mutationEnabled).toBeFalse()
    expect(policy.nodesConnectable).toBeFalse()
    expect(policy.nodesDraggable).toBeFalse()
    expect(policy.selectionOnDrag).toBeFalse()
  })

  test("allows Select gestures while reserving the external-drag chord", () => {
    expect(
      resolveCanvasInteractionPolicy({
        readOnly: false,
        selectionDragChordHeld: false,
        spacePanning: false,
        tool: "select",
      }),
    ).toMatchObject({
      mutationEnabled: true,
      navigationOnly: false,
      selectionEnabled: true,
    })
    expect(
      resolveCanvasInteractionPolicy({
        readOnly: false,
        selectionDragChordHeld: true,
        spacePanning: false,
        tool: "select",
      }).mutationEnabled,
    ).toBeFalse()
  })
})
