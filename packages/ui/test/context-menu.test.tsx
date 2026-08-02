import { expect, test } from "bun:test"
import { StrictMode, act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../src/components/context-menu"
import { installTestWindow } from "./test-window"

const flatTriggerCount = 128
const nestedTriggerCount = 64

test("keeps many flat and nested virtual anchors bounded across StrictMode rerenders", async () => {
  const testWindow = installTestWindow()
  const originalConsoleError = console.error
  const consoleErrors: string[] = []
  let root: Root | undefined

  console.error = (...values: unknown[]) => {
    consoleErrors.push(values.map((value) => (value instanceof Error ? value.stack : String(value))).join(" "))
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    for (let generation = 0; generation < 8; generation += 1) {
      await act(async () => root?.render(renderContextMenus(generation)))
    }

    const triggers = document.querySelectorAll<HTMLButtonElement>("[data-context-menu-trigger]")
    expect(triggers).toHaveLength(flatTriggerCount + nestedTriggerCount)

    const trigger = document.querySelector<HTMLButtonElement>('[data-context-menu-trigger="flat-42"]')
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 120,
          clientY: 80,
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(trigger?.getAttribute("data-state")).toBe("open")

    for (let generation = 8; generation < 12; generation += 1) {
      await act(async () => root?.render(renderContextMenus(generation)))
    }

    expect(
      document.querySelector<HTMLButtonElement>('[data-context-menu-trigger="flat-42"]')?.getAttribute("data-state"),
    ).toBe("open")
    expect(consoleErrors.filter((message) => message.includes("Maximum update depth exceeded"))).toEqual([])
    expect(consoleErrors).toEqual([])

    await act(async () => root?.unmount())
    root = undefined
  } finally {
    if (root) await act(async () => root?.unmount())
    console.error = originalConsoleError
    await testWindow.restore()
  }
}, 15_000)

function renderContextMenus(generation: number) {
  return (
    <StrictMode>
      <div data-generation={generation}>
        {Array.from({ length: flatTriggerCount }, (_, index) => (
          <ContextMenu key={`flat-${index}`}>
            <ContextMenuTrigger asChild>
              <button data-context-menu-trigger={`flat-${index}`} data-generation={generation} type="button">
                Flat trigger {index}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>Open flat item {index}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {renderNestedContextMenus(generation)}
      </div>
    </StrictMode>
  )
}

function renderNestedContextMenus(generation: number) {
  let nested: ReactNode = null
  for (let index = nestedTriggerCount - 1; index >= 0; index -= 1) {
    nested = (
      <ContextMenu key={`nested-${index}`}>
        <ContextMenuTrigger asChild>
          <button data-context-menu-trigger={`nested-${index}`} data-generation={generation} type="button">
            Nested trigger {index}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Open nested item {index}</ContextMenuItem>
        </ContextMenuContent>
        {nested}
      </ContextMenu>
    )
  }
  return nested
}
