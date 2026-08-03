import type { ServiceCapability } from "../plugin-service-contracts"
import type { ServiceCatalogEntry } from "./service-catalog-controller"

export const visibleServiceModelLimit = 50

export type ServiceModelCapabilityFilter = "all" | ServiceCapability

export const serviceModelCapabilityOrder: readonly ServiceCapability[] = ["llm", "text", "image", "video", "audio"]

export function availableServiceModelCapabilities(models: ServiceCatalogEntry["models"]) {
  const available = new Set(models.map((model) => model.capability))
  return serviceModelCapabilityOrder.filter((capability) => available.has(capability))
}

export function filterServiceModels(
  models: ServiceCatalogEntry["models"],
  query: string,
  capability: ServiceModelCapabilityFilter = "all",
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery && capability === "all") return models
  return models.filter(
    (model) =>
      (capability === "all" || model.capability === capability) &&
      (!normalizedQuery ||
        `${model.name} ${model.providerName ?? ""} ${model.id} ${model.capability}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)),
  )
}

export function serviceModelResults(
  models: ServiceCatalogEntry["models"],
  query: string,
  capability: ServiceModelCapabilityFilter = "all",
  limit = visibleServiceModelLimit,
) {
  const matches = filterServiceModels(models, query, capability)
  return {
    limited: matches.length > limit,
    matches,
    rendered: matches.slice(0, limit),
  }
}
