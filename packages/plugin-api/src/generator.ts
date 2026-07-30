import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { pluginApiCatalog } from "./catalog"
import {
  PLUGIN_API_CATALOG_ARTIFACT_SCHEMA,
  type PluginApiCatalogSnapshot,
  type PluginApiContractSnapshot,
  type PluginApiDefinitionSnapshot,
} from "./catalog-artifact"
import {
  definePluginApi,
  pluginApiContractInternals,
  type PluginApiCatalog,
  type PluginApiAudience,
  type PluginApiCompletion,
  type PluginApiDefinition,
  type PluginApiScope,
  type PluginApiSideEffect,
  type PluginApiVersion,
} from "./contracts"
import { pluginApiMethodContracts, type PluginApiObjectShape } from "./method-contracts"
import type {
  PluginApiContractId,
  PluginApiWireContract,
  PluginApiWireLimit,
  PluginApiWireSchema,
} from "./method-schemas"
import { pluginApiWireSchemaDialect } from "./method-schemas"

export type {
  PluginApiCatalogSnapshot,
  PluginApiContractSnapshot,
  PluginApiDefinitionSnapshot,
} from "./catalog-artifact"

/**
 * A compatibility failure between two published Host API catalog snapshots.
 *
 * @public
 */
export interface PluginApiCompatibilityIssue {
  readonly kind: "invalid-version" | "api-added" | "api-removed" | "api-changed"
  readonly apiId?: string
  readonly message: string
}

/**
 * Filesystem locations used by the Host API artifact generator.
 *
 * @public
 */
export interface PluginApiGeneratorOptions {
  readonly outputDirectory: string
  readonly historyDirectory: string
  readonly check?: boolean
}

/**
 * Result of generating or checking deterministic Host API artifacts.
 *
 * @public
 */
export interface PluginApiGeneratorResult {
  readonly changed: readonly string[]
  readonly checked: boolean
}

type Snapshot = PluginApiCatalogSnapshot
type CatalogInput = PluginApiCatalog | PluginApiCatalogSnapshot

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecord(entry)]),
  )
}

