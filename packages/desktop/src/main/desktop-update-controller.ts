import { CancellationError, CancellationToken, type ProgressInfo, type UpdateInfo } from "builder-util-runtime"
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from "electron"

type UpdateApplication = {
  getVersion(): string
  isPackaged: boolean
}

type UpdateDialog = {
  showMessageBox(window: BrowserWindow, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
}

type UpdateProvider = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<null | { isUpdateAvailable: boolean; updateInfo: UpdateInfo }>
  disableWebInstaller: boolean
  downloadUpdate(cancellation?: CancellationToken): Promise<string[]>
  off(event: "download-progress", listener: (progress: ProgressInfo) => void): unknown
  off(event: "error", listener: (error: Error) => void): unknown
  on(event: "download-progress", listener: (progress: ProgressInfo) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface DesktopUpdateProgressWindow {
  close(): void
  focus(): void
  show(owner: BrowserWindow, version: string, onCancel: () => void): void
  update(progress: ProgressInfo): void
}

export interface DesktopUpdateControllerOptions {
  application: UpdateApplication
  dialog: UpdateDialog
  platform: NodeJS.Platform
  prepareInstall(): Promise<void>
  productName: string
  progressWindow: DesktopUpdateProgressWindow
  recoverCurrentVersionAfterInstallFailure(): void
  updater: UpdateProvider
}

export interface DesktopUpdateController {
  checkAutomatically(window: BrowserWindow): Promise<void>
  checkManually(window: BrowserWindow): Promise<void>
  dispose(): void
}

export function createDesktopUpdateController(options: DesktopUpdateControllerOptions): DesktopUpdateController {
  return new MainDesktopUpdateController(options)
}

class MainDesktopUpdateController implements DesktopUpdateController {
  private activeCancellation: CancellationToken | null = null
  private downloadedUpdate: UpdateInfo | null = null
  private disposed = false
  private isChecking = false
  private isDownloading = false

  private readonly onDownloadProgress = (progress: ProgressInfo) => {
    if (this.isDownloading) this.options.progressWindow.update(progress)
  }

  private readonly onUpdaterError = (error: Error) => {
    console.warn("Convax updater reported an error", safeUpdateError(error))
  }

  constructor(private readonly options: DesktopUpdateControllerOptions) {
    options.updater.autoDownload = false
    options.updater.autoInstallOnAppQuit = false
    options.updater.disableWebInstaller = true
    options.updater.on("download-progress", this.onDownloadProgress)
    options.updater.on("error", this.onUpdaterError)
  }

  checkAutomatically(window: BrowserWindow) {
    return this.check(window, { notifyFailure: false, notifyNoUpdate: false, notifyUnsupported: false })
  }

  checkManually(window: BrowserWindow) {
    return this.check(window, { notifyFailure: true, notifyNoUpdate: true, notifyUnsupported: true })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.activeCancellation?.cancel()
    this.activeCancellation?.dispose()
    this.activeCancellation = null
    this.options.progressWindow.close()
    this.options.updater.off("download-progress", this.onDownloadProgress)
    this.options.updater.off("error", this.onUpdaterError)
  }

  private async check(
    window: BrowserWindow,
    notifications: { notifyFailure: boolean; notifyNoUpdate: boolean; notifyUnsupported: boolean },
  ) {
    if (this.disposed) return
    if (!this.isSupported()) {
      if (notifications.notifyUnsupported) await this.showUnsupported(window)
      return
    }
    if (this.isDownloading) {
      this.options.progressWindow.focus()
      return
    }
    if (this.downloadedUpdate) {
      await this.promptToInstall(window, this.downloadedUpdate)
      return
    }
    if (this.isChecking) return

    this.isChecking = true
    try {
      const result = await this.options.updater.checkForUpdates()
      if (this.disposed) return
      if (result?.isUpdateAvailable) {
        await this.promptToDownload(window, result.updateInfo)
      } else if (notifications.notifyNoUpdate) {
        await this.showNoUpdate(window)
      }
    } catch (error) {
      console.warn("Convax update check failed", safeUpdateError(error))
      if (notifications.notifyFailure) await this.showCheckFailed(window)
    } finally {
      this.isChecking = false
    }
  }

  private isSupported() {
    return (
      this.options.application.isPackaged && (this.options.platform === "darwin" || this.options.platform === "win32")
    )
  }

  private async promptToDownload(window: BrowserWindow, info: UpdateInfo) {
    const { response } = await this.options.dialog.showMessageBox(window, {
      buttons: ["Download update", "Later"],
      cancelId: 1,
      defaultId: 0,
      detail: [
        `Current version: ${this.options.application.getVersion()}`,
        `New version: ${info.version}`,
        "",
        updateDetails(info),
      ].join("\n"),
      message: `${this.options.productName} ${info.version} is available.`,
      noLink: true,
      title: "Update available",
      type: "info",
    })
    if (!this.disposed && response === 0) await this.downloadWithRetry(window, info)
  }

  private async downloadWithRetry(window: BrowserWindow, info: UpdateInfo) {
    if (this.disposed) return
    if (this.isDownloading) {
      this.options.progressWindow.focus()
      return
    }

    this.isDownloading = true
    try {
      while (true) {
        const cancellation = new CancellationToken()
        this.activeCancellation = cancellation
        this.options.progressWindow.show(window, info.version, () => cancellation.cancel())
        try {
          await this.options.updater.downloadUpdate(cancellation)
          if (cancellation.cancelled) throw new CancellationError()
          this.downloadedUpdate = info
          this.options.progressWindow.close()
          await this.promptToInstall(window, info)
          return
        } catch (error) {
          this.options.progressWindow.close()
          const cancelled = cancellation.cancelled || error instanceof CancellationError
          console.warn(
            cancelled ? "Convax update download was cancelled" : "Convax update download failed",
            cancelled ? undefined : safeUpdateError(error),
          )
          if (this.disposed) return
          if (!(await this.promptToRetryDownload(window, cancelled))) return
        } finally {
          cancellation.dispose()
          if (this.activeCancellation === cancellation) this.activeCancellation = null
        }
      }
    } finally {
      this.isDownloading = false
    }
  }

  private async promptToRetryDownload(window: BrowserWindow, cancelled: boolean) {
    const { response } = await this.options.dialog.showMessageBox(window, {
      buttons: ["Retry", "Later"],
      cancelId: 1,
      defaultId: 0,
      detail: cancelled
        ? "Retry uses the updater cache when a verified partial download can be resumed."
        : "Check your connection and try again. The current installed version has not been changed.",
      message: cancelled ? "The update download was cancelled." : "The update could not be downloaded or verified.",
      noLink: true,
      title: cancelled ? "Download cancelled" : "Update download failed",
      type: cancelled ? "info" : "warning",
    })
    return response === 0
  }

  private async promptToInstall(window: BrowserWindow, info: UpdateInfo) {
    const { response } = await this.options.dialog.showMessageBox(window, {
      buttons: ["Restart and install", "Later"],
      cancelId: 1,
      defaultId: 0,
      detail:
        "Convax will finish saving Project changes and wait for accepted tasks to settle before it closes. If preparation fails, the current version stays open.",
      message: `${this.options.productName} ${info.version} is ready to install.`,
      noLink: true,
      title: "Update ready",
      type: "info",
    })
    if (this.disposed || response !== 0) return

    try {
      await this.options.prepareInstall()
      this.options.updater.quitAndInstall(false, true)
    } catch (error) {
      console.error("Convax update installation could not start", safeUpdateError(error))
      await this.options.dialog.showMessageBox(window, {
        buttons: ["Restart current version"],
        cancelId: 0,
        defaultId: 0,
        detail: "The update was not installed. Convax will reopen the current version so you can try again.",
        message: "Convax could not start the update installer.",
        noLink: true,
        title: "Update installation failed",
        type: "error",
      })
      this.options.recoverCurrentVersionAfterInstallFailure()
    }
  }

  private showUnsupported(window: BrowserWindow) {
    return this.options.dialog.showMessageBox(window, {
      buttons: ["OK"],
      cancelId: 0,
      defaultId: 0,
      detail: "Online updates are available in signed macOS and Windows release builds.",
      message: `${this.options.productName} ${this.options.application.getVersion()} cannot update from this build.`,
      noLink: true,
      title: "Updates unavailable",
      type: "info",
    })
  }

  private showNoUpdate(window: BrowserWindow) {
    return this.options.dialog.showMessageBox(window, {
      buttons: ["OK"],
      cancelId: 0,
      defaultId: 0,
      message: `${this.options.productName} ${this.options.application.getVersion()} is up to date.`,
      noLink: true,
      title: "No updates available",
      type: "info",
    })
  }

  private showCheckFailed(window: BrowserWindow) {
    return this.options.dialog.showMessageBox(window, {
      buttons: ["OK"],
      cancelId: 0,
      defaultId: 0,
      detail: "Check your connection and try again. The current installed version has not been changed.",
      message: `${this.options.productName} could not check for updates.`,
      noLink: true,
      title: "Update check failed",
      type: "warning",
    })
  }
}

export function updateDetails(info: UpdateInfo) {
  const notes = normalizeReleaseNotes(info.releaseNotes)
  const compatibility = info.minimumSystemVersion
    ? `Requires operating system kernel ${info.minimumSystemVersion} or newer.`
    : "This package matches the current platform. Review the release notes for any additional system requirements."
  return [compatibility, notes ? `\nWhat’s new:\n${notes}` : ""].join("").slice(0, 8_192)
}

function normalizeReleaseNotes(notes: UpdateInfo["releaseNotes"]) {
  if (typeof notes === "string") return notes.trim()
  if (!Array.isArray(notes)) return ""
  return notes
    .map((entry) => (entry.note?.trim() ? `${entry.version}: ${entry.note.trim()}` : ""))
    .filter(Boolean)
    .join("\n")
}

function safeUpdateError(error: unknown) {
  const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return value.replace(/[\r\n]+/g, " ").slice(0, 2_048)
}
