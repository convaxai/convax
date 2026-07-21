import { afterEach, describe, expect, mock, test } from "bun:test"
import type {
  CanvasRendererRequestEnvelope,
  CanvasRendererRequestResult,
  CanvasRendererResponseEnvelope,
} from "../canvas-renderer-contracts"

interface TestWebContents {
  id: number
  send(channel: string, envelope: CanvasRendererRequestEnvelope): void
}

interface TestWindow {
  isDestroyed(): boolean
  webContents: TestWebContents
}

type ResponseListener = (event: { sender: TestWebContents }, response: CanvasRendererResponseEnvelope) => void

const requestQueue: CanvasRendererRequestEnvelope[] = []
const requestWaiters: Array<(request: CanvasRendererRequestEnvelope) => void> = []
let responseListener: ResponseListener | null = null

const webContents: TestWebContents = {
  id: 41,
  send(_channel, envelope) {
    const waiter = requestWaiters.shift()
    if (waiter) waiter(envelope)
    else requestQueue.push(envelope)
  },
}

const window: TestWindow = {
  isDestroyed: () => false,
  webContents,
}

void mock.module("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [window],
  },
  ipcMain: {
    on: (_channel: string, listener: ResponseListener) => {
      responseListener = listener
    },
    removeListener: (_channel: string, listener: ResponseListener) => {
      if (responseListener === listener) responseListener = null
    },
  },
}))

afterEach(() => {
  requestQueue.splice(0)
  requestWaiters.splice(0)
  responseListener = null
})

function nextRequest() {
  const queued = requestQueue.shift()
  return queued
    ? Promise.resolve(queued)
    : new Promise<CanvasRendererRequestEnvelope>((resolve) => requestWaiters.push(resolve))
}

function respond(request: CanvasRendererRequestEnvelope, result: CanvasRendererRequestResult) {
  if (!responseListener) throw new Error("Canvas renderer response listener is unavailable")
  responseListener(
    { sender: webContents },
    {
      id: request.id,
      ok: true,
      result,
    },
  )
}

function rejectResponse(request: CanvasRendererRequestEnvelope, error: string) {
  if (!responseListener) throw new Error("Canvas renderer response listener is unavailable")
  responseListener({ sender: webContents }, { error, id: request.id, ok: false })
}

async function bridge(requestTimeoutMs?: number) {
  const { createCanvasRendererBridge } = await import("./canvas-renderer-bridge")
  return createCanvasRendererBridge({
    isTrustedSender: (event) => event.sender.id === webContents.id,
    isTrustedWebContentsId: (id) => id === webContents.id,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  })
}

const ref = { canvasId: "canvas-1", scopeId: "project-1" }

