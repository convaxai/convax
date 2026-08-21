export type DesktopSkillSource = "global" | "managed"

export type DesktopSkillManagement =
  | { kind: "standalone" }
  | {
      kind: "plugin"
      pluginId: string
      pluginName: string
      pluginVersion: string
    }

export interface DesktopSkillSummary {
  description?: string
  displayName?: string
  location: string
  management: DesktopSkillManagement
  managed: boolean
  name: string
  source: DesktopSkillSource
}

export type DesktopSkillTarget =
  | {
      id: string
      kind: "catalog"
    }
  | {
      kind: "installed"
      name: string
      source: DesktopSkillSource
    }

export interface DesktopSkillCatalogItem {
  description: string
  id: string
  installed: boolean
  name: string
  /** Plugin-owned catalog entries remain previewable but cannot be installed as standalone Skills. */
  ownerPluginId?: string
  ownerPluginName?: string
}

export interface DesktopSkillInventory {
  catalog: DesktopSkillCatalogItem[]
  skills: DesktopSkillSummary[]
}

export type DesktopSkillFilePreview =
  | {
      content: string
      kind: "text"
      path: string
      size: number
    }
  | {
      kind: "binary"
      path: string
      size: number
    }

export interface DesktopSkillDetails {
  description: string
  files: DesktopSkillFilePreview[]
  id: string
  name: string
  version?: string
}

export type DesktopSkillShowcaseMedia = "animation" | "poster"
export type DesktopSkillShowcaseMimeType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/webm"

export interface DesktopSkillShowcase {
  altText: string
  bytes: Uint8Array
  mimeType: DesktopSkillShowcaseMimeType
  size: number
}

export interface DesktopSkillClient {
  getSkillDetails(input: { target: DesktopSkillTarget }): Promise<DesktopSkillDetails>
  getSkillShowcase(input: {
    media: DesktopSkillShowcaseMedia
    target: DesktopSkillTarget
  }): Promise<DesktopSkillShowcase | null>
  importSkill(): Promise<DesktopSkillSummary | null>
  installCatalogSkill(input: { id: string }): Promise<DesktopSkillSummary>
  listSkills(input?: { scopeId?: string }): Promise<DesktopSkillInventory>
  onDidChange(listener: () => void): () => void
  openSkill(input: { name: string; scopeId?: string }): Promise<void>
  uninstallSkill(input: { name: string }): Promise<boolean>
}
