import type { PluginApiSideEffect } from "@convax/plugin-api"

/** A stable, release-quality semantic version without prerelease/build suffixes. */
export type PluginCapabilityVersion = `${number}.${number}.${number}`

/** An explicit half-open SemVer interval; arbitrary npm range syntax is intentionally unsupported. */
export interface PluginCapabilityVersionRange {
  readonly minimum: PluginCapabilityVersion
  readonly maximumExclusive: PluginCapabilityVersion
}

export type PluginCapabilitySchema =
  | { readonly type: "null" }
  | { readonly type: "boolean" }
  | {
      readonly type: "number"
      readonly minimum?: number
      readonly maximum?: number
    }
  | {
      readonly type: "integer"
      readonly minimum?: number
      readonly maximum?: number
    }
  | {
      readonly type: "string"
      readonly minLength?: number
      readonly maxLength: number
      readonly enum?: readonly string[]
    }
  | {
      readonly type: "array"
      readonly items: PluginCapabilitySchema
      readonly minItems?: number
      readonly maxItems: number
    }
  | PluginCapabilityObjectSchema

export interface PluginCapabilityObjectSchema {
  readonly type: "object"
  readonly properties: Readonly<Record<string, PluginCapabilitySchema>>
  readonly required: readonly string[]
  readonly additionalProperties: false
}

export interface PluginCapabilityDocumentation {
  readonly summary: string
  readonly request: string
  readonly response: string
  readonly remarks?: string
}

export interface PluginCapabilityExport {
  readonly id: string
  readonly version: PluginCapabilityVersion
  /**
   * Exact MCP tool name exposed by the provider's verified mcp-stdio sidecar.
   * It is never an iframe callback, Agent alias, or Host method name.
   */
  readonly operation: string
  readonly sideEffect: PluginApiSideEffect
  readonly inputSchema: PluginCapabilityObjectSchema
  readonly outputSchema: PluginCapabilityObjectSchema
  readonly docs: PluginCapabilityDocumentation
}

export interface PluginCapabilityImport {
  readonly id: string
  /**
   * Caller-owned copy of the portable request contract. ActiveSet planning
   * requires it to match the selected provider export exactly.
   */
  readonly inputSchema: PluginCapabilityObjectSchema
  /** Caller-owned copy of the portable response contract. */
  readonly outputSchema: PluginCapabilityObjectSchema
  readonly version: PluginCapabilityVersionRange
}

export interface PluginCapabilityDeclaration {
  readonly exports: readonly PluginCapabilityExport[]
  readonly imports: {
    readonly required: readonly PluginCapabilityImport[]
    readonly optional: readonly PluginCapabilityImport[]
  }
}

export type PluginCapabilityImportRequirement = "required" | "optional"

export type PluginCapabilityRuntimeUnavailableReason =
  | "setup-required"
  | "disabled"
  | "recovering"
  | "contract-mismatch"

export type PluginCapabilityUnavailableReason =
  | "not-declared"
  | "provider-missing"
  | "provider-incompatible"
  | "provider-ambiguous"
  | "self-provider"
  | "dependency-cycle"
  | PluginCapabilityRuntimeUnavailableReason

export type PluginCapabilityAvailability<Provider = unknown> =
  | {
      readonly available: true
      readonly capabilityId: string
      readonly requirement: PluginCapabilityImportRequirement
      readonly provider: Provider
      readonly version: PluginCapabilityVersion
    }
  | {
      readonly available: false
      readonly capabilityId: string
      readonly requirement?: PluginCapabilityImportRequirement
      readonly reason: PluginCapabilityUnavailableReason
      readonly recoverable: boolean
    }

export interface PluginCapabilityRuntimeToolDefinition {
  readonly inputSchema: unknown
  readonly name: string
  readonly outputSchema?: unknown
}

const capabilityIdPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/
const operationIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const propertyNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const sideEffects = new Set<PluginApiSideEffect>(["none", "read", "write", "execute", "subscribe"])
const maximumCapabilities = 128
const maximumProperties = 64
const maximumSchemaDepth = 8
const maximumStringLength = 16 * 1024
const maximumArrayItems = 256

