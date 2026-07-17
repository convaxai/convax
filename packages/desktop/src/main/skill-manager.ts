import type { AgentSkill } from "@convax/agent-runtime"
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
    private readonly presentations: readonly DesktopBuiltinSkillPresentation[] = [],
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
    const [managed, discovered] = await Promise.all([this.store.list(), this.runtime.listSkills({ directory })])
    const managedByName = new Map(managed.map((skill) => [skill.name, skill]))
    const skillsByName = new Map<string, DesktopSkillSummary>()
    for (const skill of discovered) {
      const local = managedByName.get(skill.name)
      skillsByName.set(
        skill.name,
        local
          ? this.summary(local)
          : {
              description: skill.description,
              location: skill.location ?? "",
              managed: false,
              name: skill.name,
              source: "global",
            },
      )
    }
    for (const skill of managed) {
      if (!skillsByName.has(skill.name)) skillsByName.set(skill.name, this.summary(skill))
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
    return (await this.store.list()).map((skill) => this.summary(skill))
  }

  /**
   * Installs a default Skill before the Agent runtime is exposed to callers.
   * Cold-start provisioning must not launch OpenCode merely to refresh a
   * registry that has not been observed yet.
   */
  async installManagedAtStartup(sourceDirectory: string) {
    const installed = await this.store.importFromDirectory(sourceDirectory)
    this.emit()
    return this.summary(installed)
  }

  async importFromDirectory(sourceDirectory: string, directory = this.defaultDirectory) {
    const installed = await this.store.importFromDirectory(sourceDirectory)
    return this.finishInstall(installed, directory)
  }

  async installFromFiles(
    files: Readonly<Record<string, string | Uint8Array>>,
    directory = this.defaultDirectory,
    expectedName?: string,
  ) {
    const installed = await this.store.installFromFiles(
      files,
      expectedName === undefined ? undefined : { expectedName },
    )
    return this.finishInstall(installed, directory)
  }

  async installCatalogSkill(id: string, directory = this.defaultDirectory) {
    const bundle = this.catalog.find((candidate) => candidate.id === id)
    if (!bundle) throw new Error(`Skill catalog item was not found: ${id}`)
    const installed = await this.store.installFromFiles(bundle.files)
    return this.finishInstall(installed, directory)
  }

  async uninstall(name: string) {
    const removed = await this.store.uninstall(name)
    if (!removed) return false
    try {
      await this.runtime.refreshSkills()
    } finally {
      this.emit()
    }
    return true
  }

  private async finishInstall(installed: ManagedAgentSkill, directory: string) {
    try {
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

  private summary(skill: ManagedAgentSkill): DesktopSkillSummary {
    return {
      description: skill.description,
      displayName: this.displayName(skill.name),
      location: skill.skillFile,
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

function hasExpectedShowcaseSignature(bytes: Uint8Array, mimeType: "image/png" | "video/mp4") {
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return signature.every((byte, index) => bytes[index] === byte)
  }
  return bytes.byteLength >= 12 && new TextDecoder("ascii").decode(bytes.subarray(4, 8)) === "ftyp"
}
