import { describe, expect, mock, test } from "bun:test"

import type {
  PluginCanvasCapabilityClient,
  PluginCanvasChangeEvent,
  PluginCanvasEventSubscription,
} from "./plugin-capability-contracts"
import { PluginCapabilityConnection } from "./plugin-capability-dispatch"
import { pluginCapabilityProtocolV1 } from "./plugin-host-protocol"

function request(method: string, params?: unknown) {
  return {
    id: `request-${method}`,
    method,
    ...(params === undefined ? {} : { params }),
    protocol: pluginCapabilityProtocolV1,
    type: "request",
  }
}

function fixture(documentTitle = "Main") {
  let listener: ((event: PluginCanvasChangeEvent) => void) | undefined
  const close = mock(() => undefined)
  const transact = mock(async () => ({
    affectedNodeIds: ["one"],
    changed: true,
    createdNodeIds: [],
    ref: { canvasId: "main", projectId: "project-one" },
    revision: 2,
    storageVersion: "v2",
    warnings: [],
  }))
  const client: PluginCanvasCapabilityClient = {
    async getDocument(ref, _projection = "geometry") {
      return {
        document: { edges: [], id: ref.canvasId, nodes: [], revision: 1, title: documentTitle },
        projection: "geometry",
        ref,
        storageVersion: "v1",
      }
    },
    async listCanvases(projectId) {
      return { canvases: [], projectId }
    },
    async listProjects() {
      return [{ available: true, id: "project-one", name: "One" }]
    },
    async queryNodes(ref) {
      return { nodes: [], ref, revision: 1, storageVersion: "v1" }
    },
    async subscribe(_ref, next): Promise<PluginCanvasEventSubscription> {
      listener = next
      return { close }
    },
    transact,
  }
  const send = mock(() => undefined)
  const connection = new PluginCapabilityConnection(client, { send }, () => "subscription-1")
  return { client, close, connection, emit: (event: PluginCanvasChangeEvent) => listener?.(event), send, transact }
}

