import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { DesktopUpdateProgressWindow, formatDesktopUpdateProgress } from "./desktop-update-progress-window"

class FakeProgressWindow extends EventEmitter {
  static instances: FakeProgressWindow[] = []
  close = mock(() => {
    this.emit("close")
    this.destroyed = true
    this.emit("closed")
  })
  destroyed = false
  focus = mock(() => undefined)
  isDestroyed = () => this.destroyed
  loadURL = mock(async (_url: string) => undefined)
  setProgressBar = mock((_value: number) => undefined)
  show = mock(() => undefined)

  constructor(readonly options: Record<string, unknown>) {
    super()
    FakeProgressWindow.instances.push(this)
  }
}

describe("Desktop update progress window", () => {
  test("formats bounded download progress without losing the last measured speed", () => {
    const measured = formatDesktopUpdateProgress({
      bytesPerSecond: 2_097_152,
      percent: 12.34,
      total: 20_971_520,
      transferred: 2_097_152,
    })
    expect(measured).toEqual({ percent: "12.3%", progress: 0.1234, size: "2.0 MB / 20.0 MB", speed: "2.0 MB/s" })
    expect(formatDesktopUpdateProgress({ percent: 120, transferred: 3_145_728 }, measured)).toEqual({
      percent: "100.0%",
      progress: 1,
      size: "3.0 MB",
      speed: "2.0 MB/s",
    })
  })

  test("uses a sandboxed data document and cancels only on a user close", () => {
    FakeProgressWindow.instances = []
    const cancel = mock(() => undefined)
    const progress = new DesktopUpdateProgressWindow({
      BrowserWindow: FakeProgressWindow as never,
      productName: "Convax <stable>",
    })
    progress.show({} as never, "1.2.3", cancel)
    const first = FakeProgressWindow.instances[0]!
    expect(first.options).toMatchObject({
      closable: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    expect(decodeURIComponent(String(first.loadURL.mock.calls[0]?.[0]))).toContain("Convax &lt;stable&gt;")
    first.close()
    expect(cancel).toHaveBeenCalledTimes(1)

    progress.show({} as never, "1.2.3", cancel)
    progress.close()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
