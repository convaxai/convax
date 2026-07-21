import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import desktopManifest from "../../package.json"
import { desktopProductName, desktopProjectWorkspaceDirectory, desktopUserDataDirectory } from "./app-branding"

describe("desktop branding", () => {
  test("keeps the Electron product name aligned with the runtime name", () => {
    expect(desktopManifest.productName).toBe(desktopProductName)
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
    for (let offset = 8; offset < bytes.byteLength;) {
      const length = image.getUint32(offset)
      const type = String.fromCharCode(...new Uint8Array(bytes, offset + 4, 4))
      if (type === "IDAT") idatChunks.push(new Uint8Array(bytes, offset + 8, length))
      offset += length + 12
    }
    const pixels = inflateSync(Buffer.concat(idatChunks))
    expect(pixels[4]).toBe(0)
  })

  test("keeps an editable vector source for the application icon", async () => {
    const source = await Bun.file(new URL("../../resources/icon.svg", import.meta.url)).text()

    expect(source).toContain('viewBox="0 0 100 100"')
    expect(source).toContain('<rect x="9" y="9" width="82" height="82" rx="18" fill="#fff"/>')
    expect(source).not.toContain("stroke=")
  })

  test("keeps development data in the pre-productName profile", () => {
    expect(desktopUserDataDirectory({
      appDataDirectory: "/Library/Application Support",
      isPackaged: false,
    })).toBe("/Library/Application Support/@convax/desktop")
    expect(desktopUserDataDirectory({
      appDataDirectory: "/Library/Application Support",
      isPackaged: false,
      requestedDirectory: "/tmp/convax-test",
    })).toBe("/tmp/convax-test")
    expect(desktopUserDataDirectory({
      appDataDirectory: "/Library/Application Support",
      isPackaged: true,
    })).toBeUndefined()
  })
})
