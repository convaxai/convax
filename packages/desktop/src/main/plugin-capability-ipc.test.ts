import { afterEach, describe, expect, mock, test } from "bun:test"

import type {
  PluginCanvasCapabilityClient,
  PluginCanvasChangeEvent,
  PluginCanvasDocumentProjection,
  PluginCanvasDocumentResult,
  PluginCanvasEventSubscription,
  PluginCanvasRef,
  PluginCanvasTransactionRequest,
  PluginCapabilityConnectionRequest,
  PluginCapabilityRuntimeKind,
  PluginPrincipal,
  ResolvedPluginPrincipal,
} from "../plugin-capability-contracts"
import type { PluginCapabilityConnectInput } from "../plugin-capability-ipc"
import {
  PluginHostApiError,
  PluginHostApiResourceUnavailableError,
} from "../plugin-host-errors"
import { pluginCapabilityProtocolV3 } from "../plugin-host-protocol"
import type { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import { PluginCapabilityBrokerError } from "./plugin-capability-broker"
import type { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"

type InvokeHandler = (event: TestEvent, input?: unknown) => unknown

interface TestEvent {
  sender: TestSender
}

class TestSender {
  readonly send = mock((_channel: string, _payload: unknown) => undefined)
  readonly #listeners = new Map<string, Set<() => void>>()
  #destroyed = false

  constructor(readonly id: number) {}

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

  destroy() {
    if (this.#destroyed) return
    this.#destroyed = true
    const listeners = [...(this.#listeners.get("destroyed") ?? [])]
    this.#listeners.delete("destroyed")
    listeners.forEach((listener) => listener())
  }
}

const handlers = new Map<string, InvokeHandler>()
const removedHandlers: string[] = []
const disposers = new Set<() => void>()

void mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => {
      removedHandlers.push(channel)
      handlers.delete(channel)
    },
  },
}))

afterEach(() => {
  for (const dispose of disposers) dispose()
  handlers.clear()
  removedHandlers.splice(0)
})

const principal: PluginPrincipal = {
  activeRevision: 7,
  activeSetDigest: "a".repeat(64),
  manifestDigest: "sha256:plugin-one",
  pluginId: "plugin-one",
  pluginVersion: "1.0.0",
  runtime: "web",
  snapshotDigest: "b".repeat(64),
}

const connectInput: PluginCapabilityConnectInput = {
  activeRevision: principal.activeRevision,
  activeSetDigest: principal.activeSetDigest,
  canvasId: "canvas-one",
  nodeId: "node-one",
  pluginId: principal.pluginId,
  pluginVersion: principal.pluginVersion,
  projectId: "project-one",
  runtime: "web",
  snapshotDigest: principal.snapshotDigest,
}

function capabilityRequest(method: string, params?: unknown) {
  return {
    id: `request-${method}`,
    method,
    ...(params === undefined ? {} : { params }),
    protocol: pluginCapabilityProtocolV3,
    type: "request",
  }
}

function operationReceipt(operationId: string) {
  return { actorId: "plugin-one", operationId } as never
}

function emptyPluginDocument(canvasId: string) {
  return { edges: [], id: canvasId, nodes: [], title: "Main" }
}

function createClient() {
  const listeners = new Set<(event: PluginCanvasChangeEvent) => void>()
  const closeSubscription = mock(() => undefined)
  const getDocument = mock(
    async (
      ref: PluginCanvasRef,
      projection: PluginCanvasDocumentProjection = "geometry",
    ): Promise<PluginCanvasDocumentResult> => {
      if (projection === "structure") {
        return {
          document: emptyPluginDocument(ref.canvasId),
          projection,
          ref,
        }
      }
      return {
        document: emptyPluginDocument(ref.canvasId),
        projection,
        ref,
      }
    },
  )
  const listCanvases = mock(async (projectId: string) => ({ canvases: [], projectId }))
  const listProjects = mock(async () => [{ available: true, id: "project-one", name: "Project One" }])
  const queryNodes = mock(async (ref: PluginCanvasRef) => ({
    nodes: [],
    projection: emptyPluginDocument(ref.canvasId),
    ref,
  }))
  const subscribe = mock(
    async (
      _ref: PluginCanvasRef | { projectId: string },
      listener: (event: PluginCanvasChangeEvent) => void,
    ): Promise<PluginCanvasEventSubscription> => {
      listeners.add(listener)
      return { close: closeSubscription }
    },
  )
  const transact = mock(async (request: PluginCanvasTransactionRequest) => ({
    affectedNodeIds: [],
    changed: false,
    createdNodeIds: [],
    operationReceipt: operationReceipt(request.commandId),
    projection: emptyPluginDocument(request.ref.canvasId),
    ref: request.ref,
    warnings: [],
  }))
  const client: PluginCanvasCapabilityClient = {
    getDocument,
    listCanvases,
    listProjects,
    queryNodes,
    subscribe,
    transact,
  }
  return {
    client,
    closeSubscription,
    emit(event: PluginCanvasChangeEvent) {
      for (const listener of listeners) listener(event)
    },
    listProjects,
  }
}

function createAuthority(
  client: PluginCanvasCapabilityClient,
  options: {
    capabilities?: ResolvedPluginPrincipal["capabilities"]
    issuedPrincipal?: PluginPrincipal
    resolvedPrincipal?: ResolvedPluginPrincipal | null
  } = {},
) {
  const issuedPrincipal = options.issuedPrincipal ?? principal
  const resolvedPrincipal =
    options.resolvedPrincipal === undefined
      ? {
          activeRevision: issuedPrincipal.activeRevision,
          activeSetDigest: issuedPrincipal.activeSetDigest,
          capabilities: options.capabilities ?? [],
          hostApi: {
            major: 3,
            optional: [],
            required: [
              "projects.list",
              "canvas.catalog.list",
              "canvas.document.get",
              "canvas.nodes.query",
              "canvas.transaction.execute",
              "canvas.events.subscribe",
              "canvas.events.unsubscribe",
            ],
          },
          manifestDigest: issuedPrincipal.manifestDigest,
          pluginId: issuedPrincipal.pluginId,
          pluginVersion: issuedPrincipal.pluginVersion,
          snapshotDigest: issuedPrincipal.snapshotDigest,
        }
      : options.resolvedPrincipal
  const issue = mock(async (_pluginId: string, _runtime: PluginCapabilityRuntimeKind) => issuedPrincipal)
  const resolve = mock(async (_principal: PluginPrincipal) => resolvedPrincipal)
  const connect = mock(async (_request: PluginCapabilityConnectionRequest) => client)
  const hostExecutions: Array<{ method: string; operationId: string }> = []
  const hostConnect = mock(
    async (request: {
      canvas: PluginCanvasCapabilityClient
      onCanvasEvent?(input: { event: PluginCanvasChangeEvent; subscriptionId: string }): void
    }) => {
      const subscriptions = new Map<string, PluginCanvasEventSubscription>()
      return {
        close() {
          for (const subscription of subscriptions.values()) subscription.close()
          subscriptions.clear()
        },
        async execute(
          call: { method: string; params?: unknown },
          context: { operationId: string; signal?: AbortSignal },
        ) {
          hostExecutions.push({ method: call.method, operationId: context.operationId })
          if (call.method === "projects.list") {
            return { projects: await request.canvas.listProjects(context.signal) }
          }
          if (call.method === "canvas.events.subscribe") {
            const params = call.params as { ref: PluginCanvasRef | { projectId: string } }
            const subscriptionId = "subscription-one"
            const subscription = await request.canvas.subscribe(
              params.ref,
              (event) => request.onCanvasEvent?.({ event, subscriptionId }),
              context.signal,
            )
            subscriptions.set(subscriptionId, subscription)
            return { subscriptionId }
          }
          if (call.method === "canvas.node.state.replace") return { updated: true }
          throw new Error(`Unexpected test Host API method: ${call.method}`)
        },
        supports() {
          return true
        },
      }
    },
  )
  const invokePlugin = mock(
    async (
      _principal: PluginPrincipal,
      _request: { capabilityId: string; input: unknown; requestId: string },
      _signal?: AbortSignal,
    ) => ({ ok: true }),
  )
  const getPluginAvailability = mock(
    async (_principal: PluginPrincipal, _capabilityId: string, _signal?: AbortSignal) => ({ available: true }),
  )
  return {
    broker: { connect } as unknown as PluginCanvasCapabilityService,
    connect,
    host: { connect: hostConnect },
    hostConnect,
    hostExecutions,
    invokePlugin,
    getPluginAvailability,
    issue,
    pluginBroker: { getAvailability: getPluginAvailability, invoke: invokePlugin },
    principals: { issue, resolve } as unknown as InstalledPluginPrincipalResolver,
    resolve,
  }
}

async function register(
  authority: ReturnType<typeof createAuthority>,
  isTrustedSender: (event: TestEvent) => boolean = () => true,
) {
  const { pluginCapabilityIpcChannels } = await import("../plugin-capability-ipc")
  const { registerPluginCapabilityIpc } = await import("./plugin-capability-ipc")
  const disposeRegistration = registerPluginCapabilityIpc({
    broker: authority.broker,
    host: authority.host as never,
    isTrustedSender: isTrustedSender as never,
    pluginBroker: authority.pluginBroker as never,
    principals: authority.principals,
  })
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    disposers.delete(dispose)
    disposeRegistration()
  }
  disposers.add(dispose)
  return { dispose, pluginCapabilityIpcChannels }
}

