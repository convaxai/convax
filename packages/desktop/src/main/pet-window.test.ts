import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

import type { InstalledPetProvider } from "./pet-provider-controller"
import { clampPetBounds, PetWindow } from "./pet-window"

function provider(overrides: Partial<InstalledPetProvider> = {}): InstalledPetProvider {
  return {
    capabilities: ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
    contribution: {
      library: "pet-library.json",
      overlay: "pet/index.html",
      protocol: "convax.pet-host/1",
      settings: "settings/index.html",
    },
    digest: "digest:soft-companion:1",
    generation: 1,
    libraryUrl: "convax-plugin://soft-companion/pet-library.json",
    overlayUrl: "convax-plugin://soft-companion/pet/index.html",
    pluginId: "soft-companion",
    settingsUrl: "convax-plugin://soft-companion/settings/index.html",
    version: "1.0.0",
    ...overrides,
  }
}

class FakeWebContents extends EventEmitter {
  id = 91
  openHandler?: () => { action: "deny" }
  send = mock(() => undefined)
  session = Object.assign(new EventEmitter(), {
    permissionCheckHandler: undefined as undefined | (() => boolean),
    permissionRequestHandler: undefined as
      | undefined
      | ((_contents: unknown, permission: string, callback: (allowed: boolean) => void) => void),
    setPermissionCheckHandler: (handler: () => boolean) => {
      this.session.permissionCheckHandler = handler
    },
    setPermissionRequestHandler: (
      handler: (_contents: unknown, permission: string, callback: (allowed: boolean) => void) => void,
    ) => {
      this.session.permissionRequestHandler = handler
    },
  })

  setWindowOpenHandler(handler: () => { action: "deny" }) {
    this.openHandler = handler
  }
}

class FakeWindow extends EventEmitter {
  bounds = { height: 176, width: 176, x: 600, y: 400 }
  destroyed = false
  loadError?: Error
  loadTask?: Promise<void>
  loadedUrl?: string
  refuseClose = false
  showInactive = mock(() => undefined)
  webContents = new FakeWebContents()

  close() {
    if (!this.refuseClose) this.destroy()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit("closed")
  }

  getBounds() {
    return { ...this.bounds }
  }

  isDestroyed() {
    return this.destroyed
  }

  async loadURL(url: string) {
    this.loadedUrl = url
    await this.loadTask
    if (this.loadError) throw this.loadError
  }

  setBounds(bounds: Partial<typeof this.bounds>) {
    this.bounds = { ...this.bounds, ...bounds }
  }
}

function fixture(
  savedPositions: Record<string, { scaleFactor?: number; x: number; y: number }> = {},
  savedDisplayId?: string,
  configureWindow?: (window: FakeWindow, index: number) => void,
) {
  const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = []
  const screen = new EventEmitter() as EventEmitter & {
    getDisplayMatching(bounds: { height: number; width: number; x: number; y: number }): {
      id: number
      scaleFactor: number
      workArea: { height: number; width: number; x: number; y: number }
    }
    getAllDisplays(): Array<{
      id: number
      scaleFactor: number
      workArea: { height: number; width: number; x: number; y: number }
    }>
    getPrimaryDisplay(): {
      id: number
      scaleFactor: number
      workArea: { height: number; width: number; x: number; y: number }
    }
  }
  const display = { id: 7, scaleFactor: 1, workArea: { height: 700, width: 900, x: 100, y: 50 } }
  const secondary = { id: 8, scaleFactor: 2, workArea: { height: 760, width: 1_000, x: 1_000, y: 0 } }
  screen.getAllDisplays = () => [display, secondary]
  screen.getDisplayMatching = (bounds) => (bounds.x >= secondary.workArea.x ? secondary : display)
  screen.getPrimaryDisplay = () => display
  const powerMonitor = new EventEmitter()
  const onFatal = mock(async () => undefined)
  const onPositionChanged = mock(async () => undefined)
  const pet = new PetWindow({
    createWindow: (options) => {
      const window = new FakeWindow()
      configureWindow?.(window, created.length)
      created.push({ options, window })
      return window
    },
    onFatal,
    onPositionChanged,
    powerMonitor,
    preloadPath: "/app/preload/pet.js",
    resolveDisplayId: () => savedDisplayId,
    resolvePosition: (displayId) => savedPositions[displayId],
    screen,
  })
  return { created, display, onFatal, onPositionChanged, pet, powerMonitor, screen, secondary }
}

