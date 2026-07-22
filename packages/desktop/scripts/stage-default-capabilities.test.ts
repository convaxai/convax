import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { WebPluginManifest } from "../src/plugin-contracts"
import { type RemoteCapabilityFetch, officialRemoteRegistryIndexUrl } from "../src/main/remote-capability-registry"
import {
  type PackagedDefaultCapabilitiesManifest,
  packagedDefaultCapabilitiesSchema,
  stageDefaultCapabilities,
} from "./stage-default-capabilities"

interface TestTarget {
  arch: "arm64" | "x64"
  bytes: Uint8Array
  platform: "darwin" | "linux" | "win32"
}

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function isPackagedManifest(value: unknown): value is PackagedDefaultCapabilitiesManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    value.schema === packagedDefaultCapabilitiesSchema
  )
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffff_ffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

function createStoredZip(entries: ReadonlyArray<{ content: string; name: string }>) {
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

function pluginManifest(overrides: Partial<WebPluginManifest> = {}): WebPluginManifest {
  return {
    capabilities: [],
    contributes: {
      canvas: { renderer: { create: true } },
      generation: {
        tools: [
          {
            acceptedInputs: ["text"],
            description: "Run a deterministic media operation",
            id: "transcode",
            output: "video",
            title: "Transcode",
          },
        ],
      },
    },
    description: "FFmpeg companion test Plugin",
    entry: "web/index.html",
    id: "ffmpeg-tools",
    name: "FFmpeg Tools",
    runtime: { args: ["serve"], command: "convax-ffmpeg-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version: "0.3.1",
    ...overrides,
  }
}

function fixture(options: { archiveManifest?: WebPluginManifest; targets: TestTarget[] }) {
  const manifest = pluginManifest()
  const pluginBytes = createStoredZip([
    { content: JSON.stringify(options.archiveManifest ?? manifest), name: "manifest.json" },
    { content: "<!doctype html><title>FFmpeg</title>", name: "web/index.html" },
  ])
  const pluginUrl =
    "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v0.3.1/ffmpeg-tools-0.3.1.zip"
  const companionTargets = options.targets.map((target) => {
    const extension = target.platform === "win32" ? ".exe" : ""
    const url =
      "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v0.3.1/" +
      `convax-companion-convax-ffmpeg-mcp-0.2.0-${target.platform}-${target.arch}${extension}`
    return {
      arch: target.arch,
      artifact: { sha256: digest(target.bytes), size: target.bytes.byteLength, url },
      platform: target.platform,
    }
  })
  const registry = {
    packages: [
      {
        artifact: { sha256: digest(pluginBytes), size: pluginBytes.byteLength, url: pluginUrl },
        companions: [{ command: "convax-ffmpeg-mcp", targets: companionTargets, version: "0.2.0" }],
        compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
        description: manifest.description,
        id: manifest.id,
        kind: "plugin",
        manifest,
        name: manifest.name,
        version: manifest.version,
        yanked: false,
      },
    ],
    revision: "1".repeat(40),
    schema: "convax.registry/1",
    sequence: 7,
  }
  const registryBytes = new TextEncoder().encode(`${JSON.stringify(registry, null, 2)}\n`)
  const routes = new Map<string, Uint8Array>([
    [officialRemoteRegistryIndexUrl, registryBytes],
    [pluginUrl, pluginBytes],
    ...companionTargets.map((target, index) => [target.artifact.url, options.targets[index].bytes] as const),
  ])
  const calls: string[] = []
  const fetch: RemoteCapabilityFetch = async (url) => {
    calls.push(url)
    const bytes = routes.get(url)
    if (!bytes) return new Response(null, { status: 404 })
    return new Response(bytes, {
      headers: {
        "content-length": String(bytes.byteLength),
        ...(url === officialRemoteRegistryIndexUrl ? { "content-type": "application/json" } : {}),
      },
      status: 200,
    })
  }
  return { calls, companionTargets, fetch, pluginBytes, pluginUrl, registryBytes }
}

async function temporaryOutput() {
  const root = await mkdtemp(join(tmpdir(), "convax-default-capabilities-"))
  temporaryRoots.push(root)
  return { output: join(root, "default-capabilities"), root }
}

describe("stageDefaultCapabilities", () => {
  test("stages verified Registry, Plugin ZIP, and exact host companion bytes", async () => {
    const darwinBytes = new TextEncoder().encode("darwin-arm64-companion")
    const linuxBytes = new TextEncoder().encode("linux-x64-companion")
    const source = fixture({
      targets: [
        { arch: "arm64", bytes: darwinBytes, platform: "darwin" },
        { arch: "x64", bytes: linuxBytes, platform: "linux" },
      ],
    })
    const { output } = await temporaryOutput()

    await expect(
      stageDefaultCapabilities({ arch: "arm64", fetch: source.fetch, outputDirectory: output, platform: "darwin" }),
    ).resolves.toBe(output)

    const manifestDocument: unknown = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"))
    expect(isPackagedManifest(manifestDocument)).toBe(true)
    if (!isPackagedManifest(manifestDocument)) throw new Error("Expected a packaged default capabilities manifest")
    const manifest = manifestDocument
    expect(manifest).toEqual({
      arch: "arm64",
      companions: [
        {
          arch: "arm64",
          command: "convax-ffmpeg-mcp",
          platform: "darwin",
          relativePath: "artifacts/convax-ffmpeg-mcp-0.2.0-darwin-arm64",
          sha256: digest(darwinBytes),
          size: darwinBytes.byteLength,
          url: source.companionTargets[0].artifact.url,
          version: "0.2.0",
        },
      ],
      platform: "darwin",
      pluginArtifact: {
        relativePath: "artifacts/ffmpeg-tools-0.3.1.zip",
        sha256: digest(source.pluginBytes),
        size: source.pluginBytes.byteLength,
        url: source.pluginUrl,
        version: "0.3.1",
      },
      pluginId: "ffmpeg-tools",
      registry: {
        relativePath: "registry.json",
        revision: "1".repeat(40),
        sequence: 7,
        sha256: digest(source.registryBytes),
        size: source.registryBytes.byteLength,
        url: officialRemoteRegistryIndexUrl,
      },
      schema: packagedDefaultCapabilitiesSchema,
    })
    expect(await readFile(join(output, "registry.json"))).toEqual(Buffer.from(source.registryBytes))
    expect(await readFile(join(output, manifest.pluginArtifact.relativePath))).toEqual(Buffer.from(source.pluginBytes))
    expect(await readFile(join(output, manifest.companions[0].relativePath))).toEqual(Buffer.from(darwinBytes))
    expect((await stat(join(output, manifest.companions[0].relativePath))).mode & 0o111).not.toBe(0)
    expect(new Set(source.calls)).toEqual(
      new Set([officialRemoteRegistryIndexUrl, source.pluginUrl, source.companionTargets[0].artifact.url]),
    )
  })

  test("fails closed for a missing host target without replacing a prior seed", async () => {
    const source = fixture({
      targets: [{ arch: "x64", bytes: new TextEncoder().encode("linux"), platform: "linux" }],
    })
    const { output, root } = await temporaryOutput()
    await mkdir(output, { recursive: true })
    await writeFile(join(output, "manifest.json"), "prior-seed", "utf8")

    await expect(
      stageDefaultCapabilities({ arch: "arm64", fetch: source.fetch, outputDirectory: output, platform: "darwin" }),
    ).rejects.toThrow("no convax-ffmpeg-mcp companion for darwin/arm64")

    expect(await readFile(join(output, "manifest.json"), "utf8")).toBe("prior-seed")
    expect((await readdir(root)).filter((name) => name.includes("-staging-"))).toEqual([])
    expect(source.calls).toEqual([officialRemoteRegistryIndexUrl])
  })

  test("rejects a ZIP whose manifest differs from the Registry before publication", async () => {
    const source = fixture({
      archiveManifest: pluginManifest({ name: "Tampered FFmpeg Tools" }),
      targets: [{ arch: "arm64", bytes: new TextEncoder().encode("darwin"), platform: "darwin" }],
    })
    const { output } = await temporaryOutput()
    await mkdir(output, { recursive: true })
    await writeFile(join(output, "manifest.json"), "prior-seed", "utf8")

    await expect(
      stageDefaultCapabilities({ arch: "arm64", fetch: source.fetch, outputDirectory: output, platform: "darwin" }),
    ).rejects.toThrow("manifest does not match the registry")
    expect(await readFile(join(output, "manifest.json"), "utf8")).toBe("prior-seed")
  })
})
