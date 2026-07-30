import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceStatusSchema,
  type PluginServiceClient,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import {
  ServiceCatalogController,
  serviceCatalogAgentModelsForScope,
  serviceGenerationAvailabilityVersion,
} from "./service-catalog-controller"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
}

const connected: PluginServiceStatus = {
  account: { availability: "available", displayName: "Creator" },
  billing: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "available", remaining: 88, unit: "credits" },
  plan: { availability: "unavailable" },
  schema: pluginServiceStatusSchema,
  state: "connected",
  usage: { availability: "unavailable" },
}

function pluginClient(): PluginServiceClient {
  return {
    authorize: mock(async () => connected),
    cancelAuthorization: mock(async () => connected),
    checkout: mock(async () => connected),
    getStatus: mock(async () => connected),
    listServices: mock(
      async (): Promise<readonly PluginServiceSummary[]> => [
        {
          actions: ["reauthorize", "sign_out"],
          capabilities: ["image", "video"],
          description: "Creative generation",
          models: [
            { capability: "image", id: "seedream", name: "Seedream" },
            { capability: "video", id: "seedance", name: "Seedance" },
          ],
          pluginId: "creative-service",
          pluginName: "Creative Service",
          version: "1.0.0",
        },
      ],
    ),
    onDidChange: mock(() => () => undefined),
    reauthorize: mock(async () => connected),
    signOut: mock(async () => connected),
  }
}

