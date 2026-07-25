import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type {
  CanvasRendererRequestEnvelope,
  CanvasRendererRequestResult,
  CanvasRendererResponseEnvelope,
} from "../canvas-renderer-contracts"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"

interface TestWebContents {
  id: number
  isDestroyed(): boolean
  send(channel: string, envelope: CanvasRendererRequestEnvelope): void
}

type ResponseListener = (event: { sender: TestWebContents }, response: CanvasRendererResponseEnvelope) => void

const requestQueue: CanvasRendererRequestEnvelope[] = []
const secondaryRequestQueue: CanvasRendererRequestEnvelope[] = []
const requestWaiters: Array<(request: CanvasRendererRequestEnvelope) => void> = []
let responseListener: ResponseListener | null = null

const webContents: TestWebContents = {
  id: 41,
  isDestroyed: () => false,
  send(_channel, envelope) {
    const waiter = requestWaiters.shift()
    if (waiter) waiter(envelope)
    else requestQueue.push(envelope)
  },
}

const secondaryWebContents: TestWebContents = {
  id: 42,
  isDestroyed: () => false,
  send(_channel, envelope) {
    secondaryRequestQueue.push(envelope)
  },
}

const window = {
  isDestroyed: () => false,
  webContents,
}

const secondaryWindow = {
  isDestroyed: () => false,
  webContents: secondaryWebContents,
}

beforeEach(() => {
  configureElectronMock({
    BrowserWindow: { getAllWindows: () => [window, secondaryWindow] },
    ipcMain: {
      on: (_channel: string, listener: ResponseListener) => {
        responseListener = listener
      },
      removeListener: (_channel: string, listener: ResponseListener) => {
        if (responseListener === listener) responseListener = null
      },
    },
  })
})

afterEach(() => {
  requestQueue.splice(0)
  secondaryRequestQueue.splice(0)
  requestWaiters.splice(0)
  responseListener = null
  resetElectronMock()
})

function nextRequest() {
  const queued = requestQueue.shift()
  return queued
    ? Promise.resolve(queued)
    : new Promise<CanvasRendererRequestEnvelope>((resolve) => requestWaiters.push(resolve))
}

function respond(request: CanvasRendererRequestEnvelope, result: CanvasRendererRequestResult) {
  if (!responseListener) throw new Error("Canvas renderer response listener is unavailable")
  responseListener({ sender: webContents }, { id: request.id, ok: true, result })
}

async function bridge(requestTimeoutMs?: number) {
  const { createCanvasRendererBridge } = await import("./canvas-renderer-bridge")
  return createCanvasRendererBridge({
    isTrustedSender: (event) => event.sender.id === webContents.id || event.sender.id === secondaryWebContents.id,
    isTrustedWebContentsId: (id) => id === webContents.id || id === secondaryWebContents.id,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  })
}

const ref = { canvasId: "canvas-1", scopeId: "project-1" }

describe("Canvas renderer projection bridge", () => {
  test("requests an authoritative reload without coordinating a document mutation", async () => {
    const renderer = await bridge()
    const operation = renderer.reloadDocument(ref)
    const request = await nextRequest()
    expect(request.request).toEqual({ ref, type: "document.reload" })
    respond(request, { reloaded: true, type: "document.reload" })

    await expect(operation).resolves.toBeTrue()
    renderer.dispose()
  })

  test("forwards view snapshots and commands", async () => {
    const renderer = await bridge()
    const snapshotOperation = renderer.getViewSnapshot("desktop-main")
    const snapshotRequest = await nextRequest()
    respond(snapshotRequest, { snapshot: null, type: "view.snapshot" })
    await expect(snapshotOperation).resolves.toBeNull()

    const viewOperation = renderer.executeView({
      command: { type: "selection.clear" },
      expectedDocumentId: "canvas-1",
      expectedRevision: 1,
      expectedScopeId: "project-1",
      viewId: "desktop-main",
    })
    const viewRequest = await nextRequest()
    respond(viewRequest, {
      result: {
        foundNodeIds: [],
        missingNodeIds: [],
        snapshot: {
          documentId: "canvas-1",
          revision: 1,
          scopeId: "project-1",
          selectedEdgeIds: [],
          selectedNodeIds: [],
          viewId: "desktop-main",
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      type: "view.execute",
    })
    await expect(viewOperation).resolves.toMatchObject({ foundNodeIds: [] })
    renderer.dispose()
  })

  test("fails a projection request that times out", async () => {
    const renderer = await bridge(1)
    await expect(renderer.reloadDocument(ref)).rejects.toThrow("did not answer")
    renderer.dispose()
  })

  test("requests the Workbench snapshot from the exact invoking renderer id", async () => {
    const renderer = await bridge()
    const pending = renderer.getViewSnapshot("desktop-main", secondaryWebContents.id)
    await Promise.resolve()

    expect(requestQueue).toHaveLength(0)
    expect(secondaryRequestQueue).toHaveLength(1)
    const request = secondaryRequestQueue.shift()!
    if (!responseListener) throw new Error("Canvas renderer response listener is unavailable")
    responseListener(
      { sender: secondaryWebContents },
      {
        id: request.id,
        ok: true,
        result: {
          snapshot: {
            documentId: "canvas-second",
            revision: 4,
            scopeId: "project-second",
            selectedEdgeIds: [],
            selectedNodeIds: [],
            viewId: "desktop-main",
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          type: "view.snapshot",
        },
      },
    )

    await expect(pending).resolves.toMatchObject({ documentId: "canvas-second", scopeId: "project-second" })
    renderer.dispose()
  })
})