export function isPluginCapabilityId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && capabilityIdPattern.test(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`)
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
) {
  const expected = new Set([...required, ...optional])
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new TypeError(`${label} contains unsupported or missing fields`)
  }
}

function text(value: unknown, label: string, maximum = 2_000) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded, trimmed string`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`${label} must be a bounded non-negative integer`)
  }
  return Number(value)
}

function version(value: unknown, label: string): PluginCapabilityVersion {
  if (typeof value !== "string" || !semverPattern.test(value)) {
    throw new TypeError(`${label} must be a strict semantic version`)
  }
  return value as PluginCapabilityVersion
}

function compareVersions(left: PluginCapabilityVersion, right: PluginCapabilityVersion) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    const comparison = leftParts[index]! - rightParts[index]!
    if (comparison !== 0) return comparison
  }
  return 0
}

export function isPluginCapabilityVersionCompatible(
  candidate: PluginCapabilityVersion,
  range: PluginCapabilityVersionRange,
) {
  return compareVersions(candidate, range.minimum) >= 0 && compareVersions(candidate, range.maximumExclusive) < 0
}

function normalizeSchema(value: unknown, label: string, depth: number): PluginCapabilitySchema {
  if (depth > maximumSchemaDepth) throw new TypeError(`${label} exceeds the schema depth limit`)
  const input = record(value, label)
  if (input.type === "null" || input.type === "boolean") {
    exactKeys(input, ["type"], [], label)
    return Object.freeze({ type: input.type })
  }
  if (input.type === "number" || input.type === "integer") {
    exactKeys(input, ["type"], ["minimum", "maximum"], label)
    const minimum = input.minimum
    const maximum = input.maximum
    if (minimum !== undefined && (typeof minimum !== "number" || !Number.isFinite(minimum))) {
      throw new TypeError(`${label}.minimum must be finite`)
    }
    if (maximum !== undefined && (typeof maximum !== "number" || !Number.isFinite(maximum))) {
      throw new TypeError(`${label}.maximum must be finite`)
    }
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new TypeError(`${label} minimum exceeds maximum`)
    }
    return Object.freeze({
      type: input.type,
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
    })
  }
  if (input.type === "string") {
    if (!Object.prototype.hasOwnProperty.call(input, "maxLength")) {
      throw new TypeError(`${label}.maxLength is required to keep values bounded`)
    }
    exactKeys(input, ["type", "maxLength"], ["minLength", "enum"], label)
    const maxLength = nonNegativeInteger(input.maxLength, `${label}.maxLength`, maximumStringLength)
    const minLength =
      input.minLength === undefined ? undefined : nonNegativeInteger(input.minLength, `${label}.minLength`, maxLength)
    let enumeration: readonly string[] | undefined
    if (input.enum !== undefined) {
      if (
        !Array.isArray(input.enum) ||
        input.enum.length < 1 ||
        input.enum.length > 128 ||
        input.enum.some((entry) => typeof entry !== "string" || entry.length > maxLength) ||
        new Set(input.enum).size !== input.enum.length
      ) {
        throw new TypeError(`${label}.enum must contain unique bounded strings`)
      }
      enumeration = Object.freeze([...input.enum])
    }
    return Object.freeze({
      type: "string",
      maxLength,
      ...(minLength === undefined ? {} : { minLength }),
      ...(enumeration === undefined ? {} : { enum: enumeration }),
    })
  }
  if (input.type === "array") {
    exactKeys(input, ["type", "items", "maxItems"], ["minItems"], label)
    const maxItems = nonNegativeInteger(input.maxItems, `${label}.maxItems`, maximumArrayItems)
    const minItems =
      input.minItems === undefined ? undefined : nonNegativeInteger(input.minItems, `${label}.minItems`, maxItems)
    return Object.freeze({
      type: "array",
      items: normalizeSchema(input.items, `${label}.items`, depth + 1),
      maxItems,
      ...(minItems === undefined ? {} : { minItems }),
    })
  }
  if (input.type === "object") {
    exactKeys(input, ["type", "properties", "required", "additionalProperties"], [], label)
    if (input.additionalProperties !== false) throw new TypeError(`${label}.additionalProperties must be false`)
    const rawProperties = record(input.properties, `${label}.properties`)
    const propertyNames = Object.keys(rawProperties)
    if (propertyNames.length > maximumProperties) throw new TypeError(`${label} has too many properties`)
    if (propertyNames.some((name) => !propertyNamePattern.test(name))) {
      throw new TypeError(`${label} contains an invalid property name`)
    }
    if (
      !Array.isArray(input.required) ||
      input.required.some((name) => typeof name !== "string" || !propertyNames.includes(name)) ||
      new Set(input.required).size !== input.required.length
    ) {
      throw new TypeError(`${label}.required must contain unique declared properties`)
    }
    const properties = Object.fromEntries(
      propertyNames
        .sort()
        .map((name) => [name, normalizeSchema(rawProperties[name], `${label}.properties.${name}`, depth + 1)]),
    )
    return Object.freeze({
      type: "object",
      properties: Object.freeze(properties),
      required: Object.freeze([...(input.required as string[])].sort()),
      additionalProperties: false,
    })
  }
  throw new TypeError(`${label}.type is unsupported`)
}

