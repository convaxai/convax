import { afterEach, describe, expect, mock, test } from "bun:test"

import type { CanvasExternalMediaDragRequest } from "../canvas-external-drag-contracts"
import type {
  CanvasExternalMediaDragLease,
  CanvasExternalMediaDragTicketPort,
} from "./canvas-external-media-drag-service"

type InvokeHandler = (event: TestEvent, input?: unknown) => unknown
type EventHandler = (event: TestEvent, input?: unknown) => void

interface TestEvent {
  sender: TestSender
}

class TestSender {
  readonly starts: unknown[] = []
  readonly #listeners = new Map<string, Set<() => void>>()
  #destroyed = false

  constructor(
    readonly id: number,
    private readonly startError?: Error,
  ) {}

  once(event: string, listener: () => void) {
    const listeners = this.#listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(event, listeners)
  }

  removeListener(event: string, listener: () => void) {
    this.#listeners.get(event)?.delete(listener)
  }

  listenerCount(event: string) {
    return this.#listeners.get(event)?.size ?? 0
  }

  isDestroyed() {
    return this.#destroyed
  }

  startDrag(input: unknown) {
    if (this.startError) throw this.startError
    this.starts.push(input)
  }

  destroy() {
    this.#destroyed = true
    const listeners = [...(this.#listeners.get("destroyed") ?? [])]
    this.#listeners.delete("destroyed")
    listeners.forEach((listener) => listener())
  }
}

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, EventHandler>()
const removedHandlers: string[] = []
const removedListeners: string[] = []

void mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    on: (channel: string, listener: EventHandler) => listeners.set(channel, listener),
    removeHandler: (channel: string) => {
      removedHandlers.push(channel)
      handlers.delete(channel)
    },
    removeListener: (channel: string) => {
      removedListeners.push(channel)
      listeners.delete(channel)
    },
  },
}))

afterEach(() => {
  handlers.clear()
  listeners.clear()
  removedHandlers.splice(0)
  removedListeners.splice(0)
})

const selection: CanvasExternalMediaDragRequest = {
  expectedRevision: 7,
  nodeIds: ["image-1", "audio-1"],
  ref: { canvasId: "canvas-1", scopeId: "project-1" },
}

const prepareRequest = {
  ...selection,
  prepareId: "prepare_0123456789abcdef",
}

const ticket = {
  expiresAt: Date.now() + 60_000,
  itemCount: 2,
  ticket: "drag_00000000-0000-4000-8000-000000000001",
}

function active() {
  return {
    canvasId: selection.ref.canvasId,
    revision: selection.expectedRevision,
    scopeId: selection.ref.scopeId,
    selectedEdgeIds: [],
    selectedNodeIds: [...selection.nodeIds],
  }
}

function invoke(channel: string, input: unknown, sender: TestSender) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender }, input)
}

function send(channel: string, input: unknown, sender: TestSender) {
  const listener = listeners.get(channel)
  if (!listener) throw new Error(`Missing IPC listener: ${channel}`)
  listener({ sender }, input)
}

