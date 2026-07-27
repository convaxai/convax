import { describe, expect, test } from "bun:test"
import { resolveMainWindowChrome } from "./main-window-chrome"

describe("main window chrome", () => {
  test("places macOS traffic lights inside the application titlebar", () => {
    expect(resolveMainWindowChrome("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 15 },
    })
  })

  test("keeps native chrome defaults on other platforms", () => {
    expect(resolveMainWindowChrome("win32")).toEqual({})
    expect(resolveMainWindowChrome("linux")).toEqual({})
  })
})
