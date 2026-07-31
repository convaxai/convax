import type { WebPluginCapability } from "./plugin-contracts"

export {
  petHostMaximumMessageBytes,
  petHostMaximumPendingRequests,
  petHostProtocol,
  type PetActivitySnapshot,
  type PetActivitySummary,
  type PetCustomCollectionSnapshot,
  type PetCustomDelete,
  type PetCustomPet,
  type PetDragInput,
  type PetHostConnect,
  type PetHostEvent,
  type PetHostMessage,
  type PetHostMethod,
  type PetHostRequest,
  type PetHostResponse,
  type PetHostSurface,
  type PetNavigationRequest,
  type PetPreferences,
  type PetPreferencesUpdate,
  type PetVisibleActivityState,
} from "@convax/plugin-sdk/pet"

export interface PetHostProviderBinding {
  readonly capabilities: readonly WebPluginCapability[]
  readonly digest: string
  readonly generation: number
  readonly pluginId: string
}

/** Main-only target. It is deliberately absent from renderer snapshots. */
export interface PetActivityTarget {
  projectId: string
  sessionId: string
}

export interface PetDisplayedSession {
  projectId: string
  sessionId: string
}

export interface PetNavigationTarget extends PetActivityTarget {
  activityId: string
  revision: number
}

export const petIpcChannels = {
  connectOverlay: "pet:connect-host",
  markDisplayed: "pet:mark-displayed",
  navigate: "pet:navigate",
  navigationReady: "pet:navigation-ready",
  provider: "pet:provider",
  providerChanged: "pet:provider-changed",
  sessionDisplayed: "pet:session-displayed",
  settingsConnect: "pet:settings-connect",
  settingsDisconnect: "pet:settings-disconnect",
  settingsPort: "pet:settings-port",
} as const

export type PetIpcChannels = typeof petIpcChannels
