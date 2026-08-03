import { describe, expect, mock, test } from "bun:test"
import { maximumPluginHostInFlightRequests } from "@convax/plugin-sdk/client"

import type { PluginCapabilityEvent, PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import {
  desktopPluginHostProtocolV8,
  pluginCapabilityProtocolV3,
  pluginCapabilitySuccess,
} from "../plugin-host-protocol"
import { RendererPluginHostConnection } from "./plugin-host-connection"

const connectInput = {
  activeRevision: 7,
  activeSetDigest: "a".repeat(64),
  canvasId: "canvas",
  nodeId: "node",
  pluginId: "one",
  pluginVersion: "1.0.0",
  projectId: "project",
  runtime: "web" as const,
  snapshotDigest: "b".repeat(64),
}

describe("RendererPluginHostConnection", () => {
  test("disconnects only the exact live frame, cancels its in-flight work, and ignores replay", async () => {
    const firstResult = deferred<Awaited<ReturnType<PluginCapabilityRendererClient["call"]>>>()
    const firstCall = mock(() => firstResult.promise)
    const firstCancel = mock(async () => true)
    const firstDisconnectResult = deferred<boolean>()
    const firstDisconnect = mock(() => firstDisconnectResult.promise)
    const secondCall = mock(async () => ({
      id: "other-frame",
      ok: true as const,
      protocol: pluginCapabilityProtocolV3,
      result: { frame: "second" },
      type: "response" as const,
    }))
    const secondDisconnect = mock(async () => true)
    const first = new RendererPluginHostConnection(
      rendererClient({ call: firstCall, cancel: firstCancel, disconnect: firstDisconnect }),
      connectInput,
      () => undefined,
    )
    const second = new RendererPluginHostConnection(
      rendererClient({ call: secondCall, disconnect: secondDisconnect }),
      { ...connectInput, nodeId: "node-b" },
      () => undefined,
    )
    const request = {
      id: "in-flight",
      method: "projects.list" as const,
      protocol: desktopPluginHostProtocolV8,
      type: "request" as const,
    }
    const pending = first.dispatch(request)
    await waitForCall(firstCall)

    const disconnect = {
      protocol: desktopPluginHostProtocolV8,
      type: "disconnect" as const,
    }
    const closing = first.dispatch(disconnect)
    await waitForCall(firstDisconnect)
    expect(firstDisconnect).toHaveBeenCalledTimes(1)
    expect(firstDisconnect).toHaveBeenCalledWith({ connectionId: "opaque-1" })
    expect(firstCancel).toHaveBeenCalledTimes(1)
    expect(secondDisconnect).not.toHaveBeenCalled()
    firstDisconnectResult.resolve(true)
    expect(await closing).toBeNull()

    firstResult.reject(new Error("Main observed exact-frame disconnect"))
    expect(await pending).toBeNull()
    await expect(second.dispatch({ ...request, id: "other-frame" })).resolves.toMatchObject({
      ok: true,
      result: { frame: "second" },
    })

    expect(await first.dispatch(disconnect)).toBeNull()
    expect(firstDisconnect).toHaveBeenCalledTimes(1)
    expect(
      await first.dispatch({
        ...request,
        id: "after-close",
      }),
    ).toMatchObject({
      error: { code: "transport-closed", kind: "protocol" },
      ok: false,
    })
    expect(secondDisconnect).not.toHaveBeenCalled()
    second.close()
  })

  test("fails closed for malformed or oversized disconnect-shaped envelopes", async () => {
    for (const envelope of [
      {
        frameId: "forbidden-routing-target",
        protocol: desktopPluginHostProtocolV8,
        type: "disconnect",
      },
      {
        payload: "x".repeat(512),
        protocol: desktopPluginHostProtocolV8,
        type: "disconnect",
      },
      {
        protocol: pluginCapabilityProtocolV3,
        type: "disconnect",
      },
    ]) {
      const disconnect = mock(async () => true)
      const call = mock(async () => null)
      const connection = new RendererPluginHostConnection(
        rendererClient({ call, disconnect }),
        connectInput,
        () => undefined,
      )
      expect(await connection.dispatch(envelope)).toBeNull()
      expect(disconnect).toHaveBeenCalledTimes(1)
      expect(call).not.toHaveBeenCalled()
      expect(await connection.dispatch(envelope)).toBeNull()
      expect(disconnect).toHaveBeenCalledTimes(1)
    }
  })

  test("translates host/8 calls and capability/3 responses and events", async () => {
    let listener: ((event: PluginCapabilityEvent) => void) | undefined
    const disconnect = mock(async () => true)
    const call = mock(async () => ({
      id: "request-1",
      ok: true as const,
      protocol: pluginCapabilityProtocolV3,
      result: { projects: [] },
      type: "response" as const,
    }))
    const client: PluginCapabilityRendererClient = {
      async cancel() {
        return true
      },
      call,
      async connect() {
        return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV3 }
      },
      disconnect,
      async getPluginAvailability() {
        return undefined
      },
      async invokePlugin(input) {
        return pluginCapabilitySuccess(input.request.requestId, undefined)
      },
      onEvent(next) {
        listener = next
        return () => {
          listener = undefined
        }
      },
    }
    const onCommand = mock(() => undefined)
    const connection = new RendererPluginHostConnection(client, connectInput, onCommand)
    const request = {
      id: "request-1",
      method: "projects.list",
      protocol: desktopPluginHostProtocolV8,
      type: "request",
    }

    expect(await connection.dispatch(request)).toEqual({
      id: "request-1",
      ok: true,
      protocol: desktopPluginHostProtocolV8,
      result: { projects: [] },
      type: "response",
    })
    expect(call).toHaveBeenCalledWith({
      connectionId: "opaque-1",
      operationId: expect.any(String),
      request: {
        ...request,
        protocol: pluginCapabilityProtocolV3,
      },
    })
    listener?.({
      command: {
        command: "canvas.document.changed",
        protocol: pluginCapabilityProtocolV3,
        type: "command",
      },
      connectionId: "other",
    })
    listener?.({
      command: {
        command: "canvas.document.changed",
        protocol: pluginCapabilityProtocolV3,
        type: "command",
      },
      connectionId: "opaque-1",
    })
    expect(onCommand).toHaveBeenCalledWith({
      command: "canvas.document.changed",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    })

    connection.close()
    expect(disconnect).toHaveBeenCalledWith({ connectionId: "opaque-1" })
  })

  test("fails closed for retired iframe and renderer-main protocols", async () => {
    const call = mock(async () => ({
      id: "request-1",
      ok: true as const,
      protocol: "convax.plugin-capability/2" as never,
      result: {},
      type: "response" as const,
    }))
    const cancel = mock(async () => true)
    const connection = new RendererPluginHostConnection(
      {
        cancel,
        call,
        async connect() {
          return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV3 }
        },
        async disconnect() {
          return true
        },
        async getPluginAvailability() {
          return undefined
        },
        async invokePlugin(input) {
          return pluginCapabilitySuccess(input.request.requestId, undefined)
        },
        onEvent() {
          return () => undefined
        },
      },
      connectInput,
      () => undefined,
    )

    await expect(
      connection.dispatch({
        id: "retired-host",
        method: "projects.list",
        protocol: "convax.plugin-host/7",
        type: "request",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "invalid-request",
        kind: "protocol",
        message: "Plugin Host request is invalid",
        recoverable: false,
      },
      ok: false,
      protocol: desktopPluginHostProtocolV8,
    })
    await expect(
      connection.dispatch({
        id: "retired-capability-response",
        method: "projects.list",
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "internal-error",
        kind: "protocol",
        message: "Plugin Host request failed",
        recoverable: false,
      },
      ok: false,
      protocol: desktopPluginHostProtocolV8,
    })
    await expect(
      connection.dispatch({
        id: "forged-capability-request",
        method: "projects.list",
        protocol: pluginCapabilityProtocolV3,
        type: "request",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "invalid-request",
        kind: "protocol",
        message: "Plugin Host request is invalid",
        recoverable: false,
      },
      ok: false,
      protocol: desktopPluginHostProtocolV8,
    })
    await expect(
      connection.dispatch({
        id: "forged-capability-cancel",
        protocol: pluginCapabilityProtocolV3,
        type: "cancel",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "invalid-request",
        kind: "protocol",
        message: "Plugin Host request is invalid",
        recoverable: false,
      },
      ok: false,
      protocol: desktopPluginHostProtocolV8,
    })
    expect(cancel).not.toHaveBeenCalled()
    connection.close()
  })

  test("rejects schema-oversized requests while admitting larger Catalog-specific image envelopes", async () => {
    const call = mock(async () => null)
    const connection = new RendererPluginHostConnection(
      {
        async cancel() {
          return true
        },
        call,
        async connect() {
          return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV3 }
        },
        async disconnect() {
          return true
        },
        async getPluginAvailability() {
          return undefined
        },
        async invokePlugin(input) {
          return pluginCapabilitySuccess(input.request.requestId, undefined)
        },
        onEvent() {
          return () => undefined
        },
      },
      connectInput,
      () => undefined,
    )

    await expect(
      connection.dispatch({
        id: "oversized",
        method: "canvas.nodes.query",
        params: { query: { text: "x".repeat(1024 * 1024) } },
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "invalid-request",
        kind: "protocol",
        message: "Plugin Host request is invalid",
        recoverable: false,
      },
      ok: false,
    })
    expect(call).not.toHaveBeenCalled()

    await expect(
      connection.dispatch({
        id: "state-over-field-limit",
        method: "canvas.node.state.replace",
        params: { state: { payload: "x".repeat(300 * 1024) } },
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid-request", kind: "protocol" },
      ok: false,
    })
    expect(call).not.toHaveBeenCalled()

    const hostileState: Record<string, unknown> = {}
    let cursor = hostileState
    for (let depth = 0; depth < 10_000; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }
    await expect(
      connection.dispatch({
        id: "hostile-depth",
        method: "canvas.node.state.replace",
        params: { state: hostileState },
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).resolves.toMatchObject({
      error: { code: "invalid-request", kind: "protocol" },
      ok: false,
    })
    expect(call).not.toHaveBeenCalled()

    await expect(
      connection.dispatch({
        id: "large-image",
        method: "canvas.resource.image.create",
        params: {
          dataUrl: `data:image/png;base64,${"x".repeat(1024 * 1024)}`,
          name: "large.png",
        },
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).resolves.toBeNull()
    expect(call).toHaveBeenCalledTimes(1)
    connection.close()
  })

  test("routes Plugin-to-Plugin invoke and availability through the independent broker ingress", async () => {
    const invokePlugin = mock(async (input: Parameters<PluginCapabilityRendererClient["invokePlugin"]>[0]) =>
      pluginCapabilitySuccess(input.request.requestId, { rendered: true }),
    )
    const getPluginAvailability = mock(async () => ({ status: "available" }))
    const connection = new RendererPluginHostConnection(
      {
        async cancel() {
          return true
        },
        async call() {
          throw new Error("Host API dispatcher must not receive P2P calls")
        },
        async connect() {
          return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV3 }
        },
        async disconnect() {
          return true
        },
        getPluginAvailability,
        invokePlugin,
        onEvent() {
          return () => undefined
        },
      },
      connectInput,
      () => undefined,
    )

    await expect(
      connection.dispatch({
        capabilityId: "video.render",
        id: "availability-1",
        protocol: desktopPluginHostProtocolV8,
        type: "capability-availability",
      }),
    ).resolves.toMatchObject({ ok: true, result: { status: "available" } })
    await expect(
      connection.dispatch({
        capabilityId: "video.render",
        id: "invoke-1",
        input: { prompt: "hello" },
        protocol: desktopPluginHostProtocolV8,
        type: "capability-invoke",
      }),
    ).resolves.toMatchObject({ ok: true, result: { rendered: true } })
    expect(getPluginAvailability).toHaveBeenCalledWith({
      capabilityId: "video.render",
      connectionId: "opaque-1",
      operationId: expect.any(String),
    })
    expect(invokePlugin).toHaveBeenCalledWith({
      connectionId: "opaque-1",
      operationId: expect.any(String),
      request: {
        capabilityId: "video.render",
        input: { prompt: "hello" },
        requestId: "invoke-1",
      },
    })
    connection.close()
  })

  test("preserves structured P2P failures across the renderer boundary", async () => {
    const connection = new RendererPluginHostConnection(
      rendererClient({
        async invokePlugin(input) {
          return {
            error: {
              code: "depth-exceeded",
              kind: "capability",
              message: "Plugin capability call depth was exceeded",
              recoverable: false,
            },
            id: input.request.requestId,
            ok: false,
            protocol: pluginCapabilityProtocolV3,
            type: "response",
          }
        },
      }),
      connectInput,
      () => undefined,
    )

    await expect(
      connection.dispatch({
        capabilityId: "video.render",
        id: "invoke-depth",
        input: {},
        protocol: desktopPluginHostProtocolV8,
        type: "capability-invoke",
      }),
    ).resolves.toEqual({
      error: {
        code: "depth-exceeded",
        kind: "capability",
        message: "Plugin capability call depth was exceeded",
        recoverable: false,
      },
      id: "invoke-depth",
      ok: false,
      protocol: desktopPluginHostProtocolV8,
      type: "response",
    })
    connection.close()
  })

  test("uses SDK cancel envelopes to abort Host API and P2P invoke on only the matching request", async () => {
    const host = deferred<Awaited<ReturnType<PluginCapabilityRendererClient["call"]>>>()
    const invoked = deferred<Awaited<ReturnType<PluginCapabilityRendererClient["invokePlugin"]>>>()
    const cancel = mock(async () => true)
    let hostOperationId = ""
    let invokeOperationId = ""
    const call = mock((input: Parameters<PluginCapabilityRendererClient["call"]>[0]) => {
      hostOperationId = input.operationId
      return host.promise
    })
    const invokePlugin = mock((input: Parameters<PluginCapabilityRendererClient["invokePlugin"]>[0]) => {
      invokeOperationId = input.operationId
      return invoked.promise
    })
    const connection = new RendererPluginHostConnection(
      rendererClient({ call, cancel, invokePlugin }),
      connectInput,
      () => undefined,
    )
    const hostRequest = {
      id: "host-cancel",
      method: "projects.list",
      protocol: desktopPluginHostProtocolV8,
      type: "request",
    }
    const pendingHost = connection.dispatch(hostRequest)
    await waitForCall(call)
    expect(
      await connection.dispatch({
        id: hostRequest.id,
        protocol: desktopPluginHostProtocolV8,
        type: "cancel",
      }),
    ).toBeNull()
    host.reject(new Error("Main observed cancellation"))
    expect(await pendingHost).toBeNull()
    expect(cancel).toHaveBeenCalledWith({
      connectionId: "opaque-1",
      operationId: hostOperationId,
    })

    const invokeRequest = {
      capabilityId: "video.render",
      id: "invoke-cancel",
      input: { prompt: "cancel me" },
      protocol: desktopPluginHostProtocolV8,
      type: "capability-invoke",
    }
    const pendingInvoke = connection.dispatch(invokeRequest)
    await waitForCall(invokePlugin)
    expect(
      await connection.dispatch({
        id: invokeRequest.id,
        protocol: desktopPluginHostProtocolV8,
        type: "cancel",
      }),
    ).toBeNull()
    invoked.reject(new Error("Broker observed cancellation"))
    expect(await pendingInvoke).toBeNull()
    expect(cancel).toHaveBeenCalledWith({
      connectionId: "opaque-1",
      operationId: invokeOperationId,
    })
    connection.close()
  })

  test("suppresses a late committed result and never lets a completed cancel target the replay ledger", async () => {
    const first = deferred<Awaited<ReturnType<PluginCapabilityRendererClient["call"]>>>()
    const operationIds: string[] = []
    const call = mock((input: Parameters<PluginCapabilityRendererClient["call"]>[0]) => {
      operationIds.push(input.operationId)
      return first.promise
    })
    const cancel = mock(async () => true)
    const connection = new RendererPluginHostConnection(rendererClient({ call, cancel }), connectInput, () => undefined)
    const request = {
      id: "late-commit",
      method: "projects.list",
      protocol: desktopPluginHostProtocolV8,
      type: "request",
    }
    const pending = connection.dispatch(request)
    await waitForCall(call)
    const operationId = operationIds[0]
    await connection.dispatch({ id: request.id, protocol: desktopPluginHostProtocolV8, type: "cancel" })
    first.resolve({
      id: request.id,
      ok: true,
      protocol: pluginCapabilityProtocolV3,
      result: { committed: true },
      type: "response",
    })
    expect(await pending).toBeNull()

    cancel.mockClear()
    expect(
      await connection.dispatch({
        id: request.id,
        protocol: desktopPluginHostProtocolV8,
        type: "cancel",
      }),
    ).toBeNull()
    expect(cancel).not.toHaveBeenCalled()

    call.mockImplementationOnce(async (input: Parameters<PluginCapabilityRendererClient["call"]>[0]) => {
      operationIds.push(input.operationId)
      return {
        id: request.id,
        ok: true,
        protocol: pluginCapabilityProtocolV3,
        result: { committed: true },
        type: "response",
      }
    })
    await expect(connection.dispatch(request)).resolves.toMatchObject({
      ok: true,
      result: { committed: true },
    })
    expect(operationIds[1]).toBe(operationId)
    connection.close()
  })

  test("keeps cancel sender-scoped and ignores cross-frame and unknown ids", async () => {
    const callAResult = deferred<Awaited<ReturnType<PluginCapabilityRendererClient["call"]>>>()
    const callA = mock(() => callAResult.promise)
    const cancelA = mock(async () => true)
    const cancelB = mock(async () => true)
    const frameA = new RendererPluginHostConnection(
      rendererClient({ call: callA, cancel: cancelA }),
      connectInput,
      () => undefined,
    )
    const frameB = new RendererPluginHostConnection(
      rendererClient({ cancel: cancelB }),
      { ...connectInput, nodeId: "node-b" },
      () => undefined,
    )
    const request = {
      id: "same-id",
      method: "projects.list",
      protocol: desktopPluginHostProtocolV8,
      type: "request",
    }
    const pending = frameA.dispatch(request)
    await waitForCall(callA)

    await frameB.dispatch({ id: request.id, protocol: desktopPluginHostProtocolV8, type: "cancel" })
    await frameA.dispatch({ id: "unknown", protocol: desktopPluginHostProtocolV8, type: "cancel" })
    expect(cancelA).not.toHaveBeenCalled()
    expect(cancelB).not.toHaveBeenCalled()

    await frameA.dispatch({ id: request.id, protocol: desktopPluginHostProtocolV8, type: "cancel" })
    callAResult.reject(new Error("canceled"))
    expect(await pending).toBeNull()
    expect(cancelA).toHaveBeenCalledTimes(1)
    expect(cancelB).not.toHaveBeenCalled()
    frameA.close()
    frameB.close()
  })

  test("bounds request controllers and rejects a duplicate concurrent id without replacing the owner", async () => {
    const results = Array.from({ length: maximumPluginHostInFlightRequests }, () =>
      deferred<Awaited<ReturnType<PluginCapabilityRendererClient["call"]>>>(),
    )
    let callIndex = 0
    const call = mock((_input: Parameters<PluginCapabilityRendererClient["call"]>[0]) => {
      const result = results[callIndex]
      callIndex += 1
      return result!.promise
    })
    const connection = new RendererPluginHostConnection(rendererClient({ call }), connectInput, () => undefined)
    const requests = Array.from({ length: maximumPluginHostInFlightRequests }, (_, index) => ({
      id: `bounded-${index}`,
      method: "projects.list" as const,
      protocol: desktopPluginHostProtocolV8,
      type: "request" as const,
    }))
    const pending = requests.map((request) => connection.dispatch(request))
    await waitForCallCount(call, maximumPluginHostInFlightRequests)

    await expect(connection.dispatch(requests[0])).resolves.toMatchObject({
      error: {
        code: "invalid-request",
        kind: "protocol",
        message: "Plugin Host request is invalid",
        recoverable: false,
      },
      ok: false,
    })
    await expect(
      connection.dispatch({
        ...requests[0],
        id: "bounded-overflow",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "overloaded",
        kind: "protocol",
        message: "Plugin Host transport is overloaded",
        recoverable: true,
      },
      ok: false,
    })
    expect(call).toHaveBeenCalledTimes(maximumPluginHostInFlightRequests)

    requests.forEach((request, index) => {
      results[index]!.resolve({
        id: request.id,
        ok: true,
        protocol: pluginCapabilityProtocolV3,
        result: {},
        type: "response",
      })
    })
    await expect(Promise.all(pending)).resolves.toHaveLength(maximumPluginHostInFlightRequests)
    connection.close()
  })
})

function rendererClient(overrides: Partial<PluginCapabilityRendererClient> = {}): PluginCapabilityRendererClient {
  return {
    async cancel() {
      return true
    },
    async call() {
      return null
    },
    async connect() {
      return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV3 }
    },
    async disconnect() {
      return true
    },
    async getPluginAvailability() {
      return undefined
    },
    async invokePlugin(input) {
      return pluginCapabilitySuccess(input.request.requestId, undefined)
    },
    onEvent() {
      return () => undefined
    },
    ...overrides,
  }
}

async function waitForCall(call: { mock: { calls: unknown[][] } }) {
  await waitForCallCount(call, 1)
}

async function waitForCallCount(call: { mock: { calls: unknown[][] } }, count: number) {
  for (let index = 0; index < 20 && call.mock.calls.length < count; index += 1) {
    await Promise.resolve()
  }
  expect(call.mock.calls).toHaveLength(count)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}
