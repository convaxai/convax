import type { AgentSkill } from "@convax/agent-runtime"
import {
  digestAgentSkillFiles,
  inspectAgentSkillDirectory,
  type ManagedAgentSkillPublication,
  type ManagedAgentSkillPublicationRecovery,
  type ManagedAgentSkillStore,
} from "@convax/agent-runtime/node"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import {
  WebPluginPublicationDeferredError,
  type WebPluginPublicationCandidate,
  type WebPluginPublicationTransaction,
} from "./plugin-manager"

const ownershipSchema = "convax.plugin-owned-skills/1" as const
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const sha256Pattern = /^[a-f0-9]{64}$/
const transactionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface PluginOwnedSkillBinding {
  pluginId: string
  pluginName: string
  pluginVersion: string
  skillName: string
  sourcePath: string
  sourceSha256: string
}

interface PluginOwnedSkillPendingTransition {
  decision?: "commit"
  kind: "install" | "uninstall"
  nextBindings: PluginOwnedSkillBinding[]
  pluginId: string
  pluginVersion: string
  previousBindings: PluginOwnedSkillBinding[]
  publications: ManagedAgentSkillPublicationRecovery[]
}

interface PluginOwnedSkillState {
  bindings: PluginOwnedSkillBinding[]
  pending?: PluginOwnedSkillPendingTransition
  schema: typeof ownershipSchema
}

type PluginSkillManagedStore = Pick<
  ManagedAgentSkillStore,
  | "cleanupAbandonedPublications"
  | "inspect"
  | "isManagedLocation"
  | "list"
  | "prepareInstallFromFiles"
  | "prepareUninstall"
  | "recoverPublication"
>

type ReconciliationCandidate = WebPluginPublicationCandidate & {
  adoptMatchingUnbound?: boolean
}

interface PreparedMutation {
  conflictNames: string[]
  nextBindings: PluginOwnedSkillBinding[]
  pending: PluginOwnedSkillPendingTransition
  previousBindings: PluginOwnedSkillBinding[]
  transactions: ManagedAgentSkillPublication[]
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  return value as Record<string, unknown>
}

function exactKeys(input: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(input, key)) && Object.keys(input).every((key) => allowed.has(key))
}

function validateBinding(value: unknown): PluginOwnedSkillBinding {
  const input = asRecord(value, "Plugin-owned Skill binding")
  const keys = ["pluginId", "pluginName", "pluginVersion", "skillName", "sourcePath", "sourceSha256"] as const
  if (!exactKeys(input, keys)) throw new Error("Plugin-owned Skill binding is invalid")
  for (const key of keys) {
    if (typeof input[key] !== "string" || !input[key] || input[key] !== String(input[key]).trim()) {
      throw new Error("Plugin-owned Skill binding is invalid")
    }
  }
  if (!skillNamePattern.test(input.skillName as string) || !sha256Pattern.test(input.sourceSha256 as string)) {
    throw new Error("Plugin-owned Skill binding is invalid")
  }
  return input as unknown as PluginOwnedSkillBinding
}

function validateBindings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 1_000) throw new Error(`${label} is invalid`)
  const bindings = value.map(validateBinding).sort((left, right) => compareText(left.skillName, right.skillName))
  if (new Set(bindings.map((binding) => binding.skillName)).size !== bindings.length) {
    throw new Error(`${label} repeats a Skill name`)
  }
  return bindings
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function validateRecovery(value: unknown): ManagedAgentSkillPublicationRecovery {
  const input = asRecord(value, "Managed Skill publication receipt")
  const required = ["name", "operation", "schema", "transactionId"] as const
  if (!exactKeys(input, required, ["nextSha256", "previousSha256"])) {
    throw new Error("Managed Skill publication receipt is invalid")
  }
  if (
    typeof input.name !== "string" ||
    !skillNamePattern.test(input.name) ||
    input.schema !== "convax.managed-skill-publication/1" ||
    typeof input.transactionId !== "string" ||
    !transactionIdPattern.test(input.transactionId) ||
    !["install", "remove", "replace"].includes(String(input.operation))
  ) {
    throw new Error("Managed Skill publication receipt is invalid")
  }
  for (const key of ["nextSha256", "previousSha256"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !sha256Pattern.test(input[key]))) {
      throw new Error("Managed Skill publication receipt is invalid")
    }
  }
  if (
    (input.operation === "install" && (input.previousSha256 !== undefined || input.nextSha256 === undefined)) ||
    (input.operation === "replace" && (input.previousSha256 === undefined || input.nextSha256 === undefined)) ||
    (input.operation === "remove" && (input.previousSha256 === undefined || input.nextSha256 !== undefined))
  ) {
    throw new Error("Managed Skill publication receipt is invalid")
  }
  return input as unknown as ManagedAgentSkillPublicationRecovery
}

