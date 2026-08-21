import { expect, test } from "bun:test"
import { Window } from "happy-dom"

import { isCanvasSpacePanningShortcut } from "./use-space-panning"

test("starts Space panning only from the focused Canvas with no modifiers", () => {
  const window = new Window()
  const previousHTMLElement = globalThis.HTMLElement
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: window.HTMLElement,
    writable: true,
  })
  try {
    const canvas = window.document.createElement("div")
    canvas.className = "convax-canvas"
    const pane = window.document.createElement("div")
    const input = window.document.createElement("input")
    canvas.append(pane, input)
    window.document.body.append(canvas)

    const event = (target: EventTarget, overrides: Partial<KeyboardEvent> = {}) =>
      ({
        altKey: false,
        code: "Space",
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        shiftKey: false,
        target,
        ...overrides,
      }) as KeyboardEvent

    expect(isCanvasSpacePanningShortcut(event(canvas))).toBeTrue()
    expect(isCanvasSpacePanningShortcut(event(pane))).toBeTrue()
    expect(isCanvasSpacePanningShortcut(event(input))).toBeFalse()
    expect(isCanvasSpacePanningShortcut(event(window.document.body))).toBeFalse()
    expect(isCanvasSpacePanningShortcut(event(pane, { metaKey: true }))).toBeFalse()
    expect(isCanvasSpacePanningShortcut(event(pane, { shiftKey: true }))).toBeFalse()
    expect(isCanvasSpacePanningShortcut(event(pane, { repeat: true }))).toBeFalse()
  } finally {
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: previousHTMLElement,
      writable: true,
    })
  }
})
