import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { WorkspaceResizeHandle } from "./workspace-resize-handle"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  })) {
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

describe("WorkspaceResizeHandle", () => {
  for (const [edge, expected] of [
    ["end", [-24, 24]],
    ["start", [24, -24]],
  ] as const) {
    test(`maps keyboard arrows through the ${edge} edge`, async () => {
      const restoreWindow = installTestWindow()
      const onResizeBy = mock((_delta: number) => undefined)
      let root: Root | undefined
      try {
        const container = document.createElement("div")
        document.body.append(container)
        root = createRoot(container)
        await act(async () =>
          root?.render(
            <WorkspaceResizeHandle
              edge={edge}
              label="Resize panel"
              maximum={620}
              minimum={300}
              onPointerDown={() => undefined}
              onResizeBy={onResizeBy}
              value={380}
            />,
          ),
        )
        const separator = container.querySelector<HTMLElement>('[role="separator"]')!
        await act(async () => {
          separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }))
          separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }))
        })
        expect(onResizeBy.mock.calls.map(([delta]) => delta)).toEqual([...expected])
      } finally {
        if (root) await act(async () => root?.unmount())
        await restoreWindow()
      }
    })
  }
})
