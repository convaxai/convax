import { describe, expect, mock, test } from "bun:test"

import {
  canRunCanvasShortcutCommand,
  resolveCanvasTidyShortcutScope,
  runCanvasShortcutCommand,
  type CanvasShortcutActions,
  type CanvasShortcutCommand,
} from "./use-canvas-shortcuts"

function shortcutActions(overrides: Partial<CanvasShortcutActions> = {}): CanvasShortcutActions {
  const noop = () => undefined
  return {
    addNode: noop,
    clearSelection: noop,
    delete: noop,
    duplicate: noop,
    enterGroup: noop,
    fitView: noop,
    generate: noop,
    group: noop,
    hand: noop,
    layout: noop,
    openSearch: noop,
    select: noop,
    selectAll: noop,
    ungroup: noop,
    zoomIn: noop,
    zoomOut: noop,
    ...overrides,
  }
}

describe("Canvas host-routed shortcut commands", () => {
  test("keeps invalid multi-node tidy intent from falling through to the whole Canvas", () => {
    expect(resolveCanvasTidyShortcutScope(false, 0)).toBe("canvas")
    expect(resolveCanvasTidyShortcutScope(false, 1)).toBe("canvas")
    expect(resolveCanvasTidyShortcutScope(true, 1)).toBe("selection")
    expect(resolveCanvasTidyShortcutScope(false, 2)).toBe("selection")
  })

  test("routes every typed command to exactly one existing Canvas operation", () => {
    const calls: CanvasShortcutCommand[] = []
    const actions = shortcutActions({
      addNode: () => calls.push("add-node"),
      clearSelection: () => calls.push("clear-selection"),
      delete: () => calls.push("delete"),
      duplicate: () => calls.push("duplicate"),
      enterGroup: () => calls.push("enter-group"),
      fitView: () => calls.push("fit-view"),
      generate: () => calls.push("generate"),
      group: () => calls.push("group"),
      hand: () => calls.push("hand-tool"),
      layout: () => calls.push("layout"),
      openSearch: () => calls.push("open-search"),
      select: () => calls.push("select-tool"),
      selectAll: () => calls.push("select-all"),
      ungroup: () => calls.push("ungroup"),
      zoomIn: () => calls.push("zoom-in"),
      zoomOut: () => calls.push("zoom-out"),
    })
    const commands = [
      "add-node",
      "clear-selection",
      "delete",
      "duplicate",
      "enter-group",
      "fit-view",
      "generate",
      "group",
      "hand-tool",
      "layout",
      "open-search",
      "select-all",
      "select-tool",
      "ungroup",
      "zoom-in",
      "zoom-out",
    ] as const

    for (const command of commands) expect(runCanvasShortcutCommand(command, actions, false)).toBeTrue()
    expect(calls).toEqual(commands)
  })

  test("allows navigation in read-only mode but rejects mutation commands before execution", () => {
    const duplicate = mock(() => undefined)
    const fitView = mock(() => undefined)
    const actions = shortcutActions({ duplicate, fitView })

    expect(runCanvasShortcutCommand("fit-view", actions, true)).toBeTrue()
    expect(runCanvasShortcutCommand("duplicate", actions, true)).toBeFalse()
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(duplicate).not.toHaveBeenCalled()
  })

  test("does not claim conditional tool or group commands without a live action", () => {
    const actions = shortcutActions()
    delete actions.hand
    delete actions.enterGroup

    expect(canRunCanvasShortcutCommand("hand-tool", actions, false)).toBeFalse()
    expect(canRunCanvasShortcutCommand("enter-group", actions, false)).toBeFalse()
    expect(runCanvasShortcutCommand("hand-tool", actions, false)).toBeFalse()
    expect(runCanvasShortcutCommand("enter-group", actions, false)).toBeFalse()
  })
})