function invoke(channel: string, input: unknown, sender: TestSender) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender }, input)
}

async function connect(channel: string, sender: TestSender) {
  return (await invoke(channel, connectInput, sender)) as {
    connectionId: string
    protocol: typeof pluginCapabilityProtocolV3
  }
}

describe("registerPluginCapabilityIpc", () => {
  test("rejects every operation from an untrusted renderer before observing or resolving it", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority, (event) => event.sender.id === 1)
    const sender = new TestSender(2)

    for (const [channel, input] of [
      [pluginCapabilityIpcChannels.connect, connectInput],
      [
        pluginCapabilityIpcChannels.call,
        { connectionId: "stolen", operationId: "operation-stolen", request: capabilityRequest("projects.list") },
      ],
      [pluginCapabilityIpcChannels.disconnect, { connectionId: "stolen" }],
      [
        pluginCapabilityIpcChannels.getPluginAvailability,
        { capabilityId: "video.render", connectionId: "stolen", operationId: "operation-stolen" },
      ],
    ] as const) {
      await expect(Promise.resolve(invoke(channel, input, sender))).rejects.toThrow(
        "Untrusted Plugin capability sender",
      )
    }

    expect(sender.listenerCount("destroyed")).toBe(0)
    expect(authority.issue).not.toHaveBeenCalled()
    expect(authority.connect).not.toHaveBeenCalled()
  })

  test("validates the Web connect envelope before issuing a principal", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const invalidInputs: unknown[] = [
      undefined,
      null,
      [],
      {},
      { ...connectInput, runtime: "tool" },
      { ...connectInput, activeRevision: -1 },
      { ...connectInput, activeSetDigest: "not-a-digest" },
      { ...connectInput, canvasId: "" },
      { ...connectInput, nodeId: "node\0forged" },
      { ...connectInput, pluginId: 1 },
      { ...connectInput, pluginId: " plugin-one" },
      { ...connectInput, pluginVersion: null },
      { ...connectInput, pluginVersion: "v".repeat(129) },
      { ...connectInput, projectId: {} },
      { ...connectInput, projectId: "project-one\0forged" },
      { ...connectInput, snapshotDigest: "not-a-digest" },
    ]

    for (const input of invalidInputs) {
      await expect(Promise.resolve(invoke(pluginCapabilityIpcChannels.connect, input, sender))).rejects.toThrow(
        "Plugin capability connection request is invalid",
      )
    }

    expect(sender.listenerCount("destroyed")).toBe(1)
    expect(authority.issue).not.toHaveBeenCalled()
    expect(authority.resolve).not.toHaveBeenCalled()
    expect(authority.connect).not.toHaveBeenCalled()
  })

  test("fails closed when the issued generation changed or the issued principal no longer resolves", async () => {
    const client = createClient()
    const changedAuthority = createAuthority(client.client, {
      issuedPrincipal: { ...principal, pluginVersion: "2.0.0" },
    })
    const changedRegistration = await register(changedAuthority)

    await expect(
      Promise.resolve(invoke(changedRegistration.pluginCapabilityIpcChannels.connect, connectInput, new TestSender(1))),
    ).rejects.toThrow("Plugin generation changed before its capability connection was established")
    expect(changedAuthority.resolve).not.toHaveBeenCalled()
    expect(changedAuthority.connect).not.toHaveBeenCalled()
    changedRegistration.dispose()

    const sameVersionNewSnapshotAuthority = createAuthority(client.client, {
      issuedPrincipal: { ...principal, snapshotDigest: "c".repeat(64) },
    })
    const sameVersionNewSnapshotRegistration = await register(sameVersionNewSnapshotAuthority)
    await expect(
      Promise.resolve(
        invoke(sameVersionNewSnapshotRegistration.pluginCapabilityIpcChannels.connect, connectInput, new TestSender(2)),
      ),
    ).rejects.toThrow("Plugin generation changed before its capability connection was established")
    expect(sameVersionNewSnapshotAuthority.resolve).not.toHaveBeenCalled()
    expect(sameVersionNewSnapshotAuthority.connect).not.toHaveBeenCalled()
    sameVersionNewSnapshotRegistration.dispose()

    const invalidAuthority = createAuthority(client.client, { resolvedPrincipal: null })
    const invalidRegistration = await register(invalidAuthority)
    await expect(
      Promise.resolve(invoke(invalidRegistration.pluginCapabilityIpcChannels.connect, connectInput, new TestSender(3))),
    ).rejects.toThrow("Plugin capability principal changed while connecting")
    expect(invalidAuthority.connect).not.toHaveBeenCalled()
  })

  test("issues opaque sender-scoped connections and derives scope only from resolved capabilities", async () => {
    const client = createClient()
    const authority = createAuthority(client.client, { capabilities: ["projects.read"] })
    const { pluginCapabilityIpcChannels } = await register(authority)
    const firstSender = new TestSender(1)
    const secondSender = new TestSender(2)

    const first = await connect(pluginCapabilityIpcChannels.connect, firstSender)
    const second = await connect(pluginCapabilityIpcChannels.connect, secondSender)

    expect(first).toEqual({ connectionId: expect.any(String), protocol: pluginCapabilityProtocolV3 })
    expect(first.connectionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(second.connectionId).not.toBe(first.connectionId)
    expect(first).not.toHaveProperty("principal")
    expect(first).not.toHaveProperty("projectId")
    expect(authority.issue).toHaveBeenCalledTimes(2)
    expect(authority.issue).toHaveBeenCalledWith(principal.pluginId, "web")
    expect(authority.connect).toHaveBeenCalledTimes(2)
    expect(authority.connect).toHaveBeenCalledWith({
      principal,
      scope: { kind: "all-bound-projects" },
    })
    expect(firstSender.listenerCount("destroyed")).toBe(1)
    expect(secondSender.listenerCount("destroyed")).toBe(1)
  })

  test("routes calls through the bound connection and rejects cross-sender theft", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority)
    const owner = new TestSender(1)
    const other = new TestSender(2)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, owner)
    const call = {
      connectionId,
      operationId: "operation-project-list",
      request: capabilityRequest("projects.list"),
    }

    await expect(Promise.resolve(invoke(pluginCapabilityIpcChannels.call, call, other))).rejects.toThrow(
      "Plugin capability connection was not found",
    )
    await expect(
      Promise.resolve(invoke(pluginCapabilityIpcChannels.disconnect, { connectionId }, other)),
    ).resolves.toBe(false)
    await expect(Promise.resolve(invoke(pluginCapabilityIpcChannels.call, call, owner))).resolves.toEqual({
      id: "request-projects.list",
      ok: true,
      protocol: pluginCapabilityProtocolV3,
      result: { projects: [{ available: true, id: "project-one", name: "Project One" }] },
      type: "response",
    })
    expect(client.listProjects).toHaveBeenCalledTimes(1)
    expect(authority.connect).toHaveBeenCalledWith({
      principal,
      scope: { kind: "project", projectId: connectInput.projectId },
    })
  })

  test("projects typed Host API authorization, stale and resource failures without leaking diagnostics", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    authority.host.connect = mock(async () => ({
      close() {},
      async execute(call: { method: string }) {
        if (call.method === "projects.list") {
          throw new PluginHostApiError(
            "permission-denied",
            "Plugin plugin-one lacks projects.read in secret snapshot digest",
          )
        }
        if (call.method === "canvas.catalog.list") {
          throw new PluginHostApiError("stale-context", "secret ActiveSet digest changed")
        }
        throw new PluginHostApiResourceUnavailableError("secret Project native path")
      },
      supports() {
        return true
      },
    })) as never
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)

    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.call,
          {
            connectionId,
            operationId: "operation-denied",
            request: capabilityRequest("projects.list"),
          },
          sender,
        ),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "permission-denied",
        kind: "api",
        message: "Plugin Host API permission was denied",
        recoverable: false,
      },
      ok: false,
    })
    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.call,
          {
            connectionId,
            operationId: "operation-stale",
            request: capabilityRequest("canvas.catalog.list", { projectId: "project-one" }),
          },
          sender,
        ),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "stale-context",
        kind: "api",
        message: "Plugin Host API context is stale",
        recoverable: true,
      },
      ok: false,
    })
    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.call,
          {
            connectionId,
            operationId: "operation-resource",
            request: capabilityRequest("canvas.inputs.open", {
              inputKey: "missing-input",
            }),
          },
          sender,
        ),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "resource-unavailable",
        kind: "api",
        message: "Plugin Host API resource is unavailable",
        recoverable: true,
      },
      ok: false,
    })
  })

  test("projects admitted P2P broker failures and keeps unknown failures opaque", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    authority.invokePlugin.mockImplementation(async (_principal, request) => {
      switch (request.capabilityId) {
        case "fixture.depth":
          throw new PluginCapabilityBrokerError("depth-exceeded", "secret call chain")
        case "fixture.reentry":
          throw new PluginCapabilityBrokerError("reentrant-call", "secret provider id")
        case "fixture.input":
          throw new PluginCapabilityBrokerError("invalid-request", "secret input payload")
        case "fixture.unknown":
          throw new Error("secret stack, token, path and provider output")
        default:
          return { ok: true }
      }
    })
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    const cases = [
      ["fixture.depth", "depth-exceeded", "Plugin capability call depth was exceeded", false],
      ["fixture.reentry", "reentrant-call", "Plugin capability re-entry is forbidden", false],
      ["fixture.input", "invalid-input", "Plugin capability input is invalid", false],
    ] as const

    for (const [capabilityId, code, message, recoverable] of cases) {
      await expect(
        Promise.resolve(
          invoke(
            pluginCapabilityIpcChannels.invokePlugin,
            {
              connectionId,
              operationId: `operation-${capabilityId}`,
              request: {
                capabilityId,
                input: {},
                requestId: `request-${capabilityId}`,
              },
            },
            sender,
          ),
        ),
      ).resolves.toMatchObject({
        error: { code, kind: "capability", message, recoverable },
        ok: false,
        protocol: pluginCapabilityProtocolV3,
      })
    }

    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.invokePlugin,
          {
            connectionId,
            operationId: "operation-unknown",
            request: {
              capabilityId: "fixture.unknown",
              input: {},
              requestId: "request-unknown",
            },
          },
          sender,
        ),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "internal-error",
        kind: "protocol",
        message: "Plugin Host request failed",
        recoverable: false,
      },
      ok: false,
    })
  })

  test("replays one sender-scoped mutation operation id exactly once and rejects payload reuse", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    const first = {
      connectionId,
      operationId: "operation-state-retry",
      request: capabilityRequest("canvas.node.state.replace", { state: { value: 1 } }),
    }

    const [left, right] = await Promise.all([
      invoke(pluginCapabilityIpcChannels.call, first, sender),
      invoke(pluginCapabilityIpcChannels.call, first, sender),
    ])
    expect(left).toEqual(right)
    expect(authority.hostExecutions.filter(({ method }) => method === "canvas.node.state.replace")).toHaveLength(1)

    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.call,
          {
            ...first,
            request: capabilityRequest("canvas.node.state.replace", { state: { value: 2 } }),
          },
          sender,
        ),
      ),
    ).resolves.toMatchObject({
      error: {
        code: "invalid-request",
        kind: "protocol",
        message: "Plugin Host request is invalid",
        recoverable: false,
      },
      ok: false,
    })
  })

  test("sender destruction aborts an in-flight Main Host API call", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const started = deferred<void>()
    authority.host.connect = mock(async () => ({
      close() {},
      async execute(_call: unknown, context: { operationId: string; signal?: AbortSignal }) {
        started.resolve()
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(context.signal?.reason ?? new Error("aborted"))
          if (context.signal?.aborted) abort()
          else context.signal?.addEventListener("abort", abort, { once: true })
        })
      },
      supports() {
        return true
      },
    })) as never
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    const pending = Promise.resolve(
      invoke(
        pluginCapabilityIpcChannels.call,
        {
          connectionId,
          operationId: "operation-open",
          request: capabilityRequest("canvas.inputs.open", { inputKey: "source-1" }),
        },
        sender,
      ),
    )
    await started.promise
    sender.destroy()

    await expect(pending).resolves.toMatchObject({
      error: {
        code: "internal-error",
        kind: "protocol",
        message: "Plugin Host request failed",
        recoverable: false,
      },
      ok: false,
    })
  })

  test("registers availability as a cancelable operation and clears it after abort", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const started = deferred<void>()
    let observedSignal: AbortSignal | undefined
    authority.getPluginAvailability.mockImplementation(
      async (_principal, _capabilityId, signal) => {
        observedSignal = signal
        started.resolve()
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal?.reason ?? new Error("aborted"))
          if (signal?.aborted) abort()
          else signal?.addEventListener("abort", abort, { once: true })
        })
        return { available: true }
      },
    )
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    const input = {
      capabilityId: "video.render",
      connectionId,
      operationId: "operation-availability",
    }
    const pending = Promise.resolve(
      invoke(pluginCapabilityIpcChannels.getPluginAvailability, input, sender),
    )
    await started.promise

    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.cancel,
          { connectionId, operationId: input.operationId },
          sender,
        ),
      ),
    ).resolves.toBe(true)
    await expect(pending).rejects.toThrow("canceled")
    expect(observedSignal?.aborted).toBeTrue()
    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.cancel,
          { connectionId, operationId: input.operationId },
          sender,
        ),
      ),
    ).resolves.toBe(false)
  })

  test("disconnect closes owned subscriptions and invalidates the opaque id", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    const subscribeCall = {
      connectionId,
      operationId: "operation-subscribe",
      request: capabilityRequest("canvas.events.subscribe", { ref: { projectId: "project-one" } }),
    }

    await expect(
      Promise.resolve(invoke(pluginCapabilityIpcChannels.call, subscribeCall, sender)),
    ).resolves.toMatchObject({ ok: true, result: { subscriptionId: expect.any(String) } })
    await expect(
      Promise.resolve(invoke(pluginCapabilityIpcChannels.disconnect, { connectionId }, sender)),
    ).resolves.toBe(true)
    expect(client.closeSubscription).toHaveBeenCalledTimes(1)
    await expect(
      Promise.resolve(invoke(pluginCapabilityIpcChannels.disconnect, { connectionId }, sender)),
    ).resolves.toBe(false)
    await expect(Promise.resolve(invoke(pluginCapabilityIpcChannels.call, subscribeCall, sender))).rejects.toThrow(
      "Plugin capability connection was not found",
    )
  })

  test("automatically closes sender connections when the renderer is destroyed", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    await invoke(
      pluginCapabilityIpcChannels.call,
      {
        connectionId,
        operationId: "operation-subscribe",
        request: capabilityRequest("canvas.events.subscribe", { ref: { projectId: "project-one" } }),
      },
      sender,
    )
    const event: PluginCanvasChangeEvent = {
      operationReceipt: operationReceipt("operation-event-2"),
      ref: { canvasId: "canvas-one", projectId: "project-one" },
      source: "host",
    }

    client.emit(event)
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith(pluginCapabilityIpcChannels.changed, {
      command: expect.objectContaining({
        command: "canvas.document.changed",
        params: expect.objectContaining({ event }),
        protocol: pluginCapabilityProtocolV3,
      }),
      connectionId,
    })
    sender.destroy()
    expect(client.closeSubscription).toHaveBeenCalledTimes(1)
    client.emit({ ...event, operationReceipt: operationReceipt("operation-event-3") })
    expect(sender.send).toHaveBeenCalledTimes(1)
    await expect(
      Promise.resolve(
        invoke(
          pluginCapabilityIpcChannels.call,
          {
            connectionId,
            operationId: "operation-after-destroy",
            request: capabilityRequest("projects.list"),
          },
          sender,
        ),
      ),
    ).rejects.toThrow("Plugin capability connection was not found")
  })

  test("reserves pending connection slots and rejects publication after sender destruction", async () => {
    let releaseIssue!: () => void
    const issueGate = new Promise<void>((resolve) => {
      releaseIssue = resolve
    })
    const client = createClient()
    const authority = createAuthority(client.client)
    authority.issue.mockImplementation(async () => {
      await issueGate
      return principal
    })
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const pending = Array.from({ length: 128 }, () =>
      Promise.resolve(invoke(pluginCapabilityIpcChannels.connect, connectInput, sender)),
    )

    await expect(Promise.resolve(invoke(pluginCapabilityIpcChannels.connect, connectInput, sender))).rejects.toThrow(
      "exceeds 128",
    )
    expect(authority.issue).toHaveBeenCalledTimes(128)
    sender.destroy()
    releaseIssue()
    const settled = await Promise.allSettled(pending)
    expect(settled.every((result) => result.status === "rejected")).toBeTrue()
    expect(authority.resolve).not.toHaveBeenCalled()
    expect(authority.connect).not.toHaveBeenCalled()
  })

  test("prevents an in-flight connect from publishing after IPC disposal", async () => {
    let releaseIssue!: () => void
    const issueGate = new Promise<void>((resolve) => {
      releaseIssue = resolve
    })
    const client = createClient()
    const authority = createAuthority(client.client)
    authority.issue.mockImplementation(async () => {
      await issueGate
      return principal
    })
    const registration = await register(authority)
    const connecting = Promise.resolve(
      invoke(registration.pluginCapabilityIpcChannels.connect, connectInput, new TestSender(1)),
    )

    registration.dispose()
    releaseIssue()
    await expect(connecting).rejects.toThrow("IPC was disposed while connecting")
    expect(authority.resolve).not.toHaveBeenCalled()
    expect(authority.connect).not.toHaveBeenCalled()
  })

  test("dispose removes every handler and closes every live connection", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const registration = await register(authority)
    const { pluginCapabilityIpcChannels } = registration
    const senders = [new TestSender(1), new TestSender(2)]
    for (const sender of senders) {
      const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
      await invoke(
        pluginCapabilityIpcChannels.call,
        {
          connectionId,
          operationId: `operation-subscribe-${sender.id}`,
          request: capabilityRequest("canvas.events.subscribe", { ref: { projectId: "project-one" } }),
        },
        sender,
      )
    }

    registration.dispose()

    expect(client.closeSubscription).toHaveBeenCalledTimes(2)
    expect(handlers.size).toBe(0)
    expect(removedHandlers).toEqual([
      pluginCapabilityIpcChannels.connect,
      pluginCapabilityIpcChannels.call,
      pluginCapabilityIpcChannels.cancel,
      pluginCapabilityIpcChannels.disconnect,
      pluginCapabilityIpcChannels.getPluginAvailability,
      pluginCapabilityIpcChannels.invokePlugin,
    ])
    senders.forEach((sender) => expect(sender.listenerCount("destroyed")).toBe(0))
    senders.forEach((sender) => sender.destroy())
    expect(client.closeSubscription).toHaveBeenCalledTimes(2)
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
