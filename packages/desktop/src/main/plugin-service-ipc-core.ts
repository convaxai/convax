import { requireWebPluginId } from "../plugin-contracts"
import {
  pluginServiceIpcChannels,
  type PluginServiceStatus,
  type PluginServiceSummary,
  type PluginServiceUsageHistory,
} from "../plugin-service-contracts"

export interface PluginServiceIpcSender {
  readonly id: number
  once(event: "destroyed", listener: () => void): void
  removeListener(event: "destroyed", listener: () => void): void
}

interface SenderState {
  controllers: Map<string, AbortController>
  destroyed(): void
  sender: PluginServiceIpcSender
}

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

export function parsePluginServiceTarget(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Plugin service target is invalid")
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Plugin service target is invalid")
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !("pluginId" in value)) throw new Error("Plugin service target is invalid")
  return { pluginId: requireWebPluginId(value.pluginId) }
}

export function parsePluginServiceCheckoutTarget(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Plugin service Checkout target is invalid")
  }
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Plugin service Checkout target is invalid")
  }
  const value = input as Record<string, unknown>
  if (
    Object.keys(value).length !== 2 ||
    !("pluginId" in value) ||
    !("planKey" in value) ||
    typeof value.planKey !== "string" ||
    value.planKey !== value.planKey.trim() ||
    value.planKey.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.planKey)
  ) {
    throw new Error("Plugin service Checkout target is invalid")
  }
  return { planKey: value.planKey, pluginId: requireWebPluginId(value.pluginId) }
}

/** Sender-scoped cancellation and duplicate suppression without an Electron dependency. */
export class PluginServiceIpcOperations {
  readonly #senders = new Map<number, SenderState>()
  #disposed = false

  assertActive() {
    if (this.#disposed) throw new Error("Plugin service IPC is disposed")
  }

  async run<Result>(
    sender: PluginServiceIpcSender,
    operationKey: string,
    operation: (signal: AbortSignal) => Promise<Result>,
  ) {
    this.assertActive()
    const state = this.#stateFor(sender)
    if (state.controllers.has(operationKey)) throw new Error("Plugin service request is already active")
    const controller = new AbortController()
    state.controllers.set(operationKey, controller)
    try {
      return await operation(controller.signal)
    } finally {
      if (state.controllers.get(operationKey) === controller) state.controllers.delete(operationKey)
      this.#releaseWhenIdle(state)
    }
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const state of this.#senders.values()) {
      state.sender.removeListener("destroyed", state.destroyed)
      for (const controller of state.controllers.values())
        controller.abort(abortError("Plugin service IPC was disposed"))
      state.controllers.clear()
    }
    this.#senders.clear()
  }

  #stateFor(sender: PluginServiceIpcSender) {
    const current = this.#senders.get(sender.id)
    if (current) return current
    const controllers = new Map<string, AbortController>()
    const state: SenderState = {
      controllers,
      destroyed: () => {
        if (this.#senders.get(sender.id) === state) this.#senders.delete(sender.id)
        for (const controller of controllers.values()) controller.abort(abortError("The service renderer closed"))
        controllers.clear()
      },
      sender,
    }
    this.#senders.set(sender.id, state)
    sender.once("destroyed", state.destroyed)
    return state
  }

  #releaseWhenIdle(state: SenderState) {
    if (state.controllers.size || this.#senders.get(state.sender.id) !== state) return
    state.sender.removeListener("destroyed", state.destroyed)
    this.#senders.delete(state.sender.id)
  }
}

export interface PluginServiceExecutor {
  authorize(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  cancelAuthorization(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  checkout(pluginId: string, planKey: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  getStatus(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  getUsageHistory(pluginId: string, signal?: AbortSignal): Promise<PluginServiceUsageHistory>
  listServices(): Promise<readonly PluginServiceSummary[]>
  reauthorize(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  signOut(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
}

export interface PluginServiceIpcTransport<Event extends { sender: PluginServiceIpcSender }> {
  handle(channel: string, handler: (event: Event, input?: unknown) => unknown): void
  publishChange(): void
  removeHandler(channel: string): void
}

export interface PluginServiceChangeTarget {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send(channel: string): void
  }
}

/** Publishes one invalidation without exposing a service payload across IPC. */
export function publishPluginServiceChangeToTargets(targets: readonly PluginServiceChangeTarget[]) {
  for (const target of targets) {
    if (target.isDestroyed() || target.webContents.isDestroyed()) continue
    target.webContents.send(pluginServiceIpcChannels.changed)
  }
}

/** Electron-free registration policy shared by production IPC and boundary tests. */
export function registerPluginServiceIpcCore<Event extends { sender: PluginServiceIpcSender }>(
  executor: PluginServiceExecutor,
  options: { isTrustedSender(event: Event): boolean },
  transport: PluginServiceIpcTransport<Event>,
) {
  const operations = new PluginServiceIpcOperations()
  let disposed = false

  const register = <Result>(
    channel: string,
    operation: (pluginId: string, signal: AbortSignal) => Promise<Result>,
    publish = false,
  ) => {
    transport.handle(channel, async (event, input) => {
      if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
      if (disposed) throw new Error("Plugin service IPC is disposed")
      const { pluginId } = parsePluginServiceTarget(input)
      const operationKey = `${channel}\0${pluginId}`
      return operations.run(event.sender, operationKey, async (signal) => {
        const result = await operation(pluginId, signal)
        if (publish) transport.publishChange()
        return result
      })
    })
  }

  transport.handle(pluginServiceIpcChannels.listServices, (event) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Plugin service IPC is disposed")
    return executor.listServices()
  })
  register(pluginServiceIpcChannels.getStatus, (pluginId, signal) => executor.getStatus(pluginId, signal))
  register(pluginServiceIpcChannels.getUsageHistory, (pluginId, signal) => executor.getUsageHistory(pluginId, signal))
  register(pluginServiceIpcChannels.authorize, (pluginId, signal) => executor.authorize(pluginId, signal), true)
  register(pluginServiceIpcChannels.reauthorize, (pluginId, signal) => executor.reauthorize(pluginId, signal), true)
  register(
    pluginServiceIpcChannels.cancelAuthorization,
    (pluginId, signal) => executor.cancelAuthorization(pluginId, signal),
    true,
  )
  transport.handle(pluginServiceIpcChannels.checkout, async (event, input) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Plugin service IPC is disposed")
    const { planKey, pluginId } = parsePluginServiceCheckoutTarget(input)
    return operations.run(event.sender, `${pluginServiceIpcChannels.checkout}\0${pluginId}`, async (signal) => {
      const result = await executor.checkout(pluginId, planKey, signal)
      transport.publishChange()
      return result
    })
  })
  register(pluginServiceIpcChannels.signOut, (pluginId, signal) => executor.signOut(pluginId, signal), true)

  return () => {
    if (disposed) return
    disposed = true
    operations.dispose()
    for (const channel of Object.values(pluginServiceIpcChannels)) {
      if (channel !== pluginServiceIpcChannels.changed) transport.removeHandler(channel)
    }
  }
}
