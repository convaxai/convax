import {
  comparePortablePluginVersions,
  parsePortablePluginId,
  parsePortablePluginManifestV8,
  parsePortablePluginRelativePath,
  portablePluginCapabilities,
  portablePluginGenerationInputRoles,
  portablePluginGenerationModalities,
  portablePluginManifestFileName,
  portablePluginManifestV8Schema,
  portablePluginPetCapabilities,
  portablePluginProjectCanvasCapabilities,
  portablePluginServiceActions,
  type PluginCapabilityDeclaration,
  type PortablePluginAgentContribution,
  type PortablePluginAgentRemoteMcpContribution,
  type PortablePluginAgentToolContribution,
  type PortablePluginCanvasContribution,
  type PortablePluginCanvasGenerationSelectionActionContribution,
  type PortablePluginCanvasMaterializeSelectionActionContribution,
  type PortablePluginCanvasRendererContribution,
  type PortablePluginCanvasSelectionActionContribution,
  type PortablePluginCanvasSelectionActionEditor,
  type PortablePluginCanvasSelectionActionStep,
  type PortablePluginCapability,
  type PortablePluginGenerationContribution,
  type PortablePluginGenerationDelivery,
  type PortablePluginGenerationInputBinding,
  type PortablePluginGenerationInputRole,
  type PortablePluginGenerationModality,
  type PortablePluginGenerationModelContribution,
  type PortablePluginGenerationRecoveryContribution,
  type PortablePluginGenerationToolContribution,
  type PortablePluginLlmContribution,
  type PortablePluginLlmModelContribution,
  type PortablePluginLocalizedText,
  type PortablePluginManifestV8,
  type PortablePluginMcpStdioRuntime,
  type PortablePluginPetContribution,
  type PortablePluginServiceAction,
  type PortablePluginServiceContribution,
  type PortablePluginSkillContribution,
  type PortablePluginUiCommand,
  type PortablePluginUiMenuItem,
  type PortablePluginUiToolbarItem,
} from "@convax/plugin-sdk"

export const webPluginManifestFileName = portablePluginManifestFileName
export const webPluginManifestSchemaV8 = portablePluginManifestV8Schema

export type WebPluginManifestSchema = typeof webPluginManifestSchemaV8
export const webPluginCapabilities = portablePluginCapabilities
export const webPluginProjectCanvasCapabilities = portablePluginProjectCanvasCapabilities
export const webPluginPetCapabilities = portablePluginPetCapabilities
export const webPluginGenerationModalities = portablePluginGenerationModalities
export const webPluginGenerationInputRoles = portablePluginGenerationInputRoles
export const webPluginServiceActions = portablePluginServiceActions

export type WebPluginCapability = PortablePluginCapability
export type WebPluginGenerationModality = PortablePluginGenerationModality
export type WebPluginGenerationInputRole = PortablePluginGenerationInputRole
export type WebPluginGenerationDelivery = PortablePluginGenerationDelivery
export type WebPluginGenerationInputBinding = PortablePluginGenerationInputBinding
export type WebPluginGenerationRecoveryContribution = PortablePluginGenerationRecoveryContribution
export type WebPluginGenerationModelContribution = PortablePluginGenerationModelContribution
export type WebPluginGenerationToolContribution = PortablePluginGenerationToolContribution
export type WebPluginGenerationContribution = PortablePluginGenerationContribution
export type WebPluginAgentToolContribution = PortablePluginAgentToolContribution
export type WebPluginAgentRemoteMcpContribution = PortablePluginAgentRemoteMcpContribution
export type WebPluginAgentContribution = PortablePluginAgentContribution
export type WebPluginSkillContribution = PortablePluginSkillContribution
export type WebPluginServiceAction = PortablePluginServiceAction
export type WebPluginServiceContribution = PortablePluginServiceContribution
export type WebPluginLlmModelContribution = PortablePluginLlmModelContribution
export type WebPluginLlmContribution = PortablePluginLlmContribution
export type WebPluginPetContribution = PortablePluginPetContribution
export type WebPluginMcpStdioRuntime = PortablePluginMcpStdioRuntime
export type WebPluginCanvasRendererContribution = PortablePluginCanvasRendererContribution
export type WebPluginLocalizedText = PortablePluginLocalizedText
export type WebPluginCanvasSelectionActionEditor = PortablePluginCanvasSelectionActionEditor
export type WebPluginCanvasSelectionActionStep = PortablePluginCanvasSelectionActionStep
export type WebPluginCanvasGenerationSelectionActionContribution =
  PortablePluginCanvasGenerationSelectionActionContribution
