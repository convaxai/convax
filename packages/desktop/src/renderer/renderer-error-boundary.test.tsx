import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { RendererErrorBoundary } from "./renderer-error-boundary"

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

  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function MaybeBroken({ broken }: { broken: boolean }) {
  if (broken) throw new Error("renderer exploded")
  return <div data-testid="healthy">Healthy surface</div>
}

test("isolates renderer failures until an explicit retry or scope change", async () => {
  const restoreWindow = installTestWindow()
  const onError = mock(() => undefined)
  let root: Root | undefined
  let broken = true
  let resetKey = "project-a:canvas-a"

  const renderApp = () => (
    <div>
      <span data-testid="outside">Outside surface</span>
      <RendererErrorBoundary
        name="test surface"
        onError={onError}
        renderFallback={({ retry }) => (
          <div role="alert">
            Failed surface
            <button onClick={retry} type="button">
              Retry
            </button>
          </div>
        )}
        resetKey={resetKey}
      >
        <MaybeBroken broken={broken} />
      </RendererErrorBoundary>
    </div>
  )

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, { onCaughtError: () => undefined })

    await act(async () => root?.render(renderApp()))
    expect(document.querySelector('[data-testid="outside"]')?.textContent).toBe("Outside surface")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Failed surface")
    expect(onError).toHaveBeenCalledTimes(1)

    broken = false
    await act(async () => root?.render(renderApp()))
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="healthy"]')).toBeNull()

    await act(async () => document.querySelector<HTMLButtonElement>("button")?.click())
    expect(document.querySelector('[data-testid="healthy"]')?.textContent).toBe("Healthy surface")

    broken = true
    await act(async () => root?.render(renderApp()))
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(onError).toHaveBeenCalledTimes(2)

    broken = false
    resetKey = "project-a:canvas-b"
    await act(async () => root?.render(renderApp()))
    expect(document.querySelector('[data-testid="healthy"]')?.textContent).toBe("Healthy surface")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