function stableJson(value: unknown): string {
  const expanded = JSON.stringify(sortRecord(value), null, 2)
  const compactAudience = expanded.replace(
    /"audience": \[\n((?:\s+"(?:[^"\\]|\\.)*"(?:,)?\n)+)\s+\]/g,
    (_match, entries: string) => {
      const values = [...entries.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((entry) => `"${entry[1]}"`)
      return `"audience": [${values.join(", ")}]`
    },
  )
  return `${compactAudience}\n`
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknown) throw new TypeError(`${label} contains unknown field: ${unknown}`)
}

function contractDigest(contract: PluginApiWireContract): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(contract)).digest("hex")}`
}

function normalizedContract(contract: PluginApiWireContract): PluginApiContractSnapshot {
  const portable = sortRecord(contract) as unknown as PluginApiWireContract
  return {
    dialect: portable.dialect,
    digest: contractDigest(portable),
    request: portable.request,
    result: portable.result,
  }
}

function normalizedDefinition(
  definition: PluginApiDefinition | PluginApiDefinitionSnapshot,
): PluginApiDefinitionSnapshot {
  const sourceContract =
    "contract" in definition
      ? {
          dialect: definition.contract.dialect,
          request: definition.contract.request,
          result: definition.contract.result,
        }
      : pluginApiMethodContracts[definition.id as PluginApiContractId]
        ? {
            dialect: pluginApiMethodContracts[definition.id as PluginApiContractId].dialect,
            request: pluginApiMethodContracts[definition.id as PluginApiContractId].request,
            result: pluginApiMethodContracts[definition.id as PluginApiContractId].response,
          }
        : undefined
  if (!sourceContract) {
    throw new TypeError(`Plugin API ${definition.id} is missing its portable request/result contract`)
  }
  return {
    id: definition.id,
    since: definition.since,
    audience: [...definition.audience].sort(),
    completion: definition.completion,
    grant: definition.grant,
    scope: definition.scope,
    sideEffect: definition.sideEffect,
    errors: [...definition.errors]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((error) => ({ ...error })),
    docs: { ...definition.docs },
    contract: normalizedContract(sourceContract),
  }
}

/**
 * Creates the normalized immutable data emitted to JSON and compatibility history.
 *
 * @public
 */
export function snapshotPluginApiCatalog(catalog: CatalogInput = pluginApiCatalog): Snapshot {
  return {
    schema: PLUGIN_API_CATALOG_ARTIFACT_SCHEMA,
    version: catalog.version,
    apis: [...catalog.apis].sort((left, right) => left.id.localeCompare(right.id)).map(normalizedDefinition),
  }
}

/**
 * Renders the deterministic machine-readable Host API catalog.
 *
 * @public
 */
export function renderPluginApiJson(catalog: CatalogInput = pluginApiCatalog): string {
  return stableJson(snapshotPluginApiCatalog(catalog))
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

function renderMethodShape(shape: { readonly type: "none" } | PluginApiObjectShape): string {
  if (shape.type === "none") return "`none`"
  const fields = [
    ...shape.required.map((name) => `${name} (required)`),
    ...shape.optional.map((name) => `${name} (optional)`),
  ]
  return fields.length === 0
    ? "`{}` (closed object)"
    : `closed object: ${fields.map((field) => `\`${field}\``).join(", ")}`
}

/**
 * Renders the deterministic human-readable Host API catalog from structured metadata.
 *
 * @public
 */
export function renderPluginApiMarkdown(catalog: CatalogInput = pluginApiCatalog): string {
  const snapshot = snapshotPluginApiCatalog(catalog)
  const lines = [
    "<!-- prettier-ignore-start -->",
    "",
    "# Convax Host API",
    "",
    "<!-- Generated by @convax/plugin-api. Do not edit. -->",
    "",
    `Catalog version: ${snapshot.version}`,
    "",
    'Host API failures use the closed `{ kind: "api", code, message, recoverable }` envelope.',
    "The code and recoverability must match the exact API error table below; malformed requests and transport failures use the separate SDK protocol-error namespace.",
    "Request and response byte limits are UTF-8 JSON envelope limits and are enforced per API.",
    "",
    "| API | Since | Audience | Grant | Scope | Side effect | Completion | Errors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const definition of snapshot.apis) {
    lines.push(
      `| \`${definition.id}\` | ${definition.since} | ${definition.audience.join(", ")} | ${
        definition.grant ? `\`${definition.grant}\`` : "none"
      } | ${definition.scope} | ${definition.sideEffect} | ${definition.completion} | ${definition.errors.map((error) => `\`${error.code}\``).join(", ")} |`,
    )
  }
  lines.push("")

  for (const definition of snapshot.apis) {
    lines.push(
      `## \`${definition.id}\``,
      "",
      definition.docs.summary,
      "",
      definition.docs.description,
      "",
      `- Since: ${definition.since}`,
      `- Audience: ${definition.audience.join(", ")}`,
      `- Grant: ${definition.grant ? `\`${definition.grant}\`` : "none"}`,
      `- Scope: ${definition.scope}`,
      `- Side effect: ${definition.sideEffect}`,
      `- Completion: ${definition.completion}`,
      `- Request: ${definition.docs.request}`,
      `- Response: ${definition.docs.response}`,
      `- Request schema: ${renderMethodShape(pluginApiMethodContracts[definition.id as keyof typeof pluginApiMethodContracts].params)}`,
      `- Response schema: ${renderMethodShape(pluginApiMethodContracts[definition.id as keyof typeof pluginApiMethodContracts].result)}`,
      `- Request byte limit: ${definition.contract.request.maxBytes}`,
      `- Response byte limit: ${definition.contract.result.maxBytes}`,
      `- Contract digest: \`${definition.contract.digest}\``,
      `- Contract dialect: \`${definition.contract.dialect}\``,
    )
    if (definition.docs.remarks) lines.push(`- Remarks: ${definition.docs.remarks}`)
    lines.push(
      "",
      "#### Request contract",
      "",
      "```json",
      stableJson(definition.contract.request).trimEnd(),
      "```",
      "",
      "#### Response contract",
      "",
      "```json",
      stableJson(definition.contract.result).trimEnd(),
      "```",
    )
    lines.push("", "### Errors", "")
    if (definition.errors.length === 0) {
      lines.push("No stable API-specific errors.", "")
    } else {
      lines.push("| Code | Recoverable | Meaning |", "| --- | --- | --- |")
      for (const error of definition.errors) {
        lines.push(`| \`${error.code}\` | ${error.recoverable ? "yes" : "no"} | ${markdownCell(error.description)} |`)
      }
      lines.push("")
    }
  }
  lines.push("<!-- prettier-ignore-end -->")
  return `${lines.join("\n")}\n`
}

