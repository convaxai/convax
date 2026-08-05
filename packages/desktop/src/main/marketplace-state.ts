import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { canonicalJson, sha256Hex, type SourceKey } from "@convax/marketplace"
import { readBoundedAuthorityFile } from "./bounded-authority-file"
import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

export type MarketplaceItemKind = "plugin" | "skill" | "mcp-server"
export type InstalledCapabilityState = "attention" | "disabled" | "ready" | "setup-required"
export type RuntimeSurface = "agent" | "agent-and-convax" | "none"

export interface InstalledIdentity {
  id: string
  kind: MarketplaceItemKind
}

export interface InstallRecord extends InstalledIdentity {
  artifact?: {
    sha256: string
    size: number
  }
  artifactDigest: string
  revision: number
  runtimeSurface: RuntimeSurface
  sourceKey: SourceKey
  version: string
}

export interface ExecutionGrant {
  authorizationContractDigest: string
  identity: InstalledIdentity
  revision: number
  sourceKey: SourceKey
}

export interface RuntimePreference {
  desired: "disabled" | "enabled"
  identity: InstalledIdentity
  revision: number
  sourceKey: SourceKey
}

export interface ProvisioningDecision {
  decision: "removed-by-user"
  identity: InstalledIdentity
  marketplaceId: string
  observedPolicyRevision: number
  policyEntryDigest: string
  revision: number
  sourceKey: SourceKey
}

export interface CapabilityTransition {
  decision: "next" | "pending" | "previous"
  id: string
  identity: InstalledIdentity
  mutation: "disable" | "enable" | "install" | "setup" | "uninstall" | "update"
  next: InstallRecord | null
  owner: "execution-grant" | "managed-skill" | "mcp-metadata" | "plugin-package" | "runtime-preference"
  participants: Array<
    | {
        digest: string
        next: ExecutionGrant | null
        participant: "execution-grant"
        previous: ExecutionGrant | null
        state: "converged" | "pending" | "published"
      }
    | {
        digest: string
        next: InstallRecord | null
        participant: "install-record"
        previous: InstallRecord | null
        state: "converged" | "pending" | "published"
      }
    | {
        digest: string
        next: RuntimePreference | null
        participant: "runtime-preference"
        previous: RuntimePreference | null
        state: "converged" | "pending" | "published"
      }
  >
  phase: "converge" | "decide" | "prepare" | "publish" | "recovery-required"
  previous: InstallRecord | null
  revision: number
}

export interface MarketplaceState {
  executionGrants: ExecutionGrant[]
  installations: InstallRecord[]
  provisioningDecisions: ProvisioningDecision[]
  revision: number
  runtimePreferences: RuntimePreference[]
  schema: "convax.marketplace-state/1"
  transitions: CapabilityTransition[]
}

export function capabilityTransitionParticipantDigest(
  participant: Pick<CapabilityTransition["participants"][number], "next" | "participant" | "previous">,
) {
  return sha256Hex(
    canonicalJson({
      next: participant.next,
      participant: participant.participant,
      previous: participant.previous,
    }),
  )
}

export interface InstalledCapability {
  attention?: "integrity-or-authorization" | "setup-required-before-enable"
  id: string
  kind: MarketplaceItemKind
  runtimeSurface: RuntimeSurface
  sourceKey: SourceKey
  state: InstalledCapabilityState
  version: string
}

export class MarketplaceStateConflictError extends Error {
  override readonly name = "MarketplaceStateConflictError"
}

