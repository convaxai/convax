import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  PetSettingsFrameRelay,
  PetSettingsHost,
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

function connectEnvelope(input: Partial<Record<string, unknown>> = {}) {
  return {
    generation: provider.generation,
    pluginId: provider.pluginId,
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
    await relay.frameLoaded()

    expect(client.connectSettings).toHaveBeenCalledTimes(1)
    expect(client.connectSettings).toHaveBeenCalledWith({
      generation: provider.generation,
      pluginId: provider.pluginId,
    })

    const port = createPort()
    expect(
      relay.receive({
        data: connectEnvelope(),
        ports: [port],
        source: hostWindow,
      }),
    ).toBeTrue()
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1)
    expect(frameWindow.postMessage).toHaveBeenCalledWith(connectEnvelope(), "*", [port])
    expect(port.close).not.toHaveBeenCalled()
  })

  test("rejects overlay, stale, duplicate, foreign-source, and multi-port relays", async () => {
    const client = createClient()
    const hostWindow = {}
    const frameWindow = { postMessage: mock(() => undefined) }
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow, provider })
    await relay.frameLoaded()

    for (const event of [
      { data: connectEnvelope({ surface: "overlay" }), ports: [createPort()], source: hostWindow },
      { data: connectEnvelope({ generation: 8 }), ports: [createPort()], source: hostWindow },
      { data: connectEnvelope(), ports: [createPort()], source: {} },
      { data: connectEnvelope(), ports: [createPort(), createPort()], source: hostWindow },
    ]) {
      expect(relay.receive(event)).toBeFalse()
      for (const port of event.ports) expect(port.close).toHaveBeenCalledTimes(1)
    }

    const acceptedPort = createPort()
    expect(relay.receive({ data: connectEnvelope(), ports: [acceptedPort], source: hostWindow })).toBeTrue()
    const duplicatePort = createPort()
    expect(relay.receive({ data: connectEnvelope(), ports: [duplicatePort], source: hostWindow })).toBeFalse()
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

    const nextProvider: PetSettingsProvider = {
      generation: 8,
      pluginId: provider.pluginId,
      settingsUrl: provider.settingsUrl,
    }
    await relay.replaceProvider(nextProvider)

    expect(client.disconnectSettings).toHaveBeenCalledTimes(1)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(1, {
      generation: provider.generation,
      pluginId: provider.pluginId,
    })

    await relay.frameLoaded()
    expect(client.connectSettings).toHaveBeenLastCalledWith({
      generation: nextProvider.generation,
      pluginId: nextProvider.pluginId,
    })
    await relay.dispose()
    await relay.dispose()
    expect(client.disconnectSettings).toHaveBeenCalledTimes(2)
    expect(client.disconnectSettings).toHaveBeenNthCalledWith(2, {
      generation: nextProvider.generation,
      pluginId: nextProvider.pluginId,
    })
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

    expect(relay.receive({ data: connectEnvelope(), ports: [port], source: relay.hostWindow })).toBeFalse()
    expect(port.close).toHaveBeenCalledTimes(1)
    expect(client.disconnectSettings).toHaveBeenCalledWith({
      generation: provider.generation,
      pluginId: provider.pluginId,
    })
  })
})
