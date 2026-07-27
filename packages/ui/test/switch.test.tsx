import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Switch } from "../src/components/switch"
import { installTestWindow } from "./test-window"

describe("Switch", () => {
  test("renders a semantic controlled switch", () => {
    const markup = renderToStaticMarkup(<Switch aria-label="High contrast" checked />)
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('data-state="checked"')
    expect(markup).toContain("bg-brand")
  })

  test("reports only enabled changes", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    const changes: boolean[] = []
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<Switch checked={false} onCheckedChange={(checked) => changes.push(checked)} />))
      await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="switch"]')?.click())
      expect(changes).toEqual([true])

      await act(async () =>
        root?.render(<Switch checked={false} disabled onCheckedChange={(checked) => changes.push(checked)} />),
      )
      await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="switch"]')?.click())
      expect(changes).toEqual([true])
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })
})
