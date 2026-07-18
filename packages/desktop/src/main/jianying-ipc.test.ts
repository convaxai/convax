import { afterEach, expect, mock, test } from "bun:test"

import type { JianyingCanvasExportRequest, JianyingClient } from "../jianying-contracts"

type InvokeHandler = (event: TestEvent, input?: unknown) => unknown
type EventHandler = (event: TestEvent, input?: unknown) => void

interface TestSender {
  id: number
  once(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
}

interface TestEvent {
  sender: TestSender
}

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, EventHandler>()
const removedHandlers: string[] = []
const removedListeners: string[] = []

function sender(id: number): TestSender {
  const events = new Map<string, Set<() => void>>()
  return {
    id,
    once(event, listener) {
      const current = events.get(event) ?? new Set()
      current.add(listener)
      events.set(event, current)
    },
    removeListener(event, listener) {
      events.get(event)?.delete(listener)
    },
  }
}

mock.module("electron", () => ({
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

const request: JianyingCanvasExportRequest = {
  expectedRevision: 4,
  nodeIds: ["image-1"],
  ref: { canvasId: "canvas-1", scopeId: "project-1" },
  target: { kind: "current-or-new" },
}

function invoke(channel: string, input: unknown, source = sender(1)) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender: source }, input)
}

function send(channel: string, input: unknown, source = sender(1)) {
  const listener = listeners.get(channel)
  if (!listener) throw new Error(`Missing IPC listener: ${channel}`)
  listener({ sender: source }, input)
}

test("binds cancellation and active Canvas scope to the originating renderer", async () => {
  const { jianyingIpcChannels, registerJianyingIpc } = await import("./jianying-ipc")
  const client: JianyingClient = {
    exportCanvasMedia: mock(
      async (_input, signal) =>
        new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
        }),
    ),
    getDraftStatus: mock(async () => ({ status: "active" as const })),
  }
  const dispose = registerJianyingIpc(client, {
    isTrustedSender: (event) => event.sender.id === 1,
    resolveActiveCanvas: async () => ({ canvasId: "canvas-1", revision: 4, scopeId: "project-1" }),
  })
  const owner = sender(1)
  send(jianyingIpcChannels.cancelCanvasMediaExport, { operationId: "canceled-before-start" }, owner)
  await expect(
    Promise.resolve(
      invoke(
        jianyingIpcChannels.exportCanvasMedia,
        {
          operationId: "canceled-before-start",
          request,
        },
        owner,
      ),
    ),
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(client.exportCanvasMedia).not.toHaveBeenCalled()

  const pending = Promise.resolve(
    invoke(
      jianyingIpcChannels.exportCanvasMedia,
      {
        operationId: "operation-1",
        request,
      },
      owner,
    ),
  )
  await Promise.resolve()
  send(jianyingIpcChannels.cancelCanvasMediaExport, { operationId: "operation-1" }, sender(2))
  expect(client.exportCanvasMedia).toHaveBeenCalledTimes(1)
  send(jianyingIpcChannels.cancelCanvasMediaExport, { operationId: "operation-1" }, owner)
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })

  await expect(
    Promise.resolve(
      invoke(
        jianyingIpcChannels.exportCanvasMedia,
        {
          operationId: "stale",
          request: { ...request, expectedRevision: 3 },
        },
        owner,
      ),
    ),
  ).rejects.toThrow("live active Canvas")
  expect(client.exportCanvasMedia).toHaveBeenCalledTimes(1)

  dispose()
  expect(removedHandlers.sort()).toEqual(
    [jianyingIpcChannels.exportCanvasMedia, jianyingIpcChannels.getDraftStatus].sort(),
  )
  expect(removedListeners).toEqual([jianyingIpcChannels.cancelCanvasMediaExport])
})

test("rejects an untrusted renderer before registering an operation", async () => {
  const { jianyingIpcChannels, registerJianyingIpc } = await import("./jianying-ipc")
  const client: JianyingClient = {
    exportCanvasMedia: mock(async () => ({
      createdDraft: false,
      draftName: "Current",
      importedMediaCount: 1,
      importStatus: "dispatched" as const,
    })),
    getDraftStatus: mock(async () => ({ status: "active" as const })),
  }
  const dispose = registerJianyingIpc(client, {
    isTrustedSender: (event) => event.sender.id === 1,
    resolveActiveCanvas: async () => ({ canvasId: "canvas-1", revision: 4, scopeId: "project-1" }),
  })

  await expect(
    Promise.resolve().then(() =>
      invoke(
        jianyingIpcChannels.exportCanvasMedia,
        {
          operationId: "foreign",
          request,
        },
        sender(2),
      ),
    ),
  ).rejects.toThrow("untrusted renderer")
  expect(client.exportCanvasMedia).not.toHaveBeenCalled()
  await expect(
    Promise.resolve().then(() => invoke(jianyingIpcChannels.getDraftStatus, undefined, sender(2))),
  ).rejects.toThrow("untrusted renderer")
  dispose()
})
