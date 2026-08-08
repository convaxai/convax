import { describe, expect, test } from "bun:test"

import type { GenerationToolSummary } from "../generation-contracts"
import {
  agentModelCatalogStorageKey,
  generationModelCatalogStorageKey,
  readAgentModelCatalogProjection,
  readGenerationModelCatalogProjection,
  writeAgentModelCatalogProjection,
  writeGenerationModelCatalogProjection,
} from "./model-catalog-projection-cache"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  }
}

const agentCatalog = {
  providers: [
    {
      connected: true,
      defaultModelId: "mimo-v2.5-free",
      models: [{ default: true, modelId: "mimo-v2.5-free", modelName: "MiMo V2.5 Free" }],
      providerId: "opencode",
      providerName: "OpenCode",
    },
  ],
}

const generationTools: readonly GenerationToolSummary[] = [
  {
    acceptedInputs: ["text"],
    description: "Generate an image",
    id: "convax-account/google/nano-banana",
    kind: "model",
    modelName: "Nano Banana",
    output: "image",
    pluginId: "convax-account",
    pluginName: "Convax Account",
    title: "Nano Banana",
    toolId: "generate",
  },
]

describe("model catalog display projection cache", () => {
  test("round-trips the last complete Agent and generation catalogs", () => {
    const storage = memoryStorage()

    expect(writeAgentModelCatalogProjection(storage, agentCatalog)).toBe(true)
    expect(writeGenerationModelCatalogProjection(storage, generationTools)).toBe(true)
    expect(readAgentModelCatalogProjection(storage)).toEqual(agentCatalog)
    expect(readGenerationModelCatalogProjection(storage)).toEqual(generationTools)
  })

  test("stores the bounded connected Agent projection and multiline generation descriptions", () => {
    const storage = memoryStorage()
    const disconnected = {
      connected: false,
      models: [{ default: false, modelId: "unused", modelName: "Unused" }],
      providerId: "disconnected",
      providerName: "Disconnected",
    }
    const multilineTools = [{ ...generationTools[0], description: "Generate an image\nusing the selected service." }]

    expect(writeAgentModelCatalogProjection(storage, { providers: [disconnected, ...agentCatalog.providers] })).toBe(
      true,
    )
    expect(readAgentModelCatalogProjection(storage)).toEqual(agentCatalog)
    expect(writeGenerationModelCatalogProjection(storage, multilineTools)).toBe(true)
    expect(readGenerationModelCatalogProjection(storage)).toEqual(multilineTools)
  })

  test("fails closed for malformed, expanded, or unsafe display projections", () => {
    const storage = memoryStorage()
    storage.values.set(
      agentModelCatalogStorageKey,
      JSON.stringify({
        projection: { ...agentCatalog, credential: "secret" },
        schema: "convax.agent-model-display-cache/1",
      }),
    )
    storage.values.set(
      generationModelCatalogStorageKey,
      JSON.stringify({
        projection: [{ ...generationTools[0], description: "https://credential.example/token" }],
        schema: "convax.generation-model-display-cache/1",
      }),
    )

    expect(readAgentModelCatalogProjection(storage)).toBeNull()
    expect(readGenerationModelCatalogProjection(storage)).toBeNull()
  })

  test("ignores corrupt and oversized local storage without throwing", () => {
    const storage = memoryStorage()
    storage.values.set(agentModelCatalogStorageKey, "{")
    storage.values.set(generationModelCatalogStorageKey, "x".repeat(1024 * 1024 + 1))

    expect(readAgentModelCatalogProjection(storage)).toBeNull()
    expect(readGenerationModelCatalogProjection(storage)).toBeNull()
  })
})