function versionParts(version: PluginApiVersion): readonly [major: number, minor: number, patch: number] {
  const [major, minor, patch] = version.split(".")
  return [Number(major), Number(minor), Number(patch)]
}

function breakingProjection(definition: PluginApiDefinition): unknown {
  return {
    id: definition.id,
    since: definition.since,
    audience: [...definition.audience].sort(),
    grant: definition.grant,
    scope: definition.scope,
    sideEffect: definition.sideEffect,
    completion: definition.completion,
    errors: [...definition.errors]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((error) => ({ code: error.code, recoverable: error.recoverable })),
    request: definition.docs.request,
    response: definition.docs.response,
    contract: "contract" in definition ? definition.contract : undefined,
  }
}

/**
 * Compares two catalog snapshots using the package's conservative SemVer policy.
 *
 * @public
 */
export function checkPluginApiCompatibility(
  previousCatalog: CatalogInput,
  nextCatalog: CatalogInput,
): readonly PluginApiCompatibilityIssue[] {
  const previous = snapshotPluginApiCatalog(previousCatalog)
  const next = snapshotPluginApiCatalog(nextCatalog)
  const issues: PluginApiCompatibilityIssue[] = []
  const versionComparison = pluginApiContractInternals.compareVersions(previous.version, next.version)
  if (versionComparison >= 0) {
    issues.push({
      kind: "invalid-version",
      message: `Catalog version must increase from ${previous.version}, received ${next.version}`,
    })
    return issues
  }

  const [previousMajor, previousMinor] = versionParts(previous.version)
  const [nextMajor, nextMinor] = versionParts(next.version)
  const majorChanged = nextMajor > previousMajor
  const minorChanged = nextMajor === previousMajor && nextMinor > previousMinor
  const previousById = new Map(previous.apis.map((definition) => [definition.id, definition]))
  const nextById = new Map(next.apis.map((definition) => [definition.id, definition]))

  for (const definition of previous.apis) {
    const nextDefinition = nextById.get(definition.id)
    if (!nextDefinition) {
      if (!majorChanged) {
        issues.push({
          kind: "api-removed",
          apiId: definition.id,
          message: `Removing Plugin API ${definition.id} requires a major version`,
        })
      }
      continue
    }
    if (definition.since !== nextDefinition.since) {
      issues.push({
        kind: "api-changed",
        apiId: definition.id,
        message: `Plugin API ${definition.id} since is immutable`,
      })
      continue
    }
    if (
      stableJson(breakingProjection(definition)) !== stableJson(breakingProjection(nextDefinition)) &&
      !majorChanged
    ) {
      issues.push({
        kind: "api-changed",
        apiId: definition.id,
        message: `Changing Plugin API ${definition.id} requires a major version`,
      })
    }
  }

  for (const definition of next.apis) {
    if (!previousById.has(definition.id) && !majorChanged && !minorChanged) {
      issues.push({
        kind: "api-added",
        apiId: definition.id,
        message: `Adding Plugin API ${definition.id} requires a minor version`,
      })
    }
  }
  return issues
}