describe("ServiceCatalogController", () => {
  test("does not expose the previous Project's Agent model catalog during a scope switch", () => {
    const previousCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "project-a-model", modelName: "Project A Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const snapshot = {
      agentModels: { catalog: previousCatalog, loading: false, scopeId: "project-a" },
      loading: false,
      services: [],
    }

    expect(serviceCatalogAgentModelsForScope(snapshot, "project-b")).toEqual({
      loading: true,
      scopeId: "project-b",
    })
    expect(serviceCatalogAgentModelsForScope(snapshot, "project-a").catalog).toBe(previousCatalog)
  })

  test("versions generation availability from stable authority state instead of loading presentation state", async () => {
    const controller = new ServiceCatalogController(pluginClient(), {
      listModels: mock(async () => ({ providers: [] })),
    })
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()
    const ready = controller.getSnapshot()
    const loading = {
      ...ready,
      loading: true,
      services: ready.services.map((service) => (service.kind === "plugin" ? { ...service, loading: true } : service)),
    }

    expect(serviceGenerationAvailabilityVersion(loading, ["creative-service"])).toBe(
      serviceGenerationAvailabilityVersion(ready, ["creative-service"]),
    )
    expect(serviceGenerationAvailabilityVersion(loading, ["unrelated-service"])).toBe(
      serviceGenerationAvailabilityVersion(ready, ["unrelated-service"]),
    )
    expect(serviceGenerationAvailabilityVersion({ ...ready, loading: true }, ["unrelated-service"])).toBe(
      serviceGenerationAvailabilityVersion(ready, ["unrelated-service"]),
    )
    for (const state of ["disconnected", "attention"] as const) {
      const settled = {
        ...ready,
        services: ready.services.map((service) =>
          service.kind === "plugin" ? { ...service, loading: false, state } : service,
        ),
      }
      expect(serviceGenerationAvailabilityVersion(settled, ["creative-service"])).not.toBe(
        serviceGenerationAvailabilityVersion(ready, ["creative-service"]),
      )
    }
    controller.dispose()
  })

  test("keeps the last stable generation authority state while a background service refresh is loading", async () => {
    const client = pluginClient()
    const summaries = await client.listServices()
    const controller = new ServiceCatalogController(client, {
      listModels: mock(async () => ({ providers: [] })),
    })
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()
    const readyVersion = serviceGenerationAvailabilityVersion(controller.getSnapshot(), ["creative-service"])
    const pendingList = deferred<readonly PluginServiceSummary[]>()
    const pendingStatus = deferred<PluginServiceStatus>()
    client.listServices = mock(() => pendingList.promise)
    client.getStatus = mock(() => pendingStatus.promise)

    const refresh = controller.refresh()
    await Promise.resolve()
    expect(controller.getSnapshot().loading).toBe(true)
    expect(serviceGenerationAvailabilityVersion(controller.getSnapshot(), ["creative-service"])).toBe(readyVersion)

    pendingList.resolve(summaries)
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.getSnapshot().services[1]).toMatchObject({
      loading: true,
      state: "connected",
    })
    expect(serviceGenerationAvailabilityVersion(controller.getSnapshot(), ["creative-service"])).toBe(readyVersion)

    pendingStatus.resolve({ ...connected, state: "disconnected" })
    await refresh
    expect(controller.getSnapshot().services[1]).toMatchObject({
      loading: false,
      state: "disconnected",
    })
    expect(serviceGenerationAvailabilityVersion(controller.getSnapshot(), ["creative-service"])).not.toBe(readyVersion)
    controller.dispose()
  })

  test("joins Plugin service metadata and OpenCode models without adding an execution router", async () => {
    const agentClient = {
      listModels: mock(async () => ({
        providers: [
          {
            connected: true,
            defaultModelId: "free-model",
            models: [{ default: true, modelId: "free-model", modelName: "Free Model" }],
            providerId: "opencode",
            providerName: "OpenCode Zen",
          },
        ],
      })),
    }
    const controller = new ServiceCatalogController(pluginClient(), agentClient)
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()

    expect(controller.getSnapshot().services).toEqual([
      expect.objectContaining({
        billing: { kind: "free" },
        capabilities: ["llm"],
        models: [expect.objectContaining({ name: "Free Model", providerName: "OpenCode Zen" })],
        name: "OpenCode",
        serviceId: "builtin:opencode",
      }),
      expect.objectContaining({
        authentication: "authenticated",
        billing: { kind: "credits", remaining: 88, unit: "credits" },
        capabilities: ["image", "video"],
        models: [
          { capability: "image", id: "seedream", name: "Seedream" },
          { capability: "video", id: "seedance", name: "Seedance" },
        ],
        name: "Creative Service",
        serviceId: "plugin:creative-service",
      }),
    ])
    expect(agentClient.listModels).toHaveBeenCalledWith({ scopeId: "project-a" })
    controller.dispose()
  })

  test("publishes one shared raw Agent model state and retains its ready catalog during refresh", async () => {
    const initialCatalog = {
      providers: [
        {
          connected: true,
          defaultModelId: "initial-model",
          models: [{ default: true, modelId: "initial-model", modelName: "Initial Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const updatedCatalog = {
      providers: [
        {
          connected: true,
          defaultModelId: "updated-model",
          models: [{ default: true, modelId: "updated-model", modelName: "Updated Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const agentClient = {
      listModels: mock(async () => initialCatalog),
    }
    const controller = new ServiceCatalogController(pluginClient(), agentClient)
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()

    const pendingCatalog = deferred<typeof updatedCatalog>()
    agentClient.listModels = mock(() => pendingCatalog.promise)
    const refresh = controller.refresh()

    expect(controller.getSnapshot().agentModels).toEqual({
      catalog: initialCatalog,
      error: undefined,
      loading: true,
      scopeId: "project-a",
    })

    pendingCatalog.resolve(updatedCatalog)
    await refresh
    expect(controller.getSnapshot().agentModels).toEqual({
      catalog: updatedCatalog,
      error: undefined,
      loading: false,
      scopeId: "project-a",
    })
    controller.dispose()
  })

  test("returns and publishes send-time Agent model revalidation through the shared controller", async () => {
    const initialCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "initial-model", modelName: "Initial Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const updatedCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "updated-model", modelName: "Updated Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const agentClient = { listModels: mock(async () => initialCatalog) }
    const controller = new ServiceCatalogController(pluginClient(), agentClient)
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()
    agentClient.listModels = mock(async () => updatedCatalog)

    expect(await controller.refreshAgentModels()).toEqual(updatedCatalog)
    expect(controller.getSnapshot().agentModels).toEqual({
      catalog: updatedCatalog,
      error: undefined,
      loading: false,
      scopeId: "project-a",
    })
    controller.dispose()
  })

  test("single-flights send-time model refresh and rejects without discarding the ready catalog", async () => {
    const initialCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "initial-model", modelName: "Initial Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const agentClient = { listModels: mock(async () => initialCatalog) }
    const controller = new ServiceCatalogController(pluginClient(), agentClient)
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()
    const pending = deferred<typeof initialCatalog>()
    agentClient.listModels = mock(() => pending.promise)

    const first = controller.refreshAgentModels()
    const second = controller.refreshAgentModels()
    expect(agentClient.listModels).toHaveBeenCalledTimes(1)
    pending.reject(new Error("Fresh model catalog unavailable"))
    const firstError = await first.catch((error: unknown) => error)
    const secondError = await second.catch((error: unknown) => error)

    expect(firstError).toBeInstanceOf(Error)
    expect(secondError).toBe(firstError)
    expect(controller.getSnapshot().agentModels).toEqual({
      catalog: initialCatalog,
      error: "Fresh model catalog unavailable",
      loading: false,
      scopeId: "project-a",
    })
    controller.dispose()
  })

  test("retains the shared Agent model catalog when a background refresh fails", async () => {
    const initialCatalog = {
      providers: [
        {
          connected: true,
          defaultModelId: "initial-model",
          models: [{ default: true, modelId: "initial-model", modelName: "Initial Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    }
    const agentClient = {
      listModels: mock(async () => initialCatalog),
    }
    const controller = new ServiceCatalogController(pluginClient(), agentClient)
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()

    const pendingCatalog = deferred<typeof initialCatalog>()
    agentClient.listModels = mock(() => pendingCatalog.promise)
    const refresh = controller.refresh()
    pendingCatalog.reject(new Error("Model catalog unavailable"))
    await refresh

    expect(controller.getSnapshot().agentModels).toEqual({
      catalog: initialCatalog,
      error: "Model catalog unavailable",
      loading: false,
      scopeId: "project-a",
    })
    controller.dispose()
  })

  test("does not expose disconnected OpenCode providers as available models", async () => {
    const controller = new ServiceCatalogController(pluginClient(), {
      listModels: mock(async () => ({
        providers: [
          {
            connected: false,
            models: [{ default: false, modelId: "paid-model", modelName: "Paid Model" }],
            providerId: "unconfigured",
            providerName: "Unconfigured",
          },
        ],
      })),
    })
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()

    expect(controller.getSnapshot().services[0]).toMatchObject({ models: [], state: "disconnected" })
    controller.dispose()
  })

  test("refreshes OpenCode models when Plugin service availability changes", async () => {
    const listeners = new Set<() => void>()
    const client = pluginClient()
    client.onDidChange = mock((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
    let modelName = "Before authorization"
    const listModels = mock(async () => ({
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "service-model", modelName }],
          providerId: "service-provider",
          providerName: "Service provider",
        },
      ],
    }))
    const controller = new ServiceCatalogController(client, { listModels })
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()
    const callsBeforeChange = listModels.mock.calls.length

    modelName = "After authorization"
    for (const listener of listeners) listener()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(listModels.mock.calls.length).toBeGreaterThan(callsBeforeChange)
    expect(controller.getSnapshot().services[0]?.models).toEqual([
      expect.objectContaining({ name: "After authorization" }),
    ])
    controller.dispose()
  })

  test("queues one trailing model refresh when service authority changes during an in-flight request", async () => {
    const listeners = new Set<() => void>()
    const client = pluginClient()
    client.onDidChange = mock((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
    const beforeCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "before", modelName: "Before" }],
          providerId: "service-provider",
          providerName: "Service provider",
        },
      ],
    }
    const afterCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "after", modelName: "After" }],
          providerId: "service-provider",
          providerName: "Service provider",
        },
      ],
    }
    const beforeChange = deferred<typeof beforeCatalog>()
    const afterChange = deferred<typeof afterCatalog>()
    let requestCount = 0
    const listModels = mock(() => (requestCount++ === 0 ? beforeChange.promise : afterChange.promise))
    const controller = new ServiceCatalogController(client, { listModels })
    controller.setScopeId("project-a")
    controller.start()

    for (const listener of listeners) listener()
    const authoritativeRefresh = controller.refreshAgentModels()
    let authoritativeSettled = false
    void authoritativeRefresh.finally(() => {
      authoritativeSettled = true
    })
    expect(listModels).toHaveBeenCalledTimes(1)
    beforeChange.resolve(beforeCatalog)
    for (let index = 0; index < 6; index += 1) await Promise.resolve()

    expect(listModels).toHaveBeenCalledTimes(2)
    expect(authoritativeSettled).toBe(false)
    afterChange.resolve(afterCatalog)
    expect(await authoritativeRefresh).toEqual(afterCatalog)

    expect(controller.getSnapshot().agentModels?.catalog?.providers[0]?.models[0]?.modelName).toBe("After")
    controller.dispose()
  })

  test("projects connected Plugin LLM providers into their Service instead of the OpenCode card", async () => {
    const client: PluginServiceClient = {
      ...pluginClient(),
      listServices: mock(
        async (): Promise<readonly PluginServiceSummary[]> => [
          {
            actions: ["reauthorize", "sign_out"],
            capabilities: ["llm"],
            description: "Nexus OpenRouter",
            models: [{ capability: "llm", id: "fallback", name: "Fallback" }],
            pluginId: "nexus-service",
            pluginName: "Convax Account",
            version: "0.2.0",
          },
        ],
      ),
    }
    const controller = new ServiceCatalogController(client, {
      listModels: mock(async () => ({
        providers: [
          {
            connected: true,
            defaultModelId: "free-model",
            models: [{ default: true, modelId: "free-model", modelName: "Free Model" }],
            providerId: "opencode",
            providerName: "OpenCode Zen",
          },
          {
            connected: true,
            models: [
              { default: false, modelId: "anthropic/claude-sonnet-4", modelName: "Claude Sonnet 4" },
              {
                default: false,
                modelId: "deepseek/deepseek-v4-flash:free",
                modelName: "DeepSeek V4 Flash Free",
              },
            ],
            providerId: "plugin-nexus-service-openrouter",
            providerName: "Nexus · OpenRouter",
          },
        ],
      })),
    })
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()

    expect(controller.getSnapshot().services[0]?.models).toEqual([
      expect.objectContaining({ id: JSON.stringify(["opencode", "free-model"]), name: "Free Model" }),
    ])
    expect(controller.getSnapshot().services[1]).toMatchObject({
      capabilities: ["llm"],
      models: [
        { capability: "llm", default: false, id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
        {
          capability: "llm",
          default: false,
          id: "deepseek/deepseek-v4-flash:free",
          name: "DeepSeek V4 Flash Free",
        },
      ],
      name: "Convax Account",
    })
    controller.dispose()
  })

  test("drops a late OpenCode model response after the active Project scope changes", async () => {
    const first = deferred<{ providers: [] }>()
    const second = deferred<{
      providers: [
        {
          connected: true
          models: [{ default: true; modelId: string; modelName: string }]
          providerId: string
          providerName: string
        },
      ]
    }>()
    const controller = new ServiceCatalogController(pluginClient(), {
      listModels: mock(({ scopeId }) => (scopeId === "project-a" ? first.promise : second.promise)),
    })
    controller.setScopeId("project-a")
    controller.start()
    await Promise.resolve()
    controller.setScopeId("project-b")
    second.resolve({
      providers: [
        {
          connected: true,
          models: [{ default: true, modelId: "project-b-model", modelName: "Project B Model" }],
          providerId: "opencode",
          providerName: "OpenCode",
        },
      ],
    })
    await Promise.resolve()
    first.resolve({ providers: [] })
    await Promise.resolve()

    expect(controller.getSnapshot().services[0]?.models).toEqual([expect.objectContaining({ name: "Project B Model" })])
    controller.dispose()
  })
})
