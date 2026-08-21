import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceIpcChannels,
  pluginServiceStatusSchema,
  pluginServiceUsageSchema,
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

const target = { pluginId: "account-tools", serviceId: "account-tools" }

function executor(overrides: Partial<PluginServiceExecutor> = {}): PluginServiceExecutor {
  return {
    authorize: mock(async () => status),
    cancelAuthorization: mock(async () => status),
    checkout: mock(async () => status),
    getStatus: mock(async () => status),
    getUsageHistory: mock(async () => ({ availability: "unavailable" as const, schema: pluginServiceUsageSchema })),
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

  test("accepts only an exact Plugin and Service target and defines no generic action channel", () => {
    expect(parsePluginServiceTarget(target)).toEqual(target)
    expect(() => parsePluginServiceTarget({ ...target, method: "arbitrary.call" })).toThrow("target is invalid")
    expect(() => parsePluginServiceTarget({ ...target, pluginId: "../../secret" })).toThrow("kebab-case")
    expect(() => parsePluginServiceTarget({ ...target, serviceId: "Not Kebab" })).toThrow("kebab-case")
    expect(Object.values(pluginServiceIpcChannels)).toEqual([
      "plugin-service:authorize",
      "plugin-service:authorization-cancel",
      "plugin-service:checkout",
      "plugin-service:changed",
      "plugin-service:status",
      "plugin-service:usage-history",
      "plugin-service:list",
      "plugin-service:reauthorize",
      "plugin-service:sign-out",
    ])
  })

  test("accepts only an exact Plugin id and Plan key for Checkout", () => {
    expect(parsePluginServiceCheckoutTarget({ ...target, planKey: "pro-monthly" })).toEqual({
      planKey: "pro-monthly",
      pluginId: "account-tools",
      serviceId: "account-tools",
    })
    expect(() =>
      parsePluginServiceCheckoutTarget({
        checkoutUrl: "https://attacker.example/checkout",
        planKey: "pro-monthly",
        pluginId: "account-tools",
        serviceId: "account-tools",
      }),
    ).toThrow("Checkout target is invalid")
    expect(() => parsePluginServiceCheckoutTarget({ ...target, planKey: "Pro Monthly" })).toThrow(
      "Checkout target is invalid",
    )
  })

  test("scopes duplicate operations and renderer destruction to one sender", async () => {
    const operations = new PluginServiceIpcOperations()
    const owner = new TestSender(1)
    const other = new TestSender(2)
    const first = operations.run(owner, "authorize\0account-tools", waitForAbort)
    await expect(operations.run(owner, "authorize\0account-tools", async () => "duplicate")).rejects.toThrow(
      "already active",
    )
    await expect(operations.run(other, "authorize\0account-tools", async () => "other")).resolves.toBe("other")
    expect(owner.listenerCount()).toBe(1)
    owner.destroy()
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    operations.dispose()
  })

  test("joins duplicate read operations for one sender and aborts the shared request on destruction", async () => {
    const operations = new PluginServiceIpcOperations()
    const owner = new TestSender(1)
    const operation = mock(waitForAbort)

    const first = operations.runShared(owner, "status\0account-tools", operation)
    const second = operations.runShared(owner, "status\0account-tools", operation)

    expect(second).toBe(first)
    await Promise.resolve()
    expect(operation).toHaveBeenCalledTimes(1)
    const firstOutcome = first.then(
      () => null,
      (error: unknown) => error,
    )
    const secondOutcome = second.then(
      () => null,
      (error: unknown) => error,
    )
    owner.destroy()
    expect(await firstOutcome).toMatchObject({ name: "AbortError" })
    expect(await secondOutcome).toMatchObject({ name: "AbortError" })
    operations.dispose()
  })

  test("coalesces duplicate status IPC calls without coalescing service mutations", async () => {
    type Event = { sender: TestSender }
    const handlers = new Map<string, (event: Event, input?: unknown) => unknown>()
    const getStatus = mock(async (_target: typeof target, signal?: AbortSignal) => {
      if (!signal) throw new Error("Missing status signal")
      return waitForAbort(signal)
    })
    const authorize = mock(async (_target: typeof target, signal?: AbortSignal) => {
      if (!signal) throw new Error("Missing authorization signal")
      return waitForAbort(signal)
    })
    const dispose = registerPluginServiceIpcCore(
      executor({ authorize, getStatus }),
      { isTrustedSender: () => true },
      {
        handle: (channel, handler) => handlers.set(channel, handler),
        publishChange: () => undefined,
        removeHandler: (channel) => handlers.delete(channel),
      },
    )
    const sender = new TestSender(1)
    const input = target
    const statusHandler = handlers.get(pluginServiceIpcChannels.getStatus)
    const authorizeHandler = handlers.get(pluginServiceIpcChannels.authorize)
    if (!statusHandler || !authorizeHandler) throw new Error("Missing service handler")

    const firstStatus = statusHandler({ sender }, input) as Promise<PluginServiceStatus>
    const secondStatus = statusHandler({ sender }, input) as Promise<PluginServiceStatus>
    const siblingStatus = statusHandler(
      { sender },
      { pluginId: "account-tools", serviceId: "video-generation" },
    ) as Promise<PluginServiceStatus>
    await Promise.resolve()
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenNthCalledWith(
      2,
      { pluginId: "account-tools", serviceId: "video-generation" },
      expect.any(AbortSignal),
    )

    const firstAuthorization = authorizeHandler({ sender }, input) as Promise<PluginServiceStatus>
    await Promise.resolve()
    await expect(authorizeHandler({ sender }, input)).rejects.toThrow("already active")
    expect(authorize).toHaveBeenCalledTimes(1)

    const firstStatusOutcome = firstStatus.then(
      () => null,
      (error: unknown) => error,
    )
    const secondStatusOutcome = secondStatus.then(
      () => null,
      (error: unknown) => error,
    )
    const siblingStatusOutcome = siblingStatus.then(
      () => null,
      (error: unknown) => error,
    )
    const authorizationOutcome = firstAuthorization.then(
      () => null,
      (error: unknown) => error,
    )
    sender.destroy()
    expect(await firstStatusOutcome).toMatchObject({ name: "AbortError" })
    expect(await secondStatusOutcome).toMatchObject({ name: "AbortError" })
    expect(await siblingStatusOutcome).toMatchObject({ name: "AbortError" })
    expect(await authorizationOutcome).toMatchObject({ name: "AbortError" })
    dispose()
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
    const invoke = (channel: string, input: Record<string, unknown> = target) => {
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
      serviceId: "account-tools",
    })
    expect(changes).toEqual(Array.from({ length: 5 }, () => pluginServiceIpcChannels.changed))

    dispose()
    expect(removed).toHaveLength(8)
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

    await expect(handler({ sender: new TestSender(1) }, target)).rejects.toThrow("authorization failed")
    expect(changes).toEqual([])
    dispose()
  })
})
