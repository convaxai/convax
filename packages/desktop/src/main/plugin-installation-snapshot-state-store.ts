import { randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { requireWebPluginId } from "../plugin-contracts"
import {
  activePluginPointerSchema,
  ActivePluginSetRevisionConflictError,
  deepFreeze,
  normalizeActiveSetDescriptor,
  normalizeDigestList,
  normalizeInstalledDescriptor,
  normalizeOwnerPin,
  normalizeOwnerPins,
  normalizePointer,
  pluginSnapshotCanonicalDigest,
  pluginSnapshotCanonicalJson,
  pluginSnapshotOwnerPinsSchema,
  PluginInstallationSnapshotStoreError,
  requireDigest,
  requireOwnerKey,
  requireRevision,
  snapshotError,
  type ActivePluginSelection,
  type ActivePluginPointer,
  type ActivePluginSnapshotReference,
  type ActivePluginSetSnapshot,
  type ActivePluginSetSnapshotDescriptor,
  type CollectedPluginSnapshotGarbage,
  type InstalledPluginSnapshot,
  type InstalledPluginSnapshotDescriptor,
  type InstalledPluginSnapshotInput,
  type PersistentPluginSnapshotOwnerPins,
  type PluginInstallationSnapshotFaultContext,
  type PluginInstallationSnapshotFaultPoint,
  type PluginInstallationSnapshotStoreOptions,
  type PluginSnapshotDigest,
  type PluginSnapshotGarbageCollectionCandidates,
  type PluginSnapshotGarbageCollectionEligibility,
  type PluginSnapshotLease,
  type PluginSnapshotOwnerPin,
  type PluginSnapshotOwnerPinLease,
} from "./plugin-installation-snapshot-contracts"
import type { PluginCapabilityTopology } from "./plugin-capability-binding-plan"

const maximumDescriptorBytes = 4 * 1024 * 1024
const maximumPointerBytes = 4 * 1024
const maximumOwnerPinsBytes = 2 * 1024 * 1024
const maximumSnapshotLeaseDigests = 4_096
const maximumGarbageCollectionBatch = 1_024

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function compareStrings(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function sameFileIdentity(left: Awaited<ReturnType<typeof fs.lstat>>, right: Awaited<ReturnType<typeof fs.lstat>>) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function requirePrivateMode(info: Awaited<ReturnType<typeof fs.lstat>>, expected: number, label: string) {
  if (process.platform !== "win32" && (Number(info.mode) & 0o777) !== expected) {
    throw snapshotError(`${label} has unsafe permissions`)
  }
}

async function ensureRealDirectory(directoryPath: string, mode = 0o700) {
  await fs.mkdir(directoryPath, { mode, recursive: true })
  const info = await fs.lstat(directoryPath)
  if (!info.isDirectory() || info.isSymbolicLink()) throw snapshotError("Plugin snapshot directory is invalid")
  const [realDirectory, realParent] = await Promise.all([
    fs.realpath(directoryPath),
    fs.realpath(path.dirname(directoryPath)),
  ])
  if (realDirectory !== path.join(realParent, path.basename(directoryPath))) {
    throw snapshotError("Plugin snapshot directory cannot traverse a symbolic link")
  }
  if (process.platform !== "win32") {
    await fs.chmod(realDirectory, mode)
    requirePrivateMode(await fs.lstat(realDirectory), mode, "Plugin snapshot directory")
  }
  return realDirectory
}

async function inspectFile(filePath: string, mode: number, allowMissing: boolean) {
  try {
    const info = await fs.lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink()) throw snapshotError("Plugin snapshot file is invalid")
    requirePrivateMode(info, mode, "Plugin snapshot file")
    return info
  } catch (error) {
    if (allowMissing && isNodeError(error, "ENOENT")) return null
    if (error instanceof PluginInstallationSnapshotStoreError) throw error
    throw snapshotError("Plugin snapshot file is inaccessible", error)
  }
}

async function readJsonFile(filePath: string, maximumBytes: number, mode: number, allowMissing: boolean) {
  const before = await inspectFile(filePath, mode, allowMissing)
  if (!before) return null
  if (before.size < 1 || before.size > maximumBytes) throw snapshotError("Plugin snapshot file size is invalid")
  const [realFile, realParent] = await Promise.all([fs.realpath(filePath), fs.realpath(path.dirname(filePath))])
  if (realFile !== path.join(realParent, path.basename(filePath))) {
    throw snapshotError("Plugin snapshot file cannot traverse a symbolic link")
  }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw snapshotError("Plugin snapshot file changed while opening")
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== before.size || bytes.byteLength > maximumBytes) {
      throw snapshotError("Plugin snapshot file changed while reading")
    }
    const after = await fs.lstat(filePath)
    if (!sameFileIdentity(before, after)) throw snapshotError("Plugin snapshot file changed while reading")
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch (error) {
      throw snapshotError("Plugin snapshot file is not valid UTF-8", error)
    }
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      throw snapshotError("Plugin snapshot file is not valid JSON", error)
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function fsyncDirectory(directoryPath: string) {
  if (process.platform === "win32") return
  try {
    const directory = await fs.open(directoryPath, "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch {
    // The temporary file was fsynced and rename already crossed the atomic
    // commit point. Reporting a pre-commit failure here would invite a retry
    // that guesses whether the pointer changed.
  }
}

interface AtomicWriteOptions {
  afterRenamePoint: PluginInstallationSnapshotFaultPoint
  afterTempSyncPoint?: PluginInstallationSnapshotFaultPoint
  context: PluginInstallationSnapshotFaultContext
  fileMode: number
  maximumBytes: number
  partialWritePoint?: PluginInstallationSnapshotFaultPoint
}

async function atomicWriteFile(
  target: string,
  canonicalValue: unknown,
  faultHook: PluginInstallationSnapshotStoreOptions["faultHook"],
  options: AtomicWriteOptions,
) {
  const serialized = Buffer.from(`${pluginSnapshotCanonicalJson(canonicalValue)}\n`, "utf8")
  if (serialized.byteLength < 1 || serialized.byteLength > options.maximumBytes) {
    throw snapshotError("Plugin snapshot serialized state exceeds its size limit")
  }
  const directory = path.dirname(target)
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  let preserveTemporary = false
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
      options.fileMode,
    )
    await handle.chmod(options.fileMode)
    const split = Math.max(1, Math.floor(serialized.byteLength / 2))
    await handle.writeFile(serialized.subarray(0, split))
    if (options.partialWritePoint && faultHook) {
      try {
        await faultHook(options.partialWritePoint, options.context)
      } catch (error) {
        preserveTemporary = true
        throw error
      }
    }
    await handle.writeFile(serialized.subarray(split))
    await handle.sync()
    if (options.afterTempSyncPoint && faultHook) {
      try {
        await faultHook(options.afterTempSyncPoint, options.context)
      } catch (error) {
        preserveTemporary = true
        throw error
      }
    }
    await handle.close()
    handle = undefined
    await fs.rename(temporary, target)
    await fsyncDirectory(directory)
    await faultHook?.(options.afterRenamePoint, options.context)
  } finally {
    await handle?.close().catch(() => undefined)
    if (!preserveTemporary) await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

class InMemoryPluginSnapshotLease implements PluginSnapshotLease {
  #released = false
  readonly #releaseLease: () => void

  constructor(releaseLease: () => void) {
    this.#releaseLease = releaseLease
  }

  get released() {
    return this.#released
  }

  release() {
    if (this.#released) return
    this.#released = true
    this.#releaseLease()
  }
}

/**
 * Main-owned store for immutable Plugin closures and the sole mutable active
 * pointer. A published pointer is accepted only after its entire ActiveSet and
 * every referenced InstalledSnapshot have been revalidated by digest.
 *
 * This store intentionally has no fields for preferences, OAuth, Cookies,
 * Canvas state, or LRO state. Those owners retain exact ActiveSet membership
 * through owner-scoped pins without copying domain state into this schema.
 */
export class PluginInstallationSnapshotStore {
  readonly #activePointerPath: string
  readonly #activeSetDirectory: string
  readonly #faultHook: PluginInstallationSnapshotStoreOptions["faultHook"]
  readonly #installedDirectory: string
  readonly #leasedActiveSets = new Map<PluginSnapshotDigest, number>()
  readonly #leasedSnapshots = new Map<PluginSnapshotDigest, number>()
  readonly #ownerPinsPath: string
  readonly #rootPath: string
  #operations: Promise<void> = Promise.resolve()

  constructor(rootPath: string, options: PluginInstallationSnapshotStoreOptions = {}) {
    if (!path.isAbsolute(rootPath) || rootPath.includes("\0")) {
      throw snapshotError("Plugin installation snapshot root must be an absolute path")
    }
    this.#rootPath = path.resolve(rootPath)
    this.#installedDirectory = path.join(this.#rootPath, "installed")
    this.#activeSetDirectory = path.join(this.#rootPath, "active-sets")
    this.#activePointerPath = path.join(this.#rootPath, "active-pointer.json")
    this.#ownerPinsPath = path.join(this.#rootPath, "owner-pins.json")
    this.#faultHook = options.faultHook
  }

  async putInstalledSnapshot(input: InstalledPluginSnapshotInput): Promise<InstalledPluginSnapshot> {
    const descriptor = normalizeInstalledDescriptor(input, false)
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      return this.#putInstalledDescriptor(descriptor)
    })
  }

  async readInstalledSnapshot(digestInput: PluginSnapshotDigest): Promise<InstalledPluginSnapshot> {
    const digest = requireDigest(digestInput, "Installed Plugin snapshot digest")
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      return this.#readInstalledSnapshot(digest)
    })
  }

  async readActive(): Promise<ActivePluginSelection> {
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      return this.#readActive()
    })
  }

  /**
   * Stores a normalized immutable ActiveSet, then atomically CAS-publishes one
   * global pointer to it. A crash before pointer rename leaves the previous
   * revision active; a crash after rename exposes the complete next revision.
   */
  async compareAndSwapActiveSet(
    expectedRevisionInput: number,
    input: {
      readonly capabilityTopology: PluginCapabilityTopology
      readonly plugins: readonly ActivePluginSnapshotReference[]
    },
  ): Promise<ActivePluginSelection> {
    const expectedRevision = requireRevision(expectedRevisionInput, "Expected active Plugin set revision", true)
    const descriptor = normalizeActiveSetDescriptor(input, false)
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const current = await this.#readActive()
      if (current.revision !== expectedRevision) {
        throw new ActivePluginSetRevisionConflictError(expectedRevision, current.revision)
      }
      for (const reference of descriptor.plugins) {
        const snapshot = await this.#readInstalledSnapshot(reference.snapshotDigest)
        if (snapshot.descriptor.pluginId !== reference.pluginId) {
          throw snapshotError("Active Plugin reference does not match its Installed Plugin snapshot")
        }
      }
      const activeSet = await this.#putActiveSetDescriptor(descriptor)
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        throw snapshotError("Active Plugin pointer revision is exhausted")
      }
      const pointer: ActivePluginPointer = {
        activeSetDigest: activeSet.digest,
        revision: current.revision + 1,
        schema: activePluginPointerSchema,
      }
      await inspectFile(this.#activePointerPath, 0o600, true)
      await atomicWriteFile(this.#activePointerPath, pointer, this.#faultHook, {
        afterRenamePoint: "active-pointer.renamed",
        afterTempSyncPoint: "active-pointer.temp-synced",
        context: { digest: activeSet.digest, revision: pointer.revision },
        fileMode: 0o600,
        maximumBytes: maximumPointerBytes,
      })
      return deepFreeze({ activeSet, revision: pointer.revision })
    })
  }

  async readOwnerPins(): Promise<PersistentPluginSnapshotOwnerPins> {
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      return this.#readOwnerPins()
    })
  }

  /**
   * Adds one owner without replacing any other owner's durable GC root. The
   * binding is admitted only while its exact ActiveSet is still current.
   */
  async pinActivePluginForOwner(
    ownerKeyInput: string,
    identityInput: Omit<PluginSnapshotOwnerPin, "ownerKey">,
  ): Promise<PluginSnapshotOwnerPin> {
    const ownerKey = requireOwnerKey(ownerKeyInput)
    const requested = normalizeOwnerPin({ ...identityInput, ownerKey })
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const active = await this.#readActive()
      if (
        !active.activeSet ||
        active.revision !== requested.activeRevision ||
        active.activeSet.digest !== requested.activeSetDigest ||
        !active.activeSet.descriptor.plugins.some(
          (reference) =>
            reference.pluginId === requested.pluginId && reference.snapshotDigest === requested.snapshotDigest,
        )
      ) {
        throw snapshotError("Plugin snapshot pin identity is not the current Active Plugin")
      }
      const snapshot = await this.#readInstalledSnapshot(requested.snapshotDigest)
      if (snapshot.descriptor.pluginId !== requested.pluginId) {
        throw snapshotError("Plugin snapshot pin identity does not match its InstalledSnapshot")
      }
      const current = await this.#readOwnerPins()
      const existing = current.pins.find((pin) => pin.ownerKey === ownerKey)
      if (existing) {
        if (pluginSnapshotCanonicalJson(existing) !== pluginSnapshotCanonicalJson(requested)) {
          throw snapshotError(`Plugin snapshot pin owner is already bound to another identity: ${ownerKey}`)
        }
        return existing
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        throw snapshotError("Plugin snapshot owner pins revision is exhausted")
      }
      const next: PersistentPluginSnapshotOwnerPins = {
        pins: [...current.pins, requested].sort((left, right) => compareStrings(left.ownerKey, right.ownerKey)),
        revision: current.revision + 1,
        schema: pluginSnapshotOwnerPinsSchema,
      }
      await this.#writeOwnerPins(next)
      return deepFreeze(requested)
    })
  }

  async unpinPluginOwner(ownerKeyInput: string, expectedInput: Omit<PluginSnapshotOwnerPin, "ownerKey">) {
    const ownerKey = requireOwnerKey(ownerKeyInput)
    const expected = normalizeOwnerPin({ ...expectedInput, ownerKey })
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const current = await this.#readOwnerPins()
      const existing = current.pins.find((pin) => pin.ownerKey === ownerKey)
      if (!existing) return false
      if (pluginSnapshotCanonicalJson(existing) !== pluginSnapshotCanonicalJson(expected)) {
        throw snapshotError(`Plugin snapshot pin owner identity changed: ${ownerKey}`)
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        throw snapshotError("Plugin snapshot owner pins revision is exhausted")
      }
      await this.#writeOwnerPins({
        pins: current.pins.filter((pin) => pin.ownerKey !== ownerKey),
        revision: current.revision + 1,
        schema: pluginSnapshotOwnerPinsSchema,
      })
      return true
    })
  }

  async acquireOwnerPinLease(
    ownerKeyInput: string,
    expectedInput: Omit<PluginSnapshotOwnerPin, "ownerKey">,
  ): Promise<PluginSnapshotOwnerPinLease> {
    const ownerKey = requireOwnerKey(ownerKeyInput)
    const expected = normalizeOwnerPin({ ...expectedInput, ownerKey })
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const ownerPins = await this.#readOwnerPins()
      const pin = ownerPins.pins.find((candidate) => candidate.ownerKey === ownerKey)
      if (!pin || pluginSnapshotCanonicalJson(pin) !== pluginSnapshotCanonicalJson(expected)) {
        throw snapshotError(`Plugin snapshot pin owner is missing or stale: ${ownerKey}`)
      }
      const activeSet = await this.#readActiveSet(pin.activeSetDigest)
      if (
        !activeSet.descriptor.plugins.some(
          (reference) => reference.pluginId === pin.pluginId && reference.snapshotDigest === pin.snapshotDigest,
        )
      ) {
        throw snapshotError("Plugin snapshot owner pin does not belong to its retained ActiveSet")
      }
      await this.#readInstalledSnapshot(pin.snapshotDigest)
      this.#incrementLease(this.#leasedActiveSets, pin.activeSetDigest)
      this.#incrementLease(this.#leasedSnapshots, pin.snapshotDigest)
      return deepFreeze({
        lease: new InMemoryPluginSnapshotLease(() => {
          this.#decrementLease(this.#leasedActiveSets, pin.activeSetDigest)
          this.#decrementLease(this.#leasedSnapshots, pin.snapshotDigest)
        }),
        pin,
      })
    })
  }

  /** Acquires a process-local lease for exact InstalledSnapshot digests. */
  async acquireSnapshotLease(snapshotDigestsInput: readonly PluginSnapshotDigest[]): Promise<PluginSnapshotLease> {
    const snapshotDigests = normalizeDigestList(
      snapshotDigestsInput,
      "Plugin snapshot lease",
      maximumSnapshotLeaseDigests,
    )
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      for (const digest of snapshotDigests) await this.#readInstalledSnapshot(digest)
      snapshotDigests.forEach((digest) => this.#incrementLease(this.#leasedSnapshots, digest))
      return new InMemoryPluginSnapshotLease(() => {
        snapshotDigests.forEach((digest) => this.#decrementLease(this.#leasedSnapshots, digest))
      })
    })
  }

  /**
   * Leases one immutable ActiveSet and its complete InstalledSnapshot closure,
   * preventing collection while a runtime generation still uses old bytes.
   */
  async acquireActiveSetLease(activeSetDigestInput: PluginSnapshotDigest): Promise<PluginSnapshotLease> {
    const activeSetDigest = requireDigest(activeSetDigestInput, "Active Plugin set lease digest")
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const activeSet = await this.#readActiveSet(activeSetDigest)
      this.#incrementLease(this.#leasedActiveSets, activeSetDigest)
      activeSet.descriptor.plugins.forEach(({ snapshotDigest }) =>
        this.#incrementLease(this.#leasedSnapshots, snapshotDigest),
      )
      return new InMemoryPluginSnapshotLease(() => {
        this.#decrementLease(this.#leasedActiveSets, activeSetDigest)
        activeSet.descriptor.plugins.forEach(({ snapshotDigest }) =>
          this.#decrementLease(this.#leasedSnapshots, snapshotDigest),
        )
      })
    })
  }

  /**
   * Leases one exact Plugin snapshot through the historical ActiveSet that
   * admitted it. This never resolves by Plugin id against the current pointer.
   */
  async acquirePluginSnapshotLease(
    activeSetDigestInput: PluginSnapshotDigest,
    pluginIdInput: string,
    snapshotDigestInput: PluginSnapshotDigest,
  ): Promise<PluginSnapshotLease> {
    const activeSetDigest = requireDigest(activeSetDigestInput, "Historical Active Plugin set lease digest")
    const pluginId = requireWebPluginId(pluginIdInput)
    const snapshotDigest = requireDigest(snapshotDigestInput, "Historical Plugin snapshot lease digest")
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const activeSet = await this.#readActiveSet(activeSetDigest)
      if (
        !activeSet.descriptor.plugins.some(
          (reference) => reference.pluginId === pluginId && reference.snapshotDigest === snapshotDigest,
        )
      ) {
        throw snapshotError("Plugin snapshot does not belong to the exact historical ActiveSet")
      }
      const snapshot = await this.#readInstalledSnapshot(snapshotDigest)
      if (snapshot.descriptor.pluginId !== pluginId) {
        throw snapshotError("Historical Plugin snapshot identity does not match its InstalledSnapshot")
      }
      this.#incrementLease(this.#leasedActiveSets, activeSetDigest)
      this.#incrementLease(this.#leasedSnapshots, snapshotDigest)
      return new InMemoryPluginSnapshotLease(() => {
        this.#decrementLease(this.#leasedActiveSets, activeSetDigest)
        this.#decrementLease(this.#leasedSnapshots, snapshotDigest)
      })
    })
  }

  /**
   * Atomically revalidates the current pointer and pins one capability call's
   * exact ActiveSet, caller, and provider snapshots under the same store lock.
   */
  async acquireActiveSetCallLease(
    expectedRevisionInput: number,
    activeSetDigestInput: PluginSnapshotDigest,
    callerSnapshotDigestInput: PluginSnapshotDigest,
    providerSnapshotDigestInput: PluginSnapshotDigest,
  ): Promise<PluginSnapshotLease> {
    const expectedRevision = requireRevision(expectedRevisionInput, "Expected Active Plugin revision", false)
    const activeSetDigest = requireDigest(activeSetDigestInput, "Active Plugin set lease digest")
    const callerSnapshotDigest = requireDigest(callerSnapshotDigestInput, "Caller Plugin snapshot lease digest")
    const providerSnapshotDigest = requireDigest(providerSnapshotDigestInput, "Provider Plugin snapshot lease digest")
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const current = await this.#readActive()
      if (!current.activeSet || current.revision !== expectedRevision || current.activeSet.digest !== activeSetDigest) {
        throw snapshotError("Active Plugin set changed before the capability call lease was acquired")
      }
      const activeSet = current.activeSet
      const referenced = new Set(activeSet.descriptor.plugins.map(({ snapshotDigest }) => snapshotDigest))
      if (!referenced.has(callerSnapshotDigest) || !referenced.has(providerSnapshotDigest)) {
        throw snapshotError("Capability call snapshots do not belong to the expected Active Plugin set")
      }
      await Promise.all(
        activeSet.descriptor.plugins.map(({ snapshotDigest }) => this.#readInstalledSnapshot(snapshotDigest)),
      )
      this.#incrementLease(this.#leasedActiveSets, activeSetDigest)
      activeSet.descriptor.plugins.forEach(({ snapshotDigest }) =>
        this.#incrementLease(this.#leasedSnapshots, snapshotDigest),
      )
      return new InMemoryPluginSnapshotLease(() => {
        this.#decrementLease(this.#leasedActiveSets, activeSetDigest)
        activeSet.descriptor.plugins.forEach(({ snapshotDigest }) =>
          this.#decrementLease(this.#leasedSnapshots, snapshotDigest),
        )
      })
    })
  }

  async getGarbageCollectionEligibility(
    snapshotDigestInput: PluginSnapshotDigest,
  ): Promise<PluginSnapshotGarbageCollectionEligibility> {
    const snapshotDigest = requireDigest(snapshotDigestInput, "Plugin snapshot GC digest")
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      await this.#readInstalledSnapshot(snapshotDigest)
      const roots = await this.#garbageCollectionRoots()
      return this.#eligibility(snapshotDigest, roots)
    })
  }

  /**
   * Returns candidates only; deletion stays an explicit caller-owned phase.
   * Any malformed entry, pointer, ActiveSet, pin, or InstalledSnapshot aborts
   * the scan so GC never guesses liveness from partial state.
   */
  async listGarbageCollectionCandidates(): Promise<PluginSnapshotGarbageCollectionCandidates> {
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const roots = await this.#garbageCollectionRoots()
      const installedSnapshotDigests = await this.#listContentAddressedDigests(this.#installedDirectory, "installed")
      for (const digest of installedSnapshotDigests) await this.#readInstalledSnapshot(digest)
      const activeSetDigests = await this.#listContentAddressedDigests(this.#activeSetDirectory, "active-set")
      const activeSets = new Map<string, ActivePluginSetSnapshot>()
      for (const digest of activeSetDigests) activeSets.set(digest, await this.#readActiveSet(digest))
      const collectableActiveSets = activeSetDigests
        .filter(
          (digest) =>
            digest !== roots.activeSetDigest &&
            !roots.pinnedActiveSets.has(digest) &&
            !this.#leasedActiveSets.has(digest),
        )
        .slice(0, maximumGarbageCollectionBatch)
      const collectedActiveSetDigests = new Set(collectableActiveSets)
      const retainedActiveSetSnapshots = new Set(
        activeSetDigests
          .filter((digest) => !collectedActiveSetDigests.has(digest))
          .flatMap(
            (digest) => activeSets.get(digest)?.descriptor.plugins.map(({ snapshotDigest }) => snapshotDigest) ?? [],
          ),
      )
      return deepFreeze({
        activeSetDigests: collectableActiveSets,
        installedSnapshotDigests: installedSnapshotDigests
          .filter((digest) => this.#eligibility(digest, roots).eligible && !retainedActiveSetSnapshots.has(digest))
          .slice(0, maximumGarbageCollectionBatch),
      })
    })
  }

  /**
   * Deletes only an exact subset of a freshly recomputed candidate set.
   * A stale request, lease, pin, active reference, malformed file, or digest
   * mismatch aborts before the first unlink.
   */
  async collectGarbageCollectionCandidates(
    candidatesInput: PluginSnapshotGarbageCollectionCandidates,
  ): Promise<CollectedPluginSnapshotGarbage> {
    const activeSetDigests = normalizeDigestList(
      candidatesInput.activeSetDigests,
      "Plugin ActiveSet GC request",
      maximumGarbageCollectionBatch,
    )
    const installedSnapshotDigests = normalizeDigestList(
      candidatesInput.installedSnapshotDigests,
      "Installed Plugin snapshot GC request",
      maximumGarbageCollectionBatch,
    )
    return this.#exclusive(async () => {
      await this.#ensureLayout()
      const roots = await this.#garbageCollectionRoots()
      const currentInstalled = await this.#listContentAddressedDigests(this.#installedDirectory, "installed")
      const currentActiveSets = await this.#listContentAddressedDigests(this.#activeSetDirectory, "active-set")
      for (const digest of currentInstalled) await this.#readInstalledSnapshot(digest)
      const activeSets = new Map<string, ActivePluginSetSnapshot>()
      for (const digest of currentActiveSets) activeSets.set(digest, await this.#readActiveSet(digest))
      const eligibleInstalled = new Set(currentInstalled.filter((digest) => this.#eligibility(digest, roots).eligible))
      const eligibleActiveSets = new Set(
        currentActiveSets.filter(
          (digest) =>
            digest !== roots.activeSetDigest &&
            !roots.pinnedActiveSets.has(digest) &&
            !this.#leasedActiveSets.has(digest),
        ),
      )
      const requestedActiveSets = new Set(activeSetDigests)
      const retainedActiveSetSnapshots = new Set(
        currentActiveSets
          .filter((digest) => !requestedActiveSets.has(digest))
          .flatMap(
            (digest) => activeSets.get(digest)?.descriptor.plugins.map(({ snapshotDigest }) => snapshotDigest) ?? [],
          ),
      )
      if (
        installedSnapshotDigests.some(
          (digest) => !eligibleInstalled.has(digest) || retainedActiveSetSnapshots.has(digest),
        ) ||
        activeSetDigests.some((digest) => !eligibleActiveSets.has(digest))
      ) {
        throw snapshotError("Plugin snapshot GC request is stale or contains a live snapshot")
      }
      for (const digest of activeSetDigests) {
        await fs.unlink(path.join(this.#activeSetDirectory, `${digest}.json`))
      }
      for (const digest of installedSnapshotDigests) {
        await fs.unlink(path.join(this.#installedDirectory, `${digest}.json`))
      }
      if (activeSetDigests.length) await fsyncDirectory(this.#activeSetDirectory)
      if (installedSnapshotDigests.length) await fsyncDirectory(this.#installedDirectory)
      return deepFreeze({ activeSetDigests, installedSnapshotDigests })
    })
  }

  #exclusive<Result>(operation: () => Promise<Result>) {
    const result = this.#operations.then(operation, operation)
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #ensureLayout() {
    await ensureRealDirectory(this.#rootPath)
    await Promise.all([ensureRealDirectory(this.#installedDirectory), ensureRealDirectory(this.#activeSetDirectory)])
  }

  async #putInstalledDescriptor(descriptor: InstalledPluginSnapshotDescriptor): Promise<InstalledPluginSnapshot> {
    const digest = pluginSnapshotCanonicalDigest(descriptor)
    const target = path.join(this.#installedDirectory, `${digest}.json`)
    if (await inspectFile(target, 0o400, true)) return this.#readInstalledSnapshot(digest)
    await atomicWriteFile(target, descriptor, this.#faultHook, {
      afterRenamePoint: "installed-snapshot.renamed",
      context: { digest },
      fileMode: 0o400,
      maximumBytes: maximumDescriptorBytes,
      partialWritePoint: "installed-snapshot.partial-written",
    })
    return this.#readInstalledSnapshot(digest)
  }

  async #putActiveSetDescriptor(descriptor: ActivePluginSetSnapshotDescriptor): Promise<ActivePluginSetSnapshot> {
    const digest = pluginSnapshotCanonicalDigest(descriptor)
    const target = path.join(this.#activeSetDirectory, `${digest}.json`)
    if (await inspectFile(target, 0o400, true)) return this.#readActiveSet(digest)
    await atomicWriteFile(target, descriptor, this.#faultHook, {
      afterRenamePoint: "active-set.renamed-before-pointer",
      context: { digest },
      fileMode: 0o400,
      maximumBytes: maximumDescriptorBytes,
      partialWritePoint: "active-set.partial-written",
    })
    return this.#readActiveSet(digest)
  }

  async #readInstalledSnapshot(digest: PluginSnapshotDigest): Promise<InstalledPluginSnapshot> {
    const target = path.join(this.#installedDirectory, `${digest}.json`)
    const value = await readJsonFile(target, maximumDescriptorBytes, 0o400, false)
    const descriptor = normalizeInstalledDescriptor(value, true)
    if (pluginSnapshotCanonicalDigest(descriptor) !== digest) {
      throw snapshotError("Installed Plugin snapshot content digest does not match its address")
    }
    return deepFreeze({ descriptor, digest })
  }

  async #readActiveSet(digest: PluginSnapshotDigest): Promise<ActivePluginSetSnapshot> {
    const target = path.join(this.#activeSetDirectory, `${digest}.json`)
    const value = await readJsonFile(target, maximumDescriptorBytes, 0o400, false)
    const descriptor = normalizeActiveSetDescriptor(value, true)
    if (pluginSnapshotCanonicalDigest(descriptor) !== digest) {
      throw snapshotError("Active Plugin set content digest does not match its address")
    }
    for (const reference of descriptor.plugins) {
      const snapshot = await this.#readInstalledSnapshot(reference.snapshotDigest)
      if (snapshot.descriptor.pluginId !== reference.pluginId) {
        throw snapshotError("Active Plugin set references a mismatched Installed Plugin snapshot")
      }
    }
    return deepFreeze({ descriptor, digest })
  }

  async #readActive(): Promise<ActivePluginSelection> {
    const value = await readJsonFile(this.#activePointerPath, maximumPointerBytes, 0o600, true)
    if (value === null) return deepFreeze({ activeSet: null, revision: 0 })
    const pointer = normalizePointer(value)
    const activeSet = await this.#readActiveSet(pointer.activeSetDigest)
    return deepFreeze({ activeSet, revision: pointer.revision })
  }

  async #readOwnerPins(): Promise<PersistentPluginSnapshotOwnerPins> {
    const value = await readJsonFile(this.#ownerPinsPath, maximumOwnerPinsBytes, 0o600, true)
    if (value === null) {
      return deepFreeze({
        pins: [],
        revision: 0,
        schema: pluginSnapshotOwnerPinsSchema,
      })
    }
    const state = normalizeOwnerPins(value)
    for (const pin of state.pins) {
      const activeSet = await this.#readActiveSet(pin.activeSetDigest)
      if (
        !activeSet.descriptor.plugins.some(
          (reference) => reference.pluginId === pin.pluginId && reference.snapshotDigest === pin.snapshotDigest,
        )
      ) {
        throw snapshotError("Plugin snapshot owner pin does not belong to its retained ActiveSet")
      }
      const snapshot = await this.#readInstalledSnapshot(pin.snapshotDigest)
      if (snapshot.descriptor.pluginId !== pin.pluginId) {
        throw snapshotError("Plugin snapshot owner pin does not match its InstalledSnapshot")
      }
    }
    return deepFreeze(state)
  }

  async #writeOwnerPins(next: PersistentPluginSnapshotOwnerPins) {
    await inspectFile(this.#ownerPinsPath, 0o600, true)
    await atomicWriteFile(this.#ownerPinsPath, next, this.#faultHook, {
      afterRenamePoint: "owner-pins.renamed",
      afterTempSyncPoint: "owner-pins.temp-synced",
      context: { revision: next.revision },
      fileMode: 0o600,
      maximumBytes: maximumOwnerPinsBytes,
    })
  }

  async #garbageCollectionRoots() {
    const [active, ownerPins] = await Promise.all([this.#readActive(), this.#readOwnerPins()])
    return {
      activeSetDigest: active.activeSet?.digest ?? null,
      activeSnapshots: new Set(active.activeSet?.descriptor.plugins.map(({ snapshotDigest }) => snapshotDigest) ?? []),
      pinnedActiveSets: new Set(ownerPins.pins.map(({ activeSetDigest }) => activeSetDigest)),
      pinnedSnapshots: new Set(ownerPins.pins.map(({ snapshotDigest }) => snapshotDigest)),
    }
  }

  #eligibility(
    snapshotDigest: PluginSnapshotDigest,
    roots: {
      activeSnapshots: ReadonlySet<PluginSnapshotDigest>
      pinnedSnapshots: ReadonlySet<PluginSnapshotDigest>
    },
  ): PluginSnapshotGarbageCollectionEligibility {
    const active = roots.activeSnapshots.has(snapshotDigest)
    const leased = this.#leasedSnapshots.has(snapshotDigest)
    const persistentlyPinned = roots.pinnedSnapshots.has(snapshotDigest)
    return deepFreeze({
      active,
      eligible: !active && !leased && !persistentlyPinned,
      leased,
      persistentlyPinned,
      snapshotDigest,
    })
  }

  async #listContentAddressedDigests(directory: string, temporaryPrefix: string) {
    const digests: PluginSnapshotDigest[] = []
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw snapshotError(`Plugin ${temporaryPrefix} temporary entry is invalid`)
        }
        continue
      }
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        throw snapshotError(`Plugin ${temporaryPrefix} snapshot directory contains invalid state`)
      }
      const digest = entry.name.slice(0, -".json".length)
      digests.push(requireDigest(digest, `Plugin ${temporaryPrefix} snapshot filename`))
    }
    return digests.sort(compareStrings)
  }

  #incrementLease(leases: Map<PluginSnapshotDigest, number>, digest: PluginSnapshotDigest) {
    leases.set(digest, (leases.get(digest) ?? 0) + 1)
  }

  #decrementLease(leases: Map<PluginSnapshotDigest, number>, digest: PluginSnapshotDigest) {
    const count = leases.get(digest)
    if (count === undefined) return
    if (count <= 1) leases.delete(digest)
    else leases.set(digest, count - 1)
  }
}
