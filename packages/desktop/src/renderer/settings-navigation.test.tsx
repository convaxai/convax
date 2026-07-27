import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { Palette, Settings2 } from "lucide-react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { filterSettingsNavigationItems, SettingsNavigation, type SettingsNavigationEntry } from "./settings-navigation"

const items = [
  {
    description: "Language and local preferences",
    icon: <Settings2 />,
    label: "General",
    value: "general",
  },
  {
    description: "App and Canvas themes",
    icon: <Palette />,
    label: "Appearance",
    value: "appearance",
  },
] as const satisfies readonly SettingsNavigationEntry<"general" | "appearance">[]

describe("SettingsNavigation", () => {
  test("renders searchable, current-page navigation without dialog semantics", async () => {
    const markup = renderToStaticMarkup(
      <SettingsNavigation
        ariaLabel="Settings"
        emptyLabel="No matching settings"
        items={items}
        onValueChange={() => undefined}
        searchLabel="Search settings"
        value="appearance"
      />,
    )

    expect(markup).toContain('type="text"')
    expect(markup).toContain('role="searchbox"')
    expect(markup).toContain('aria-label="Search settings"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('data-settings-navigation-item="appearance"')
    expect(markup).toContain("bg-interactive-selected")
    expect(markup).toContain("hover:bg-interactive-hover")
    expect(markup).toContain("convax-settings-search__input")
    expect(markup).not.toContain("pl-9")
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const searchInputRule =
      styles.match(/\.convax-settings-search__input \{[^}]+\}/s)?.[0] ?? ""
    expect(searchInputRule).toContain("padding-inline-start: 2.25rem")
    expect(markup).not.toContain("webkit-search-decoration")
    expect(markup).not.toContain('role="dialog"')
  })

  test("filters labels and descriptions case-insensitively while preserving source order", () => {
    expect(filterSettingsNavigationItems(items, "canvas")).toEqual([items[1]])
    expect(filterSettingsNavigationItems(items, "GENERAL")).toEqual([items[0]])
    expect(filterSettingsNavigationItems(items, "   ")).toBe(items)
    expect(filterSettingsNavigationItems(items, "billing")).toEqual([])
  })

  test("moves focus predictably between filtered category rows", async () => {
    const testWindow = new Window({ url: "https://convax.test/" })
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      document: testWindow.document,
      window: testWindow,
    })
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined

    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <SettingsNavigation
            ariaLabel="Settings"
            emptyLabel="No matching settings"
            items={items}
            onValueChange={() => undefined}
            searchLabel="Search settings"
            value="general"
          />,
        ),
      )
      const general = container.querySelector<HTMLButtonElement>('[data-settings-navigation-item="general"]')
      const appearance = container.querySelector<HTMLButtonElement>('[data-settings-navigation-item="appearance"]')
      general?.focus()

      await act(async () => {
        general?.dispatchEvent(
          new testWindow.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }) as unknown as Event,
        )
      })
      expect(document.activeElement).toBe(appearance)

      await act(async () => {
        appearance?.dispatchEvent(
          new testWindow.KeyboardEvent("keydown", { bubbles: true, key: "Home" }) as unknown as Event,
        )
      })
      expect(document.activeElement).toBe(general)
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
        document: previousDocument,
        window: previousWindow,
      })
    }
  })
})
