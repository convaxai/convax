import { describe, expect, mock, test } from "bun:test"

import { ensureMacElectronDevelopmentSignature, resolveMacElectronApplication } from "./ensure-electron-runtime"

describe("ensure Electron runtime", () => {
  test("resolves only a macOS application-bundle executable", () => {
    expect(resolveMacElectronApplication("/runtime/Electron.app/Contents/MacOS/Electron")).toBe("/runtime/Electron.app")
    expect(() => resolveMacElectronApplication("/runtime/electron")).toThrow("application bundle")
  })

  test("does nothing on non-macOS platforms", async () => {
    const run = mock(async () => ({ exitCode: 1 }))
    await expect(
      ensureMacElectronDevelopmentSignature({
        binary: "/runtime/electron",
        platform: "linux",
        run,
      }),
    ).resolves.toBe("not-required")
    expect(run).not.toHaveBeenCalled()
  })

  test("keeps an already valid development signature", async () => {
    const run = mock(async () => ({ exitCode: 0 }))
    await expect(
      ensureMacElectronDevelopmentSignature({
        binary: "/runtime/Electron.app/Contents/MacOS/Electron",
        platform: "darwin",
        run,
      }),
    ).resolves.toBe("already-valid")
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]).toEqual([
      ["/usr/bin/codesign", "--verify", "--deep", "--strict", "/runtime/Electron.app"],
      "ignore",
    ])
  })

  test("repairs and verifies an invalid development signature", async () => {
    const exits = [1, 0, 0]
    const run = mock(async () => ({ exitCode: exits.shift() ?? 1 }))
    await expect(
      ensureMacElectronDevelopmentSignature({
        binary: "/runtime/Electron.app/Contents/MacOS/Electron",
        platform: "darwin",
        run,
      }),
    ).resolves.toBe("signed")
    expect(run.mock.calls).toEqual([
      [["/usr/bin/codesign", "--verify", "--deep", "--strict", "/runtime/Electron.app"], "ignore"],
      [["/usr/bin/codesign", "--force", "--deep", "--sign", "-", "/runtime/Electron.app"], "inherit"],
      [["/usr/bin/codesign", "--verify", "--deep", "--strict", "/runtime/Electron.app"], "inherit"],
    ])
  })

  test("fails closed when signing or verification fails", async () => {
    const signingFailure = mock(async () => ({ exitCode: 1 }))
    await expect(
      ensureMacElectronDevelopmentSignature({
        binary: "/runtime/Electron.app/Contents/MacOS/Electron",
        platform: "darwin",
        run: signingFailure,
      }),
    ).rejects.toThrow("development signing failed")

    const exits = [1, 0, 1]
    const verificationFailure = mock(async () => ({ exitCode: exits.shift() ?? 1 }))
    await expect(
      ensureMacElectronDevelopmentSignature({
        binary: "/runtime/Electron.app/Contents/MacOS/Electron",
        platform: "darwin",
        run: verificationFailure,
      }),
    ).rejects.toThrow("signature verification failed")
  })
})
