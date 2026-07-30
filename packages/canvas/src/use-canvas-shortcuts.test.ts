import { describe, expect, mock, test } from "bun:test"
import type { KeyboardEvent } from "react"
import {
  createCanvasShortcutHandler,
  createCanvasShortcutReleaseHandler,
  resolveCanvasTidyShortcutScope,
  type CanvasShortcutActions,
} from "./use-canvas-shortcuts"

function shortcutActions(overrides: Partial<CanvasShortcutActions> = {}): CanvasShortcutActions {
  const noop = () => undefined
  return {
    addNode: noop,
    armExternalDrag: noop,
    cancelExternalDrag: noop,
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

  test("arms external drag while command/control-shift is held in either key order", () => {
    const armExternalDrag = mock(() => undefined)

    for (const event of [
      keyboardEvent("Shift", { metaKey: true, shiftKey: true }),
      keyboardEvent("Meta", { metaKey: true, shiftKey: true }),
      keyboardEvent("Shift", { ctrlKey: true, shiftKey: true }),
      keyboardEvent("Control", { ctrlKey: true, shiftKey: true }),
    ]) {
      createCanvasShortcutHandler(shortcutActions({ armExternalDrag }), false, {
        canArmExternalDrag: true,
      })(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(event.stopPropagation).not.toHaveBeenCalled()
    }

    expect(armExternalDrag).toHaveBeenCalledTimes(4)
  })

  test("does not arm a held chord when no external drag source is visible", () => {
    const armExternalDrag = mock(() => undefined)
    const event = keyboardEvent("Shift", { metaKey: true, shiftKey: true })

    createCanvasShortcutHandler(shortcutActions({ armExternalDrag }), false, {
      canArmExternalDrag: false,
    })(event)

    expect(armExternalDrag).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test("does not arm command-option-shift", () => {
    const armExternalDrag = mock(() => undefined)
    const event = keyboardEvent("Shift", { altKey: true, metaKey: true, shiftKey: true })

    createCanvasShortcutHandler(shortcutActions({ armExternalDrag }), false, {
      canArmExternalDrag: true,
    })(event)

    expect(armExternalDrag).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test("honors the host-selected primary modifier without claiming the other platform shortcut", () => {
    const armExternalDrag = mock(() => undefined)
    const handler = createCanvasShortcutHandler(shortcutActions({ armExternalDrag }), false, {
      canArmExternalDrag: true,
      externalDragShortcutModifier: "meta",
    })

    handler(keyboardEvent("Shift", { ctrlKey: true, shiftKey: true }))
    handler(keyboardEvent("Shift", { ctrlKey: true, metaKey: true, shiftKey: true }))
    handler(keyboardEvent("Shift", { metaKey: true, shiftKey: true }))

    expect(armExternalDrag).toHaveBeenCalledTimes(1)
  })

  test("escape cancels an armed external drag before clearing selection", () => {
    const cancelExternalDrag = mock(() => undefined)
    const clearSelection = mock(() => undefined)

    createCanvasShortcutHandler(shortcutActions({ cancelExternalDrag, clearSelection }), false, {
      externalDragArmed: true,
    })(keyboardEvent("Escape"))

    expect(cancelExternalDrag).toHaveBeenCalledTimes(1)
    expect(clearSelection).not.toHaveBeenCalled()
  })

  test("releases held external drag on either required modifier key-up", () => {
    const cancelExternalDrag = mock(() => undefined)
    const handler = createCanvasShortcutReleaseHandler(shortcutActions({ cancelExternalDrag }), {
      externalDragArmed: true,
      externalDragShortcutModifier: "meta",
    })

    handler(keyboardEvent("x", { metaKey: true, shiftKey: true }))
    handler(keyboardEvent("Control", { metaKey: true, shiftKey: true }))
    handler(keyboardEvent("Shift", { metaKey: true, shiftKey: true }))
    expect(cancelExternalDrag).not.toHaveBeenCalled()

    handler(keyboardEvent("Shift", { metaKey: true }))
    handler(keyboardEvent("Meta", { shiftKey: true }))
    expect(cancelExternalDrag).toHaveBeenCalledTimes(2)
  })

  test("cancels held drag before preserving a normal command-shift shortcut", () => {
    const cancelExternalDrag = mock(() => undefined)
    const ungroup = mock(() => undefined)
    const event = keyboardEvent("g", { metaKey: true, shiftKey: true })

    createCanvasShortcutHandler(shortcutActions({ cancelExternalDrag, ungroup }), false, {
      canArmExternalDrag: true,
      externalDragArmed: true,
      externalDragShortcutModifier: "meta",
    })(event)

    expect(cancelExternalDrag).toHaveBeenCalledTimes(1)
    expect(ungroup).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  test("keeps the held external drag gesture available while an editable surface retains focus", () => {
    const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement")
    class TestHTMLElement {
      constructor(
        readonly isContentEditable: boolean,
        readonly ignored: boolean,
      ) {}

      closest() {
        return this.ignored ? this : null
      }
    }
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: TestHTMLElement })
    try {
      const armExternalDrag = mock(() => undefined)
      const handler = createCanvasShortcutHandler(shortcutActions({ armExternalDrag }), false, {
        canArmExternalDrag: true,
      })

      for (const target of [new TestHTMLElement(true, false), new TestHTMLElement(false, true)]) {
        handler(
          keyboardEvent("Shift", {
            metaKey: true,
            shiftKey: true,
            target: target as unknown as EventTarget,
          }),
        )
      }

      expect(armExternalDrag).toHaveBeenCalledTimes(2)
    } finally {
      if (originalHTMLElement) Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement)
      else Reflect.deleteProperty(globalThis, "HTMLElement")
    }
  })
})
