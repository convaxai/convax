import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  assertValidPetAssetInspection,
  createElectronPetAssetInspector,
  petAssetMaxBytes,
} from "./pet-asset-inspector"

const temporaryRoots: string[] = []

async function temporaryFile(name: string, bytes: Uint8Array) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-pet-asset-"))
  temporaryRoots.push(root)
  const file = path.join(root, name)
  await fs.writeFile(file, bytes)
  return file
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function webpBytes() {
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46,
    0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ])
}

function nativeImageFixture(input: { empty?: boolean; alpha?: number; height?: number; width?: number } = {}) {
  const image = {
    getSize: mock(() => ({ height: input.height ?? 1_872, width: input.width ?? 1_536 })),
    isEmpty: mock(() => input.empty ?? false),
    toBitmap: mock(() => Buffer.from([20, 30, 40, input.alpha ?? 0])),
  }
  return {
    adapter: { createFromBuffer: mock(() => image) },
    image,
  }
}

describe("Electron pet asset inspection", () => {
  test("validates WebP magic and returns decoded dimensions and transparency", async () => {
    const file = await temporaryFile("violet.webp", webpBytes())
    const fixture = nativeImageFixture()
    const inspector = createElectronPetAssetInspector(fixture.adapter)

    await expect(inspector.inspect(file)).resolves.toEqual({
      format: "webp",
      hasTransparency: true,
      height: 1_872,
      width: 1_536,
    })
    expect(fixture.adapter.createFromBuffer).toHaveBeenCalledTimes(1)
  })

  test("rejects extension-signature mismatch, undecodable bytes, and oversized files", async () => {
    const wrongMagic = await temporaryFile("violet.webp", Buffer.from("not-a-webp"))
    await expect(createElectronPetAssetInspector(nativeImageFixture().adapter).inspect(wrongMagic)).rejects.toThrow(
      "signature",
    )

    const undecodable = await temporaryFile("empty.webp", webpBytes())
    await expect(
      createElectronPetAssetInspector(nativeImageFixture({ empty: true }).adapter).inspect(undecodable),
    ).rejects.toThrow("could not be decoded")

    const oversized = await temporaryFile("large.webp", webpBytes())
    await fs.truncate(oversized, petAssetMaxBytes + 1)
    await expect(createElectronPetAssetInspector(nativeImageFixture().adapter).inspect(oversized)).rejects.toThrow(
      "20 MiB",
    )
  })

  test("enforces the sprite v2 geometry, alpha channel, and declared format", () => {
    expect(() =>
      assertValidPetAssetInspection(
        { format: "webp", hasTransparency: true, height: 1_872, width: 1_535 },
        "webp",
      ),
    ).toThrow("1536 by 1872")
    expect(() =>
      assertValidPetAssetInspection(
        { format: "webp", hasTransparency: false, height: 1_872, width: 1_536 },
        "webp",
      ),
    ).toThrow("transparency")
    expect(() =>
      assertValidPetAssetInspection(
        { format: "png", hasTransparency: true, height: 1_872, width: 1_536 },
        "webp",
      ),
    ).toThrow("format")
  })
})
