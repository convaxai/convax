import { requireWebPluginId } from "../plugin-contracts"
import {
  pluginServiceIpcChannels,
  pluginServiceTargetKey,
  requirePluginServiceId,
  type PluginServiceCheckoutTarget,
  type PluginServiceStatus,
  type PluginServiceSummary,
  type PluginServiceTarget,
  type PluginServiceUsageHistory,
} from "../plugin-service-contracts"

export interface PluginServiceIpcSender {
  readonly id: number
  once(event: "destroyed", listener: () => void): void
  removeListener(event: "destroyed", listener: () => void): void
}

interface SenderState {
  operations: Map<string, ActiveOperation>
  destroyed(): void
  sender: PluginServiceIpcSender
}

interface ActiveOperation {
  controller: AbortController
  promise: Promise<unknown>
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
  if (Object.keys(value).length !== 2 || !("pluginId" in value) || !("serviceId" in value)) {
    throw new Error("Plugin service target is invalid")
  }
  return { pluginId: requireWebPluginId(value.pluginId), serviceId: requirePluginServiceId(value.serviceId) }
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
    Object.keys(value).length !== 3 ||
    !("pluginId" in value) ||
    !("serviceId" in value) ||
    !("planKey" in value) ||
    typeof value.planKey !== "string" ||
    value.planKey !== value.planKey.trim() ||
    value.planKey.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.planKey)
  ) {
    throw new Error("Plugin service Checkout target is invalid")
  }
  return {
    planKey: value.planKey,
    pluginId: requireWebPluginId(value.pluginId),
    serviceId: requirePluginServiceId(value.serviceId),
  }
}

/** Sender-scoped cancellation, mutation suppression, and read single-flight without an Electron dependency. */
export class PluginServiceIpcOperations {
  readonly #senders = new Map<number, SenderState>()
  #disposed = false

  assertActive() {
    if (this.#disposed) throw new Error("Plugin service IPC is disposed")
  }

  run<Result>(
    sender: PluginServiceIpcSender,
    operationKey: string,
    operation: (signal: AbortSignal) => Promise<Result>,
  ) {
    return this.#guardedRun(sender, operationKey, operation, false)
  }

  runShared<Result>(
    sender: PluginServiceIpcSender,
    operationKey: string,
    operation: (signal: AbortSignal) => Promise<Result>,
  ) {
    return this.#guardedRun(sender, operationKey, operation, true)
  }

  #guardedRun<Result>(
    sender: PluginServiceIpcSender,
    operationKey: string,
    operation: (signal: AbortSignal) => Promise<Result>,
    joinActive: boolean,
  ): Promise<Result> {
    try {
      return this.#run(sender, operationKey, operation, joinActive)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  #run<Result>(
    sender: PluginServiceIpcSender,
    operationKey: string,
    operation: (signal: AbortSignal) => Promise<Result>,
    joinActive: boolean,
  ): Promise<Result> {
    this.assertActive()
    const state = this.#stateFor(sender)
    const current = state.operations.get(operationKey)
    if (current) {
      if (joinActive) return current.promise as Promise<Result>
      throw new Error("Plugin service request is already active")
    }
    const controller = new AbortController()
    const active: ActiveOperation = {
      controller,
      promise: Promise.resolve(),
    }
    const promise = Promise.resolve()
      .then(() => operation(controller.signal))
      .finally(() => {
        if (state.operations.get(operationKey) === active) state.operations.delete(operationKey)
        this.#releaseWhenIdle(state)
      })
    active.promise = promise
    state.operations.set(operationKey, active)
    return promise
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const state of this.#senders.values()) {
      state.sender.removeListener("destroyed", state.destroyed)
      for (const operation of state.operations.values())
        operation.controller.abort(abortError("Plugin service IPC was disposed"))
      state.operations.clear()
    }
    this.#senders.clear()
  }

  #stateFor(sender: PluginServiceIpcSender) {
    const current = this.#senders.get(sender.id)
    if (current) return current
    const operations = new Map<string, ActiveOperation>()
    const state: SenderState = {
      operations,
      destroyed: () => {
        if (this.#senders.get(sender.id) === state) this.#senders.delete(sender.id)
        for (const operation of operations.values())
          operation.controller.abort(abortError("The service renderer closed"))
        operations.clear()
      },
      sender,
    }
    this.#senders.set(sender.id, state)
    sender.once("destroyed", state.destroyed)
    return state
  }

  #releaseWhenIdle(state: SenderState) {
    if (state.operations.size || this.#senders.get(state.sender.id) !== state) return
    state.sender.removeListener("destroyed", state.destroyed)
    this.#senders.delete(state.sender.id)
  }
}

export interface PluginServiceExecutor {
  authorize(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
  cancelAuthorization(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
  checkout(target: PluginServiceCheckoutTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
  getStatus(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
  getUsageHistory(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceUsageHistory>
  listServices(): Promise<readonly PluginServiceSummary[]>
  reauthorize(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
  signOut(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
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
    operation: (target: PluginServiceTarget, signal: AbortSignal) => Promise<Result>,
    behavior: "read" | "mutation" = "read",
  ) => {
    transport.handle(channel, async (event, input) => {
      if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
      if (disposed) throw new Error("Plugin service IPC is disposed")
      const target = parsePluginServiceTarget(input)
      const operationKey = `${channel}\0${pluginServiceTargetKey(target)}`
      const run = behavior === "read" ? operations.runShared.bind(operations) : operations.run.bind(operations)
      return run(event.sender, operationKey, async (signal) => {
        const result = await operation(target, signal)
        if (behavior === "mutation") transport.publishChange()
        return result
      })
    })
  }

  transport.handle(pluginServiceIpcChannels.listServices, (event) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Plugin service IPC is disposed")
    return executor.listServices()
  })
  register(pluginServiceIpcChannels.getStatus, (target, signal) => executor.getStatus(target, signal))
  register(pluginServiceIpcChannels.getUsageHistory, (target, signal) => executor.getUsageHistory(target, signal))
  register(pluginServiceIpcChannels.authorize, (target, signal) => executor.authorize(target, signal), "mutation")
  register(pluginServiceIpcChannels.reauthorize, (target, signal) => executor.reauthorize(target, signal), "mutation")
  register(
    pluginServiceIpcChannels.cancelAuthorization,
    (target, signal) => executor.cancelAuthorization(target, signal),
    "mutation",
  )
  transport.handle(pluginServiceIpcChannels.checkout, async (event, input) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Plugin service IPC is disposed")
    const target = parsePluginServiceCheckoutTarget(input)
    return operations.run(
      event.sender,
      `${pluginServiceIpcChannels.checkout}\0${pluginServiceTargetKey(target)}`,
      async (signal) => {
        const result = await executor.checkout(target, signal)
        transport.publishChange()
        return result
      },
    )
  })
  register(pluginServiceIpcChannels.signOut, (target, signal) => executor.signOut(target, signal), "mutation")

  return () => {
    if (disposed) return
    disposed = true
    operations.dispose()
    for (const channel of Object.values(pluginServiceIpcChannels)) {
      if (channel !== pluginServiceIpcChannels.changed) transport.removeHandler(channel)
    }
  }
}