export type WebPluginCanvasMaterializeSelectionActionContribution =
  PortablePluginCanvasMaterializeSelectionActionContribution
export type WebPluginCanvasSelectionActionContribution = PortablePluginCanvasSelectionActionContribution
export type WebPluginCanvasContribution = PortablePluginCanvasContribution
export type WebPluginToolbarContribution = PortablePluginUiToolbarItem
export type WebPluginManifest = PortablePluginManifestV8

export type {
  PluginCapabilityDeclaration,
  PortablePluginUiCommand,
  PortablePluginUiMenuItem,
  PortablePluginUiToolbarItem,
}

export const compareWebPluginVersions = comparePortablePluginVersions
export const requireWebPluginId = parsePortablePluginId
export const requireWebPluginRelativePath = parsePortablePluginRelativePath
export { validatePortablePluginSegment } from "@convax/plugin-sdk"

/**
 * Desktop's runtime adapter. Portable syntax and cross-field semantics are
 * owned exclusively by @convax/plugin-sdk; Desktop adds no second parser.
 */
export function parseWebPluginManifest(value: unknown): WebPluginManifest {
  return parsePortablePluginManifestV8(value, { hostApiMode: "runtime" })
}

/** Contains only values admitted by the canonical v8 parser. */
export type InstalledWebPluginSummary = PortablePluginManifestV8

/**
 * Renderer-safe projection of one exact Plugin generation. These fields are
 * routing authority only: they contain no native closure or executable paths.
 */
export interface ActiveInstalledWebPluginSummary extends InstalledWebPluginSummary {
  readonly activeRevision: number
  readonly activeSetDigest: string
  readonly snapshotDigest: string
}

export type InstalledWebPluginCanvasSurface = InstalledWebPluginSummary & {
  readonly contributes: InstalledWebPluginSummary["contributes"] & {
    readonly canvas: NonNullable<InstalledWebPluginSummary["contributes"]["canvas"]> & {
      readonly renderer: PortablePluginCanvasRendererContribution
    }
  }
  readonly entry: string
}

export type ActiveInstalledWebPluginCanvasSurface = ActiveInstalledWebPluginSummary & InstalledWebPluginCanvasSurface

export function hasWebPluginCanvasSurface(
  plugin: ActiveInstalledWebPluginSummary,
): plugin is ActiveInstalledWebPluginCanvasSurface
export function hasWebPluginCanvasSurface(plugin: InstalledWebPluginSummary): plugin is InstalledWebPluginCanvasSurface
export function hasWebPluginCanvasSurface(
  plugin: InstalledWebPluginSummary,
): plugin is InstalledWebPluginCanvasSurface {
  return typeof plugin.entry === "string" && plugin.contributes.canvas?.renderer !== undefined
}

export interface WebPluginCatalogItem extends PortablePluginManifestV8 {
  readonly companionSkillName?: string
  readonly download?: {
    readonly companionBytes: number
    readonly packageBytes: number
    readonly totalBytes: number
  }
  readonly installed: boolean
  readonly installedVersion?: string
  readonly releaseAvailable?: true
  readonly updateAvailable?: boolean
}

export interface WebPluginInventory {
  readonly catalog: readonly WebPluginCatalogItem[]
  readonly installed: readonly ActiveInstalledWebPluginSummary[]
}

export type WebPluginAgentMcpConnectionStatus =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"
  | "unavailable"

export type WebPluginAgentMcpConnectionStatuses = Readonly<Record<string, WebPluginAgentMcpConnectionStatus>>

export interface WebPluginClient {
  connectAgentMcp(input: { id: string }): Promise<void>
  importPlugin(): Promise<InstalledWebPluginSummary | null>
  installCatalogPlugin(input: { id: string }): Promise<InstalledWebPluginSummary>
  listAgentMcpStatuses(): Promise<WebPluginAgentMcpConnectionStatuses>
  listPlugins(): Promise<WebPluginInventory>
  onDidChange(listener: () => void): () => void
  openCatalogPluginRelease(input: { id: string }): Promise<boolean>
  uninstallPlugin(input: { id: string }): Promise<boolean>
}

export function toInstalledWebPluginSummary(manifest: PortablePluginManifestV8): InstalledWebPluginSummary {
  return parseWebPluginManifest(manifest)
}
