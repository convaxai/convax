import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { AppearanceSettings } from "./appearance-settings"
import { defaultAppearancePreferences } from "./appearance-preferences"

describe("AppearanceSettings", () => {
  test("renders compact theme and accent selectors plus accessibility preferences", () => {
    const markup = renderToStaticMarkup(
      <AppearanceSettings
        locale="en"
        onChange={() => undefined}
        preferences={{ ...defaultAppearancePreferences, highContrast: true, theme: "midnight" }}
        saveState="saved"
      />,
    )

    expect(markup).toContain('data-appearance-settings="true"')
    expect(markup.match(/role="combobox"/g)).toHaveLength(2)
    expect(markup).toContain('data-appearance-theme-select=""')
    expect(markup).toContain('data-appearance-accent-select=""')
    expect(markup).toContain("Midnight")
    expect(markup).toContain("Purple")
    expect(markup).not.toContain('role="radiogroup"')
    expect(markup).toContain('role="switch"')
    expect(markup.match(/data-slot="settings-row"/g)).toHaveLength(4)
    expect(markup.match(/data-slot="switch"/g)).toHaveLength(2)
    expect(markup).toContain("Saved automatically")
    expect(markup).not.toContain("localStorage")
  })

  test("reports a passive persistence error without disabling the controlled choices", () => {
    const markup = renderToStaticMarkup(
      <AppearanceSettings
        locale="en"
        onChange={() => undefined}
        preferences={defaultAppearancePreferences}
        saveState="error"
      />,
    )

    expect(markup).toContain("Could not save")
    expect(markup).not.toContain(' disabled=""')
  })

  test("localizes appearance controls instead of mixing English copy into Chinese settings", () => {
    const markup = renderToStaticMarkup(
      <AppearanceSettings
        locale="zh-CN"
        onChange={() => undefined}
        preferences={defaultAppearancePreferences}
      />,
    )

    expect(markup).toContain("主题与颜色")
    expect(markup).toContain("一套主题同时作用于应用窗口")
    expect(markup).not.toContain("One theme applies")
  })

  test("reveals native and hexadecimal controls only for a custom accent", () => {
    const customMarkup = renderToStaticMarkup(
      <AppearanceSettings
        locale="en"
        onChange={() => undefined}
        preferences={{ ...defaultAppearancePreferences, accent: "custom", customAccent: "#22dd66" }}
      />,
    )
    const presetMarkup = renderToStaticMarkup(
      <AppearanceSettings locale="en" onChange={() => undefined} preferences={defaultAppearancePreferences} />,
    )

    expect(customMarkup).toContain('type="color"')
    expect(customMarkup).toContain('type="text"')
    expect(customMarkup).toContain('value="#22dd66"')
    expect(presetMarkup).not.toContain('type="color"')
  })

  test("emits one complete preference snapshot through the shared accessibility switch", async () => {
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
    const onChange = mock(() => undefined)
    let root: Root | undefined

    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(<AppearanceSettings locale="en" onChange={onChange} preferences={defaultAppearancePreferences} />),
      )
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Increase contrast"]')?.click(),
      )

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({
        ...defaultAppearancePreferences,
        highContrast: true,
      })
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
