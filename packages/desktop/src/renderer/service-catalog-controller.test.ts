import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceStatusSchema,
  type PluginServiceClient,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import { ServiceCatalogController, serviceGenerationAvailabilityVersion } from "./service-catalog-controller"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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
  test("invalidates generation discovery when a target service finishes connecting", async () => {
    const controller = new ServiceCatalogController(pluginClient(), {
      listModels: mock(async () => ({ providers: [] })),
    })
    controller.setScopeId("project-a")
    controller.start()
    await controller.refresh()
    const ready = controller.getSnapshot()
    const loading = {
      ...ready,
      services: ready.services.map((service) =>
        service.kind === "plugin" ? { ...service, loading: true, state: "unknown" as const } : service,
      ),
    }

    expect(serviceGenerationAvailabilityVersion(loading, ["creative-service"])).not.toBe(
      serviceGenerationAvailabilityVersion(ready, ["creative-service"]),
    )
    expect(serviceGenerationAvailabilityVersion(loading, ["unrelated-service"])).toBe(
      serviceGenerationAvailabilityVersion(ready, ["unrelated-service"]),
    )
    expect(serviceGenerationAvailabilityVersion({ ...ready, loading: true }, ["unrelated-service"])).not.toBe(
      serviceGenerationAvailabilityVersion(ready, ["unrelated-service"]),
    )
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
