import type { InstalledPetProvider } from "./pet-provider-controller"
import { isAllowedWebPluginFrameNavigation } from "./plugin-asset-protocol"
import { petWindowPartition } from "./pet-session"

export const petCollapsedSize = { height: 176, width: 176 } as const
export const petExpandedSize = { height: 320, width: 356 } as const

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

export interface PetNativeWebContents {
  id: number
  isDestroyed(): boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  once(event: string, listener: (...args: any[]) => void): unknown
  postMessage(channel: string, message: unknown, transfer?: readonly unknown[]): void
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  session: PetNativeSession
  setWindowOpenHandler(handler: () => { action: "deny" }): void
}

export interface PetNativeWindow {
  destroy(): void
  getBounds(): PetRectangle
  isDestroyed(): boolean
  loadURL(url: string): Promise<unknown> | unknown
  on(event: string, listener: (...args: any[]) => void): unknown
  once?(event: string, listener: (...args: any[]) => void): unknown
  setBounds(bounds: Partial<PetRectangle>): void
  setVisibleOnAllWorkspaces?(
    visible: boolean,
    options: { visibleOnFullScreen: boolean },
  ): void
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
  onLoaded?(webContents: PetNativeWebContents, provider: InstalledPetProvider): Promise<unknown> | unknown
  onPositionChanged(displayId: string, position: PetPoint, scaleFactor: number): Promise<void> | void
  powerMonitor: PetPowerMonitorPort
  platform?: NodeJS.Platform
  preloadPath: string
  resolveDisplayId?(): string | undefined
  resolvePosition?(displayId: string): PetSavedPosition | undefined
  screen: PetScreenPort
}

function sameProviderBinding(left: InstalledPetProvider, right: InstalledPetProvider) {
  return (
    left.pluginId === right.pluginId &&
    left.digest === right.digest &&
    left.generation === right.generation &&
    left.overlayUrl === right.overlayUrl
  )
}

function cloneProvider(provider: InstalledPetProvider): InstalledPetProvider {
  return {
    ...provider,
    capabilities: [...provider.capabilities],
    contribution: { ...provider.contribution },
  }
}

type PetCreateOutcome =
  | { status: "loaded" }
  | { status: "load-failed"; error: unknown }
  | { status: "recovered" }
  | { status: "recovery-failed"; error: unknown }

type PetCrashOutcome = { status: "recovered" } | { status: "terminal"; error: PetTerminalRecoveryError }

class PetTerminalRecoveryError extends Error {
  readonly failure: unknown

  constructor(failure?: unknown) {
    super("Pet overlay recovery reached a terminal failure")
    this.name = "PetTerminalRecoveryError"
    this.failure = failure
  }
}

function terminalRecoveryError(error?: unknown) {
  return error instanceof PetTerminalRecoveryError ? error : new PetTerminalRecoveryError(error)
}

export class PetWindow {
  readonly #options: PetWindowOptions
  #crashes = 0
  #expanded = false
  #generation = 0
  readonly #platform: NodeJS.Platform
  #provider?: InstalledPetProvider
  #window?: PetNativeWindow
  readonly #reclampListener = () => this.#reclamp()

