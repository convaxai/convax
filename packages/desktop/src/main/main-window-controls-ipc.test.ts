import { afterEach, describe, expect, mock, test } from "bun:test"

type InvokeHandler = (event: { sender: { id: number } }, value: unknown) => unknown

const handlers = new Map<string, InvokeHandler>()

void mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

afterEach(() => handlers.clear())

describe("main window controls IPC", () => {
  test("executes only bounded actions from the main window renderer", async () => {
    const { mainWindowControlsIpcChannel } = await import("../main-window-controls-contracts")
    const { registerMainWindowControlsIpc } = await import("./main-window-controls-ipc")
    const sender = { id: 1 }
    const close = mock(() => undefined)
    const minimize = mock(() => undefined)
    const setFullScreen = mock((_value: boolean) => undefined)
    const setWindowButtonVisibility = mock((_value: boolean) => undefined)
    let fullScreen = false
    const target = {
      webContents: sender,
      close,
      isDestroyed: () => false,
      isFullScreen: () => fullScreen,
      minimize,
      setFullScreen,
      setWindowButtonVisibility,
    }
    const dispose = registerMainWindowControlsIpc(() => target, (event) => event.sender.id === 1, "darwin")
    const handler = handlers.get(mainWindowControlsIpcChannel)
    if (!handler) throw new Error("Main window controls handler is missing")

    expect(setWindowButtonVisibility).not.toHaveBeenCalled()
    expect(handler({ sender }, { action: "set-custom-controls-visible", visible: true })).toBeUndefined()
    expect(handler({ sender }, { action: "minimize" })).toBeUndefined()
    expect(handler({ sender }, { action: "toggle-full-screen" })).toBeUndefined()
    fullScreen = true
    expect(handler({ sender }, { action: "toggle-full-screen" })).toBeUndefined()
    expect(handler({ sender }, { action: "close" })).toBeUndefined()
    expect(handler({ sender }, { action: "set-custom-controls-visible", visible: false })).toBeUndefined()
    expect(setWindowButtonVisibility).toHaveBeenNthCalledWith(1, false)
    expect(setWindowButtonVisibility).toHaveBeenNthCalledWith(2, true)
    expect(minimize).toHaveBeenCalledTimes(1)
    expect(setFullScreen).toHaveBeenNthCalledWith(1, true)
    expect(setFullScreen).toHaveBeenNthCalledWith(2, false)
    expect(close).toHaveBeenCalledTimes(1)

    expect(() => handler({ sender }, { action: "maximize" })).toThrow("request is invalid")
    expect(() => handler({ sender }, { action: "close", visible: true })).toThrow("request is invalid")
    expect(() => handler({ sender: { id: 2 } }, { action: "close" })).toThrow("untrusted renderer")

    dispose()
    expect(handlers.has(mainWindowControlsIpcChannel)).toBeFalse()
  })

  test("rejects trusted requests from a renderer other than the active main window", async () => {
    const { mainWindowControlsIpcChannel } = await import("../main-window-controls-contracts")
    const { registerMainWindowControlsIpc } = await import("./main-window-controls-ipc")
    const mainSender = { id: 1 }
    const otherSender = { id: 2 }
    const target = {
      webContents: mainSender,
      close: mock(() => undefined),
      isDestroyed: () => false,
      isFullScreen: () => false,
      minimize: mock(() => undefined),
      setFullScreen: mock((_value: boolean) => undefined),
      setWindowButtonVisibility: mock((_value: boolean) => undefined),
    }
    registerMainWindowControlsIpc(() => target, () => true, "darwin")
    const handler = handlers.get(mainWindowControlsIpcChannel)
    if (!handler) throw new Error("Main window controls handler is missing")

    expect(() => handler({ sender: otherSender }, { action: "close" })).toThrow(
      "not bound to the active main window",
    )
    expect(target.close).not.toHaveBeenCalled()
  })

  test("does not allow a renderer to hide native controls off macOS", async () => {
    const { mainWindowControlsIpcChannel } = await import("../main-window-controls-contracts")
    const { registerMainWindowControlsIpc } = await import("./main-window-controls-ipc")
    const sender = { id: 1 }
    const setWindowButtonVisibility = mock((_value: boolean) => undefined)
    const target = {
      webContents: sender,
      close: mock(() => undefined),
      isDestroyed: () => false,
      isFullScreen: () => false,
      minimize: mock(() => undefined),
      setFullScreen: mock((_value: boolean) => undefined),
      setWindowButtonVisibility,
    }
    registerMainWindowControlsIpc(() => target, () => true, "linux")
    const handler = handlers.get(mainWindowControlsIpcChannel)
    if (!handler) throw new Error("Main window controls handler is missing")

    expect(() => handler({ sender }, { action: "set-custom-controls-visible", visible: true })).toThrow(
      "only on macOS",
    )
    expect(setWindowButtonVisibility).not.toHaveBeenCalled()
  })
})
