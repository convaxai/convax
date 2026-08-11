import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { inflateSync } from "node:zlib"
import desktopManifest from "../../package.json"
import {
  desktopApplicationName,
  desktopDevelopmentIdentity,
  desktopProductName,
  desktopProjectWorkspaceDirectory,
  desktopRendererUrl,
  desktopRendererUrlWithDevelopmentIdentity,
  desktopUserDataDirectory,
} from "./app-branding"

describe("desktop branding", () => {
  test("keeps the Electron product name aligned with the runtime name", () => {
    expect(desktopManifest.productName).toBe(desktopProductName)
    expect(desktopApplicationName({ isPackaged: false, packagedName: "@convax/desktop" })).toBe("Convax")
    expect(desktopApplicationName({ isPackaged: true, packagedName: "Convax Beta" })).toBe("Convax Beta")
    expect(
      desktopApplicationName({
        developmentIdentity: { id: "abc123", label: "must-be-ignored" },
        isPackaged: true,
        packagedName: "Convax Beta",
      }),
    ).toBe("Convax Beta")
    expect(
      desktopApplicationName({
        developmentIdentity: { id: "abc123", label: "text-drag" },
        isPackaged: false,
      }),
    ).toBe("Convax [text-drag]")
  })

  test("admits a bounded development identity and ignores it in packaged applications", () => {
    expect(
      desktopDevelopmentIdentity({
        isPackaged: false,
        requestedId: "abc123",
        requestedLabel: "text-drag",
      }),
    ).toEqual({ id: "abc123", label: "text-drag" })
    expect(
      desktopDevelopmentIdentity({
        isPackaged: true,
        requestedId: "INVALID",
        requestedLabel: "ignored",
      }),
    ).toBeUndefined()
    expect(
      desktopDevelopmentIdentity({
        isPackaged: false,
        requestedId: "abc123",
        requestedLabel: "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀",
      }),
    ).toEqual({ id: "abc123", label: "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀" })
    expect(
      desktopDevelopmentIdentity({
        isPackaged: false,
        requestedId: "abc123",
        requestedLabel: "开发任务",
      }),
    ).toEqual({ id: "abc123", label: "开发任务" })
    expect(() =>
      desktopDevelopmentIdentity({
        isPackaged: false,
        requestedId: "abc123",
        requestedLabel: "\u00a0text-drag",
      }),
    ).toThrow("normalized")
    expect(() => desktopDevelopmentIdentity({ isPackaged: false, requestedId: "abc123" })).toThrow("label")
    expect(() =>
      desktopDevelopmentIdentity({
        isPackaged: false,
        requestedId: "ABC",
        requestedLabel: "text-drag",
      }),
    ).toThrow("id")
    expect(() =>
      desktopDevelopmentIdentity({
        isPackaged: false,
        requestedId: "abc123",
        requestedLabel: "line\nbreak",
      }),
    ).toThrow("label")
  })

  test("never trusts a dev-server URL in a packaged application", () => {
    expect(desktopRendererUrl({ isPackaged: false, requestedUrl: " http://localhost:5173 " })).toBe(
      "http://localhost:5173",
    )
    expect(desktopRendererUrl({ isPackaged: true, requestedUrl: "http://localhost:5173" })).toBeUndefined()
  })

  test("projects the development identity through a bounded renderer URL", () => {
    expect(
      desktopRendererUrlWithDevelopmentIdentity({
        developmentIdentity: { id: "abc123", label: "text drag" },
        url: "http://localhost:5173/?existing=1",
      }),
    ).toBe("http://localhost:5173/?existing=1&convax-solo-task-id=abc123&convax-solo-task-label=text+drag")
    expect(
      desktopRendererUrlWithDevelopmentIdentity({
        url: "file:///Applications/Convax/index.html",
      }),
    ).toBe("file:///Applications/Convax/index.html")
  })

  test("places newly created projects in a user-visible Documents workspace", () => {
    const documentsDirectory = join("Users", "artist", "Documents")
    expect(desktopProjectWorkspaceDirectory(documentsDirectory)).toBe(join(documentsDirectory, "Convax"))
  })

  test("ships a square 1024px RGBA application icon", async () => {
    const bytes = await Bun.file(new URL("../../resources/icon.png", import.meta.url)).arrayBuffer()
    const image = new DataView(bytes)

    expect(new Uint8Array(bytes.slice(0, 8))).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.getUint32(16)).toBe(1024)
    expect(image.getUint32(20)).toBe(1024)
    expect(image.getUint8(25)).toBe(6)
    expect(image.getUint8(28)).toBe(0)

    const idatChunks: Uint8Array[] = []
    for (let offset = 8; offset < bytes.byteLength; ) {
      const length = image.getUint32(offset)
      const type = String.fromCharCode(...new Uint8Array(bytes, offset + 4, 4))
      if (type === "IDAT") idatChunks.push(new Uint8Array(bytes, offset + 8, length))
      offset += length + 12
    }
    const pixels = inflateSync(Buffer.concat(idatChunks))
    expect(pixels[4]).toBe(0)
  })

  test("keeps an editable vector source for the application icon", async () => {
    const brandSource = await Bun.file(
      new URL("../../resources/icon.svg", import.meta.url),
    ).text()
    const darkSource = await Bun.file(
      new URL("../../resources/icon-white-on-black.svg", import.meta.url),
    ).text()
    const lightSource = await Bun.file(
      new URL("../../resources/icon-black-on-white.svg", import.meta.url),
    ).text()

    expect(darkSource).toContain('viewBox="0 0 100 100"')
    expect(brandSource).toContain('aria-label="Convax radial C logo"')
    expect(darkSource).toContain('aria-label="Convax radial C logo, white on black"')
    expect(lightSource).toContain('aria-label="Convax radial C logo, black on white"')
    expect(brandSource).toContain('<rect x="8" y="8" width="84" height="84" rx="15"')
    expect(darkSource).toContain('<rect x="8" y="8" width="84" height="84" rx="15"')
    expect(lightSource).toContain('<rect x="8" y="8" width="84" height="84" rx="15"')
    for (const source of [brandSource, darkSource, lightSource]) {
      expect(source).toContain('data-logo-part="radial-c"')
      expect(source).toContain('data-spoke-count="31"')
      expect(source).toContain('transform="translate(24 27.64) scale(.26)"')
      expect(source.match(/\n      M/g)).toHaveLength(31)
      expect(source).not.toContain('data-logo-part="player"')
      expect(source).not.toContain('data-logo-part="canvas-x"')
    }
  })

  test("keeps development data in the pre-productName profile", () => {
    const appDataDirectory = "/Library/Application Support"
    expect(
      desktopUserDataDirectory({
        appDataDirectory,
        isPackaged: false,
      }),
    ).toBe(join(appDataDirectory, "@convax", "desktop"))
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: false,
        requestedDirectory: "/tmp/convax-test",
      }),
    ).toBe("/tmp/convax-test")
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: true,
      }),
    ).toBeUndefined()
  })

  test("requires a task-bound absolute userData profile for an identified development runtime", () => {
    const developmentIdentity = { id: "abc123", label: "text-drag" }
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        developmentIdentity,
        isPackaged: false,
        requestedDirectory: "/tmp/runtime/abc123/user-data",
      }),
    ).toBe("/tmp/runtime/abc123/user-data")
    expect(() =>
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        developmentIdentity,
        isPackaged: false,
      }),
    ).toThrow("required")
    expect(() =>
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        developmentIdentity,
        isPackaged: false,
        requestedDirectory: "/tmp/runtime/shared/user-data",
      }),
    ).toThrow("task id")
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        developmentIdentity,
        isPackaged: true,
        requestedDirectory: "/tmp/runtime/abc123/user-data",
      }),
    ).toBeUndefined()
  })

  test("allows only an explicit, isolated OS-temp profile for packaged smoke", () => {
    const packagedSmokeDirectory = "/tmp/convax-packaged-smoke-123"
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: true,
        packagedSmoke: true,
        packagedSmokeDirectory,
        temporaryDirectory: "/tmp",
      }),
    ).toBe(resolve(packagedSmokeDirectory))

    expect(() =>
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: true,
        packagedSmoke: true,
        packagedSmokeDirectory: "/tmp/unrelated",
        temporaryDirectory: "/tmp",
      }),
    ).toThrow("direct Convax smoke child")
    expect(() =>
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: true,
        packagedSmoke: true,
        packagedSmokeDirectory: "/Users/artist/Library/Application Support/Convax",
        temporaryDirectory: "/tmp",
      }),
    ).toThrow("direct Convax smoke child")
  })
})
