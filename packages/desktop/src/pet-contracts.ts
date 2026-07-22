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
}

export interface PetNavigationTarget extends PetActivityTarget {
  activityId: string
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
