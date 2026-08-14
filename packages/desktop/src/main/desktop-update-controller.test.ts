import { CancellationError, type CancellationToken, type ProgressInfo, type UpdateInfo } from "builder-util-runtime"
import { describe, expect, mock, test } from "bun:test"
import type { BrowserWindow, MessageBoxOptions } from "electron"
import { createDesktopUpdateController, updateDetails } from "./desktop-update-controller"

function updateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    files: [],
    path: "",
    releaseDate: "2026-08-13T00:00:00.000Z",
    sha512: "fixture",
    version: "1.2.3",
    ...overrides,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function harness(
  input: {
    dialogResponses?: number[]
    download?: (token?: CancellationToken) => Promise<string[]>
    install?: () => void
    packaged?: boolean
    platform?: NodeJS.Platform
    prepareInstall?: () => Promise<void>
    result?: null | { isUpdateAvailable: boolean; updateInfo: UpdateInfo }
  } = {},
) {
  const dialogOptions: MessageBoxOptions[] = []
  const responses = [...(input.dialogResponses ?? [])]
  const listeners = new Map<string, Set<(...args: never[]) => void>>()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: mock(async () => input.result ?? { isUpdateAvailable: false, updateInfo: updateInfo() }),
    disableWebInstaller: false,
    downloadUpdate: mock(input.download ?? (async () => ["update"])),
    off: mock((event: string, listener: (...args: never[]) => void) => listeners.get(event)?.delete(listener)),
    on: mock((event: string, listener: (...args: never[]) => void) => {
      const current = listeners.get(event) ?? new Set()
      current.add(listener)
      listeners.set(event, current)
      return updater
    }),
    quitAndInstall: mock(input.install ?? (() => undefined)),
  }
  let cancel: (() => void) | undefined
  const progressWindow = {
    close: mock(() => undefined),
    focus: mock(() => undefined),
    show: mock((_owner: BrowserWindow, _version: string, onCancel: () => void) => {
      cancel = onCancel
    }),
    update: mock((_progress: ProgressInfo) => undefined),
  }
  const recover = mock(() => undefined)
  const controller = createDesktopUpdateController({
    application: { getVersion: () => "1.2.2", isPackaged: input.packaged ?? true },
    dialog: {
      showMessageBox: mock(async (_window: BrowserWindow, options: MessageBoxOptions) => {
        dialogOptions.push(options)
        return { checkboxChecked: false, response: responses.shift() ?? 0 }
      }),
    },
    platform: input.platform ?? "darwin",
    prepareInstall: input.prepareInstall ?? (async () => undefined),
    productName: "Convax",
    progressWindow,
    recoverCurrentVersionAfterInstallFailure: recover,
    updater: updater as never,
  })
  return {
    cancel: () => cancel?.(),
    controller,
    dialogOptions,
    listeners,
    progressWindow,
    recover,
    updater,
  }
}

