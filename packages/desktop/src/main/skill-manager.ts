import type { AgentSkill } from "@convax/agent-runtime"
import { createHash } from "node:crypto"
import {
  inspectAgentSkillDirectory,
  type ManagedAgentSkill,
  type ManagedAgentSkillStore,
} from "@convax/agent-runtime/node"
import { constants as fsConstants } from "node:fs"
import { open } from "node:fs/promises"
import { dirname } from "node:path"
import type {
  DesktopSkillCatalogItem,
  DesktopSkillDetails,
  DesktopSkillInventory,
  DesktopSkillShowcase,
  DesktopSkillShowcaseMedia,
  DesktopSkillSource,
  DesktopSkillSummary,
} from "../skill-management-contracts"
import type { DesktopBuiltinSkillBundle, DesktopBuiltinSkillPresentation } from "./builtin-skill-catalog"
import { createSkillFilePreviews } from "./skill-details"
import type { DesktopSkillMutationCoordinator } from "./skill-mutation-coordinator"

export interface PluginOwnedSkillBinding {
  pluginId: string
  pluginName: string
  pluginVersion: string
  skillName: string
  sourcePath: string
  sourceSha256: string
}

export interface PluginOwnedSkillReservationSource {
  assertSettled(): Promise<void>
  reservations(): Promise<readonly PluginOwnedSkillBinding[]>
}

export interface DesktopSkillRuntime {
  listSkills(input: { directory: string }): Promise<AgentSkill[]>
  refreshSkills(): Promise<void>
}

