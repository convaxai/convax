import { describe, expect, test } from "bun:test"
import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../src/components/select"
import { installTestWindow } from "./test-window"

describe("Select", () => {
  test("renders a styled select-only combobox with its controlled value", () => {
    const markup = renderToStaticMarkup(
      <Select value="second">
        <SelectTrigger id="example-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="first">First</SelectItem>
          <SelectItem value="second">Second</SelectItem>
        </SelectContent>
      </Select>,
    )

    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('aria-haspopup="listbox"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('data-state="closed"')
    expect(markup).toContain('data-slot="select-value"')
    expect(markup).toContain(">second</span>")
    expect(markup).not.toContain("<select")
  })

  test("disables the trigger from the root", () => {
    const markup = renderToStaticMarkup(
      <Select disabled value="first">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
      </Select>,
    )

    expect(markup).toContain('disabled=""')
  })

  test("keeps many closed triggers out of the Popper callback-ref path", async () => {
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
      await act(async () => {
        root?.render(
          <StrictMode>
            {Array.from({ length: 100 }, (_, index) => (
              <Select key={index} value="first">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">First {index}</SelectItem>
                  <SelectItem value="second">Second {index}</SelectItem>
                </SelectContent>
              </Select>
            ))}
          </StrictMode>,
        )
      })

      const triggers = document.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')
      expect(triggers).toHaveLength(100)
      await act(async () => triggers[42]?.click())
      expect(
        document.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')[42]?.getAttribute("aria-expanded"),
      ).toBe("true")
      expect(consoleErrors).toEqual([])

      await act(async () => root?.unmount())
      root = undefined
    } finally {
      if (root) await act(async () => root?.unmount())
      console.error = originalConsoleError
      await testWindow.restore()
    }
  })
})
