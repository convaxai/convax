import { describe, expect, mock, test } from "bun:test"

import {
  pluginServiceStatusSchema,
  type PluginServiceClient,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import { ServiceCatalogController } from "./service-catalog-controller"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const connected: PluginServiceStatus = {
  account: { availability: "available", displayName: "Creator" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "available", remaining: 88, unit: "credits" },
  schema: pluginServiceStatusSchema,
  state: "connected",
  usage: { availability: "unavailable" },
}

function pluginClient(): PluginServiceClient {
  return {
    authorize: mock(async () => connected),
    cancelAuthorization: mock(async () => connected),
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
