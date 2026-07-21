import type {
  AgentModel,
  AgentModelCatalog,
  AgentModelCatalogModel,
  AgentModelCatalogProvider,
} from "@convax/agent-runtime"

export type AgentLlmModelSelection = AgentModel

export interface AgentLlmModelMatch {
  model: AgentModelCatalogModel
  provider: AgentModelCatalogProvider
}

/** Resolves a remembered provider/model pair against the current connected OpenCode catalog. */
export function findAgentLlmModel(
  selection: AgentLlmModelSelection | undefined,
  catalog: AgentModelCatalog | undefined,
): AgentLlmModelMatch | undefined {
  if (!selection || !catalog) return undefined
  const provider = catalog.providers.find(
    (candidate) => candidate.connected && candidate.providerId === selection.providerId,
  )
  if (!provider) return undefined
  const model = provider.models.find((candidate) => candidate.modelId === selection.modelId)
  return model ? { model, provider } : undefined
}

export function reconcileAgentLlmModelSelection(
  selection: AgentLlmModelSelection | undefined,
  catalog: AgentModelCatalog | undefined,
): AgentLlmModelSelection | undefined {
  const match = findAgentLlmModel(selection, catalog)
  return match ? { modelId: match.model.modelId, providerId: match.provider.providerId } : undefined
}
