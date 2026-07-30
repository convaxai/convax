import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectSidebarTrigger } from "./project-sidebar-trigger"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const frames = new Map<ReturnType<typeof testWindow.requestAnimationFrame>, (timestamp: number) => void>()
  testWindow.requestAnimationFrame = (callback) => {
    const frameId = setImmediate(() => undefined)
    clearImmediate(frameId)
    frames.set(frameId, callback)
    return frameId
  }
  testWindow.cancelAnimationFrame = (frameId) => {
    frames.delete(frameId)
  }
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
  return {
    restore: async () => {
      await testWindow.happyDOM.close()
      for (const [name, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
    runFrames: () => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(performance.now())
    },
  }
}

describe("ProjectSidebarTrigger", () => {
  test("opens from a quiet titlebar entry without rendering floating chrome", () => {
    const markup = renderToStaticMarkup(<ProjectSidebarTrigger onOpen={mock(() => undefined)} />)

    expect(markup).toContain("data-project-sidebar-entry")
    expect(markup).toContain('aria-label="Open project sidebar"')
    expect(markup).not.toContain("shadow")
    expect(markup).not.toContain(">Project</span>")
    expect(markup).toContain('title="Open Project"')
    expect(markup).not.toContain("writing-mode")
    expect(markup).not.toContain("h-full")
  })

  test("does not reopen from the pointer release that just collapsed the sidebar", async () => {
    const testWindow = installTestWindow()
    const onOpen = mock(() => undefined)
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<ProjectSidebarTrigger onOpen={onOpen} />))
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open project sidebar"]')!

      act(() => button.click())
      expect(onOpen).not.toHaveBeenCalled()

      await act(async () => testWindow.runFrames())
      act(() => button.click())
      expect(onOpen).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })

  test("keeps Project identity stable while exposing the pinned sidebar state", () => {
    const markup = renderToStaticMarkup(
      <ProjectSidebarTrigger label="Atlas" onClose={() => undefined} onOpen={() => undefined} open />,
    )

    expect(markup).not.toContain(">Atlas</span>")
    expect(markup).toContain('title="Close Atlas"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-label="Close project sidebar"')
    expect(markup).toContain("lucide-panel-left-close")
    expect(markup).not.toContain("bg-surface-raised")
  })
})