describe("Canvas renderer bridge document lease", () => {
  test("finishes a successful active mutation as committed", async () => {
    const renderer = await bridge()
    const mutate = mock(async () => "saved")
    const operation = renderer.runDocumentMutation(ref, mutate)
    const prepare = await nextRequest()
    expect(prepare.request).toMatchObject({ ref, type: "document.mutation.prepare" })
    if (prepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(prepare, {
      leaseId: prepare.request.leaseId,
      prepared: true,
      ref,
      type: prepare.request.type,
    })

    const finish = await nextRequest()
    expect(finish.request).toEqual({
      leaseId: prepare.request.leaseId,
      outcome: "committed",
      ref,
      type: "document.mutation.finish",
    })
    if (finish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(finish, {
      finished: true,
      leaseId: finish.request.leaseId,
      ref,
      type: finish.request.type,
    })

    await expect(operation).resolves.toBe("saved")
    expect(mutate).toHaveBeenCalledTimes(1)
    renderer.dispose()
  })

  test("finishes a failed active mutation as aborted and preserves its error", async () => {
    const renderer = await bridge()
    const operation = renderer.runDocumentMutation(ref, async () => {
      throw new Error("commit failed")
    })
    const prepare = await nextRequest()
    if (prepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(prepare, {
      leaseId: prepare.request.leaseId,
      prepared: true,
      ref,
      type: prepare.request.type,
    })
    const finish = await nextRequest()
    expect(finish.request).toMatchObject({ outcome: "aborted", type: "document.mutation.finish" })
    if (finish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(finish, { finished: true, leaseId: finish.request.leaseId, ref, type: finish.request.type })

    await expect(operation).rejects.toThrow("commit failed")
    renderer.dispose()
  })

  test("reads under the same serialized lease and always releases it as aborted", async () => {
    const renderer = await bridge()
    const read = renderer.runDocumentRead(ref, async () => "snapshot")
    const mutation = renderer.runDocumentMutation(ref, async () => "mutation")

    const readPrepare = await nextRequest()
    if (readPrepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(readPrepare, {
      leaseId: readPrepare.request.leaseId,
      prepared: true,
      ref,
      type: readPrepare.request.type,
    })
    const readFinish = await nextRequest()
    expect(readFinish.request).toMatchObject({ outcome: "aborted", type: "document.mutation.finish" })
    if (readFinish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(readFinish, {
      finished: true,
      leaseId: readFinish.request.leaseId,
      ref,
      type: readFinish.request.type,
    })
    await expect(read).resolves.toBe("snapshot")

    const mutationPrepare = await nextRequest()
    expect(mutationPrepare.request.type).toBe("document.mutation.prepare")
    if (mutationPrepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(mutationPrepare, {
      leaseId: mutationPrepare.request.leaseId,
      prepared: false,
      ref,
      type: mutationPrepare.request.type,
    })
    const mutationFinish = await nextRequest()
    if (mutationFinish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(mutationFinish, {
      finished: true,
      leaseId: mutationFinish.request.leaseId,
      ref,
      type: mutationFinish.request.type,
    })
    await expect(mutation).resolves.toBe("mutation")
    expect(requestQueue).toHaveLength(0)
    renderer.dispose()
  })

  test("finishes the reservation when the target Canvas is inactive and rejects mismatched lease results", async () => {
    const renderer = await bridge()
    const direct = renderer.runDocumentMutation(ref, async () => "direct")
    const inactivePrepare = await nextRequest()
    if (inactivePrepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(inactivePrepare, {
      leaseId: inactivePrepare.request.leaseId,
      prepared: false,
      ref,
      type: inactivePrepare.request.type,
    })
    const inactiveFinish = await nextRequest()
    expect(inactiveFinish.request).toMatchObject({ outcome: "committed", type: "document.mutation.finish" })
    if (inactiveFinish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(inactiveFinish, {
      finished: true,
      leaseId: inactiveFinish.request.leaseId,
      ref,
      type: inactiveFinish.request.type,
    })
    await expect(direct).resolves.toBe("direct")

    const rejected = renderer.runDocumentRead(ref, async () => "unreachable")
    const mismatchedPrepare = await nextRequest()
    if (mismatchedPrepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(mismatchedPrepare, {
      leaseId: "different-lease",
      prepared: true,
      ref,
      type: mismatchedPrepare.request.type,
    })
    await expect(rejected).rejects.toThrow("mismatched document mutation lease")
    renderer.dispose()
  })

  test("cancels a renderer preparation that outlives the Main request timeout", async () => {
    const renderer = await bridge(5)
    const operation = renderer.runDocumentMutation(ref, async () => "unreachable")
    const prepare = await nextRequest()
    expect(prepare.request.type).toBe("document.mutation.prepare")

    await expect(operation).rejects.toThrow("did not answer")
    const cancel = await nextRequest()
    expect(cancel.request).toMatchObject({
      leaseId: prepare.request.type === "document.mutation.prepare" ? prepare.request.leaseId : undefined,
      ref,
      type: "document.mutation.cancel",
    })
    renderer.dispose()
  })

  test("does not start a queued document operation after caller cancellation", async () => {
    const renderer = await bridge()
    const first = renderer.runDocumentRead(ref, async () => "first")
    const firstPrepare = await nextRequest()
    if (firstPrepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")

    const controller = new AbortController()
    let queuedCalls = 0
    const queued = renderer.runDocumentMutation(
      ref,
      async () => {
        queuedCalls += 1
        return "unreachable"
      },
      controller.signal,
    )
    controller.abort(new DOMException("Agent stopped", "AbortError"))
    await expect(queued).rejects.toThrow("Agent stopped")

    respond(firstPrepare, {
      leaseId: firstPrepare.request.leaseId,
      prepared: true,
      ref,
      type: firstPrepare.request.type,
    })
    const firstFinish = await nextRequest()
    if (firstFinish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(firstFinish, {
      finished: true,
      leaseId: firstFinish.request.leaseId,
      ref,
      type: firstFinish.request.type,
    })

    await expect(first).resolves.toBe("first")
    await Promise.resolve()
    expect(queuedCalls).toBe(0)
    expect(requestQueue).toHaveLength(0)
    renderer.dispose()
  })

  test("releases a prepared lease when cancellation wins during renderer preparation", async () => {
    const renderer = await bridge()
    const controller = new AbortController()
    let mutationCalls = 0
    const operation = renderer.runDocumentMutation(
      ref,
      async () => {
        mutationCalls += 1
        return "unreachable"
      },
      controller.signal,
    )
    const prepare = await nextRequest()
    if (prepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")

    controller.abort(new DOMException("Agent stopped", "AbortError"))
    await expect(operation).rejects.toThrow("Agent stopped")
    const cancel = await nextRequest()
    expect(cancel.request).toMatchObject({
      leaseId: prepare.request.leaseId,
      ref,
      type: "document.mutation.cancel",
    })
    expect(mutationCalls).toBe(0)
    renderer.dispose()
  })

  test("keeps an operation authoritative when cancellation arrives after its durable boundary", async () => {
    const renderer = await bridge()
    const controller = new AbortController()
    let resolveCommit!: (value: string) => void
    const committed = new Promise<string>((resolve) => {
      resolveCommit = resolve
    })
    const operation = renderer.runDocumentMutation(ref, () => committed, controller.signal)
    const prepare = await nextRequest()
    if (prepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(prepare, { leaseId: prepare.request.leaseId, prepared: true, ref, type: prepare.request.type })
    await Promise.resolve()

    controller.abort(new DOMException("Agent stopped", "AbortError"))
    resolveCommit("committed")
    const finish = await nextRequest()
    expect(finish.request).toMatchObject({ outcome: "committed", type: "document.mutation.finish" })
    if (finish.request.type !== "document.mutation.finish") throw new Error("Unexpected request")
    respond(finish, { finished: true, leaseId: finish.request.leaseId, ref, type: finish.request.type })

    await expect(operation).resolves.toBe("committed")
    renderer.dispose()
  })

  test("keeps a durable mutation successful when renderer reconciliation fails", async () => {
    const renderer = await bridge()
    const operation = renderer.runDocumentMutation(ref, async () => "committed")
    const prepare = await nextRequest()
    if (prepare.request.type !== "document.mutation.prepare") throw new Error("Unexpected request")
    respond(prepare, { leaseId: prepare.request.leaseId, prepared: true, ref, type: prepare.request.type })
    const finish = await nextRequest()
    rejectResponse(finish, "reload failed")

    await expect(operation).resolves.toBe("committed")
    renderer.dispose()
  })
})
