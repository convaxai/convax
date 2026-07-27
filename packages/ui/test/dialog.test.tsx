import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../src/components/dialog"
import { installTestWindow } from "./test-window"

describe("Dialog", () => {
  test("contains focus, dismisses with Escape, and returns focus", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    let open = true

    function render() {
      root?.render(
        <>
          <button id="origin" type="button">
            Origin
          </button>
          <Dialog
            onOpenChange={(nextOpen) => {
              open = nextOpen
              render()
            }}
            open={open}
          >
            <DialogContent>
              <DialogTitle>Details</DialogTitle>
              <DialogDescription>Project details</DialogDescription>
              <button id="first" type="button">
                First
              </button>
              <DialogClose id="last">Close</DialogClose>
            </DialogContent>
          </Dialog>
        </>,
      )
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      const origin = document.createElement("button")
      document.body.append(origin)
      origin.focus()

      await act(async () => {
        render()
        await Promise.resolve()
      })

      expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true")
      expect(document.activeElement?.id).toBe("first")

      document.querySelector<HTMLButtonElement>("#last")?.focus()
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }))
      })
      expect(document.activeElement?.id).toBe("first")

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await Promise.resolve()
      })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(origin)
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })

  test("keeps non-dismissible dialogs open through backdrop and Escape", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    let closeRequests = 0
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <Dialog dismissible={false} onOpenChange={() => closeRequests += 1} open>
            <DialogContent aria-label="Locked dialog">
              <DialogClose>Close</DialogClose>
            </DialogContent>
          </Dialog>,
        )
        await Promise.resolve()
      })
      const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
      await act(async () => {
        overlay?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      })
      expect(closeRequests).toBe(0)
      expect(document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')?.disabled).toBeTrue()
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })
})
