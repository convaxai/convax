import { describe, expect, mock, test } from "bun:test"

import type { InstalledPlugin } from "../plugin-api"
import type {
  PluginCanvasCapabilityClient,
  PluginCanvasChangeEvent,
  PluginCanvasEventSubscription,
} from "../plugin-capability-contracts"
import {
  createToolPluginCanvasMcpBridge,
  toolPluginCanvasMcpMethods,
  toolPluginCanvasMcpNotifications,
} from "./tool-plugin-canvas-capabilities"

function plugin(
  capabilities: InstalledPlugin["capabilities"],
  schema: "convax.plugin/5" | "convax.plugin/6" = "convax.plugin/5",
): InstalledPlugin {
  return {
    capabilities,
    contributes: { service: { actions: [] } },
    description: "Canvas sidecar",
    id: "canvas-sidecar",
    name: "Canvas Sidecar",
    runtime: { command: "canvas-sidecar-mcp", type: "mcp-stdio" },
    schema,
    version: "1.0.0",
  }
}

function fixture(capabilities: InstalledPlugin["capabilities"]) {
  let listener: ((event: PluginCanvasChangeEvent) => void) | undefined
  const closeSubscription = mock(() => undefined)
  const transact = mock(async (request: Parameters<PluginCanvasCapabilityClient["transact"]>[0]) => ({
    affectedNodeIds: [],
    changed: true,
    createdNodeIds: [],
    ref: request.ref,
    revision: request.expectedRevision + 1,
    storageVersion: "v2",
    warnings: [],
  }))
  const client: PluginCanvasCapabilityClient = {
    async getDocument(ref) {
      return {
        document: { edges: [], id: ref.canvasId, nodes: [], revision: 1, title: "Main" },
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
      return { close: closeSubscription }
    },
    transact,
  }
  const issue = mock(async (_id, _runtime, _expected) => ({
    manifestDigest: "a".repeat(64),
    pluginId: "canvas-sidecar",
    pluginVersion: "1.0.0",
    runtime: "tool" as const,
  }))
  const connect = mock(async () => client)
  const installed = plugin(capabilities)
  return {
    client,
    closeSubscription,
    connect,
    emit: (event: PluginCanvasChangeEvent) => listener?.(event),
    installed,
    issue,
    transact,
  }
}

function context(sendNotification = mock(() => undefined)) {
  return { sendNotification, signal: new AbortController().signal }
}

describe("Tool Plugin Canvas reverse MCP adapter", () => {
  test("issues an exact all-bound Tool principal and exposes only granted fixed methods", async () => {
    const { connect, installed, issue } = fixture(["projects.read", "canvas.document.read"])
    const bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })

    expect(issue).toHaveBeenCalledWith("canvas-sidecar", "tool", installed)
    expect(connect).toHaveBeenCalledWith({
      principal: expect.objectContaining({ pluginId: "canvas-sidecar", runtime: "tool" }),
      scope: { kind: "all-bound-projects" },
    })
    expect(bridge?.handler.methods).toEqual([
      toolPluginCanvasMcpMethods.listProjects,
      toolPluginCanvasMcpMethods.getDocument,
      toolPluginCanvasMcpMethods.queryNodes,
    ])
    await expect(
      bridge!.handler.handle({ method: toolPluginCanvasMcpMethods.listProjects }, context()),
    ).resolves.toEqual({ projects: [{ available: true, id: "project-one", name: "One" }] })
    bridge?.close()
  })

  test("does not give a headless sidecar implicit Project scope", async () => {
    const { connect, installed, issue } = fixture(["canvas.document.read"])
    expect(
      await createToolPluginCanvasMcpBridge(installed, { broker: { connect }, principals: { issue } }),
    ).toBeUndefined()
    expect(issue).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  test("reuses the reverse Canvas adapter for a v6 Tool runtime", async () => {
    const { connect, issue } = fixture(["projects.read", "canvas.document.read"])
    const installed = plugin(["projects.read", "canvas.document.read"], "convax.plugin/6")
    const bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })

    expect(issue).toHaveBeenCalledWith("canvas-sidecar", "tool", installed)
    expect(bridge?.handler.methods).toContain(toolPluginCanvasMcpMethods.getDocument)
    bridge?.close()
  })

  test("passes reverse-MCP cancellation into the capability client", async () => {
    const { client, connect, installed, issue } = fixture(["projects.read", "canvas.document.write"])
    let receivedSignal: AbortSignal | undefined
    const transact = mock(
      async (
        _request: Parameters<PluginCanvasCapabilityClient["transact"]>[0],
        signal?: AbortSignal,
      ): Promise<never> => {
        receivedSignal = signal
        if (!signal) throw new Error("Missing Tool cancellation signal")
        return new Promise<never>((_resolve, reject) => {
          const rejectCanceled = () => reject(new DOMException("canceled", "AbortError"))
          if (signal.aborted) rejectCanceled()
          else signal.addEventListener("abort", rejectCanceled, { once: true })
        })
      },
    )
    client.transact = transact
    const bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })
    const controller = new AbortController()
    const result = bridge!.handler.handle(
      {
        method: toolPluginCanvasMcpMethods.executeTransaction,
        params: {
          commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["one"] }],
          expectedRevision: 0,
          ref: { canvasId: "main", projectId: "project-one" },
          transactionId: "cancel-tool-transaction",
        },
      },
      { sendNotification() {}, signal: controller.signal },
    )

    expect(transact).toHaveBeenCalledTimes(1)
    expect(receivedSignal).toBe(controller.signal)
    controller.abort("stopped")
    await expect(result).rejects.toThrow("canceled")
    bridge?.close()
  })

  test("returns a committed reverse-MCP transaction when cancellation loses the durable race", async () => {
    const { client, connect, installed, issue } = fixture(["projects.read", "canvas.document.write"])
    let resolveCommit!: (value: Awaited<ReturnType<PluginCanvasCapabilityClient["transact"]>>) => void
    client.transact = async () =>
      new Promise((resolve) => {
        resolveCommit = resolve
      })
    const bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })
    const controller = new AbortController()
    const result = bridge!.handler.handle(
      {
        method: toolPluginCanvasMcpMethods.executeTransaction,
        params: {
          commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["one"] }],
          expectedRevision: 1,
          ref: { canvasId: "main", projectId: "project-one" },
          transactionId: "committed-tool-transaction",
        },
      },
      { sendNotification() {}, signal: controller.signal },
    )
    await Promise.resolve()
    controller.abort("stopped")
    resolveCommit({
      affectedNodeIds: ["one"],
      changed: true,
      createdNodeIds: [],
      ref: { canvasId: "main", projectId: "project-one" },
      revision: 2,
      storageVersion: "v2",
      warnings: [],
    })

    await expect(result).resolves.toMatchObject({ changed: true, revision: 2 })
    bridge?.close()
  })

  test("does not replace a committed transaction result when the runtime closes concurrently", async () => {
    const { client, connect, installed, issue } = fixture(["projects.read", "canvas.document.write"])
    let bridge: Awaited<ReturnType<typeof createToolPluginCanvasMcpBridge>>
    client.transact = async (request) => {
      bridge?.close()
      return {
        affectedNodeIds: ["one"],
        changed: true,
        createdNodeIds: [],
        ref: request.ref,
        revision: 2,
        storageVersion: "v2",
        warnings: [],
      }
    }
    bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })

    await expect(
      bridge!.handler.handle(
        {
          method: toolPluginCanvasMcpMethods.executeTransaction,
          params: {
            commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["one"] }],
            expectedRevision: 1,
            ref: { canvasId: "main", projectId: "project-one" },
            transactionId: "commit-while-closing",
          },
        },
        context(),
      ),
    ).resolves.toMatchObject({ changed: true, revision: 2 })
  })

  test("delivers only the fixed revision notification and closes subscriptions with the runtime", async () => {
    const { closeSubscription, connect, emit, installed, issue } = fixture(["projects.read", "canvas.events.subscribe"])
    const bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })
    const sendNotification = mock(() => undefined)
    const result = await bridge!.handler.handle(
      {
        method: toolPluginCanvasMcpMethods.subscribeEvents,
        params: { ref: { canvasId: "main", projectId: "project-one" } },
      },
      context(sendNotification),
    )
    expect(result).toEqual({ subscriptionId: expect.any(String) })

    emit({ ref: { canvasId: "main", projectId: "project-one" }, revision: 2, source: "host" })
    expect(sendNotification).toHaveBeenCalledWith(toolPluginCanvasMcpNotifications.documentChanged, {
      event: { ref: { canvasId: "main", projectId: "project-one" }, revision: 2, source: "host" },
      subscriptionId: expect.any(String),
    })
    bridge?.close()
    expect(closeSubscription).toHaveBeenCalledTimes(1)
  })

  test("removes a subscription canceled while the broker was connecting it", async () => {
    const { client, connect, installed, issue } = fixture(["projects.read", "canvas.events.subscribe"])
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const close = mock(() => undefined)
    client.subscribe = async () => {
      await gate
      return { close }
    }
    const bridge = await createToolPluginCanvasMcpBridge(installed, {
      broker: { connect },
      principals: { issue },
    })
    const controller = new AbortController()
    const result = bridge!.handler.handle(
      {
        method: toolPluginCanvasMcpMethods.subscribeEvents,
        params: { ref: { canvasId: "main", projectId: "project-one" } },
      },
      { sendNotification() {}, signal: controller.signal },
    )

    controller.abort("stopped")
    release()
    await expect(result).rejects.toThrow("canceled")
    expect(close).toHaveBeenCalledTimes(1)
    bridge?.close()
  })
})