function assertWireSchema(value: unknown, label: string, depth = 0): asserts value is PluginApiWireSchema {
  if (depth > 64 || !isRecord(value)) throw new TypeError(`${label} is not a bounded wire schema`)
  if (Array.isArray(value.oneOf)) {
    assertExactKeys(value, ["oneOf"], label)
    if (value.oneOf.length < 1 || value.oneOf.length > 32) throw new TypeError(`${label} oneOf is invalid`)
    value.oneOf.forEach((entry, index) => assertWireSchema(entry, `${label}.oneOf[${index}]`, depth + 1))
    return
  }
  if ("const" in value) {
    assertExactKeys(value, ["const"], label)
    if (
      !["boolean", "number", "string"].includes(typeof value.const) ||
      (typeof value.const === "number" && !Number.isFinite(value.const))
    ) {
      throw new TypeError(`${label} const is invalid`)
    }
    return
  }
  if (value.type === "none" || value.type === "boolean" || value.type === "null") {
    assertExactKeys(value, ["type"], label)
    return
  }
  if (value.type === "integer" || value.type === "number") {
    assertExactKeys(value, ["finite", "maximum", "minimum", "type"], label)
    if (
      value.finite !== true ||
      (value.minimum !== undefined && (typeof value.minimum !== "number" || !Number.isFinite(value.minimum))) ||
      (value.maximum !== undefined && (typeof value.maximum !== "number" || !Number.isFinite(value.maximum))) ||
      (typeof value.minimum === "number" && typeof value.maximum === "number" && value.maximum < value.minimum)
    ) {
      throw new TypeError(`${label} number contract is invalid`)
    }
    return
  }
  if (value.type === "string") {
    assertExactKeys(
      value,
      ["controlCharacters", "enum", "maxLength", "minLength", "prefix", "refinement", "type"],
      label,
    )
    if (
      value.controlCharacters !== false ||
      !Number.isSafeInteger(value.maxLength) ||
      !Number.isSafeInteger(value.minLength) ||
      Number(value.minLength) < 0 ||
      Number(value.maxLength) < Number(value.minLength) ||
      Number(value.maxLength) > 32 * 1024 * 1024 ||
      !(value.prefix === undefined || typeof value.prefix === "string") ||
      !(
        value.refinement === undefined ||
        value.refinement === "lowercase-sha256" ||
        value.refinement === "portable-project-relative-path" ||
        value.refinement === "safe-png-file-name" ||
        value.refinement === "trimmed"
      ) ||
      !(
        value.enum === undefined ||
        (Array.isArray(value.enum) && value.enum.length > 0 && value.enum.every((entry) => typeof entry === "string"))
      )
    ) {
      throw new TypeError(`${label} string contract is invalid`)
    }
    return
  }
  if (value.type === "array") {
    assertExactKeys(value, ["items", "maxItems", "minItems", "type", "uniqueBy"], label)
    if (
      !Number.isSafeInteger(value.maxItems) ||
      !Number.isSafeInteger(value.minItems) ||
      Number(value.minItems) < 0 ||
      Number(value.maxItems) < Number(value.minItems) ||
      Number(value.maxItems) > 10_000 ||
      !(value.uniqueBy === undefined || (typeof value.uniqueBy === "string" && value.uniqueBy.length > 0))
    ) {
      throw new TypeError(`${label} array contract is invalid`)
    }
    assertWireSchema(value.items, `${label}.items`, depth + 1)
    return
  }
  if (value.type === "object") {
    assertExactKeys(value, ["additionalProperties", "products", "properties", "required", "type"], label)
    if (
      value.additionalProperties !== false ||
      !isRecord(value.properties) ||
      !Array.isArray(value.required) ||
      !value.required.every((entry) => typeof entry === "string") ||
      new Set(value.required).size !== value.required.length ||
      value.required.some((entry) => !Object.prototype.hasOwnProperty.call(value.properties, entry))
    ) {
      throw new TypeError(`${label} object contract is invalid`)
    }
    for (const [key, entry] of Object.entries(value.properties)) {
      if (key.length < 1 || key.length > 128) throw new TypeError(`${label} property name is invalid`)
      assertWireSchema(entry, `${label}.properties.${key}`, depth + 1)
    }
    if (value.products !== undefined) {
      if (!Array.isArray(value.products) || value.products.length < 1 || value.products.length > 16) {
        throw new TypeError(`${label} product constraints are invalid`)
      }
      for (const [index, candidate] of value.products.entries()) {
        const productLabel = `${label}.products[${index}]`
        if (!isRecord(candidate)) throw new TypeError(`${productLabel} must be an object`)
        assertExactKeys(candidate, ["fields", "maximum"], productLabel)
        if (
          !Array.isArray(candidate.fields) ||
          candidate.fields.length < 2 ||
          candidate.fields.length > 8 ||
          !candidate.fields.every((field) => typeof field === "string" && field.length >= 1 && field.length <= 128) ||
          new Set(candidate.fields).size !== candidate.fields.length ||
          !Number.isSafeInteger(candidate.maximum) ||
          Number(candidate.maximum) < 1
        ) {
          throw new TypeError(`${productLabel} is invalid`)
        }
        for (const field of candidate.fields) {
          if (typeof field !== "string") throw new TypeError(`${productLabel} field is invalid`)
          const factor = value.properties[field]
          if (
            !value.required.includes(field) ||
            !isRecord(factor) ||
            (factor.type !== "integer" && factor.type !== "number") ||
            factor.finite !== true ||
            typeof factor.minimum !== "number" ||
            factor.minimum < 0
          ) {
            throw new TypeError(`${productLabel}.${field} is not a required non-negative numeric property`)
          }
        }
      }
    }
    return
  }
  if (value.type === "json-object") {
    assertExactKeys(value, ["keyMaxLength", "maxBytes", "maxDepth", "type"], label)
    if (
      !Number.isSafeInteger(value.keyMaxLength) ||
      !Number.isSafeInteger(value.maxBytes) ||
      !Number.isSafeInteger(value.maxDepth) ||
      Number(value.keyMaxLength) < 1 ||
      Number(value.maxBytes) < 1 ||
      Number(value.maxBytes) > 32 * 1024 * 1024 ||
      Number(value.maxDepth) < 1 ||
      Number(value.maxDepth) > 64
    ) {
      throw new TypeError(`${label} JSON object contract is invalid`)
    }
    return
  }
  throw new TypeError(`${label} has an unknown wire schema kind`)
}