function abortable(signal?: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return reject(new Error("Missing AbortSignal"))
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

describe("Canvas external media drag IPC", () => {
  test("validates the live active selection and starts a synchronous sender-scoped native drag", async () => {
    const { canvasExternalMediaDragIpcChannels } = await import("../canvas-external-drag-contracts")
    const { registerCanvasExternalMediaDragIpc } = await import("./canvas-external-media-drag-ipc")
    const release = mock(() => {})
    const lease: CanvasExternalMediaDragLease = {
      file: "/host/staging/image.png",
      files: ["/host/staging/image.png", "/host/staging/audio.mp3"],
      icon: "material-preview",
      release,
    }
    const service: CanvasExternalMediaDragTicketPort = {
      cancel: mock(async () => {}),
      consume: mock((ownerId, value) => {
        if (ownerId !== 1 || value !== ticket.ticket) throw new Error("unavailable")
        return lease
      }),
      prepare: mock(async () => ticket),
    }
    const dispose = registerCanvasExternalMediaDragIpc(service, {
      isTrustedSender: (event) => event.sender.id === 1,
      resolveActiveCanvas: async () => active(),
    })
    const sender = new TestSender(1)

    await expect(
      Promise.resolve(invoke(canvasExternalMediaDragIpcChannels.prepare, prepareRequest, sender)),
    ).resolves.toEqual(ticket)
    expect(service.prepare).toHaveBeenCalledWith(1, selection, expect.any(AbortSignal))
    expect(sender.listenerCount("destroyed")).toBe(0)
    send(canvasExternalMediaDragIpcChannels.start, { ticket: ticket.ticket }, sender)
    expect(sender.starts).toEqual([{ file: lease.file, files: lease.files, icon: lease.icon }])
    expect(release).toHaveBeenCalledTimes(1)

    send(canvasExternalMediaDragIpcChannels.start, { ticket: ticket.ticket }, new TestSender(2))
    expect(service.consume).toHaveBeenCalledTimes(1)
    dispose()
  })

  test("releases a consumed lease and shows a guarded sanitized notification when native startDrag throws", async () => {
    const { canvasExternalMediaDragIpcChannels } = await import("../canvas-external-drag-contracts")
    const { registerCanvasExternalMediaDragIpc, showCanvasExternalMediaDragStartFailure } = await import(
      "./canvas-external-media-drag-ipc"
    )
    const release = mock(() => {})
    const service: CanvasExternalMediaDragTicketPort = {
      cancel: mock(async () => {}),
      consume: mock(() => ({
        file: "/host/staging/image.png",
        files: ["/host/staging/image.png"],
        icon: "material-preview",
        release,
      })),
      prepare: mock(async () => ticket),
    }
    const snapshot = {
      documentId: "canvas-1",
      revision: 7,
      scopeId: "project-1",
      selectedEdgeIds: [],
      selectedNodeIds: ["image-1"],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const renderer = {
      executeView: mock(
        async (_input: Parameters<import("./canvas-renderer-bridge").CanvasRendererBridge["executeView"]>[0]) => ({
          foundNodeIds: [],
          missingNodeIds: [],
          snapshot,
        }),
      ),
      getViewSnapshot: mock(async () => snapshot),
    }
    const reported: Promise<boolean>[] = []
    const nativeError = new Error("startDrag failed for /Users/private/secret.png")
    const dispose = registerCanvasExternalMediaDragIpc(service, {
      isTrustedSender: () => true,
      onStartError: (_error, context) => {
        expect(context).toEqual({ senderId: 1 })
        reported.push(showCanvasExternalMediaDragStartFailure(renderer))
      },
      resolveActiveCanvas: async () => active(),
    })

    send(canvasExternalMediaDragIpcChannels.start, { ticket: ticket.ticket }, new TestSender(1, nativeError))

    expect(release).toHaveBeenCalledTimes(1)
    expect(reported).toHaveLength(1)
    await expect(reported[0]).resolves.toBeTrue()
    expect(renderer.getViewSnapshot).toHaveBeenCalledWith("desktop-main")
    expect(renderer.executeView).toHaveBeenCalledWith({
      command: {
        description: "The system could not start the file drag. Release Command-Shift, then try again.",
        kind: "error",
        title: "Could not drag media out",
        type: "notification.show",
      },
      expectedDocumentId: snapshot.documentId,
      expectedRevision: snapshot.revision,
      expectedScopeId: snapshot.scopeId,
      viewId: snapshot.viewId,
    })
    expect(JSON.stringify(renderer.executeView.mock.calls)).not.toContain("/Users/private/secret.png")
    dispose()
  })

  test("aborts in-flight prepares immediately and isolates duplicate ids and cancellation by sender", async () => {
    const { canvasExternalMediaDragIpcChannels } = await import("../canvas-external-drag-contracts")
    const { registerCanvasExternalMediaDragIpc } = await import("./canvas-external-media-drag-ipc")
    const signals = new Map<number, AbortSignal>()
    let started!: () => void
    const bothStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const service: CanvasExternalMediaDragTicketPort = {
      cancel: mock(async () => {}),
      consume: mock(() => {
        throw new Error("not used")
      }),
      prepare: mock(async (ownerId, _request, signal) => {
        if (!signal) throw new Error("Missing AbortSignal")
        signals.set(ownerId, signal)
        if (signals.size === 2) started()
        return abortable(signal)
      }),
    }
    const dispose = registerCanvasExternalMediaDragIpc(service, {
      isTrustedSender: () => true,
      resolveActiveCanvas: async () => active(),
    })
    const first = new TestSender(1)
    const second = new TestSender(2)
    const firstPending = Promise.resolve(invoke(canvasExternalMediaDragIpcChannels.prepare, prepareRequest, first))
    const secondPending = Promise.resolve(invoke(canvasExternalMediaDragIpcChannels.prepare, prepareRequest, second))
    await bothStarted

    await expect(
      Promise.resolve(invoke(canvasExternalMediaDragIpcChannels.prepare, prepareRequest, first)),
    ).rejects.toThrow("already active")
    send(canvasExternalMediaDragIpcChannels.cancelPrepare, { prepareId: prepareRequest.prepareId }, second)
    await expect(secondPending).rejects.toMatchObject({ name: "AbortError" })
    expect(signals.get(1)?.aborted).toBeFalse()
    send(canvasExternalMediaDragIpcChannels.cancelPrepare, { prepareId: prepareRequest.prepareId }, first)
    await expect(firstPending).rejects.toMatchObject({ name: "AbortError" })
    expect(first.listenerCount("destroyed")).toBe(0)
    expect(second.listenerCount("destroyed")).toBe(0)
    dispose()
  })

  test("caps pending prepares per sender and aborts all of them when IPC is disposed", async () => {
    const { canvasExternalMediaDragIpcChannels } = await import("../canvas-external-drag-contracts")
    const { registerCanvasExternalMediaDragIpc } = await import("./canvas-external-media-drag-ipc")
    const service: CanvasExternalMediaDragTicketPort = {
      cancel: mock(async () => {}),
      consume: mock(() => {
        throw new Error("not used")
      }),
      prepare: mock(async (_ownerId, _request, signal) => abortable(signal)),
    }
    const dispose = registerCanvasExternalMediaDragIpc(service, {
      isTrustedSender: () => true,
      resolveActiveCanvas: async () => active(),
    })
    const sender = new TestSender(1)
    const pending = Array.from({ length: 8 }, (_, index) =>
      Promise.resolve(
        invoke(
          canvasExternalMediaDragIpcChannels.prepare,
          { ...prepareRequest, prepareId: `prepare_0123456789abcde${index}` },
          sender,
        ),
      ),
    )
    const outcomes = pending.map((promise) =>
      promise.then(
        () => null,
        (error: unknown) => error,
      ),
    )
    await expect(
      Promise.resolve(
        invoke(
          canvasExternalMediaDragIpcChannels.prepare,
          { ...prepareRequest, prepareId: "prepare_0123456789abcdef_extra" },
          sender,
        ),
      ),
    ).rejects.toThrow("Too many")

    dispose()
    for (const outcome of await Promise.all(outcomes)) {
      expect(outcome).toMatchObject({ name: "AbortError" })
    }
    expect(removedHandlers).toEqual([canvasExternalMediaDragIpcChannels.prepare])
    expect(removedListeners.sort()).toEqual(
      [
        canvasExternalMediaDragIpcChannels.cancel,
        canvasExternalMediaDragIpcChannels.cancelPrepare,
        canvasExternalMediaDragIpcChannels.start,
      ].sort(),
    )
  })
})
