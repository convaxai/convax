import { createHash } from "node:crypto"

import { expect, mock, test } from "bun:test"
import type { RegistryPackage } from "@convax/marketplace"

import { MarketplaceArtifactInstaller } from "./marketplace-artifact-installer"

function crc32(bytes: Uint8Array) {
  let crc = 0xffff_ffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

function zip(files: Readonly<Record<string, string>>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const [fileName, value] of Object.entries(files)) {
    const name = Buffer.from(fileName)
    const content = Buffer.from(value)
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.byteLength, 18)
    local.writeUInt32LE(content.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    const record = Buffer.concat([local, name, content])
    localParts.push(record)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x0201_4b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.byteLength, 20)
    central.writeUInt32LE(content.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(Buffer.concat([central, name]))
    offset += record.byteLength
  }
  const directory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x0605_4b50, 0)
  end.writeUInt16LE(localParts.length, 8)
  end.writeUInt16LE(localParts.length, 10)
  end.writeUInt32LE(directory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  return Uint8Array.from(Buffer.concat([...localParts, directory, end]))
}

test("publishes only an exact source-qualified Marketplace v2 Plugin artifact", async () => {
  const manifest = {
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Marketplace artifact fixture",
    entry: "index.html",
    hostApi: { major: 3, optional: [], required: ["host.context.get"] },
    id: "fixture",
    name: "Fixture",
    schema: "convax.plugin/8",
    version: "1.0.0",
  }
  const bytes = zip({
    "index.html": "<!doctype html><title>Fixture</title>",
    "manifest.json": JSON.stringify(manifest),
  })
  const digest = createHash("sha256").update(bytes).digest("hex")
  const install = mock(async (_input: unknown, _options: unknown) => ({ id: "fixture", version: "1.0.0" }))
  const installer = new MarketplaceArtifactInstaller({
    deferExecutionAuthorization: true,
    skillManager: { installFromFiles: mock(async () => ({ name: "unused" })) } as never,
    snapshotInstaller: { install } as never,
  })
  const item = {
    compatibility: { convax: ">=0.1.0" },
    delivery: {
      kind: "artifact",
      sha256: digest,
      size: bytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-fixture-v1.0.0/fixture.zip",
    },
    id: "fixture",
    kind: "plugin",
    manifest,
    presentation: { name: "Fixture" },
    version: "1.0.0",
    yanked: false,
  } as RegistryPackage

  await installer.installVerifiedMarketplaceCandidate({
    artifactBytes: bytes,
    item,
    sourceIdentity: "network:official",
  })

  expect(install).toHaveBeenCalledTimes(1)
  expect(install.mock.calls[0]?.[0]).toMatchObject({
    artifact: { sha256: digest, size: bytes.byteLength },
    authorizeExecution: false,
    sourceIdentity: "network:official",
  })
  await expect(
    installer.installVerifiedMarketplaceCandidate({
      artifactBytes: bytes,
      item: { ...item, delivery: { ...item.delivery, sha256: "0".repeat(64) } } as RegistryPackage,
      sourceIdentity: "network:official",
    }),
  ).rejects.toThrow("artifact identity")
})