function parseContractSnapshot(value: unknown, label: string): PluginApiContractSnapshot {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`)
  assertExactKeys(value, ["dialect", "digest", "request", "result"], label)
  if (value.dialect !== pluginApiWireSchemaDialect) {
    throw new TypeError(`${label} dialect is invalid`)
  }
  const dialect = pluginApiWireSchemaDialect
  if (typeof value.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.digest)) {
    throw new TypeError(`${label} digest is invalid`)
  }
  const parseLimit = (candidate: unknown, limitLabel: string): PluginApiWireLimit => {
    if (!isRecord(candidate)) throw new TypeError(`${limitLabel} must be an object`)
    assertExactKeys(candidate, ["maxBytes", "schema"], limitLabel)
    if (
      !Number.isSafeInteger(candidate.maxBytes) ||
      Number(candidate.maxBytes) < 1 ||
      Number(candidate.maxBytes) > 32 * 1024 * 1024
    ) {
      throw new TypeError(`${limitLabel} maxBytes is invalid`)
    }
    assertWireSchema(candidate.schema, `${limitLabel}.schema`)
    return {
      maxBytes: Number(candidate.maxBytes),
      schema: candidate.schema,
    }
  }
  const request = parseLimit(value.request, `${label}.request`)
  const result = parseLimit(value.result, `${label}.result`)
  const normalized = normalizedContract({ dialect, request, result })
  if (normalized.digest !== value.digest) throw new TypeError(`${label} digest does not match its contract`)
  return normalized
}

function assertSnapshot(value: unknown, label: string): asserts value is Snapshot {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`)
  const record = value
  assertExactKeys(record, ["schema", "version", "apis"], label)
  if (record.schema !== PLUGIN_API_CATALOG_ARTIFACT_SCHEMA || typeof record.version !== "string") {
    throw new TypeError(`${label} is not a Plugin API catalog snapshot`)
  }
  pluginApiContractInternals.assertVersion(record.version, `${label} version`)
  if (!Array.isArray(record.apis)) throw new TypeError(`${label} apis must be an array`)
  const ids = new Set<string>()
  const apiEntries: readonly unknown[] = record.apis
  for (const entry of apiEntries) {
    if (!isRecord(entry)) throw new TypeError(`${label} API is invalid`)
    const definition = entry
    assertExactKeys(
      definition,
      ["id", "since", "audience", "completion", "grant", "scope", "sideEffect", "errors", "docs", "contract"],
      `${label} API`,
    )
    if (typeof definition.id !== "string" || ids.has(definition.id)) throw new TypeError(`${label} API id is invalid`)
    const id = definition.id
    ids.add(id)
    if (typeof definition.since !== "string") {
      throw new TypeError(`${label} API ${id} is incomplete`)
    }
    pluginApiContractInternals.assertVersion(definition.since, `${label} API ${id} since`)
    if (pluginApiContractInternals.compareVersions(definition.since, record.version) > 0) {
      throw new TypeError(`${label} API ${id} has a future since version`)
    }
    if (
      !Array.isArray(definition.audience) ||
      !(typeof definition.grant === "string" || definition.grant === null) ||
      typeof definition.completion !== "string" ||
      typeof definition.scope !== "string" ||
      typeof definition.sideEffect !== "string" ||
      !Array.isArray(definition.errors) ||
      !isRecord(definition.docs)
    ) {
      throw new TypeError(`${label} API ${id} is incomplete`)
    }
    const audience = parseAudience(definition.audience, `${label} API ${id} audience`)
    const scope = parseScope(definition.scope, `${label} API ${id} scope`)
    const sideEffect = parseSideEffect(definition.sideEffect, `${label} API ${id} sideEffect`)
    const completion = parseCompletion(definition.completion, `${label} API ${id} completion`)
    const docs = definition.docs
    assertExactKeys(docs, ["summary", "description", "request", "response", "remarks"], `${label} API docs`)
    if (
      typeof docs.summary !== "string" ||
      typeof docs.description !== "string" ||
      typeof docs.request !== "string" ||
      typeof docs.response !== "string" ||
      !(docs.remarks === undefined || typeof docs.remarks === "string")
    ) {
      throw new TypeError(`${label} API ${id} docs are invalid`)
    }
    const errorEntries: readonly unknown[] = definition.errors
    const errors = errorEntries.map((error) => {
      if (!isRecord(error)) {
        throw new TypeError(`${label} API ${id} error is invalid`)
      }
      assertExactKeys(error, ["code", "description", "recoverable"], `${label} API error`)
      if (
        typeof error.code !== "string" ||
        typeof error.description !== "string" ||
        typeof error.recoverable !== "boolean"
      ) {
        throw new TypeError(`${label} API ${id} error is invalid`)
      }
      return {
        code: error.code,
        description: error.description,
        recoverable: error.recoverable,
      }
    })
    parseContractSnapshot(definition.contract, `${label} API ${id} contract`)
    definePluginApi({
      id,
      audience,
      completion,
      grant: definition.grant,
      scope,
      sideEffect,
      errors,
      docs: {
        summary: docs.summary,
        description: docs.description,
        request: docs.request,
        response: docs.response,
        ...(typeof docs.remarks === "string" ? { remarks: docs.remarks } : {}),
      },
    })
  }
}

