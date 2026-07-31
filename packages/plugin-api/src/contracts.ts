/**
 * A strict semantic version used by the Host API catalog and its release ledger.
 *
 * @public
 */
export type PluginApiVersion = `${number}.${number}.${number}`

/**
 * A runtime surface that may call a Host API.
 *
 * @public
 */
export type PluginApiAudience = "web-plugin" | "agent-skill" | "companion" | "host"

/**
 * The authority boundary within which a Host API operates.
 *
 * @public
 */
export type PluginApiScope = "connection" | "plugin" | "own-node" | "project" | "canvas"

/**
 * The externally observable effect category of a Host API call.
 *
 * @public
 */
export type PluginApiSideEffect = "none" | "read" | "write" | "execute" | "subscribe"

/**
 * Whether caller cancellation may discard a late result after execution began.
 * Commit-preserving APIs must still deliver the authoritative committed result.
 */
export type PluginApiCompletion = "cancelable" | "commit-preserving"

/**
 * Structured authoring documentation for a stable Host API error code.
 *
 * @public
 */
export interface PluginApiErrorDefinition {
  readonly code: string
  readonly description: string
  readonly recoverable: boolean
}

/**
 * Structured documentation used to generate both human and Agent references.
 *
 * @public
 */
export interface PluginApiDocumentation {
  readonly summary: string
  readonly description: string
  readonly request: string
  readonly response: string
  readonly remarks?: string
}

/**
 * One resolved Host API contract in the generated catalog.
 *
 * @public
 */
export interface PluginApiDefinition<Id extends string = string> {
  readonly id: Id
  /**
   * Catalog version that first introduced this stable API id.
   *
   * This is identity lineage, not the minimum version that understands the
   * current request/result contract.
   */
  readonly since: PluginApiVersion
  /**
   * Catalog release that introduced the currently published wire contract.
   *
   * A contract digest change advances this value to that exact release while
   * `since` remains immutable.
   */
  readonly contractSince: PluginApiVersion
  readonly audience: readonly PluginApiAudience[]
  readonly completion: PluginApiCompletion
  readonly grant: string | null
  readonly scope: PluginApiScope
  readonly sideEffect: PluginApiSideEffect
  readonly errors: readonly PluginApiErrorDefinition[]
  readonly docs: PluginApiDocumentation
}

/**
 * Authoring form of a Host API contract. `since` is assigned by its release block;
 * `contractSince` explicitly identifies the release that owns the current wire
 * contract.
 *
 * @public
 */
export type PluginApiDefinitionInput<Id extends string = string> = Omit<
  PluginApiDefinition<Id>,
  "since" | "audience"
> & {
  readonly audience?: readonly PluginApiAudience[]
}

/**
 * A versioned group of newly introduced Host APIs.
 *
 * @public
 */
export interface PluginApiRelease<
  Version extends PluginApiVersion = PluginApiVersion,
  Definitions extends readonly PluginApiDefinitionInput[] = readonly PluginApiDefinitionInput[],
> {
  readonly version: Version
  readonly apis: Definitions
}

/**
 * The immutable runtime representation of the Host API catalog.
 *
 * @public
 */
export interface PluginApiCatalog<Definition extends PluginApiDefinition = PluginApiDefinition> {
  readonly version: PluginApiVersion
  readonly apis: readonly Definition[]
}

/**
 * A Plugin's declared compatibility and required/optional Host API set.
 *
 * @public
 */
export interface PluginApiDeclaration<Id extends string = string> {
  readonly major: number
  readonly required: readonly Id[]
  readonly optional: readonly Id[]
}

/**
 * Why an API is unavailable for one live Plugin connection.
 *
 * @public
 */
export type PluginApiUnavailableReason =
  | "unsupported-host"
  | "not-declared"
  | "permission-denied"
  | "wrong-surface"
  | "missing-context"
  | "setup-required"
  | "disabled"
  | "recovering"

/**
 * The structured, connection-scoped result of checking one Host API.
 *
 * @public
 */
export type ApiAvailability<Id extends string = string> =
  | {
      readonly available: true
      readonly id: Id
      readonly since: PluginApiVersion
      readonly contractSince: PluginApiVersion
      readonly catalogVersion: PluginApiVersion
    }
  | {
      readonly available: false
      readonly id: Id
      readonly since?: PluginApiVersion
      readonly contractSince?: PluginApiVersion
      readonly reason: PluginApiUnavailableReason
      readonly recoverable: boolean
    }

