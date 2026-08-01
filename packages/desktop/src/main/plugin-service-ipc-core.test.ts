import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceIpcChannels,
  pluginServiceStatusSchema,
  type PluginServiceStatus,
} from "../plugin-service-contracts"
import {
  parsePluginServiceCheckoutTarget,
  parsePluginServiceTarget,
  PluginServiceIpcOperations,
  publishPluginServiceChangeToTargets,
  registerPluginServiceIpcCore,
  type PluginServiceExecutor,
} from "./plugin-service-ipc-core"

class TestSender {
  readonly #listeners = new Set<() => void>()
  constructor(readonly id: number) {}
  once(event: "destroyed", listener: () => void) {
    if (event === "destroyed") this.#listeners.add(listener)
  }
  removeListener(event: "destroyed", listener: () => void) {
    if (event === "destroyed") this.#listeners.delete(listener)
  }
  destroy() {
    for (const listener of this.#listeners) listener()
    this.#listeners.clear()
  }
  listenerCount() {
    return this.#listeners.size
  }
}

function waitForAbort(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

const status: PluginServiceStatus = {
  account: { availability: "unavailable" },
  billing: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "unavailable" },
  plan: { availability: "unavailable" },
  schema: pluginServiceStatusSchema,
  state: "connected",
  usage: { availability: "unavailable" },
}

function executor(overrides: Partial<PluginServiceExecutor> = {}): PluginServiceExecutor {
  return {
    authorize: mock(async () => status),
    cancelAuthorization: mock(async () => status),
    checkout: mock(async () => status),
    getStatus: mock(async () => status),
    listServices: mock(async () => []),
    reauthorize: mock(async () => status),
    signOut: mock(async () => status),
    ...overrides,
  }
}

describe("Plugin service IPC boundary", () => {
  test("publishes inventory invalidation only to live renderer targets", () => {
    const delivered: string[] = []
    const target = (windowDestroyed: boolean, webContentsDestroyed: boolean) => ({
      isDestroyed: () => windowDestroyed,
      webContents: {
        isDestroyed: () => webContentsDestroyed,
        send: (channel: string) => delivered.push(channel),
      },
    })

    publishPluginServiceChangeToTargets([target(false, false), target(true, false), target(false, true)])

    expect(delivered).toEqual([pluginServiceIpcChannels.changed])
  })

  test("accepts only an exact Plugin id target and defines no generic action channel", () => {
    expect(parsePluginServiceTarget({ pluginId: "account-tools" })).toEqual({ pluginId: "account-tools" })
    expect(() => parsePluginServiceTarget({ pluginId: "account-tools", method: "arbitrary.call" })).toThrow(
      "target is invalid",
    )
    expect(() => parsePluginServiceTarget({ pluginId: "../../secret" })).toThrow("kebab-case")
    expect(Object.values(pluginServiceIpcChannels)).toEqual([
      "plugin-service:authorize",
      "plugin-service:authorization-cancel",
      "plugin-service:checkout",
      "plugin-service:changed",
      "plugin-service:status",
      "plugin-service:list",
      "plugin-service:reauthorize",
      "plugin-service:sign-out",
    ])
  })

  test("accepts only an exact Plugin id and Plan key for Checkout", () => {
    expect(parsePluginServiceCheckoutTarget({ planKey: "pro-monthly", pluginId: "account-tools" })).toEqual({
      planKey: "pro-monthly",
      pluginId: "account-tools",
    })
    expect(() =>
      parsePluginServiceCheckoutTarget({
        checkoutUrl: "https://attacker.example/checkout",
        planKey: "pro-monthly",
        pluginId: "account-tools",
      }),
    ).toThrow("Checkout target is invalid")
    expect(() => parsePluginServiceCheckoutTarget({ planKey: "Pro Monthly", pluginId: "account-tools" })).toThrow(
      "Checkout target is invalid",
    )
  })

  test("scopes duplicate operations and renderer destruction to one sender", async () => {
    const operations = new PluginServiceIpcOperations()
    const owner = new TestSender(1)
    const other = new TestSender(2)
    const first = operations.run(owner, "status\0account-tools", waitForAbort)
    await expect(operations.run(owner, "status\0account-tools", async () => "duplicate")).rejects.toThrow(
      "already active",
    )
    await expect(operations.run(other, "status\0account-tools", async () => "other")).resolves.toBe("other")
    expect(owner.listenerCount()).toBe(1)
    owner.destroy()
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    operations.dispose()
  })

  test("aborts every operation on disposal and fails future work closed", async () => {
    const operations = new PluginServiceIpcOperations()
    const owner = new TestSender(1)
    const first = operations.run(owner, "authorize\0one", waitForAbort)
    const second = operations.run(owner, "authorize\0two", waitForAbort)
    const firstOutcome = first.then(
      () => null,
      (error: unknown) => error,
    )
    const secondOutcome = second.then(
      () => null,
      (error: unknown) => error,
    )
    operations.dispose()
    operations.dispose()
    expect(await firstOutcome).toMatchObject({ name: "AbortError" })
    expect(await secondOutcome).toMatchObject({ name: "AbortError" })
    expect(owner.listenerCount()).toBe(0)
    await expect(operations.run(owner, "status\0one", async () => "no")).rejects.toThrow("disposed")
  })

  test("publishes model/service invalidation after every successful mutation", async () => {
    type Event = { sender: TestSender }
    const handlers = new Map<string, (event: Event, input?: unknown) => unknown>()
    const changes: string[] = []
    const removed: string[] = []
    const dispose = registerPluginServiceIpcCore(
      executor(),
      { isTrustedSender: ({ sender }) => sender.id === 1 },
      {
        handle: (channel, handler) => handlers.set(channel, handler),
        publishChange: () => changes.push(pluginServiceIpcChannels.changed),
        removeHandler: (channel) => {
          removed.push(channel)
          handlers.delete(channel)
        },
      },
    )
    const sender = new TestSender(1)
    const invoke = (channel: string, input: Record<string, unknown> = { pluginId: "account-tools" }) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing handler: ${channel}`)
      return handler({ sender }, input)
    }

    await invoke(pluginServiceIpcChannels.getStatus)
    expect(changes).toEqual([])
    for (const channel of [
      pluginServiceIpcChannels.authorize,
      pluginServiceIpcChannels.reauthorize,
      pluginServiceIpcChannels.cancelAuthorization,
      pluginServiceIpcChannels.signOut,
    ]) {
      await invoke(channel)
    }
    await invoke(pluginServiceIpcChannels.checkout, {
      planKey: "pro-monthly",
      pluginId: "account-tools",
    })
    expect(changes).toEqual(Array.from({ length: 5 }, () => pluginServiceIpcChannels.changed))

    dispose()
    expect(removed).toHaveLength(7)
  })

  test("does not publish a service change when the mutation fails", async () => {
    type Event = { sender: TestSender }
    const handlers = new Map<string, (event: Event, input?: unknown) => unknown>()
    const changes: string[] = []
    const dispose = registerPluginServiceIpcCore(
      executor({
        authorize: mock(async () => {
          throw new Error("authorization failed")
        }),
      }),
      { isTrustedSender: ({ sender }) => sender.id === 1 },
      {
        handle: (channel, handler) => handlers.set(channel, handler),
        publishChange: () => changes.push(pluginServiceIpcChannels.changed),
        removeHandler: (channel) => handlers.delete(channel),
      },
    )
    const handler = handlers.get(pluginServiceIpcChannels.authorize)
    if (!handler) throw new Error("Missing authorize handler")

    await expect(handler({ sender: new TestSender(1) }, { pluginId: "account-tools" })).rejects.toThrow(
      "authorization failed",
    )
    expect(changes).toEqual([])
    dispose()
  })
})
