import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import desktopManifest from "../../package.json"
import {
  desktopApplicationName,
  desktopProductName,
  desktopProjectWorkspaceDirectory,
  desktopRendererUrl,
  desktopUserDataDirectory,
} from "./app-branding"

describe("desktop branding", () => {
  test("keeps the Electron product name aligned with the runtime name", () => {
    expect(desktopManifest.productName).toBe(desktopProductName)
    expect(desktopApplicationName({ isPackaged: false, packagedName: "@convax/desktop" })).toBe("Convax")
    expect(desktopApplicationName({ isPackaged: true, packagedName: "Convax Beta" })).toBe("Convax Beta")
  })

  test("never trusts a dev-server URL in a packaged application", () => {
    expect(desktopRendererUrl({ isPackaged: false, requestedUrl: " http://localhost:5173 " })).toBe(
      "http://localhost:5173",
    )
    expect(desktopRendererUrl({ isPackaged: true, requestedUrl: "http://localhost:5173" })).toBeUndefined()
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
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: false,
      }),
    ).toBe("/Library/Application Support/@convax/desktop")
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

  test("allows only an explicit, isolated OS-temp profile for packaged smoke", () => {
    expect(
      desktopUserDataDirectory({
        appDataDirectory: "/Library/Application Support",
        isPackaged: true,
        packagedSmoke: true,
        packagedSmokeDirectory: "/tmp/convax-packaged-smoke-123",
        temporaryDirectory: "/tmp",
      }),
    ).toBe("/tmp/convax-packaged-smoke-123")

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
