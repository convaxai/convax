import { createHash } from "node:crypto"

import {
  isPluginCapabilityContractCompatible,
  type PluginCapabilityAvailability,
  type PluginCapabilityDeclaration,
  type PluginCapabilityExport,
  type PluginCapabilityImport,
  type PluginCapabilityImportRequirement,
  type PluginCapabilityUnavailableReason,
} from "@convax/plugin-sdk"

export const pluginCapabilityTopologySchema = "convax.plugin-capability-topology/1" as const

const digestPattern = /^[a-f0-9]{64}$/
const pluginIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export interface PluginCapabilitySnapshotIdentity {
  readonly pluginId: string
  readonly pluginVersion: string
  readonly snapshotDigest: string
}

export interface PluginCapabilityPluginIdentity extends PluginCapabilitySnapshotIdentity {
  readonly activeRevision: number
  readonly activeSetDigest: string
}

export interface PublishedPluginCapabilityContract {
  readonly identity: PluginCapabilitySnapshotIdentity
  readonly capabilities: PluginCapabilityDeclaration
}

export interface ActivePluginCapabilityContract {
  readonly identity: PluginCapabilityPluginIdentity
  readonly capabilities: PluginCapabilityDeclaration
}

export interface PublishedPluginCapabilityBinding {
  readonly callerPluginId: string
  readonly callerSnapshotDigest: string
  readonly capabilityId: string
  readonly requirement: PluginCapabilityImportRequirement
  readonly provider: {
    readonly pluginId: string
    readonly snapshotDigest: string
    readonly version: string
  } | null
  readonly unavailable: {
    readonly reason: PluginCapabilityUnavailableReason
    readonly recoverable: boolean
  } | null
}

export interface PluginCapabilityTopologyDescriptor {
  readonly schema: typeof pluginCapabilityTopologySchema
  readonly bindings: readonly PublishedPluginCapabilityBinding[]
}

export interface PluginCapabilityTopology {
  readonly descriptor: PluginCapabilityTopologyDescriptor
  /** SHA-256 over the canonical descriptor; excludes pointer revision and ActiveSet digest. */
  readonly topologyDigest: string
}

export interface PluginCapabilityBinding {
  readonly caller: PluginCapabilityPluginIdentity
  readonly capabilityId: string
  readonly requirement: PluginCapabilityImportRequirement
  readonly import: PluginCapabilityImport
  readonly provider?: PluginCapabilityPluginIdentity
  readonly export?: PluginCapabilityExport
  readonly availability: PluginCapabilityAvailability<PluginCapabilityPluginIdentity>
}

export interface PluginCapabilityBindingPlan {
  readonly activeRevision: number
  readonly activeSetDigest: string
  readonly bindingDigest: string
  readonly bindings: readonly PluginCapabilityBinding[]
  readonly plugins: readonly ActivePluginCapabilityContract[]
}

export type PluginCapabilityBindingIssueCode =
  | "active-set-mismatch"
  | "duplicate-plugin"
  | "required-provider-missing"
  | "required-provider-incompatible"
  | "required-provider-ambiguous"
  | "required-self-provider"
  | "required-dependency-cycle"

export interface PluginCapabilityBindingIssue {
  readonly code: PluginCapabilityBindingIssueCode
  readonly callerPluginId?: string
  readonly capabilityId?: string
  readonly dependencyPath?: readonly string[]
  readonly providerPluginIds?: readonly string[]
}

export type PluginCapabilityTopologyResult =
  | { readonly ok: true; readonly topology: PluginCapabilityTopology }
  | { readonly ok: false; readonly issues: readonly PluginCapabilityBindingIssue[] }

export type PluginCapabilityBindingPlanResult =
  | { readonly ok: true; readonly plan: PluginCapabilityBindingPlan }
  | { readonly ok: false; readonly issues: readonly PluginCapabilityBindingIssue[] }

