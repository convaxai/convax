import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CommandMenu, type CommandMenuItem } from "../src/components/command-menu"
import { installTestWindow } from "./test-window"

const items = [
  { id: "open", label: "Open project", shortcut: "⌘O" },
  { disabled: true, id: "locked", label: "Locked command" },
  { id: "settings", keywords: ["preferences"], label: "Open settings" },
] satisfies readonly CommandMenuItem[]

describe("CommandMenu", () => {
  test("supports arrow navigation, Enter, Escape, focus return, and disabled commands", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    let open = true
    const selected: string[] = []
    try {
      const container = document.createElement("div")
      document.body.append(container)
      const origin = document.createElement("button")
      document.body.append(origin)
      origin.focus()
      root = createRoot(container)

      const render = () =>
        root?.render(
          <CommandMenu
            aria-label="Commands"
            items={items}
            onOpenChange={(nextOpen) => {
              open = nextOpen
              render()
            }}
            onSelect={(item) => selected.push(item.id)}
            open={open}
          />,
        )

      await act(async () => {
        render()
        await Promise.resolve()
      })
      const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
      expect(document.activeElement).toBe(input)
      expect(input?.getAttribute("aria-activedescendant")).toContain("open")

      await act(async () => {
        input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }))
      })
      await act(async () => {
        input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
        await Promise.resolve()
      })
      expect(selected).toEqual(["settings"])
      expect(document.querySelector('[data-slot="command-menu"]')).toBeNull()
      expect(document.activeElement).toBe(origin)
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })

  test("shows an empty state and ignores Enter during IME composition", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    const selected: string[] = []
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <CommandMenu
            aria-label="Commands"
            items={items}
            onOpenChange={() => undefined}
            onSelect={(item) => selected.push(item.id)}
            open
            query="not-found"
          />,
        )
        await Promise.resolve()
      })
      const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
      expect(document.querySelector('[data-slot="command-menu-empty"]')?.textContent).toBe("No matching commands")
      await act(async () => {
        input?.dispatchEvent(new Event("compositionstart", { bubbles: true }))
        input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      })
      expect(selected).toEqual([])
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })

  test("closes for Escape without selecting and restores the prior focus", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    let open = true
    const selected: string[] = []
    try {
      const container = document.createElement("div")
      document.body.append(container)
      const origin = document.createElement("button")
      document.body.append(origin)
      origin.focus()
      root = createRoot(container)
      const render = () =>
        root?.render(
          <CommandMenu
            aria-label="Commands"
            items={items}
            onOpenChange={(nextOpen) => {
              open = nextOpen
              render()
            }}
            onSelect={(item) => selected.push(item.id)}
            open={open}
          />,
        )
      await act(async () => {
        render()
        await Promise.resolve()
      })
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await Promise.resolve()
      })
      expect(open).toBeFalse()
      expect(selected).toEqual([])
      expect(document.activeElement).toBe(origin)
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })
})
