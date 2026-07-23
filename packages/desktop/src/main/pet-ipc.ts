import type { IpcMainInvokeEvent } from "electron"

import {
  petHostProtocol,
  petIpcChannels,
  type PetActivitySnapshot,
  type PetHostProviderBinding,
  type PetNavigationRequest,
  type PetNavigationTarget,
  type PetPreferences,
  type PetPreferencesUpdate,
} from "../pet-contracts"
import { PetHostConnection, type PetHostServices } from "./pet-host-connection"
import type { WebPluginPublicationTransaction } from "./plugin-manager"
import type { InstalledPetProvider } from "./pet-provider-controller"

type Unsubscribe = () => void

interface PetProviderPort {
  getActivitySnapshot(): PetActivitySnapshot
  getBinding(): PetHostProviderBinding | undefined
  getPreferences(): PetPreferences
  getProvider(): InstalledPetProvider | undefined
  setAwake(input: { awake: boolean }): Promise<PetPreferences>
  subscribeActivity(listener: (snapshot: PetActivitySnapshot) => void): Unsubscribe
  subscribePreferences(listener: (preferences: PetPreferences) => void): Unsubscribe
  subscribeProvider(listener: (provider: InstalledPetProvider | undefined) => void): Unsubscribe
  updatePreferences(input: PetPreferencesUpdate): Promise<PetPreferences>
}

interface PetActivityNavigationPort {
  markSeen(activityId: string, expectedRevision: number): Promise<void>
  resolveActivity(activityId: string): { projectId: string; sessionId: string } | null
}

interface PetOverlayWindowPort {
  moveBy(delta: { x: number; y: number }, completed: boolean): Promise<void>
  setExpanded(expanded: boolean): Promise<void>
}

interface PetMainWindow {
  focus(): void
  isMinimized(): boolean
  restore(): void
  show(): void
  webContents: {
    id: number
    isDestroyed(): boolean
    on(
      event: "did-start-navigation",
      listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
    ): unknown
    once(event: "destroyed", listener: () => void): unknown
    removeListener(
      event: "did-start-navigation",
      listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
    ): unknown
    removeListener(event: "destroyed", listener: () => void): unknown
    send(channel: string, target?: PetNavigationTarget): void
  }
}

interface PetMessagePortMain {
  close(): void
  on(event: "close", listener: () => void): unknown
  on(event: "message", listener: (event: { data: unknown }) => void): unknown
  postMessage(message: unknown): void
  removeListener?(event: "close" | "message", listener: (...args: any[]) => void): unknown
  start(): void
}

interface PetMessageChannelMain {
  port1: PetMessagePortMain
  port2: PetMessagePortMain
}

interface PetIpcMain {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void
  removeHandler(channel: string): void
}

export interface PetHostWebContents {
  id: number
  isDestroyed(): boolean
  once(event: "destroyed", listener: () => void): unknown
  postMessage(channel: string, message: unknown, transfer?: readonly unknown[]): void
  removeListener(event: "destroyed", listener: () => void): unknown
}

export interface RegisterPetIpcOptions {
  createMessageChannel(): PetMessageChannelMain
  getMainWindow(): PetMainWindow | null
  ipcMain: PetIpcMain
  isTrustedMainSender(event: IpcMainInvokeEvent): boolean
  openMainWindow(): Promise<PetMainWindow>
  restoreProvider(pluginId: string): Promise<void>
}

export interface PetIpcRegistration {
  connectOverlay(sender: PetHostWebContents, binding: PetHostProviderBinding): void
  dispose(): void
  prepareProviderChange(pluginId: string): WebPluginPublicationTransaction
}

interface PetSettingsIdentity {
  connectionId: string
  generation: number
  pluginId: string
}

interface LiveConnection {
  closed: boolean
  connection: PetHostConnection
  port: PetMessagePortMain
  senderId: number
  settingsKey?: string
}

const maximumSettingsConnectionsPerSender = 32

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const input = value as Record<string, unknown>
  const actual = Object.keys(input)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(`${label} is invalid`)
  }
  return input
}

function settingsIdentity(value: unknown): PetSettingsIdentity {
  const input = exactRecord(value, ["connectionId", "generation", "pluginId"], "Pet settings connection")
  if (
    typeof input.connectionId !== "string" ||
    input.connectionId.length < 1 ||
    input.connectionId.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.connectionId) ||
    !Number.isSafeInteger(input.generation) ||
    (input.generation as number) < 1 ||
    typeof input.pluginId !== "string" ||
    input.pluginId.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.pluginId)
  ) {
    throw new Error("Pet settings connection is invalid")
  }
  return {
    connectionId: input.connectionId,
    generation: input.generation as number,
    pluginId: input.pluginId,
  }
}

