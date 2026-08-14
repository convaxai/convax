import { describe, expect, test } from "bun:test"
import {
  CANVAS_CONNECTION_RADIUS,
  isCanvasMultiSelectionPointerGesture,
  resolveCanvasInteractionPolicy,
} from "./interaction"

describe("Canvas interaction policy", () => {
  test("keeps the connection target explicit", () => {
    expect(CANVAS_CONNECTION_RADIUS).toBe(120)
  })

  test("admits only exact primary-button pointer modifiers for additive selection", () => {
    const event = (overrides: Partial<PointerEvent> = {}) =>
      ({
        altKey: false,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        ...overrides,
      }) as PointerEvent

    expect(isCanvasMultiSelectionPointerGesture(event({ metaKey: true }))).toBeTrue()
    expect(isCanvasMultiSelectionPointerGesture(event({ shiftKey: true }))).toBeTrue()
    expect(isCanvasMultiSelectionPointerGesture(event({ metaKey: true, shiftKey: true }))).toBeFalse()
    expect(isCanvasMultiSelectionPointerGesture(event({ altKey: true, metaKey: true }))).toBeFalse()
    expect(isCanvasMultiSelectionPointerGesture(event({ button: 1, metaKey: true }))).toBeFalse()
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
    if (input.spacePanning || input.tool === "hand") expect(policy.panOnDrag).toBeTrue()
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
