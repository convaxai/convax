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

/** Connected providers without a model are not usable services. */
export function availableAgentLlmProviders(
  catalog: AgentModelCatalog | undefined,
): readonly AgentModelCatalogProvider[] {
  return catalog?.providers.filter((provider) => provider.connected && provider.models.length > 0) ?? []
}

/** Resolves a remembered provider/model pair against the current connected DSH catalog. */
export function findAgentLlmModel(
  selection: AgentLlmModelSelection | undefined,
  catalog: AgentModelCatalog | undefined,
): AgentLlmModelMatch | undefined {
  if (!selection || !catalog) return undefined
  const provider = availableAgentLlmProviders(catalog).find(
    (candidate) => candidate.providerId === selection.providerId,
  )
  if (!provider) return undefined
  const model = provider.models.find((candidate) => candidate.modelId === selection.modelId)
  return model ? { model, provider } : undefined
}

/** Chooses the first usable service's reported default, then its first model. */
export function defaultAgentLlmModelSelection(
  catalog: AgentModelCatalog | undefined,
): AgentLlmModelSelection | undefined {
  const providers = availableAgentLlmProviders(catalog)
  const provider = providers[0]
  const model =
    provider?.models.find((candidate) => candidate.modelId === provider.defaultModelId || candidate.default) ??
    provider?.models[0]
  return provider && model ? { modelId: model.modelId, providerId: provider.providerId } : undefined
}

export function reconcileAgentLlmModelSelection(
  selection: AgentLlmModelSelection | undefined,
  catalog: AgentModelCatalog | undefined,
): AgentLlmModelSelection | undefined {
  const match = findAgentLlmModel(selection, catalog)
  return match
    ? { modelId: match.model.modelId, providerId: match.provider.providerId }
    : defaultAgentLlmModelSelection(catalog)
}

/**
 * An absent shared catalog means discovery has not completed, not that the
 * Project has no models. Preserve the remembered choice until one successful
 * catalog result (including an explicitly empty result) can reconcile it.
 */
export function reconcileAgentLlmModelSelectionFromReadyCatalog(
  selection: AgentLlmModelSelection | undefined,
  catalog: AgentModelCatalog | undefined,
): AgentLlmModelSelection | undefined {
  return catalog === undefined ? selection : reconcileAgentLlmModelSelection(selection, catalog)
}
