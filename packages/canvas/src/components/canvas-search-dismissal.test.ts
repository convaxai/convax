import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window as HappyDOMWindow } from "happy-dom"
import { bindCanvasSearchDismissal } from "./canvas-search-dismissal"

let window: HappyDOMWindow

beforeEach(() => {
  window = new HappyDOMWindow()
})

afterEach(() => {
  window.close()
})

describe("bindCanvasSearchDismissal", () => {
  test("keeps only its owning panel open and dismisses outside pointer and Escape interactions once", () => {
    const panel = window.document.createElement("div")
    const input = window.document.createElement("input")
    panel.append(input)
    const otherPanel = window.document.createElement("div")
    const outside = window.document.createElement("div")
    window.document.body.append(panel, otherPanel, outside)
    let dismissCount = 0
    const unbind = bindCanvasSearchDismissal({
      document: window.document as unknown as Document,
      onDismiss: () => {
        dismissCount += 1
      },
      panel: panel as unknown as Element,
      window: window as unknown as globalThis.Window,
    })

    input.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(dismissCount).toBe(0)

    otherPanel.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    outside.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }))
    expect(dismissCount).toBe(3)

    unbind()
    outside.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }))
    expect(dismissCount).toBe(3)
  })
})
