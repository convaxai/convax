import type { PetRendererSnapshot } from "../pet-contracts"
import { petWindowPartition } from "./pet-session"

export const petCollapsedSize = { height: 176, width: 176 } as const
export const petExpandedSize = { height: 320, width: 356 } as const
export const petSnapshotChannel = "pet:snapshot"

export interface PetPoint {
  x: number
  y: number
}

export interface PetSavedPosition extends PetPoint {
  scaleFactor?: number
}

export interface PetRectangle extends PetPoint {
  height: number
  width: number
}

export function clampPetBounds(
  position: PetPoint,
  workArea: PetRectangle,
  size: { height: number; width: number },
): PetPoint {
  const maximumX = Math.max(workArea.x, workArea.x + workArea.width - size.width)
  const maximumY = Math.max(workArea.y, workArea.y + workArea.height - size.height)
  return {
    x: Math.min(Math.max(Math.round(position.x), workArea.x), maximumX),
    y: Math.min(Math.max(Math.round(position.y), workArea.y), maximumY),
  }
}

interface PetNativeSession {
  on(event: "will-download", listener: (event: { preventDefault(): void }) => void): unknown
  setPermissionCheckHandler(handler: () => boolean): void
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void,
  ): void
}

interface PetNativeWebContents {
  id: number
  on(event: string, listener: (...args: any[]) => void): unknown
  send(channel: string, snapshot: PetRendererSnapshot): void
  session: PetNativeSession
  setWindowOpenHandler(handler: () => { action: "deny" }): void
}

export interface PetNativeWindow {
  close(): void
  destroy(): void
  getBounds(): PetRectangle
  isDestroyed(): boolean
  loadURL(url: string): Promise<unknown> | unknown
  on(event: string, listener: (...args: any[]) => void): unknown
  once?(event: string, listener: (...args: any[]) => void): unknown
  setBounds(bounds: Partial<PetRectangle>): void
  showInactive(): void
  webContents: PetNativeWebContents
}

interface PetDisplay {
  id: number | string
  scaleFactor: number
  workArea: PetRectangle
}

interface PetScreenPort {
  getAllDisplays(): PetDisplay[]
  getDisplayMatching(bounds: PetRectangle): PetDisplay
  getPrimaryDisplay(): PetDisplay
  on(event: "display-metrics-changed" | "display-removed", listener: () => void): unknown
  removeListener?(event: "display-metrics-changed" | "display-removed", listener: () => void): unknown
}

interface PetPowerMonitorPort {
  on(event: "resume", listener: () => void): unknown
  removeListener?(event: "resume", listener: () => void): unknown
}

export interface PetWindowOptions {
  createWindow(options: Record<string, unknown>): PetNativeWindow
  onFatal(): Promise<void> | void
  onPositionChanged(displayId: string, position: PetPoint, scaleFactor: number): Promise<void> | void
  powerMonitor: PetPowerMonitorPort
  preloadPath: string
  rendererUrl: string
  resolveDisplayId?(): string | undefined
  resolvePosition?(displayId: string): PetSavedPosition | undefined
  screen: PetScreenPort
}

function sameNavigationUrl(left: string, right: string) {
  try {
    const actual = new URL(left)
    const expected = new URL(right)
    return (
      actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname
    )
  } catch {
    return false
  }
}

export class PetWindow {
  readonly #options: PetWindowOptions
  #crashes = 0
  #expanded = false
  #generation = 0
  #snapshot?: PetRendererSnapshot
  #window?: PetNativeWindow
  readonly #reclampListener = () => this.#reclamp()