function objectSchema(value: unknown, label: string) {
  const schema = normalizeSchema(value, label, 0)
  if (schema.type !== "object") throw new TypeError(`${label} must be a closed object schema`)
  return schema
}

function normalizeImport(value: unknown, label: string): PluginCapabilityImport {
  const input = record(value, label)
  exactKeys(input, ["id", "inputSchema", "outputSchema", "version"], [], label)
  const id = text(input.id, `${label}.id`, 160)
  if (!isPluginCapabilityId(id)) throw new TypeError(`${label}.id is invalid`)
  const range = record(input.version, `${label}.version`)
  exactKeys(range, ["minimum", "maximumExclusive"], [], `${label}.version`)
  const minimum = version(range.minimum, `${label}.version.minimum`)
  const maximumExclusive = version(range.maximumExclusive, `${label}.version.maximumExclusive`)
  if (compareVersions(minimum, maximumExclusive) >= 0) {
    throw new TypeError(`${label}.version must be a non-empty half-open interval`)
  }
  return Object.freeze({
    id,
    inputSchema: objectSchema(input.inputSchema, `${label}.inputSchema`),
    outputSchema: objectSchema(input.outputSchema, `${label}.outputSchema`),
    version: Object.freeze({ minimum, maximumExclusive }),
  })
}

function normalizeImports(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > maximumCapabilities) {
    throw new TypeError(`${label} must be a bounded array`)
  }
  const imports = value
    .map((entry, index) => normalizeImport(entry, `${label}[${index}]`))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (imports.some((entry, index) => index > 0 && imports[index - 1]!.id === entry.id)) {
    throw new TypeError(`${label} contains a duplicate capability id`)
  }
  return Object.freeze(imports)
}

function normalizeExport(value: unknown, label: string): PluginCapabilityExport {
  const input = record(value, label)
  exactKeys(input, ["id", "version", "operation", "sideEffect", "inputSchema", "outputSchema", "docs"], [], label)
  const id = text(input.id, `${label}.id`, 160)
  if (!isPluginCapabilityId(id)) throw new TypeError(`${label}.id is invalid`)
  const operation = text(input.operation, `${label}.operation`, 128)
  if (!operationIdPattern.test(operation)) throw new TypeError(`${label}.operation is invalid`)
  if (!sideEffects.has(input.sideEffect as PluginApiSideEffect)) throw new TypeError(`${label}.sideEffect is invalid`)
  const rawDocs = record(input.docs, `${label}.docs`)
  exactKeys(rawDocs, ["summary", "request", "response"], ["remarks"], `${label}.docs`)
  const docs = Object.freeze({
    summary: text(rawDocs.summary, `${label}.docs.summary`),
    request: text(rawDocs.request, `${label}.docs.request`),
    response: text(rawDocs.response, `${label}.docs.response`),
    ...(rawDocs.remarks === undefined ? {} : { remarks: text(rawDocs.remarks, `${label}.docs.remarks`) }),
  })
  return Object.freeze({
    id,
    version: version(input.version, `${label}.version`),
    operation,
    sideEffect: input.sideEffect as PluginApiSideEffect,
    inputSchema: objectSchema(input.inputSchema, `${label}.inputSchema`),
    outputSchema: objectSchema(input.outputSchema, `${label}.outputSchema`),
    docs,
  })
}

