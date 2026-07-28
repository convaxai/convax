import { describe, expect, mock, spyOn, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  PetSettingsFrameLifecycle,
  PetSettingsFrameRelay,
  PetSettingsHost,
  PetSettingsProviderLoader,
  type PetSettingsHostClient,
  type PetSettingsProvider,
} from "./pet-settings-host"

type PreloadPortListener = (event: { ports?: Array<{ close(): void }> }, envelope: unknown) => void

const preloadInvoke = mock(async (_channel: string, _input?: unknown) => undefined)
const preloadListeners = new Map<string, PreloadPortListener>()
interface TestPreloadPetSettingsClient extends PetSettingsHostClient {
  disconnectSettings(input: TestConnectionIdentity): Promise<void>
  onNavigate(listener: (target: unknown) => void): () => void
}

let exposedPreloadBridge: { pets: TestPreloadPetSettingsClient } | undefined

mock.module("electron", () => ({
  contextBridge: {
    exposeInMainWorld(name: string, value: { pets: TestPreloadPetSettingsClient }) {
      if (name === "convax") exposedPreloadBridge = value
    },
  },
  ipcRenderer: {
    invoke: preloadInvoke,
    on(channel: string, listener: PreloadPortListener) {
      preloadListeners.set(channel, listener)
    },
    removeListener(channel: string, listener: PreloadPortListener) {
      if (preloadListeners.get(channel) === listener) preloadListeners.delete(channel)
    },
    send: mock(() => undefined),
  },
  webUtils: {
    getPathForFile: mock(() => ""),
  },
}))

const provider: PetSettingsProvider = {
  generation: 7,
  pluginId: "soft-companion",
  settingsUrl: "convax-plugin://soft-companion/settings/index.html",
}

function createClient(): PetSettingsHostClient {
  return {
    connectSettings: mock(async () => undefined),
    disconnectSettings: mock(() => undefined),
    getProvider: mock(async () => provider),
    onProviderChanged: mock(() => () => undefined),
  }
}

function createPort() {
  return { close: mock(() => undefined) }
}

interface TestConnectionIdentity {
  connectionId: string
  generation: number
  pluginId: string
}

function connectedIdentity(client: PetSettingsHostClient, index = 0) {
  return (client.connectSettings as ReturnType<typeof mock>).mock.calls[index]![0] as TestConnectionIdentity
}

function connectEnvelope(identity: TestConnectionIdentity, input: Partial<Record<string, unknown>> = {}) {
  return {
    ...identity,
    protocol: "convax.pet-host/1",
    surface: "settings",
    type: "connect",
    ...input,
  }
}

async function loadPreloadHarness(postMessage = mock(() => undefined)) {
  const preloadWindow = { postMessage } as unknown as Window & typeof globalThis
  Object.defineProperty(preloadWindow, "top", { value: preloadWindow })
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, "window", { configurable: true, value: preloadWindow })
  try {
    await import("../preload/index")
  } catch (error) {
    restoreWindow()
    throw error
  }
  const client = exposedPreloadBridge?.pets
  const receivePort = preloadListeners.get("pet:settings-port")
  if (!client || !receivePort) {
    restoreWindow()
    throw new Error("Pet settings preload bridge was not exposed")
  }
  return { client, postMessage, receivePort, restoreWindow }

  function restoreWindow() {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window")
    } else {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow })
    }
  }
}