function settlementWithin(promise: Promise<void>) {
  return Promise.race([
    promise.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    ),
    new Promise<{ status: "timeout" }>((resolve) => {
      setTimeout(() => resolve({ status: "timeout" }), 50)
    }),
  ])
}

describe("PetWindow", () => {
  test("creates a hardened, inactive floating window and blocks ambient browser capabilities", async () => {
    const value = fixture()
    const selectedProvider = provider()
    await value.pet.open(selectedProvider)
    const created = value.created[0]!

    expect(created.options).toMatchObject({
      alwaysOnTop: true,
      frame: false,
      height: 176,
      show: false,
      skipTaskbar: true,
      transparent: true,
      width: 176,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: "convax-pet-overlay",
        preload: "/app/preload/pet.js",
        sandbox: true,
      },
    })
    expect(created.window.webContents.openHandler?.()).toEqual({ action: "deny" })
    expect(created.window.loadedUrl).toBe(selectedProvider.overlayUrl)
    expect(value.pet.isTrustedWebContentsId(created.window.webContents.id)).toBe(true)

    const sameProviderNavigation = { preventDefault: mock(() => undefined) }
    created.window.webContents.emit(
      "will-navigate",
      sameProviderNavigation,
      "convax-plugin://soft-companion/pet/next.html",
    )
    expect(sameProviderNavigation.preventDefault).not.toHaveBeenCalled()
    for (const url of [
      "convax-plugin://other-provider/pet/index.html",
      "https://example.invalid/",
      "data:text/html,escaped",
      "file:///tmp/escaped.html",
    ]) {
      const navigation = { preventDefault: mock(() => undefined) }
      created.window.webContents.emit("will-navigate", navigation, url)
      expect(navigation.preventDefault).toHaveBeenCalled()
    }
    const subframe = {
      isMainFrame: false,
      preventDefault: mock(() => undefined),
      url: "convax-plugin://soft-companion/pet/frame.html",
    }
    created.window.webContents.emit("will-frame-navigate", subframe)
    expect(subframe.preventDefault).toHaveBeenCalled()
    const download = { preventDefault: mock(() => undefined) }
    created.window.webContents.session.emit?.("will-download", download)
    let permissionAllowed = true
    created.window.webContents.session.permissionRequestHandler?.({}, "camera", (allowed) => {
      permissionAllowed = allowed
    })
    expect(permissionAllowed).toBe(false)
    expect(created.window.webContents.session.permissionCheckHandler?.()).toBe(false)

    created.window.webContents.emit("did-finish-load")
    expect(created.window.showInactive).toHaveBeenCalled()
    expect(created.window.webContents.send).not.toHaveBeenCalled()
  })

  test("clamps movement, persists only completed drag, and re-clamps on display changes", async () => {
    const value = fixture()
    await value.pet.open(provider())
    await value.pet.moveBy({ x: 5_000, y: -5_000 }, false)
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 1_824, y: 0 })
    expect(value.onPositionChanged).not.toHaveBeenCalled()
    await value.pet.moveBy({ x: -10, y: 20 }, true)
    expect(value.onPositionChanged).toHaveBeenCalledWith("8", { x: 1_814, y: 20 }, 2)

    value.created[0]!.window.bounds = { height: 176, width: 176, x: 5_000, y: -20 }
    value.screen.emit("display-metrics-changed")
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 1_824, y: 0 })
  })

  test("restores and clamps the saved position for the selected display", async () => {
    const value = fixture({ "7": { x: 920, y: 100 } })
    await value.pet.open(provider())
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 824, y: 100 })
  })

  test("crosses displays while dragging and restores a saved secondary-display position", async () => {
    const value = fixture({ "7": { scaleFactor: 1, x: 400, y: 200 }, "8": { scaleFactor: 2, x: 1_240, y: 120 } }, "8")
    await value.pet.open(provider())
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 1_240, y: 120 })

    value.created[0]!.window.bounds = { height: 176, width: 176, x: 824, y: 120 }
    await value.pet.moveBy({ x: 240, y: 0 }, true)
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 1_064, y: 120 })
    expect(value.onPositionChanged).toHaveBeenCalledWith("8", { x: 1_064, y: 120 }, 2)
  })

  test("reuses only the exact provider binding and remounts after digest or generation changes", async () => {
    const value = fixture()
    const selectedProvider = provider()
    await value.pet.open(selectedProvider)
    await value.pet.open(provider())
    expect(value.created).toHaveLength(1)

    value.created[0]!.window.refuseClose = true
    await value.pet.open(provider({ digest: "digest:soft-companion:2", generation: 2, version: "1.1.0" }))
    expect(value.created).toHaveLength(2)
    expect(value.created[0]!.window.destroyed).toBe(true)

    await value.pet.open(provider({ digest: "digest:soft-companion:2", generation: 3, version: "1.1.0" }))
    expect(value.created).toHaveLength(3)
    expect(value.created[1]!.window.destroyed).toBe(true)
  })

  test("force-destroys untrusted overlays when tucked or disposed", async () => {
    const tucked = fixture()
    await tucked.pet.open(provider())
    tucked.created[0]!.window.refuseClose = true
    await tucked.pet.close()
    expect(tucked.created[0]!.window.destroyed).toBe(true)
    expect(tucked.pet.isTrustedWebContentsId(tucked.created[0]!.window.webContents.id)).toBe(false)

    const disposed = fixture()
    await disposed.pet.open(provider())
    disposed.created[0]!.window.refuseClose = true
    await disposed.pet.dispose()
    expect(disposed.created[0]!.window.destroyed).toBe(true)
    expect(disposed.pet.isTrustedWebContentsId(disposed.created[0]!.window.webContents.id)).toBe(false)
  })

  test("recreates once after Plugin overlay crash and tucks after a second crash", async () => {
    const value = fixture()
    await value.pet.open(provider())
    value.created[0]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value.created).toHaveLength(2)
    expect(value.created[1]!.window.loadedUrl).toBe("convax-plugin://soft-companion/pet/index.html")

    value.created[1]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value.onFatal).toHaveBeenCalledTimes(1)
    expect(value.created).toHaveLength(2)
  })

  test("tucks exactly once when the first crash recovery overlay fails to load", async () => {
    const value = fixture({}, undefined, (window, index) => {
      if (index === 1) window.loadError = new Error("recovery load failed")
    })
    await value.pet.open(provider())

    value.created[0]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(value.created).toHaveLength(2)
    expect(value.created[1]!.window.destroyed).toBe(true)
    expect(value.onFatal).toHaveBeenCalledTimes(1)
    expect(value.pet.isTrustedWebContentsId(value.created[1]!.window.webContents.id)).toBe(false)
  })

  test("settles the initial open from a successful recovery while its first load remains pending", async () => {
    const never = new Promise<void>(() => undefined)
    const value = fixture({}, undefined, (window, index) => {
      if (index === 0) window.loadTask = never
    })
    const opening = value.pet.open(provider())

    value.created[0]!.window.webContents.emit("render-process-gone")

    expect(await settlementWithin(opening)).toEqual({ status: "resolved" })
    expect(value.created).toHaveLength(2)
    expect(value.created[0]!.window.destroyed).toBe(true)
    expect(value.created[1]!.window.destroyed).toBe(false)
    expect(value.pet.isTrustedWebContentsId(value.created[1]!.window.webContents.id)).toBe(true)
    expect(value.onFatal).not.toHaveBeenCalled()
  })

  test("ignores the first load rejection after its recovery becomes current", async () => {
    let rejectFirst!: (error: Error) => void
    const firstLoad = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const value = fixture({}, undefined, (window, index) => {
      if (index === 0) window.loadTask = firstLoad
    })
    const opening = value.pet.open(provider())

    value.created[0]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    rejectFirst(new Error("stale first load failed"))

    expect(await settlementWithin(opening)).toEqual({ status: "resolved" })
    expect(value.created).toHaveLength(2)
    expect(value.created[1]!.window.destroyed).toBe(false)
    expect(value.pet.isTrustedWebContentsId(value.created[1]!.window.webContents.id)).toBe(true)
    expect(value.onFatal).not.toHaveBeenCalled()
  })

  test("rejects the initial open when its crash recovery fails to load", async () => {
    const never = new Promise<void>(() => undefined)
    const value = fixture({}, undefined, (window, index) => {
      if (index === 0) window.loadTask = never
      if (index === 1) window.loadError = new Error("recovery load failed")
    })
    const opening = value.pet.open(provider())

    value.created[0]!.window.webContents.emit("render-process-gone")

    expect((await settlementWithin(opening)).status).toBe("rejected")
    expect(value.created).toHaveLength(2)
    expect(value.created[0]!.window.destroyed).toBe(true)
    expect(value.created[1]!.window.destroyed).toBe(true)
    expect(value.onFatal).toHaveBeenCalledTimes(1)
    expect(value.pet.isTrustedWebContentsId(value.created[1]!.window.webContents.id)).toBe(false)
  })

  test("propagates a terminal second crash through nested pending create attempts", async () => {
    let rejectFirst!: (error: Error) => void
    let rejectRecovery!: (error: Error) => void
    const firstLoad = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const recoveryLoad = new Promise<void>((_resolve, reject) => {
      rejectRecovery = reject
    })
    const value = fixture({}, undefined, (window, index) => {
      if (index === 0) window.loadTask = firstLoad
      if (index === 1) window.loadTask = recoveryLoad
    })
    const opening = value.pet.open(provider())

    value.created[0]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value.created).toHaveLength(2)

    value.created[1]!.window.webContents.emit("render-process-gone")
    expect((await settlementWithin(opening)).status).toBe("rejected")
    expect(value.onFatal).toHaveBeenCalledTimes(1)
    expect(value.created[0]!.window.destroyed).toBe(true)
    expect(value.created[1]!.window.destroyed).toBe(true)
    expect(value.pet.isTrustedWebContentsId(value.created[0]!.window.webContents.id)).toBe(false)
    expect(value.pet.isTrustedWebContentsId(value.created[1]!.window.webContents.id)).toBe(false)

    rejectFirst(new Error("stale first load failed"))
    rejectRecovery(new Error("stale recovery load failed"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((await settlementWithin(opening)).status).toBe("rejected")
    expect(value.onFatal).toHaveBeenCalledTimes(1)
    expect(value.pet.isTrustedWebContentsId(value.created[1]!.window.webContents.id)).toBe(false)
  })

  test("ignores a stale recovery rejection after a new provider binding opens", async () => {
    let rejectRecovery!: (error: Error) => void
    const recoveryLoad = new Promise<void>((_resolve, reject) => {
      rejectRecovery = reject
    })
    const value = fixture({}, undefined, (window, index) => {
      if (index === 1) window.loadTask = recoveryLoad
    })
    await value.pet.open(provider())

    value.created[0]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value.created).toHaveLength(2)

    const nextProvider = provider({
      digest: "digest:beta-pet:1",
      generation: 2,
      overlayUrl: "convax-plugin://beta-pet/pet/index.html",
      pluginId: "beta-pet",
    })
    await value.pet.open(nextProvider)
    rejectRecovery(new Error("stale recovery load failed"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(value.created).toHaveLength(3)
    expect(value.created[1]!.window.destroyed).toBe(true)
    expect(value.created[2]!.window.destroyed).toBe(false)
    expect(value.created[2]!.window.loadedUrl).toBe(nextProvider.overlayUrl)
    expect(value.pet.isTrustedWebContentsId(value.created[2]!.window.webContents.id)).toBe(true)
    expect(value.onFatal).not.toHaveBeenCalled()
  })
})

test("clampPetBounds keeps the complete surface in one display work area", () => {
  expect(
    clampPetBounds({ x: 5_000, y: -20 }, { height: 700, width: 900, x: 100, y: 50 }, { height: 176, width: 176 }),
  ).toEqual({ x: 824, y: 50 })
})
