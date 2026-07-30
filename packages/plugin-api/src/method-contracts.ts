import {
  pluginApiWireContracts,
  type PluginApiCall,
  type PluginApiContractId,
  type PluginApiMethodMap,
  type PluginApiJsonValue,
  type PluginApiParams,
  type PluginApiResult,
  type PluginApiWireContract,
  type PluginApiWireSchema,
} from "./method-schemas"

export interface PluginApiObjectShape {
  readonly additionalProperties: false
  readonly optional: readonly string[]
  readonly required: readonly string[]
  readonly type: "object"
}

export interface PluginApiNoParamsShape {
  readonly type: "none"
}

export interface PluginApiMethodContract {
  readonly request: PluginApiWireContract["request"]
  readonly params: PluginApiNoParamsShape | PluginApiObjectShape
  readonly result: PluginApiObjectShape
  readonly response: PluginApiWireContract["result"]
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/iu

function hasOnlyUnicodeScalars(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false
  }
  return true
}

function isPortableNameSegment(value: string) {
  const stem = value.split(".", 1)[0] ?? ""
  return Boolean(
    value &&
      value !== "." &&
      value !== ".." &&
      hasOnlyUnicodeScalars(value) &&
      !/[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(value) &&
      !/[. ]$/u.test(value) &&
      !windowsReservedName.test(stem),
  )
}

function satisfiesStringRefinement(
  value: string,
  refinement: Extract<PluginApiWireSchema, { type: "string" }>["refinement"],
) {
  if (refinement === undefined) return true
  if (refinement === "trimmed") return value === value.trim()
  if (refinement === "safe-png-file-name") {
    return value === value.trim() && value.toLowerCase().endsWith(".png") && isPortableNameSegment(value)
  }
  if (refinement === "portable-project-relative-path") {
    if (
      value !== value.trim() ||
      value.includes("\\") ||
      value.startsWith("/") ||
      value.startsWith("//") ||
      /^[A-Za-z]:/u.test(value) ||
      !hasOnlyUnicodeScalars(value)
    ) {
      return false
    }
    const segments = value.split("/")
    return (
      segments[0]?.toLowerCase() !== ".convax" &&
      segments.length > 0 &&
      segments.every((segment) => isPortableNameSegment(segment))
    )
  }
  return false
}

function json(value: unknown, schema: Extract<PluginApiWireSchema, { type: "json-object" }>, label: string) {
  const seen = new Set<object>()
  const visit = (entry: unknown, path: string, depth: number): PluginApiJsonValue => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new TypeError(`${path} must contain finite JSON numbers`)
      return entry
    }
    if (!entry || typeof entry !== "object" || depth >= schema.maxDepth || seen.has(entry)) {
      throw new TypeError(`${path} must be bounded acyclic JSON`)
    }
    const prototype = Object.getPrototypeOf(entry)
    if (!Array.isArray(entry) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain plain JSON objects`)
    }
    seen.add(entry)
    let parsed: PluginApiJsonValue
    if (Array.isArray(entry)) {
      parsed = entry.map((item, index) => visit(item, `${path}[${index}]`, depth + 1))
    } else {
      const fields = Object.create(null) as Record<string, PluginApiJsonValue>
      for (const [key, item] of Object.entries(entry)) {
        if (key.length < 1 || key.length > schema.keyMaxLength || /[\u0000-\u001f\u007f]/u.test(key)) {
          throw new TypeError(`${path} key is invalid`)
        }
        fields[key] = visit(item, `${path}.${key}`, depth + 1)
      }
      parsed = fields
    }
    seen.delete(entry)
    return parsed
  }
  const result = visit(record(value, label), label, 0)
  if (Array.isArray(result) || !result || typeof result !== "object") {
    throw new TypeError(`${label} must be an object`)
  }
  const serialized = JSON.stringify(result)
  if (new TextEncoder().encode(serialized).byteLength > schema.maxBytes) {
    throw new TypeError(`${label} exceeds ${schema.maxBytes} bytes`)
  }
  return result
}

/**
 * Interprets the exact portable schema descriptor used by TypeScript, docs,
 * compatibility history, byte limits, and runtime Host boundaries.
 */
export function parsePluginApiSchema<Schema extends PluginApiWireSchema>(
  schema: Schema,
  value: unknown,
  label = "Plugin API value",
): unknown {
  if ("oneOf" in schema) {
    const matches: unknown[] = []
    for (const candidate of schema.oneOf) {
      try {
        matches.push(parsePluginApiSchema(candidate, value, label))
      } catch {
        // A union branch is allowed to reject independently.
      }
    }
    if (matches.length !== 1) throw new TypeError(`${label} must match exactly one schema variant`)
    return matches[0]
  }
  if ("const" in schema) {
    if (value !== schema.const) throw new TypeError(`${label} must equal ${String(schema.const)}`)
    return value
  }
  if ("type" in schema && schema.type === "none") {
    if (value !== undefined) throw new TypeError(`${label} does not accept a value`)
    return undefined
  }
  if ("type" in schema && schema.type === "null") {
    if (value !== null) throw new TypeError(`${label} must be null`)
    return null
  }
  if ("type" in schema && schema.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`)
    return value
  }
  if ("type" in schema && (schema.type === "number" || schema.type === "integer")) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value)) ||
      (schema.minimum !== undefined && value < schema.minimum)
    ) {
      throw new TypeError(`${label} must be a valid ${schema.type}`)
    }
    return value
  }
  if ("type" in schema && schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length < schema.minLength ||
      value.length > schema.maxLength ||
      (schema.controlCharacters === false && /[\u0000-\u001f\u007f]/u.test(value)) ||
      (schema.enum !== undefined && !schema.enum.includes(value)) ||
      (schema.prefix !== undefined && !value.startsWith(schema.prefix)) ||
      !satisfiesStringRefinement(value, schema.refinement)
    ) {
      throw new TypeError(`${label} must satisfy its bounded string contract`)
    }
    return value
  }
  if ("type" in schema && schema.type === "array") {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) {
      throw new TypeError(`${label} must satisfy its bounded array contract`)
    }
    const parsed = value.map((entry, index) => parsePluginApiSchema(schema.items, entry, `${label}[${index}]`))
    if (schema.uniqueBy !== undefined) {
      const identities = parsed.map((entry) => {
        const item = record(entry, `${label} unique item`)
        const identity = item[schema.uniqueBy!]
        if (typeof identity !== "string" && typeof identity !== "number") {
          throw new TypeError(`${label} unique identity is invalid`)
        }
        return `${typeof identity}:${String(identity)}`
      })
      if (new Set(identities).size !== identities.length) {
        throw new TypeError(`${label} contains duplicate ${schema.uniqueBy}`)
      }
    }
    return parsed
  }
  if ("type" in schema && schema.type === "json-object") return json(value, schema, label)
  if (!("properties" in schema)) throw new TypeError(`${label} has an unsupported schema`)
  const input = record(value, label)
  const admitted = new Set(Object.keys(schema.properties))
  if (
    schema.required.some((key) => !Object.prototype.hasOwnProperty.call(input, key)) ||
    Object.keys(input).some((key) => !admitted.has(key))
  ) {
    throw new TypeError(`${label} contains unsupported or missing fields`)
  }
  return Object.fromEntries(
    Object.entries(input).map(([key, entry]) => [
      key,
      parsePluginApiSchema(schema.properties[key], entry, `${label}.${key}`),
    ]),
  )
}

