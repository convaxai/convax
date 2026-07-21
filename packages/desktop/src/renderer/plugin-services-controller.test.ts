import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceStatusSchema,
  type PluginServiceClient,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import { PluginServicesController } from "./plugin-services-controller"

const summary: PluginServiceSummary = {
  actions: ["sign_out"],
  capabilities: [],
  description: "Account connection",
  models: [],
  pluginId: "account-tools",
  pluginName: "Account Tools",
  version: "1.0.0",
}

const connected: PluginServiceStatus = {
  account: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "unavailable" },
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
    getStatus: mock(async () => connected),
    listServices: mock(async () => [summary]),
    onDidChange: mock(() => () => undefined),
    reauthorize: mock(async () => connected),
    signOut: mock(async () => disconnected),
    ...overrides,
  }
}

describe("PluginServicesController", () => {
  test("loads installed services and applies only explicitly declared fixed actions", async () => {
    const serviceClient = client()
    const controller = new PluginServicesController(serviceClient)
    await controller.refresh()

    expect(controller.getSnapshot().services[0]).toMatchObject({
      loading: false,
      pluginId: "account-tools",
      status: connected,
    })
    await controller.perform("account-tools", "sign_out")
    expect(serviceClient.signOut).toHaveBeenCalledWith({ pluginId: "account-tools" })
    expect(controller.getSnapshot().services[0]?.status).toEqual(disconnected)
    await expect(controller.perform("account-tools", "reauthorize")).rejects.toThrow("no longer available")
    expect(serviceClient.reauthorize).not.toHaveBeenCalled()
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
    await Promise.resolve()
    installed = []
    await controller.refresh()
    pendingStatus.resolve(connected)
    await first

    expect(controller.getSnapshot()).toMatchObject({ loading: false, services: [] })
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
    const action = controller.perform("account-tools", "sign_out")
    installed = [{ ...summary, version: "2.0.0" }]
    changed?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    signOutResult.resolve(disconnected)
    await action

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

    const pending = controller.perform("account-tools", "authorize")
    await Promise.resolve()
    await controller.perform("account-tools", "authorization.cancel")
    expect(serviceClient.cancelAuthorization).toHaveBeenCalledWith({ pluginId: "account-tools" })
    expect(controller.getSnapshot().services[0]?.status).toEqual(cancelResult)

    authorization.resolve(connected)
    await pending
    expect(controller.getSnapshot().services[0]?.status).toEqual(cancelResult)
    controller.dispose()
  })
})
