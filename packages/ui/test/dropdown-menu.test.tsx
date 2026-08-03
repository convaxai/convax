import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../src/components/dropdown-menu"
import { installTestWindow } from "./test-window"

describe("DropdownMenu", () => {
  test("renders one menu trigger with the correct closed semantics", () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Add item">+</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Add file</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    expect(markup).toContain('data-slot="dropdown-menu-trigger"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('data-state="closed"')
  })

  test("opens from the trigger and reports the state change", async () => {
    const testWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    const onOpenChange = mock(() => undefined)
    let root: Root | undefined

    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <DropdownMenu onOpenChange={onOpenChange}>
            <DropdownMenuTrigger aria-label="Add item">+</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Add file</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>,
        ),
      )

      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Add item"]')!
      await act(async () => {
        trigger.click()
      })
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
      expect(onOpenChange).toHaveBeenLastCalledWith(true)
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await testWindow.restore()
    }
  })
})