function objectShape(schema: PluginApiWireSchema, label: string): PluginApiObjectShape | PluginApiNoParamsShape {
  if ("oneOf" in schema) {
    const variants = schema.oneOf.map((entry) => objectShape(entry, label))
    const objectVariants = variants.filter((entry): entry is PluginApiObjectShape => entry.type === "object")
    if (objectVariants.length === 0 && variants.some((entry) => entry.type === "none")) return { type: "none" }
    if (objectVariants.length === 0) throw new TypeError(`${label} is not an object schema`)
    const keys = new Set(objectVariants.flatMap(({ required, optional }) => [...required, ...optional]))
    const required = [...keys].filter((key) => objectVariants.every((entry) => entry.required.includes(key))).sort()
    return {
      additionalProperties: false,
      optional: [...keys].filter((key) => !required.includes(key)).sort(),
      required,
      type: "object",
    }
  }
  if ("type" in schema && schema.type === "none") return { type: "none" }
  if (!("properties" in schema)) throw new TypeError(`${label} is not an object schema`)
  return {
    additionalProperties: false,
    optional: Object.keys(schema.properties)
      .filter((key) => !schema.required.includes(key))
      .sort(),
    required: [...schema.required].sort(),
    type: "object",
  }
}

export const pluginApiContractIds = Object.freeze(
  Object.keys(pluginApiWireContracts).sort(),
) as readonly PluginApiContractId[]

export const pluginApiMethodContracts = Object.freeze(
  Object.fromEntries(
    pluginApiContractIds.map((id) => {
      const wire = pluginApiWireContracts[id]
      const result = objectShape(wire.result.schema, `Plugin API ${id} result`)
      if (result.type !== "object") throw new TypeError(`Plugin API ${id} result must be an object`)
      return [
        id,
        {
          params: objectShape(wire.request.schema, `Plugin API ${id} params`),
          request: wire.request,
          response: wire.result,
          result,
        },
      ]
    }),
  ),
) as unknown as Readonly<Record<PluginApiContractId, PluginApiMethodContract>>

export function parsePluginApiParams<Id extends PluginApiContractId>(id: Id, value: unknown): PluginApiParams<Id> {
  return parsePluginApiSchema(
    pluginApiWireContracts[id].request.schema,
    value,
    `Plugin API ${id} params`,
  ) as PluginApiParams<Id>
}

export function parsePluginApiResult<Id extends PluginApiContractId>(id: Id, value: unknown): PluginApiResult<Id> {
  return parsePluginApiSchema(
    pluginApiWireContracts[id].result.schema,
    value,
    `Plugin API ${id} result`,
  ) as PluginApiResult<Id>
}

export function parsePluginApiCall(value: unknown): PluginApiCall {
  const input = record(value, "Plugin API call")
  if (
    !Object.prototype.hasOwnProperty.call(input, "method") ||
    Object.keys(input).some((key) => key !== "method" && key !== "params") ||
    typeof input.method !== "string" ||
    !pluginApiContractIds.includes(input.method as PluginApiContractId)
  ) {
    throw new TypeError(`Unknown or invalid Plugin API call: ${String(input.method)}`)
  }
  const method = input.method as PluginApiContractId
  const params = parsePluginApiParams(method, input.params)
  return {
    method,
    ...(params === undefined ? {} : { params }),
  } as PluginApiCall
}

export type {
  PluginApiCall,
  PluginApiContractId,
  PluginApiMethodMap,
  PluginApiParams,
  PluginApiResult,
} from "./method-schemas"