/**
 * Strictly parses one generated Catalog/history artifact, including every nested
 * wire schema and its digest. Authoring consumers must call this instead of
 * copying the artifact schema token or accepting shape-only JSON.
 *
 * @public
 */
export function parsePluginApiCatalogArtifact(value: unknown): PluginApiCatalogSnapshot {
  assertSnapshot(value, "Plugin API Catalog artifact")
  return snapshotPluginApiCatalog(value)
}

function parseAudience(value: readonly unknown[], label: string): PluginApiAudience[] {
  const audience: PluginApiAudience[] = []
  for (const entry of value) {
    if (!isAudience(entry)) throw new TypeError(`${label} is invalid`)
    audience.push(entry)
  }
  return audience
}

function isAudience(value: unknown): value is PluginApiAudience {
  return value === "web-plugin" || value === "agent-skill" || value === "companion" || value === "host"
}

function parseScope(value: string, label: string): PluginApiScope {
  if (
    value === "connection" ||
    value === "plugin" ||
    value === "own-node" ||
    value === "project" ||
    value === "canvas"
  ) {
    return value
  }
  throw new TypeError(`${label} is invalid`)
}

function parseSideEffect(value: string, label: string): PluginApiSideEffect {
  if (value === "none" || value === "read" || value === "write" || value === "execute" || value === "subscribe") {
    return value
  }
  throw new TypeError(`${label} is invalid`)
}

function parseCompletion(value: string, label: string): PluginApiCompletion {
  if (value === "cancelable" || value === "commit-preserving") return value
  throw new TypeError(`${label} is invalid`)
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}

