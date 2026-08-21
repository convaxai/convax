import { describe, expect, test } from "bun:test"

import { desktopStartupFailurePageUrl, desktopStartupPageUrl } from "./main-window-startup"

function decodePage(url: string) {
  expect(url.startsWith("data:text/html;charset=utf-8,")).toBe(true)
  return decodeURIComponent(url.slice(url.indexOf(",") + 1))
}

describe("Desktop startup window", () => {
  test("renders one local inert loading document before the application runtime is ready", () => {
    const page = decodePage(desktopStartupPageUrl('Convax <task & "label">'))

    expect(page).toContain("Starting Convax &lt;task &amp; &quot;label&quot;&gt;")
    expect(page).toContain("Preparing your local projects and capabilities…")
    expect(page).toContain("default-src 'none'")
    expect(page).toContain('role="status"')
    expect(page).not.toContain("<script")
    expect(page).not.toMatch(/https?:\/\//u)
  })

  test("replaces indefinite loading with a bounded failure surface", () => {
    const page = decodePage(desktopStartupFailurePageUrl("Convax"))

    expect(page).toContain("Convax could not start")
    expect(page).toContain("Check the terminal for diagnostics")
    expect(page).not.toContain('class="spinner"')
  })
})