  constructor(options: PetWindowOptions) {
    this.#options = options
    this.#platform = options.platform ?? process.platform
    options.screen.on("display-removed", this.#reclampListener)
    options.screen.on("display-metrics-changed", this.#reclampListener)
    options.powerMonitor.on("resume", this.#reclampListener)
  }

  async open(provider: InstalledPetProvider) {
    const current = this.#window
    if (current && !current.isDestroyed() && this.#provider && sameProviderBinding(this.#provider, provider)) {
      current.showInactive()
      return
    }
    const generation = ++this.#generation
    this.#crashes = 0
    this.#provider = cloneProvider(provider)
    this.#window = undefined
    this.#destroyWindow(current)
    try {
      await this.#create(generation)
    } catch (error) {
      if (generation === this.#generation) this.#provider = undefined
      throw error
    }
  }

  async close() {
    this.#generation += 1
    this.#crashes = 0
    this.#provider = undefined
    const current = this.#window
    this.#window = undefined
    this.#destroyWindow(current)
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
    const desired = {
      x: bounds.x + bounds.width - size.width,
      y: bounds.y + bounds.height - size.height,
    }
    const display = this.#options.screen.getDisplayMatching({ ...desired, ...size })
    const position = clampPetBounds(desired, display.workArea, size)
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
    const provider = this.#provider
    if (!provider || generation !== this.#generation) return
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
      fullscreenable: false,
      hasShadow: false,
      height: size.height,
      resizable: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      ...(this.#platform === "darwin" ? { type: "panel" } : {}),
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
    if (this.#platform === "darwin") {
      window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })
    }
    window.setBounds({ ...position, ...size })
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event: { preventDefault(): void }, url: string) => {
      if (!isAllowedWebPluginFrameNavigation(provider.overlayUrl, url, provider.pluginId)) event.preventDefault()
    })
    window.webContents.on(
      "will-frame-navigate",
      (event: { isMainFrame: boolean; preventDefault(): void; url: string }) => {
        if (
          !event.isMainFrame ||
          !isAllowedWebPluginFrameNavigation(provider.overlayUrl, event.url, provider.pluginId)
        ) {
          event.preventDefault()
        }
      },
    )
    window.webContents.on("will-attach-webview", (event: { preventDefault(): void }) => event.preventDefault())
    window.webContents.session.on("will-download", (event) => event.preventDefault())
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    let crashStarted = false
    let settleCrash!: (outcome: PetCreateOutcome) => void
    const crashOutcome = new Promise<PetCreateOutcome>((resolve) => {
      settleCrash = resolve
    })
    window.webContents.on("render-process-gone", () => {
      if (crashStarted) return
      crashStarted = true
      void this.#handleCrash(window, generation).then(
        (outcome) =>
          settleCrash(
            outcome.status === "recovered"
              ? { status: "recovered" }
              : { error: outcome.error, status: "recovery-failed" },
          ),
        (error: unknown) => settleCrash({ error: terminalRecoveryError(error), status: "recovery-failed" }),
      )
    })
    window.on("closed", () => {
      if (this.#window === window) this.#window = undefined
    })
    const loadOutcome = Promise.resolve()
      .then(() => window.loadURL(provider.overlayUrl))
      .then(async () => {
        if (!this.#isCurrentCreate(window, generation, provider)) return
        await this.#options.onLoaded?.(window.webContents, cloneProvider(provider))
        if (this.#isCurrentCreate(window, generation, provider)) window.showInactive()
      })
      .then<PetCreateOutcome, PetCreateOutcome>(
        () => ({ status: "loaded" }),
        (error: unknown) => ({ error, status: "load-failed" }),
      )
    const outcome = await Promise.race([
      loadOutcome.then((settled) => (crashStarted ? crashOutcome : settled)),
      crashOutcome,
    ])
    if (outcome.status === "loaded" || outcome.status === "recovered") return
    if (outcome.status === "recovery-failed") throw outcome.error
    if (!this.#isCurrentCreate(window, generation, provider)) return
    this.#window = undefined
    this.#destroyWindow(window)
    throw outcome.error
  }

  async #handleCrash(window: PetNativeWindow, generation: number): Promise<PetCrashOutcome> {
    const provider = this.#provider
    if (window !== this.#window || generation !== this.#generation || !provider) {
      return { status: "recovered" }
    }
    this.#crashes += 1
    this.#window = undefined
    this.#destroyWindow(window)
    if (this.#crashes === 1) {
      try {
        await this.#create(generation)
        return { status: "recovered" }
      } catch (error) {
        if (error instanceof PetTerminalRecoveryError) {
          return { error, status: "terminal" }
        }
        const currentProvider = this.#provider
        if (generation !== this.#generation || !currentProvider || !sameProviderBinding(provider, currentProvider)) {
          return { status: "recovered" }
        }
        const recovery = this.#window
        this.#window = undefined
        this.#provider = undefined
        this.#destroyWindow(recovery)
        await this.#options.onFatal()
        return { error: terminalRecoveryError(error), status: "terminal" }
      }
    }
    this.#provider = undefined
    await this.#options.onFatal()
    return { error: terminalRecoveryError(), status: "terminal" }
  }

  #isCurrentCreate(window: PetNativeWindow, generation: number, provider: InstalledPetProvider) {
    const currentProvider = this.#provider
    return (
      window === this.#window &&
      generation === this.#generation &&
      currentProvider !== undefined &&
      sameProviderBinding(provider, currentProvider)
    )
  }

  #destroyWindow(window: PetNativeWindow | undefined) {
    if (window && !window.isDestroyed()) window.destroy()
  }

  #reclamp() {
    const current = this.#window
    if (!current || current.isDestroyed()) return
    const bounds = current.getBounds()
    const display = this.#options.screen.getDisplayMatching(bounds)
    current.setBounds(clampPetBounds(bounds, display.workArea, bounds))
  }
}
