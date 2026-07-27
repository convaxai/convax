import { afterEach, describe, expect, mock, test } from "bun:test"

import type {
  PluginCanvasImageCreateRequest,
  PluginCanvasImageCreateResult,
} from "../plugin-canvas-image-contracts"

type InvokeHandler = (event: TestEvent, input?: unknown) => unknown
type EventHandler = (event: TestEvent, input?: unknown) => void

interface TestEvent {
  sender: TestSender
}

class TestSender {
  readonly #listeners = new Map<string, Set<() => void>>()

  constructor(readonly id: number) {}

  once(event: string, listener: () => void) {
    const listeners = this.#listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(event, listeners)
  }

  removeListener(event: string, listener: () => void) {
    this.#listeners.get(event)?.delete(listener)
  }

  destroy() {
    const listeners = [...(this.#listeners.get("destroyed") ?? [])]
    this.#listeners.delete("destroyed")
    listeners.forEach((listener) => listener())
  }
}

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, EventHandler>()

void mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    on: (channel: string, listener: EventHandler) => listeners.set(channel, listener),
    removeHandler: (channel: string) => handlers.delete(channel),
    removeListener: (channel: string) => listeners.delete(channel),
  },
}))

afterEach(() => {
  handlers.clear()
  listeners.clear()
})

const request: PluginCanvasImageCreateRequest = {
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  expectedRevision: 4,
  name: "current-frame.png",
  operationId: "frame-1",
  ownerNodeId: "example-stage-node",
  pluginId: "example-stage-plugin",
  pluginVersion: "1.0.0",
  ref: { canvasId: "canvas-1", scopeId: "project-1" },
}
const result: PluginCanvasImageCreateResult = { createdNodeId: "frame-node", revision: 5 }

function invoke(channel: string, input: unknown, sender = new TestSender(1)) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender }, input)
}

function send(channel: string, input: unknown, sender = new TestSender(1)) {
  const listener = listeners.get(channel)
  if (!listener) throw new Error(`Missing IPC listener: ${channel}`)
  listener({ sender }, input)
}

function rejectWhenAborted(signal?: AbortSignal) {
  return new Promise<PluginCanvasImageCreateResult>((_resolve, reject) => {
    if (!signal) return reject(new Error("Missing AbortSignal"))
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

describe("Plugin Canvas image IPC", () => {
  test("accepts only an exact trusted image request", async () => {
    const { pluginCanvasImageIpcChannels } = await import("../plugin-canvas-image-contracts")
    const { registerPluginCanvasImageIpc } = await import("./plugin-canvas-image-ipc")
    const create = mock(async () => result)
    const dispose = registerPluginCanvasImageIpc({ create }, { isTrustedSender: (event) => event.sender.id === 1 })

    await expect(Promise.resolve(invoke(pluginCanvasImageIpcChannels.create, request))).resolves.toEqual(result)
    expect(create).toHaveBeenCalledWith(request, expect.any(AbortSignal))
    await expect(
      Promise.resolve().then(() =>
        invoke(pluginCanvasImageIpcChannels.create, { ...request, nativePath: "/tmp/frame.png" }),
      ),
    ).rejects.toThrow("request is invalid")
    await expect(
      Promise.resolve().then(() => invoke(pluginCanvasImageIpcChannels.create, request, new TestSender(2))),
    ).rejects.toThrow("untrusted renderer")
    expect(create).toHaveBeenCalledTimes(1)

    dispose()
  })

  test("forwards cancellation and renderer destruction to sender-scoped operations", async () => {
    const { pluginCanvasImageIpcChannels } = await import("../plugin-canvas-image-contracts")
    const { registerPluginCanvasImageIpc } = await import("./plugin-canvas-image-ipc")
    const dispose = registerPluginCanvasImageIpc(
      { create: (_request, signal) => rejectWhenAborted(signal) },
      { isTrustedSender: () => true },
    )
    const cancelSender = new TestSender(1)
    const canceled = Promise.resolve(invoke(pluginCanvasImageIpcChannels.create, request, cancelSender))
    send(pluginCanvasImageIpcChannels.cancel, { operationId: request.operationId }, cancelSender)
    await expect(canceled).rejects.toThrow("was canceled")

    const destroyedSender = new TestSender(2)
    const destroyed = Promise.resolve(
      invoke(pluginCanvasImageIpcChannels.create, { ...request, operationId: "frame-2" }, destroyedSender),
    )
    destroyedSender.destroy()
    await expect(destroyed).rejects.toThrow("renderer closed")

    dispose()
  })

  test("keeps active operation ids and cancellation isolated to one sender", async () => {
    const { pluginCanvasImageIpcChannels } = await import("../plugin-canvas-image-contracts")
    const { registerPluginCanvasImageIpc } = await import("./plugin-canvas-image-ipc")
    const signals: AbortSignal[] = []
    const dispose = registerPluginCanvasImageIpc(
      {
        create: (_request, signal) => {
          if (!signal) throw new Error("Missing AbortSignal")
          signals.push(signal)
          return rejectWhenAborted(signal)
        },
      },
      { isTrustedSender: () => true },
    )
    const firstSender = new TestSender(1)
    const otherSender = new TestSender(2)
    const first = Promise.resolve(invoke(pluginCanvasImageIpcChannels.create, request, firstSender))
    expect(signals).toHaveLength(1)

    await expect(
      Promise.resolve(invoke(pluginCanvasImageIpcChannels.create, request, firstSender)),
    ).rejects.toThrow("already active")

    const other = Promise.resolve(invoke(pluginCanvasImageIpcChannels.create, request, otherSender))
    expect(signals).toHaveLength(2)
    send(pluginCanvasImageIpcChannels.cancel, { operationId: request.operationId }, otherSender)
    expect(signals[0]?.aborted).toBeFalse()
    expect(signals[1]?.aborted).toBeTrue()
    send(pluginCanvasImageIpcChannels.cancel, { operationId: request.operationId }, firstSender)

    const [firstResult, otherResult] = await Promise.allSettled([first, other])
    expect(firstResult).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("was canceled") }),
      status: "rejected",
    })
    expect(otherResult).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("was canceled") }),
      status: "rejected",
    })
    dispose()
  })
})
