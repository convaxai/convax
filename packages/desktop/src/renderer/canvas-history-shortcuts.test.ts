import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"

import { createWorkspaceCanvasHistoryShortcutHandler } from "./canvas-history-shortcuts"

test("routes workspace history shortcuts only when focus is outside Canvas and editable surfaces", async () => {
  const window = new Window()
  const document = window.document
  const undo = mock(async () => undefined)
  const redo = mock(async () => undefined)
  const onError = mock(() => undefined)
  const handler = createWorkspaceCanvasHistoryShortcutHandler({ onError, session: { redo, undo } })
  const previousHTMLElement = globalThis.HTMLElement
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: window.HTMLElement,
    writable: true,
  })
  window.addEventListener("keydown", handler as never)

  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }))
  document.body.dispatchEvent(
    new window.KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true, shiftKey: true }),
  )

  const canvas = document.createElement("div")
  canvas.className = "convax-canvas"
  document.body.append(canvas)
  canvas.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }))

  const input = document.createElement("input")
  document.body.append(input)
  input.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }))
  await Promise.resolve()

  expect(undo).toHaveBeenCalledTimes(1)
  expect(redo).toHaveBeenCalledTimes(1)
  expect(onError).not.toHaveBeenCalled()
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: previousHTMLElement,
    writable: true,
  })
})
