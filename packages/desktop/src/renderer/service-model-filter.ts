import type { ServiceCatalogEntry } from "./service-catalog-controller"

export const visibleServiceModelLimit = 50

export function filterServiceModels(models: ServiceCatalogEntry["models"], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return models
  return models.filter((model) =>
    `${model.name} ${model.providerName ?? ""} ${model.id} ${model.capability}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  )
}

export function serviceModelResults(
  models: ServiceCatalogEntry["models"],
  query: string,
  limit = visibleServiceModelLimit,
) {
  const matches = filterServiceModels(models, query)
  return {
    limited: matches.length > limit,
    matches,
    rendered: matches.slice(0, limit),
  }
}
