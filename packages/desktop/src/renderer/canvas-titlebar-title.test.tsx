import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { CanvasTitlebarTitle } from "./canvas-titlebar-title"

describe("CanvasTitlebarTitle", () => {
  test("renders a quiet title with an explicit rename action", () => {
    const markup = renderToStaticMarkup(<CanvasTitlebarTitle name="Canvas 1" onRename={() => undefined} />)

    expect(markup).toContain(">Canvas 1</span>")
    expect(markup).toContain('aria-label="Rename Canvas 1"')
    expect(markup).toContain("lucide-pencil")
    expect(markup).not.toContain("shadow")
  })

  test("commits a trimmed inline rename", async () => {
    const testWindow = new Window({ url: "https://convax.test/" })
    const globals = {
      Event: testWindow.Event,
      HTMLElement: testWindow.HTMLElement,
      HTMLInputElement: testWindow.HTMLInputElement,
      Node: testWindow.Node,
      document: testWindow.document,
      window: testWindow,
    }
    const originals = new Map<string, PropertyDescriptor | undefined>()
    for (const [name, value] of Object.entries(globals)) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
      Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
    }
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true })
    const onRename = mock(async () => undefined)
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<CanvasTitlebarTitle name="Canvas 1" onRename={onRename} />))
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rename Canvas 1"]')?.click())
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Canvas name"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "  Story map  ")
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
      await act(async () =>
        container.querySelector<HTMLFormElement>('form[aria-label="Rename Canvas"]')?.requestSubmit(),
      )
      expect(onRename).toHaveBeenCalledWith("Story map")
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.happyDOM.close()
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
    }
  })
})