export interface PlanPluginCapabilityBindingsInput {
  readonly activeRevision: number
  readonly activeSetDigest: string
  readonly plugins: readonly ActivePluginCapabilityContract[]
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Plugin capability binding plan contains a non-finite number")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!value || typeof value !== "object") {
    throw new TypeError("Plugin capability binding plan contains a non-JSON value")
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`
}

function descriptorDigest(descriptor: PluginCapabilityTopologyDescriptor) {
  return createHash("sha256").update(canonicalJson(descriptor)).digest("hex")
}

function validSnapshotIdentity(identity: PluginCapabilitySnapshotIdentity) {
  return (
    pluginIdPattern.test(identity.pluginId) &&
    typeof identity.pluginVersion === "string" &&
    identity.pluginVersion.length > 0 &&
    digestPattern.test(identity.snapshotDigest)
  )
}

function findRequiredCycle(edges: ReadonlyMap<string, ReadonlySet<string>>) {
  const visited = new Set<string>()
  const active = new Set<string>()
  const path: string[] = []
  const visit = (pluginId: string): string[] | undefined => {
    if (active.has(pluginId)) return [...path.slice(path.indexOf(pluginId)), pluginId]
    if (visited.has(pluginId)) return undefined
    visited.add(pluginId)
    active.add(pluginId)
    path.push(pluginId)
    for (const providerId of [...(edges.get(pluginId) ?? [])].sort(compareText)) {
      const cycle = visit(providerId)
      if (cycle) return cycle
    }
    path.pop()
    active.delete(pluginId)
    return undefined
  }
  for (const pluginId of [...edges.keys()].sort(compareText)) {
    const cycle = visit(pluginId)
    if (cycle) return cycle
  }
  return undefined
}

/**
 * Produces the canonical topology persisted inside the candidate ActiveSet.
 * Its digest depends only on exact Plugin snapshots and resolved bindings.
 */
export function planPluginCapabilityTopology(
  pluginsInput: readonly PublishedPluginCapabilityContract[],
): PluginCapabilityTopologyResult {
  const plugins = [...pluginsInput].sort((left, right) => compareText(left.identity.pluginId, right.identity.pluginId))
  const issues: PluginCapabilityBindingIssue[] = []
  const ids = new Set<string>()
  for (const plugin of plugins) {
    if (!validSnapshotIdentity(plugin.identity)) {
      issues.push({ code: "active-set-mismatch", callerPluginId: plugin.identity.pluginId })
    } else if (ids.has(plugin.identity.pluginId)) {
      issues.push({ code: "duplicate-plugin", callerPluginId: plugin.identity.pluginId })
    }
    ids.add(plugin.identity.pluginId)
  }
  if (issues.length) return { ok: false, issues: Object.freeze(issues) }

  const providers = new Map<
    string,
    Array<{ plugin: PublishedPluginCapabilityContract; exported: PluginCapabilityExport }>
  >()
  for (const plugin of plugins) {
    for (const exported of plugin.capabilities.exports) {
      const entries = providers.get(exported.id) ?? []
      entries.push({ plugin, exported })
      providers.set(exported.id, entries)
    }
  }

  const bindings: PublishedPluginCapabilityBinding[] = []
  const requiredEdges = new Map(plugins.map(({ identity }) => [identity.pluginId, new Set<string>()]))
  for (const caller of plugins) {
    const imports = [
      ...caller.capabilities.imports.required.map((entry) => ({ entry, requirement: "required" as const })),
      ...caller.capabilities.imports.optional.map((entry) => ({ entry, requirement: "optional" as const })),
    ].sort((left, right) => compareText(left.entry.id, right.entry.id))
    for (const { entry, requirement } of imports) {
      const declaredProviders = providers.get(entry.id) ?? []
      const compatible = declaredProviders.filter(({ exported }) =>
        isPluginCapabilityContractCompatible(entry, exported),
      )
      const external = compatible.filter(({ plugin }) => plugin.identity.pluginId !== caller.identity.pluginId)
      let reason: "provider-missing" | "provider-incompatible" | "provider-ambiguous" | "self-provider" | undefined
      if (external.length > 1) reason = "provider-ambiguous"
      else if (external.length === 0 && compatible.length > 0) reason = "self-provider"
      else if (external.length === 0 && declaredProviders.length > 0) reason = "provider-incompatible"
      else if (external.length === 0) reason = "provider-missing"

      if (reason) {
        bindings.push(
          Object.freeze({
            callerPluginId: caller.identity.pluginId,
            callerSnapshotDigest: caller.identity.snapshotDigest,
            capabilityId: entry.id,
            requirement,
            provider: null,
            unavailable: Object.freeze({ reason, recoverable: requirement === "optional" }),
          }),
        )
        if (requirement === "required") {
          const code: PluginCapabilityBindingIssueCode =
            reason === "provider-missing"
              ? "required-provider-missing"
              : reason === "provider-incompatible"
                ? "required-provider-incompatible"
                : reason === "provider-ambiguous"
                  ? "required-provider-ambiguous"
                  : "required-self-provider"
          issues.push({
            code,
            callerPluginId: caller.identity.pluginId,
            capabilityId: entry.id,
            providerPluginIds: Object.freeze(
              (reason === "provider-ambiguous" ? external : declaredProviders)
                .map(({ plugin }) => plugin.identity.pluginId)
                .sort(compareText),
            ),
          })
        }
        continue
      }
      const provider = external[0]!
      bindings.push(
        Object.freeze({
          callerPluginId: caller.identity.pluginId,
          callerSnapshotDigest: caller.identity.snapshotDigest,
          capabilityId: entry.id,
          requirement,
          provider: Object.freeze({
            pluginId: provider.plugin.identity.pluginId,
            snapshotDigest: provider.plugin.identity.snapshotDigest,
            version: provider.exported.version,
          }),
          unavailable: null,
        }),
      )
      if (requirement === "required")
        requiredEdges.get(caller.identity.pluginId)!.add(provider.plugin.identity.pluginId)
    }
  }
  if (issues.length) return { ok: false, issues: Object.freeze(issues) }
  const cycle = findRequiredCycle(requiredEdges)
  if (cycle) {
    return {
      ok: false,
      issues: [Object.freeze({ code: "required-dependency-cycle", dependencyPath: Object.freeze(cycle) })],
    }
  }
  const descriptor = Object.freeze({
    schema: pluginCapabilityTopologySchema,
    bindings: Object.freeze(bindings),
  })
  return {
    ok: true,
    topology: Object.freeze({ descriptor, topologyDigest: descriptorDigest(descriptor) }),
  }
}

/** Recomputes every provider choice and rejects persisted topology drift. */
export function verifyPluginCapabilityTopology(
  topology: PluginCapabilityTopology,
  plugins: readonly PublishedPluginCapabilityContract[],
) {
  if (topology.topologyDigest !== descriptorDigest(topology.descriptor)) return false
  const expected = planPluginCapabilityTopology(plugins)
  return (
    expected.ok &&
    expected.topology.topologyDigest === topology.topologyDigest &&
    canonicalJson(expected.topology.descriptor) === canonicalJson(topology.descriptor)
  )
}

/** Projects one verified persisted topology into a concrete ActiveSet generation. */
export function projectPluginCapabilityTopology(
  topology: PluginCapabilityTopology,
  active: { readonly revision: number; readonly activeSetDigest: string },
  plugins: readonly PublishedPluginCapabilityContract[],
): PluginCapabilityBindingPlan {
  if (
    !Number.isSafeInteger(active.revision) ||
    active.revision < 1 ||
    !digestPattern.test(active.activeSetDigest) ||
    !verifyPluginCapabilityTopology(topology, plugins)
  ) {
    throw new TypeError("Published Plugin capability topology is invalid")
  }
  const activePlugins: ActivePluginCapabilityContract[] = plugins.map((plugin) =>
    Object.freeze({
      capabilities: plugin.capabilities,
      identity: Object.freeze({
        ...plugin.identity,
        activeRevision: active.revision,
        activeSetDigest: active.activeSetDigest,
      }),
    }),
  )
  const byId = new Map(activePlugins.map((plugin) => [plugin.identity.pluginId, plugin]))
  const bindings = topology.descriptor.bindings.map((persisted): PluginCapabilityBinding => {
    const caller = byId.get(persisted.callerPluginId)
    if (!caller || caller.identity.snapshotDigest !== persisted.callerSnapshotDigest) {
      throw new TypeError("Published Plugin capability caller binding is stale")
    }
    const imported = [...caller.capabilities.imports.required, ...caller.capabilities.imports.optional].find(
      ({ id }) => id === persisted.capabilityId,
    )
    if (!imported) throw new TypeError("Published Plugin capability import is missing")
    if (!persisted.provider) {
      if (!persisted.unavailable) throw new TypeError("Published Plugin capability availability is invalid")
      return Object.freeze({
        caller: caller.identity,
        capabilityId: persisted.capabilityId,
        requirement: persisted.requirement,
        import: imported,
        availability: Object.freeze({
          available: false,
          capabilityId: persisted.capabilityId,
          requirement: persisted.requirement,
          reason: persisted.unavailable.reason,
          recoverable: persisted.unavailable.recoverable,
        }),
      })
    }
    const provider = byId.get(persisted.provider.pluginId)
    const exported = provider?.capabilities.exports.find(({ id }) => id === persisted.capabilityId)
    if (
      !provider ||
      provider.identity.snapshotDigest !== persisted.provider.snapshotDigest ||
      !exported ||
      exported.version !== persisted.provider.version
    ) {
      throw new TypeError("Published Plugin capability provider binding is stale")
    }
    return Object.freeze({
      caller: caller.identity,
      capabilityId: persisted.capabilityId,
      requirement: persisted.requirement,
      import: imported,
      provider: provider.identity,
      export: exported,
      availability: Object.freeze({
        available: true,
        capabilityId: persisted.capabilityId,
        requirement: persisted.requirement,
        provider: provider.identity,
        version: exported.version,
      }),
    })
  })
  return Object.freeze({
    activeRevision: active.revision,
    activeSetDigest: active.activeSetDigest,
    bindingDigest: topology.topologyDigest,
    bindings: Object.freeze(bindings),
    plugins: Object.freeze(activePlugins),
  })
}

/** Compatibility wrapper used by tests and callers that already hold ActiveSet identity. */
export function planPluginCapabilityBindings(
  input: PlanPluginCapabilityBindingsInput,
): PluginCapabilityBindingPlanResult {
  if (
    !Number.isSafeInteger(input.activeRevision) ||
    input.activeRevision < 1 ||
    !digestPattern.test(input.activeSetDigest) ||
    input.plugins.some(
      ({ identity }) =>
        identity.activeRevision !== input.activeRevision || identity.activeSetDigest !== input.activeSetDigest,
    )
  ) {
    return { ok: false, issues: [{ code: "active-set-mismatch" }] }
  }
  const plugins = input.plugins.map(({ identity, capabilities }) => ({
    capabilities,
    identity: {
      pluginId: identity.pluginId,
      pluginVersion: identity.pluginVersion,
      snapshotDigest: identity.snapshotDigest,
    },
  }))
  const topology = planPluginCapabilityTopology(plugins)
  if (!topology.ok) return topology
  return {
    ok: true,
    plan: projectPluginCapabilityTopology(
      topology.topology,
      { revision: input.activeRevision, activeSetDigest: input.activeSetDigest },
      plugins,
    ),
  }
}

/** Recomputes topology and runtime projection from exact Plugin contracts. */
export function verifyPluginCapabilityBindingPlan(plan: PluginCapabilityBindingPlan) {
  if (
    !Number.isSafeInteger(plan.activeRevision) ||
    plan.activeRevision < 1 ||
    !digestPattern.test(plan.activeSetDigest)
  ) {
    return false
  }
  const plugins = plan.plugins.map(({ identity, capabilities }) => ({
    capabilities,
    identity: {
      pluginId: identity.pluginId,
      pluginVersion: identity.pluginVersion,
      snapshotDigest: identity.snapshotDigest,
    },
  }))
  const topology = planPluginCapabilityTopology(plugins)
  if (!topology.ok || topology.topology.topologyDigest !== plan.bindingDigest) return false
  const expected = projectPluginCapabilityTopology(
    topology.topology,
    { revision: plan.activeRevision, activeSetDigest: plan.activeSetDigest },
    plugins,
  )
  return canonicalJson(expected.bindings) === canonicalJson(plan.bindings)
}
