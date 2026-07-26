import { randomUUID } from "node:crypto"
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"

import { PluginCapabilityConnection } from "../plugin-capability-dispatch"
import {
  pluginCapabilityIpcChannels,
  type PluginCapabilityCallInput,
  type PluginCapabilityConnectInput,
  type PluginCapabilityDisconnectInput,
} from "../plugin-capability-ipc"
import { pluginCapabilityProtocolV1 } from "../plugin-host-protocol"
import type { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import type { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"

interface LiveConnection {
  connection: PluginCapabilityConnection
  senderId: number
}

const maximumConnectionsPerSender = 128

function isBoundedIdentifier(value: unknown, maximum: number) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !value.includes("\0")
  )
}

export function registerPluginCapabilityIpc(options: {
  broker: PluginCanvasCapabilityService
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  principals: InstalledPluginPrincipalResolver
}) {
  const connections = new Map<string, LiveConnection>()
  const observedSenders = new Map<number, { listener: () => void; sender: WebContents }>()
  const pendingConnectionsBySender = new Map<number, number>()
  let disposed = false

  const disconnect = (connectionId: string, senderId?: number) => {
    const live = connections.get(connectionId)
    if (!live || (senderId !== undefined && live.senderId !== senderId)) return false
    connections.delete(connectionId)
    live.connection.close()
    return true
  }
  const disconnectSender = (senderId: number) => {
    observedSenders.delete(senderId)
    for (const [connectionId, live] of connections) {
      if (live.senderId === senderId) disconnect(connectionId)
    }
  }
  const observeSender = (sender: WebContents) => {
    if (observedSenders.has(sender.id)) return
    const listener = () => disconnectSender(sender.id)
    observedSenders.set(sender.id, { listener, sender })
    sender.once("destroyed", listener)
  }
  const trusted = (event: IpcMainInvokeEvent) => {
    if (disposed) throw new Error("Plugin capability IPC is disposed")
    if (!options.isTrustedSender(event)) throw new Error("Untrusted Plugin capability sender")
    observeSender(event.sender)
  }
  const assertConnectionCanPublish = (event: IpcMainInvokeEvent) => {
    if (disposed) throw new Error("Plugin capability IPC was disposed while connecting")
    if (event.sender.isDestroyed()) throw new Error("Plugin capability sender was destroyed while connecting")
  }

  ipcMain.handle(pluginCapabilityIpcChannels.connect, async (event, input: PluginCapabilityConnectInput) => {
    trusted(event)
    if (
      !input ||
      input.runtime !== "web" ||
      !isBoundedIdentifier(input.pluginId, 128) ||
      !isBoundedIdentifier(input.pluginVersion, 128) ||
      !isBoundedIdentifier(input.projectId, 256)
    ) {
      throw new Error("Plugin capability connection request is invalid")
    }
    const senderConnections = [...connections.values()].filter((live) => live.senderId === event.sender.id).length
    const pendingConnections = pendingConnectionsBySender.get(event.sender.id) ?? 0
    if (senderConnections + pendingConnections >= maximumConnectionsPerSender) {
      throw new Error(`Renderer exceeds ${maximumConnectionsPerSender} Plugin capability connections`)
    }
    pendingConnectionsBySender.set(event.sender.id, pendingConnections + 1)
    try {
      const principal = await options.principals.issue(input.pluginId, "web")
      assertConnectionCanPublish(event)
      if (principal.pluginVersion !== input.pluginVersion) {
        throw new Error("Plugin changed before its capability connection was established")
      }
      const resolved = await options.principals.resolve(principal)
      assertConnectionCanPublish(event)
      if (!resolved) throw new Error("Plugin capability principal changed while connecting")
      const scope = resolved.capabilities.includes("projects.read")
        ? { kind: "all-bound-projects" as const }
        : { kind: "project" as const, projectId: input.projectId }
      const client = await options.broker.connect({ principal, scope })
      assertConnectionCanPublish(event)
      const connectionId = randomUUID()
      const protocol = principal.capabilityProtocol ?? pluginCapabilityProtocolV1
      const connection = new PluginCapabilityConnection(client, {
        send(command) {
          if (!connections.has(connectionId) || event.sender.isDestroyed()) return
          event.sender.send(pluginCapabilityIpcChannels.changed, { command, connectionId })
        },
      }, undefined, protocol)
      connections.set(connectionId, { connection, senderId: event.sender.id })
      return { connectionId, protocol }
    } finally {
      const remaining = (pendingConnectionsBySender.get(event.sender.id) ?? 1) - 1
      if (remaining > 0) pendingConnectionsBySender.set(event.sender.id, remaining)
      else pendingConnectionsBySender.delete(event.sender.id)
    }
  })
  ipcMain.handle(pluginCapabilityIpcChannels.call, async (event, input: PluginCapabilityCallInput) => {
    trusted(event)
    if (!input || !isBoundedIdentifier(input.connectionId, 128)) {
      throw new Error("Plugin capability call is invalid")
    }
    const live = connections.get(input.connectionId)
    if (!live || live.senderId !== event.sender.id) throw new Error("Plugin capability connection was not found")
    return live.connection.dispatch(input.request)
  })
  ipcMain.handle(pluginCapabilityIpcChannels.disconnect, async (event, input: PluginCapabilityDisconnectInput) => {
    trusted(event)
    if (!input || !isBoundedIdentifier(input.connectionId, 128)) return false
    return disconnect(input.connectionId, event.sender.id)
  })

  return () => {
    disposed = true
    ipcMain.removeHandler(pluginCapabilityIpcChannels.connect)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.call)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.disconnect)
    for (const connectionId of [...connections.keys()]) disconnect(connectionId)
    for (const { listener, sender } of observedSenders.values()) {
      sender.removeListener("destroyed", listener)
    }
    observedSenders.clear()
  }
}
