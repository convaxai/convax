import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Disclosure, DisclosureContent, DisclosureTrigger } from "../src/components/disclosure"
import { installTestWindow } from "./test-window"

describe("Disclosure", () => {
  test("links its trigger and controlled content", () => {
    const markup = renderToStaticMarkup(
      <Disclosure open>
        <DisclosureTrigger>Advanced</DisclosureTrigger>
        <DisclosureContent>Details</DisclosureContent>
      </Disclosure>,
    )

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toMatch(/aria-controls="([^"]+)"/)
    expect(markup).toContain('data-state="open"')
    expect(markup).not.toContain('hidden=""')
  })

  test("reports controlled changes and respects disabled state", async () => {
    const testWindow = installTestWindow()
    let root: Root | undefined
    const changes: boolean[] = []
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <Disclosure onOpenChange={(open) => changes.push(open)} open={false}>
            <DisclosureTrigger>Advanced</DisclosureTrigger>
            <DisclosureContent>Details</DisclosureContent>
          </Disclosure>,
        )
      })
      await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="disclosure-trigger"]')?.click())
      expect(changes).toEqual([true])

      await act(async () => {
        root?.render(
          <Disclosure disabled onOpenChange={(open) => changes.push(open)} open={false}>
            <DisclosureTrigger>Advanced</DisclosureTrigger>
            <DisclosureContent>Details</DisclosureContent>
          </Disclosure>,
        )
      })
      expect(document.querySelector<HTMLButtonElement>('[data-slot="disclosure-trigger"]')?.disabled).toBeTrue()
    } finally {
      if (root) await act(async () => root?.unmount())
      await testWindow.restore()
    }
  })
})
