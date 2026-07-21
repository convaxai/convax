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
import { pluginCapabilityProtocolV1 } from "../plugin-host-protocol"
import type { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
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
  for (const dispose of [...disposers]) dispose()
  handlers.clear()
  removedHandlers.splice(0)
})

const principal: PluginPrincipal = {
  manifestDigest: "sha256:plugin-one",
  pluginId: "plugin-one",
  pluginVersion: "1.0.0",
  runtime: "web",
}

const connectInput: PluginCapabilityConnectInput = {
  pluginId: principal.pluginId,
  pluginVersion: principal.pluginVersion,
  projectId: "project-one",
  runtime: "web",
}

function capabilityRequest(method: string, params?: unknown) {
  return {
    id: `request-${method}`,
    method,
    ...(params === undefined ? {} : { params }),
    protocol: pluginCapabilityProtocolV1,
    type: "request",
  }
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
          document: { edges: [], id: ref.canvasId, nodes: [], revision: 1, title: "Main" },
          projection,
          ref,
          storageVersion: "v1",
        }
      }
      return {
        document: { edges: [], id: ref.canvasId, nodes: [], revision: 1, title: "Main" },
        projection,
        ref,
        storageVersion: "v1",
      }
    },
  )
  const listCanvases = mock(async (projectId: string) => ({ canvases: [], projectId }))
  const listProjects = mock(async () => [{ available: true, id: "project-one", name: "Project One" }])
  const queryNodes = mock(async (ref: PluginCanvasRef) => ({
    nodes: [],
    ref,
    revision: 1,
    storageVersion: "v1",
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
    ref: request.ref,
    revision: request.expectedRevision,
    storageVersion: "v1",
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
          capabilities: options.capabilities ?? [],
          manifestDigest: issuedPrincipal.manifestDigest,
          pluginId: issuedPrincipal.pluginId,
          pluginVersion: issuedPrincipal.pluginVersion,
        }
      : options.resolvedPrincipal
  const issue = mock(async (_pluginId: string, _runtime: PluginCapabilityRuntimeKind) => issuedPrincipal)
  const resolve = mock(async (_principal: PluginPrincipal) => resolvedPrincipal)
  const connect = mock(async (_request: PluginCapabilityConnectionRequest) => client)
  return {
    broker: { connect } as unknown as PluginCanvasCapabilityService,
    connect,
    issue,
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
    isTrustedSender: isTrustedSender as never,
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
    protocol: typeof pluginCapabilityProtocolV1
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
      [pluginCapabilityIpcChannels.call, { connectionId: "stolen", request: capabilityRequest("projects.list") }],
      [pluginCapabilityIpcChannels.disconnect, { connectionId: "stolen" }],
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
      { ...connectInput, pluginId: 1 },
      { ...connectInput, pluginId: " plugin-one" },
      { ...connectInput, pluginVersion: null },
      { ...connectInput, pluginVersion: "v".repeat(129) },
      { ...connectInput, projectId: {} },
      { ...connectInput, projectId: "project-one\0forged" },
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

  test("fails closed when the issued version changed or the issued principal no longer resolves", async () => {
    const client = createClient()
    const changedAuthority = createAuthority(client.client, {
      issuedPrincipal: { ...principal, pluginVersion: "2.0.0" },
    })
    const changedRegistration = await register(changedAuthority)

    await expect(
      Promise.resolve(invoke(changedRegistration.pluginCapabilityIpcChannels.connect, connectInput, new TestSender(1))),
    ).rejects.toThrow("Plugin changed before its capability connection was established")
    expect(changedAuthority.resolve).not.toHaveBeenCalled()
    expect(changedAuthority.connect).not.toHaveBeenCalled()
    changedRegistration.dispose()

    const invalidAuthority = createAuthority(client.client, { resolvedPrincipal: null })
    const invalidRegistration = await register(invalidAuthority)
    await expect(
      Promise.resolve(invoke(invalidRegistration.pluginCapabilityIpcChannels.connect, connectInput, new TestSender(2))),
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

    expect(first).toEqual({ connectionId: expect.any(String), protocol: pluginCapabilityProtocolV1 })
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
      protocol: pluginCapabilityProtocolV1,
      result: { projects: [{ available: true, id: "project-one", name: "Project One" }] },
      type: "response",
    })
    expect(client.listProjects).toHaveBeenCalledTimes(1)
    expect(authority.connect).toHaveBeenCalledWith({
      principal,
      scope: { kind: "project", projectId: connectInput.projectId },
    })
  })

  test("disconnect closes owned subscriptions and invalidates the opaque id", async () => {
    const client = createClient()
    const authority = createAuthority(client.client)
    const { pluginCapabilityIpcChannels } = await register(authority)
    const sender = new TestSender(1)
    const { connectionId } = await connect(pluginCapabilityIpcChannels.connect, sender)
    const subscribeCall = {
      connectionId,
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
        request: capabilityRequest("canvas.events.subscribe", { ref: { projectId: "project-one" } }),
      },
      sender,
    )
    const event: PluginCanvasChangeEvent = {
      ref: { canvasId: "canvas-one", projectId: "project-one" },
      revision: 2,
      source: "host",
    }

    client.emit(event)
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith(pluginCapabilityIpcChannels.changed, {
      command: expect.objectContaining({
        command: "canvas.document.changed",
        params: expect.objectContaining({ event }),
        protocol: pluginCapabilityProtocolV1,
      }),
      connectionId,
    })
    sender.destroy()
    expect(client.closeSubscription).toHaveBeenCalledTimes(1)
    client.emit({ ...event, revision: 3 })
    expect(sender.send).toHaveBeenCalledTimes(1)
    await expect(
      Promise.resolve(
        invoke(pluginCapabilityIpcChannels.call, { connectionId, request: capabilityRequest("projects.list") }, sender),
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
      pluginCapabilityIpcChannels.disconnect,
    ])
    senders.forEach((sender) => expect(sender.listenerCount("destroyed")).toBe(0))
    senders.forEach((sender) => sender.destroy())
    expect(client.closeSubscription).toHaveBeenCalledTimes(2)
  })
})
