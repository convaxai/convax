import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  PetSettingsFrameRelay,
  PetSettingsHost,
  PetSettingsProviderLoader,
  type PetSettingsHostClient,
  type PetSettingsProvider,
} from "./pet-settings-host"

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

  test("requests one fixed settings connection after frame load and forwards one exact port", async () => {
    const client = createClient()
    const hostWindow = {}
    const frameWindow = { postMessage: mock(() => undefined) }
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow, provider })

    await relay.frameLoaded()
    expect(client.connectSettings).toHaveBeenCalledTimes(1)
    const identity = connectedIdentity(client)
    expect(identity).toEqual({
      connectionId: expect.stringMatching(/^settings-[1-9][0-9]*$/),
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
})