/**
 * Parses the portable capability section embedded by the canonical Plugin manifest parser.
 * This function does not select providers or consult Host state.
 */
export function parsePluginCapabilityDeclaration(value: unknown): PluginCapabilityDeclaration {
  const input = record(value, "Plugin capability declaration")
  exactKeys(input, ["exports", "imports"], [], "Plugin capability declaration")
  if (!Array.isArray(input.exports) || input.exports.length > maximumCapabilities) {
    throw new TypeError("Plugin capability exports must be a bounded array")
  }
  const exports = input.exports
    .map((entry, index) => normalizeExport(entry, `Plugin capability exports[${index}]`))
    .sort((left, right) => left.id.localeCompare(right.id))
  if (exports.some((entry, index) => index > 0 && exports[index - 1]!.id === entry.id)) {
    throw new TypeError("Plugin capability exports contain a duplicate capability id")
  }
  if (new Set(exports.map((entry) => entry.operation)).size !== exports.length) {
    throw new TypeError("Plugin capability exports contain a duplicate provider operation")
  }
  const rawImports = record(input.imports, "Plugin capability imports")
  exactKeys(rawImports, ["required", "optional"], [], "Plugin capability imports")
  const required = normalizeImports(rawImports.required, "Plugin required capability imports")
  const optional = normalizeImports(rawImports.optional, "Plugin optional capability imports")
  const requiredIds = new Set(required.map(({ id }) => id))
  const overlap = optional.find(({ id }) => requiredIds.has(id))
  if (overlap) throw new TypeError(`Plugin capability import cannot be both required and optional: ${overlap.id}`)
  return Object.freeze({
    exports: Object.freeze(exports),
    imports: Object.freeze({ required, optional }),
  })
}

function sameSchema(left: PluginCapabilityObjectSchema, right: PluginCapabilityObjectSchema) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Provider selection is compatible only when the version and both portable
 * schemas match the caller import. A version match alone would let the Web
 * client and provider validate different contracts.
 */
export function isPluginCapabilityContractCompatible(
  imported: PluginCapabilityImport,
  exported: PluginCapabilityExport,
) {
  return (
    imported.id === exported.id &&
    isPluginCapabilityVersionCompatible(exported.version, imported.version) &&
    sameSchema(imported.inputSchema, exported.inputSchema) &&
    sameSchema(imported.outputSchema, exported.outputSchema)
  )
}

/**
 * Main-side ready gate for inter-Plugin exports.
 *
 * Call this with one complete `tools/list` result from the already verified
 * provider snapshot. Every declared export must resolve to one exact MCP tool,
 * and both closed schemas must normalize to the manifest schemas. Extra MCP
 * tools are allowed because the sidecar may also serve generation or service
 * contributions; they never become inter-Plugin operations implicitly.
 */