describe("PluginCapabilityConnection", () => {
  test("dispatches only the transport-neutral capability protocol", async () => {
    const { connection } = fixture()
    expect(await connection.dispatch(request("projects.list"))).toEqual({
      id: "request-projects.list",
      ok: true,
      protocol: pluginCapabilityProtocolV1,
      result: { projects: [{ available: true, id: "project-one", name: "One" }] },
      type: "response",
    })
    expect(await connection.dispatch(request("canvas.node.get"))).toMatchObject({
      error: expect.stringContaining("unavailable on this connection"),
      ok: false,
    })
  })

  test("validates and forwards resource-free transactions", async () => {
    const { connection, transact } = fixture()
    const ref = { canvasId: "main", projectId: "project-one" }
    const response = await connection.dispatch(
      request("canvas.transaction.execute", {
        commands: [{ type: "nodes.setGeometry", updates: [{ nodeId: "one", position: { x: 1, y: 2 } }] }],
        expectedRevision: 1,
        ref,
        transactionId: "transaction-1",
      }),
    )
    expect(response).toMatchObject({ ok: true, result: { revision: 2 } })
    expect(transact).toHaveBeenCalledWith({
      commands: [{ type: "nodes.setGeometry", updates: [{ nodeId: "one", position: { x: 1, y: 2 } }] }],
      expectedRevision: 1,
      ref,
      transactionId: "transaction-1",
    })

    expect(
      await connection.dispatch(
        request("canvas.transaction.execute", {
          commands: [{ type: "resources.add" }],
          expectedRevision: 1,
          ref,
          transactionId: "forged",
        }),
      ),
    ).toMatchObject({ error: expect.stringContaining("not supported"), ok: false })
  })

  test("forwards an optional transport cancellation signal and rejects before client work when already canceled", async () => {
    const active = fixture()
    const activeController = new AbortController()
    const params = {
      commands: [{ type: "nodes.move", delta: { x: 1, y: 2 }, nodeIds: ["one"] }],
      expectedRevision: 1,
      ref: { canvasId: "main", projectId: "project-one" },
      transactionId: "transaction-with-signal",
    }

    expect(
      await active.connection.dispatch(request("canvas.transaction.execute", params), activeController.signal),
    ).toMatchObject({ ok: true })
    expect(active.transact).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "transaction-with-signal",
      }),
      activeController.signal,
    )

    const canceled = fixture()
    const canceledController = new AbortController()
    canceledController.abort("stopped")
    expect(
      await canceled.connection.dispatch(request("canvas.transaction.execute", params), canceledController.signal),
    ).toMatchObject({ error: expect.stringContaining("canceled"), ok: false })
    expect(canceled.transact).not.toHaveBeenCalled()
  })

  test("returns an authoritative transaction result when cancellation races after commit", async () => {
    const active = fixture()
    let resolveCommit!: (value: Awaited<ReturnType<PluginCanvasCapabilityClient["transact"]>>) => void
    active.client.transact = async () =>
      new Promise((resolve) => {
        resolveCommit = resolve
      })
    const controller = new AbortController()
    const ref = { canvasId: "main", projectId: "project-one" }
    const result = active.connection.dispatch(
      request("canvas.transaction.execute", {
        commands: [{ type: "nodes.move", delta: { x: 1, y: 2 }, nodeIds: ["one"] }],
        expectedRevision: 1,
        ref,
        transactionId: "commit-wins-cancel",
      }),
      controller.signal,
    )
    await Promise.resolve()
    controller.abort("stopped")
    resolveCommit({
      affectedNodeIds: ["one"],
      changed: true,
      createdNodeIds: [],
      ref,
      revision: 2,
      storageVersion: "v2",
      warnings: [],
    })

    await expect(result).resolves.toMatchObject({ ok: true, result: { revision: 2 } })
  })

  test("compacts an oversized committed transaction result instead of reporting failure", async () => {
    const active = fixture()
    active.client.transact = async (transaction) => ({
      affectedNodeIds: ["one"],
      changed: true,
      createdNodeIds: [],
      ref: transaction.ref,
      revision: 2,
      storageVersion: "v2",
      warnings: ["x".repeat(9 * 1024 * 1024)],
    })

    await expect(
      active.connection.dispatch(
        request("canvas.transaction.execute", {
          commands: [{ type: "nodes.move", delta: { x: 1, y: 2 }, nodeIds: ["one"] }],
          expectedRevision: 1,
          ref: { canvasId: "main", projectId: "project-one" },
          transactionId: "oversized-commit-summary",
        }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        affectedNodeIds: [],
        createdNodeIds: [],
        revision: 2,
        summaryTruncated: true,
        warnings: [],
      },
    })
  })

  test("keeps requests at 1 MiB while allowing bounded large document projections", async () => {
    const largeTitle = "x".repeat(2 * 1024 * 1024)
    const { connection } = fixture(largeTitle)
    const response = await connection.dispatch(
      request("canvas.document.get", {
        projection: "geometry",
        ref: { canvasId: "main", projectId: "project-one" },
      }),
    )
    expect(response).toMatchObject({ ok: true, result: { document: { title: largeTitle } } })

    expect(
      await connection.dispatch(
        request("canvas.nodes.query", {
          query: { text: "x".repeat(1024 * 1024) },
          ref: { canvasId: "main", projectId: "project-one" },
        }),
      ),
    ).toMatchObject({ error: expect.stringContaining("exceeds 1048576 bytes"), ok: false })
  })

  test("owns and closes bounded document invalidation subscriptions", async () => {
    const { close, connection, emit, send } = fixture()
    expect(
      await connection.dispatch(
        request("canvas.events.subscribe", { ref: { canvasId: "main", projectId: "project-one" } }),
      ),
    ).toMatchObject({ ok: true, result: { subscriptionId: "subscription-1" } })

    emit({ ref: { canvasId: "main", projectId: "project-one" }, revision: 2, source: "plugin" })
    expect(send).toHaveBeenCalledWith({
      command: "canvas.document.changed",
      params: {
        event: { ref: { canvasId: "main", projectId: "project-one" }, revision: 2, source: "plugin" },
        subscriptionId: "subscription-1",
      },
      protocol: pluginCapabilityProtocolV1,
      type: "command",
    })

    connection.close()
    expect(close).toHaveBeenCalledTimes(1)
    emit({ ref: { canvasId: "main", projectId: "project-one" }, revision: 3, source: "plugin" })
    expect(send).toHaveBeenCalledTimes(1)
  })

  test("rejects work beyond the per-connection in-flight limit", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const listProjects = mock(async () => {
      await gate
      return []
    })
    const connection = new PluginCapabilityConnection(
      {
        async getDocument() {
          throw new Error("Unexpected document request")
        },
        async listCanvases() {
          throw new Error("Unexpected catalog request")
        },
        listProjects,
        async queryNodes() {
          throw new Error("Unexpected query request")
        },
        async subscribe() {
          throw new Error("Unexpected subscription request")
        },
        async transact() {
          throw new Error("Unexpected transaction request")
        },
      },
      { send: () => undefined },
    )
    const running = Array.from({ length: 16 }, (_, index) =>
      connection.dispatch({ ...request("projects.list"), id: `running-${index}` }),
    )

    expect(await connection.dispatch({ ...request("projects.list"), id: "overflow" })).toMatchObject({
      error: expect.stringContaining("exceeds 16 in-flight requests"),
      ok: false,
    })
    expect(listProjects).toHaveBeenCalledTimes(16)
    release()
    await Promise.all(running)
  })

  test("reserves subscription slots across concurrent subscribe calls", async () => {
    let block = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const subscribe = mock(async (): Promise<PluginCanvasEventSubscription> => {
      if (block) await gate
      return { close: () => undefined }
    })
    let nextSubscriptionId = 0
    const connection = new PluginCapabilityConnection(
      {
        async getDocument() {
          throw new Error("Unexpected document request")
        },
        async listCanvases() {
          throw new Error("Unexpected catalog request")
        },
        async listProjects() {
          throw new Error("Unexpected Project request")
        },
        async queryNodes() {
          throw new Error("Unexpected query request")
        },
        subscribe,
        async transact() {
          throw new Error("Unexpected transaction request")
        },
      },
      { send: () => undefined },
      () => `subscription-${++nextSubscriptionId}`,
    )
    const params = { ref: { canvasId: "main", projectId: "project-one" } }
    for (let index = 0; index < 63; index += 1) {
      expect(
        await connection.dispatch({ ...request("canvas.events.subscribe", params), id: `seed-${index}` }),
      ).toMatchObject({ ok: true })
    }
    block = true
    const lastSlot = connection.dispatch({ ...request("canvas.events.subscribe", params), id: "last-slot" })
    expect(await connection.dispatch({ ...request("canvas.events.subscribe", params), id: "overflow" })).toMatchObject({
      error: expect.stringContaining("exceeds 64 subscriptions"),
      ok: false,
    })
    expect(subscribe).toHaveBeenCalledTimes(64)
    release()
    await expect(lastSlot).resolves.toMatchObject({ ok: true })
  })
})
