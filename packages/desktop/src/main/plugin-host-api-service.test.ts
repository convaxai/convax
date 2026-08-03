import { describe, expect, test } from "bun:test"
import { pluginApiCatalog, type PluginApiId } from "@convax/plugin-api"

import type { PluginCanvasCapabilityClient, PluginPrincipal } from "../plugin-capability-contracts"
import type {
  PluginHostInvocationLease,
  PluginHostNodeContext,
  PluginHostNodeOperationsPort,
  PluginHostPrincipalPort,
  PluginHostResolvedPrincipal,
} from "../plugin-host-api-main-contracts"
import { PluginHostApiError } from "../plugin-host-errors"
import { PluginHostApiService } from "./plugin-host-api-service"

const digest = (character: string) => character.repeat(64)
const catalogOperationReceipt = () =>
  ({
    actorId: "A".repeat(43),
    baseFrontierDigest: digest("a"),
    format: "convax.canvas-operation-receipt/2",
    historyMaterialDigest: null,
    intentDigest: digest("b"),
    intentKind: "canvas.nodes.set-plugin-state/2",
    operationId: "A".repeat(22),
    resultEntities: [],
    semanticRoot: true,
  }) as never
const allApiIds = pluginApiCatalog.apis.map(({ id }) => id)
const capabilities = [
  "agent.prompt",
  "canvas.catalog.read",
  "canvas.connectedInputs.read",
  "canvas.connectedImages.read",
  "canvas.connectedMedia.stream",
  "canvas.document.read",
  "canvas.document.write",
  "canvas.events.subscribe",
  "canvas.image.write",
  "canvas.node.read",
  "canvas.node.write",
  "generation.execute",
  "project.files.read",
  "projects.read",
] as const

const principal: PluginPrincipal = {
  activeRevision: 7,
  activeSetDigest: digest("a"),
  manifestDigest: digest("b"),
  pluginId: "fixture",
  pluginVersion: "1.2.3",
  runtime: "web",
  snapshotDigest: digest("c"),
}

const toolPrincipal: PluginPrincipal = { ...principal, runtime: "tool" }

const nodeContext: PluginHostNodeContext = {
  canvas: { id: "canvas-1", name: "Canvas" },
  node: {
    data: { kind: "file", label: "Plugin node" },
    id: "node-1",
    position: { x: 10, y: 20 },
    type: "file",
  },
  project: { id: "project-1", name: "Project" },
}

function principalPort(isCurrent: () => boolean = () => true): PluginHostPrincipalPort {
  return {
    async liveState() {
      return { disabled: false, recovering: false, setupComplete: true }
    },
    async resolve() {
      if (!isCurrent()) return null
      return resolvedPrincipal()
    },
  }
}

function resolvedPrincipal(input: PluginPrincipal = principal): PluginHostResolvedPrincipal {
  return {
    activeRevision: input.activeRevision,
    activeSetDigest: input.activeSetDigest,
    capabilities,
    hostApi: { major: 3, optional: [], required: allApiIds },
    manifestDigest: input.manifestDigest,
    pluginId: input.pluginId,
    pluginName: "Fixture Plugin",
    pluginVersion: input.pluginVersion,
    snapshotDigest: input.snapshotDigest,
  }
}

function canvasClient(log: string[]): PluginCanvasCapabilityClient {
  const pluginDocument = (canvasId: string) => ({ edges: [], id: canvasId, nodes: [], title: "Canvas" })
  return {
    async getDocument(ref, projection) {
      log.push("canvas.document.get")
      return {
        document: pluginDocument(ref.canvasId),
        projection: projection ?? "geometry",
        ref,
      } as never
    },
    async listCanvases(projectId) {
      log.push("canvas.catalog.list")
      return { canvases: [], projectId }
    },
    async listProjects() {
      log.push("projects.list")
      return [{ available: true, id: "project-1", name: "Project" }]
    },
    async queryNodes(ref) {
      log.push("canvas.nodes.query")
      return { nodes: [], projection: pluginDocument(ref.canvasId), ref }
    },
    async subscribe(_ref, listener) {
      log.push("canvas.events.subscribe")
      listener({
        operationReceipt: catalogOperationReceipt(),
        ref: { canvasId: "canvas-1", projectId: "project-1" },
        source: "host",
      })
      return { close: () => log.push("subscription.close") }
    },
    async transact(request) {
      log.push("canvas.transaction.execute")
      return {
        affectedNodeIds: [],
        changed: true,
        createdNodeIds: [],
        operationReceipt: catalogOperationReceipt(),
        projection: pluginDocument(request.ref.canvasId),
        ref: request.ref,
        warnings: [],
      }
    },
  }
}

