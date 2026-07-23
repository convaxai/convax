import { afterEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

import { petHostProtocol, petIpcChannels, type PetHostProviderBinding } from "../pet-contracts"

type InvokeHandler = (event: any, input?: unknown) => unknown
const invokeHandlers = new Map<string, InvokeHandler>()

class FakePort extends EventEmitter {
  closed = false
  postError?: Error
  messages: unknown[] = []
  startError?: Error
  started = false

  close() {
    if (this.closed) return
    this.closed = true
    this.emit("close")
  }

  postMessage(message: unknown) {
    if (this.postError) throw this.postError
    if (this.closed) throw new Error("port is closed")
    this.messages.push(message)
  }

  start() {
    if (this.startError) throw this.startError
    this.started = true
  }
}

class FakeMessageChannelMain {
  static created: FakeMessageChannelMain[] = []
  port1 = new FakePort()
  port2 = new FakePort()

  constructor() {
    FakeMessageChannelMain.created.push(this)
  }
}

const fakeIpcMain = {
  handle: (channel: string, handler: InvokeHandler) => invokeHandlers.set(channel, handler),
  removeHandler: (channel: string) => invokeHandlers.delete(channel),
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  postMessage = mock((_channel: string, _message: unknown, _transfer?: readonly unknown[]) => undefined)
  send = mock((_channel: string, _target?: unknown) => undefined)

  constructor(readonly id: number) {
    super()
  }

  destroy() {
    this.destroyed = true
    this.emit("destroyed")
  }

  isDestroyed() {
    return this.destroyed
  }
}

const binding: PetHostProviderBinding = {
  capabilities: ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
  digest: "sha256:provider-one",
  generation: 4,
  pluginId: "soft-companion",
}
const activitySnapshot = {
  activities: [
    {
      id: "activity-one",
      projectId: "project-one",
      projectName: "Project One",
      sessionId: "session-one",
      sessionName: "Session One",
      state: "ready" as const,
      updatedAt: 10,
    },
  ],
  revision: 7,
}

function request(id: string, method: string, params: unknown = {}) {
  return { id, method, params, protocol: petHostProtocol, type: "request" }
}

function fixture() {
  let currentBinding: PetHostProviderBinding | undefined = { ...binding, capabilities: [...binding.capabilities] }
  let providerListener: ((provider: unknown) => void) | undefined
  const activityListeners = new Set<(snapshot: typeof activitySnapshot) => void>()
  const preferenceListeners = new Set<(preferences: { awake: boolean; selectedPetId?: string }) => void>()
  const mainContents = new FakeWebContents(1)
  const mainWindow = {
    focus: mock(() => undefined),
    isMinimized: mock(() => true),
    restore: mock(() => undefined),
    show: mock(() => undefined),
    webContents: mainContents,
  }
  const provider = {
    getActivitySnapshot: mock(() => structuredClone(activitySnapshot)),
    getBinding: mock(() => currentBinding && structuredClone(currentBinding)),
    getPreferences: mock(() => ({ awake: true, selectedPetId: "aster" })),
    getProvider: mock(() =>
      currentBinding
        ? {
            ...currentBinding,
            contribution: {
              library: "pet-library.json",
              overlay: "pet/index.html",
              protocol: petHostProtocol,
              settings: "settings/index.html",
            },
            libraryUrl: "convax-plugin://soft-companion/pet-library.json",
            overlayUrl: "convax-plugin://soft-companion/pet/index.html",
            settingsUrl: "convax-plugin://soft-companion/settings/index.html",
            version: "1.0.0",
          }
        : undefined,
    ),
    setAwake: mock(async ({ awake }: { awake: boolean }) => ({ awake, selectedPetId: "aster" })),
    subscribeActivity: mock((listener: (snapshot: typeof activitySnapshot) => void) => {
      activityListeners.add(listener)
      return () => activityListeners.delete(listener)
    }),
    subscribePreferences: mock((listener: (preferences: { awake: boolean; selectedPetId?: string }) => void) => {
      preferenceListeners.add(listener)
      return () => preferenceListeners.delete(listener)
    }),
    subscribeProvider: mock((listener: (provider: unknown) => void) => {
      providerListener = listener
      return () => {
        providerListener = undefined
      }
    }),
    updatePreferences: mock(async ({ selectedPetId }: { selectedPetId: string }) => ({ awake: true, selectedPetId })),
  }
  const activity = {
    markSeen: mock(async () => undefined),
    resolveActivity: mock((activityId: string) =>
      activityId === "activity-one" ? { projectId: "project-one", sessionId: "session-one" } : null,
    ),
  }
  const overlay = {
    moveBy: mock(async () => undefined),
    setExpanded: mock(async () => undefined),
  }
  const settingsSender = new FakeWebContents(11)
  const untrustedSender = new FakeWebContents(12)
  const trustedEvent = { sender: settingsSender }
  const untrustedEvent = { sender: untrustedSender }
  const restoreProvider = mock(async (_pluginId: string) => undefined)
  return {
    activity,
    activityListeners,
    mainWindow,
    openMainWindow: mock(async () => mainWindow),
    overlay,
    preferenceListeners,
    provider,
    providerChanged(next?: PetHostProviderBinding) {
      currentBinding = next
      providerListener?.(undefined)
    },
    restoreProvider,
    settingsSender,
    trustedEvent,
    untrustedEvent,
  }
}

function registrationOptions(
  value: ReturnType<typeof fixture>,
  isTrustedMainSender = (event: unknown) => event === value.trustedEvent,
) {
  return {
    createMessageChannel: () => new FakeMessageChannelMain(),
    getMainWindow: () => value.mainWindow,
    ipcMain: fakeIpcMain,
    isTrustedMainSender,
    openMainWindow: value.openMainWindow,
    restoreProvider: value.restoreProvider,
  }
}

async function settlePort() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  invokeHandlers.clear()
  FakeMessageChannelMain.created = []
})

