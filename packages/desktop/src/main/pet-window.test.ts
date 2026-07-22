import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"

import type { PetRendererSnapshot } from "../pet-contracts"
import { clampPetBounds, PetWindow } from "./pet-window"

const snapshot: PetRendererSnapshot = {
  activity: { activities: [], revision: 1 },
  pet: {
    alt: "Violet",
    assetUrl: "convax-pet-asset://pet/plugin%3Apet",
    description: "A pixel companion",
    id: "plugin:pet",
    name: "Violet",
    source: "plugin",
    spriteVersion: 2,
  },
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
  loadedUrl?: string
  showInactive = mock(() => undefined)
  webContents = new FakeWebContents()

  close() {
    this.destroyed = true
    this.emit("closed")
  }

  destroy() {
    this.close()
  }

  getBounds() {
    return { ...this.bounds }
  }

  isDestroyed() {
    return this.destroyed
  }

  async loadURL(url: string) {
    this.loadedUrl = url
  }

  setBounds(bounds: Partial<typeof this.bounds>) {
    this.bounds = { ...this.bounds, ...bounds }
  }
}

function fixture(savedPosition?: { x: number; y: number }) {
  const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = []
  const screen = new EventEmitter() as EventEmitter & {
    getDisplayMatching(bounds: { height: number; width: number; x: number; y: number }): {
      id: number
      workArea: { height: number; width: number; x: number; y: number }
    }
    getPrimaryDisplay(): { id: number; workArea: { height: number; width: number; x: number; y: number } }
  }
  const display = { id: 7, workArea: { height: 700, width: 900, x: 100, y: 50 } }
  screen.getDisplayMatching = () => display
  screen.getPrimaryDisplay = () => display
  const powerMonitor = new EventEmitter()
  const onFatal = mock(async () => undefined)
  const onPositionChanged = mock(async () => undefined)
  const pet = new PetWindow({
    createWindow: (options) => {
      const window = new FakeWindow()
      created.push({ options, window })
      return window
    },
    onFatal,
    onPositionChanged,
    powerMonitor,
    preloadPath: "/app/preload/pet.js",
    rendererUrl: "file:///app/renderer/pet/index.html",
    resolvePosition: () => savedPosition,
    screen,
  })
  return { created, display, onFatal, onPositionChanged, pet, powerMonitor, screen }
}

describe("PetWindow", () => {
  test("creates a hardened, inactive floating window and blocks ambient browser capabilities", async () => {
    const value = fixture()
    await value.pet.open(snapshot)
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
        preload: "/app/preload/pet.js",
        sandbox: true,
      },
    })
    expect(created.window.webContents.openHandler?.()).toEqual({ action: "deny" })
    expect(created.window.loadedUrl).toBe("file:///app/renderer/pet/index.html")
    expect(value.pet.isTrustedWebContentsId(created.window.webContents.id)).toBe(true)

    const navigate = { preventDefault: mock(() => undefined) }
    created.window.webContents.emit("will-navigate", navigate, "https://example.invalid")
    expect(navigate.preventDefault).toHaveBeenCalled()
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
    expect(created.window.webContents.send).toHaveBeenCalledWith("pet:snapshot", snapshot)
  })

  test("clamps movement, persists only completed drag, and re-clamps on display changes", async () => {
    const value = fixture()
    await value.pet.open(snapshot)
    await value.pet.moveBy({ x: 5_000, y: -5_000 }, false)
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 824, y: 50 })
    expect(value.onPositionChanged).not.toHaveBeenCalled()
    await value.pet.moveBy({ x: -10, y: 20 }, true)
    expect(value.onPositionChanged).toHaveBeenCalledWith("7", { x: 814, y: 70 })

    value.created[0]!.window.bounds = { height: 176, width: 176, x: 5_000, y: -20 }
    value.screen.emit("display-metrics-changed")
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 824, y: 50 })
  })

  test("restores and clamps the saved position for the selected display", async () => {
    const value = fixture({ x: 920, y: 100 })
    await value.pet.open(snapshot)
    expect(value.created[0]!.window.bounds).toMatchObject({ x: 824, y: 100 })
  })

  test("recreates once after renderer crash and tucks after a second crash", async () => {
    const value = fixture()
    await value.pet.open(snapshot)
    value.created[0]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value.created).toHaveLength(2)

    value.created[1]!.window.webContents.emit("render-process-gone")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value.onFatal).toHaveBeenCalledTimes(1)
  })
})

test("clampPetBounds keeps the complete surface in one display work area", () => {
  expect(
    clampPetBounds({ x: 5_000, y: -20 }, { height: 700, width: 900, x: 100, y: 50 }, { height: 176, width: 176 }),
  ).toEqual({ x: 824, y: 50 })
})