function operations(log: string[]): PluginHostNodeOperationsPort {
  return {
    closeConnection() {
      log.push("connection.close")
    },
    async closeInput() {
      log.push("canvas.inputs.close")
      return true
    },
    async closeImageInput() {
      log.push("canvas.inputs.image.close")
      return true
    },
    async createCanvasImage({ checkpoint }) {
      await checkpoint.checkpoint()
      log.push("canvas.resource.image.create")
      return {
        createdNodeId: "image-1",
        operationReceipt: catalogOperationReceipt(),
        projection: { edges: [], id: "canvas-1", nodes: [], title: "Canvas" },
      }
    },
    async executeGeneration({ checkpoint }) {
      await checkpoint.checkpoint()
      log.push("generation.execute")
      return {
        createdNodeIds: ["generated-1"],
        operationReceipt: catalogOperationReceipt(),
        projection: { edges: [], id: "canvas-1", nodes: [], title: "Canvas" },
        toolId: "tool-1",
        warnings: [],
      }
    },
    async listGenerationTools() {
      log.push("generation.tools.list")
      return [
        {
          acceptedInputs: ["text"],
          description: "Fixture tool",
          id: "tool-1",
          kind: "operation",
          output: "image",
          title: "Fixture",
        },
      ]
    },
    async listInputs() {
      log.push("canvas.inputs.list")
      return [{ inputKey: "opaque-source-1", kind: "image", label: "Input" }]
    },
    async openInput() {
      log.push("canvas.inputs.open")
      return {
        probe: {
          duration: { estimated: false, milliseconds: 100 },
          height: 10,
          kind: "video",
          mediaRevision: "revision",
          mimeType: "video/mp4",
          size: 100,
          width: 10,
        },
        sessionId: "session-1",
        url: `convax-connected-media://session-1/${"a".repeat(32)}`,
      }
    },
    async openImageInput() {
      log.push("canvas.inputs.image.open")
      return {
        probe: {
          contentRevision: "d".repeat(64),
          height: 1,
          kind: "image",
          mimeType: "image/png",
          size: 8,
          width: 1,
        },
        sessionId: "image-session-1",
        url: `convax-connected-media://image-session-1/${"b".repeat(32)}`,
      }
    },
    async promptAgent({ checkpoint }) {
      await checkpoint.checkpoint()
      log.push("agent.prompt")
      return { text: "accepted" }
    },
    async readProjectText({ path }) {
      log.push("project.file.text.read")
      return { content: "text", exists: true, path }
    },
    async replaceNodeState({ checkpoint }) {
      await checkpoint.checkpoint()
      log.push("canvas.node.state.replace")
      return {
        operationReceipt: catalogOperationReceipt(),
        projection: structuredClone(nodeContext.node),
        updated: true as const,
      }
    },
  }
}

async function connection(input?: {
  current?: () => boolean
  invocationLease?: PluginHostInvocationLease
  node?: () => PluginHostNodeContext | null
  operations?: PluginHostNodeOperationsPort
  principal?: PluginPrincipal
  principals?: PluginHostPrincipalPort
}) {
  const log: string[] = []
  const events: unknown[] = []
  const service = new PluginHostApiService({
    createId: () => "subscription-1",
    nodes: {
      async resolve() {
        return (input?.node ?? (() => nodeContext))()
      },
    },
    operations: input?.operations ?? operations(log),
    principals: input?.principals ?? principalPort(input?.current),
  })
  const connected = await service.connect({
    canvas: canvasClient(log),
    ...(input?.invocationLease ? { invocationLease: input.invocationLease } : {}),
    node: { canvasId: "canvas-1", nodeId: "node-1", projectId: "project-1" },
    onCanvasEvent: (event) => events.push(event),
    principal: input?.principal ?? principal,
    scope: { kind: "all-bound-projects" },
    transport: { frameId: "frame-1", senderId: 1 },
  })
  return { connected, events, log }
}

