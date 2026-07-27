import { describe, expect, mock, test } from "bun:test"
import type { InstalledWebPluginSummary, WebPluginInventory } from "../plugin-contracts"
import { subscribeInstalledPluginInventory } from "./installed-plugin-inventory"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function inventory(installed: InstalledWebPluginSummary[]): WebPluginInventory {
  return { catalog: [], installed }
}

describe("subscribeInstalledPluginInventory", () => {
  test("does not lose a Plugin change while the initial inventory request is pending", async () => {
    const initial = deferred<WebPluginInventory>()
    const changed = deferred<WebPluginInventory>()
    let listener: (() => void) | undefined
    const listPlugins = mock()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => changed.promise)
    const updates: InstalledWebPluginSummary[][] = []
    const dispose = subscribeInstalledPluginInventory(
      {
        listPlugins,
        onDidChange: (next) => {
          listener = next
          return () => {
            listener = undefined
          }
        },
      },
      (plugins) => updates.push(plugins),
      () => undefined,
    )

    listener?.()
    changed.resolve(inventory([{ id: "plugin-new" } as InstalledWebPluginSummary]))
    await changed.promise
    await Promise.resolve()
    initial.resolve(inventory([]))
    await initial.promise
    await Promise.resolve()

    expect(updates.map((plugins) => plugins.map((plugin) => plugin.id))).toEqual([["plugin-new"]])
    dispose()
  })
})