function validatePending(value: unknown): PluginOwnedSkillPendingTransition {
  const input = asRecord(value, "Plugin-owned Skill transition")
  const required = ["kind", "nextBindings", "pluginId", "pluginVersion", "previousBindings", "publications"] as const
  if (!exactKeys(input, required, ["decision"])) throw new Error("Plugin-owned Skill transition is invalid")
  if (
    !["install", "uninstall"].includes(String(input.kind)) ||
    (input.decision !== undefined && input.decision !== "commit") ||
    typeof input.pluginId !== "string" ||
    !skillNamePattern.test(input.pluginId) ||
    typeof input.pluginVersion !== "string" ||
    !input.pluginVersion ||
    input.pluginVersion !== input.pluginVersion.trim() ||
    !Array.isArray(input.publications) ||
    input.publications.length > 1_000
  ) {
    throw new Error("Plugin-owned Skill transition is invalid")
  }
  const publications = input.publications.map(validateRecovery)
  if (
    new Set(publications.map((publication) => publication.transactionId)).size !== publications.length ||
    new Set(publications.map((publication) => publication.name)).size !== publications.length
  ) {
    throw new Error("Plugin-owned Skill transition repeats a publication")
  }
  return {
    ...(input.decision === "commit" ? { decision: "commit" as const } : {}),
    kind: input.kind as PluginOwnedSkillPendingTransition["kind"],
    nextBindings: validateBindings(input.nextBindings, "Plugin-owned Skill next bindings"),
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    previousBindings: validateBindings(input.previousBindings, "Plugin-owned Skill previous bindings"),
    publications,
  }
}

function assertInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Plugin-owned Skill path escapes the candidate package")
  }
}

function pendingIdentity(value: PluginOwnedSkillPendingTransition) {
  return JSON.stringify({
    kind: value.kind,
    pluginId: value.pluginId,
    pluginVersion: value.pluginVersion,
    publications: value.publications.map((publication) => publication.transactionId),
  })
}

function mergedActivationBindings(
  previous: readonly PluginOwnedSkillBinding[],
  next: readonly PluginOwnedSkillBinding[],
) {
  const bindings = new Map(previous.map((binding) => [binding.skillName, binding]))
  for (const binding of next) bindings.set(binding.skillName, binding)
  return [...bindings.values()].sort((left, right) => compareText(left.skillName, right.skillName))
}

/** Serializes every Desktop-owned mutation of the shared managed Skill directory. */
export class DesktopSkillMutationCoordinator {
  private tail: Promise<void> = Promise.resolve()

  async acquire() {
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.tail
    this.tail = previous.then(() => next)
    await previous
    return release
  }