export function assertPluginCapabilityRuntimeTools(
  exports: readonly PluginCapabilityExport[],
  tools: readonly PluginCapabilityRuntimeToolDefinition[],
): void {
  const toolsByName = new Map<string, PluginCapabilityRuntimeToolDefinition[]>()
  for (const tool of tools) {
    const name = text(tool.name, "Runtime MCP tool name", 128)
    if (!operationIdPattern.test(name)) {
      throw new TypeError(`Runtime MCP tool name is invalid: ${name}`)
    }
    const existing = toolsByName.get(name)
    if (existing) existing.push(tool)
    else toolsByName.set(name, [tool])
  }
  for (const exported of exports) {
    const matches = toolsByName.get(exported.operation) ?? []
    if (matches.length !== 1) {
      throw new TypeError(
        `Plugin capability operation must resolve to exactly one runtime MCP tool: ${exported.operation}`,
      )
    }
    const runtimeTool = matches[0]!
    const inputSchema = objectSchema(runtimeTool.inputSchema, `Runtime MCP tool ${exported.operation} inputSchema`)
    if (!sameSchema(exported.inputSchema, inputSchema)) {
      throw new TypeError(`Plugin capability input schema does not match runtime MCP tool: ${exported.operation}`)
    }
    if (runtimeTool.outputSchema === undefined) {
      throw new TypeError(`Plugin capability runtime MCP tool must declare outputSchema: ${exported.operation}`)
    }
    const outputSchema = objectSchema(runtimeTool.outputSchema, `Runtime MCP tool ${exported.operation} outputSchema`)
    if (!sameSchema(exported.outputSchema, outputSchema)) {
      throw new TypeError(`Plugin capability output schema does not match runtime MCP tool: ${exported.operation}`)
    }
  }
}

function validateValue(schema: PluginCapabilitySchema, value: unknown, label: string, seen: Set<object>): void {
  if (schema.type === "null") {
    if (value !== null) throw new TypeError(`${label} must be null`)
    return
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`)
    return
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value))
    ) {
      throw new TypeError(`${label} must be a finite ${schema.type === "integer" ? "safe integer" : "number"}`)
    }
    if (schema.minimum !== undefined && value < schema.minimum) throw new TypeError(`${label} is below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) throw new TypeError(`${label} exceeds maximum`)
    return
  }
  if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length < (schema.minLength ?? 0) ||
      value.length > schema.maxLength ||
      (schema.enum !== undefined && !schema.enum.includes(value))
    ) {
      throw new TypeError(`${label} is not an admitted string`)
    }
    return
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must be ${schema.type}`)
  }
  if (seen.has(value)) throw new TypeError(`${label} cannot be cyclic`)
  seen.add(value)
  try {
    if (schema.type === "array") {
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > schema.maxItems) {
        throw new TypeError(`${label} is not an admitted array`)
      }
      value.forEach((entry, index) => validateValue(schema.items, entry, `${label}[${index}]`, seen))
      return
    }
    if (Array.isArray(value)) throw new TypeError(`${label} must be an object`)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`)
    const object = value as Record<string, unknown>
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) throw new TypeError(`${label}.${key} is required`)
    }
    for (const [key, child] of Object.entries(object)) {
      const childSchema = schema.properties[key]
      if (!childSchema) throw new TypeError(`${label} contains unsupported property: ${key}`)
      validateValue(childSchema, child, `${label}.${key}`, seen)
    }
  } finally {
    seen.delete(value)
  }
}

/** Validates one request or response against the admitted bounded schema. */
export function assertPluginCapabilityValue(
  schema: PluginCapabilitySchema,
  value: unknown,
  label = "Plugin capability value",
): void {
  validateValue(schema, value, label, new Set())
}

function escapeCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

