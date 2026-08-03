export const portablePluginStateSchemaFormat = "convax.plugin-state-schema/1" as const

export type PortableBoundedValueSchemaV1 =
  | Readonly<{ type: "null" }>
  | Readonly<{ type: "boolean" }>
  | Readonly<{ type: "string"; maxUtf8Bytes: string; enum?: readonly string[] }>
  | Readonly<{ type: "integer"; minimum: string; maximum: string }>
  | Readonly<{ type: "array"; maxItems: string; items: PortableBoundedValueSchemaV1 }>
  | Readonly<{
      type: "object"
      maxProperties: string
      required: readonly string[]
      properties: Readonly<Record<string, PortableBoundedValueSchemaV1>>
      additionalProperties: false
    }>
  | Readonly<{ type: "union"; variants: readonly PortableBoundedValueSchemaV1[] }>

const encoder = new TextEncoder()
const maximumDescriptorBytes = 64 * 1024
const maximumSchemaDepth = 16
const maximumSchemaNodes = 4_096
const maximumObjectProperties = 256
const maximumUnionVariants = 16
const maximumEnumValues = 256
const maximumStringBytes = 64 * 1024
const maximumArrayItems = 1_024
const maximumValueDepth = 32
const maximumValueNodes = 4_096
const maximumValueBytes = 256 * 1024

interface ParseBudget {
  nodes: number
  seen: Set<object>
}

interface ValueBudget {
  nodes: number
  seen: Set<object>
}

export function parsePortablePluginStateSchemaV1(value: unknown): PortableBoundedValueSchemaV1 {
  const schema = parseSchema(value, 1, { nodes: 0, seen: new Set() })
  if (encoder.encode(canonicalJson(schema)).byteLength > maximumDescriptorBytes) {
    throw new TypeError("Plugin state schema exceeds 64 KiB")
  }
  return schema
}

export function canonicalPortablePluginStateSchemaBytesV1(value: unknown): Readonly<Uint8Array> {
  const schema = parsePortablePluginStateSchemaV1(value)
  return encoder.encode(canonicalJson(schema))
}

export function pluginStateSchemaDigestInputV1(value: unknown): Readonly<Uint8Array> {
  const domain = encoder.encode(`${portablePluginStateSchemaFormat}\0`)
  const schema = canonicalPortablePluginStateSchemaBytesV1(value)
  const bytes = new Uint8Array(domain.byteLength + schema.byteLength)
  bytes.set(domain)
  bytes.set(schema, domain.byteLength)
  return bytes
}

export function assertPortablePluginStateValueV1(
  schemaInput: PortableBoundedValueSchemaV1,
  value: unknown,
): void {
  const schema = parsePortablePluginStateSchemaV1(schemaInput)
  validateValue(schema, value, 1, { nodes: 0, seen: new Set() })
  let bytes: Uint8Array
  try {
    const serialized = canonicalJson(value)
    bytes = encoder.encode(serialized)
  } catch {
    throw new TypeError("Plugin state value is not canonical JSON")
  }
  if (bytes.byteLength > maximumValueBytes) throw new TypeError("Plugin state value exceeds 256 KiB")
}

function parseSchema(value: unknown, depth: number, budget: ParseBudget): PortableBoundedValueSchemaV1 {
  if (depth > maximumSchemaDepth) throw new TypeError("Plugin state schema exceeds depth 16")
  if (++budget.nodes > maximumSchemaNodes) throw new TypeError("Plugin state schema exceeds 4096 nodes")
  const input = plainRecord(value, "Plugin state schema")
  if (budget.seen.has(input)) throw new TypeError("Plugin state schema cannot be cyclic")
  budget.seen.add(input)
  try {
    if (input.type === "null" || input.type === "boolean") {
      exactKeys(input, ["type"])
      return Object.freeze({ type: input.type })
    }
    if (input.type === "string") {
      exactKeys(input, ["type", "maxUtf8Bytes"], ["enum"])
      const maxUtf8Bytes = boundedDecimal(input.maxUtf8Bytes, maximumStringBytes, "String maxUtf8Bytes")
      if (input.enum === undefined) return Object.freeze({ type: "string", maxUtf8Bytes })
      if (!Array.isArray(input.enum) || input.enum.length > maximumEnumValues) {
        throw new TypeError("Plugin state string enum exceeds 256 values")
      }
      const values = input.enum.map((entry) => normalizedText(entry, "Plugin state enum value", Number(maxUtf8Bytes)))
      values.sort(compareUtf8)
      if (values.some((entry, index) => index > 0 && values[index - 1] === entry)) {
        throw new TypeError("Plugin state string enum contains duplicates")
      }
      return Object.freeze({ type: "string", maxUtf8Bytes, enum: Object.freeze(values) })
    }
    if (input.type === "integer") {
      exactKeys(input, ["type", "minimum", "maximum"])
      const minimum = safeIntegerDecimal(input.minimum, "Plugin state integer minimum")
      const maximum = safeIntegerDecimal(input.maximum, "Plugin state integer maximum")
      if (BigInt(minimum) > BigInt(maximum)) throw new TypeError("Plugin state integer bounds are inverted")
      return Object.freeze({ type: "integer", minimum, maximum })
    }
    if (input.type === "array") {
      exactKeys(input, ["type", "maxItems", "items"])
      return Object.freeze({
        type: "array",
        maxItems: boundedDecimal(input.maxItems, maximumArrayItems, "Array maxItems"),
        items: parseSchema(input.items, depth + 1, budget),
      })
    }
    if (input.type === "object") {
      exactKeys(input, ["type", "maxProperties", "required", "properties", "additionalProperties"])
      if (input.additionalProperties !== false) throw new TypeError("Plugin state object must reject additional properties")
      const maxProperties = boundedDecimal(input.maxProperties, maximumObjectProperties, "Object maxProperties")
      const rawProperties = plainRecord(input.properties, "Plugin state object properties")
      const propertyNames = Object.keys(rawProperties).map((key) => normalizedText(key, "Plugin state property", maximumStringBytes))
      propertyNames.sort(compareUtf8)
      if (propertyNames.length > Number(maxProperties)) throw new TypeError("Plugin state object exceeds maxProperties")
      const properties: Record<string, PortableBoundedValueSchemaV1> = Object.create(null)
      for (const key of propertyNames) properties[key] = parseSchema(rawProperties[key], depth + 1, budget)
      if (!Array.isArray(input.required)) throw new TypeError("Plugin state object required must be an array")
      const required = input.required.map((key) => normalizedText(key, "Plugin state required property", maximumStringBytes))
      required.sort(compareUtf8)
      if (required.some((key, index) => index > 0 && required[index - 1] === key)) {
        throw new TypeError("Plugin state object required contains duplicates")
      }
      if (required.some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) {
        throw new TypeError("Plugin state object required is not a properties subset")
      }
      return Object.freeze({
        type: "object",
        maxProperties,
        required: Object.freeze(required),
        properties: Object.freeze(properties),
        additionalProperties: false,
      })
    }
    if (input.type === "union") {
      exactKeys(input, ["type", "variants"])
      if (!Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > maximumUnionVariants) {
        throw new TypeError("Plugin state union must contain 1..16 variants")
      }
      const variants = input.variants.map((variant) => parseSchema(variant, depth + 1, budget))
      variants.sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)))
      if (variants.some((variant, index) => index > 0 && canonicalJson(variants[index - 1]) === canonicalJson(variant))) {
        throw new TypeError("Plugin state union contains duplicate variants")
      }
      return Object.freeze({ type: "union", variants: Object.freeze(variants) })
    }
    throw new TypeError("Plugin state schema type is unsupported")
  } finally {
    budget.seen.delete(input)
  }
}

