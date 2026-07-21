import { describe, expect, test } from "bun:test"
import type { AgentModelCatalog } from "@convax/agent-runtime"
import { findAgentLlmModel, reconcileAgentLlmModelSelection } from "./agent-llm-models"

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

  test("fails closed for disconnected, missing, or absent models", () => {
    expect(reconcileAgentLlmModelSelection({ modelId: "offline", providerId: "offline" }, catalog)).toBeUndefined()
    expect(
      reconcileAgentLlmModelSelection(
        { modelId: "removed", providerId: "plugin-xiaoyunque-generation-pippit-glm" },
        catalog,
      ),
    ).toBeUndefined()
    expect(reconcileAgentLlmModelSelection(undefined, catalog)).toBeUndefined()
  })
})
