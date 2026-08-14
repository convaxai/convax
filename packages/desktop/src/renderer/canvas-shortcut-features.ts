import { isCanvasSpacePanningShortcut, type CanvasShortcutCommand } from "@convax/canvas"

import type { CommandShortcut, ShortcutChord, ShortcutRegistration } from "./scoped-shortcut-service"

export const canvasShortcutFeatureIds = Object.freeze([
  "canvas.fit-view",
  "canvas.zoom-in",
  "canvas.zoom-out",
  "canvas.select-all",
  "canvas.search",
  "canvas.clear-selection",
  "canvas.select-tool",
  "canvas.hand-tool",
  "canvas.group",
  "canvas.ungroup",
  "canvas.duplicate",
  "canvas.generate",
  "canvas.layout",
  "canvas.delete",
  "canvas.add-node",
  "canvas.enter-group",
  "canvas.space-pan",
] as const)

interface CanvasShortcutFeatureInput {
  readonly canRun: (command: CanvasShortcutCommand) => boolean
  readonly platform: string
  readonly run: (command: CanvasShortcutCommand) => void
  readonly scopeId: string
  readonly setSpacePanningHeld: (held: boolean) => void
}

function primaryChord(platform: string, key: string, shift = false): ShortcutChord {
  return platform === "darwin" ? { key, meta: true, shift } : { ctrl: true, key, shift }
}

function commandFeature(
  input: CanvasShortcutFeatureInput,
  id: (typeof canvasShortcutFeatureIds)[number],
  command: CanvasShortcutCommand,
  chords: readonly ShortcutChord[],
): CommandShortcut {
  return {
    chords,
    id,
    isEnabled: () => input.canRun(command),
    kind: "command",
    onTrigger: () => input.run(command),
    scopeId: input.scopeId,
  }
}

export function createCanvasShortcutFeatures(input: CanvasShortcutFeatureInput): readonly ShortcutRegistration[] {
  const primary = (key: string, shift = false) => primaryChord(input.platform, key, shift)
  return [
    commandFeature(input, "canvas.fit-view", "fit-view", [primary("0")]),
    commandFeature(input, "canvas.zoom-in", "zoom-in", [
      primary("="),
      primary("=", true),
      primary("+"),
      primary("+", true),
    ]),
    commandFeature(input, "canvas.zoom-out", "zoom-out", [
      primary("-"),
      primary("-", true),
      primary("_"),
      primary("_", true),
    ]),
    commandFeature(input, "canvas.select-all", "select-all", [primary("a")]),
    commandFeature(input, "canvas.search", "open-search", [primary("f")]),
    commandFeature(input, "canvas.clear-selection", "clear-selection", [{ key: "Escape" }]),
    commandFeature(input, "canvas.select-tool", "select-tool", [{ key: "v" }]),
    commandFeature(input, "canvas.hand-tool", "hand-tool", [{ key: "h" }]),
    commandFeature(input, "canvas.group", "group", [primary("g")]),
    commandFeature(input, "canvas.ungroup", "ungroup", [primary("g", true)]),
    commandFeature(input, "canvas.duplicate", "duplicate", [primary("d")]),
    commandFeature(input, "canvas.generate", "generate", [primary("Enter")]),
    commandFeature(input, "canvas.layout", "layout", [{ alt: true, key: "f", shift: true }]),
    commandFeature(input, "canvas.delete", "delete", [{ key: "Backspace" }, { key: "Delete" }]),
    commandFeature(input, "canvas.add-node", "add-node", [{ key: "Tab" }]),
    commandFeature(input, "canvas.enter-group", "enter-group", [{ key: "Enter" }]),
    {
      chords: [{ code: "Space" }],
      id: "canvas.space-pan",
      isEnabled: isCanvasSpacePanningShortcut,
      kind: "hold",
      onHold: () => input.setSpacePanningHeld(true),
      onRelease: () => input.setSpacePanningHeld(false),
      releaseOnAnyOtherKey: true,
      scopeId: input.scopeId,
    },
  ]
}
