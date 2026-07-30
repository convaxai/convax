import { isPluginApiId, PLUGIN_API_CATALOG_MAJOR, type PluginApiId } from "./catalog"
import type { PluginApiDeclaration } from "./contracts"

const API_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseRuntimeIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== "string" || !API_ID.test(candidate)) {
      throw new TypeError(`${label} contains an invalid Plugin API id: ${String(candidate)}`)
    }
    if (seen.has(candidate)) throw new TypeError(`${label} contains a duplicate Plugin API id: ${candidate}`)
    seen.add(candidate)
    result.push(candidate)
  }
  return result
}

/**
 * Defines and validates a typed required/optional Host API declaration.
 *
 * @public
 */
export function definePluginApiDeclaration<
  const Required extends readonly PluginApiId[],
  const Optional extends readonly PluginApiId[],
>(declaration: {
  readonly major: typeof PLUGIN_API_CATALOG_MAJOR
  readonly required: Required
  readonly optional: Optional
}): PluginApiDeclaration<Required[number] | Optional[number]>
export function definePluginApiDeclaration(declaration: {
  readonly major: typeof PLUGIN_API_CATALOG_MAJOR
  readonly required: readonly PluginApiId[]
  readonly optional: readonly PluginApiId[]
}): PluginApiDeclaration<PluginApiId>
export function definePluginApiDeclaration(declaration: {
  readonly major: typeof PLUGIN_API_CATALOG_MAJOR
  readonly required: readonly PluginApiId[]
  readonly optional: readonly PluginApiId[]
}): PluginApiDeclaration<PluginApiId> {
  return parsePluginApiDeclaration(declaration)
}

/**
 * Parses an authoring-time declaration and rejects unknown ids as likely typos.
 *
 * @public
 */
export function parsePluginApiDeclaration(value: unknown): PluginApiDeclaration<PluginApiId> {
  const declaration = parseRuntimePluginApiDeclaration(value)
  const required: PluginApiId[] = []
  const optional: PluginApiId[] = []
  for (const id of declaration.required) {
    if (!isPluginApiId(id)) throw new TypeError(`Plugin API declaration contains an unknown Plugin API id: ${id}`)
    required.push(id)
  }
  for (const id of declaration.optional) {
    if (!isPluginApiId(id)) throw new TypeError(`Plugin API declaration contains an unknown Plugin API id: ${id}`)
    optional.push(id)
  }
  return Object.freeze({
    major: PLUGIN_API_CATALOG_MAJOR,
    required: Object.freeze(required),
    optional: Object.freeze(optional),
  })
}

/**
 * Parses a runtime declaration while preserving syntactically valid future API ids.
 *
 * @public
 */
export function parseRuntimePluginApiDeclaration(value: unknown): PluginApiDeclaration {
  if (!isRecord(value)) throw new TypeError("Plugin API declaration must be an object")
  const keys = Object.keys(value)
  if (keys.some((key) => key !== "major" && key !== "required" && key !== "optional")) {
    throw new TypeError("Plugin API declaration contains an unknown field")
  }
  if (value.major !== PLUGIN_API_CATALOG_MAJOR) {
    throw new TypeError(`Plugin API declaration major must be ${PLUGIN_API_CATALOG_MAJOR}`)
  }
  const required = parseRuntimeIdList(value.required, "Plugin API declaration required")
  const optional = parseRuntimeIdList(value.optional, "Plugin API declaration optional")
  const requiredIds = new Set(required)
  const overlap = optional.find((id) => requiredIds.has(id))
  if (overlap) throw new TypeError(`Plugin API cannot be both required and optional: ${overlap}`)
  return Object.freeze({
    major: PLUGIN_API_CATALOG_MAJOR,
    required: Object.freeze(required),
    optional: Object.freeze(optional),
  })
}

/**
 * Returns whether an API was declared as required, optional, or not declared.
 *
 * @public
 */
export function getPluginApiRequirement(
  declaration: PluginApiDeclaration,
  id: string,
): "required" | "optional" | undefined {
  if (declaration.required.includes(id)) return "required"
  if (declaration.optional.includes(id)) return "optional"
  return undefined
}

/**
 * Returns true only when the API is present in either declaration set.
 *
 * @public
 */
export function isPluginApiDeclared(declaration: PluginApiDeclaration, id: string): boolean {
  return getPluginApiRequirement(declaration, id) !== undefined
}
