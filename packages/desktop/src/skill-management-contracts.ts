export type DesktopSkillSource = "global" | "managed"

export interface DesktopSkillSummary {
  description?: string
  location: string
  managed: boolean
  name: string
  source: DesktopSkillSource
}

export interface DesktopSkillCatalogItem {
  description: string
  id: string
  installed: boolean
  name: string
}

export interface DesktopSkillInventory {
  catalog: DesktopSkillCatalogItem[]
  skills: DesktopSkillSummary[]
}

export interface DesktopSkillClient {
  importSkill(): Promise<DesktopSkillSummary | null>
  installCatalogSkill(input: { id: string }): Promise<DesktopSkillSummary>
  installPluginSkill(input: { pluginId: string }): Promise<DesktopSkillSummary>
  listSkills(input?: { scopeId?: string }): Promise<DesktopSkillInventory>
  onDidChange(listener: () => void): () => void
  uninstallSkill(input: { name: string }): Promise<boolean>
}