const digestPattern = /^[a-f0-9]{64}$/u
const sourceKeyPattern = /^[a-f0-9]{64}$/u
const transitionIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u
const maxStateBytes = 32 * 1024 * 1024
const maxInstallations = 16_384
const maxExecutionGrants = 16_384
const maxRuntimePreferences = 16_384
const maxProvisioningDecisions = 16_384
const maxTransitions = 4_096
const allowedKinds = new Set<MarketplaceItemKind>(["mcp-server", "plugin", "skill"])
const allowedRuntimeSurfaces = new Set<RuntimeSurface>(["agent", "agent-and-convax", "none"])
const stateKeys = [
  "executionGrants",
  "installations",
  "provisioningDecisions",
  "revision",
  "runtimePreferences",
  "schema",
  "transitions",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isIdentity(value: unknown): value is InstalledIdentity {
  return (
    isRecord(value) &&
    exactKeys(value, ["id", "kind"]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 256 &&
    allowedKinds.has(value.kind as MarketplaceItemKind)
  )
}

function isInstallRecord(value: unknown): value is InstallRecord {
  const keys =
    value && typeof value === "object" && "artifact" in value
      ? ["artifact", "artifactDigest", "id", "kind", "revision", "runtimeSurface", "sourceKey", "version"]
      : ["artifactDigest", "id", "kind", "revision", "runtimeSurface", "sourceKey", "version"]
  return (
    isRecord(value) &&
    exactKeys(value, keys) &&
    isIdentity({ id: value.id, kind: value.kind }) &&
    (value.artifact === undefined ||
      (isRecord(value.artifact) &&
        exactKeys(value.artifact, ["sha256", "size"]) &&
        typeof value.artifact.sha256 === "string" &&
        digestPattern.test(value.artifact.sha256) &&
        isPositiveInteger(value.artifact.size))) &&
    typeof value.artifactDigest === "string" &&
    digestPattern.test(value.artifactDigest) &&
    isPositiveInteger(value.revision) &&
    allowedRuntimeSurfaces.has(value.runtimeSurface as RuntimeSurface) &&
    typeof value.sourceKey === "string" &&
    sourceKeyPattern.test(value.sourceKey) &&
    typeof value.version === "string" &&
    value.version.length > 0 &&
    value.version.length <= 256
  )
}

function isExecutionGrant(value: unknown): value is ExecutionGrant {
  return (
    isRecord(value) &&
    exactKeys(value, ["authorizationContractDigest", "identity", "revision", "sourceKey"]) &&
    typeof value.authorizationContractDigest === "string" &&
    digestPattern.test(value.authorizationContractDigest) &&
    isIdentity(value.identity) &&
    isPositiveInteger(value.revision) &&
    typeof value.sourceKey === "string" &&
    sourceKeyPattern.test(value.sourceKey)
  )
}

function isRuntimePreference(value: unknown): value is RuntimePreference {
  return (
    isRecord(value) &&
    exactKeys(value, ["desired", "identity", "revision", "sourceKey"]) &&
    (value.desired === "disabled" || value.desired === "enabled") &&
    isIdentity(value.identity) &&
    isPositiveInteger(value.revision) &&
    typeof value.sourceKey === "string" &&
    sourceKeyPattern.test(value.sourceKey)
  )
}

function isProvisioningDecision(value: unknown): value is ProvisioningDecision {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "decision",
      "identity",
      "marketplaceId",
      "observedPolicyRevision",
      "policyEntryDigest",
      "revision",
      "sourceKey",
    ]) &&
    value.decision === "removed-by-user" &&
    isIdentity(value.identity) &&
    typeof value.marketplaceId === "string" &&
    value.marketplaceId.length > 0 &&
    value.marketplaceId.length <= 128 &&
    isPositiveInteger(value.observedPolicyRevision) &&
    typeof value.policyEntryDigest === "string" &&
    digestPattern.test(value.policyEntryDigest) &&
    isPositiveInteger(value.revision) &&
    typeof value.sourceKey === "string" &&
    sourceKeyPattern.test(value.sourceKey)
  )
}

