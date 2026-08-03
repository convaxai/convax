import { describe, expect, test } from "bun:test"
import { isCanvasTextInlineEditingScopeActive } from "./text-editing-policy"

describe("Canvas text editing activation", () => {
  test("activates inline editing only for one selected editable text card", () => {
    expect(
      isCanvasTextInlineEditingScopeActive({
        editableResource: true,
        ownsSingleNodeContext: true,
        readOnly: false,
      }),
    ).toBe(true)
    expect(
      isCanvasTextInlineEditingScopeActive({
        editableResource: true,
        ownsSingleNodeContext: false,
        readOnly: false,
      }),
    ).toBe(false)
    expect(
      isCanvasTextInlineEditingScopeActive({
        editableResource: true,
        ownsSingleNodeContext: true,
        readOnly: true,
      }),
    ).toBe(false)
    expect(
      isCanvasTextInlineEditingScopeActive({
        editableResource: false,
        ownsSingleNodeContext: true,
        readOnly: false,
      }),
    ).toBe(false)
  })
})
