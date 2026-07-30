import { getPluginApiDefinition, isPluginApiId, PLUGIN_API_CATALOG_MAJOR, type PluginApiId } from "./catalog"
import type {
  ApiAvailability,
  PluginApiAudience,
  PluginApiDeclaration,
  PluginApiUnavailableReason,
  PluginApiVersion,
} from "./contracts"

/**
 * Live, connection-scoped facts consumed by the pure availability evaluator.
 *
 * @public
 */
export interface PluginApiLiveContext {
  readonly catalogVersion: PluginApiVersion
  readonly catalogMajor: number
  readonly audience: PluginApiAudience
  readonly grants: readonly string[]
  readonly hasContext: boolean
  readonly setupComplete: boolean
  readonly disabled: boolean
  readonly recovering: boolean
}

function compareVersions(left: PluginApiVersion, right: PluginApiVersion): number {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    const comparison = leftParts[index] - rightParts[index]
    if (comparison !== 0) return comparison
  }
  return 0
}

function unavailable(
  id: string,
  since: PluginApiVersion | undefined,
  contractSince: PluginApiVersion | undefined,
  reason: PluginApiUnavailableReason,
  recoverable: boolean,
): ApiAvailability {
  return {
    available: false,
    id,
    ...(since ? { since } : {}),
    ...(contractSince ? { contractSince } : {}),
    reason,
    recoverable,
  }
}

/**
 * Evaluates Host API availability from already validated declaration and live facts.
 *
 * @public
 */
export function evaluatePluginApiAvailability(
  id: string,
  declaration: PluginApiDeclaration,
  context: PluginApiLiveContext,
): ApiAvailability {
  if (!isPluginApiId(id)) return unavailable(id, undefined, undefined, "unsupported-host", false)
  const definition = getPluginApiDefinition(id)
  if (
    context.catalogMajor !== PLUGIN_API_CATALOG_MAJOR ||
    declaration.major !== context.catalogMajor ||
    compareVersions(context.catalogVersion, definition.contractSince) < 0
  ) {
    return unavailable(id, definition.since, definition.contractSince, "unsupported-host", false)
  }
  if (!declaration.required.includes(id) && !declaration.optional.includes(id)) {
    return unavailable(id, definition.since, definition.contractSince, "not-declared", false)
  }
  if (!definition.audience.includes(context.audience)) {
    return unavailable(id, definition.since, definition.contractSince, "wrong-surface", false)
  }
  if (definition.grant !== null && !context.grants.includes(definition.grant)) {
    return unavailable(id, definition.since, definition.contractSince, "permission-denied", false)
  }
  if (!context.hasContext)
    return unavailable(id, definition.since, definition.contractSince, "missing-context", true)
  if (!context.setupComplete)
    return unavailable(id, definition.since, definition.contractSince, "setup-required", true)
  if (context.disabled) return unavailable(id, definition.since, definition.contractSince, "disabled", true)
  if (context.recovering) return unavailable(id, definition.since, definition.contractSince, "recovering", true)
  return {
    available: true,
    id,
    since: definition.since,
    contractSince: definition.contractSince,
    catalogVersion: context.catalogVersion,
  }
}

/**
 * Error thrown when a caller requires an unavailable Host API.
 *
 * @public
 */
export class PluginApiUnavailableError<Id extends string = PluginApiId> extends Error {
  readonly availability: Extract<ApiAvailability<Id>, { available: false }>

  constructor(availability: Extract<ApiAvailability<Id>, { available: false }>) {
    super(`Plugin API ${availability.id} is unavailable: ${availability.reason}`)
    this.name = "PluginApiUnavailableError"
    this.availability = availability
  }
}

/**
 * Narrows an availability result to the available variant.
 *
 * @public
 */
export function isPluginApiAvailable<Id extends string>(
  availability: ApiAvailability<Id>,
): availability is Extract<ApiAvailability<Id>, { available: true }> {
  return availability.available
}

/**
 * Returns the available result or throws a structured `PluginApiUnavailableError`.
 *
 * @public
 */
export function requirePluginApi<Id extends string>(
  availability: ApiAvailability<Id>,
): Extract<ApiAvailability<Id>, { available: true }> {
  if (!availability.available) throw new PluginApiUnavailableError(availability)
  return availability
}