function isTransition(value: unknown): value is CapabilityTransition {
  const valid =
    isRecord(value) &&
    exactKeys(value, [
      "decision",
      "id",
      "identity",
      "mutation",
      "next",
      "owner",
      "participants",
      "phase",
      "previous",
      "revision",
    ]) &&
    (value.decision === "next" || value.decision === "pending" || value.decision === "previous") &&
    typeof value.id === "string" &&
    transitionIdPattern.test(value.id) &&
    isIdentity(value.identity) &&
    (["disable", "enable", "install", "setup", "uninstall", "update"] as const).includes(
      value.mutation as CapabilityTransition["mutation"],
    ) &&
    (["execution-grant", "managed-skill", "mcp-metadata", "plugin-package", "runtime-preference"] as const).includes(
      value.owner as CapabilityTransition["owner"],
    ) &&
    (["converge", "decide", "prepare", "publish", "recovery-required"] as const).includes(
      value.phase as CapabilityTransition["phase"],
    ) &&
    (value.previous === null || isInstallRecord(value.previous)) &&
    (value.next === null || isInstallRecord(value.next)) &&
    Array.isArray(value.participants) &&
    value.participants.length > 0 &&
    value.participants.length <= 16 &&
    value.participants.every((participant) => {
      if (
        !isRecord(participant) ||
        !exactKeys(participant, ["digest", "next", "participant", "previous", "state"]) ||
        typeof participant.digest !== "string" ||
        !digestPattern.test(participant.digest) ||
        !(["converged", "pending", "published"] as const).includes(
          participant.state as CapabilityTransition["participants"][number]["state"],
        ) ||
        capabilityTransitionParticipantDigest(participant as CapabilityTransition["participants"][number]) !==
          participant.digest
      )
        return false
      if (participant.participant === "install-record") {
        return (
          (participant.previous === null || isInstallRecord(participant.previous)) &&
          (participant.next === null || isInstallRecord(participant.next))
        )
      }
      if (participant.participant === "execution-grant") {
        return (
          (participant.previous === null || isExecutionGrant(participant.previous)) &&
          (participant.next === null || isExecutionGrant(participant.next))
        )
      }
      if (participant.participant === "runtime-preference") {
        return (
          (participant.previous === null || isRuntimePreference(participant.previous)) &&
          (participant.next === null || isRuntimePreference(participant.next))
        )
      }
      return false
    }) &&
    isPositiveInteger(value.revision)
  if (!valid) return false
  const transition = value as unknown as CapabilityTransition
  if (
    (transition.previous && identityKey(transition.previous) !== identityKey(transition.identity)) ||
    (transition.next && identityKey(transition.next) !== identityKey(transition.identity)) ||
    new Set(transition.participants.map((participant) => participant.participant)).size !==
      transition.participants.length ||
    (transition.decision === "pending" && transition.phase === "converge") ||
    (transition.decision !== "pending" && transition.phase === "prepare") ||
    (transition.mutation === "install" && transition.next === null) ||
    (transition.mutation === "update" && (!transition.previous || !transition.next)) ||
    (transition.mutation === "uninstall" && transition.next !== null) ||
    (transition.mutation === "setup" && (!transition.previous || !transition.next))
  )
    return false
  return true
}

function identityKey(identity: InstalledIdentity) {
  return `${identity.kind}\0${identity.id}`
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string) {
  const seen = new Set<string>()
  for (const value of values) {
    const current = key(value)
    if (seen.has(current)) throw new Error(`Marketplace state repeats ${label}`)
    seen.add(current)
  }
}

function validateState(value: unknown): MarketplaceState {
  if (
    !isRecord(value) ||
    !exactKeys(value, stateKeys) ||
    value.schema !== "convax.marketplace-state/1" ||
    !isNonNegativeInteger(value.revision) ||
    !Array.isArray(value.installations) ||
    value.installations.length > maxInstallations ||
    !value.installations.every(isInstallRecord) ||
    !Array.isArray(value.executionGrants) ||
    value.executionGrants.length > maxExecutionGrants ||
    !value.executionGrants.every(isExecutionGrant) ||
    !Array.isArray(value.runtimePreferences) ||
    value.runtimePreferences.length > maxRuntimePreferences ||
    !value.runtimePreferences.every(isRuntimePreference) ||
    !Array.isArray(value.provisioningDecisions) ||
    value.provisioningDecisions.length > maxProvisioningDecisions ||
    !value.provisioningDecisions.every(isProvisioningDecision) ||
    !Array.isArray(value.transitions) ||
    value.transitions.length > maxTransitions ||
    !value.transitions.every(isTransition)
  ) {
    throw new Error("Marketplace state is invalid")
  }
  assertUnique(value.installations, identityKey, "installed identity")
  assertUnique(
    value.executionGrants,
    (record) => `${identityKey(record.identity)}\0${record.sourceKey}`,
    "ExecutionGrant",
  )
  assertUnique(
    value.runtimePreferences,
    (record) => `${identityKey(record.identity)}\0${record.sourceKey}`,
    "RuntimePreference",
  )
  assertUnique(
    value.provisioningDecisions,
    (record) => `${identityKey(record.identity)}\0${record.marketplaceId}`,
    "ProvisioningDecision",
  )
  assertUnique(value.transitions, (record) => record.id, "CapabilityTransition")
  const installedByIdentity = new Map(value.installations.map((record) => [identityKey(record), record]))
  for (const record of [...value.executionGrants, ...value.runtimePreferences]) {
    const installed = installedByIdentity.get(identityKey(record.identity))
    if (!installed || installed.sourceKey !== record.sourceKey || installed.runtimeSurface === "none") {
      throw new Error("Marketplace runtime authority does not match an installed runtime capability")
    }
  }
  return structuredClone(value) as unknown as MarketplaceState
}