  constructor(options: PetWindowOptions) {
    this.#options = options
    options.screen.on("display-removed", this.#reclampListener)
    options.screen.on("display-metrics-changed", this.#reclampListener)
    options.powerMonitor.on("resume", this.#reclampListener)
  }

  async open(snapshot: PetRendererSnapshot) {
    this.#snapshot = snapshot
    const current = this.#window
    if (current && !current.isDestroyed()) {
      current.webContents.send(petSnapshotChannel, snapshot)
      current.showInactive()
      return
    }
    this.#generation += 1
    this.#crashes = 0
    await this.#create(this.#generation)
  }

  update(snapshot: PetRendererSnapshot) {
    this.#snapshot = snapshot
    const current = this.#window
    if (current && !current.isDestroyed()) current.webContents.send(petSnapshotChannel, snapshot)
  }

  async close() {
    this.#generation += 1
    this.#crashes = 0
    this.#snapshot = undefined
    const current = this.#window
    this.#window = undefined
    if (current && !current.isDestroyed()) current.close()
  }

  isTrustedWebContentsId(id: number) {
    const current = this.#window
    return Boolean(current && !current.isDestroyed() && current.webContents.id === id)
  }

  async dispose() {
    this.#options.screen.removeListener?.("display-removed", this.#reclampListener)
    this.#options.screen.removeListener?.("display-metrics-changed", this.#reclampListener)
    this.#options.powerMonitor.removeListener?.("resume", this.#reclampListener)
    await this.close()
  }

  async setExpanded(expanded: boolean) {
    this.#expanded = expanded
    const current = this.#window
    if (!current || current.isDestroyed()) return
    const bounds = current.getBounds()
    const size = expanded ? petExpandedSize : petCollapsedSize
    const display = this.#options.screen.getDisplayMatching(bounds)
    const position = clampPetBounds(bounds, display.workArea, size)
    current.setBounds({ ...position, ...size })
  }

  async moveBy(delta: PetPoint, completed: boolean) {
    const current = this.#window
    if (!current || current.isDestroyed()) return
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error("Pet drag delta must be finite")
    const bounds = current.getBounds()
    const display = this.#options.screen.getDisplayMatching({
      ...bounds,
      x: bounds.x + delta.x,
      y: bounds.y + delta.y,
    })
    const position = clampPetBounds({ x: bounds.x + delta.x, y: bounds.y + delta.y }, display.workArea, bounds)
    current.setBounds(position)
    if (completed) await this.#options.onPositionChanged(String(display.id), position, display.scaleFactor)
  }

  async #create(generation: number) {
    const snapshot = this.#snapshot
    if (!snapshot || generation !== this.#generation) return
    const primaryDisplay = this.#options.screen.getPrimaryDisplay()
    const savedDisplayId = this.#options.resolveDisplayId?.()
    const savedCandidates = this.#options.screen
      .getAllDisplays()
      .map((display) => ({ display, position: this.#options.resolvePosition?.(String(display.id)) }))
      .filter(
        (candidate): candidate is { display: PetDisplay; position: PetSavedPosition } =>
          candidate.position !== undefined,
      )
    const saved =
      savedCandidates.find((candidate) => String(candidate.display.id) === savedDisplayId) ?? savedCandidates[0]
    const display = saved?.display ?? primaryDisplay
    const size = this.#expanded ? petExpandedSize : petCollapsedSize
    const restoredPosition = saved?.position
    const position = clampPetBounds(
      restoredPosition ?? {
        x: display.workArea.x + display.workArea.width - size.width - 24,
        y: display.workArea.y + display.workArea.height - size.height - 24,
      },
      display.workArea,
      size,
    )
    const window = this.#options.createWindow({
      alwaysOnTop: true,
      focusable: true,
      frame: false,
      hasShadow: false,
      height: size.height,
      resizable: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      width: size.width,
      x: position.x,
      y: position.y,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: petWindowPartition,
        preload: this.#options.preloadPath,
        sandbox: true,
      },
    })
    this.#window = window
    window.setBounds({ ...position, ...size })
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event: { preventDefault(): void }, url: string) => {
      if (!sameNavigationUrl(url, this.#options.rendererUrl)) event.preventDefault()
    })
    window.webContents.on(
      "will-frame-navigate",
      (event: { isMainFrame: boolean; preventDefault(): void; url: string }) => {
        if (!event.isMainFrame || !sameNavigationUrl(event.url, this.#options.rendererUrl)) event.preventDefault()
      },
    )
    window.webContents.on("will-attach-webview", (event: { preventDefault(): void }) => event.preventDefault())
    window.webContents.session.on("will-download", (event) => event.preventDefault())
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.on("did-finish-load", () => {
      if (window !== this.#window || generation !== this.#generation || !this.#snapshot) return
      window.webContents.send(petSnapshotChannel, this.#snapshot)
      window.showInactive()
    })
    window.webContents.on("render-process-gone", () => {
      void this.#handleCrash(window, generation)
    })
    window.on("closed", () => {
      if (this.#window === window) this.#window = undefined
    })
    await window.loadURL(this.#options.rendererUrl)
  }

  async #handleCrash(window: PetNativeWindow, generation: number) {
    if (window !== this.#window || generation !== this.#generation || !this.#snapshot) return
    this.#crashes += 1
    this.#window = undefined
    if (!window.isDestroyed()) window.destroy()
    if (this.#crashes === 1) {
      await this.#create(generation)
      return
    }
    this.#snapshot = undefined
    await this.#options.onFatal()
  }

  #reclamp() {
    const current = this.#window
    if (!current || current.isDestroyed()) return
    const bounds = current.getBounds()
    const display = this.#options.screen.getDisplayMatching(bounds)
    current.setBounds(clampPetBounds(bounds, display.workArea, bounds))
  }
}
