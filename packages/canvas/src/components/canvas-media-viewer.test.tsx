import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { CanvasMediaViewer } from "./canvas-media-viewer"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    MouseEvent: testWindow.MouseEvent,
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

describe("CanvasMediaViewer", () => {
  test("renders an image as contained media in a full-screen dialog", () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaViewer
        height={1200}
        kind="image"
        label="Portrait"
        onOpenChange={() => undefined}
        open
        url="asset://portrait"
        width={800}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain("bg-black/55")
    expect(markup).toContain("backdrop-blur-sm")
    expect(markup).toContain("backdrop:bg-transparent")
    expect(markup).toContain('data-canvas-media-viewer="image"')
    expect(markup).toContain('src="asset://portrait"')
    expect(markup).toContain("object-contain")
    expect(markup).toContain('aria-label="Close full-screen viewer"')
    expect(markup).not.toContain("object-cover")
  })

  test("renders a video with native playback controls and its poster", () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaViewer
        kind="video"
        label="Launch clip"
        onOpenChange={() => undefined}
        open
        posterUrl="asset://launch-poster"
        url="asset://launch"
      />,
    )

    expect(markup).toContain('data-canvas-media-viewer="video"')
    expect(markup).toContain('aria-label="Launch clip"')
    expect(markup).toContain('poster="asset://launch-poster"')
    expect(markup).toContain('src="asset://launch"')
    expect(markup).toContain("controls")
    expect(markup).toContain("object-contain")
    expect(markup).not.toContain("object-cover")
  })

  test("renders no overlay while closed", () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaViewer
        kind="image"
        label="Portrait"
        onOpenChange={() => undefined}
        open={false}
        url="asset://portrait"
      />,
    )

    expect(markup).toBe("")
  })

  test("closes from the translucent backdrop without closing from media content", async () => {
    const restoreWindow = installTestWindow()
    const onOpenChange = mock(() => undefined)
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined

    try {
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <CanvasMediaViewer kind="image" label="Portrait" onOpenChange={onOpenChange} open url="asset://portrait" />,
        )
      })

      const backdrop = document.querySelector<HTMLButtonElement>("[data-canvas-media-viewer-backdrop]")
      const media = document.querySelector<HTMLElement>('[data-canvas-media-viewer="image"]')
      expect(backdrop).not.toBeNull()
      expect(media).not.toBeNull()

      await act(async () => {
        media?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
      expect(onOpenChange).not.toHaveBeenCalled()

      await act(async () => {
        backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
      expect(onOpenChange).toHaveBeenCalledTimes(1)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })
})