const API_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/
const ERROR_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const GRANT = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const AUDIENCES = new Set<PluginApiAudience>(["web-plugin", "agent-skill", "companion", "host"])
const SCOPES = new Set<PluginApiScope>(["connection", "plugin", "own-node", "project", "canvas"])
const SIDE_EFFECTS = new Set<PluginApiSideEffect>(["none", "read", "write", "execute", "subscribe"])
const COMPLETIONS = new Set<PluginApiCompletion>(["cancelable", "commit-preserving"])

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} must not be empty`)
}

function assertVersion(value: string, label: string): asserts value is PluginApiVersion {
  if (!SEMVER.test(value)) throw new TypeError(`${label} must be a strict semantic version`)
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

function freezeDefinition<const Definition extends PluginApiDefinitionInput>(
  definition: Definition,
): Readonly<Definition & { audience: readonly PluginApiAudience[] }> {
  if (!API_ID.test(definition.id)) throw new TypeError(`Plugin API id is invalid: ${definition.id}`)
  assertVersion(definition.contractSince, `${definition.id} contractSince`)
  if (definition.grant !== null && !GRANT.test(definition.grant)) {
    throw new TypeError(`Plugin API grant is invalid: ${definition.grant}`)
  }
  if (!SCOPES.has(definition.scope)) throw new TypeError(`Plugin API scope is invalid: ${definition.scope}`)
  if (!SIDE_EFFECTS.has(definition.sideEffect)) {
    throw new TypeError(`Plugin API sideEffect is invalid: ${definition.sideEffect}`)
  }
  if (!COMPLETIONS.has(definition.completion)) {
    throw new TypeError(`Plugin API completion is invalid: ${definition.completion}`)
  }

  const audience = definition.audience ?? (["web-plugin"] as const)
  if (
    audience.length === 0 ||
    new Set(audience).size !== audience.length ||
    audience.some((item) => !AUDIENCES.has(item))
  ) {
    throw new TypeError(`Plugin API audience is invalid: ${definition.id}`)
  }
  requireNonEmpty(definition.docs.summary, `${definition.id} docs.summary`)
  requireNonEmpty(definition.docs.description, `${definition.id} docs.description`)
  requireNonEmpty(definition.docs.request, `${definition.id} docs.request`)
  requireNonEmpty(definition.docs.response, `${definition.id} docs.response`)

  const errorCodes = new Set<string>()
  const errors = definition.errors.map((error) => {
    if (!ERROR_CODE.test(error.code) || errorCodes.has(error.code)) {
      throw new TypeError(`Plugin API error code is invalid or duplicated: ${definition.id}/${error.code}`)
    }
    errorCodes.add(error.code)
    requireNonEmpty(error.description, `${definition.id}/${error.code} description`)
    return Object.freeze({ ...error })
  })

  return Object.freeze({
    ...definition,
    audience: Object.freeze([...audience]),
    errors: Object.freeze(errors),
    docs: Object.freeze({ ...definition.docs }),
  })
}

/**
 * Defines one statically typed Host API entry and validates its authoring metadata.
 *
 * @public
 */
export function definePluginApi<const Definition extends PluginApiDefinitionInput>(
  definition: Definition,
): Readonly<Definition & { audience: readonly PluginApiAudience[] }> {
  return freezeDefinition(definition)
}

/**
 * Assigns a single introduction version to a group of new Host API definitions.
 *
 * @public
 */
export function definePluginApiRelease<
  const Version extends PluginApiVersion,
  const Definitions extends readonly PluginApiDefinitionInput[],
>(version: Version, apis: Definitions): PluginApiRelease<Version, Definitions>
export function definePluginApiRelease(
  version: PluginApiVersion,
  apis: readonly PluginApiDefinitionInput[],
): PluginApiRelease
export function definePluginApiRelease(
  version: PluginApiVersion,
  apis: readonly PluginApiDefinitionInput[],
): PluginApiRelease {
  assertVersion(version, "Plugin API release version")
  return Object.freeze({ version, apis: Object.freeze([...apis]) })
}

type DefinitionFromRelease<Release> =
  Release extends PluginApiRelease<infer Version, infer Definitions>
    ? Definitions[number] extends infer Definition
      ? Definition extends PluginApiDefinitionInput
        ? Omit<Definition, "audience"> & {
            readonly audience: readonly PluginApiAudience[]
            readonly since: Version
          }
        : never
      : never
    : never

/**
 * Builds an immutable catalog from strictly increasing, append-only release blocks.
 *
 * @public
 */
export function definePluginApiCatalog<const Releases extends readonly PluginApiRelease[]>(
  ...releases: Releases
): PluginApiCatalog<DefinitionFromRelease<Releases[number]>>
export function definePluginApiCatalog(...releases: readonly PluginApiRelease[]): PluginApiCatalog
export function definePluginApiCatalog(...releases: readonly PluginApiRelease[]): PluginApiCatalog {
  if (releases.length === 0) throw new TypeError("Plugin API catalog requires at least one release")
  const ids = new Set<string>()
  const apis: PluginApiDefinition[] = []
  const releaseVersions = new Set(releases.map((release) => release.version))
  let previous: PluginApiVersion | undefined
  for (const release of releases) {
    assertVersion(release.version, "Plugin API release version")
    if (previous && compareVersions(previous, release.version) >= 0) {
      throw new TypeError("Plugin API releases must be strictly increasing")
    }
    previous = release.version
    for (const candidate of release.apis) {
      const definition = freezeDefinition(candidate)
      if (ids.has(definition.id)) throw new TypeError(`Plugin API id is duplicated: ${definition.id}`)
      if (compareVersions(definition.contractSince, release.version) < 0) {
        throw new TypeError(`Plugin API ${definition.id} contractSince must not precede since`)
      }
      if (!releaseVersions.has(definition.contractSince)) {
        throw new TypeError(
          `Plugin API ${definition.id} contractSince must identify a Catalog release block`,
        )
      }
      ids.add(definition.id)
      apis.push(Object.freeze({ ...definition, since: release.version }))
    }
  }
  if (apis.length === 0) throw new TypeError("Plugin API catalog must contain at least one API")
  return Object.freeze({
    version: releases[releases.length - 1].version,
    apis: Object.freeze(apis),
  })
}

export const pluginApiContractInternals: Readonly<{
  assertVersion: (value: string, label: string) => asserts value is PluginApiVersion
  compareVersions: (left: PluginApiVersion, right: PluginApiVersion) => number
}> = Object.freeze({
  assertVersion,
  compareVersions,
})