function emptyState(): MarketplaceState {
  return {
    executionGrants: [],
    installations: [],
    provisioningDecisions: [],
    revision: 0,
    runtimePreferences: [],
    schema: "convax.marketplace-state/1",
    transitions: [],
  }
}

export interface MarketplaceInstalledSourceMigration {
  readonly fromSourceKey: SourceKey
  readonly id: string
  readonly kind: "plugin"
  readonly toSourceKey: SourceKey
}

function sourceMigrationKey(input: MarketplaceInstalledSourceMigration) {
  return `${input.kind}\0${input.id}\0${input.fromSourceKey}\0${input.toSourceKey}`
}

function assertSourceLocks(
  previous: MarketplaceState,
  next: MarketplaceState,
  allowedSourceMigrations: ReadonlySet<string>,
) {
  const previousByIdentity = new Map(previous.installations.map((record) => [identityKey(record), record]))
  for (const record of next.installations) {
    const installed = previousByIdentity.get(identityKey(record))
    const migrationAllowed =
      installed?.kind === "plugin" &&
      record.kind === "plugin" &&
      allowedSourceMigrations.has(
        sourceMigrationKey({
          fromSourceKey: installed.sourceKey,
          id: record.id,
          kind: "plugin",
          toSourceKey: record.sourceKey,
        }),
      )
    if (installed && installed.sourceKey !== record.sourceKey && !migrationAllowed) {
      throw new Error("Installed capability cannot change Marketplace source")
    }
  }
}

function stableState(value: MarketplaceState) {
  return `${JSON.stringify(value)}\n`
}

export class FileMarketplaceStateStore {
  readonly #file: string
  readonly #sourceMigrations: ReadonlySet<string>
  #tail = Promise.resolve()

  constructor(
    file: string,
    options: {
      readonly sourceMigrations?: readonly MarketplaceInstalledSourceMigration[]
    } = {},
  ) {
    this.#file = file
    const sourceMigrations = (options.sourceMigrations ?? []).map((migration) => {
      if (
        migration.kind !== "plugin" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(migration.id) ||
        !/^[a-f0-9]{64}$/.test(migration.fromSourceKey) ||
        !/^[a-f0-9]{64}$/.test(migration.toSourceKey) ||
        migration.fromSourceKey === migration.toSourceKey
      ) {
        throw new Error("Marketplace installed source migration is invalid")
      }
      return sourceMigrationKey(migration)
    })
    if (new Set(sourceMigrations).size !== sourceMigrations.length) {
      throw new Error("Marketplace installed source migrations must be unique")
    }
    this.#sourceMigrations = new Set(sourceMigrations)
  }

