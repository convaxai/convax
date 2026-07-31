import { describe, expect, mock, test } from "bun:test"
import type { ActiveInstalledWebPluginSummary, WebPluginInventory } from "../plugin-contracts"
import { combineInstalledPluginInventoryChanges, subscribeInstalledPluginInventory } from "./installed-plugin-inventory"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
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

  test("clears the authoritative inventory before reporting a current refresh failure", async () => {
    const initial = deferred<WebPluginInventory>()
    const failed = deferred<WebPluginInventory>()
    let listener: (() => void) | undefined
    const listPlugins = mock()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => failed.promise)
    const updates: Array<readonly ActiveInstalledWebPluginSummary[]> = []
    const errors: unknown[] = []
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
      (error) => errors.push(error),
    )

    initial.resolve(inventory([{ id: "plugin-stale" } as ActiveInstalledWebPluginSummary]))
    await initial.promise
    await Promise.resolve()
    listener?.()
    const failure = new Error("active set unavailable")
    failed.reject(failure)
    await failed.promise.catch(() => undefined)
    await Promise.resolve()

    expect(updates.map((plugins) => plugins.map((plugin) => plugin.id))).toEqual([["plugin-stale"], []])
    expect(errors).toEqual([failure])
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