function validateValue(schema: PortableBoundedValueSchemaV1, value: unknown, depth: number, budget: ValueBudget): void {
  if (depth > maximumValueDepth) throw new TypeError("Plugin state value exceeds depth 32")
  if (++budget.nodes > maximumValueNodes) throw new TypeError("Plugin state value exceeds 4096 nodes")
  if (schema.type === "null") {
    if (value !== null) throw new TypeError("Plugin state value must be null")
    return
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError("Plugin state value must be boolean")
    return
  }
  if (schema.type === "string") {
    const text = normalizedText(value, "Plugin state string", Number(schema.maxUtf8Bytes))
    if (schema.enum !== undefined && !schema.enum.includes(text)) throw new TypeError("Plugin state string is outside enum")
    return
  }
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Plugin state value must be a safe integer")
    const integer = BigInt(value as number)
    if (integer < BigInt(schema.minimum) || integer > BigInt(schema.maximum)) {
      throw new TypeError("Plugin state integer is outside bounds")
    }
    return
  }
  if (schema.type === "union") {
    const matches = schema.variants.filter((variant) => {
      try {
        validateValue(variant, value, depth + 1, { nodes: budget.nodes, seen: new Set(budget.seen) })
        return true
      } catch {
        return false
      }
    })
    if (matches.length === 0) throw new TypeError("Plugin state value matches no union variant")
    return
  }
  if (!value || typeof value !== "object") throw new TypeError(`Plugin state value must be ${schema.type}`)
  if (budget.seen.has(value)) throw new TypeError("Plugin state value cannot be cyclic")
  budget.seen.add(value)
  try {
    if (schema.type === "array") {
      if (!Array.isArray(value) || value.length > Number(schema.maxItems)) {
        throw new TypeError("Plugin state array exceeds maxItems")
      }
      for (const item of value) validateValue(schema.items, item, depth + 1, budget)
      return
    }
    if (Array.isArray(value)) throw new TypeError("Plugin state value must be an object")
    const input = plainRecord(value, "Plugin state value")
    const keys = Object.keys(input)
    if (keys.length > Number(schema.maxProperties) || keys.length > maximumObjectProperties) {
      throw new TypeError("Plugin state object exceeds maxProperties")
    }
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) throw new TypeError(`Plugin state property is required: ${key}`)
    }
    for (const key of keys) {
      normalizedText(key, "Plugin state property", maximumStringBytes)
      const child = schema.properties[key]
      if (child === undefined) throw new TypeError(`Plugin state property is unsupported: ${key}`)
      validateValue(child, input[key], depth + 1, budget)
    }
  } finally {
    budget.seen.delete(value)
  }
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const admitted = new Set([...required, ...optional])
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) || Object.keys(value).some((key) => !admitted.has(key))) {
    throw new TypeError("Plugin state schema contains unsupported or missing fields")
  }
}

function boundedDecimal(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value) || BigInt(value) > BigInt(maximum)) {
    throw new TypeError(`${label} is not a bounded canonical decimal`)
  }
  return value
}

function safeIntegerDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:0|-?[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`${label} is not a canonical integer`)
  }
  const integer = BigInt(value)
  if (integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${label} exceeds the safe integer range`)
  }
  return value
}

function normalizedText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.normalize("NFC") !== value || encoder.encode(value).byteLength > maximumBytes) {
    throw new TypeError(`${label} must be bounded NFC text`)
  }
  return value
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!
    if (difference !== 0) return difference
  }
  return leftBytes.length - rightBytes.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Canonical Plugin value number must be a safe integer")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const input = plainRecord(value, "Canonical Plugin value")
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
    .join(",")}}`
}
