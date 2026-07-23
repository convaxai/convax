import { describe, expect, mock, test } from "bun:test"
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
let exposedPreloadBridge: { pets: PetSettingsHostClient } | undefined

mock.module("electron", () => ({
  contextBridge: {
    exposeInMainWorld(name: string, value: { pets: PetSettingsHostClient }) {
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

  test("keeps preload and renderer connection identities aligned across reloads", async () => {
    const firstIdentity: TestConnectionIdentity = {
      connectionId: "settings-1",
      generation: provider.generation,
      pluginId: provider.pluginId,
    }
    const secondIdentity: TestConnectionIdentity = { ...firstIdentity, connectionId: "settings-2" }
    const postMessage = mock(() => undefined)
    const preloadWindow = { postMessage } as unknown as Window & typeof globalThis
    Object.defineProperty(preloadWindow, "top", { value: preloadWindow })
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, "window", { configurable: true, value: preloadWindow })

    try {
      await import("../preload/index")
      const client = exposedPreloadBridge?.pets
      const receivePort = preloadListeners.get("pet:settings-port")
      if (!client || !receivePort) throw new Error("Pet settings preload bridge was not exposed")

      preloadInvoke.mockClear()
      await client.connectSettings(firstIdentity)
      expect(preloadInvoke).toHaveBeenNthCalledWith(1, "pet:settings-connect", firstIdentity)

      const wrongPort = createPort()
      receivePort({ ports: [wrongPort] }, connectEnvelope(secondIdentity))
      expect(wrongPort.close).toHaveBeenCalledTimes(1)
      expect(postMessage).not.toHaveBeenCalled()

      const firstPort = createPort()
      const firstEnvelope = connectEnvelope(firstIdentity)
      receivePort({ ports: [firstPort] }, firstEnvelope)
      expect(postMessage).toHaveBeenNthCalledWith(1, firstEnvelope, "*", [firstPort])
      expect(firstPort.close).not.toHaveBeenCalled()

      await client.connectSettings(secondIdentity)
      expect(preloadInvoke).toHaveBeenNthCalledWith(2, "pet:settings-connect", secondIdentity)
      await client.disconnectSettings(firstIdentity)
      expect(preloadInvoke).toHaveBeenNthCalledWith(3, "pet:settings-disconnect", firstIdentity)

      const secondPort = createPort()
      const secondEnvelope = connectEnvelope(secondIdentity)
      receivePort({ ports: [secondPort] }, secondEnvelope)
      expect(postMessage).toHaveBeenNthCalledWith(2, secondEnvelope, "*", [secondPort])
      expect(secondPort.close).not.toHaveBeenCalled()

      const stalePort = createPort()
      receivePort({ ports: [stalePort] }, firstEnvelope)
      expect(stalePort.close).toHaveBeenCalledTimes(1)
      expect(postMessage).toHaveBeenCalledTimes(2)

      await client.disconnectSettings(secondIdentity)
      expect(preloadInvoke).toHaveBeenNthCalledWith(4, "pet:settings-disconnect", secondIdentity)
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window")
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow })
      }
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

  test("replays a frame load that happens before the passive effect attaches", async () => {
    const lifecycle = new PetSettingsFrameLifecycle()
    const relay = target()
    lifecycle.bind("soft-companion:7")

    lifecycle.loaded("soft-companion:7")
    const detach = lifecycle.attach("soft-companion:7", relay)
    await Promise.resolve()

    expect(relay.frameLoaded).toHaveBeenCalledTimes(1)
    detach()
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
