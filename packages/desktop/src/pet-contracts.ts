import type { WebPluginCapability } from "./plugin-contracts"

export type PetVisibleActivityState = "needs-input" | "blocked" | "ready" | "running"

export interface PetActivitySummary {
  id: string
  input?: "permission" | "question"
  projectId: string
  projectName: string
  sessionId: string
  sessionName: string
  state: PetVisibleActivityState
  updatedAt: number
}

export interface PetActivitySnapshot {
  activities: PetActivitySummary[]
  revision: number
}

export const petHostProtocol = "convax.pet-host/1" as const
export const petHostMaximumMessageBytes = 64 * 1024
export const petHostMaximumPendingRequests = 64

export type PetHostSurface = "overlay" | "settings"

export interface PetHostProviderBinding {
  readonly capabilities: readonly WebPluginCapability[]
  readonly digest: string
  readonly generation: number
  readonly pluginId: string
}

export interface PetPreferences {
  awake: boolean
  selectedPetId?: string
}

export interface PetPreferencesUpdate {
  selectedPetId: string
}

export type PetHostMethod =
  | "activity.getSnapshot"
  | "activity.open"
  | "lifecycle.setAwake"
  | "overlay.move"
  | "overlay.setExpanded"
  | "preferences.get"
  | "preferences.update"

interface PetHostRequestBase {
  id: string
  protocol: typeof petHostProtocol
  type: "request"
}

export type PetHostRequest =
  | (PetHostRequestBase & { method: "activity.getSnapshot"; params: Record<string, never> })
  | (PetHostRequestBase & { method: "activity.open"; params: PetNavigationRequest })
  | (PetHostRequestBase & { method: "lifecycle.setAwake"; params: { awake: boolean } })
  | (PetHostRequestBase & { method: "overlay.move"; params: PetDragInput })
  | (PetHostRequestBase & { method: "overlay.setExpanded"; params: { expanded: boolean } })
  | (PetHostRequestBase & { method: "preferences.get"; params: Record<string, never> })
  | (PetHostRequestBase & { method: "preferences.update"; params: PetPreferencesUpdate })

export interface PetHostSuccessResponse {
  id: string
  ok: true
  protocol: typeof petHostProtocol
  result: unknown
  type: "response"
}

export interface PetHostErrorResponse {
  error: string
  id: string
  ok: false
  protocol: typeof petHostProtocol
  type: "response"
}

export type PetHostResponse = PetHostErrorResponse | PetHostSuccessResponse

export interface PetHostActivityEvent {
  event: "activity.changed"
  payload: PetActivitySnapshot
  protocol: typeof petHostProtocol
  type: "event"
}

export interface PetHostPreferencesEvent {
  event: "preferences.changed"
  payload: PetPreferences
  protocol: typeof petHostProtocol
  type: "event"
}

export type PetHostEvent = PetHostActivityEvent | PetHostPreferencesEvent
export type PetHostMessage = PetHostEvent | PetHostResponse

/** Main-only target. It is deliberately absent from renderer snapshots. */
export interface PetActivityTarget {
  projectId: string
  sessionId: string
}

export interface PetInventoryItem {
  alt: string
  assetUrl: string
  description: string
  id: string
  name: string
  source: "custom" | "plugin"
  spriteVersion: 2
}

export interface PetInventorySnapshot {
  awake: boolean
  pets: PetInventoryItem[]
  selectedId?: string
}

export interface PetRendererSnapshot {
  activity: PetActivitySnapshot
  pet: PetInventoryItem
}

export interface PetNavigationRequest {
  activityId: string
  revision: number
}

export interface PetNavigationTarget extends PetActivityTarget {
  activityId: string
  revision: number
}

export interface PetDragInput {
  dx: number
  dy: number
  phase: "end" | "move"
}

export const petIpcChannels = {
  changed: "pet:changed",
  deleteCustom: "pet:delete-custom",
  drag: "pet:drag",
  importCustom: "pet:import-custom",
  list: "pet:list",
  markDisplayed: "pet:mark-displayed",
  navigate: "pet:navigate",
  select: "pet:select",
  setAwake: "pet:set-awake",
  setExpanded: "pet:set-expanded",
  snapshot: "pet:snapshot",
} as const

export type PetIpcChannels = typeof petIpcChannels

export interface PetSettingsClient {
  deleteCustom(input: { id: string }): Promise<void>
  importCustom(): Promise<PetInventoryItem | null>
  list(): Promise<PetInventorySnapshot>
  markDisplayed(input: PetNavigationRequest): Promise<void>
  onDidChange(listener: () => void): () => void
  onNavigate(listener: (target: PetNavigationTarget) => void): () => void
  select(input: { id: string }): Promise<void>
  setAwake(input: { awake: boolean }): Promise<void>
}

export interface PetOverlayClient {
  drag(input: PetDragInput): void
  navigate(input: PetNavigationRequest): Promise<void>
  onSnapshot(listener: (snapshot: PetRendererSnapshot) => void): () => void
  setExpanded(input: { expanded: boolean }): Promise<void>
}
