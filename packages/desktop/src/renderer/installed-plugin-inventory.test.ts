import { describe, expect, mock, test } from "bun:test"
import type { ActiveInstalledWebPluginSummary, WebPluginInventory } from "../plugin-contracts"
import { combineInstalledPluginInventoryChanges, subscribeInstalledPluginInventory } from "./installed-plugin-inventory"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function inventory(installed: ActiveInstalledWebPluginSummary[]): WebPluginInventory {
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
    const updates: Array<readonly ActiveInstalledWebPluginSummary[]> = []
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
    changed.resolve(inventory([{ id: "plugin-new" } as ActiveInstalledWebPluginSummary]))
    await changed.promise
    await Promise.resolve()
    initial.resolve(inventory([]))
    await initial.promise
    await Promise.resolve()

    expect(updates.map((plugins) => plugins.map((plugin) => plugin.id))).toEqual([["plugin-new"]])
    dispose()
  })

  test("refreshes for both legacy Plugin and Marketplace lifecycle publications", () => {
    const listeners: Array<() => void> = []
    const disposed: string[] = []
    const runtimeChanged = mock(() => undefined)
    const client = combineInstalledPluginInventoryChanges(
      {
        listPlugins: async () => inventory([]),
        onDidChange(listener) {
          listeners[0] = listener
          return () => disposed.push("plugin")
        },
      },
      {
        onDidChange(listener) {
          listeners[1] = listener
          return () => disposed.push("marketplace")
        },
      },
      runtimeChanged,
    )
    const refresh = mock(() => undefined)
    const dispose = client.onDidChange(refresh)

    listeners[0]?.()
    listeners[1]?.()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(runtimeChanged).toHaveBeenCalledTimes(1)
    dispose()
    expect(disposed.sort()).toEqual(["marketplace", "plugin"])
  })
})
