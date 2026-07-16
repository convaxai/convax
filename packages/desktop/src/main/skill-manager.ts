import type { AgentSkill } from "@convax/agent-runtime"
import type { ManagedAgentSkill, ManagedAgentSkillStore } from "@convax/agent-runtime/node"
import type {
  DesktopSkillCatalogItem,
  DesktopSkillInventory,
  DesktopSkillSummary,
} from "../skill-management-contracts"
import type { DesktopBuiltinSkillBundle } from "./builtin-skill-catalog"

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
  ) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(directory = this.defaultDirectory): Promise<DesktopSkillInventory> {
    const [managed, discovered] = await Promise.all([
      this.store.list(),
      this.runtime.listSkills({ directory }),
    ])
    const managedByName = new Map(managed.map((skill) => [skill.name, skill]))
    const skillsByName = new Map<string, DesktopSkillSummary>()
    for (const skill of discovered) {
      const local = managedByName.get(skill.name)
      skillsByName.set(skill.name, local ? this.summary(local) : {
        description: skill.description,
        location: skill.location ?? "",
        managed: false,
        name: skill.name,
        source: "global",
      })
    }
    for (const skill of managed) {
      if (!skillsByName.has(skill.name)) skillsByName.set(skill.name, this.summary(skill))
    }
    const installedNames = new Set(managed.map((skill) => skill.name))
    return {
      catalog: this.catalog.map((item): DesktopSkillCatalogItem => ({
        description: item.description,
        id: item.id,
        installed: installedNames.has(item.id),
        name: item.name,
      })),
      skills: [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    }
  }

  async importFromDirectory(sourceDirectory: string, directory = this.defaultDirectory) {
    const installed = await this.store.importFromDirectory(sourceDirectory)
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
      const conflicts = (await this.runtime.listSkills({ directory })).filter((skill) =>
        skill.name === installed.name
        && (!skill.location || !this.store.isManagedLocation(skill.location)))
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
      location: skill.skillFile,
      managed: true,
      name: skill.name,
      source: "managed",
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }
}
