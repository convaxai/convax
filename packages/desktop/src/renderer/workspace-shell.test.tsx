import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkspaceShell } from "./workspace-shell"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    HTMLIFrameElement: testWindow.HTMLIFrameElement,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    PointerEvent: testWindow.PointerEvent,
    document: testWindow.document,
    navigator: testWindow.navigator,
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

function pointer(type: string, pointerId: number) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: pointerId === 1, pointerId })
}

async function nextFrame() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

describe("WorkspaceShell", () => {
  test("keeps the workspace interactive when no blocking surface is active", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked={false}>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain('data-workspace-shell="true"')
    expect(markup).toContain('data-host-pointer-gesture-root="true"')
    expect(markup).toContain(">Canvas</div>")
    expect(markup).not.toContain("aria-hidden")
    expect(markup).not.toContain("inert")
  })

  test("hides and disables the workspace while a blocking surface is active", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked resizing>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain(" inert=")
    expect(markup).toContain("cursor-col-resize")
    expect(markup).toContain("select-none")
    expect(markup).toContain('data-workbench-resizing=""')
  })

  test("keeps the status bar outside the scrollable workspace row", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked={false} statusBar={<footer data-test-status="true">Ready</footer>}>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain("flex-col")
    expect(markup).toContain("min-h-0 flex-1")
    expect(markup).toContain('data-test-status="true"')
    expect(markup.indexOf("Canvas")).toBeLessThan(markup.indexOf("Ready"))
  })

  test("blocks embedded frames for every host-started pointer until all pointers release and one frame passes", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <WorkspaceShell blocked={false}>
            <button data-host-target type="button">Host target</button>
            <iframe data-web-plugin-iframe="" title="Plugin" />
          </WorkspaceShell>,
        ),
      )
      const shell = container.querySelector<HTMLElement>("[data-workspace-shell]")!
      const hostTarget = container.querySelector<HTMLElement>("[data-host-target]")!
      const iframe = container.querySelector<HTMLIFrameElement>("iframe")!
      iframe.focus()
      expect(document.activeElement).toBe(iframe)

      hostTarget.dispatchEvent(pointer("pointerdown", 1))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()
      expect(document.activeElement).not.toBe(iframe)

      hostTarget.dispatchEvent(pointer("pointerdown", 2))
      window.dispatchEvent(pointer("pointerup", 99))
      window.dispatchEvent(pointer("pointerup", 1))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()

      window.dispatchEvent(pointer("pointerup", 2))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()
      await act(nextFrame)
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeFalse()
    } finally {
      await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("releases a host gesture one frame after window blur", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <WorkspaceShell blocked={false}>
            <div data-host-target>Canvas</div>
          </WorkspaceShell>,
        ),
      )
      const shell = container.querySelector<HTMLElement>("[data-workspace-shell]")!
      const target = container.querySelector<HTMLElement>("[data-host-target]")!
      target.dispatchEvent(pointer("pointerdown", 1))
      window.dispatchEvent(new Event("blur"))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()
      await act(nextFrame)
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeFalse()
    } finally {
      await act(async () => root?.unmount())
      await restoreWindow()
    }
  })
})
