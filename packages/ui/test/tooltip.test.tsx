import { expect, test } from "bun:test"
import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Tooltip, TooltipProvider } from "../src/components/tooltip"
import { installTestWindow } from "./test-window"

test("closed tooltips do not mount a Popper anchor per trigger", () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      {Array.from({ length: 100 }, (_, index) => (
        <Tooltip key={index} content={`Tooltip ${index}`}>
          <button type="button">Trigger {index}</button>
        </Tooltip>
      ))}
    </TooltipProvider>,
  )

  expect(markup.match(/<button/g)).toHaveLength(100)
  expect(markup).not.toContain("data-state")
  expect(markup).not.toContain('role="tooltip"')
  expect(markup).not.toContain("Tooltip 99")
})

test("a standalone closed tooltip preserves its trigger markup", () => {
  const markup = renderToStaticMarkup(
    <Tooltip content="Delete" side="top">
      <button aria-label="Delete" type="button">
        Delete node
      </button>
    </Tooltip>,
  )

  expect(markup).toContain('aria-label="Delete"')
  expect(markup).toContain("Delete node")
  expect(markup).not.toContain('role="tooltip"')
})

test("many StrictMode triggers share one interactive tooltip surface", async () => {
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
    const renderTooltips = (prefix: string, generation = 0) => (
      <StrictMode>
        <TooltipProvider delayDuration={0}>
          {Array.from({ length: 100 }, (_, index) => (
            <Tooltip key={`${generation}-${index}`} content={`${prefix} ${index}`}>
              <span>
                <button type="button" onPointerDown={(event) => event.stopPropagation()}>
                  Trigger {index}
                </button>
              </span>
            </Tooltip>
          ))}
        </TooltipProvider>
      </StrictMode>
    )

    await act(async () => {
      root?.render(renderTooltips("Tooltip"))
    })

    const triggers = document.querySelectorAll<HTMLButtonElement>("button")
    expect(triggers).toHaveLength(100)
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0)

    const trigger = triggers[42]
    expect(trigger).toBeDefined()
    await act(async () => trigger?.focus())

    const surfaces = document.querySelectorAll<HTMLElement>('[role="tooltip"]')
    expect(surfaces).toHaveLength(1)
    expect(surfaces[0]?.textContent).toBe("Tooltip 42")
    expect(trigger?.getAttribute("aria-describedby")).toBe(surfaces[0]?.id)

    await act(async () => root?.render(renderTooltips("Updated tooltip")))
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.textContent).toBe("Updated tooltip 42")

    await act(async () => trigger?.blur())
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0)

    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }))
      trigger?.focus()
    })
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0)

    await act(async () => root?.render(renderTooltips("Remounted tooltip", 1)))
    const remountedTrigger = document.querySelectorAll<HTMLButtonElement>("button")[42]
    await act(async () => {
      remountedTrigger?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }))
    })
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0)

    await act(async () => root?.unmount())
    root = undefined
    expect(consoleErrors).toEqual([])
  } finally {
    if (root) await act(async () => root?.unmount())
    console.error = originalConsoleError
    await testWindow.restore()
  }
})
