import { describe, expect, mock, test } from "bun:test"

import { DesktopPluginLocaleStore } from "./plugin-locale-store"

describe("DesktopPluginLocaleStore", () => {
  test("keeps one stable snapshot source and emits only real locale changes", () => {
    const store = new DesktopPluginLocaleStore("en")
    const listener = mock(() => undefined)
    const unsubscribe = store.subscribe(listener)

    expect(store.getSnapshot()).toBe("en")
    expect(store.set("en")).toBe(false)
    expect(store.set("zh-CN")).toBe(true)
    expect(store.getSnapshot()).toBe("zh-CN")
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.set("en")
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
