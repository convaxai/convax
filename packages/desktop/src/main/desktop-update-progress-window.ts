import type { ProgressInfo } from "builder-util-runtime"
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"

type ProgressBrowserWindow = Pick<
  BrowserWindow,
  "close" | "focus" | "isDestroyed" | "loadURL" | "on" | "setProgressBar" | "show"
>

type BrowserWindowConstructor = new (options: BrowserWindowConstructorOptions) => ProgressBrowserWindow

export interface FormattedDesktopUpdateProgress {
  percent: string
  progress: number | null
  size: string
  speed: string
}

export function formatDesktopUpdateProgress(
  progress: Partial<Pick<ProgressInfo, "bytesPerSecond" | "percent" | "total" | "transferred">>,
  previous?: FormattedDesktopUpdateProgress,
): FormattedDesktopUpdateProgress {
  const hasPercent = Number.isFinite(progress.percent)
  const percent = Math.min(100, Math.max(0, progress.percent ?? 0))
  const transferred = finitePositive(progress.transferred)
  const total = finitePositive(progress.total)
  const measuredSpeed = finitePositive(progress.bytesPerSecond)
  const speed = measuredSpeed > 0 ? `${formatBytes(measuredSpeed)}/s` : transferred > 0 ? "Calculating…" : "Connecting…"
  return {
    percent: hasPercent ? `${percent.toFixed(1)}%` : transferred > 0 ? "Downloading…" : "Starting…",
    progress: hasPercent ? percent / 100 : null,
    size:
      total > 0
        ? `${formatBytes(transferred)} / ${formatBytes(total)}`
        : transferred > 0
          ? formatBytes(transferred)
          : "Waiting…",
    speed: speed === "Calculating…" && previous?.speed.endsWith("/s") ? previous.speed : speed,
  }
}

export class DesktopUpdateProgressWindow {
  private cancelDownload: (() => void) | null = null
  private progress = formatDesktopUpdateProgress({})
  private programmaticClose = false
  private version = ""
  private window: ProgressBrowserWindow | null = null

  constructor(
    private readonly options: {
      BrowserWindow: BrowserWindowConstructor
      productName: string
    },
  ) {}

  show(owner: BrowserWindow, version: string, onCancel: () => void) {
    if (this.isOpen()) {
      this.focus()
      return
    }
    this.version = version
    this.cancelDownload = onCancel
    this.progress = formatDesktopUpdateProgress({})
    this.window = new this.options.BrowserWindow({
      backgroundColor: "#f7f8f7",
      closable: true,
      fullscreenable: false,
      height: 230,
      maximizable: false,
      minimizable: false,
      modal: false,
      parent: owner,
      resizable: false,
      show: false,
      title: "Downloading update",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      width: 440,
    })
    this.window.on("close", () => {
      if (!this.programmaticClose) this.cancelDownload?.()
    })
    this.window.on("closed", () => {
      this.window = null
      this.cancelDownload = null
      this.programmaticClose = false
    })
    this.render()
    this.window.show()
  }

  update(progress: ProgressInfo) {
    this.progress = formatDesktopUpdateProgress(progress, this.progress)
    if (!this.isOpen()) return
    this.window?.setProgressBar(this.progress.progress ?? 2)
    this.render()
  }

  focus() {
    if (this.isOpen()) this.window?.focus()
  }

  close() {
    if (!this.isOpen()) {
      this.window = null
      this.cancelDownload = null
      return
    }
    this.programmaticClose = true
    this.window?.setProgressBar(-1)
    this.window?.close()
  }

  private isOpen() {
    return Boolean(this.window && !this.window.isDestroyed())
  }

  private render() {
    if (!this.isOpen()) return
    const html = renderProgressHtml({
      productName: this.options.productName,
      progress: this.progress,
      version: this.version,
    })
    void this.window?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  }
}

function renderProgressHtml(input: { productName: string; progress: FormattedDesktopUpdateProgress; version: string }) {
  const productName = escapeHtml(input.productName)
  const version = escapeHtml(input.version)
  const progress = input.progress.progress === null ? "" : ` value="${input.progress.progress}"`
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { background: Canvas; color: CanvasText; margin: 0; padding: 28px; }
      h1 { font-size: 17px; margin: 0 0 8px; }
      p { color: GrayText; font-size: 13px; line-height: 1.45; margin: 0 0 18px; }
      progress { accent-color: #22855f; height: 14px; width: 100%; }
      .row { display: flex; font-size: 12px; justify-content: space-between; margin-top: 10px; }
      .cancel { margin-top: 14px; }
    </style>
  </head>
  <body>
    <h1>Downloading ${productName} ${version}</h1>
    <p>You can keep working. Close this window to cancel; retrying can resume a verified cached download.</p>
    <progress max="1"${progress}></progress>
    <div class="row"><span>${input.progress.percent}</span><span>${input.progress.speed}</span></div>
    <div class="row"><span>${input.progress.size}</span></div>
  </body>
</html>`
}

function finitePositive(value: number | undefined) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : 0
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${Math.round(bytes)} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_024 / 1_024).toFixed(1)} MB`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
