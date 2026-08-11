import { randomUUID } from "node:crypto"
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { isPluginApiCommitPreserving } from "@convax/plugin-api"
import { parsePortablePluginLocale } from "@convax/plugin-sdk"

import {
  pluginCapabilityIpcChannels,
  type PluginCapabilityCancelInput,
  type PluginCapabilityCallInput,
  type PluginCapabilityConnectInput,
  type PluginCapabilityDisconnectInput,
  type PluginCapabilityGetPluginAvailabilityInput,
  type PluginCapabilityInvokePluginInput,
  type PluginCapabilityUpdateLocaleInput,
} from "../plugin-capability-ipc"
import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { PluginHostApiMainCall, PluginHostApiMainConnection } from "../plugin-host-api-main-contracts"
import { PluginHostProtocolError } from "../plugin-host-errors"
import {
  isPluginCapabilityRequest,
  pluginCanvasDocumentChangedCommand,
  pluginHostLocaleChangedCommand,
  pluginCapabilityApiFailure,
  pluginCapabilityFailure,
  pluginCapabilityProtocolFailure,
  pluginCapabilityProtocolV3,
  pluginCapabilitySuccess,
} from "../plugin-host-protocol"
import type { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import type { PluginCapabilityBrokerMainService } from "./plugin-capability-broker-service"
import { pluginCapabilityBrokerRemoteFailure } from "./plugin-capability-remote-errors"
import type { PluginHostApiService } from "./plugin-host-api-service"
import type { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"

interface LiveConnection {
  connection: PluginHostApiMainConnection
  operations: Map<string, AbortController>
  principal: PluginPrincipal
  replays: Map<string, { fingerprint: string; result: Promise<unknown> }>
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

function isSha256Digest(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

export function registerPluginCapabilityIpc(options: {
  broker: PluginCanvasCapabilityService
  host: PluginHostApiService
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  pluginBroker: Pick<PluginCapabilityBrokerMainService, "getAvailability" | "invoke">
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
    for (const controller of live.operations.values()) {
      controller.abort(new Error("Plugin capability connection was closed"))
    }
    live.operations.clear()
    live.replays.clear()
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
      !Number.isSafeInteger(input.activeRevision) ||
      input.activeRevision < 0 ||
      !isSha256Digest(input.activeSetDigest) ||
      !isBoundedIdentifier(input.canvasId, 256) ||
      !isBoundedIdentifier(input.nodeId, 2_048) ||
      !isBoundedIdentifier(input.pluginId, 128) ||
      !isBoundedIdentifier(input.pluginVersion, 128) ||
      !isBoundedIdentifier(input.projectId, 256) ||
      typeof input.locale !== "string" ||
      !isSha256Digest(input.snapshotDigest)
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
      const locale = parsePortablePluginLocale(input.locale)
      assertConnectionCanPublish(event)
      if (
        principal.pluginVersion !== input.pluginVersion ||
        principal.activeRevision !== input.activeRevision ||
        principal.activeSetDigest !== input.activeSetDigest ||
        principal.snapshotDigest !== input.snapshotDigest
      ) {
        throw new Error("Plugin generation changed before its capability connection was established")
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
      const connection = await options.host.connect({
        canvas: client,
        node: {
          canvasId: input.canvasId,
          nodeId: input.nodeId,
          projectId: input.projectId,
        },
        locale,
        onCanvasEvent({ event: canvasEvent, subscriptionId }) {
          if (!connections.has(connectionId) || event.sender.isDestroyed()) return
          event.sender.send(pluginCapabilityIpcChannels.changed, {
            command: {
              command: pluginCanvasDocumentChangedCommand,
              params: { event: canvasEvent, subscriptionId },
              protocol: pluginCapabilityProtocolV3,
              type: "command",
            },
            connectionId,
          })
        },
        principal,
        scope,
        transport: {
          frameId: randomUUID(),
          senderId: event.sender.id,
        },
      })
      try {
        assertConnectionCanPublish(event)
      } catch (error) {
        connection.close()
        throw error
      }
      connections.set(connectionId, {
        connection,
        operations: new Map(),
        principal,
        replays: new Map(),
        senderId: event.sender.id,
      })
      return { connectionId, protocol: pluginCapabilityProtocolV3 }
    } finally {
      const remaining = (pendingConnectionsBySender.get(event.sender.id) ?? 1) - 1
      if (remaining > 0) pendingConnectionsBySender.set(event.sender.id, remaining)
      else pendingConnectionsBySender.delete(event.sender.id)
    }
  })
  ipcMain.handle(pluginCapabilityIpcChannels.call, async (event, input: PluginCapabilityCallInput) => {
    trusted(event)
    if (!input || !isBoundedIdentifier(input.connectionId, 128) || !isBoundedIdentifier(input.operationId, 128)) {
      throw new Error("Plugin capability call is invalid")
    }
    const live = connections.get(input.connectionId)
    if (!live || live.senderId !== event.sender.id) throw new Error("Plugin capability connection was not found")
    const request = input.request
    const requestId = capabilityRequestId(request)
    if (!requestId) return null
    if (!isPluginCapabilityRequest(request)) {
      return pluginCapabilityProtocolFailure(
        requestId,
        new PluginHostProtocolError("invalid-request", "Invalid Plugin capability request"),
      )
    }
    const run = () => dispatchHostCall(live, input.operationId, request)
    try {
      return await (isPluginApiCommitPreserving(request.method)
        ? replayOperation(live, `host:${input.operationId}`, request, run)
        : run())
    } catch (error) {
      return pluginCapabilityProtocolFailure(requestId, error)
    }
  })
  ipcMain.handle(
    pluginCapabilityIpcChannels.getPluginAvailability,
    async (event, input: PluginCapabilityGetPluginAvailabilityInput) => {
      trusted(event)
      if (
        !input ||
        !isBoundedIdentifier(input.connectionId, 128) ||
        !isBoundedIdentifier(input.operationId, 128) ||
        !isBoundedIdentifier(input.capabilityId, 256)
      ) {
        throw new Error("Plugin-to-Plugin capability availability request is invalid")
      }
      const live = connections.get(input.connectionId)
      if (!live || live.senderId !== event.sender.id) {
        throw new Error("Plugin capability connection was not found")
      }
      const controller = beginOperation(live, input.operationId)
      try {
        return await options.pluginBroker.getAvailability(live.principal, input.capabilityId, controller.signal)
      } finally {
        finishOperation(live, input.operationId, controller)
      }
    },
  )
  ipcMain.handle(pluginCapabilityIpcChannels.invokePlugin, async (event, input: PluginCapabilityInvokePluginInput) => {
    trusted(event)
    validateInvokePluginInput(input)
    const live = connections.get(input.connectionId)
    if (!live || live.senderId !== event.sender.id) {
      throw new Error("Plugin capability connection was not found")
    }
    try {
      return await replayOperation(live, `plugin:${input.operationId}`, input.request, async () => {
        const controller = beginOperation(live, input.operationId)
        try {
          const result = await options.pluginBroker.invoke(live.principal, input.request, controller.signal)
          return pluginCapabilitySuccess(input.request.requestId, result)
        } catch (error) {
          return pluginCapabilityFailure(input.request.requestId, pluginCapabilityBrokerRemoteFailure(error))
        } finally {
          finishOperation(live, input.operationId, controller)
        }
      })
    } catch (error) {
      return pluginCapabilityProtocolFailure(input.request.requestId, error)
    }
  })
  ipcMain.handle(pluginCapabilityIpcChannels.cancel, async (event, input: PluginCapabilityCancelInput) => {
    trusted(event)
    if (!input || !isBoundedIdentifier(input.connectionId, 128) || !isBoundedIdentifier(input.operationId, 128)) {
      return false
    }
    const live = connections.get(input.connectionId)
    if (!live || live.senderId !== event.sender.id) return false
    const controller = live.operations.get(input.operationId)
    if (!controller) return false
    controller.abort(new Error("Plugin capability operation was canceled"))
    return true
  })
  ipcMain.handle(pluginCapabilityIpcChannels.disconnect, async (event, input: PluginCapabilityDisconnectInput) => {
    trusted(event)
    if (!input || !isBoundedIdentifier(input.connectionId, 128)) return false
    return disconnect(input.connectionId, event.sender.id)
  })
  ipcMain.handle(pluginCapabilityIpcChannels.updateLocale, async (event, input: PluginCapabilityUpdateLocaleInput) => {
    trusted(event)
    if (!input || !isBoundedIdentifier(input.connectionId, 128) || typeof input.locale !== "string") {
      return false
    }
    const live = connections.get(input.connectionId)
    if (!live || live.senderId !== event.sender.id) return false
    const locale = parsePortablePluginLocale(input.locale)
    const changed = live.connection.updateLocale(locale)
    if (changed && live.connection.supports("host.locale.get") && !event.sender.isDestroyed()) {
      event.sender.send(pluginCapabilityIpcChannels.changed, {
        command: {
          command: pluginHostLocaleChangedCommand,
          params: { locale },
          protocol: pluginCapabilityProtocolV3,
          type: "command",
        },
        connectionId: input.connectionId,
      })
    }
    return changed
  })

  return () => {
    disposed = true
    ipcMain.removeHandler(pluginCapabilityIpcChannels.connect)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.call)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.cancel)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.disconnect)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.getPluginAvailability)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.invokePlugin)
    ipcMain.removeHandler(pluginCapabilityIpcChannels.updateLocale)
    for (const connectionId of connections.keys()) disconnect(connectionId)
    for (const { listener, sender } of observedSenders.values()) {
      sender.removeListener("destroyed", listener)
    }
    observedSenders.clear()
  }
}