function activityRequest(value: unknown): PetNavigationRequest {
  const input = exactRecord(value, ["activityId", "revision"], "Pet activity request")
  if (
    typeof input.activityId !== "string" ||
    input.activityId.length < 1 ||
    input.activityId.length > 128 ||
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0
  ) {
    throw new Error("Pet activity request is invalid")
  }
  return { activityId: input.activityId, revision: input.revision as number }
}

function sameBinding(left: PetHostProviderBinding, right: PetHostProviderBinding | undefined) {
  return (
    right !== undefined &&
    left.pluginId === right.pluginId &&
    left.digest === right.digest &&
    left.generation === right.generation &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((capability, index) => capability === right.capabilities[index])
  )
}

function settingsKey(senderId: number, identity: PetSettingsIdentity) {
  return `${senderId}:${identity.pluginId}:${identity.generation}:${identity.connectionId}`
}

export function registerPetIpc(
  provider: PetProviderPort,
  activity: PetActivityNavigationPort,
  overlay: PetOverlayWindowPort,
  options: RegisterPetIpcOptions,
): PetIpcRegistration {
  const connections = new Set<LiveConnection>()
  const mainRendererObservers = new Map<
    number,
    {
      destroyed: () => void
      navigation: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void
      sender: PetMainWindow["webContents"]
    }
  >()
  const settingsConnections = new Map<string, LiveConnection>()
  const observedSenders = new Map<number, { listener: () => void; sender: PetHostWebContents }>()
  const { createMessageChannel, ipcMain } = options
  let disposed = false
  let invalidatedBinding: PetHostProviderBinding | undefined
  let navigationReadySenderId: number | undefined
  let pendingNavigation: { senderId: number; target: PetNavigationTarget } | undefined

  const closeConnection = (live: LiveConnection, reason = "Pet host connection closed") => {
    if (live.closed) return
    live.closed = true
    connections.delete(live)
    if (live.settingsKey && settingsConnections.get(live.settingsKey) === live) {
      settingsConnections.delete(live.settingsKey)
    }
    live.connection.close(reason)
    try {
      live.port.close()
    } catch {}
  }
  const closeSender = (senderId: number) => {
    observedSenders.delete(senderId)
    if (navigationReadySenderId === senderId) navigationReadySenderId = undefined
    if (pendingNavigation?.senderId === senderId) pendingNavigation = undefined
    for (const live of [...connections]) {
      if (live.senderId === senderId) closeConnection(live, "Pet host renderer was destroyed")
    }
  }
  const observeSender = (sender: PetHostWebContents) => {
    if (observedSenders.has(sender.id)) return
    const listener = () => closeSender(sender.id)
    observedSenders.set(sender.id, { listener, sender })
    sender.once("destroyed", listener)
  }
  const requireTrusted = (event: IpcMainInvokeEvent) => {
    if (disposed) throw new Error("Pet IPC is disposed")
    if (!options.isTrustedMainSender(event)) throw new Error("Pet IPC request came from an untrusted renderer")
    const sender = event.sender as unknown as PetHostWebContents
    if (sender.isDestroyed()) throw new Error("Pet IPC renderer was destroyed")
    observeSender(sender)
    return sender
  }
  const requireActivityTarget = (input: PetNavigationRequest) => {
    const snapshot = provider.getActivitySnapshot()
    if (snapshot.revision !== input.revision) throw new Error("Pet activity revision is stale")
    if (!snapshot.activities.some((candidate) => candidate.id === input.activityId)) {
      throw new Error("Pet activity is no longer available")
    }
    const target = activity.resolveActivity(input.activityId)
    if (!target) throw new Error("Pet activity is no longer available")
    return target
  }
  const availableBinding = () => {
    const binding = provider.getBinding()
    return binding && !sameBinding(binding, invalidatedBinding) ? binding : undefined
  }
  const notifyProviderChanged = () => {
    try {
      options.getMainWindow()?.webContents.send(petIpcChannels.providerChanged)
    } catch {}
  }
  const revokeBinding = (binding: PetHostProviderBinding) => {
    invalidatedBinding = binding
    for (const live of [...connections]) closeConnection(live, "Pet provider changed")
    notifyProviderChanged()
  }
  const forgetMainRenderer = (senderId: number) => {
    mainRendererObservers.delete(senderId)
    if (navigationReadySenderId === senderId) navigationReadySenderId = undefined
    if (pendingNavigation?.senderId === senderId) pendingNavigation = undefined
  }
  const observeMainRenderer = (mainWindow: PetMainWindow) => {
    const sender = mainWindow.webContents
    const current = mainRendererObservers.get(sender.id)
    if (current?.sender === sender || sender.isDestroyed()) return
    if (current) {
      current.sender.removeListener("did-start-navigation", current.navigation)
      current.sender.removeListener("destroyed", current.destroyed)
    }
    const navigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument && navigationReadySenderId === sender.id) {
        navigationReadySenderId = undefined
      }
    }
    const destroyed = () => forgetMainRenderer(sender.id)
    mainRendererObservers.set(sender.id, { destroyed, navigation, sender })
    sender.on("did-start-navigation", navigation)
    sender.once("destroyed", destroyed)
  }
  const openActivity = async (input: PetNavigationRequest) => {
    const target = requireActivityTarget(input)
    const mainWindow = await options.openMainWindow()
    observeMainRenderer(mainWindow)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    const navigationTarget = { ...input, ...target }
    if (navigationReadySenderId === mainWindow.webContents.id) {
      mainWindow.webContents.send(petIpcChannels.navigate, navigationTarget)
      return
    }
    pendingNavigation = { senderId: mainWindow.webContents.id, target: navigationTarget }
  }
  const services: PetHostServices = {
    getActivitySnapshot: () => provider.getActivitySnapshot(),
    getBinding: () => availableBinding(),
    getPreferences: () => provider.getPreferences(),
    moveOverlay: (input) => overlay.moveBy({ x: input.dx, y: input.dy }, input.phase === "end"),
    openActivity,
    setAwake: (input) => provider.setAwake(input),
    setExpanded: (input) => overlay.setExpanded(input.expanded),
    subscribeActivity: (listener) => provider.subscribeActivity(listener),
    subscribePreferences: (listener) => provider.subscribePreferences(listener),
    updatePreferences: (input) => provider.updatePreferences(input),
  }

  const connect = (
    sender: PetHostWebContents,
    binding: PetHostProviderBinding,
    surface: "overlay" | "settings",
    channel: string,
    envelope: Record<string, unknown>,
    key?: string,
  ) => {
    if (disposed) throw new Error("Pet IPC is disposed")
    if (sender.isDestroyed()) throw new Error("Pet host renderer was destroyed")
    if (!sameBinding(binding, availableBinding())) throw new Error("Pet provider changed before connecting")
    observeSender(sender)
    const { port1, port2 } = createMessageChannel()
    let live: LiveConnection | undefined
    let closedBeforeRegistration = false
    try {
      const connection = new PetHostConnection({
        binding,
        onClose: () => {
          if (live) closeConnection(live)
          else closedBeforeRegistration = true
        },
        send: (message) => port1.postMessage(message),
        services,
        surface,
      })
      if (closedBeforeRegistration) throw new Error("Pet host connection closed while connecting")
      live = {
        closed: false,
        connection,
        port: port1,
        senderId: sender.id,
        ...(key ? { settingsKey: key } : {}),
      }
      connections.add(live)
      if (key) settingsConnections.set(key, live)
      const receive = (event: { data: unknown }) => {
        void connection.handle(event.data).catch(() => closeConnection(live!, "Pet host request failed"))
      }
      const closed = () => closeConnection(live!)
      port1.on("message", receive)
      port1.on("close", closed)
      port1.start()
      if (live.closed) throw new Error("Pet host connection closed while connecting")
      sender.postMessage(channel, envelope, [port2])
    } catch (error) {
      if (live) closeConnection(live, "Pet host port could not be delivered")
      try {
        port1.close()
      } catch {}
      try {
        port2.close()
      } catch {}
      throw error
    }
    return live
  }

  ipcMain.handle(petIpcChannels.provider, (event) => {
    requireTrusted(event)
    const installed = provider.getProvider()
    return installed && availableBinding()
      ? { generation: installed.generation, pluginId: installed.pluginId, settingsUrl: installed.settingsUrl }
      : undefined
  })
  ipcMain.handle(petIpcChannels.settingsConnect, (event, value: unknown) => {
    const sender = requireTrusted(event)
    const identity = settingsIdentity(value)
    const binding = availableBinding()
    if (!binding || binding.pluginId !== identity.pluginId || binding.generation !== identity.generation) {
      throw new Error("Pet settings provider changed before connecting")
    }
    const key = settingsKey(sender.id, identity)
    if (settingsConnections.has(key)) throw new Error("Pet settings connection already exists")
    const senderCount = [...settingsConnections.values()].filter((live) => live.senderId === sender.id).length
    if (senderCount >= maximumSettingsConnectionsPerSender) {
      throw new Error("Pet settings connection limit reached")
    }
    connect(
      sender,
      binding,
      "settings",
      petIpcChannels.settingsPort,
      {
        ...identity,
        protocol: petHostProtocol,
        surface: "settings",
        type: "connect",
      },
      key,
    )
  })
  ipcMain.handle(petIpcChannels.settingsDisconnect, (event, value: unknown) => {
    const sender = requireTrusted(event)
    const identity = settingsIdentity(value)
    const key = settingsKey(sender.id, identity)
    const live = settingsConnections.get(key)
    if (!live) return false
    closeConnection(live)
    return true
  })
  ipcMain.handle(petIpcChannels.markDisplayed, async (event, value: unknown) => {
    requireTrusted(event)
    const input = activityRequest(value)
    requireActivityTarget(input)
    await activity.markSeen(input.activityId, input.revision)
  })
  ipcMain.handle(petIpcChannels.navigationReady, (event) => {
    const sender = requireTrusted(event)
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.webContents.id !== sender.id) {
      throw new Error("Pet navigation readiness came from a stale renderer")
    }
    observeMainRenderer(mainWindow)
    navigationReadySenderId = sender.id
    if (pendingNavigation?.senderId !== sender.id) return
    const { target } = pendingNavigation
    pendingNavigation = undefined
    mainWindow.webContents.send(petIpcChannels.navigate, target)
  })

  const unsubscribeProvider = provider.subscribeProvider(() => {
    if (disposed) return
    for (const live of [...connections]) closeConnection(live, "Pet provider changed")
    notifyProviderChanged()
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    ipcMain.removeHandler(petIpcChannels.provider)
    ipcMain.removeHandler(petIpcChannels.settingsConnect)
    ipcMain.removeHandler(petIpcChannels.settingsDisconnect)
    ipcMain.removeHandler(petIpcChannels.markDisplayed)
    ipcMain.removeHandler(petIpcChannels.navigationReady)
    try {
      unsubscribeProvider()
    } catch {}
    for (const live of [...connections]) closeConnection(live)
    for (const { listener, sender } of observedSenders.values()) sender.removeListener("destroyed", listener)
    observedSenders.clear()
    for (const { destroyed, navigation, sender } of mainRendererObservers.values()) {
      sender.removeListener("did-start-navigation", navigation)
      sender.removeListener("destroyed", destroyed)
    }
    mainRendererObservers.clear()
  }

  const initialMainWindow = options.getMainWindow()
  if (initialMainWindow) observeMainRenderer(initialMainWindow)

  return {
    connectOverlay(sender, binding) {
      if (!sameBinding(binding, availableBinding())) throw new Error("Pet overlay provider changed before connecting")
      for (const live of [...connections]) {
        if (live.senderId === sender.id && live.settingsKey === undefined) {
          closeConnection(live, "Pet overlay reconnected")
        }
      }
      connect(sender, binding, "overlay", petIpcChannels.connectOverlay, {
        pluginId: binding.pluginId,
        protocol: petHostProtocol,
        surface: "overlay",
        type: "connect",
      })
    },
    dispose,
    prepareProviderChange(pluginId) {
      let revoked: PetHostProviderBinding | undefined
      return {
        async publish() {
          if (revoked) return
          const binding = provider.getBinding()
          if (!binding || binding.pluginId !== pluginId) return
          revoked = binding
          revokeBinding(binding)
        },
        async commit() {},
        async rollback() {
          if (!revoked || !sameBinding(revoked, invalidatedBinding)) return
          invalidatedBinding = undefined
          try {
            await options.restoreProvider(pluginId)
            notifyProviderChanged()
            revoked = undefined
          } catch (error) {
            const current = provider.getBinding()
            if (current?.pluginId === pluginId) revokeBinding(current)
            throw error
          }
        },
        async deferToRecovery() {},
      }
    },
  }
}