describe("PluginHostApiService", () => {
  test("rejects projects.list with a typed non-recoverable permission error when its grant is absent", async () => {
    const denied = {
      ...resolvedPrincipal(),
      capabilities: [] as const,
    }
    const { connected } = await connection({
      principals: {
        async liveState() {
          return { disabled: false, recovering: false, setupComplete: true }
        },
        async resolve() {
          return denied
        },
      },
    })

    try {
      await connected.execute({ method: "projects.list" }, { operationId: "operation-projects-denied" })
      throw new Error("Expected projects.list to be denied")
    } catch (error) {
      expect(error).toBeInstanceOf(PluginHostApiError)
      expect(error).toMatchObject({ code: "permission-denied" })
    }
  })

  test("routes every generated Catalog API through Main-owned ports", async () => {
    const { connected, events, log } = await connection()
    const calls = [
      { method: "host.context.get" },
      { method: "canvas.inputs.list" },
      { method: "canvas.inputs.open", params: { inputKey: "source-1" } },
      { method: "canvas.inputs.close", params: { sessionId: "session-1" } },
      { method: "canvas.node.get" },
      { method: "canvas.node.state.replace", params: { state: { value: 1 } } },
      {
        method: "canvas.resource.image.create",
        params: { dataUrl: "data:image/png;base64,AAAA", name: "capture.png" },
      },
      { method: "project.file.text.read", params: { path: "Notes/input.md" } },
      { method: "agent.prompt", params: { text: "Help" } },
      { method: "generation.tools.list", params: { output: "image" } },
      {
        method: "generation.execute",
        params: {
          output: "image",
          prompt: "Create",
          references: [{ inputKey: "opaque-source-1", role: "reference_image" }],
          toolId: "tool-1",
        },
      },
      { method: "projects.list" },
      { method: "canvas.catalog.list", params: { projectId: "project-1" } },
      {
        method: "canvas.document.get",
        params: { projection: "geometry", ref: { canvasId: "canvas-1", projectId: "project-1" } },
      },
      {
        method: "canvas.nodes.query",
        params: { query: {}, ref: { canvasId: "canvas-1", projectId: "project-1" } },
      },
      {
        method: "canvas.transaction.execute",
        params: {
          command: { delta: { x: 1, y: 1 }, nodeIds: ["node-1"], type: "nodes.move" },
          commandId: "transaction-1",
          ref: { canvasId: "canvas-1", projectId: "project-1" },
        },
      },
      {
        method: "canvas.events.subscribe",
        params: { ref: { canvasId: "canvas-1", projectId: "project-1" } },
      },
      { method: "canvas.events.unsubscribe", params: { subscriptionId: "subscription-1" } },
      { method: "canvas.inputs.image.open", params: { inputKey: "source-1" } },
      { method: "canvas.inputs.image.close", params: { sessionId: "image-session-1" } },
    ] as const

    expect(calls.map(({ method }) => method)).toEqual(allApiIds)
    for (const call of calls) {
      expect(connected.supports(call.method as PluginApiId)).toBe(true)
      const result = await connected.execute(call as never, { operationId: `operation-${call.method}` })
      if (call.method === "host.context.get") {
        expect(result).toMatchObject({
          hostApi: {
            availability: expect.arrayContaining([
              {
                available: true,
                catalogVersion: "3.0.0",
                contractSince: "3.0.0",
                id: "generation.execute",
                since: "1.0.0",
              },
            ]),
            catalogVersion: "3.0.0",
          },
        })
      }
    }
    expect(log).toContain("canvas.node.state.replace")
    expect(log).toContain("canvas.resource.image.create")
    expect(log).toContain("generation.execute")
    expect(log).toContain("canvas.transaction.execute")
    // The fake source emits synchronously before subscription publication; the
    // connection intentionally drops that unbound event.
    expect(events).toEqual([])
    expect(log).toContain("subscription.close")
  })

  test("rejects schema-owned semantic refinements before invoking Desktop ports", async () => {
    const { connected, log } = await connection()
    const invalidCalls = [
      {
        method: "canvas.node.state.replace",
        params: { state: { payload: "x".repeat(300 * 1024) } },
      },
      {
        method: "canvas.resource.image.create",
        params: { dataUrl: "data:image/png;base64,AAAA", name: "CON.png" },
      },
      { method: "project.file.text.read", params: { path: "../secret.txt" } },
      { method: "agent.prompt", params: { text: " padded " } },
      { method: "generation.execute", params: { prompt: "\ncreate" } },
      {
        method: "generation.execute",
        params: { prompt: "create", references: [{ nodeId: "must-not-cross-wire", role: "reference_image" }] },
      },
    ] as const

    for (const [index, call] of invalidCalls.entries()) {
      await expect(connected.execute(call as never, { operationId: `invalid-schema-${index}` })).rejects.toBeInstanceOf(
        TypeError,
      )
    }
    expect(log).toEqual([])
  })

  test("an update or uninstall during preparation causes zero mutation", async () => {
    let current = true
    const prepared = deferred<void>()
    const continueMutation = deferred<void>()
    let persisted = 0
    const base = operations([])
    const { connected } = await connection({
      current: () => current,
      operations: {
        ...base,
        async replaceNodeState({ checkpoint }) {
          prepared.resolve()
          await continueMutation.promise
          await checkpoint.checkpoint()
          persisted += 1
          return {
            operationReceipt: catalogOperationReceipt(),
            projection: structuredClone(nodeContext.node),
            updated: true as const,
          }
        },
      },
    })

    const pending = connected.execute(
      {
        method: "canvas.node.state.replace",
        params: { state: { value: 2 } },
      },
      { operationId: "operation-state" },
    )
    await prepared.promise
    current = false
    continueMutation.resolve()

    await expect(pending).rejects.toThrow("no longer current")
    expect(persisted).toBe(0)
  })

  test("sender destruction during image preparation aborts before publication", async () => {
    const prepared = deferred<void>()
    const continuePublication = deferred<void>()
    let published = 0
    const base = operations([])
    const { connected } = await connection({
      operations: {
        ...base,
        async createCanvasImage({ checkpoint }) {
          prepared.resolve()
          await continuePublication.promise
          await checkpoint.checkpoint()
          published += 1
          return {
            createdNodeId: "image-1",
            operationReceipt: catalogOperationReceipt(),
            projection: { edges: [], id: "canvas-1", nodes: [], title: "Canvas" },
          }
        },
      },
    })
    const controller = new AbortController()
    const pending = connected.execute(
      {
        method: "canvas.resource.image.create",
        params: { dataUrl: "data:image/png;base64,AAAA", name: "capture.png" },
      },
      { operationId: "operation-image", signal: controller.signal },
    )
    await prepared.promise
    controller.abort(new Error("renderer destroyed"))
    continuePublication.resolve()

    await expect(pending).rejects.toThrow("renderer destroyed")
    expect(published).toBe(0)
  })

  test("rejects stale node scope before delegating", async () => {
    let listed = 0
    const base = operations([])
    const { connected } = await connection({
      node: (() => {
        let first = true
        return () => {
          if (first) {
            first = false
            return nodeContext
          }
          return null
        }
      })(),
      operations: {
        ...base,
        async listInputs() {
          listed += 1
          return []
        },
      },
    })

    await expect(
      connected.execute({ method: "canvas.inputs.list" }, { operationId: "operation-inputs" }),
    ).rejects.toThrow("changed")
    expect(listed).toBe(0)
  })

  test("rejects a connected-image result when the exact Plugin principal changes during open", async () => {
    let current = true
    let closedSessionId: string | undefined
    const base = operations([])
    const { connected } = await connection({
      current: () => current,
      operations: {
        ...base,
        async closeImageInput({ sessionId }) {
          closedSessionId = sessionId
          return true
        },
        async openImageInput() {
          current = false
          return {
            probe: {
              contentRevision: "d".repeat(64),
              height: 1,
              kind: "image",
              mimeType: "image/png",
              size: 8,
              width: 1,
            },
            sessionId: "image-session-1",
            url: `convax-connected-media://image-session-1/${"b".repeat(32)}`,
          }
        },
      },
    })

    await expect(
      connected.execute(
        { method: "canvas.inputs.image.open", params: { inputKey: "source-1" } },
        { operationId: "operation-image-open" },
      ),
    ).rejects.toThrow("no longer current")
    expect(closedSessionId).toBe("image-session-1")
  })

  test("rejects a connected-image result without one canonical bearer URL", async () => {
    let closedSessionId: string | undefined
    const base = operations([])
    const { connected } = await connection({
      operations: {
        ...base,
        async closeImageInput({ sessionId }) {
          closedSessionId = sessionId
          return true
        },
        async openImageInput() {
          return {
            probe: {
              contentRevision: "d".repeat(64),
              height: 1,
              kind: "image",
              mimeType: "image/png",
              size: 8,
              width: 1,
            },
            sessionId: "image-session-1",
            url: "convax-connected-media://image-session-1",
          }
        },
      },
    })

    await expect(
      connected.execute(
        { method: "canvas.inputs.image.open", params: { inputKey: "source-1" } },
        { operationId: "operation-image-bearer" },
      ),
    ).rejects.toThrow("bearer URL")
    expect(closedSessionId).toBe("image-session-1")
  })

  test("revokes an opened stream when reauthorization or output validation fails", async () => {
    for (const failure of ["principal", "output"] as const) {
      let current = true
      let closedSessionId: string | undefined
      const base = operations([])
      const { connected } = await connection({
        current: () => current,
        operations: {
          ...base,
          async closeInput({ sessionId }) {
            closedSessionId = sessionId
            return true
          },
          async openInput() {
            if (failure === "principal") current = false
            return {
              probe: {
                duration: { estimated: false, milliseconds: 100 },
                height: 10,
                kind: "video",
                mediaRevision: "revision",
                mimeType: "video/mp4",
                size: 100,
                width: 10,
              },
              sessionId: "stream-session-1",
              url:
                failure === "output"
                  ? "convax-connected-media://stream-session-1"
                  : `convax-connected-media://stream-session-1/${"a".repeat(32)}`,
            }
          },
        },
      })

      await expect(
        connected.execute(
          { method: "canvas.inputs.open", params: { inputKey: "source-1" } },
          { operationId: `operation-stream-${failure}` },
        ),
      ).rejects.toThrow(failure === "principal" ? "no longer current" : "bearer URL")
      expect(closedSessionId).toBe("stream-session-1")
    }
  })

  test("rolls back a stream created after the connection closed while its open port was pending", async () => {
    const opened = deferred<void>()
    const continueOpen = deferred<void>()
    let closedSessionId: string | undefined
    const base = operations([])
    const { connected } = await connection({
      operations: {
        ...base,
        async closeInput({ sessionId }) {
          closedSessionId = sessionId
          return true
        },
        async openInput() {
          opened.resolve()
          await continueOpen.promise
          return {
            probe: {
              duration: { estimated: false, milliseconds: 100 },
              height: 10,
              kind: "video",
              mediaRevision: "revision",
              mimeType: "video/mp4",
              size: 100,
              width: 10,
            },
            sessionId: "late-stream-session",
            url: `convax-connected-media://late-stream-session/${"a".repeat(32)}`,
          }
        },
      },
    })
    const opening = connected.execute(
      { method: "canvas.inputs.open", params: { inputKey: "source-1" } },
      { operationId: "operation-stream-close-race" },
    )
    await opened.promise

    connected.close()
    continueOpen.resolve()

    await expect(opening).rejects.toThrow("connection is closed")
    expect(closedSessionId).toBe("late-stream-session")
  })

  test("closes the connection when connected-image rollback cannot revoke the exact session", async () => {
    let current = true
    const log: string[] = []
    const base = operations(log)
    const { connected } = await connection({
      current: () => current,
      operations: {
        ...base,
        async closeImageInput() {
          throw new Error("targeted revoke failed")
        },
        async openImageInput() {
          current = false
          return {
            probe: {
              contentRevision: "d".repeat(64),
              height: 1,
              kind: "image",
              mimeType: "image/png",
              size: 8,
              width: 1,
            },
            sessionId: "image-session-1",
            url: `convax-connected-media://image-session-1/${"b".repeat(32)}`,
          }
        },
      },
    })

    await expect(
      connected.execute(
        { method: "canvas.inputs.image.open", params: { inputKey: "source-1" } },
        { operationId: "operation-image-rollback" },
      ),
    ).rejects.toThrow("no longer current")
    expect(log).toContain("connection.close")
    await expect(
      connected.execute({ method: "host.context.get" }, { operationId: "operation-after-rollback" }),
    ).rejects.toThrow("connection is closed")
  })

  test("closes the connection when targeted session rollback reports no exact revocation", async () => {
    let current = true
    const log: string[] = []
    const base = operations(log)
    const { connected } = await connection({
      current: () => current,
      operations: {
        ...base,
        async closeInput() {
          return false
        },
        async openInput() {
          current = false
          return {
            probe: {
              duration: { estimated: false, milliseconds: 100 },
              height: 10,
              kind: "video",
              mediaRevision: "revision",
              mimeType: "video/mp4",
              size: 100,
              width: 10,
            },
            sessionId: "stream-session-1",
            url: `convax-connected-media://stream-session-1/${"a".repeat(32)}`,
          }
        },
      },
    })

    await expect(
      connected.execute(
        { method: "canvas.inputs.open", params: { inputKey: "source-1" } },
        { operationId: "operation-stream-rollback-false" },
      ),
    ).rejects.toThrow("no longer current")
    expect(log).toContain("connection.close")
    await expect(
      connected.execute({ method: "host.context.get" }, { operationId: "operation-after-stream-rollback" }),
    ).rejects.toThrow("connection is closed")
  })

  test("fails closed when an authoritative node projection contains a native path", async () => {
    const unsafe = structuredClone(nodeContext)
    unsafe.node.data.metadata = { nativePath: "/Users/example/private.bin" }
    const { connected } = await connection({ node: () => unsafe })

    await expect(connected.execute({ method: "canvas.node.get" }, { operationId: "operation-node" })).rejects.toThrow(
      "native runtime data",
    )
  })

  test("uses one active historical invocation lease without consulting the current resolver", async () => {
    const invocation = invocationLease()
    let currentResolutions = 0
    const { connected } = await connection({
      invocationLease: invocation.lease,
      principal: toolPrincipal,
      principals: {
        async liveState() {
          throw new Error("historical invocation must not consult current live state")
        },
        async resolve() {
          currentResolutions += 1
          return null
        },
      },
    })

    await expect(
      connected.execute({ method: "projects.list" }, { operationId: invocation.lease.claims.operationId }),
    ).resolves.toEqual({
      projects: [{ available: true, id: "project-1", name: "Project" }],
    })
    expect(currentResolutions).toBe(0)
    expect(invocation.assertions).toBeGreaterThanOrEqual(3)
  })

  test("rejects a completed or canceled historical invocation replay", async () => {
    const completed = invocationLease()
    const completedConnection = await connection({
      invocationLease: completed.lease,
      principal: toolPrincipal,
      principals: rejectingCurrentPrincipalPort(),
    })
    await completedConnection.connected.execute(
      { method: "projects.list" },
      { operationId: completed.lease.claims.operationId },
    )
    completed.end()
    await expect(
      completedConnection.connected.execute(
        { method: "projects.list" },
        { operationId: completed.lease.claims.operationId },
      ),
    ).rejects.toThrow("invocation lease ended")

    const canceled = invocationLease()
    const canceledConnection = await connection({
      invocationLease: canceled.lease,
      principal: toolPrincipal,
      principals: rejectingCurrentPrincipalPort(),
    })
    canceled.cancel()
    await expect(
      canceledConnection.connected.execute(
        { method: "projects.list" },
        { operationId: canceled.lease.claims.operationId },
      ),
    ).rejects.toThrow("invocation canceled")
  })

  test("rejects cross-operation, cross-provider, cross-Plugin, and forged consumer invocation claims", async () => {
    const invocation = invocationLease()
    const { connected } = await connection({
      invocationLease: invocation.lease,
      principal: toolPrincipal,
      principals: rejectingCurrentPrincipalPort(),
    })
    await expect(connected.execute({ method: "projects.list" }, { operationId: "another-operation" })).rejects.toThrow(
      "invocation lease",
    )

    const wrongProvider = invocationLease({
      claims: { providerPluginId: "another-provider" },
    })
    await expect(
      connection({
        invocationLease: wrongProvider.lease,
        principal: toolPrincipal,
        principals: rejectingCurrentPrincipalPort(),
      }),
    ).rejects.toThrow("invocation lease")

    const anotherPlugin = { ...toolPrincipal, pluginId: "another-plugin" }
    const wrongPlugin = invocationLease({
      principal: anotherPlugin,
      resolved: resolvedPrincipal(anotherPlugin),
    })
    await expect(
      connection({
        invocationLease: wrongPlugin.lease,
        principal: toolPrincipal,
        principals: rejectingCurrentPrincipalPort(),
      }),
    ).rejects.toThrow("invocation lease")

    const forgedConsumer = invocationLease({
      claims: { consumerPluginId: "forged-consumer" },
      expectedConsumerPluginId: "consumer",
    })
    await expect(
      connection({
        invocationLease: forgedConsumer.lease,
        principal: toolPrincipal,
        principals: rejectingCurrentPrincipalPort(),
      }),
    ).rejects.toThrow("invocation consumer changed")
  })

  test("never admits an invocation lease on a Web Plugin connection", async () => {
    const invocation = invocationLease({ principal, resolved: resolvedPrincipal(principal) })
    await expect(
      connection({
        invocationLease: invocation.lease,
        principal,
        principals: rejectingCurrentPrincipalPort(),
      }),
    ).rejects.toThrow("Web Plugin Host API connections cannot carry invocation leases")
  })
})

