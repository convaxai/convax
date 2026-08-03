import { afterEach, describe, expect, jest, mock, test } from "bun:test"

import { connectPetHost, type PetHostMessageEvent } from "./pet-client"
import { petHostProtocol } from "./pet"

class FakeSource {
  readonly location = { hostname: "soft-companion", protocol: "convax-plugin:" }
  readonly parent: unknown
  readonly listeners = new Set<(event: PetHostMessageEvent) => void>()

  constructor(parent: unknown) {
    this.parent = parent
  }

  addEventListener(type: "message", listener: (event: PetHostMessageEvent) => void) {
    if (type === "message") this.listeners.add(listener)
  }

  removeEventListener(type: "message", listener: (event: PetHostMessageEvent) => void) {
    if (type === "message") this.listeners.delete(listener)
  }

  emit(event: PetHostMessageEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

class FakePort {
  readonly close = mock(() => undefined)
  readonly postMessage = mock((_message: unknown) => undefined)
  readonly start = mock(() => undefined)
  onmessage: ((event: { readonly data: unknown }) => void) | null = null

  emit(data: unknown) {
    this.onmessage?.({ data })
  }
}

afterEach(() => jest.useRealTimers())

describe("SDK-owned Pet surface client", () => {
  test("derives Plugin identity from the trusted snapshot origin", async () => {
    const parent = {}
    const source = new FakeSource(parent)
    const port = new FakePort()
    const connecting = connectPetHost({ source, surface: "settings" })

    source.emit({
      data: { pluginId: "other-plugin", protocol: petHostProtocol, surface: "settings", type: "connect" },
      ports: [port],
      source: parent,
    })
    expect(source.listeners.size).toBe(1)

    source.emit({
      data: {
        connectionId: "settings-one",
        generation: 7,
        pluginId: "soft-companion",
        protocol: petHostProtocol,
        surface: "settings",
        type: "connect",
      },
      ports: [port],
      source: parent,
    })

    const client = await connecting
    expect(client.surface).toBe("settings")
    expect(port.start).toHaveBeenCalledTimes(1)
  })

  test("provides typed requests and validates successful results", async () => {
    const parent = {}
    const source = new FakeSource(parent)
    const port = new FakePort()
    const connecting = connectPetHost({ source, surface: "settings" })
    source.emit({
      data: {
        connectionId: "settings-one",
        generation: 7,
        pluginId: "soft-companion",
        protocol: petHostProtocol,
        surface: "settings",
        type: "connect",
      },
      ports: [port],
      source: parent,
    })
    const client = await connecting

    const preferences = client.request("preferences.get", {})
    expect(port.postMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      method: "preferences.get",
      params: {},
      protocol: petHostProtocol,
      type: "request",
    })
    const id = (port.postMessage.mock.calls[0]![0] as { readonly id: string }).id
    port.emit({
      id,
      ok: true,
      protocol: petHostProtocol,
      result: { awake: true, selectedPetId: "violet" },
      type: "response",
    })
    expect(await preferences).toEqual({ awake: true, selectedPetId: "violet" })

    const invalid = client.request("preferences.get", {})
    const invalidId = (port.postMessage.mock.calls[1]![0] as { readonly id: string }).id
    port.emit({ id: invalidId, ok: true, protocol: petHostProtocol, result: { awake: "yes" }, type: "response" })
    await expect(invalid).rejects.toThrow("invalid")
    expect(client.closed).toBe(true)
    expect(port.close).toHaveBeenCalledTimes(1)
  })

  test("validates event payloads and bounds pending requests", async () => {
    const parent = {}
    const source = new FakeSource(parent)
    const port = new FakePort()
    const connecting = connectPetHost({ source, surface: "overlay" })
    source.emit({
      data: { pluginId: "soft-companion", protocol: petHostProtocol, surface: "overlay", type: "connect" },
      ports: [port],
      source: parent,
    })
    const client = await connecting
    const listener = mock(() => undefined)
    client.subscribe("activity.changed", listener)

    port.emit({ event: "activity.changed", payload: { activities: [], revision: 2 }, protocol: petHostProtocol, type: "event" })
    expect(listener).toHaveBeenCalledTimes(1)

    const pending = Array.from({ length: 64 }, () => client.request("activity.getSnapshot", {}).catch(() => undefined))
    await expect(client.request("activity.getSnapshot", {})).rejects.toThrow("pending request limit")
    client.close()
    await Promise.all(pending)
  })

  test("validates params, supports local abort, and fails closed on late responses", async () => {
    const parent = {}
    const source = new FakeSource(parent)
    const port = new FakePort()
    const connecting = connectPetHost({ source, surface: "overlay" })
    source.emit({
      data: { pluginId: "soft-companion", protocol: petHostProtocol, surface: "overlay", type: "connect" },
      ports: [port],
      source: parent,
    })
    const client = await connecting
    await expect(client.request("overlay.setExpanded", { expanded: "yes" } as never)).rejects.toThrow("params")

    const controller = new AbortController()
    const pending = client.request("activity.getSnapshot", {}, { signal: controller.signal })
    const requestId = (port.postMessage.mock.calls[0]![0] as { readonly id: string }).id
    controller.abort()
    await expect(pending).rejects.toThrow("aborted")

    port.emit({ id: requestId, ok: true, protocol: petHostProtocol, result: { activities: [], revision: 1 }, type: "response" })
    expect(client.closed).toBe(true)
    expect(port.close).toHaveBeenCalledTimes(1)
  })

  test("rejects unknown and cross-surface methods before posting to the Host", async () => {
    const parent = {}
    const source = new FakeSource(parent)
    const port = new FakePort()
    const connecting = connectPetHost({ source, surface: "overlay" })
    source.emit({
      data: { pluginId: "soft-companion", protocol: petHostProtocol, surface: "overlay", type: "connect" },
      ports: [port],
      source: parent,
    })
    const client = await connecting
    const untypedClient = client as unknown as {
      request(method: string, params: unknown): Promise<unknown>
    }

    await expect(untypedClient.request("collection.import", {})).rejects.toThrow("method")
    await expect(untypedClient.request("pet.unsupported", {})).rejects.toThrow("method")
    expect(port.postMessage).not.toHaveBeenCalled()
    expect(client.closed).toBe(false)
  })

  test("times out an absent Host and removes the listener", async () => {
    jest.useFakeTimers()
    const source = new FakeSource({})
    let timeoutError: Error | undefined
    void connectPetHost({ handshakeTimeoutMs: 25, source, surface: "overlay" }).catch((error: Error) => {
      timeoutError = error
    })

    jest.advanceTimersByTime(25)
    await Promise.resolve()
    expect(timeoutError?.message).toContain("timed out")
    expect(source.listeners.size).toBe(0)
  })
})