function beginOperation(live: LiveConnection, operationId: string) {
  if (live.operations.has(operationId)) {
    throw new PluginHostProtocolError("invalid-request", "Plugin capability operation id is already in flight")
  }
  const controller = new AbortController()
  live.operations.set(operationId, controller)
  return controller
}

function finishOperation(live: LiveConnection, operationId: string, controller: AbortController) {
  if (live.operations.get(operationId) === controller) live.operations.delete(operationId)
}

async function dispatchHostCall(
  live: LiveConnection,
  operationId: string,
  request: ReturnType<typeof requireCapabilityRequest>,
) {
  const controller = beginOperation(live, operationId)
  try {
    const result = await live.connection.execute(
      {
        method: request.method,
        ...(request.params === undefined ? {} : { params: request.params }),
      } as PluginHostApiMainCall,
      { operationId, signal: controller.signal },
    )
    return pluginCapabilitySuccess(request.id, result)
  } catch (error) {
    return pluginCapabilityApiFailure(request.id, request.method, error)
  } finally {
    finishOperation(live, operationId, controller)
  }
}

function requireCapabilityRequest(value: unknown) {
  if (!isPluginCapabilityRequest(value)) throw new Error("Invalid Plugin capability request")
  return value
}

function replayOperation<Result>(
  live: LiveConnection,
  key: string,
  request: unknown,
  run: () => Promise<Result>,
): Promise<Result> {
  const fingerprint = stableJson(request)
  const existing = live.replays.get(key)
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return Promise.reject(
        new PluginHostProtocolError(
          "invalid-request",
          "Plugin capability operation id was reused with a different request",
        ),
      )
    }
    return existing.result as Promise<Result>
  }
  const result = run()
  live.replays.set(key, { fingerprint, result })
  while (live.replays.size > 64) live.replays.delete(live.replays.keys().next().value!)
  return result
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

function capabilityRequestId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  return isBoundedIdentifier(id, 128) ? (id as string) : null
}

function validateInvokePluginInput(input: PluginCapabilityInvokePluginInput) {
  if (
    !input ||
    !isBoundedIdentifier(input.connectionId, 128) ||
    !isBoundedIdentifier(input.operationId, 128) ||
    !input.request ||
    !isBoundedIdentifier(input.request.capabilityId, 256) ||
    !isBoundedIdentifier(input.request.requestId, 128)
  ) {
    throw new Error("Plugin-to-Plugin capability invocation is invalid")
  }
  const keys = Object.keys(input.request)
  if (keys.length !== 3 || keys.some((key) => !["capabilityId", "input", "requestId"].includes(key))) {
    throw new Error("Plugin-to-Plugin capability invocation is invalid")
  }
}