async function flushPreloadPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("PetSettingsHost", () => {
  test("renders only the installed provider settings iframe with the exact sandbox", () => {
    const markup = renderToStaticMarkup(<PetSettingsHost client={createClient()} provider={provider} />)

    expect(markup).toContain('src="convax-plugin://soft-companion/settings/index.html"')
    expect(markup).toContain('sandbox="allow-scripts"')
    expect(markup).not.toContain("allow-same-origin")
    expect(markup).not.toContain('type="file"')
    expect(markup).not.toContain("Import")
    expect(markup).not.toContain("Delete")
    expect(markup).not.toContain("Upload")
  })

  test("renders a generic unavailable shell instead of a dead settings iframe", () => {
    const markup = renderToStaticMarkup(
      <PetSettingsHost client={createClient()} frameStatus="unavailable" provider={provider} />,
    )

    expect(markup).toContain('data-pet-settings-status="unavailable"')
    expect(markup).toContain("Pet provider unavailable.")
    expect(markup).not.toContain("iframe")
  })

  test("requests one fixed settings connection after frame load and forwards one exact port", async () => {
    const client = createClient()
    const hostWindow = {}
    const frameWindow = { postMessage: mock(() => undefined) }
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow, provider })

    await relay.frameLoaded()
    expect(client.connectSettings).toHaveBeenCalledTimes(1)
    const identity = connectedIdentity(client)
    expect(identity).toEqual({
      connectionId: expect.stringMatching(
        /^settings-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      generation: provider.generation,
      pluginId: provider.pluginId,
    })

    const port = createPort()
    expect(
      relay.receive({
        data: connectEnvelope(identity),
        ports: [port],
        source: hostWindow,
      }),
    ).toBeTrue()
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1)
    expect(frameWindow.postMessage).toHaveBeenCalledWith(connectEnvelope(identity), "*", [port])
    expect(port.close).not.toHaveBeenCalled()
  })

  test("rejects overlay, stale, duplicate, foreign-source, and multi-port relays", async () => {
    const client = createClient()
    const hostWindow = {}
    const frameWindow = { postMessage: mock(() => undefined) }
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow, provider })
    await relay.frameLoaded()

    const identity = connectedIdentity(client)
    for (const event of [
      { data: connectEnvelope(identity, { surface: "overlay" }), ports: [createPort()], source: hostWindow },
      { data: connectEnvelope(identity, { generation: 8 }), ports: [createPort()], source: hostWindow },
      { data: connectEnvelope(identity), ports: [createPort()], source: {} },
      { data: connectEnvelope(identity), ports: [createPort(), createPort()], source: hostWindow },
    ]) {
      expect(relay.receive(event)).toBeFalse()
      for (const port of event.ports) expect(port.close).toHaveBeenCalledTimes(1)
    }

    const acceptedPort = createPort()
    expect(relay.receive({ data: connectEnvelope(identity), ports: [acceptedPort], source: hostWindow })).toBeTrue()
    const duplicatePort = createPort()
    expect(relay.receive({ data: connectEnvelope(identity), ports: [duplicatePort], source: hostWindow })).toBeFalse()
    expect(duplicatePort.close).toHaveBeenCalledTimes(1)
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1)
  })

  test("disconnects the fixed old identity on provider change and dispose", async () => {
    const client = createClient()
    const relay = new PetSettingsFrameRelay({
      client,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })
    await relay.frameLoaded()

    const firstIdentity = connectedIdentity(client)
    const nextProvider: PetSettingsProvider = {
      generation: 8,
      pluginId: provider.pluginId,
      settingsUrl: provider.settingsUrl,
    }
    await relay.replaceProvider(nextProvider)

    expect(client.disconnectSettings).toHaveBeenCalledTimes(1)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(1, firstIdentity)

    await relay.frameLoaded()
    const secondIdentity = connectedIdentity(client, 1)
    expect(client.connectSettings).toHaveBeenLastCalledWith(secondIdentity)
    await relay.dispose()
    await relay.dispose()
    expect(client.disconnectSettings).toHaveBeenCalledTimes(2)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(2, secondIdentity)
  })

  test("closes a port when forwarding to the opaque-origin frame fails", async () => {
    const client = createClient()
    const relay = new PetSettingsFrameRelay({
      client,
      frameWindow: {
        postMessage: mock(() => {
          throw new Error("frame closed")
        }),
      },
      hostWindow: {},
      provider,
    })
    await relay.frameLoaded()
    const port = createPort()
    const identity = connectedIdentity(client)

    expect(relay.receive({ data: connectEnvelope(identity), ports: [port], source: relay.hostWindow })).toBeFalse()
    expect(port.close).toHaveBeenCalledTimes(1)
    expect(client.disconnectSettings).toHaveBeenCalledWith(identity)
  })

  test("opens a fresh scoped connection for every frame load and rejects the prior load port", async () => {
    const client = createClient()
    const hostWindow = {}
    const frameWindow = { postMessage: mock(() => undefined) }
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow, provider })

    await relay.frameLoaded()
    const firstIdentity = connectedIdentity(client)
    const firstPort = createPort()
    expect(relay.receive({ data: connectEnvelope(firstIdentity), ports: [firstPort], source: hostWindow })).toBeTrue()

    await relay.frameLoaded()
    const secondIdentity = connectedIdentity(client, 1)
    expect(secondIdentity.connectionId).not.toBe(firstIdentity.connectionId)
    expect(client.disconnectSettings).toHaveBeenCalledWith(firstIdentity)

    const stalePort = createPort()
    expect(relay.receive({ data: connectEnvelope(firstIdentity), ports: [stalePort], source: hostWindow })).toBeFalse()
    expect(stalePort.close).toHaveBeenCalledTimes(1)
    const freshPort = createPort()
    expect(relay.receive({ data: connectEnvelope(secondIdentity), ports: [freshPort], source: hostWindow })).toBeTrue()
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(2)
  })

  test("keeps connection identities fresh across relay instances", async () => {
    const client = createClient()
    const hostWindow = {}
    const firstRelay = new PetSettingsFrameRelay({
      client,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow,
      provider,
    })
    await firstRelay.frameLoaded()
    const firstIdentity = connectedIdentity(client)
    await firstRelay.dispose()

    const frameWindow = { postMessage: mock(() => undefined) }
    const secondRelay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow, provider })
    await secondRelay.frameLoaded()
    const secondIdentity = connectedIdentity(client, 1)
    expect(secondIdentity.connectionId).not.toBe(firstIdentity.connectionId)

    const stalePort = createPort()
    expect(
      secondRelay.receive({ data: connectEnvelope(firstIdentity), ports: [stalePort], source: hostWindow }),
    ).toBeFalse()
    expect(stalePort.close).toHaveBeenCalledTimes(1)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()

    const freshPort = createPort()
    expect(
      secondRelay.receive({ data: connectEnvelope(secondIdentity), ports: [freshPort], source: hostWindow }),
    ).toBeTrue()
    expect(frameWindow.postMessage).toHaveBeenCalledWith(connectEnvelope(secondIdentity), "*", [freshPort])
  })

  test("uses an injected bounded connection id factory", async () => {
    const client = createClient()
    const createConnectionId = mock(() => "settings-test-connection")
    const relay = new PetSettingsFrameRelay({
      client,
      createConnectionId,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })

    await relay.frameLoaded()

    expect(createConnectionId).toHaveBeenCalledTimes(1)
    expect(connectedIdentity(client).connectionId).toBe("settings-test-connection")
  })

  test("contains an invalid oversized injected connection id", async () => {
    const client = createClient()
    const relay = new PetSettingsFrameRelay({
      client,
      createConnectionId: () => `settings-${"x".repeat(80)}`,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })

    await expect(relay.frameLoaded()).resolves.toBeUndefined()

    expect(client.connectSettings).not.toHaveBeenCalled()
    expect(relay.getStatus()).toBe("unavailable")
  })

  test("default connection ids remain unique across relay instances", async () => {
    const client = createClient()
    const first = new PetSettingsFrameRelay({ client, frameWindow: { postMessage() {} }, hostWindow: {}, provider })
    const second = new PetSettingsFrameRelay({ client, frameWindow: { postMessage() {} }, hostWindow: {}, provider })
    await first.frameLoaded()
    await second.frameLoaded()

    const firstId = connectedIdentity(client).connectionId
    const secondId = connectedIdentity(client, 1).connectionId
    expect(firstId).not.toBe(secondId)
    expect(firstId.length).toBeLessThanOrEqual(80)
    expect(secondId.length).toBeLessThanOrEqual(80)
  })

  test("contains connection rejection and exposes an unavailable state before cleanup", async () => {
    const client = createClient()
    client.connectSettings = mock(async () => {
      throw new Error("main rejected settings connection")
    })
    const relay = new PetSettingsFrameRelay({
      client,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })
    const states: string[] = []
    relay.subscribeStatus((status) => states.push(status))

    await expect(relay.frameLoaded()).resolves.toBeUndefined()
    expect(relay.getStatus()).toBe("unavailable")
    expect(states).toContain("unavailable")
    const identity = connectedIdentity(client)
    await relay.dispose()
    expect(client.disconnectSettings).toHaveBeenCalledWith(identity)
  })

  test("disconnects a pending connect again when it settles after a reload", async () => {
    const pending = deferred<void>()
    const client = createClient()
    client.connectSettings = mock(() =>
      (client.connectSettings as ReturnType<typeof mock>).mock.calls.length === 1 ? pending.promise : Promise.resolve(),
    )
    const relay = new PetSettingsFrameRelay({
      client,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })

    const firstLoad = relay.frameLoaded()
    await Promise.resolve()
    const firstIdentity = connectedIdentity(client)
    await relay.frameLoaded()
    expect(client.disconnectSettings).toHaveBeenCalledTimes(1)
    expect(client.disconnectSettings).toHaveBeenLastCalledWith(firstIdentity)

    pending.reject(new Error("stale connect failed"))
    await firstLoad
    expect(client.disconnectSettings).toHaveBeenCalledTimes(2)
    expect(client.disconnectSettings).toHaveBeenLastCalledWith(firstIdentity)
    expect(relay.getStatus()).not.toBe("unavailable")
  })

  test("disconnects a pending connect again when it settles after provider replacement", async () => {
    const pending = deferred<void>()
    const client = createClient()
    client.connectSettings = mock(() => pending.promise)
    const relay = new PetSettingsFrameRelay({
      client,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })

    const load = relay.frameLoaded()
    await Promise.resolve()
    const identity = connectedIdentity(client)
    await relay.replaceProvider({ ...provider, generation: provider.generation + 1 })
    pending.resolve()
    await load

    expect(client.disconnectSettings).toHaveBeenCalledTimes(2)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(1, identity)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(2, identity)
    expect(relay.getStatus()).toBe("idle")
  })

  test("disconnects a pending connect again when it settles after dispose", async () => {
    const pending = deferred<void>()
    const client = createClient()
    client.connectSettings = mock(() => pending.promise)
    const relay = new PetSettingsFrameRelay({
      client,
      frameWindow: { postMessage: mock(() => undefined) },
      hostWindow: {},
      provider,
    })

    const load = relay.frameLoaded()
    await Promise.resolve()
    const identity = connectedIdentity(client)
    await relay.dispose()
    pending.resolve()
    await load

    expect(client.disconnectSettings).toHaveBeenCalledTimes(2)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(1, identity)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(2, identity)
  })

  test("derives a different frame binding key for provider identity changes", () => {
    const first = renderToStaticMarkup(<PetSettingsHost client={createClient()} provider={provider} />)
    const next = renderToStaticMarkup(
      <PetSettingsHost
        client={createClient()}
        provider={{
          generation: provider.generation + 1,
          pluginId: "other-companion",
          settingsUrl: "convax-plugin://other-companion/settings/index.html",
        }}
      />,
    )

    expect(first).toContain('data-pet-settings-binding="soft-companion:7"')
    expect(next).toContain('data-pet-settings-binding="other-companion:8"')
  })

  test("does not bind a frame lifecycle during an uncommitted render", () => {
    const bind = spyOn(PetSettingsFrameLifecycle.prototype, "bind")
    try {
      renderToStaticMarkup(
        <PetSettingsHost
          client={createClient()}
          provider={{
            generation: provider.generation + 1,
            pluginId: "other-companion",
            settingsUrl: "convax-plugin://other-companion/settings/index.html",
          }}
        />,
      )
      expect(bind).not.toHaveBeenCalled()
    } finally {
      bind.mockRestore()
    }
  })
})

