import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"

import { ScopedShortcutService, type GestureModifier } from "./scoped-shortcut-service"
import { useShortcutFeature } from "./use-scoped-shortcuts"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
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
    window: testWindow,
  }
}

function Harness({ registration, service }: { registration: GestureModifier | null; service: ScopedShortcutService }) {
  useShortcutFeature(service, registration)
  return <button type="button">Canvas</button>
}

function ReactiveGestureHarness({ service }: { service: ScopedShortcutService }) {
  const [held, setHeld] = useState(false)
  useShortcutFeature(service, {
    chords: [{ key: "Meta", meta: true, shift: true }],
    id: "canvas.drag-media-to-other-apps",
    kind: "gesture-modifier",
    onActivate: () => setHeld(true),
    onRelease: () => setHeld(false),
    scopeId: "canvas",
  })
  return (
    <button data-gesture-held={held ? "true" : "false"} type="button">
      Canvas
    </button>
  )
}

function ReactiveHoldHarness({ service }: { service: ScopedShortcutService }) {
  const [held, setHeld] = useState(false)
  useShortcutFeature(service, {
    chords: [{ code: "Space" }],
    id: "canvas.space-pan",
    kind: "hold",
    onHold: () => setHeld(true),
    onRelease: () => setHeld(false),
    scopeId: "canvas",
  })
  return (
    <button data-hold-active={held ? "true" : "false"} type="button">
      Canvas
    </button>
  )
}

test("commits gesture modifier presentation before the activating keydown returns", async () => {
  const testWindow = installTestWindow()
  const service = new ScopedShortcutService({
    document: document as unknown as Document,
    window: window as unknown as globalThis.Window,
  })
  const scope = service.registerScope({ element: document.body, id: "canvas", kind: "application" })
  const container = document.createElement("div")
  document.body.append(container)
  const root: Root = createRoot(container)

  try {
    await act(async () => root.render(<ReactiveGestureHarness service={service} />))
    const button = container.querySelector("button")!
    button.focus()
    let heldWhenKeydownReturned: string | undefined
    act(() => {
      button.dispatchEvent(
        new testWindow.window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Meta",
          metaKey: true,
          shiftKey: true,
        }) as unknown as Event,
      )
      heldWhenKeydownReturned = button.dataset.gestureHeld
    })

    expect(heldWhenKeydownReturned).toBe("true")
  } finally {
    await act(async () => root.unmount())
    scope.dispose()
    service.dispose()
    container.remove()
    await testWindow.restore()
  }
})

test("commits held shortcut presentation before the activating keydown returns", async () => {
  const testWindow = installTestWindow()
  const service = new ScopedShortcutService({
    document: document as unknown as Document,
    window: window as unknown as globalThis.Window,
  })
  const scope = service.registerScope({ element: document.body, id: "canvas", kind: "application" })
  const container = document.createElement("div")
  document.body.append(container)
  const root: Root = createRoot(container)

  try {
    await act(async () => root.render(<ReactiveHoldHarness service={service} />))
    const button = container.querySelector("button")!
    button.focus()
    let heldWhenKeydownReturned: string | undefined
    act(() => {
      button.dispatchEvent(
        new testWindow.window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "Space",
          key: " ",
        }) as unknown as Event,
      )
      heldWhenKeydownReturned = button.dataset.holdActive
    })

    expect(heldWhenKeydownReturned).toBe("true")
  } finally {
    await act(async () => root.unmount())
    scope.dispose()
    service.dispose()
    container.remove()
    await testWindow.restore()
  }
})

test("releases an active gesture modifier when its hook registration is removed", async () => {
  const testWindow = installTestWindow()
  const service = new ScopedShortcutService({
    document: document as unknown as Document,
    window: window as unknown as globalThis.Window,
  })
  const scope = service.registerScope({ element: document.body, id: "canvas", kind: "application" })
  const onActivate = mock(() => undefined)
  const onRelease = mock(() => undefined)
  const registration: GestureModifier = {
    chords: [{ key: "Meta", meta: true, shift: true }],
    id: "canvas.drag-media-to-other-apps",
    kind: "gesture-modifier",
    onActivate,
    onRelease,
    scopeId: "canvas",
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root: Root = createRoot(container)

  try {
    await act(async () => root.render(<Harness registration={registration} service={service} />))
    const button = container.querySelector("button")!
    button.focus()
    button.dispatchEvent(
      new testWindow.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Meta",
        metaKey: true,
        shiftKey: true,
      }) as unknown as Event,
    )
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onRelease).not.toHaveBeenCalled()

    await act(async () => root.render(<Harness registration={null} service={service} />))

    expect(onRelease).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    scope.dispose()
    service.dispose()
    container.remove()
    await testWindow.restore()
  }
})
