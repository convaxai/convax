import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron"
import {
  pluginCanvasImageIpcChannels,
  type PluginCanvasImageCreateRequest,
  type PluginCanvasImageCreateResult,
} from "../plugin-canvas-image-contracts"

interface PluginCanvasImageExecutor {
  create(request: PluginCanvasImageCreateRequest, signal?: AbortSignal): Promise<PluginCanvasImageCreateResult>
}

interface SenderOperations {
  readonly controllers: Map<string, AbortController>
  readonly destroyed: () => void
  readonly sender: WebContents
}

const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is invalid`)
  return value as Record<string, unknown>
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new Error(`${label} is invalid`)
  }
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`)
  return value
}

function requireOperationId(value: unknown) {
  if (typeof value !== "string" || !operationIdPattern.test(value)) {
    throw new Error("Plugin Canvas image operation id is invalid")
  }
  return value
}

function requireCreateRequest(input: unknown): PluginCanvasImageCreateRequest {
  const value = requireRecord(input, "Plugin Canvas image request")
  requireExactKeys(
    value,
    ["dataUrl", "expectedRevision", "name", "operationId", "ownerNodeId", "pluginId", "pluginVersion", "ref"],
    "Plugin Canvas image request",
  )
  const ref = requireRecord(value.ref, "Plugin Canvas image reference")
  requireExactKeys(ref, ["canvasId", "scopeId"], "Plugin Canvas image reference")
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    throw new Error("Plugin Canvas image expected revision is invalid")
  }
  return {
    dataUrl: requireString(value.dataUrl, "Plugin Canvas image data"),
    expectedRevision: value.expectedRevision as number,
    name: requireString(value.name, "Plugin Canvas image name"),
    operationId: requireOperationId(value.operationId),
    ownerNodeId: requireString(value.ownerNodeId, "Plugin Canvas image owner node id"),
    pluginId: requireString(value.pluginId, "Plugin Canvas image Plugin id"),
    pluginVersion: requireString(value.pluginVersion, "Plugin Canvas image Plugin version"),
    ref: {
      canvasId: requireString(ref.canvasId, "Plugin Canvas image Canvas id"),
      scopeId: requireString(ref.scopeId, "Plugin Canvas image Project id"),
    },
  }
}

function requireCancellation(input: unknown) {
  const value = requireRecord(input, "Plugin Canvas image cancellation")
  requireExactKeys(value, ["operationId"], "Plugin Canvas image cancellation")
  return requireOperationId(value.operationId)
}

export function registerPluginCanvasImageIpc(
  service: PluginCanvasImageExecutor,
  options: { isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean },
) {
  const senders = new Map<number, SenderOperations>()
  let disposed = false

  const deleteSenderWhenIdle = (state: SenderOperations) => {
    if (state.controllers.size || senders.get(state.sender.id) !== state) return
    state.sender.removeListener("destroyed", state.destroyed)
    senders.delete(state.sender.id)
  }

  const stateFor = (sender: WebContents) => {
    const current = senders.get(sender.id)
    if (current) return current
    const controllers = new Map<string, AbortController>()
    const state = {
      controllers,
      destroyed: () => {
        if (senders.get(sender.id) === state) senders.delete(sender.id)
        for (const controller of controllers.values()) {
          controller.abort(abortError("The Plugin Canvas image renderer closed"))
        }
        controllers.clear()
      },
      sender,
    } satisfies SenderOperations
    senders.set(sender.id, state)
    sender.once("destroyed", state.destroyed)
    return state
  }

  const cancel = (event: IpcMainEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) return
    let operationId: string
    try {
      operationId = requireCancellation(input)
    } catch {
      return
    }
    senders
      .get(event.sender.id)
      ?.controllers.get(operationId)
      ?.abort(abortError("The Plugin Canvas image operation was canceled"))
  }

  ipcMain.on(pluginCanvasImageIpcChannels.cancel, cancel)
  ipcMain.handle(pluginCanvasImageIpcChannels.create, async (event, input: unknown) => {
    if (!options.isTrustedSender(event)) {
      throw new Error("Plugin Canvas image request came from an untrusted renderer")
    }
    if (disposed) throw new Error("Plugin Canvas image IPC is disposed")
    const request = requireCreateRequest(input)
    const state = stateFor(event.sender)
    if (state.controllers.has(request.operationId)) {
      throw new Error("Plugin Canvas image operation id is already active")
    }
    const controller = new AbortController()
    state.controllers.set(request.operationId, controller)
    try {
      return await service.create(request, controller.signal)
    } finally {
      if (state.controllers.get(request.operationId) === controller) {
        state.controllers.delete(request.operationId)
      }
      deleteSenderWhenIdle(state)
    }
  })

  return () => {
    if (disposed) return
    disposed = true
    ipcMain.removeListener(pluginCanvasImageIpcChannels.cancel, cancel)
    ipcMain.removeHandler(pluginCanvasImageIpcChannels.create)
    for (const state of senders.values()) {
      state.sender.removeListener("destroyed", state.destroyed)
      for (const controller of state.controllers.values()) {
        controller.abort(abortError("Plugin Canvas image IPC was disposed"))
      }
      state.controllers.clear()
    }
    senders.clear()
  }
}
