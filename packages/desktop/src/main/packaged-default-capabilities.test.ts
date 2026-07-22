import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createPackagedDefaultCapabilityRegistry } from "./packaged-default-capabilities"
import { officialRemoteRegistryIndexUrl, type RemotePluginPackage } from "./remote-capability-registry"

interface TestZipEntry {
  content: string | Uint8Array
  name: string
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffff_ffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

function createTestZip(entries: readonly TestZipEntry[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const content = Buffer.from(entry.content)
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.byteLength, 18)
    local.writeUInt32LE(content.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    const localRecord = Buffer.concat([local, name, content])
    localParts.push(localRecord)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x0201_4b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.byteLength, 20)
    central.writeUInt32LE(content.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(Buffer.concat([central, name]))
    localOffset += localRecord.byteLength
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x0605_4b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(localOffset, 16)
  return Uint8Array.from(Buffer.concat([...localParts, centralDirectory, end]))
}

async function createSeed() {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), "convax-packaged-defaults-"))
  temporaryRoots.push(container)
  const root = path.join(container, "seed")
  const artifacts = path.join(root, "artifacts")
  await fs.mkdir(artifacts, { recursive: true })

  const pluginManifest = {
    capabilities: [],
    contributes: {
      generation: {
        tools: [
          {
            acceptedInputs: ["text", "reference_video"],
            description: "Transform media with FFmpeg",
            id: "transform-media",
            output: "video",
            title: "Transform media",
          },
        ],
      },
    },
    description: "Packaged FFmpeg integration",
    id: "ffmpeg-tools",
    name: "FFmpeg Tools",
    runtime: { args: ["serve", "--stdio"], command: "ffmpeg-tools", type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version: "1.0.0",
  }
  const pluginBytes = createTestZip([
    { content: JSON.stringify(pluginManifest), name: "manifest.json" },
    { content: "packaged plugin fixture", name: "README.txt" },
  ])
  const companionBytes = new TextEncoder().encode("packaged ffmpeg companion\n")
  const pluginUrl =
    "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/ffmpeg-tools-1.0.0.zip"
  const companionUrl =
    "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/" +
    "convax-companion-ffmpeg-tools-2.0.0-darwin-arm64"
  const pluginArtifact = { sha256: sha256(pluginBytes), size: pluginBytes.byteLength, url: pluginUrl }
  const companionArtifact = {
    sha256: sha256(companionBytes),
    size: companionBytes.byteLength,
    url: companionUrl,
  }
  const registry = {
    packages: [
      {
        artifact: pluginArtifact,
        companions: [
          {
            command: "ffmpeg-tools",
            targets: [{ arch: "arm64", artifact: companionArtifact, platform: "darwin" }],
            version: "2.0.0",
          },
        ],
        compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
        description: pluginManifest.description,
        id: pluginManifest.id,
        kind: "plugin",
        manifest: pluginManifest,
        name: pluginManifest.name,
        version: pluginManifest.version,
        yanked: false,
      },
    ],
    revision: "1".repeat(40),
    schema: "convax.registry/1",
    sequence: 7,
  }
  const registryBytes = new TextEncoder().encode(JSON.stringify(registry))
  const pluginPath = path.join(artifacts, "ffmpeg-tools-1.0.0.zip")
  const companionPath = path.join(artifacts, "ffmpeg-tools-2.0.0-darwin-arm64")
  const registryPath = path.join(root, "registry.json")
  await Promise.all([
    fs.writeFile(pluginPath, pluginBytes),
    fs.writeFile(companionPath, companionBytes),
    fs.writeFile(registryPath, registryBytes),
  ])
  const manifest = {
    arch: "arm64",
    companions: [
      {
        arch: "arm64",
        command: "ffmpeg-tools",
        platform: "darwin",
        relativePath: "artifacts/ffmpeg-tools-2.0.0-darwin-arm64",
        ...companionArtifact,
        version: "2.0.0",
      },
    ],
    platform: "darwin",
    pluginArtifact: {
      relativePath: "artifacts/ffmpeg-tools-1.0.0.zip",
      ...pluginArtifact,
      version: "1.0.0",
    },
    pluginId: "ffmpeg-tools",
    registry: {
      relativePath: "registry.json",
      revision: registry.revision,
      sequence: registry.sequence,
      sha256: sha256(registryBytes),
      size: registryBytes.byteLength,
      url: officialRemoteRegistryIndexUrl,
    },
    schema: "convax.packaged-default-capabilities/1",
  }
  const manifestPath = path.join(root, "manifest.json")
  await fs.writeFile(manifestPath, JSON.stringify(manifest))
  return {
    companionBytes,
    companionPath,
    container,
    manifest,
    manifestPath,
    pluginBytes,
    pluginManifest,
    pluginPath,
    registryBytes,
    registryPath,
    root,
  }
}

function flipOneByte(bytes: Uint8Array) {
  const result = Uint8Array.from(bytes)
  result[result.byteLength - 1] = result[result.byteLength - 1]! ^ 0xff
  return result
}

