import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { canvasGroupEmojiOptions } from "../group-appearance"
import { CanvasGroupAppearancePicker, moveCanvasGroupEmojiIndex } from "./group-appearance-picker"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })

  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

describe("Canvas group appearance picker", () => {
  test("renders bounded color and emoji choices with the current values selected", () => {
    const markup = renderToStaticMarkup(
      <CanvasGroupAppearancePicker
        anchor={null}
        appearance={{ color: "green", emoji: "leaf" }}
        onChange={() => {}}
        onClose={() => {}}
      />,
    )

    expect(markup).toContain('aria-label="Group appearance"')
    expect(markup).toContain('aria-label="Folder color"')
    expect(markup).toContain('aria-label="Folder emoji"')
    expect(markup).toContain('data-canvas-group-color="green"')
    expect(markup).toContain('data-ui-folder-glyph=""')
    expect(markup).toContain('data-ui-folder-glyph-size="picker"')
    expect(markup).toContain('aria-label="Leaf" aria-pressed="true"')
    expect(markup).toContain("🍃")
    expect(markup).toContain('aria-label="Peace"')
  })

  test("moves through the emoji grid in every direction and wraps its edges", () => {
    const lastIndex = canvasGroupEmojiOptions.length - 1
    expect(moveCanvasGroupEmojiIndex(0, "ArrowRight")).toBe(1)
    expect(moveCanvasGroupEmojiIndex(0, "ArrowLeft")).toBe(lastIndex)
    expect(moveCanvasGroupEmojiIndex(0, "ArrowDown")).toBe(7)
    expect(moveCanvasGroupEmojiIndex(0, "ArrowUp")).toBe(lastIndex)
    expect(moveCanvasGroupEmojiIndex(lastIndex, "ArrowDown")).toBe(0)
    expect(moveCanvasGroupEmojiIndex(lastIndex - 1, "ArrowDown")).toBe(6)
    expect(moveCanvasGroupEmojiIndex(6, "ArrowUp")).toBe(lastIndex - 1)
    expect(moveCanvasGroupEmojiIndex(12, "Home")).toBe(0)
    expect(moveCanvasGroupEmojiIndex(12, "End")).toBe(lastIndex)
  })

  test("keeps emoji arrow navigation inside the picker instead of moving Canvas nodes", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    let parentKeyDownCount = 0

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <div onKeyDown={() => (parentKeyDownCount += 1)}>
            <CanvasGroupAppearancePicker
              anchor={null}
              appearance={{ color: "default", emoji: "folder" }}
              onChange={() => {}}
              onClose={() => {}}
            />
          </div>,
        )
      })

      const folder = document.querySelector<HTMLButtonElement>('button[aria-label="Folder"]')
      const briefcase = document.querySelector<HTMLButtonElement>('button[aria-label="Briefcase"]')
      expect(document.activeElement).toBe(folder)

      await act(async () => {
        folder?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }))
      })

      expect(document.activeElement).toBe(briefcase)
      expect(parentKeyDownCount).toBe(0)
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })
})