function rejectingCurrentPrincipalPort(): PluginHostPrincipalPort {
  return {
    async liveState() {
      throw new Error("historical invocation must not consult current live state")
    },
    async resolve() {
      throw new Error("historical invocation must not consult the current resolver")
    },
  }
}

function invocationLease(input?: {
  claims?: Partial<PluginHostInvocationLease["claims"]>
  expectedConsumerPluginId?: string
  principal?: PluginPrincipal
  resolved?: PluginHostResolvedPrincipal
}) {
  const leasePrincipal = input?.principal ?? toolPrincipal
  const claims = {
    consumerPluginId: "consumer",
    operationId: "capability-operation",
    providerPluginId: leasePrincipal.pluginId,
    ...input?.claims,
  }
  const expectedConsumerPluginId = input?.expectedConsumerPluginId ?? claims.consumerPluginId
  const controller = new AbortController()
  let active = true
  let assertions = 0
  const lease: PluginHostInvocationLease = {
    async assertActive(candidate) {
      assertions += 1
      if (candidate.consumerPluginId !== expectedConsumerPluginId) {
        throw new Error("invocation consumer changed")
      }
      if (candidate.operationId !== claims.operationId || candidate.providerPluginId !== claims.providerPluginId) {
        throw new Error("invocation claims changed")
      }
      if (!active) throw new Error("invocation lease ended")
    },
    claims,
    principal: leasePrincipal,
    resolved: input?.resolved ?? resolvedPrincipal(leasePrincipal),
    signal: controller.signal,
  }
  return {
    get assertions() {
      return assertions
    },
    cancel() {
      controller.abort(new Error("invocation canceled"))
    },
    end() {
      active = false
    },
    lease,
  }
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
