import { describe, expect, test } from "bun:test"
import type { AgentModelCatalog } from "@convax/agent-runtime"
import {
  availableAgentLlmProviders,
  defaultAgentLlmModelSelection,
  findAgentLlmModel,
  reconcileAgentLlmModelSelection,
} from "./agent-llm-models"

const catalog: AgentModelCatalog = {
  providers: [
    {
      connected: true,
      defaultModelId: "main",
      models: [{ default: true, modelId: "main", modelName: "Pippit GLM Main" }],
      providerId: "plugin-xiaoyunque-generation-pippit-glm",
      providerName: "小云雀生成",
    },
    {
      connected: false,
      models: [{ default: false, modelId: "offline", modelName: "Offline" }],
      providerId: "offline",
      providerName: "Offline",
    },
  ],
}

describe("Agent LLM models", () => {
  test("resolves an exact connected provider/model pair", () => {
    const selection = { modelId: "main", providerId: "plugin-xiaoyunque-generation-pippit-glm" }
    expect(findAgentLlmModel(selection, catalog)?.model.modelName).toBe("Pippit GLM Main")
    expect(reconcileAgentLlmModelSelection(selection, catalog)).toEqual(selection)
  })

  test("chooses a concrete default when the remembered model is unavailable or absent", () => {
    const expected = { modelId: "main", providerId: "plugin-xiaoyunque-generation-pippit-glm" }
    expect(reconcileAgentLlmModelSelection({ modelId: "offline", providerId: "offline" }, catalog)).toEqual(expected)
    expect(
      reconcileAgentLlmModelSelection(
        { modelId: "removed", providerId: "plugin-xiaoyunque-generation-pippit-glm" },
        catalog,
      ),
    ).toEqual(expected)
    expect(reconcileAgentLlmModelSelection(undefined, catalog)).toEqual(expected)
  })

  test("uses the first available service's default before falling back to its first model", () => {
    const withDefaults: AgentModelCatalog = {
      providers: [
        {
          connected: true,
          models: [{ default: false, modelId: "first", modelName: "First" }],
          providerId: "first-service",
          providerName: "First service",
        },
        {
          connected: true,
          defaultModelId: "preferred",
          models: [{ default: true, modelId: "preferred", modelName: "Preferred" }],
          providerId: "second-service",
          providerName: "Second service",
        },
      ],
    }
    expect(defaultAgentLlmModelSelection(withDefaults)).toEqual({ modelId: "first", providerId: "first-service" })

    withDefaults.providers[0]!.connected = false
    expect(defaultAgentLlmModelSelection(withDefaults)).toEqual({
      modelId: "preferred",
      providerId: "second-service",
    })
  })

  test("ignores disconnected and model-less services without inventing a model", () => {
    const unavailable: AgentModelCatalog = {
      providers: [
        {
          connected: true,
          models: [],
          providerId: "empty",
          providerName: "Empty",
        },
        {
          connected: false,
          models: [{ default: true, modelId: "offline", modelName: "Offline" }],
          providerId: "offline",
          providerName: "Offline",
        },
      ],
    }
    expect(availableAgentLlmProviders(unavailable)).toEqual([])
    expect(defaultAgentLlmModelSelection(unavailable)).toBeUndefined()
    expect(reconcileAgentLlmModelSelection(undefined, unavailable)).toBeUndefined()
    expect(reconcileAgentLlmModelSelection(undefined, undefined)).toBeUndefined()
  })
})
