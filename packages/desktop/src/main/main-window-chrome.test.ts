import { describe, expect, test } from "bun:test"
import { resolveMainWindowChrome, setNativeMainWindowControlsVisible } from "./main-window-chrome"

describe("main window chrome", () => {
  test("extends the macOS content beneath the application titlebar", () => {
    expect(resolveMainWindowChrome("darwin")).toEqual({
      titleBarStyle: "hidden",
    })
  })

  test("keeps native chrome defaults on other platforms", () => {
    expect(resolveMainWindowChrome("win32")).toEqual({})
    expect(resolveMainWindowChrome("linux")).toEqual({})
  })

  test("changes native traffic-light visibility only on macOS", () => {
    const calls: boolean[] = []
    const window = { setWindowButtonVisibility: (visible: boolean) => calls.push(visible) }

    setNativeMainWindowControlsVisible("darwin", window, false)
    setNativeMainWindowControlsVisible("darwin", window, true)
    setNativeMainWindowControlsVisible("win32", window, false)

    expect(calls).toEqual([false, true])
  })
})