describe("registerPetIpc", () => {
  test("exposes only scoped settings discovery and connection handlers", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))

    expect([...invokeHandlers.keys()].sort()).toEqual(
      [
        petIpcChannels.markDisplayed,
        petIpcChannels.navigationReady,
        petIpcChannels.provider,
        petIpcChannels.settingsConnect,
        petIpcChannels.settingsDisconnect,
      ].sort(),
    )
    expect(Object.values(petIpcChannels)).not.toContain("pet:list")
    expect(Object.values(petIpcChannels)).not.toContain("pet:import-custom")
    expect(Object.values(petIpcChannels)).not.toContain("pet:delete-custom")
    expect(() => invokeHandlers.get(petIpcChannels.provider)?.(value.untrustedEvent)).toThrow("untrusted")
    expect(await invokeHandlers.get(petIpcChannels.provider)?.(value.trustedEvent)).toEqual({
      generation: 4,
      pluginId: "soft-companion",
      settingsUrl: "convax-plugin://soft-companion/settings/index.html",
    })

    registration.dispose()
    expect(invokeHandlers).toHaveLength(0)
  })

  test("binds one settings MessagePort to the exact provider identity and relays requests", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const identity = { connectionId: "settings-one", generation: 4, pluginId: "soft-companion" }

    await invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)
    const channel = FakeMessageChannelMain.created[0]!
    expect(channel.port1.started).toBeTrue()
    expect(value.settingsSender.postMessage).toHaveBeenCalledWith(
      petIpcChannels.settingsPort,
      { ...identity, protocol: petHostProtocol, surface: "settings", type: "connect" },
      [channel.port2],
    )
    channel.port1.emit("message", { data: request("preferences", "preferences.get") })
    await settlePort()
    expect(channel.port1.messages).toEqual([
      {
        id: "preferences",
        ok: true,
        protocol: petHostProtocol,
        result: { awake: true, selectedPetId: "aster" },
        type: "response",
      },
    ])
    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).toThrow(
      "already exists",
    )
    expect(() =>
      invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, { ...identity, generation: 5 }),
    ).toThrow("changed")
    expect(await invokeHandlers.get(petIpcChannels.settingsDisconnect)?.(value.trustedEvent, identity)).toBeTrue()
    expect(channel.port1.closed).toBeTrue()
    expect(await invokeHandlers.get(petIpcChannels.settingsDisconnect)?.(value.trustedEvent, identity)).toBeFalse()
    registration.dispose()
  })

  test("closes sender and provider-scoped connections and notifies the main renderer", async () => {
    const value = fixture()
    const fresh = new FakeWebContents(13)
    const freshEvent = { sender: fresh }
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(
      value.provider,
      value.activity,
      value.overlay,
      registrationOptions(value, (event: unknown) => event === value.trustedEvent || event === freshEvent),
    )
    const identity = { connectionId: "settings-lifecycle", generation: 4, pluginId: "soft-companion" }
    await invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)
    const destroyed = FakeMessageChannelMain.created[0]!
    value.settingsSender.destroy()
    expect(destroyed.port1.closed).toBeTrue()

    await invokeHandlers.get(petIpcChannels.settingsConnect)?.(freshEvent, identity)
    const changed = FakeMessageChannelMain.created.at(-1)!
    value.providerChanged({ ...binding, digest: "sha256:provider-two", generation: 5 })
    expect(changed.port1.closed).toBeTrue()
    expect(value.mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.providerChanged)
    registration.dispose()
  })

  test("revokes a changing Plugin before local publication and keeps its host capabilities fail-closed", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const overlaySender = new FakeWebContents(14)
    const identity = { connectionId: "settings-revoked", generation: 4, pluginId: "soft-companion" }

    registration.connectOverlay(overlaySender, binding)
    await invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)
    const [overlayChannel, settingsChannel] = FakeMessageChannelMain.created

    await registration.prepareProviderChange("soft-companion").publish()

    expect(overlayChannel?.port1.closed).toBeTrue()
    expect(settingsChannel?.port1.closed).toBeTrue()
    expect(await invokeHandlers.get(petIpcChannels.provider)?.(value.trustedEvent)).toBeUndefined()
    expect(() => registration.connectOverlay(overlaySender, binding)).toThrow("changed")
    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).toThrow("changed")
    expect(value.mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.providerChanged)

    const updatedBinding = { ...binding, digest: "sha256:provider-two", generation: 5 }
    value.providerChanged(updatedBinding)
    expect(await invokeHandlers.get(petIpcChannels.provider)?.(value.trustedEvent)).toMatchObject({
      generation: 5,
      pluginId: "soft-companion",
    })
    expect(() => registration.connectOverlay(overlaySender, updatedBinding)).not.toThrow()
    registration.dispose()
  })

  test("restores a revoked provider and its runtime when local Plugin publication rolls back", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const overlaySender = new FakeWebContents(15)
    const identity = { connectionId: "settings-rollback", generation: 4, pluginId: "soft-companion" }

    registration.connectOverlay(overlaySender, binding)
    await invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)
    const publication = registration.prepareProviderChange("soft-companion")
    await publication.publish()

    expect(await invokeHandlers.get(petIpcChannels.provider)?.(value.trustedEvent)).toBeUndefined()
    await publication.rollback()

    expect(value.restoreProvider).toHaveBeenCalledWith("soft-companion")
    expect(await invokeHandlers.get(petIpcChannels.provider)?.(value.trustedEvent)).toMatchObject({
      generation: 4,
      pluginId: "soft-companion",
    })
    expect(() => registration.connectOverlay(overlaySender, binding)).not.toThrow()
    registration.dispose()
  })

  test("keeps a revoked provider fail-closed when rollback runtime restoration fails", async () => {
    const value = fixture()
    value.restoreProvider.mockRejectedValueOnce(new Error("overlay remount failed"))
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const overlaySender = new FakeWebContents(16)
    const publication = registration.prepareProviderChange("soft-companion")

    await publication.publish()
    await expect(publication.rollback()).rejects.toThrow("overlay remount failed")

    expect(await invokeHandlers.get(petIpcChannels.provider)?.(value.trustedEvent)).toBeUndefined()
    expect(() => registration.connectOverlay(overlaySender, binding)).toThrow("changed")
    registration.dispose()
  })

  test("releases a settings key when the host connection closes itself", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const identity = { connectionId: "settings-terminal", generation: 4, pluginId: "soft-companion" }
    await invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)
    const failed = FakeMessageChannelMain.created[0]!
    failed.port1.postError = new Error("transport failed")

    failed.port1.emit("message", { data: request("preferences", "preferences.get") })
    await settlePort()
    expect(failed.port1.closed).toBeTrue()

    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).not.toThrow()
    expect(FakeMessageChannelMain.created).toHaveLength(2)
    registration.dispose()
  })

  test("closes both channel endpoints and permits retry after construction, start, or delivery failure", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const identity = { connectionId: "settings-failure", generation: 4, pluginId: "soft-companion" }

    value.provider.subscribePreferences.mockImplementationOnce(() => {
      throw new Error("subscription failed")
    })
    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).toThrow(
      "subscription failed",
    )
    expect(FakeMessageChannelMain.created[0]!.port1.closed).toBeTrue()
    expect(FakeMessageChannelMain.created[0]!.port2.closed).toBeTrue()

    const originalStart = FakePort.prototype.start
    FakePort.prototype.start = function () {
      FakePort.prototype.start = originalStart
      throw new Error("start failed")
    }
    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).toThrow(
      "start failed",
    )
    expect(FakeMessageChannelMain.created[1]!.port1.closed).toBeTrue()
    expect(FakeMessageChannelMain.created[1]!.port2.closed).toBeTrue()

    value.settingsSender.postMessage.mockImplementationOnce(() => {
      throw new Error("delivery failed")
    })
    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).toThrow(
      "delivery failed",
    )
    expect(FakeMessageChannelMain.created[2]!.port1.closed).toBeTrue()
    expect(FakeMessageChannelMain.created[2]!.port2.closed).toBeTrue()

    expect(() => invokeHandlers.get(petIpcChannels.settingsConnect)?.(value.trustedEvent, identity)).not.toThrow()
    registration.dispose()
  })

  test("connects every loaded overlay to an exact generation and rejects stale activity navigation", async () => {
    const value = fixture()
    const mainEvent = { sender: value.mainWindow.webContents }
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(
      value.provider,
      value.activity,
      value.overlay,
      registrationOptions(value, (event: unknown) => event === value.trustedEvent || event === mainEvent),
    )
    await invokeHandlers.get(petIpcChannels.navigationReady)?.(mainEvent)
    const overlaySender = new FakeWebContents(21)
    registration.connectOverlay(overlaySender, binding)
    const first = FakeMessageChannelMain.created[0]!
    expect(overlaySender.postMessage).toHaveBeenCalledWith(
      petIpcChannels.connectOverlay,
      { pluginId: "soft-companion", protocol: petHostProtocol, surface: "overlay", type: "connect" },
      [first.port2],
    )
    for (const listener of value.activityListeners) listener({ ...activitySnapshot, revision: 8 })
    expect(first.port1.messages.at(-1)).toEqual({
      event: "activity.changed",
      payload: { ...activitySnapshot, revision: 8 },
      protocol: petHostProtocol,
      type: "event",
    })

    first.port1.emit("message", {
      data: request("stale", "activity.open", { activityId: "activity-one", revision: 6 }),
    })
    await settlePort()
    expect(first.port1.messages.at(-1)).toMatchObject({
      error: expect.stringContaining("stale"),
      id: "stale",
      ok: false,
    })
    expect(value.openMainWindow).not.toHaveBeenCalled()

    first.port1.emit("message", {
      data: request("open", "activity.open", { activityId: "activity-one", revision: 7 }),
    })
    await settlePort()
    expect(value.mainWindow.restore).toHaveBeenCalledTimes(1)
    expect(value.mainWindow.show).toHaveBeenCalledTimes(1)
    expect(value.mainWindow.focus).toHaveBeenCalledTimes(1)
    expect(value.mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.navigate, {
      activityId: "activity-one",
      projectId: "project-one",
      revision: 7,
      sessionId: "session-one",
    })

    registration.connectOverlay(overlaySender, binding)
    expect(first.port1.closed).toBeTrue()
    expect(FakeMessageChannelMain.created).toHaveLength(2)
    expect(() =>
      registration.connectOverlay(overlaySender, { ...binding, digest: "sha256:stale", generation: 3 }),
    ).toThrow("changed")
    registration.dispose()
  })

  test("holds activity navigation until the exact main renderer reports its listener ready", async () => {
    const value = fixture()
    const mainEvent = { sender: value.mainWindow.webContents }
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(
      value.provider,
      value.activity,
      value.overlay,
      registrationOptions(value, (event: unknown) => event === value.trustedEvent || event === mainEvent),
    )
    const overlaySender = new FakeWebContents(22)
    registration.connectOverlay(overlaySender, binding)
    const channel = FakeMessageChannelMain.created[0]!

    channel.port1.emit("message", {
      data: request("open-after-ready", "activity.open", { activityId: "activity-one", revision: 7 }),
    })
    await settlePort()

    expect(value.openMainWindow).toHaveBeenCalledTimes(1)
    expect(value.mainWindow.webContents.send).not.toHaveBeenCalledWith(petIpcChannels.navigate, expect.anything())

    await invokeHandlers.get(petIpcChannels.navigationReady)?.(mainEvent)

    expect(value.mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.navigate, {
      activityId: "activity-one",
      projectId: "project-one",
      revision: 7,
      sessionId: "session-one",
    })
    registration.dispose()
  })

  test("requires a fresh navigation handshake after the main frame reloads", async () => {
    const value = fixture()
    const mainEvent = { sender: value.mainWindow.webContents }
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(
      value.provider,
      value.activity,
      value.overlay,
      registrationOptions(value, (event: unknown) => event === value.trustedEvent || event === mainEvent),
    )
    await invokeHandlers.get(petIpcChannels.navigationReady)?.(mainEvent)
    value.mainWindow.webContents.send.mockClear()
    value.mainWindow.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false })
    const overlaySender = new FakeWebContents(23)
    registration.connectOverlay(overlaySender, binding)

    FakeMessageChannelMain.created[0]!.port1.emit("message", {
      data: request("open-after-reload", "activity.open", { activityId: "activity-one", revision: 7 }),
    })
    await settlePort()

    expect(value.mainWindow.webContents.send).not.toHaveBeenCalledWith(petIpcChannels.navigate, expect.anything())

    await invokeHandlers.get(petIpcChannels.navigationReady)?.(mainEvent)
    expect(value.mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.navigate, {
      activityId: "activity-one",
      projectId: "project-one",
      revision: 7,
      sessionId: "session-one",
    })
    registration.dispose()
  })

  test("keeps navigation ready across a same-document main-frame navigation", async () => {
    const value = fixture()
    const mainEvent = { sender: value.mainWindow.webContents }
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(
      value.provider,
      value.activity,
      value.overlay,
      registrationOptions(value, (event: unknown) => event === value.trustedEvent || event === mainEvent),
    )
    await invokeHandlers.get(petIpcChannels.navigationReady)?.(mainEvent)
    value.mainWindow.webContents.send.mockClear()
    value.mainWindow.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true })
    const overlaySender = new FakeWebContents(24)
    registration.connectOverlay(overlaySender, binding)

    FakeMessageChannelMain.created[0]!.port1.emit("message", {
      data: request("open-after-history", "activity.open", { activityId: "activity-one", revision: 7 }),
    })
    await settlePort()

    expect(value.mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.navigate, {
      activityId: "activity-one",
      projectId: "project-one",
      revision: 7,
      sessionId: "session-one",
    })
    registration.dispose()
  })

  test("marks only the current visible activity as displayed from the trusted main renderer", async () => {
    const value = fixture()
    const { registerPetIpc } = await import("./pet-ipc")
    const registration = registerPetIpc(value.provider, value.activity, value.overlay, registrationOptions(value))
    const mark = invokeHandlers.get(petIpcChannels.markDisplayed)!

    await expect(mark(value.untrustedEvent, { activityId: "activity-one", revision: 7 })).rejects.toThrow("untrusted")
    await expect(mark(value.trustedEvent, { activityId: "activity-one", revision: 6 })).rejects.toThrow("stale")
    await expect(mark(value.trustedEvent, { activityId: "missing", revision: 7 })).rejects.toThrow("no longer")
    await mark(value.trustedEvent, { activityId: "activity-one", revision: 7 })
    expect(value.activity.markSeen).toHaveBeenCalledWith("activity-one", 7)
    registration.dispose()
  })
})