export class DesktopSkillManager {
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly store: ManagedAgentSkillStore,
    private readonly runtime: DesktopSkillRuntime,
    private readonly defaultDirectory: string,
    private readonly catalog: readonly DesktopBuiltinSkillBundle[],
    private readonly presentations: readonly DesktopBuiltinSkillPresentation[],
    private readonly ownership: PluginOwnedSkillReservationSource,
    private readonly mutations: Pick<DesktopSkillMutationCoordinator, "run">,
  ) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasCatalogSkill(id: string) {
    return this.catalog.some((item) => item.id === id)
  }

  async getCatalogSkillDetails(id: string): Promise<DesktopSkillDetails> {
    const bundle = this.catalog.find((item) => item.id === id)
    if (!bundle) throw new Error(`Skill catalog item was not found: ${id}`)
    const files = Object.entries(bundle.files).map(([path, content]) => ({
      content: typeof content === "string" ? new TextEncoder().encode(content) : Uint8Array.from(content),
      path,
    }))
    return {
      description: bundle.description,
      files: createSkillFilePreviews(files),
      id: bundle.id,
      name: bundle.name,
      version: bundle.version,
    }
  }

  async getInstalledSkillDetails(name: string, source: DesktopSkillSource): Promise<DesktopSkillDetails> {
    const inspection = source === "managed" ? await this.store.inspect(name) : await this.inspectGlobalSkill(name)
    return {
      description: inspection.description,
      files: createSkillFilePreviews(inspection.files),
      id: inspection.name,
      name: this.displayName(inspection.name) ?? inspection.name,
    }
  }

  async getBuiltinSkillShowcase(id: string, media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null> {
    const asset = this.presentations.find((item) => item.id === id)?.showcase[media]
    if (!asset) return null
    const maximum = media === "poster" ? 8 * 1024 * 1024 : 24 * 1024 * 1024
    const handle = await open(asset.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size < 1 || stat.size > maximum) {
        throw new Error(`Built-in Skill ${media} is not a bounded regular file: ${id}`)
      }
      const bytes = await handle.readFile()
      if (bytes.byteLength !== stat.size || !hasExpectedShowcaseSignature(bytes, asset.mimeType)) {
        throw new Error(`Built-in Skill ${media} has invalid bytes: ${id}`)
      }
      return {
        altText: asset.altText,
        bytes: Uint8Array.from(bytes),
        mimeType: asset.mimeType,
        size: bytes.byteLength,
      }
    } finally {
      await handle.close()
    }
  }

  async list(directory = this.defaultDirectory): Promise<DesktopSkillInventory> {
    const [managed, discovered, bindings] = await Promise.all([
      this.store.list(),
      this.runtime.listSkills({ directory }),
      this.ownership.reservations(),
    ])
    const bindingsByName = new Map(bindings.map((binding) => [binding.skillName, binding]))
    const managedByName = new Map(managed.map((skill) => [skill.name, skill]))
    const skillsByName = new Map<string, DesktopSkillSummary>()
    for (const skill of discovered) {
      const local = managedByName.get(skill.name)
      skillsByName.set(
        skill.name,
        local
          ? this.summary(local, bindingsByName.get(skill.name))
          : {
              description: skill.description,
              location: skill.location ?? "",
              management: { kind: "standalone" },
              managed: false,
              name: skill.name,
              source: "global",
            },
      )
    }
    for (const skill of managed) {
      const summary = this.summary(skill, bindingsByName.get(skill.name))
      if (!skillsByName.has(skill.name)) skillsByName.set(skill.name, summary)
      else if (bindingsByName.has(skill.name)) skillsByName.set(skill.name, summary)
    }
    const installedNames = new Set(managed.map((skill) => skill.name))
    return {
      catalog: this.catalog.map(
        (item): DesktopSkillCatalogItem => ({
          description: item.description,
          id: item.id,
          installed: installedNames.has(item.id),
          name: item.name,
        }),
      ),
      skills: [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    }
  }

  async listManaged() {
    const [skills, bindings] = await Promise.all([this.store.list(), this.ownership.reservations()])
    const bindingsByName = new Map(bindings.map((binding) => [binding.skillName, binding]))
    return skills.map((skill) => this.summary(skill, bindingsByName.get(skill.name)))
  }

  async exactManagedTreeDigest(name: string) {
    const inspection = await this.store.inspect(name)
    return exactSkillTreeDigest(inspection.files)
  }

  /**
   * Installs a default Skill before the Agent runtime is exposed to callers.
   * Cold-start provisioning must not launch OpenCode merely to refresh a
   * registry that has not been observed yet.
   */
  async installManagedAtStartup(sourceDirectory: string) {
    return this.mutate(async () => {
      const installed = await this.store.importFromDirectory(sourceDirectory)
      await this.assertStandaloneInstallAllowed(installed)
      this.emit()
      return this.summary(installed)
    })
  }

  async importFromDirectory(sourceDirectory: string, directory = this.defaultDirectory) {
    return this.mutate(async () => {
      const installed = await this.store.importFromDirectory(sourceDirectory)
      return this.finishInstall(installed, directory)
    })
  }

  async installFromFiles(
    files: Readonly<Record<string, string | Uint8Array>>,
    directory = this.defaultDirectory,
    expectedName?: string,
  ) {
    return this.mutate(async () => {
      const installed = await this.store.installFromFiles(
        files,
        expectedName === undefined ? undefined : { expectedName },
      )
      return this.finishInstall(installed, directory)
    })
  }

  async installCatalogSkill(id: string, directory = this.defaultDirectory) {
    const bundle = this.catalog.find((candidate) => candidate.id === id)
    if (!bundle) throw new Error(`Skill catalog item was not found: ${id}`)
    return this.mutate(async () => {
      const installed = await this.store.installFromFiles(bundle.files)
      return this.finishInstall(installed, directory)
    })
  }

  async resolveSkillLocation(name: string, directory = this.defaultDirectory) {
    const requestedName = name.trim()
    if (!requestedName) throw new Error("Skill name is required")
    const skill = (await this.list(directory)).skills.find((candidate) => candidate.name === requestedName)
    if (!skill) throw new Error(`Skill was not found: ${requestedName}`)
    const location = skill.location.trim()
    if (!location) throw new Error(`Skill location is unavailable: ${requestedName}`)
    return location
  }

  async uninstall(name: string) {
    return this.mutate(async () => {
      const binding = (await this.ownership.reservations()).find((candidate) => candidate.skillName === name)
      if (binding) {
        throw new Error(`Skill is managed by Plugin ${binding.pluginName} and cannot be uninstalled independently`)
      }
      const removed = await this.store.uninstall(name)
      if (!removed) return false
      try {
        await this.runtime.refreshSkills()
      } finally {
        this.emit()
      }
      return true
    })
  }

  async refresh() {
    return this.mutate(async () => {
      try {
        await this.runtime.refreshSkills()
      } finally {
        this.emit()
      }
    })
  }

  /**
   * Publishes an inventory change already committed by another lifecycle.
   * The caller owns runtime invalidation; this method never starts OpenCode.
   */
  notifyInventoryChanged() {
    this.emit()
  }

  private async finishInstall(installed: ManagedAgentSkill, directory: string) {
    try {
      await this.assertStandaloneInstallAllowed(installed)
      const conflicts = (await this.runtime.listSkills({ directory })).filter(
        (skill) => skill.name === installed.name && (!skill.location || !this.store.isManagedLocation(skill.location)),
      )
      if (conflicts.length > 0) {
        await this.store.uninstall(installed.name)
        throw new Error(`A global Skill already uses this name: ${installed.name}`)
      }
      await this.runtime.refreshSkills()
    } catch (error) {
      this.emit()
      throw error
    }
    this.emit()
    return this.summary(installed)
  }

  private async assertStandaloneInstallAllowed(installed: ManagedAgentSkill) {
    try {
      const binding = (await this.ownership.reservations()).find((candidate) => candidate.skillName === installed.name)
      if (binding) {
        throw new Error(`Skill is managed by Plugin ${binding.pluginName} and cannot be installed independently`)
      }
    } catch (error) {
      try {
        if (!(await this.store.uninstall(installed.name))) {
          throw new Error(`Could not roll back standalone Skill installation: ${installed.name}`, { cause: error })
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Standalone Skill ownership rollback failed: ${installed.name}`,
          {
            cause: error,
          },
        )
      }
      throw error
    }
  }

  private mutate<Result>(operation: () => Promise<Result>) {
    return this.mutations.run(async () => {
      await this.ownership.assertSettled()
      return operation()
    })
  }

  private summary(skill: ManagedAgentSkill, binding?: PluginOwnedSkillBinding): DesktopSkillSummary {
    return {
      description: skill.description,
      displayName: this.displayName(skill.name),
      location: skill.skillFile,
      management: binding
        ? {
            kind: "plugin",
            pluginId: binding.pluginId,
            pluginName: binding.pluginName,
            pluginVersion: binding.pluginVersion,
          }
        : { kind: "standalone" },
      managed: true,
      name: skill.name,
      source: "managed",
    }
  }

  private displayName(name: string) {
    return this.presentations.find((item) => item.id === name)?.displayName
  }

  private async inspectGlobalSkill(name: string) {
    const matches = (await this.runtime.listSkills({ directory: this.defaultDirectory })).filter(
      (skill) => skill.name === name,
    )
    if (matches.length !== 1 || !matches[0]?.location) {
      throw new Error(`Global Skill could not be resolved uniquely: ${name}`)
    }
    const inspection = await inspectAgentSkillDirectory(dirname(matches[0].location))
    if (inspection.name !== name) throw new Error(`Global Skill location does not match its name: ${name}`)
    return inspection
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }
}

export function exactSkillTreeDigest(files: readonly { content: Uint8Array; path: string }[]) {
  const digest = createHash("sha256")
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path, "en"))) {
    const pathBytes = Buffer.from(file.path, "utf8")
    digest.update(`${pathBytes.byteLength}:`)
    digest.update(pathBytes)
    digest.update(`:${file.content.byteLength}:`)
    digest.update(file.content)
  }
  return digest.digest("hex")
}

function hasExpectedShowcaseSignature(bytes: Uint8Array, mimeType: "image/png" | "video/mp4") {
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return signature.every((byte, index) => bytes[index] === byte)
  }
  return bytes.byteLength >= 12 && new TextDecoder("ascii").decode(bytes.subarray(4, 8)) === "ftyp"
}