  async read(): Promise<MarketplaceState> {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await readBoundedAuthorityFile(this.#file, maxStateBytes, "Marketplace state"),
      )
      return validateState(JSON.parse(text))
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyState()
      if (error instanceof SyntaxError) throw new Error("Marketplace state is invalid", { cause: error })
      throw error
    }
  }

  compareAndSwap(
    expectedRevision: number,
    mutate: (draft: MarketplaceState) => void | Promise<void>,
  ): Promise<MarketplaceState> {
    const run = this.#tail.then(async () => {
      const previous = await this.read()
      if (previous.revision !== expectedRevision) {
        throw new MarketplaceStateConflictError(
          `Marketplace state revision conflict: expected ${expectedRevision}, current ${previous.revision}`,
        )
      }
      const next = structuredClone(previous)
      await mutate(next)
      next.revision = previous.revision + 1
      const validated = validateState(next)
      assertSourceLocks(previous, validated, this.#sourceMigrations)
      await this.#write(validated)
      return structuredClone(validated)
    })
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async update(
    mutate: (draft: MarketplaceState) => void | Promise<void>,
    maximumAttempts = 16,
  ): Promise<MarketplaceState> {
    if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 64) {
      throw new Error("Marketplace state retry bound is invalid")
    }
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const current = await this.read()
      try {
        return await this.compareAndSwap(current.revision, mutate)
      } catch (error) {
        if (!(error instanceof MarketplaceStateConflictError) || attempt + 1 === maximumAttempts) throw error
      }
    }
    throw new MarketplaceStateConflictError("Marketplace state retry bound was exhausted")
  }

  async #write(state: MarketplaceState) {
    const directory = dirname(this.#file)
    await fs.mkdir(directory, { mode: 0o700, recursive: true })
    const serialized = stableState(state)
    if (Buffer.byteLength(serialized, "utf8") > maxStateBytes) throw new Error("Marketplace state is invalid")
    const temporary = join(directory, `.${basename(this.#file)}.${randomUUID()}.tmp`)
    let published = false
    try {
      const handle = await fs.open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(serialized, "utf8")
        await syncFileBytes(handle)
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, this.#file)
      published = true
      await syncDirectoryEntry(directory)
    } finally {
      if (!published) await fs.rm(temporary, { force: true })
    }
  }
}

export function projectInstalledCapability(input: {
  executionGrant?: ExecutionGrant
  grantValid?: boolean
  installRecord: InstallRecord
  runtimePreference?: RuntimePreference
}): InstalledCapability {
  const { installRecord } = input
  const base = {
    id: installRecord.id,
    kind: installRecord.kind,
    runtimeSurface: installRecord.runtimeSurface,
    sourceKey: installRecord.sourceKey,
    version: installRecord.version,
  }
  if (installRecord.runtimeSurface === "none") return { ...base, state: "ready" }
  const grantMatches =
    input.executionGrant?.sourceKey === installRecord.sourceKey &&
    identityKey(input.executionGrant.identity) === identityKey(installRecord)
  if (input.runtimePreference?.desired === "disabled") {
    return {
      ...base,
      ...(!grantMatches || input.grantValid === false
        ? {
            attention:
              installRecord.kind === "plugin"
                ? ("integrity-or-authorization" as const)
                : ("setup-required-before-enable" as const),
          }
        : {}),
      state: "disabled",
    }
  }
  if (!grantMatches) {
    return installRecord.kind === "plugin"
      ? { ...base, attention: "integrity-or-authorization", state: "attention" }
      : { ...base, state: "setup-required" }
  }
  if (input.grantValid === false) return { ...base, attention: "integrity-or-authorization", state: "attention" }
  return { ...base, state: "ready" }
}

export interface CapabilityMutationRequest {
  affectedSkillNames?: readonly string[]
  identity: InstalledIdentity
  localSource?: string
  mutation: "disable" | "enable" | "install" | "setup" | "uninstall" | "update"
}

interface MutationLock {
  release: () => void
  wait: Promise<void>
}

export class CapabilityMutationCoordinator {
  readonly #tails = new Map<string, Promise<void>>()

  async withMutation<T>(request: CapabilityMutationRequest, action: () => Promise<T>): Promise<T> {
    const keys = [
      `identity:${identityKey(request.identity)}`,
      ...(request.affectedSkillNames ?? []).map((name) => `skill:${name}`),
      ...(request.localSource === undefined ? [] : [`local:${request.localSource}`]),
    ].sort()
    const locks: MutationLock[] = []
    for (const key of new Set(keys)) locks.push(this.#acquire(key))
    try {
      await Promise.all(locks.map((lock) => lock.wait))
      return await action()
    } finally {
      for (const lock of locks.reverse()) lock.release()
    }
  }

  #acquire(key: string): MutationLock {
    const previous = this.#tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.#tails.set(key, tail)
    return {
      wait: previous,
      release: () => {
        release()
        if (this.#tails.get(key) === tail) this.#tails.delete(key)
      },
    }
  }
}
