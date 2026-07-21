import { requireWebPluginId } from "../plugin-contracts"

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
      for (const controller of state.controllers.values()) controller.abort(abortError("Plugin service IPC was disposed"))
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