  async run<Result>(operation: () => Promise<Result>) {
    const release = await this.acquire()
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

/** Desktop-owned provenance and crash journal; OpenCode remains unaware of Plugins. */
export class PluginSkillOwnershipStore {
  constructor(readonly file: string) {}

  async read(): Promise<PluginOwnedSkillState> {
    let value: unknown
    try {
      value = JSON.parse(await fs.readFile(this.file, "utf8"))
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { bindings: [], schema: ownershipSchema }
      if (error instanceof SyntaxError) throw new Error("Plugin-owned Skill state is invalid JSON", { cause: error })
      throw error
    }
    const input = asRecord(value, "Plugin-owned Skill state")
    if (input.schema !== ownershipSchema || !exactKeys(input, ["bindings", "schema"], ["pending"])) {
      throw new Error("Plugin-owned Skill state is invalid")
    }
    return {
      bindings: validateBindings(input.bindings, "Plugin-owned Skill bindings"),
      ...(input.pending === undefined ? {} : { pending: validatePending(input.pending) }),
      schema: ownershipSchema,
    }
  }

  async list() {
    return (await this.read()).bindings
  }

  async reservations() {
    const state = await this.read()
    const bindings = new Map(state.bindings.map((binding) => [binding.skillName, binding]))
    for (const binding of state.pending?.previousBindings ?? []) bindings.set(binding.skillName, binding)
    for (const binding of state.pending?.nextBindings ?? []) bindings.set(binding.skillName, binding)
    return [...bindings.values()].sort((left, right) => compareText(left.skillName, right.skillName))
  }

  async assertSettled() {
    if ((await this.read()).pending) throw new Error("Plugin-owned Skill recovery must finish before changing Skills")
  }

  async write(bindings: readonly PluginOwnedSkillBinding[]) {
    await this.writeState({
      bindings: validateBindings(bindings, "Plugin-owned Skill bindings"),
      schema: ownershipSchema,
    })
  }

  async begin(pending: PluginOwnedSkillPendingTransition) {
    const state = await this.read()
    if (state.pending) throw new Error("A Plugin-owned Skill transition still requires recovery")
    if (JSON.stringify(state.bindings) !== JSON.stringify(pending.previousBindings)) {
      throw new Error("Plugin-owned Skill bindings changed before publication")
    }
    await this.writeState({ bindings: state.bindings, pending, schema: ownershipSchema })
  }

  async advance(
    expected: PluginOwnedSkillPendingTransition,
    bindings: readonly PluginOwnedSkillBinding[],
    decision?: "commit",
  ) {
    const state = await this.read()
    if (!state.pending || pendingIdentity(state.pending) !== pendingIdentity(expected)) {
      throw new Error("Plugin-owned Skill transition changed during publication")
    }
    const pending = { ...state.pending, ...(decision ? { decision } : {}) }
    await this.writeState({
      bindings: validateBindings(bindings, "Plugin-owned Skill bindings"),
      pending,
      schema: ownershipSchema,
    })
    return pending
  }

  async finish(expected: PluginOwnedSkillPendingTransition, bindings: readonly PluginOwnedSkillBinding[]) {
    const state = await this.read()
    if (!state.pending || pendingIdentity(state.pending) !== pendingIdentity(expected)) {
      throw new Error("Plugin-owned Skill transition changed during publication")
    }
    await this.writeState({
      bindings: validateBindings(bindings, "Plugin-owned Skill bindings"),
      schema: ownershipSchema,
    })
  }

  private async writeState(state: PluginOwnedSkillState) {
    const normalized: PluginOwnedSkillState = {
      bindings: validateBindings(state.bindings, "Plugin-owned Skill bindings"),
      ...(state.pending ? { pending: validatePending(state.pending) } : {}),
      schema: ownershipSchema,
    }
    await fs.mkdir(path.dirname(this.file), { mode: 0o700, recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { flag: "wx", mode: 0o600 })
      await fs.rename(temporary, this.file)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    // rename is the atomic commit boundary. A best-effort cleanup failure after
    // it must not tell the caller that the durable journal or decision was lost.
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

export class PluginSkillLifecycle {
  constructor(
    private readonly skills: PluginSkillManagedStore,
    readonly ownership: PluginSkillOwnershipStore,
    private readonly discoverSkills: () => Promise<readonly AgentSkill[]>,
    private readonly mutations: DesktopSkillMutationCoordinator,
  ) {}

  async prepareInstall(
    plugin: InstalledWebPluginSummary,
    candidate: ReconciliationCandidate,
  ): Promise<WebPluginPublicationTransaction> {
    const release = await this.acquire()
    const transactions: ManagedAgentSkillPublication[] = []
    try {
      const state = await this.ownership.read()
      if (state.pending) throw new Error("A Plugin-owned Skill transition still requires recovery")
      const previousBindings = state.bindings
      const previousByName = new Map(previousBindings.map((binding) => [binding.skillName, binding]))
      const existingSkills = new Map((await this.skills.list()).map((skill) => [skill.name, skill]))
      const declarations = plugin.contributes.skills ?? []
      const declaredNames = new Set(declarations.map((declaration) => declaration.name))
      const conflictNames = declarations.map((declaration) => declaration.name)
      const plans: Array<{
        binding: PluginOwnedSkillBinding
        files: Record<string, Uint8Array>
        replaceExisting: boolean
      }> = []

      for (const declaration of declarations) {
        const prior = previousByName.get(declaration.name)
        if (prior && prior.pluginId !== plugin.id) {
          throw new Error(`Skill is already owned by another Plugin: ${declaration.name}`)
        }
        const inspection = await this.inspectCandidateSkill(candidate.root, declaration.path, declaration.name)
        let adoptExisting = false
        if (!prior) {
          if (existingSkills.has(declaration.name)) {
            adoptExisting = await this.canAdoptUnboundSkill(plugin, candidate, declaration.name, inspection.files)
            if (!adoptExisting) {
              throw new Error(`A standalone managed Skill already uses this name: ${declaration.name}`)
            }
          }
        }
        plans.push({
          binding: {
            pluginId: plugin.id,
            pluginName: plugin.name,
            pluginVersion: plugin.version,
            skillName: declaration.name,
            sourcePath: declaration.path,
            sourceSha256: digestAgentSkillFiles(inspection.files),
          },
          files: Object.fromEntries(inspection.files.map((file) => [file.path, file.content])),
          replaceExisting: Boolean(prior || adoptExisting),
        })
      }

      if (conflictNames.length) await this.assertNoExternalConflicts(conflictNames)
      const ownedBefore = previousBindings.filter((binding) => binding.pluginId === plugin.id)
      if (!plans.length && !ownedBefore.length) {
        release()
        return noOpTransaction()
      }
      for (const plan of plans) {
        transactions.push(
          await this.skills.prepareInstallFromFiles(plan.files, {
            expectedName: plan.binding.skillName,
            replaceExisting: plan.replaceExisting,
          }),
        )
      }
      for (const binding of ownedBefore) {
        if (declaredNames.has(binding.skillName)) continue
        const removal = await this.skills.prepareUninstall(binding.skillName)
        if (removal) transactions.push(removal)
      }
      transactions.sort(
        (left, right) => Number(left.recovery.operation === "remove") - Number(right.recovery.operation === "remove"),
      )

      const nextBindings = [
        ...previousBindings.filter((binding) => binding.pluginId !== plugin.id),
        ...plans.map((plan) => plan.binding),
      ].sort((left, right) => compareText(left.skillName, right.skillName))
      const pending: PluginOwnedSkillPendingTransition = {
        kind: "install",
        nextBindings,
        pluginId: plugin.id,
        pluginVersion: plugin.version,
        previousBindings,
        publications: transactions.map((transaction) => transaction.recovery),
      }
      return this.transaction({ conflictNames, nextBindings, pending, previousBindings, transactions }, release)
    } catch (error) {
      for (const transaction of transactions.reverse()) await transaction.rollback().catch(() => undefined)
      release()
      throw error
    }
  }

  async prepareUninstall(plugin: Pick<InstalledWebPluginSummary, "id" | "version">) {
    const release = await this.acquire()
    const transactions: ManagedAgentSkillPublication[] = []
    try {
      const state = await this.ownership.read()
      if (state.pending) throw new Error("A Plugin-owned Skill transition still requires recovery")
      const previousBindings = state.bindings
      const owned = previousBindings.filter((binding) => binding.pluginId === plugin.id)
      if (!owned.length) {
        release()
        return noOpTransaction()
      }
      for (const binding of owned) {
        const removal = await this.skills.prepareUninstall(binding.skillName)
        if (removal) transactions.push(removal)
      }
      const nextBindings = previousBindings.filter((binding) => binding.pluginId !== plugin.id)
      const pending: PluginOwnedSkillPendingTransition = {
        kind: "uninstall",
        nextBindings,
        pluginId: plugin.id,
        pluginVersion: plugin.version,
        previousBindings,
        publications: transactions.map((transaction) => transaction.recovery),
      }
      return this.transaction({ conflictNames: [], nextBindings, pending, previousBindings, transactions }, release)
    } catch (error) {
      for (const transaction of transactions.reverse()) await transaction.rollback().catch(() => undefined)
      release()
      throw error
    }
  }

  async reconcileAll(
    installed: readonly InstalledWebPluginSummary[],
    resolveAsset: (pluginId: string, relativePath: string) => Promise<string>,
  ) {
    await this.recoverPending(installed)
    const installedIds = new Set(installed.map((plugin) => plugin.id))
    const orphanOwners = new Map(
      (await this.ownership.list())
        .filter((binding) => !installedIds.has(binding.pluginId))
        .map((binding) => [binding.pluginId, binding.pluginVersion]),
    )
    for (const [id, version] of orphanOwners) {
      await this.run(this.prepareUninstall({ id, version }))
    }
    for (const plugin of installed) {
      await this.reconcileInstalled(plugin, resolveAsset)
    }
    await this.skills.cleanupAbandonedPublications()
  }

  async reconcileInstalled(
    plugin: InstalledWebPluginSummary,
    resolveAsset: (pluginId: string, relativePath: string) => Promise<string>,
  ) {
    const first = plugin.contributes.skills?.[0]
    let root = path.dirname(this.ownership.file)
    if (first) {
      root = path.dirname(await resolveAsset(plugin.id, `${first.path}/SKILL.md`))
      for (const _segment of first.path.split("/")) root = path.dirname(root)
    }
    await this.run(this.prepareInstall(plugin, { adoptMatchingUnbound: true, root }))
  }

  private async recoverPending(installed: readonly InstalledWebPluginSummary[]) {
    const state = await this.ownership.read()
    const pending = state.pending
    if (!pending) {
      await this.skills.cleanupAbandonedPublications()
      return
    }
    const current = installed.find((plugin) => plugin.id === pending.pluginId)
    const packageSelectedCommit =
      pending.kind === "install" ? current?.version === pending.pluginVersion : current === undefined
    if (pending.decision === "commit" || packageSelectedCommit) {
      for (const publication of pending.publications) await this.skills.recoverPublication(publication, "commit")
      await this.ownership.finish(pending, pending.nextBindings)
    } else {
      for (const publication of [...pending.publications].reverse()) {
        await this.skills.recoverPublication(publication, "rollback")
      }
      await this.ownership.finish(pending, pending.previousBindings)
    }
    await this.skills.cleanupAbandonedPublications()
  }

  private async inspectCandidateSkill(rootPath: string, relativePath: string, expectedName: string) {
    const root = await fs.realpath(rootPath)
    const directory = path.resolve(root, ...relativePath.split("/"))
    assertInside(directory, root)
    const realDirectory = await fs.realpath(directory)
    assertInside(realDirectory, root)
    const inspection = await inspectAgentSkillDirectory(realDirectory)
    if (inspection.name !== expectedName) {
      throw new Error(`Plugin-owned Skill name does not match SKILL.md: ${expectedName}`)
    }
    return inspection
  }

  private async canAdoptUnboundSkill(
    plugin: InstalledWebPluginSummary,
    candidate: ReconciliationCandidate,
    name: string,
    nextFiles: readonly { content: Uint8Array; path: string }[],
  ) {
    const current = await this.skills.inspect(name)
    const currentDigest = digestAgentSkillFiles(current.files)
    if (candidate.adoptMatchingUnbound && currentDigest === digestAgentSkillFiles(nextFiles)) return true
    const previous = candidate.previous
    if (!previous || previous.plugin.id !== plugin.id || !previous.plugin.skill) return false
    const declaredRoot = path.resolve(previous.root)
    const legacySkillFile = path.resolve(declaredRoot, ...previous.plugin.skill.split("/"))
    assertInside(legacySkillFile, declaredRoot)
    const previousRoot = await fs.realpath(previous.root)
    const realSkillFile = await fs.realpath(legacySkillFile)
    assertInside(realSkillFile, previousRoot)
    const legacy = await inspectAgentSkillDirectory(path.dirname(realSkillFile))
    return legacy.name === name && digestAgentSkillFiles(legacy.files) === currentDigest
  }

  private async assertNoExternalConflicts(names: readonly string[]) {
    const requested = new Set(names)
    const conflicts = (await this.discoverSkills()).filter(
      (skill) => requested.has(skill.name) && (!skill.location || !this.skills.isManagedLocation(skill.location)),
    )
    if (conflicts.length) throw new Error(`A global Skill already uses this name: ${conflicts[0]!.name}`)
  }

  private transaction(mutation: PreparedMutation, release: () => void): WebPluginPublicationTransaction {
    let pending = mutation.pending
    let journaled = false
    let activated = false
    let decisionCommitted = false
    let finished = false
    return {
      publish: async () => {
        if (journaled || finished) throw new Error("Plugin-owned Skill transaction is no longer publishable")
        if (mutation.conflictNames.length) await this.assertNoExternalConflicts(mutation.conflictNames)
        await this.ownership.begin(pending)
        journaled = true
      },
      activate: async () => {
        if (!journaled || finished || decisionCommitted) {
          throw new Error("Plugin-owned Skill transaction is not activatable")
        }
        pending = await this.ownership.advance(
          pending,
          mergedActivationBindings(mutation.previousBindings, mutation.nextBindings),
        )
        for (const transaction of mutation.transactions) await transaction.publish()
        activated = true
      },
      commit: async () => {
        if (finished) return
        if (!activated) throw new Error("Plugin-owned Skill transaction was not activated")
        pending = await this.ownership.advance(pending, mutation.nextBindings, "commit")
        decisionCommitted = true
        let cleanupComplete = true
        for (const transaction of mutation.transactions) {
          try {
            await transaction.commit()
          } catch {
            cleanupComplete = false
          }
        }
        if (cleanupComplete) {
          try {
            await this.ownership.finish(pending, mutation.nextBindings)
          } catch {
            // The durable commit decision remains recoverable on next startup.
          }
        }
        finished = true
        release()
      },
      rollback: async () => {
        if (finished) return
        if (decisionCommitted) {
          finished = true
          release()
          return
        }
        const failures: unknown[] = []
        for (const transaction of [...mutation.transactions].reverse()) {
          try {
            await transaction.rollback()
          } catch (error) {
            failures.push(error)
          }
        }
        if (journaled) {
          try {
            if (failures.length) {
              // Preserve every exact recovery receipt when filesystem rollback
              // did not finish. Startup can safely retry the rollback selected
              // by the restored Plugin package; deleting the journal here would
              // strand an otherwise recoverable backup.
              pending = await this.ownership.advance(pending, mutation.previousBindings)
            } else {
              await this.ownership.finish(pending, mutation.previousBindings)
            }
          } catch (error) {
            failures.push(error)
          }
        }
        finished = true
        release()
        if (failures.length) {
          throw new AggregateError(failures, "Plugin-owned Skill rollback failed", { cause: failures[0] })
        }
      },
      deferToRecovery: async () => {
        if (finished) return
        finished = true
        release()
      },
    }
  }

  private async run(transactionPromise: Promise<WebPluginPublicationTransaction>) {
    const transaction = await transactionPromise
    try {
      await transaction.publish()
      await transaction.activate?.()
      await transaction.commit()
    } catch (error) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        throw new WebPluginPublicationDeferredError(
          [error, rollbackError],
          "Plugin-owned Skill reconciliation requires startup recovery",
          { cause: error },
        )
      }
      throw error
    }
  }

  private async acquire() {
    return this.mutations.acquire()
  }
}

function noOpTransaction(): WebPluginPublicationTransaction {
  return {
    async publish() {},
    async activate() {},
    async commit() {},
    async rollback() {},
    async deferToRecovery() {},
  }
}

export function composePluginPublicationTransactions(
  transactions: readonly WebPluginPublicationTransaction[],
): WebPluginPublicationTransaction {
  return {
    async publish() {
      for (const transaction of transactions) await transaction.publish()
    },
    async activate() {
      for (const transaction of transactions) await transaction.activate?.()
    },
    async commit() {
      for (const transaction of transactions) await transaction.commit()
    },
    async rollback() {
      const failures: unknown[] = []
      for (const transaction of [...transactions].reverse()) {
        try {
          await transaction.rollback()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "Plugin publication rollback failed", { cause: failures[0] })
    },
    async deferToRecovery() {
      const failures: unknown[] = []
      for (const transaction of [...transactions].reverse()) {
        try {
          await transaction.deferToRecovery?.()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length) {
        throw new AggregateError(failures, "Plugin publication deferral failed", { cause: failures[0] })
      }
    },
  }
}