async function loadPlugin(root: string) {
  const client = await createPackagedDefaultCapabilityRegistry({
    arch: "arm64",
    platform: "darwin",
    pluginId: "ffmpeg-tools",
    root,
  })
  if (!client) throw new Error("expected a packaged Registry client")
  const loaded = await client.fetchRegistry()
  const item = loaded.registry.packages.find(
    (candidate): candidate is RemotePluginPackage => candidate.kind === "plugin" && candidate.id === "ffmpeg-tools",
  )
  if (!item) throw new Error("expected the packaged Plugin")
  return { client, item, loaded }
}

describe("createPackagedDefaultCapabilityRegistry", () => {
  test("serves the verified Registry, Plugin ZIP, and exact host companion from packaged files", async () => {
    const seed = await createSeed()
    const { client, item, loaded } = await loadPlugin(seed.root)

    expect(loaded.registry).toMatchObject({ revision: "1".repeat(40), sequence: 7 })
    expect(item.artifact.sha256).toBe(sha256(seed.pluginBytes))
    const bundle = await client.downloadBundle(item)
    expect(JSON.parse(new TextDecoder().decode(bundle.files["manifest.json"]))).toEqual(seed.pluginManifest)

    const companion = item.companions?.[0]
    const target = companion?.targets[0]
    if (!companion || !target) throw new Error("expected the packaged companion target")
    expect(target.artifact.sha256).toBe(sha256(seed.companionBytes))
    await expect(client.downloadCompanionArtifact(item, companion, target)).resolves.toEqual(seed.companionBytes)
  })

  test("returns null when the packaged seed root is absent", async () => {
    const container = await fs.mkdtemp(path.join(os.tmpdir(), "convax-packaged-defaults-missing-"))
    temporaryRoots.push(container)

    await expect(
      createPackagedDefaultCapabilityRegistry({
        arch: "arm64",
        platform: "darwin",
        pluginId: "ffmpeg-tools",
        root: path.join(container, "missing"),
      }),
    ).resolves.toBeNull()
  })

  test("rejects a seed built for a different host target", async () => {
    const seed = await createSeed()

    await expect(
      createPackagedDefaultCapabilityRegistry({
        arch: "arm64",
        platform: "linux",
        pluginId: "ffmpeg-tools",
        root: seed.root,
      }),
    ).rejects.toThrow("seed target darwin/arm64 does not match linux/arm64")
  })

  test("rejects a seed without an embedded companion", async () => {
    const seed = await createSeed()
    seed.manifest.companions = []
    await fs.writeFile(seed.manifestPath, JSON.stringify(seed.manifest))

    await expect(loadPlugin(seed.root)).rejects.toThrow("manifest.companions is invalid")
  })

  test("fails closed when Registry, Plugin, or companion bytes are changed", async () => {
    const registrySeed = await createSeed()
    await fs.writeFile(registrySeed.registryPath, flipOneByte(registrySeed.registryBytes))
    await expect(loadPlugin(registrySeed.root)).rejects.toThrow("Registry digest does not match the manifest")

    const pluginSeed = await createSeed()
    const plugin = await loadPlugin(pluginSeed.root)
    await fs.writeFile(pluginSeed.pluginPath, flipOneByte(pluginSeed.pluginBytes))
    await expect(plugin.client.downloadBundle(plugin.item)).rejects.toThrow("SHA-256 does not match the registry")

    const companionSeed = await createSeed()
    const companionPlugin = await loadPlugin(companionSeed.root)
    const companion = companionPlugin.item.companions?.[0]
    const target = companion?.targets[0]
    if (!companion || !target) throw new Error("expected the packaged companion target")
    await fs.writeFile(companionSeed.companionPath, flipOneByte(companionSeed.companionBytes))
    await expect(
      companionPlugin.client.downloadCompanionArtifact(companionPlugin.item, companion, target),
    ).rejects.toThrow("SHA-256 does not match the Registry")
  })

  test("rejects normalized-path escapes before reading an artifact", async () => {
    const seed = await createSeed()
    seed.manifest.pluginArtifact.relativePath = "../outside.zip"
    await fs.writeFile(seed.manifestPath, JSON.stringify(seed.manifest))

    await expect(loadPlugin(seed.root)).rejects.toThrow("must be a normalized relative POSIX path")
  })

  test("rejects a symlinked root and an artifact symlink that escapes the seed", async () => {
    if (process.platform === "win32") return
    const rootSeed = await createSeed()
    const linkedRoot = path.join(rootSeed.container, "linked-seed")
    await fs.symlink(rootSeed.root, linkedRoot)
    await expect(loadPlugin(linkedRoot)).rejects.toThrow("seed root must be a real directory")

    const artifactSeed = await createSeed()
    const outsideArtifact = path.join(artifactSeed.container, "outside-plugin.zip")
    await fs.writeFile(outsideArtifact, artifactSeed.pluginBytes)
    await fs.unlink(artifactSeed.pluginPath)
    await fs.symlink(outsideArtifact, artifactSeed.pluginPath)
    const plugin = await loadPlugin(artifactSeed.root)
    await expect(plugin.client.downloadBundle(plugin.item)).rejects.toThrow("escapes the seed root")
  })
})
