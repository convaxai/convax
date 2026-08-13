import { describe, expect, mock, test } from "bun:test"
import type { KeyboardEvent } from "react"
import {
  createCanvasShortcutHandler,
  resolveCanvasTidyShortcutScope,
  type CanvasShortcutActions,
} from "./use-canvas-shortcuts"

function shortcutActions(overrides: Partial<CanvasShortcutActions> = {}): CanvasShortcutActions {
  const noop = () => undefined
  return {
    addNode: noop,
    clearSelection: noop,
    copy: noop,
    delete: noop,
    duplicate: noop,
    fitView: noop,
    generate: noop,
    group: noop,
    hand: noop,
    layout: noop,
    openSearch: noop,
    paste: noop,
    redo: noop,
    select: noop,
    selectAll: noop,
    undo: noop,
    ungroup: noop,
    zoomIn: noop,
    zoomOut: noop,
    ...overrides,
  }
}

function keyboardEvent(key: string, overrides: Partial<KeyboardEvent<HTMLElement>> = {}) {
  const preventDefault = mock(() => undefined)
  const stopPropagation = mock(() => undefined)
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    preventDefault,
    shiftKey: false,
    stopPropagation,
    target: null,
    ...overrides,
  } as unknown as KeyboardEvent<HTMLElement>
}

describe("canvas shortcuts", () => {
  test("keeps invalid multi-node tidy intent from falling through to the whole Canvas", () => {
    expect(resolveCanvasTidyShortcutScope(false, 0)).toBe("canvas")
    expect(resolveCanvasTidyShortcutScope(false, 1)).toBe("canvas")
    expect(resolveCanvasTidyShortcutScope(true, 1)).toBe("selection")
    expect(resolveCanvasTidyShortcutScope(false, 2)).toBe("selection")
  })

  test("activates the selection and hand tools with unmodified V and H", () => {
    const select = mock(() => undefined)
    const hand = mock(() => undefined)
    const selectEvent = keyboardEvent("v")
    const handEvent = keyboardEvent("H")

    const handler = createCanvasShortcutHandler(shortcutActions({ hand, select }), false)
    handler(selectEvent)
    handler(handEvent)

    expect(select).toHaveBeenCalledTimes(1)
    expect(hand).toHaveBeenCalledTimes(1)
    expect(selectEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(handEvent.preventDefault).toHaveBeenCalledTimes(1)
  })

  test("leaves tool shortcuts available in read-only canvases", () => {
    const hand = mock(() => undefined)
    const select = mock(() => undefined)
    const handler = createCanvasShortcutHandler(shortcutActions({ hand, select }), true)

    handler(keyboardEvent("h"))
    handler(keyboardEvent("v"))

    expect(hand).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
  })

  test("leaves H unclaimed for existing shortcut consumers without a hand tool", () => {
    const actions = shortcutActions()
    delete actions.hand
    const event = keyboardEvent("h")

    createCanvasShortcutHandler(actions, false)(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  test("does not claim tool shortcuts from editable or explicitly ignored descendants", () => {
    const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement")
    class TestHTMLElement {
      constructor(
        readonly isContentEditable: boolean,
        readonly editableAncestor: boolean,
        readonly ignoredAncestor: boolean,
      ) {}

      closest(selector: string) {
        if (selector === "input, textarea, select") return this.editableAncestor ? this : null
        if (selector === "[data-canvas-shortcuts='ignore']") return this.ignoredAncestor ? this : null
        return null
      }
    }
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: TestHTMLElement })
    try {
      const hand = mock(() => undefined)
      const select = mock(() => undefined)
      const handler = createCanvasShortcutHandler(shortcutActions({ hand, select }), false)

      for (const target of [
        new TestHTMLElement(true, false, false),
        new TestHTMLElement(false, true, false),
        new TestHTMLElement(false, false, true),
      ]) {
        handler(keyboardEvent("h", { target: target as unknown as EventTarget }))
        handler(keyboardEvent("v", { target: target as unknown as EventTarget }))
      }

      expect(hand).not.toHaveBeenCalled()
      expect(select).not.toHaveBeenCalled()
    } finally {
      if (originalHTMLElement) Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement)
      else Reflect.deleteProperty(globalThis, "HTMLElement")
    }
  })

  test("leaves command copy and paste to native clipboard events", () => {
    const copy = mock(() => undefined)
    const paste = mock(() => undefined)
    const select = mock(() => undefined)
    const copyEvent = keyboardEvent("c", { metaKey: true })
    const pasteEvent = keyboardEvent("v", { metaKey: true })

    const handler = createCanvasShortcutHandler(shortcutActions({ copy, paste, select }), false)
    handler(copyEvent)
    handler(pasteEvent)

    expect(copy).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(copyEvent.preventDefault).not.toHaveBeenCalled()
    expect(pasteEvent.preventDefault).not.toHaveBeenCalled()
  })

  test("matches Pippit editing and viewport modifier chords exactly", () => {
    const duplicate = mock(() => undefined)
    const fitView = mock(() => undefined)
    const group = mock(() => undefined)
    const layout = mock(() => undefined)
    const redo = mock(() => undefined)
    const undo = mock(() => undefined)
    const ungroup = mock(() => undefined)
    const handler = createCanvasShortcutHandler(
      shortcutActions({ duplicate, fitView, group, layout, redo, undo, ungroup }),
      false,
    )

    handler(keyboardEvent("d", { metaKey: true }))
    handler(keyboardEvent("0", { ctrlKey: true }))
    handler(keyboardEvent("g", { ctrlKey: true }))
    handler(keyboardEvent("G", { metaKey: true, shiftKey: true }))
    handler(keyboardEvent("z", { metaKey: true }))
    handler(keyboardEvent("Z", { metaKey: true, shiftKey: true }))
    handler(keyboardEvent("y", { ctrlKey: true }))
    handler(keyboardEvent("f", { altKey: true, shiftKey: true }))

    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(group).toHaveBeenCalledTimes(1)
    expect(ungroup).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(2)
    expect(layout).toHaveBeenCalledTimes(1)

    handler(keyboardEvent("d", { altKey: true, metaKey: true }))
    handler(keyboardEvent("g", { altKey: true, ctrlKey: true }))
    handler(keyboardEvent("0", { ctrlKey: true, shiftKey: true }))
    handler(keyboardEvent("f", { altKey: true, ctrlKey: true, shiftKey: true }))

    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(group).toHaveBeenCalledTimes(1)
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(layout).toHaveBeenCalledTimes(1)
  })
})
