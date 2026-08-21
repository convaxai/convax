import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceStatusSchema,
  pluginServiceUsageSchema,
  type PluginServiceClient,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import { writePluginServiceProjection } from "./plugin-service-projection-cache"
import { PluginServicesController } from "./plugin-services-controller"

const summary: PluginServiceSummary = {
  actions: ["sign_out"],
  capabilities: [],
  description: "Account connection",
  llmProviderIds: [],
  models: [],
  pluginId: "account-tools",
  pluginName: "Account Tools",
  serviceId: "account-tools",
  version: "1.0.0",
}

const serviceTarget = { pluginId: "account-tools", serviceId: "account-tools" }

const connected: PluginServiceStatus = {
  account: { availability: "unavailable" },
  billing: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "unavailable" },
  plan: { availability: "unavailable" },
  schema: pluginServiceStatusSchema,
  state: "connected",
  usage: { availability: "unavailable" },
}

const disconnected: PluginServiceStatus = {
  ...connected,
  credential: { configured: false, verification: "unknown" },
  state: "disconnected",
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function client(overrides: Partial<PluginServiceClient> = {}): PluginServiceClient {
  return {
    authorize: mock(async () => connected),
    cancelAuthorization: mock(async () => connected),
    checkout: mock(async () => connected),
    getStatus: mock(async () => connected),
    listServices: mock(async () => [summary]),
    onDidChange: mock(() => () => undefined),
    reauthorize: mock(async () => connected),
    signOut: mock(async () => disconnected),
    ...overrides,
  }
}

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe("PluginServicesController", () => {
  test("uses the selected advertised Plan for the fixed Checkout action", async () => {
    const checkoutStatus: PluginServiceStatus = {
      ...connected,
      billing: {
        availability: "available",
        checkout: {
          availability: "available",
          plans: [{ billingInterval: "month", key: "pro", name: "Pro" }],
        },
      },
      plan: { availability: "available", billingInterval: "month", key: "free", name: "Free" },
    }
    const checkoutSummary = { ...summary, actions: ["checkout", "sign_out"] as const }
    const serviceClient = client({
      checkout: mock(async () => checkoutStatus),
      getStatus: mock(async () => checkoutStatus),
      listServices: mock(async () => [checkoutSummary]),
    })
    const controller = new PluginServicesController(serviceClient)
    await controller.refresh()

    await controller.checkout(serviceTarget, "pro")

    expect(serviceClient.checkout).toHaveBeenCalledWith({ ...serviceTarget, planKey: "pro" })
    await expect(controller.checkout(serviceTarget, "enterprise")).rejects.toThrow("no longer available")
    controller.dispose()
  })

  test("loads installed services and applies only explicitly declared fixed actions", async () => {
    const usageHistory = {
      availability: "available" as const,
      records: [{ amount: 7 }, { amount: 3 }],
      schema: pluginServiceUsageSchema,
      unit: "credits",
    }
    const serviceClient = client({ getUsageHistory: mock(async () => usageHistory) })
    const controller = new PluginServicesController(serviceClient)
    await controller.refresh()

    expect(controller.getSnapshot().services[0]).toMatchObject({
      loading: false,
      pluginId: "account-tools",
      status: connected,
      usageHistory,
    })
    await controller.perform(serviceTarget, "sign_out")
    expect(serviceClient.signOut).toHaveBeenCalledWith(serviceTarget)
    expect(controller.getSnapshot().services[0]?.status).toEqual(disconnected)
    await expect(controller.perform(serviceTarget, "reauthorize")).rejects.toThrow("no longer available")
    expect(serviceClient.reauthorize).not.toHaveBeenCalled()
    controller.dispose()
  })

  test("hydrates the last complete Service projection synchronously and revalidates it in the background", async () => {
    const target = storage()
    expect(
      writePluginServiceProjection(target, {
        services: [{ ...summary, status: connected }],
      }),
    ).toBe(true)
    const pendingStatus = deferred<PluginServiceStatus>()
    const serviceClient = client({ getStatus: mock(async () => pendingStatus.promise) })
    const controller = new PluginServicesController(serviceClient, { storage: target })

    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      services: [{ loading: false, pluginId: "account-tools", status: connected }],
    })

    const refresh = controller.refresh()
    while ((serviceClient.getStatus as ReturnType<typeof mock>).mock.calls.length === 0) await Promise.resolve()
    expect(controller.getSnapshot().services[0]).toMatchObject({ loading: false, status: connected })

    pendingStatus.resolve(disconnected)
    await refresh
    expect(controller.getSnapshot().services[0]).toMatchObject({ loading: false, status: disconnected })
    controller.dispose()
  })

  test("refreshes status and usage concurrently without hiding the last values", async () => {
    const target = storage()
    const previousUsage = {
      availability: "available" as const,
      records: [{ amount: 9 }],
      schema: pluginServiceUsageSchema,
      unit: "credits",
    }
    writePluginServiceProjection(target, {
      services: [{ ...summary, status: connected, usageHistory: previousUsage }],
    })
    const pendingStatus = deferred<PluginServiceStatus>()
    const pendingUsage = deferred<{
      availability: "available"
      records: readonly { amount: number }[]
      schema: typeof pluginServiceUsageSchema
      unit: string
    }>()
    const serviceClient = client({
      getStatus: mock(async () => pendingStatus.promise),
      getUsageHistory: mock(async () => pendingUsage.promise),
    })
    const controller = new PluginServicesController(serviceClient, { storage: target })
    const refresh = controller.refresh()
    while (
      (serviceClient.getStatus as ReturnType<typeof mock>).mock.calls.length === 0 ||
      (serviceClient.getUsageHistory as ReturnType<typeof mock>).mock.calls.length === 0
    ) {
      await Promise.resolve()
    }

    expect(controller.getSnapshot().services[0]).toMatchObject({
      loading: false,
      status: connected,
      usageHistory: previousUsage,
    })
    pendingStatus.resolve(disconnected)
    while (controller.getSnapshot().services[0]?.status !== disconnected) await Promise.resolve()
    expect(controller.getSnapshot().services[0]?.status).toEqual(disconnected)

    pendingUsage.resolve({
      availability: "available",
      records: [{ amount: 2 }],
      schema: pluginServiceUsageSchema,
      unit: "credits",
    })
    await refresh
    expect(controller.getSnapshot().services[0]?.usageHistory).toMatchObject({ records: [{ amount: 2 }] })
    controller.dispose()
  })

  test("clears cached usage after a credential-changing action even when history refresh fails", async () => {
    const target = storage()
    writePluginServiceProjection(target, {
      services: [
        {
          ...summary,
          status: connected,
          usageHistory: {
            availability: "available",
            records: [{ amount: 9 }],
            schema: pluginServiceUsageSchema,
            unit: "credits",
          },
        },
      ],
    })
    const serviceClient = client({
      getUsageHistory: mock(async () => {
        throw new Error("usage unavailable after sign-out")
      }),
    })
    const controller = new PluginServicesController(serviceClient, { storage: target })

    await controller.perform(serviceTarget, "sign_out")

    expect(controller.getSnapshot().services[0]).toMatchObject({ status: disconnected })
    expect(controller.getSnapshot().services[0]?.usageHistory).toBeUndefined()
    const hydrated = new PluginServicesController(serviceClient, { storage: target })
    expect(hydrated.getSnapshot().services[0]?.usageHistory).toBeUndefined()
    hydrated.dispose()
    controller.dispose()
  })

  test("ignores a late status after the Plugin is uninstalled", async () => {
    const pendingStatus = deferred<PluginServiceStatus>()
    let installed: readonly PluginServiceSummary[] = [summary]
    const serviceClient = client({
      getStatus: mock(async () => pendingStatus.promise),
      listServices: mock(async () => installed),
    })
    const controller = new PluginServicesController(serviceClient)
    const first = controller.refresh()
    while ((serviceClient.getStatus as ReturnType<typeof mock>).mock.calls.length === 0) await Promise.resolve()
    installed = []
    const afterUninstall = controller.refresh()
    expect(serviceClient.getStatus).toHaveBeenCalledTimes(1)
    pendingStatus.resolve(connected)
    await Promise.all([first, afterUninstall])

    expect(controller.getSnapshot()).toMatchObject({ loading: false, services: [] })
    controller.dispose()
  })

  test("coalesces concurrent status refreshes and runs one trailing revalidation", async () => {
    const firstStatus = deferred<PluginServiceStatus>()
    const trailingStatus = deferred<PluginServiceStatus>()
    let activeStatuses = 0
    let maximumActiveStatuses = 0
    let requestCount = 0
    const serviceClient = client({
      getStatus: mock(async () => {
        activeStatuses += 1
        maximumActiveStatuses = Math.max(maximumActiveStatuses, activeStatuses)
        try {
          return await (requestCount++ === 0 ? firstStatus.promise : trailingStatus.promise)
        } finally {
          activeStatuses -= 1
        }
      }),
    })
    const controller = new PluginServicesController(serviceClient)

    const first = controller.refresh()
    while ((serviceClient.getStatus as ReturnType<typeof mock>).mock.calls.length === 0) await Promise.resolve()
    const second = controller.refresh()
    const third = controller.refresh()
    expect(serviceClient.getStatus).toHaveBeenCalledTimes(1)

    firstStatus.resolve(disconnected)
    while ((serviceClient.getStatus as ReturnType<typeof mock>).mock.calls.length < 2) await Promise.resolve()
    expect(serviceClient.getStatus).toHaveBeenCalledTimes(2)
    trailingStatus.resolve(connected)
    await Promise.all([first, second, third])

    expect(maximumActiveStatuses).toBe(1)
    expect(controller.getSnapshot().services[0]?.status).toEqual(connected)
    controller.dispose()
  })

  test("refreshes on Plugin change and drops a stale action result after an update", async () => {
    let changed: (() => void) | undefined
    let installed: readonly PluginServiceSummary[] = [summary]
    const signOutResult = deferred<PluginServiceStatus>()
    const serviceClient = client({
      listServices: mock(async () => installed),
      onDidChange: mock((listener) => {
        changed = listener
        return () => {
          changed = undefined
        }
      }),
      signOut: mock(async () => signOutResult.promise),
    })
    const controller = new PluginServicesController(serviceClient)
    controller.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const action = controller.perform(serviceTarget, "sign_out")
    installed = [{ ...summary, version: "2.0.0" }]
    changed?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    signOutResult.resolve(disconnected)
    await action
    while (controller.getSnapshot().services[0]?.loading) await Promise.resolve()

    expect(controller.getSnapshot().services[0]).toMatchObject({ version: "2.0.0", status: connected })
    controller.dispose()
    expect(changed).toBeUndefined()
  })

  test("lets an explicit cancel action supersede a pending browser authorization", async () => {
    const authorization = deferred<PluginServiceStatus>()
    const cancelResult: PluginServiceStatus = {
      ...disconnected,
      state: "attention",
    }
    const authorizationSummary: PluginServiceSummary = {
      ...summary,
      actions: ["authorize", "authorization.cancel"],
    }
    const serviceClient = client({
      authorize: mock(async () => authorization.promise),
      cancelAuthorization: mock(async () => cancelResult),
      getStatus: mock(async () => disconnected),
      listServices: mock(async () => [authorizationSummary]),
    })
    const controller = new PluginServicesController(serviceClient)
    await controller.refresh()

    const pending = controller.perform(serviceTarget, "authorize")
    await Promise.resolve()
    await controller.perform(serviceTarget, "authorization.cancel")
    expect(serviceClient.cancelAuthorization).toHaveBeenCalledWith(serviceTarget)
    expect(controller.getSnapshot().services[0]?.status).toEqual(cancelResult)

    authorization.resolve(connected)
    await pending
    expect(controller.getSnapshot().services[0]?.status).toEqual(cancelResult)
    controller.dispose()
  })

  test("isolates sibling Service actions and results inside one Plugin", async () => {
    const image = { ...summary, serviceId: "image-generation" }
    const video = { ...summary, serviceId: "video-generation" }
    const imageResult = deferred<PluginServiceStatus>()
    const videoResult = deferred<PluginServiceStatus>()
    const serviceClient = client({
      listServices: mock(async () => [image, video]),
      signOut: mock(({ serviceId }) => (serviceId === image.serviceId ? imageResult.promise : videoResult.promise)),
    })
    const controller = new PluginServicesController(serviceClient)
    await controller.refresh()

    const imageTarget = { pluginId: summary.pluginId, serviceId: image.serviceId }
    const videoTarget = { pluginId: summary.pluginId, serviceId: video.serviceId }
    const imageAction = controller.perform(imageTarget, "sign_out")
    const videoAction = controller.perform(videoTarget, "sign_out")
    expect(controller.getSnapshot().actions).toHaveLength(2)

    videoResult.resolve({ ...disconnected, state: "attention" })
    await videoAction
    expect(
      controller.getSnapshot().services.find(({ serviceId }) => serviceId === video.serviceId)?.status?.state,
    ).toBe("attention")
    expect(controller.getSnapshot().services.find(({ serviceId }) => serviceId === image.serviceId)?.status).toEqual(
      connected,
    )
    expect(controller.getSnapshot().actions).toEqual([{ action: "sign_out", target: imageTarget }])

    imageResult.resolve(disconnected)
    await imageAction
    expect(controller.getSnapshot().services.find(({ serviceId }) => serviceId === image.serviceId)?.status).toEqual(
      disconnected,
    )
    expect(controller.getSnapshot().actions).toBeUndefined()
    expect(serviceClient.signOut).toHaveBeenCalledWith(imageTarget)
    expect(serviceClient.signOut).toHaveBeenCalledWith(videoTarget)
    controller.dispose()
  })
})
