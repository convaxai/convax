import { getPluginApiDefinition, pluginApiCatalog, type PluginApiId } from "./catalog"

type CatalogDefinition = (typeof pluginApiCatalog.apis)[number]

/** Stable error codes declared by one exact Host API Catalog entry. */
export type PluginApiErrorCode<Id extends PluginApiId = PluginApiId> = Extract<
  CatalogDefinition,
  { readonly id: Id }
>["errors"][number]["code"]

/** Portable failure returned for one Host API request. */
export interface PluginApiRemoteFailure<Id extends PluginApiId = PluginApiId> {
  readonly code: PluginApiErrorCode<Id>
  readonly kind: "api"
  readonly message: string
  readonly recoverable: boolean
}

export function isPluginApiErrorCode<Id extends PluginApiId>(id: Id, value: unknown): value is PluginApiErrorCode<Id> {
  return typeof value === "string" && getPluginApiDefinition(id).errors.some((definition) => definition.code === value)
}

/**
 * Validates a Host failure against the exact API's Catalog error allowlist.
 * `recoverable` is metadata, not provider-controlled policy, and must match.
 */
export function parsePluginApiRemoteFailure<Id extends PluginApiId>(
  id: Id,
  value: unknown,
): PluginApiRemoteFailure<Id> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Plugin API ${id} failure must be an object`)
  }
  const failure = value as Record<string, unknown>
  if (
    Object.keys(failure).some((key) => !["code", "kind", "message", "recoverable"].includes(key)) ||
    !Object.prototype.hasOwnProperty.call(failure, "code") ||
    !Object.prototype.hasOwnProperty.call(failure, "message") ||
    !Object.prototype.hasOwnProperty.call(failure, "recoverable") ||
    failure.kind !== "api" ||
    !isPluginApiErrorCode(id, failure.code) ||
    typeof failure.message !== "string" ||
    failure.message.length < 1 ||
    failure.message.length > 4_096 ||
    typeof failure.recoverable !== "boolean"
  ) {
    throw new TypeError(`Plugin API ${id} failure is invalid`)
  }
  const definition = getPluginApiDefinition(id).errors.find(({ code }) => code === failure.code)!
  if (failure.recoverable !== definition.recoverable) {
    throw new TypeError(`Plugin API ${id} failure recoverability does not match the Catalog`)
  }
  return Object.freeze({
    code: failure.code,
    kind: "api",
    message: failure.message,
    recoverable: failure.recoverable,
  }) as PluginApiRemoteFailure<Id>
}