describe("Pet settings preload integration", () => {
  test("registers the navigation listener before reporting the main renderer ready", async () => {
    preloadInvoke.mockClear()
    preloadInvoke.mockImplementation(async (channel: string) => {
      if (channel === "pet:navigation-ready") {
        expect(preloadListeners.has("pet:navigate")).toBeTrue()
      }
    })
    const harness = await loadPreloadHarness()

    try {
      const targets: unknown[] = []
      const dispose = harness.client.onNavigate((target) => targets.push(target))
      await flushPreloadPromises()

      expect(preloadInvoke).toHaveBeenCalledWith("pet:navigation-ready")
      const target = {
        activityId: "activity-ready",
        projectId: "project-ready",
        revision: 9,
        sessionId: "session-ready",
      }
      preloadListeners.get("pet:navigate")?.({ ports: [] }, target)
      expect(targets).toEqual([target])

      dispose()
      expect(preloadListeners.has("pet:navigate")).toBeFalse()
    } finally {
      harness.restoreWindow()
    }
  })

  test("waits for a matching relayed port before resolving a main-accepted connection", async () => {
    const identity: TestConnectionIdentity = {
      connectionId: "settings-preload-wait",
      generation: provider.generation,
      pluginId: provider.pluginId,
    }
    preloadInvoke.mockClear()
    preloadInvoke.mockImplementation(async () => undefined)
    const harness = await loadPreloadHarness()

    try {
      const connection = harness.client.connectSettings(identity)
      const settled = mock(() => undefined)
      void connection.then(settled, settled)
      await flushPreloadPromises()

      expect(preloadInvoke).toHaveBeenCalledWith("pet:settings-connect", identity)
      expect(settled).not.toHaveBeenCalled()

      const port = createPort()
      const envelope = connectEnvelope(identity)
      harness.receivePort({ ports: [port] }, envelope)

      await expect(connection).resolves.toBeUndefined()
      expect(harness.postMessage).toHaveBeenCalledWith(envelope, "*", [port])
      expect(port.close).not.toHaveBeenCalled()
      await harness.client.disconnectSettings(identity)
    } finally {
      harness.restoreWindow()
    }
  })

  test("rejects relay failure, safely closes the port, and consumes best-effort disconnect rejection", async () => {
    const identity: TestConnectionIdentity = {
      connectionId: "settings-preload-relay-failure",
      generation: provider.generation,
      pluginId: provider.pluginId,
    }
    const relayFailure = new Error("settings relay failed")
    preloadInvoke.mockClear()
    preloadInvoke.mockImplementation((channel: string) =>
      channel === "pet:settings-disconnect"
        ? Promise.reject(new Error("best-effort disconnect failed"))
        : Promise.resolve(undefined),
    )
    const postMessage = mock(() => undefined)
    postMessage.mockImplementation(() => {
      throw relayFailure
    })
    const harness = await loadPreloadHarness(postMessage)

    try {
      const connection = harness.client.connectSettings(identity)
      const rejected = mock(() => undefined)
      void connection.catch(rejected)
      await flushPreloadPromises()
      const port = {
        close: mock(() => {
          throw new Error("port close failed")
        }),
      }

      expect(() => harness.receivePort({ ports: [port] }, connectEnvelope(identity))).not.toThrow()
      await flushPreloadPromises()
      expect(postMessage).toHaveBeenCalledTimes(1)
      expect(port.close).toHaveBeenCalledTimes(1)
      expect(rejected).toHaveBeenCalledWith(relayFailure)
      expect(preloadInvoke).toHaveBeenCalledWith("pet:settings-disconnect", identity)

      postMessage.mockImplementation(() => undefined)
      const retry = harness.client.connectSettings(identity)
      await flushPreloadPromises()
      const retryPort = createPort()
      harness.receivePort({ ports: [retryPort] }, connectEnvelope(identity))
      await expect(retry).resolves.toBeUndefined()
      const disconnectError = await harness.client.disconnectSettings(identity).catch((error) => error)
      expect(disconnectError).toEqual(new Error("best-effort disconnect failed"))
    } finally {
      harness.restoreWindow()
    }
  })

  test("cancels an exact pending connection before awaiting main disconnect and closes a late port", async () => {
    const identity: TestConnectionIdentity = {
      connectionId: "settings-preload-pending-disconnect",
      generation: provider.generation,
      pluginId: provider.pluginId,
    }
    preloadInvoke.mockClear()
    preloadInvoke.mockImplementation((channel: string) =>
      channel === "pet:settings-disconnect"
        ? Promise.reject(new Error("main disconnect failed"))
        : Promise.resolve(undefined),
    )
    const harness = await loadPreloadHarness()

    try {
      const connection = harness.client.connectSettings(identity)
      const cancellation = connection.catch((error) => error)
      await flushPreloadPromises()
      const disconnectError = await harness.client.disconnectSettings(identity).catch((error) => error)
      expect(disconnectError).toEqual(new Error("main disconnect failed"))
      expect(await cancellation).toEqual(new Error("Pet settings connection was disconnected"))

      const latePort = createPort()
      expect(() => harness.receivePort({ ports: [latePort] }, connectEnvelope(identity))).not.toThrow()
      expect(latePort.close).toHaveBeenCalledTimes(1)
      expect(harness.postMessage).not.toHaveBeenCalled()

      preloadInvoke.mockImplementation(async () => undefined)
      const retry = harness.client.connectSettings(identity)
      await flushPreloadPromises()
      const retryPort = createPort()
      harness.receivePort({ ports: [retryPort] }, connectEnvelope(identity))
      await expect(retry).resolves.toBeUndefined()
      await harness.client.disconnectSettings(identity)
    } finally {
      harness.restoreWindow()
    }
  })

  test("isolates wrong and stale ports and rejects duplicate pending identities", async () => {
    const identity: TestConnectionIdentity = {
      connectionId: "settings-preload-duplicate",
      generation: provider.generation,
      pluginId: provider.pluginId,
    }
    const wrongIdentity: TestConnectionIdentity = { ...identity, connectionId: "settings-preload-wrong" }
    preloadInvoke.mockClear()
    preloadInvoke.mockImplementation(async () => undefined)
    const harness = await loadPreloadHarness()

    try {
      const connection = harness.client.connectSettings(identity)
      const settled = mock(() => undefined)
      void connection.then(settled, settled)
      await flushPreloadPromises()

      await expect(harness.client.connectSettings(identity)).rejects.toThrow("already pending")
      const wrongPort = createPort()
      harness.receivePort({ ports: [wrongPort] }, connectEnvelope(wrongIdentity))
      await flushPreloadPromises()
      expect(wrongPort.close).toHaveBeenCalledTimes(1)
      expect(settled).not.toHaveBeenCalled()

      const rightPort = createPort()
      const envelope = connectEnvelope(identity)
      harness.receivePort({ ports: [rightPort] }, envelope)
      await expect(connection).resolves.toBeUndefined()
      expect(harness.postMessage).toHaveBeenCalledWith(envelope, "*", [rightPort])

      const stalePort = createPort()
      harness.receivePort({ ports: [stalePort] }, envelope)
      expect(stalePort.close).toHaveBeenCalledTimes(1)
      expect(harness.postMessage).toHaveBeenCalledTimes(1)

      await harness.client.disconnectSettings(identity)
      const retry = harness.client.connectSettings(identity)
      await flushPreloadPromises()
      const retryPort = createPort()
      harness.receivePort({ ports: [retryPort] }, envelope)
      await expect(retry).resolves.toBeUndefined()
      await harness.client.disconnectSettings(identity)
    } finally {
      harness.restoreWindow()
    }
  })

  test("removes a main-rejected pending identity so the exact key can retry", async () => {
    const identity: TestConnectionIdentity = {
      connectionId: "settings-preload-main-rejection",
      generation: provider.generation,
      pluginId: provider.pluginId,
    }
    preloadInvoke.mockClear()
    preloadInvoke.mockImplementation((channel: string) =>
      channel === "pet:settings-connect"
        ? Promise.reject(new Error("main connect failed"))
        : Promise.resolve(undefined),
    )
    const harness = await loadPreloadHarness()

    try {
      await expect(harness.client.connectSettings(identity)).rejects.toThrow("main connect failed")

      preloadInvoke.mockImplementation(async () => undefined)
      const retry = harness.client.connectSettings(identity)
      await flushPreloadPromises()
      const retryPort = createPort()
      harness.receivePort({ ports: [retryPort] }, connectEnvelope(identity))
      await expect(retry).resolves.toBeUndefined()
      await harness.client.disconnectSettings(identity)
    } finally {
      harness.restoreWindow()
    }
  })
})

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("PetSettingsProviderLoader", () => {
  test("loads a Marketplace-installed provider after the main process publishes providerChanged", async () => {
    let installed = false
    let changed = () => undefined
    const client = createClient()
    client.getProvider = mock(async () => (installed ? provider : undefined))
    client.onProviderChanged = mock((listener) => {
      changed = listener
      return () => undefined
    })
    const loader = new PetSettingsProviderLoader(client)

    loader.start()
    await Promise.resolve()
    expect(loader.getSnapshot()).toEqual({ status: "absent" })

    installed = true
    changed()
    await Promise.resolve()
    expect(loader.getSnapshot()).toEqual({ provider, status: "ready" })
  })

  test("clears the provider to loading immediately and only accepts the newest request", async () => {
    const first = deferred<PetSettingsProvider | undefined>()
    const second = deferred<PetSettingsProvider | undefined>()
    let changed = () => undefined
    const client = createClient()
    client.getProvider = mock(() =>
      (client.getProvider as ReturnType<typeof mock>).mock.calls.length === 1 ? first.promise : second.promise,
    )
    client.onProviderChanged = mock((listener) => {
      changed = listener
      return () => undefined
    })
    const loader = new PetSettingsProviderLoader(client)
    const snapshots: unknown[] = []
    loader.subscribe((snapshot) => snapshots.push(snapshot))

    loader.start()
    expect(loader.getSnapshot()).toEqual({ status: "loading" })
    changed()
    expect(loader.getSnapshot()).toEqual({ status: "loading" })

    second.resolve(provider)
    await second.promise
    await Promise.resolve()
    expect(loader.getSnapshot()).toEqual({ provider, status: "ready" })

    first.resolve(undefined)
    await first.promise
    await Promise.resolve()
    expect(loader.getSnapshot()).toEqual({ provider, status: "ready" })
    expect(snapshots.at(-1)).toEqual({ provider, status: "ready" })
  })

  test("represents absent and failed provider queries without retaining stale data", async () => {
    const absent = deferred<PetSettingsProvider | undefined>()
    const failed = deferred<PetSettingsProvider | undefined>()
    let changed = () => undefined
    const client = createClient()
    client.getProvider = mock(() =>
      (client.getProvider as ReturnType<typeof mock>).mock.calls.length === 1 ? absent.promise : failed.promise,
    )
    client.onProviderChanged = mock((listener) => {
      changed = listener
      return () => undefined
    })
    const loader = new PetSettingsProviderLoader(client)

    loader.start()
    absent.resolve(undefined)
    await absent.promise
    await Promise.resolve()
    expect(loader.getSnapshot()).toEqual({ status: "absent" })

    changed()
    expect(loader.getSnapshot()).toEqual({ status: "loading" })
    failed.reject(new Error("provider lookup failed"))
    await failed.promise.catch(() => undefined)
    await Promise.resolve()
    expect(loader.getSnapshot()).toEqual({ status: "error" })
  })

  test("unsubscribes and ignores pending results after dispose", async () => {
    const pending = deferred<PetSettingsProvider | undefined>()
    const unsubscribe = mock(() => undefined)
    const client = createClient()
    client.getProvider = mock(() => pending.promise)
    client.onProviderChanged = mock(() => unsubscribe)
    const loader = new PetSettingsProviderLoader(client)
    const listener = mock(() => undefined)
    loader.subscribe(listener)

    loader.start()
    loader.dispose()
    pending.resolve(provider)
    await pending.promise
    await Promise.resolve()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(loader.getSnapshot()).toEqual({ status: "loading" })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test("contains synchronous provider subscription failure", () => {
    const client = createClient()
    client.onProviderChanged = mock(() => {
      throw new Error("subscription failed")
    })
    const loader = new PetSettingsProviderLoader(client)

    expect(() => loader.start()).not.toThrow()
    expect(loader.getSnapshot()).toEqual({ status: "error" })
    expect(client.getProvider).not.toHaveBeenCalled()
  })

  test("contains synchronous provider query failure", () => {
    const client = createClient()
    client.getProvider = mock(() => {
      throw new Error("query failed")
    })
    const loader = new PetSettingsProviderLoader(client)

    expect(() => loader.start()).not.toThrow()
    expect(loader.getSnapshot()).toEqual({ status: "error" })
  })

  test("unsubscribes when dispose happens synchronously before registration returns", () => {
    const client = createClient()
    const unsubscribe = mock(() => undefined)
    let loader: PetSettingsProviderLoader
    client.onProviderChanged = mock((listener) => {
      loader.dispose()
      listener()
      return unsubscribe
    })
    loader = new PetSettingsProviderLoader(client)

    expect(() => loader.start()).not.toThrow()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(client.getProvider).not.toHaveBeenCalled()
  })

  test("isolates throwing snapshot listeners", async () => {
    const client = createClient()
    const failedListener = mock(() => {
      throw new Error("listener failed")
    })
    const healthyListener = mock(() => undefined)
    const loader = new PetSettingsProviderLoader(client)
    loader.subscribe(failedListener)
    loader.subscribe(healthyListener)

    expect(() => loader.start()).not.toThrow()
    await Promise.resolve()

    expect(loader.getSnapshot()).toEqual({ provider, status: "ready" })
    expect(failedListener).toHaveBeenCalled()
    expect(healthyListener).toHaveBeenCalled()
  })
})

describe("PetSettingsFrameLifecycle", () => {
  function target() {
    return { frameLoaded: mock(async () => undefined) }
  }

  test("replays a frame load that happens before the passive effect binds and attaches", async () => {
    const lifecycle = new PetSettingsFrameLifecycle()
    const relay = target()
    const loaded = lifecycle.prepare("soft-companion:7")

    loaded()
    lifecycle.bind("soft-companion:7")
    const detach = lifecycle.attach("soft-companion:7", relay)
    await Promise.resolve()

    expect(relay.frameLoaded).toHaveBeenCalledTimes(1)
    detach()
  })

  test("keeps a committed binding active when a prepared render is abandoned", async () => {
    const lifecycle = new PetSettingsFrameLifecycle()
    const current = target()
    const loadCurrent = lifecycle.prepare("soft-companion:7")
    lifecycle.bind("soft-companion:7")
    lifecycle.attach("soft-companion:7", current)

    lifecycle.prepare("other-companion:8")
    loadCurrent()
    await Promise.resolve()

    expect(current.frameLoaded).toHaveBeenCalledTimes(1)
  })

  test("delivers a frame load that happens after attach exactly once", async () => {
    const lifecycle = new PetSettingsFrameLifecycle()
    const relay = target()
    lifecycle.bind("soft-companion:7")
    lifecycle.attach("soft-companion:7", relay)

    lifecycle.loaded("soft-companion:7")
    await Promise.resolve()

    expect(relay.frameLoaded).toHaveBeenCalledTimes(1)
  })

  test("does not duplicate delivered loads across StrictMode detach and reattach", async () => {
    const lifecycle = new PetSettingsFrameLifecycle()
    const relay = target()
    lifecycle.bind("soft-companion:7")
    let detach = lifecycle.attach("soft-companion:7", relay)
    lifecycle.loaded("soft-companion:7")
    await Promise.resolve()
    detach()

    detach = lifecycle.attach("soft-companion:7", relay)
    await Promise.resolve()
    expect(relay.frameLoaded).toHaveBeenCalledTimes(1)

    detach()
    lifecycle.loaded("soft-companion:7")
    lifecycle.attach("soft-companion:7", relay)
    await Promise.resolve()
    expect(relay.frameLoaded).toHaveBeenCalledTimes(2)
  })

  test("ignores stale loads after rebinding to a new provider frame", async () => {
    const lifecycle = new PetSettingsFrameLifecycle()
    const previous = target()
    const current = target()
    lifecycle.bind("soft-companion:7")
    lifecycle.attach("soft-companion:7", previous)
    lifecycle.bind("other-companion:8")
    lifecycle.attach("other-companion:8", current)

    lifecycle.loaded("soft-companion:7")
    lifecycle.loaded("other-companion:8")
    await Promise.resolve()

    expect(previous.frameLoaded).not.toHaveBeenCalled()
    expect(current.frameLoaded).toHaveBeenCalledTimes(1)
  })
})
