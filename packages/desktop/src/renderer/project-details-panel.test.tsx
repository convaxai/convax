import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProjectDetailsPanel } from "./project-details-panel"

let root: Root | null = null
let container: HTMLDivElement | null = null
let windowInstance: Window
let originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>()

beforeEach(() => {
  windowInstance = new Window()
  const globals = {
    Element: windowInstance.Element,
    Event: windowInstance.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: windowInstance.HTMLElement,
    KeyboardEvent: windowInstance.KeyboardEvent,
    MouseEvent: windowInstance.MouseEvent,
    Node: windowInstance.Node,
    PointerEvent: windowInstance.PointerEvent,
    document: windowInstance.document,
    window: windowInstance,
  }
  originalGlobalDescriptors = new Map()
  for (const [name, value] of Object.entries(globals)) {
    originalGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  container = document.createElement("div")
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  await windowInstance.happyDOM.close()
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe("ProjectDetailsPanel", () => {
  test("switches among owner-provided Resources, Canvases, and Outline views", async () => {
    root = createRoot(container!)
    await act(async () =>
      root?.render(
        <ProjectDetailsPanel
          canvases={<div>Canvas catalog projection</div>}
          mode="overlay"
          onClose={() => undefined}
          onPinnedChange={() => undefined}
          open
          outline={<div>Canvas outline projection</div>}
          pinned={false}
          projectName="Atlas"
          resources={<div>Project file projection</div>}
        />,
      ),
    )

    expect(document.body.textContent).toContain("Project file projection")
    expect(document.body.textContent).not.toContain("Canvas catalog projection")
    await act(async () => document.querySelector<HTMLButtonElement>('[data-project-details-tab="canvases"]')?.click())
    expect(document.body.textContent).toContain("Canvas catalog projection")
    await act(async () => document.querySelector<HTMLButtonElement>('[data-project-details-tab="outline"]')?.click())
    expect(document.body.textContent).toContain("Canvas outline projection")
    expect(document.querySelector('[data-project-details-tab="outline"]')?.getAttribute("aria-selected")).toBe("true")
  })

  test("Escape and outside pointer close temporary panels and return focus", async () => {
    const onClose = mock(() => undefined)
    const trigger = document.createElement("button")
    document.body.append(trigger)
    root = createRoot(container!)
    await act(async () =>
      root?.render(
        <ProjectDetailsPanel
          canvases={null}
          mode="overlay"
          onClose={onClose}
          onPinnedChange={() => undefined}
          open
          outline={null}
          pinned={false}
          projectName="Atlas"
          resources={null}
          returnFocusRef={{ current: trigger }}
        />,
      ),
    )

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)

    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)
    trigger.remove()
  })

  test("makes the sheet modal, traps focus, isolates the workspace, and restores its trigger", async () => {
    const background = document.createElement("div")
    const trigger = document.createElement("button")
    trigger.textContent = "Open details"
    background.append(trigger)
    document.body.append(background)
    trigger.focus()

    function SheetHarness() {
      const [open, setOpen] = useState(true)
      return (
        <ProjectDetailsPanel
          canvases={null}
          mode="sheet"
          onClose={() => setOpen(false)}
          onPinnedChange={() => undefined}
          open={open}
          outline={null}
          pinned={false}
          projectName="Atlas"
          resources={<button type="button">Last resource action</button>}
          returnFocusRef={{ current: trigger }}
        />
      )
    }

    root = createRoot(container!)
    await act(async () => root?.render(<SheetHarness />))

    const panel = document.querySelector<HTMLElement>('[data-project-details-panel="sheet"]')!
    const selectedTab = panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
    const firstFocusable = panel.querySelector<HTMLElement>('button[aria-label="Pin Project Details"]')!
    const lastFocusable = Array.from(panel.querySelectorAll<HTMLElement>("button")).at(-1)!
    expect(panel.getAttribute("role")).toBe("dialog")
    expect(panel.getAttribute("aria-modal")).toBe("true")
    expect(document.activeElement).toBe(selectedTab)
    expect(background.inert).toBe(true)
    expect(background.getAttribute("aria-hidden")).toBe("true")

    lastFocusable.focus()
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })))
    expect(document.activeElement).toBe(firstFocusable)

    firstFocusable.focus()
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true })),
    )
    expect(document.activeElement).toBe(lastFocusable)

    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close Project Details"]')?.click())
    expect(document.querySelector('[data-project-details-panel="sheet"]')).toBeNull()
    expect(background.inert).toBe(false)
    expect(background.getAttribute("aria-hidden")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    background.remove()
  })

  test("a pinned dock ignores temporary dismissal gestures", async () => {
    const onClose = mock(() => undefined)
    root = createRoot(container!)
    await act(async () =>
      root?.render(
        <ProjectDetailsPanel
          canvases={null}
          mode="dock"
          onClose={onClose}
          onPinnedChange={() => undefined}
          open
          outline={null}
          pinned
          projectName="Atlas"
          resources={null}
        />,
      ),
    )

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector("[aria-modal]")).toBeNull()
  })

  test("keeps load failures scoped to the selected owner view", async () => {
    root = createRoot(container!)
    await act(async () =>
      root?.render(
        <ProjectDetailsPanel
          canvases={<div role="alert">Canvas catalog unavailable</div>}
          mode="sheet"
          onClose={() => undefined}
          onPinnedChange={() => undefined}
          open
          outline={<div>Outline remains available</div>}
          pinned={false}
          projectName="Atlas"
          resources={<div role="alert">Files unavailable</div>}
        />,
      ),
    )

    expect(document.body.textContent).toContain("Files unavailable")
    expect(document.body.textContent).not.toContain("Canvas catalog unavailable")
    expect(document.querySelector('[data-project-details-panel="sheet"]')).not.toBeNull()
  })
})