async function readHistory(historyDirectory: string): Promise<Snapshot[]> {
  const entries = await readdir(historyDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) return []
    throw error
  })
  const snapshots: Snapshot[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    const path = join(historyDirectory, entry.name)
    let value: unknown
    try {
      value = JSON.parse(await readFile(path, "utf8"))
    } catch {
      throw new TypeError(`Plugin API history is not valid JSON: ${path}`)
    }
    assertSnapshot(value, `Plugin API history ${entry.name}`)
    if (basename(entry.name, ".json") !== value.version) {
      throw new TypeError(`Plugin API history filename must match version: ${entry.name}`)
    }
    snapshots.push(snapshotPluginApiCatalog(value))
  }
  snapshots.sort((left, right) => pluginApiContractInternals.compareVersions(left.version, right.version))
  for (let index = 1; index < snapshots.length; index += 1) {
    const issues = checkPluginApiCompatibility(snapshots[index - 1], snapshots[index])
    if (issues.length > 0) throw new TypeError(issues.map((issue) => issue.message).join("\n"))
  }
  return snapshots
}

function assertCurrentHistory(history: readonly Snapshot[], catalog: CatalogInput): void {
  if (history.length === 0) throw new TypeError("Plugin API history is empty; append the current catalog first")
  const current = snapshotPluginApiCatalog(catalog)
  const latest = history[history.length - 1]
  const comparison = pluginApiContractInternals.compareVersions(latest.version, current.version)
  if (comparison > 0)
    throw new TypeError(`Plugin API history ${latest.version} is newer than catalog ${current.version}`)
  if (comparison < 0) {
    const issues = checkPluginApiCompatibility(latest, current)
    if (issues.length > 0) throw new TypeError(issues.map((issue) => issue.message).join("\n"))
    throw new TypeError(`Plugin API history is missing current catalog ${current.version}; run history:append`)
  }
  if (renderPluginApiJson(latest) !== renderPluginApiJson(current)) {
    throw new TypeError(`Plugin API catalog ${current.version} differs from its immutable history snapshot`)
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o644 })
  await rename(temporary, path)
}

async function writeOrCheck(path: string, expected: string, check: boolean): Promise<boolean> {
  const actual = await readFile(path, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (actual === expected) return false
  if (check) return true
  await atomicWrite(path, expected)
  return true
}

/**
 * Generates or read-only checks the package JSON and Markdown artifacts.
 *
 * @public
 */
export async function generatePluginApiArtifacts(
  options: PluginApiGeneratorOptions,
): Promise<PluginApiGeneratorResult> {
  const history = await readHistory(options.historyDirectory)
  assertCurrentHistory(history, pluginApiCatalog)
  const check = options.check === true
  if (!check) await mkdir(options.outputDirectory, { recursive: true })
  const outputs = [
    ["plugin-api.json", renderPluginApiJson(pluginApiCatalog)],
    ["plugin-api.md", renderPluginApiMarkdown(pluginApiCatalog)],
  ] as const
  const changed: string[] = []
  for (const [name, content] of outputs) {
    const path = join(options.outputDirectory, name)
    if (await writeOrCheck(path, content, check)) changed.push(path)
  }
  return { changed, checked: check }
}

/**
 * Verifies that history contains an exact immutable snapshot for the current catalog.
 *
 * @public
 */
export async function checkPluginApiHistory(historyDirectory: string): Promise<void> {
  assertCurrentHistory(await readHistory(historyDirectory), pluginApiCatalog)
}

/**
 * Appends the current catalog snapshot after checking SemVer compatibility.
 *
 * @public
 */
export async function appendPluginApiHistory(historyDirectory: string): Promise<string> {
  const history = await readHistory(historyDirectory)
  const current = snapshotPluginApiCatalog(pluginApiCatalog)
  const latest = history.at(-1)
  if (latest) {
    const comparison = pluginApiContractInternals.compareVersions(latest.version, current.version)
    if (comparison > 0)
      throw new TypeError(`Plugin API history ${latest.version} is newer than catalog ${current.version}`)
    if (comparison === 0) {
      assertCurrentHistory(history, current)
      return join(historyDirectory, `${current.version}.json`)
    }
    const issues = checkPluginApiCompatibility(latest, current)
    if (issues.length > 0) throw new TypeError(issues.map((issue) => issue.message).join("\n"))
  }
  await mkdir(historyDirectory, { recursive: true })
  const path = join(historyDirectory, `${current.version}.json`)
  await atomicWrite(path, renderPluginApiJson(current))
  return path
}