/** Renders `references/plugin-capabilities.md` for a Plugin-owned Skill bundle. */
export function renderPluginCapabilityReference(declarationInput: PluginCapabilityDeclaration): string {
  const declaration = parsePluginCapabilityDeclaration(declarationInput)
  const imports = [
    ...declaration.imports.required.map((entry) => ({ ...entry, requirement: "required" as const })),
    ...declaration.imports.optional.map((entry) => ({ ...entry, requirement: "optional" as const })),
  ].sort((left, right) => left.id.localeCompare(right.id))
  const lines = [
    "<!-- prettier-ignore-start -->",
    "",
    "# Convax Plugin capabilities",
    "",
    "<!-- Generated by @convax/plugin-sdk. Do not edit. -->",
    "",
    "Provider availability is bound to one immutable ActivePluginSet. Check optional imports immediately before use.",
    "The Host revalidates both snapshots and both schemas for every call; provider code runs only with provider grants.",
    "An exported operation is the exact MCP tool name of the provider's verified mcp-stdio sidecar. It becomes ready only after Main matches tools/list inputSchema and outputSchema to this closed manifest contract.",
    "",
    "## Calling imported capabilities from a Web Plugin",
    "",
    "Use `createPluginHostClient` from `@convax/plugin-sdk/client` with the validated Plugin manifest and the Host-transferred MessagePort.",
    "A Web client requires `entry` and `hostApi.required` containing `host.context.get`; static Plugins that do not open a MessagePort do not create this client.",
    "`convax.plugin-host/8` is the only author-facing Web ABI. `convax.plugin-capability/3` is Host-internal renderer/Main and verified-sidecar transport and must never be authored or sent by a Plugin.",
    "Check Host API availability with `client.getHostApiAvailability(id)` or require it with `client.requireHostApi(id)`; pass `{ refresh: true }` to renegotiate `host.context.get` explicitly.",
    "Host API calls use `client.callHostApi(...)`. Inter-Plugin calls use only `client.getCapabilityAvailability(...)` and `client.invokeCapability(...)`; they never name a provider Plugin.",
    "Remote failures are closed `{ kind, code, message, recoverable }` objects. API codes come from the exact Catalog method; protocol and inter-Plugin failures use separate stable code sets.",
    "The client rejects undeclared imports, validates request and response values against the manifest schemas, bounds messages and in-flight calls, and sends a sender-scoped cancel envelope when the supplied `AbortSignal` aborts.",
    "",
    "## Imported capabilities",
    "",
  ]
  if (imports.length === 0) {
    lines.push("This Plugin does not import another Plugin capability.", "")
  } else {
    lines.push("| Capability | Requirement | Compatible versions |", "| --- | --- | --- |")
    for (const entry of imports) {
      lines.push(
        `| \`${entry.id}\` | ${entry.requirement} | \`>=${entry.version.minimum} <${entry.version.maximumExclusive}\` |`,
      )
    }
    lines.push("")
    for (const entry of imports) {
      lines.push(
        `### Imported \`${entry.id}\``,
        "",
        `Requirement: ${entry.requirement}. Compatible versions: \`>=${entry.version.minimum} <${entry.version.maximumExclusive}\`.`,
        "",
        "Input schema:",
        "",
        "```json",
        JSON.stringify(entry.inputSchema, null, 2),
        "```",
        "",
        "Output schema:",
        "",
        "```json",
        JSON.stringify(entry.outputSchema, null, 2),
        "```",
        "",
        "Typed Web client:",
        "",
        "```ts",
        `const availability = await client.getCapabilityAvailability("${entry.id}", { signal })`,
        "if (availability.available) {",
        `  const result = await client.invokeCapability("${entry.id}", input, { signal })`,
        "  // result is validated against the generated output contract.",
        "}",
        "```",
        "",
      )
    }
  }
  lines.push("## Exported capabilities", "")
  if (declaration.exports.length === 0) {
    lines.push("This Plugin does not export an inter-Plugin capability.", "")
  } else {
    lines.push("| Capability | Version | Operation | Side effect | Summary |", "| --- | --- | --- | --- | --- |")
    for (const entry of declaration.exports) {
      lines.push(
        `| \`${entry.id}\` | ${entry.version} | \`${entry.operation}\` | ${entry.sideEffect} | ${escapeCell(entry.docs.summary)} |`,
      )
    }
    lines.push("")
    for (const entry of declaration.exports) {
      lines.push(
        `### \`${entry.id}\``,
        "",
        entry.docs.summary,
        "",
        `- Version: ${entry.version}`,
        `- Provider operation: \`${entry.operation}\``,
        `- Side effect: ${entry.sideEffect}`,
        `- Request: ${entry.docs.request}`,
        `- Response: ${entry.docs.response}`,
      )
      if (entry.docs.remarks) lines.push(`- Remarks: ${entry.docs.remarks}`)
      lines.push("", "Input schema:", "", "```json", JSON.stringify(entry.inputSchema, null, 2), "```", "")
      lines.push("Output schema:", "", "```json", JSON.stringify(entry.outputSchema, null, 2), "```", "")
    }
  }
  lines.push("<!-- prettier-ignore-end -->")
  return `${lines.join("\n")}\n`
}
