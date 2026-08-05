import path from "node:path"

import {
  requireWebPluginId,
  type ActiveInstalledWebPluginSummary,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import {
  PluginInstallationClosureStore,
  pluginExecutionBindingDigest,
  type StagedPluginClosureGarbage,
} from "./plugin-installation-closure-store"
import {
  planPluginCapabilityTopology,
  projectPluginCapabilityTopology,
  verifyPluginCapabilityTopology,
  type PluginCapabilityTopology,
  type PublishedPluginCapabilityContract,
} from "./plugin-capability-binding-plan"
import {
  PluginInstallationSnapshotStore,
  pluginSnapshotCanonicalDigest,
  requireDigest,
  type ActivePluginSnapshotReference,
  type InstalledPluginSnapshot,
  type PluginSnapshotDigest,
  type PluginSnapshotGarbageCollectionCandidates,
  type PluginSnapshotOwnerPin,
} from "./plugin-installation-snapshots"
import {
  PluginNotActiveError,
  pluginInstallationRuntimeError,
  type ActiveInstalledPlugin,
  type ActivePluginCapabilityIdentity,
  type ActivePluginRuntimeHandle,
  type ActivePluginRuntimeIdentity,
  type ActivePluginRuntimeSelection,
  type ActivePluginRuntimeSetHandle,
  type ActivePluginSetCallLease,
  type PluginExecutionAuthorizationSelection,
  type PluginInstallationCandidate,
  type PluginInstallationRuntimeOptions,
  type PluginSnapshotRuntimeIdentity,
} from "./plugin-installation-runtime-contracts"

export * from "./plugin-installation-runtime-contracts"

const runtimeError = pluginInstallationRuntimeError
const emptyPluginCapabilityDeclaration = Object.freeze({
  exports: Object.freeze([]),
  imports: Object.freeze({
    optional: Object.freeze([]),
    required: Object.freeze([]),
  }),
})
const emptyCapabilityTopology = (() => {
  const result = planPluginCapabilityTopology([])
  if (!result.ok) throw new Error("Empty Plugin capability topology is invalid")
  return result.topology
})()

export function pluginExecutionAuthorizationIdentity(
  descriptor: InstalledPluginSnapshot["descriptor"],
): PluginSnapshotDigest | null {
  const { companionExecutionDigest, hookExecutionDigest } = descriptor.authorizations
  if (descriptor.companion && !companionExecutionDigest) return null
  if (descriptor.hook && !hookExecutionDigest) return null
  if (!descriptor.companion && !descriptor.hook) {
    return pluginSnapshotCanonicalDigest({
      artifact: descriptor.package.artifact,
      capabilityContractDigest: descriptor.authorizations.capabilityContractDigest,
      pluginId: descriptor.pluginId,
      schema: "convax.plugin-static-authorization/1",
      sourceIdentity: descriptor.sourceIdentity,
      version: descriptor.version,
    })
  }
  return companionExecutionDigest || hookExecutionDigest
    ? pluginSnapshotCanonicalDigest({
        companionExecutionDigest: companionExecutionDigest ?? null,
        hookExecutionDigest: hookExecutionDigest ?? null,
        schema: "convax.plugin-execution-authorization/1",
      })
    : null
}

function pinIdentity(identity: ActivePluginRuntimeIdentity): Omit<PluginSnapshotOwnerPin, "ownerKey"> {
  return {
    activeRevision: identity.activeRevision,
    activeSetDigest: requireDigest(identity.activeSetDigest, "Plugin pin ActiveSet digest"),
    pluginId: requireWebPluginId(identity.pluginId),
    snapshotDigest: requireDigest(identity.snapshotDigest, "Plugin pin snapshot digest"),
  }
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

export interface RetiredHostApiPluginRecovery {
  readonly artifact: {
    readonly sha256: PluginSnapshotDigest
    readonly size: number
  }
  readonly hostApiMajor: number
  readonly pluginId: string
  readonly snapshotDigest: PluginSnapshotDigest
  readonly sourceIdentity: PluginSnapshotDigest
  readonly version: string
}

export interface RetiredHostApiRecoveryInspection {
  readonly plugins: readonly RetiredHostApiPluginRecovery[]
  readonly revision: number
}

export class PluginInstallationRuntime {
  readonly #closures: PluginInstallationClosureStore
  readonly #faultHook: PluginInstallationRuntimeOptions["faultHook"]
  readonly #observedBindings = new Map<string, ActivePluginRuntimeIdentity>()
  readonly #snapshots: PluginInstallationSnapshotStore
  #operations: Promise<void> = Promise.resolve()

  constructor(rootPath: string, options: PluginInstallationRuntimeOptions = {}) {
    if (!path.isAbsolute(rootPath) || rootPath.includes("\0")) {
      throw runtimeError("Plugin installation runtime root must be an absolute path")
    }
    const resolvedRoot = path.resolve(rootPath)
    this.#closures = new PluginInstallationClosureStore(path.join(resolvedRoot, "closures"), options)
    this.#snapshots = new PluginInstallationSnapshotStore(path.join(resolvedRoot, "state"))
    this.#faultHook = options.faultHook
  }

  async publish(
    expectedRevision: number,
    candidate: PluginInstallationCandidate,
  ): Promise<ActivePluginRuntimeSelection> {
    const prepared = this.#closures.prepare(candidate)
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const snapshot = await this.#snapshots.putInstalledSnapshot(prepared.input)
      await this.#closures.publish(snapshot, prepared.files, prepared.companionBytes)
      await this.#closures.validate(snapshot)
      await this.#faultHook?.("closure.validated-before-pointer", {
        pluginId: snapshot.descriptor.pluginId,
        snapshotDigest: snapshot.digest,
      })
      const current = await this.#snapshots.readActive()
      if (current.revision !== expectedRevision) {
        // Delegate the exact typed revision conflict to the canonical store.
        await this.#snapshots.compareAndSwapActiveSet(expectedRevision, {
          capabilityTopology: current.activeSet?.descriptor.capabilityTopology ?? emptyCapabilityTopology,
          plugins: current.activeSet?.descriptor.plugins ?? [],
        })
        throw runtimeError("Unreachable Active Plugin revision branch")
      }
      const references = new Map(
        current.activeSet?.descriptor.plugins.map((reference) => [reference.pluginId, reference]) ?? [],
      )
      references.set(snapshot.descriptor.pluginId, {
        pluginId: snapshot.descriptor.pluginId,
        snapshotDigest: snapshot.digest,
      })
      await this.#assertSkillNamesUnique([...references.values()])
      const plugins = [...references.values()].sort((left, right) => compareText(left.pluginId, right.pluginId))
      const capabilityTopology = await this.#planCapabilityTopology(plugins)
      await this.#snapshots.compareAndSwapActiveSet(expectedRevision, { capabilityTopology, plugins })
      return this.#readActive()
    })
  }

  /**
   * Replaces one explicitly selected retired-Host-API Plugin and deactivates
   * the other incompatible references in the same CAS. Their immutable
   * snapshots and Marketplace install records are preserved for later update.
   */
  async publishRetiredHostApiRecovery(
    expectedRevision: number,
    candidate: PluginInstallationCandidate,
    expectedRecovery: RetiredHostApiPluginRecovery,
  ): Promise<ActivePluginRuntimeSelection> {
    const prepared = this.#closures.prepare(candidate)
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const current = await this.#snapshots.readActive()
      if (current.revision !== expectedRevision) {
        await this.#snapshots.compareAndSwapActiveSet(expectedRevision, {
          capabilityTopology: current.activeSet?.descriptor.capabilityTopology ?? emptyCapabilityTopology,
          plugins: current.activeSet?.descriptor.plugins ?? [],
        })
        throw runtimeError("Unreachable Active Plugin recovery revision branch")
      }
      const recovery = await this.#inspectRetiredHostApiRecovery(current)
      const currentRecovery = recovery.plugins.find((entry) => entry.pluginId === prepared.manifest.id)
      if (
        !currentRecovery ||
        pluginSnapshotCanonicalDigest(currentRecovery) !== pluginSnapshotCanonicalDigest(expectedRecovery) ||
        candidate.sourceIdentity !== currentRecovery.sourceIdentity
      ) {
        throw runtimeError(`Plugin is not eligible for retired Host API update recovery: ${prepared.manifest.id}`)
      }

      const snapshot = await this.#snapshots.putInstalledSnapshot(prepared.input)
      await this.#closures.publish(snapshot, prepared.files, prepared.companionBytes)
      await this.#closures.validate(snapshot)
      await this.#faultHook?.("closure.validated-before-pointer", {
        pluginId: snapshot.descriptor.pluginId,
        snapshotDigest: snapshot.digest,
      })

      const incompatibleIds = new Set(recovery.plugins.map((entry) => entry.pluginId))
      const references = (current.activeSet?.descriptor.plugins ?? []).filter(
        (reference) => !incompatibleIds.has(reference.pluginId),
      )
      references.push({
        pluginId: snapshot.descriptor.pluginId,
        snapshotDigest: snapshot.digest,
      })
      references.sort((left, right) => compareText(left.pluginId, right.pluginId))
      await this.#assertSkillNamesUnique(references)
      const capabilityTopology = await this.#planCapabilityTopology(references)
      await this.#snapshots.compareAndSwapActiveSet(expectedRevision, {
        capabilityTopology,
        plugins: references,
      })
      return this.#readActive()
    })
  }

  async inspectRetiredHostApiRecovery(): Promise<RetiredHostApiRecoveryInspection> {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      return this.#inspectRetiredHostApiRecovery(await this.#snapshots.readActive())
    })
  }

  async uninstall(expectedRevision: number, pluginIdInput: string) {
    const pluginId = requireWebPluginId(pluginIdInput)
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const current = await this.#snapshots.readActive()
      if (current.revision !== expectedRevision) {
        await this.#snapshots.compareAndSwapActiveSet(expectedRevision, {
          capabilityTopology: current.activeSet?.descriptor.capabilityTopology ?? emptyCapabilityTopology,
          plugins: current.activeSet?.descriptor.plugins ?? [],
        })
        throw runtimeError("Unreachable Active Plugin revision branch")
      }
      const next = (current.activeSet?.descriptor.plugins ?? []).filter((reference) => reference.pluginId !== pluginId)
      if (next.length === (current.activeSet?.descriptor.plugins.length ?? 0)) return this.#selection(current)
      const capabilityTopology = await this.#planCapabilityTopology(next)
      await this.#snapshots.compareAndSwapActiveSet(expectedRevision, { capabilityTopology, plugins: next })
      return this.#readActive()
    })
  }

  /**
   * Publishes a new immutable snapshot whose execution grants are derived from
   * the already-active exact bytes. No mutable receipt or executable lookup
   * participates in the authorization decision.
   */
  async authorizeExecution(
    expectedRevision: number,
    pluginIdInput: string,
    selection: PluginExecutionAuthorizationSelection,
  ) {
    const pluginId = requireWebPluginId(pluginIdInput)
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const current = await this.#snapshots.readActive()
      if (current.revision !== expectedRevision) {
        await this.#snapshots.compareAndSwapActiveSet(expectedRevision, {
          capabilityTopology: current.activeSet?.descriptor.capabilityTopology ?? emptyCapabilityTopology,
          plugins: current.activeSet?.descriptor.plugins ?? [],
        })
        throw runtimeError("Unreachable Active Plugin revision branch")
      }
      const reference = current.activeSet?.descriptor.plugins.find((candidate) => candidate.pluginId === pluginId)
      if (!reference) throw new PluginNotActiveError(pluginId)
      const previous = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
      await this.#closures.validate(previous)
      if (selection.companion && !previous.descriptor.companion) {
        throw runtimeError(`Plugin has no immutable companion to authorize: ${pluginId}`)
      }
      if (selection.hook && !previous.descriptor.hook) {
        throw runtimeError(`Plugin has no immutable Hook to authorize: ${pluginId}`)
      }
      const { schema: _schema, ...previousInput } = previous.descriptor
      const next = await this.#snapshots.putInstalledSnapshot({
        ...previousInput,
        authorizations: {
          capabilityContractDigest: previous.descriptor.authorizations.capabilityContractDigest,
          ...(selection.companion
            ? { companionExecutionDigest: pluginExecutionBindingDigest(previous.descriptor, "companion") }
            : {}),
          ...(selection.hook ? { hookExecutionDigest: pluginExecutionBindingDigest(previous.descriptor, "hook") } : {}),
        },
      })
      if (next.digest !== previous.digest) {
        const { companionBytes, files } = await this.#closures.readBytes(previous)
        await this.#closures.publish(next, files, companionBytes)
        await this.#closures.validate(next)
      }
      const references = (current.activeSet?.descriptor.plugins ?? []).map((candidate) =>
        candidate.pluginId === pluginId ? { pluginId, snapshotDigest: next.digest } : candidate,
      )
      const capabilityTopology = await this.#planCapabilityTopology(references)
      await this.#snapshots.compareAndSwapActiveSet(expectedRevision, { capabilityTopology, plugins: references })
      return this.#readActive()
    })
  }

  async executionAuthorizationIdentity(pluginIdInput: string) {
    const pluginId = requireWebPluginId(pluginIdInput)
    const handle = await this.acquireActivePlugin(pluginId)
    try {
      return pluginExecutionAuthorizationIdentity(handle.descriptor)
    } finally {
      handle.release()
    }
  }

  async readActive(): Promise<ActivePluginRuntimeSelection> {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      return this.#readActive()
    })
  }

  async listOwnerPins() {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const state = await this.#snapshots.readOwnerPins()
      const pins: Array<{ identity: ActivePluginRuntimeIdentity; ownerKey: string }> = []
      for (const pin of state.pins) {
        const snapshot = await this.#snapshots.readInstalledSnapshot(pin.snapshotDigest)
        const plugin = await this.#closures.validate(snapshot)
        pins.push({
          identity: this.#rememberIdentity(
            Object.freeze({
              activeRevision: pin.activeRevision,
              activeSetDigest: pin.activeSetDigest,
              pluginId: pin.pluginId,
              snapshotDigest: pin.snapshotDigest,
              version: plugin.version,
            }),
          ),
          ownerKey: pin.ownerKey,
        })
      }
      return Object.freeze(pins)
    })
  }

  async pinActivePluginForOwner(ownerKey: string, identity: ActivePluginRuntimeIdentity) {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const snapshot = await this.#snapshots.readInstalledSnapshot(identity.snapshotDigest)
      const plugin = await this.#closures.validate(snapshot)
      if (plugin.id !== identity.pluginId || plugin.version !== identity.version) {
        throw runtimeError("Plugin snapshot pin identity does not match its immutable closure")
      }
      return this.#snapshots.pinActivePluginForOwner(ownerKey, pinIdentity(identity))
    })
  }

  async unpinPluginOwner(ownerKey: string, identity: ActivePluginRuntimeIdentity) {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      return this.#snapshots.unpinPluginOwner(ownerKey, pinIdentity(identity))
    })
  }

  async acquirePinnedPlugin(
    ownerKey: string,
    identity: ActivePluginRuntimeIdentity,
  ): Promise<ActivePluginRuntimeHandle> {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const pinned = await this.#snapshots.acquireOwnerPinLease(ownerKey, pinIdentity(identity))
      try {
        const snapshot = await this.#snapshots.readInstalledSnapshot(identity.snapshotDigest)
        const plugin = await this.#closures.validate(snapshot)
        if (plugin.id !== identity.pluginId || plugin.version !== identity.version) {
          throw runtimeError("Pinned Plugin identity does not match its immutable closure")
        }
        this.#rememberIdentity(identity)
        return this.#closures.createHandle(snapshot, Object.freeze({ ...identity }), plugin, pinned.lease)
      } catch (error) {
        pinned.lease.release()
        throw error
      }
    })
  }

  async assertCurrentActivePlugin(identity: ActivePluginRuntimeIdentity) {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const active = await this.#snapshots.readActive()
      if (
        !active.activeSet ||
        active.revision !== identity.activeRevision ||
        active.activeSet.digest !== identity.activeSetDigest ||
        !active.activeSet.descriptor.plugins.some(
          (reference) =>
            reference.pluginId === identity.pluginId && reference.snapshotDigest === identity.snapshotDigest,
        )
      ) {
        throw runtimeError(`Plugin changed before the current-identity guard: ${identity.pluginId}`)
      }
      await this.#verifyActiveCapabilityTopology(active)
      const snapshot = await this.#snapshots.readInstalledSnapshot(identity.snapshotDigest)
      const plugin = await this.#closures.validate(snapshot)
      if (plugin.version !== identity.version) {
        throw runtimeError(`Plugin changed before the current-identity guard: ${identity.pluginId}`)
      }
      this.#rememberIdentity(identity)
    })
  }

  /**
   * Collects inactive, unleased and unpinned closures. Closure renames happen
   * before descriptor deletion and roll back if the canonical store observes
   * a new liveness root; post-commit cleanup remnants are inert and retryable.
   */
  async collectGarbage(): Promise<PluginSnapshotGarbageCollectionCandidates> {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const candidates = await this.#snapshots.listGarbageCollectionCandidates()
      const renamed: StagedPluginClosureGarbage[] = []
      try {
        for (const snapshotDigest of candidates.installedSnapshotDigests) {
          const snapshot = await this.#snapshots.readInstalledSnapshot(snapshotDigest)
          renamed.push(await this.#closures.stageGarbage(snapshot))
        }
        await this.#snapshots.collectGarbageCollectionCandidates(candidates)
      } catch (error) {
        const failures: unknown[] = [error]
        for (const entry of [...renamed].reverse()) {
          try {
            await this.#closures.restoreGarbage(entry)
          } catch (restoreError) {
            failures.push(restoreError)
          }
        }
        if (failures.length > 1) {
          throw runtimeError(
            "Plugin snapshot GC rollback failed",
            new AggregateError(failures, "Plugin snapshot GC rollback failures", { cause: error }),
          )
        }
        throw error
      }
      await Promise.all(renamed.map((entry) => this.#closures.deleteGarbage(entry).catch(() => undefined)))
      const collectedSnapshots = new Set(candidates.installedSnapshotDigests)
      for (const [key, identity] of this.#observedBindings) {
        if (collectedSnapshots.has(identity.snapshotDigest)) this.#observedBindings.delete(key)
      }
      return candidates
    })
  }

  /** Renderer-safe inventory still derives exclusively from the ActiveSet. */
  async list(): Promise<ActiveInstalledWebPluginSummary[]> {
    return (await this.readActive()).plugins.map(({ identity, plugin }) =>
      Object.freeze({
        ...plugin,
        activeRevision: identity.activeRevision,
        activeSetDigest: identity.activeSetDigest,
        snapshotDigest: identity.snapshotDigest,
      }),
    )
  }

  /**
   * Re-resolvable principal identity. Callers must retain the returned
   * ActiveSet/snapshot fields in their principal and compare all of them on
   * every privileged call; `digest` remains for the existing manifest-identity
   * port during the cutover.
   */
  async resolveCapabilityIdentity(pluginIdInput: string): Promise<ActivePluginCapabilityIdentity | null> {
    const pluginId = requireWebPluginId(pluginIdInput)
    try {
      const handle = await this.acquireActivePlugin(pluginId)
      try {
        return Object.freeze({
          activeRevision: handle.identity.activeRevision,
          activeSetDigest: handle.identity.activeSetDigest,
          digest: handle.descriptor.authorizations.capabilityContractDigest,
          manifestDigest: handle.descriptor.authorizations.capabilityContractDigest,
          plugin: handle.plugin,
          snapshotDigest: handle.identity.snapshotDigest,
        })
      } finally {
        handle.release()
      }
    } catch (error) {
      if (error instanceof PluginNotActiveError) return null
      throw error
    }
  }

  async acquireActivePlugin(pluginIdInput: string): Promise<ActivePluginRuntimeHandle> {
    const pluginId = requireWebPluginId(pluginIdInput)
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const active = await this.#snapshots.readActive()
      if (!active.activeSet) throw new PluginNotActiveError(pluginId)
      await this.#verifyActiveCapabilityTopology(active)
      const reference = active.activeSet.descriptor.plugins.find((candidate) => candidate.pluginId === pluginId)
      if (!reference) throw new PluginNotActiveError(pluginId)
      const lease = await this.#snapshots.acquireActiveSetLease(active.activeSet.digest)
      try {
        const snapshot = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
        const plugin = await this.#closures.validate(snapshot)
        const identity = this.#rememberIdentity(
          Object.freeze({
            activeRevision: active.revision,
            activeSetDigest: active.activeSet.digest,
            pluginId,
            snapshotDigest: snapshot.digest,
            version: snapshot.descriptor.version,
          }),
        )
        return this.#closures.createHandle(snapshot, identity, plugin, lease)
      } catch (error) {
        lease.release()
        throw error
      }
    })
  }

  async acquirePluginSnapshot(identity: PluginSnapshotRuntimeIdentity): Promise<ActivePluginRuntimeHandle> {
    const activeRevision = Number(identity.activeRevision)
    if (!Number.isSafeInteger(activeRevision) || activeRevision < 1) {
      throw runtimeError("Historical Plugin active revision is invalid")
    }
    const pluginId = requireWebPluginId(identity.pluginId)
    const activeSetDigest = requireDigest(identity.activeSetDigest, "Historical Plugin ActiveSet digest")
    const snapshotDigest = requireDigest(identity.snapshotDigest, "Historical Plugin snapshot digest")
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const requestedIdentity = Object.freeze({
        activeRevision,
        activeSetDigest,
        pluginId,
        snapshotDigest,
        version: identity.pluginVersion,
      })
      if (!this.#observedBindings.has(this.#bindingKey(requestedIdentity))) {
        throw runtimeError("Historical Plugin identity was not observed from a trusted ActiveSet pointer")
      }
      const lease = await this.#snapshots.acquirePluginSnapshotLease(activeSetDigest, pluginId, snapshotDigest)
      try {
        const snapshot = await this.#snapshots.readInstalledSnapshot(snapshotDigest)
        const plugin = await this.#closures.validate(snapshot)
        if (plugin.id !== pluginId || plugin.version !== identity.pluginVersion) {
          throw runtimeError("Historical Plugin identity does not match its immutable closure")
        }
        return this.#closures.createHandle(snapshot, requestedIdentity, plugin, lease)
      } catch (error) {
        lease.release()
        throw error
      }
    })
  }

  /**
   * Acquires every Plugin contribution from one revalidated ActiveSet. Each
   * child handle holds an independent lease on that exact generation so a
   * consumer can retain Hooks and Skills without mixing pointer revisions.
   */
  async acquireActivePluginSet(): Promise<ActivePluginRuntimeSetHandle> {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const active = await this.#snapshots.readActive()
      if (!active.activeSet) {
        let released = false
        return Object.freeze({
          activeSetDigest: null,
          plugins: Object.freeze([]),
          get released() {
            return released
          },
          release() {
            released = true
          },
          revision: active.revision,
        })
      }
      await this.#verifyActiveCapabilityTopology(active)
      const handles: ActivePluginRuntimeHandle[] = []
      try {
        for (const reference of active.activeSet.descriptor.plugins) {
          const lease = await this.#snapshots.acquireActiveSetLease(active.activeSet.digest)
          try {
            const snapshot = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
            const plugin = await this.#closures.validate(snapshot)
            handles.push(
              this.#closures.createHandle(
                snapshot,
                this.#rememberIdentity(
                  Object.freeze({
                    activeRevision: active.revision,
                    activeSetDigest: active.activeSet.digest,
                    pluginId: reference.pluginId,
                    snapshotDigest: snapshot.digest,
                    version: snapshot.descriptor.version,
                  }),
                ),
                plugin,
                lease,
              ),
            )
          } catch (error) {
            lease.release()
            throw error
          }
        }
      } catch (error) {
        handles.forEach((handle) => handle.release())
        throw error
      }
      let released = false
      const set = {
        activeSetDigest: active.activeSet.digest,
        plugins: Object.freeze(handles),
        get released() {
          return released
        },
        release() {
          if (released) return
          released = true
          handles.forEach((handle) => handle.release())
        },
        revision: active.revision,
      }
      return Object.freeze(set)
    })
  }

  async loadPublishedCapabilityPlan() {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const active = await this.#snapshots.readActive()
      if (!active.activeSet) {
        throw runtimeError("Active Plugin capability topology is unavailable")
      }
      const plugins = await this.#publishedCapabilityContracts(active.activeSet.descriptor.plugins)
      if (!verifyPluginCapabilityTopology(active.activeSet.descriptor.capabilityTopology, plugins)) {
        throw runtimeError("Active Plugin capability topology does not match its immutable snapshots")
      }
      return projectPluginCapabilityTopology(
        active.activeSet.descriptor.capabilityTopology,
        { revision: active.revision, activeSetDigest: active.activeSet.digest },
        plugins,
      )
    })
  }

  async acquireActiveSetCallLease(
    expected: { readonly activeRevision: number; readonly activeSetDigest: PluginSnapshotDigest },
    callerSnapshotDigest: PluginSnapshotDigest,
    providerSnapshotDigest: PluginSnapshotDigest,
  ): Promise<ActivePluginSetCallLease> {
    return this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      const active = await this.#snapshots.readActive()
      if (
        !active.activeSet ||
        active.revision !== expected.activeRevision ||
        active.activeSet.digest !== expected.activeSetDigest
      ) {
        throw runtimeError("Active Plugin set changed before the capability call lease was acquired")
      }
      await this.#verifyActiveCapabilityTopology(active)
      const lease = await this.#snapshots.acquireActiveSetCallLease(
        expected.activeRevision,
        expected.activeSetDigest,
        callerSnapshotDigest,
        providerSnapshotDigest,
      )
      return {
        activeRevision: expected.activeRevision,
        activeSetDigest: expected.activeSetDigest,
        callerSnapshotDigest,
        providerSnapshotDigest,
        get released() {
          return lease.released
        },
        release() {
          lease.release()
        },
      }
    })
  }

  /**
   * Breaking-cutover guard. Old mutable stores are never imported or silently
   * treated as a fallback when there is no ActiveSet pointer.
   */
  async assertNoLegacyState(legacyPaths: readonly string[]) {
    await this.#exclusive(async () => {
      await this.#closures.ensureLayout()
      await this.#closures.assertNoLegacyState(legacyPaths)
    })
  }

  async #readActive() {
    const active = await this.#snapshots.readActive()
    if (active.activeSet) await this.#verifyActiveCapabilityTopology(active)
    return this.#selection(active)
  }

  async #inspectRetiredHostApiRecovery(
    active: Awaited<ReturnType<PluginInstallationSnapshotStore["readActive"]>>,
  ): Promise<RetiredHostApiRecoveryInspection> {
    if (!active.activeSet) throw runtimeError("Retired Host API update recovery requires an ActiveSet")
    const contracts: PublishedPluginCapabilityContract[] = []
    const plugins: RetiredHostApiPluginRecovery[] = []
    for (const reference of active.activeSet.descriptor.plugins) {
      const snapshot = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
      let plugin: InstalledWebPluginSummary
      try {
        plugin = await this.#closures.validate(snapshot)
      } catch (currentError) {
        try {
          const recovery = await this.#closures.validateRetiredHostApiMajor(snapshot)
          plugin = recovery.current
          plugins.push(
            Object.freeze({
              artifact: Object.freeze({ ...snapshot.descriptor.package.artifact }),
              hostApiMajor: recovery.retiredMajor,
              pluginId: plugin.id,
              snapshotDigest: snapshot.digest,
              sourceIdentity: snapshot.descriptor.sourceIdentity,
              version: plugin.version,
            }),
          )
        } catch (recoveryError) {
          throw runtimeError(
            `Active Plugin snapshot is not eligible for retired Host API update recovery: ${reference.pluginId}`,
            new AggregateError([currentError, recoveryError]),
          )
        }
      }
      contracts.push(
        Object.freeze({
          capabilities: plugin.contributes.capabilities ?? emptyPluginCapabilityDeclaration,
          identity: Object.freeze({
            pluginId: plugin.id,
            pluginVersion: plugin.version,
            snapshotDigest: snapshot.digest,
          }),
        }),
      )
    }
    if (plugins.length === 0) throw runtimeError("ActiveSet has no retired Host API Plugin to recover")
    if (!verifyPluginCapabilityTopology(active.activeSet.descriptor.capabilityTopology, contracts)) {
      throw runtimeError("Retired Host API ActiveSet capability topology does not match its immutable snapshots")
    }
    return Object.freeze({
      plugins: Object.freeze(plugins),
      revision: active.revision,
    })
  }

  async #selection(active: Awaited<ReturnType<PluginInstallationSnapshotStore["readActive"]>>) {
    const plugins: ActiveInstalledPlugin[] = []
    for (const reference of active.activeSet?.descriptor.plugins ?? []) {
      const snapshot = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
      const plugin = await this.#closures.readManifest(snapshot)
      const identity = this.#rememberIdentity(
        Object.freeze({
          activeRevision: active.revision,
          activeSetDigest: active.activeSet!.digest,
          pluginId: reference.pluginId,
          snapshotDigest: reference.snapshotDigest,
          version: snapshot.descriptor.version,
        }),
      )
      plugins.push(
        Object.freeze({
          identity,
          plugin,
        }),
      )
    }
    return Object.freeze({
      activeSetDigest: active.activeSet?.digest ?? null,
      plugins: Object.freeze(plugins),
      revision: active.revision,
    })
  }

  async #assertSkillNamesUnique(references: readonly ActivePluginSnapshotReference[]) {
    const owners = new Map<string, string>()
    for (const reference of references) {
      const snapshot = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
      for (const skill of snapshot.descriptor.ownedSkills) {
        const prior = owners.get(skill.name)
        if (prior && prior !== reference.pluginId) {
          throw runtimeError(`Plugin-owned Skill name conflicts in the Active Plugin set: ${skill.name}`)
        }
        owners.set(skill.name, reference.pluginId)
      }
    }
  }

  async #publishedCapabilityContracts(
    references: readonly ActivePluginSnapshotReference[],
  ): Promise<PublishedPluginCapabilityContract[]> {
    const contracts: PublishedPluginCapabilityContract[] = []
    for (const reference of references) {
      const snapshot = await this.#snapshots.readInstalledSnapshot(reference.snapshotDigest)
      const plugin = await this.#closures.validate(snapshot)
      contracts.push(
        Object.freeze({
          capabilities: plugin.contributes.capabilities ?? emptyPluginCapabilityDeclaration,
          identity: Object.freeze({
            pluginId: plugin.id,
            pluginVersion: plugin.version,
            snapshotDigest: snapshot.digest,
          }),
        }),
      )
    }
    return contracts
  }

  async #planCapabilityTopology(
    references: readonly ActivePluginSnapshotReference[],
  ): Promise<PluginCapabilityTopology> {
    const result = planPluginCapabilityTopology(await this.#publishedCapabilityContracts(references))
    if (!result.ok) {
      throw runtimeError(`Plugin capability topology rejected ActiveSet: ${JSON.stringify(result.issues)}`)
    }
    return result.topology
  }

  async #verifyActiveCapabilityTopology(active: Awaited<ReturnType<PluginInstallationSnapshotStore["readActive"]>>) {
    if (!active.activeSet) return
    const contracts = await this.#publishedCapabilityContracts(active.activeSet.descriptor.plugins)
    if (!verifyPluginCapabilityTopology(active.activeSet.descriptor.capabilityTopology, contracts)) {
      throw runtimeError("Active Plugin capability topology does not match its immutable snapshots")
    }
  }

  #bindingKey(identity: ActivePluginRuntimeIdentity) {
    return [
      identity.activeRevision,
      identity.activeSetDigest,
      identity.pluginId,
      identity.snapshotDigest,
      identity.version,
    ].join(":")
  }

  #rememberIdentity(identity: ActivePluginRuntimeIdentity) {
    this.#observedBindings.set(this.#bindingKey(identity), identity)
    return identity
  }

  #exclusive<Result>(operation: () => Promise<Result>) {
    const result = this.#operations.then(operation, operation)
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