describe("Desktop update controller", () => {
  test("configures manual verified downloads and reports the no-update state", async () => {
    const setup = harness({ dialogResponses: [0] })

    await setup.controller.checkManually({} as BrowserWindow)

    expect(setup.updater.autoDownload).toBeFalse()
    expect(setup.updater.autoInstallOnAppQuit).toBeFalse()
    expect(setup.updater.disableWebInstaller).toBeTrue()
    expect(setup.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(setup.dialogOptions.at(-1)?.title).toBe("No updates available")
  })

  test("keeps automatic no-update and failure checks silent", async () => {
    const setup = harness()
    await setup.controller.checkAutomatically({} as BrowserWindow)
    expect(setup.dialogOptions).toEqual([])

    setup.updater.checkForUpdates.mockImplementationOnce(async () => {
      throw new Error("offline")
    })
    await setup.controller.checkAutomatically({} as BrowserWindow)
    expect(setup.dialogOptions).toEqual([])
  })

  test("cancels, retries, and reuses the verified updater download path", async () => {
    let attempt = 0
    const setup = harness({
      dialogResponses: [0, 0, 1],
      download: async (token) => {
        attempt += 1
        if (attempt === 1) {
          setup.cancel()
          expect(token?.cancelled).toBeTrue()
          throw new CancellationError()
        }
        return ["verified-update"]
      },
      result: { isUpdateAvailable: true, updateInfo: updateInfo() },
    })

    await setup.controller.checkManually({} as BrowserWindow)

    expect(setup.updater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(setup.progressWindow.show).toHaveBeenCalledTimes(2)
    expect(setup.dialogOptions.map((options) => options.title)).toEqual([
      "Update available",
      "Download cancelled",
      "Update ready",
    ])
    expect(setup.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  test("reports verification failure without changing the installed version", async () => {
    const setup = harness({
      dialogResponses: [0, 1],
      download: async () => {
        throw new Error("sha512 checksum mismatch")
      },
      result: { isUpdateAvailable: true, updateInfo: updateInfo() },
    })

    await setup.controller.checkManually({} as BrowserWindow)

    expect(setup.dialogOptions.at(-1)?.title).toBe("Update download failed")
    expect(setup.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(setup.recover).not.toHaveBeenCalled()
  })

  test("waits for save and accepted-task shutdown preparation before installation", async () => {
    const preparation = deferred()
    const setup = harness({
      dialogResponses: [0, 0],
      prepareInstall: () => preparation.promise,
      result: { isUpdateAvailable: true, updateInfo: updateInfo() },
    })

    const checking = setup.controller.checkManually({} as BrowserWindow)
    await Promise.resolve()
    await Promise.resolve()
    expect(setup.updater.quitAndInstall).not.toHaveBeenCalled()

    preparation.resolve()
    await checking
    expect(setup.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  test("restarts the current version when install preparation fails", async () => {
    const setup = harness({
      dialogResponses: [0, 0, 0],
      prepareInstall: async () => {
        throw new Error("save failed")
      },
      result: { isUpdateAvailable: true, updateInfo: updateInfo() },
    })

    await setup.controller.checkManually({} as BrowserWindow)

    expect(setup.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(setup.dialogOptions.at(-1)?.title).toBe("Update installation failed")
    expect(setup.recover).toHaveBeenCalledTimes(1)
  })

  test("restarts the current version when the platform installer cannot start", async () => {
    const setup = harness({
      dialogResponses: [0, 0, 0],
      install: () => {
        throw new Error("installer launch failed")
      },
      result: { isUpdateAvailable: true, updateInfo: updateInfo() },
    })

    await setup.controller.checkManually({} as BrowserWindow)

    expect(setup.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(setup.dialogOptions.at(-1)?.title).toBe("Update installation failed")
    expect(setup.recover).toHaveBeenCalledTimes(1)
  })

  test("fails closed outside signed macOS and Windows release builds", async () => {
    const setup = harness({ packaged: false })
    await setup.controller.checkManually({} as BrowserWindow)
    expect(setup.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(setup.dialogOptions.at(-1)?.title).toBe("Updates unavailable")

    const linux = harness({ platform: "linux" })
    await linux.controller.checkManually({} as BrowserWindow)
    expect(linux.updater.checkForUpdates).not.toHaveBeenCalled()
  })

  test("disposes listeners and an active download without changing installed bytes", async () => {
    const pending = deferred()
    const setup = harness({
      dialogResponses: [0],
      download: async () => {
        await pending.promise
        return []
      },
      result: { isUpdateAvailable: true, updateInfo: updateInfo() },
    })
    const checking = setup.controller.checkManually({} as BrowserWindow)
    await Promise.resolve()
    await Promise.resolve()
    setup.controller.dispose()
    pending.resolve()
    await checking
    expect(setup.progressWindow.close).toHaveBeenCalled()
    expect(setup.updater.off).toHaveBeenCalledTimes(2)
    expect(setup.dialogOptions.map((options) => options.title)).toEqual(["Update available"])
  })
})

test("bounds release notes and exposes the minimum operating-system compatibility hint", () => {
  expect(
    updateDetails(
      updateInfo({
        minimumSystemVersion: "23.1.0",
        releaseNotes: [
          { note: "New updater", version: "1.2.3" },
          { note: null, version: "1.2.2" },
        ],
      }),
    ),
  ).toBe("Requires operating system kernel 23.1.0 or newer.\nWhat’s new:\n1.2.3: New updater")
  expect(updateDetails(updateInfo({ releaseNotes: "x".repeat(20_000) }))).toHaveLength(8_192)
})
