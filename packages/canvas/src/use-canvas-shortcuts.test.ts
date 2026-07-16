import { describe, expect, mock, test } from "bun:test"
import type { KeyboardEvent } from "react"
import { createCanvasShortcutHandler, type CanvasShortcutActions } from "./use-canvas-shortcuts"

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
  test("activates the selection tool with V", () => {
    const select = mock(() => undefined)
    const event = keyboardEvent("v")

    createCanvasShortcutHandler(shortcutActions({ select }), false)(event)

    expect(select).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  test("keeps command-V assigned to paste", () => {
    const paste = mock(() => undefined)
    const select = mock(() => undefined)

    createCanvasShortcutHandler(shortcutActions({ paste, select }), false)(keyboardEvent("v", { metaKey: true }))

    expect(paste).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
  })
})
