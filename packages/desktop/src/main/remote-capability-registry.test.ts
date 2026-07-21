import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"

import type { WebPluginManifest } from "../plugin-contracts"
import { FileRemoteRegistryCache } from "./file-remote-registry-cache"
import {
  type RemoteCapabilityPackage,
  type RemoteCapabilityFetch,
  type RemoteRegistryCache,
  type RemoteShowcaseMediaCache,
  MemoryRemoteRegistryCache,
  RemoteCapabilityRegistryClient,
  RemoteRegistryCacheCorruptionError,
  RemoteRegistryTimeoutError,
  RemoteRegistryValidationError,
  parseRemoteCapabilityShowcase,
  parseRemoteCapabilityRegistry,
} from "./remote-capability-registry"
import { unpackSafeZip } from "./safe-zip"

interface TestZipEntry {
  content?: string | Uint8Array
  crcOverride?: number
  externalAttributes?: number
  method?: 0 | 8
  name: string
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

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
    const content = Buffer.from(entry.content ?? "")
    const method = entry.method ?? 0
    const compressed = method === 8 ? deflateRawSync(content) : content
    const checksum = entry.crcOverride ?? crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(content.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    const localRecord = Buffer.concat([local, name, compressed])
    localParts.push(localRecord)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x0201_4b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(content.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    const defaultAttributes = entry.name.endsWith("/") ? ((0o040755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0
    central.writeUInt32LE(entry.externalAttributes ?? defaultAttributes, 38)
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
    contributes: { canvas: { renderer: { create: true } } },
    description: "A safe remote test surface",
    entry: "web/index.html",
    id: "hello-convax",
    name: "Hello Convax",
    schema: "convax.plugin/1",
    version: "1.0.0",
    ...overrides,
  }
}

function generationPluginManifest(): WebPluginManifest {
  return pluginManifest({
    contributes: {
      canvas: { renderer: { create: true } },
      generation: {
        tools: [
          {
            acceptedInputs: ["text", "reference_image"],
            description: "Generate an image from a prompt and optional reference",
            id: "generate-image",
            output: "image",
            title: "Generate image",
          },
        ],
      },
    },
    runtime: { args: ["serve", "--stdio"], command: "example-image-tool", type: "mcp-stdio" },
    schema: "convax.plugin/2",
  })
}

function declarativePluginManifest(): WebPluginManifest {
  const legacy = generationPluginManifest()
  return {
    ...legacy,
    contributes: {
      ...legacy.contributes,
      generation: {
        models: [{ name: "Example Image 1", tool: "generate-image" }],
        tools: legacy.contributes.generation!.tools,
      },
    },
    schema: "convax.plugin/3",
  }
}

function companion(overrides: Record<string, unknown> = {}) {
  return {
    command: "example-image-tool",
    targets: [
      {
        arch: "arm64",
        artifact: {
          sha256: "b".repeat(64),
          size: 61 * 1024 * 1024,
          url:
            "https://github.com/microvoid/convax-plugins/releases/download/plugin-hello-convax-v1.0.0/" +
            "convax-companion-example-image-tool-2.0.0-darwin-arm64",
        },
        platform: "darwin",
      },
    ],
    version: "2.0.0",
    ...overrides,
  }
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    sha256: "a".repeat(64),
    size: 123,
    url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-hello-convax-v1.0.0/hello-convax-1.0.0.zip",
    ...overrides,
  }
}

function pluginPackage(overrides: Record<string, unknown> = {}) {
  const manifest = (overrides.manifest as WebPluginManifest | undefined) ?? pluginManifest()
  return {
    artifact: artifact(),
    compatibility: { pluginHost: "convax.plugin-host/1", pluginSchema: "convax.plugin/1" },
    description: manifest.description,
    id: manifest.id,
    kind: "plugin",
    manifest,
    name: manifest.name,
    version: manifest.version,
    yanked: false,
    ...overrides,
  }
}

function skillPackage(overrides: Record<string, unknown> = {}) {
  return {
    artifact: artifact({
      url: "https://github.com/microvoid/convax-plugins/releases/download/skill-hello-agent-v1.0.0/hello-agent-1.0.0.zip",
    }),
    compatibility: { skillSchema: "opencode.skill/1" },
    description: "A workflow for saying hello",
    id: "hello-agent",
    kind: "skill",
    name: "Hello Agent",
    version: "1.0.0",
    yanked: false,
    ...overrides,
  }
}

function registry(packages: unknown[] = [pluginPackage(), skillPackage()], overrides: Record<string, unknown> = {}) {
  return {
    packages,
    revision: "1".repeat(40),
    schema: "convax.registry/1",
    sequence: 1,
    ...overrides,
  }
}

function showcaseMedia(type: "animation" | "poster", overrides: Record<string, unknown> = {}) {
  const animation = type === "animation"
  return {
    alt: animation ? "A short animated Skill workflow" : "Skill workflow poster",
    height: 720,
    mime: animation ? "image/gif" : "image/png",
    sha256: "c".repeat(64),
    size: 128,
    url: `https://github.com/microvoid/convax-plugins/releases/download/skill-hello-agent-v1.0.0/hello-agent-showcase.${animation ? "gif" : "png"}`,
    width: 1280,
    ...overrides,
  }
}

function showcase(overrides: Record<string, unknown> = {}) {
  return {
    packages: [
      {
        animation: showcaseMedia("animation"),
        id: "hello-agent",
        kind: "skill",
        poster: showcaseMedia("poster"),
        version: "1.0.0",
      },
    ],
    revision: "1".repeat(40),
    schema: "convax.showcase/1",
    sequence: 1,
    ...overrides,
  }
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })
}

function fetchMock(
  implementation: (input: string, init?: RequestInit) => Promise<Response> | Response,
): RemoteCapabilityFetch {
  return async (input, init) => implementation(input, init)
}

function memoryShowcaseMediaCache() {
  const entries = new Map<string, Uint8Array>()
  const cache: RemoteShowcaseMediaCache = {
    async read({ sha256, size }) {
      const bytes = entries.get(sha256)
      return bytes?.byteLength === size ? Uint8Array.from(bytes) : null
    },
    async write({ bytes, sha256 }) {
      entries.set(sha256, Uint8Array.from(bytes))
    },
  }
  return { cache, entries }
}

function packageWithZip(zip: Uint8Array, overrides: Record<string, unknown> = {}) {
  return parseRemoteCapabilityRegistry(
    registry([
      pluginPackage({
        artifact: artifact({
          sha256: createHash("sha256").update(zip).digest("hex"),
          size: zip.byteLength,
        }),
        ...overrides,
      }),
    ]),
  ).packages[0]!
}

describe("parseRemoteCapabilityRegistry", () => {
  test("strictly parses compatible Plugin and Skill entries", () => {
    const parsed = parseRemoteCapabilityRegistry(registry())
    expect(parsed.schema).toBe("convax.registry/1")
    expect(parsed.packages.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "plugin:hello-convax",
      "skill:hello-agent",
    ])
    expect(parsed.packages[0]?.kind === "plugin" && parsed.packages[0].manifest.entry).toBe("web/index.html")
  })

  test("accepts strict Plugin host/schema compatibility pairs through declarative v3", () => {
    const generationManifest = generationPluginManifest()
    const parsed = parseRemoteCapabilityRegistry(
      registry([
        pluginPackage({
          compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
          manifest: generationManifest,
        }),
      ]),
    )

    expect(parsed.packages[0]).toMatchObject({
      compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
      manifest: {
        runtime: { command: "example-image-tool", type: "mcp-stdio" },
        schema: "convax.plugin/2",
      },
    })

    const declarative = parseRemoteCapabilityRegistry(
      registry([
        pluginPackage({
          compatibility: { pluginHost: "convax.plugin-host/3", pluginSchema: "convax.plugin/3" },
          manifest: declarativePluginManifest(),
        }),
      ]),
    )
    expect(declarative.packages[0]).toMatchObject({
      compatibility: { pluginHost: "convax.plugin-host/3", pluginSchema: "convax.plugin/3" },
      manifest: { schema: "convax.plugin/3" },
    })
  })

  test("binds companion commands and target assets to the exact generation manifest and Release path", () => {
    const generationManifest = generationPluginManifest()
    const parsed = parseRemoteCapabilityRegistry(
      registry([
        pluginPackage({
          companions: [companion()],
          compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
          manifest: generationManifest,
        }),
      ]),
    )
    expect(parsed.packages[0]).toMatchObject({
      companions: [
        {
          command: "example-image-tool",
          targets: [{ arch: "arm64", platform: "darwin" }],
          version: "2.0.0",
        },
      ],
    })
  })

  test("rejects companion command drift, missing runtime, unsupported targets, duplicates, and oversized bytes", () => {
    const generationManifest = generationPluginManifest()
    const generationEntry = (companions: unknown) =>
      pluginPackage({
        companions,
        compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
        manifest: generationManifest,
      })
    expect(() =>
      parseRemoteCapabilityRegistry(registry([generationEntry([{ ...companion(), command: "different-tool" }])])),
    ).toThrow("exactly match")
    expect(() => parseRemoteCapabilityRegistry(registry([pluginPackage({ companions: [companion()] })]))).toThrow(
      "matching external",
    )
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([
          generationEntry([
            companion({
              targets: [{ ...companion().targets[0], platform: "freebsd" }],
            }),
          ]),
        ]),
      ),
    ).toThrow("platform")
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([generationEntry([companion({ targets: [companion().targets[0], companion().targets[0]] })])]),
      ),
    ).toThrow("duplicate target")
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([
          generationEntry([
            companion({
              targets: [
                {
                  ...companion().targets[0],
                  artifact: { ...companion().targets[0].artifact, size: 128 * 1024 * 1024 + 1 },
                },
              ],
            }),
          ]),
        ]),
      ),
    ).toThrow("size")
  })

  test("requires the deterministic companion URL including Windows extension semantics", () => {
    const generationManifest = generationPluginManifest()
    const entry = (targets: unknown[]) =>
      pluginPackage({
        companions: [companion({ targets })],
        compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
        manifest: generationManifest,
      })
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([
          entry([
            {
              ...companion().targets[0],
              artifact: { ...companion().targets[0].artifact, url: "https://example.com/companion" },
            },
          ]),
        ]),
      ),
    ).toThrow("exactly match")
    const windows = {
      arch: "x64",
      artifact: {
        sha256: "c".repeat(64),
        size: 10,
        url:
          "https://github.com/microvoid/convax-plugins/releases/download/plugin-hello-convax-v1.0.0/" +
          "convax-companion-example-image-tool-2.0.0-win32-x64.exe",
      },
      platform: "win32",
    }
    expect(() => parseRemoteCapabilityRegistry(registry([entry([windows])]))).not.toThrow()
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([entry([{ ...windows, artifact: { ...windows.artifact, url: windows.artifact.url.slice(0, -4) } }])]),
      ),
    ).toThrow("exactly match")
  })

  test("rejects malformed schemas, unknown fields, and incompatible entries", () => {
    expect(() => parseRemoteCapabilityRegistry(registry([], { schema: "convax.registry/2" }))).toThrow("schema")
    expect(() => parseRemoteCapabilityRegistry({ ...registry(), executable: true })).toThrow("unsupported field")
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([
          pluginPackage({ compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/1" } }),
        ]),
      ),
    ).toThrow("compatibility")
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([
          pluginPackage({
            compatibility: { pluginHost: "convax.plugin-host/1", pluginSchema: "convax.plugin/2" },
            manifest: generationPluginManifest(),
          }),
        ]),
      ),
    ).toThrow("compatibility")
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([
          pluginPackage({
            compatibility: { pluginHost: "convax.plugin-host/1", pluginSchema: "convax.plugin/1" },
            manifest: generationPluginManifest(),
          }),
        ]),
      ),
    ).toThrow("exactly match")
    expect(() => parseRemoteCapabilityRegistry(registry([pluginPackage({ description: "Mismatch" })]))).toThrow(
      "exactly match",
    )
  })

  test("allows only one latest entry per kind and id", () => {
    const secondManifest = pluginManifest({ version: "2.0.0" })
    const second = pluginPackage({
      artifact: artifact({
        url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-hello-convax-v2.0.0/hello-convax-2.0.0.zip",
      }),
      manifest: secondManifest,
      version: secondManifest.version,
    })
    expect(() => parseRemoteCapabilityRegistry(registry([pluginPackage(), second]))).toThrow("duplicate package")
  })

  test("rejects non-official artifacts, duplicate assets, invalid hashes, and invalid sizes", () => {
    expect(() =>
      parseRemoteCapabilityRegistry(
        registry([pluginPackage({ artifact: artifact({ url: "https://example.com/plugin.zip" }) })]),
      ),
    ).toThrow("official GitHub")
    expect(() =>
      parseRemoteCapabilityRegistry(registry([pluginPackage({ artifact: artifact({ sha256: "A".repeat(64) }) })])),
    ).toThrow("lowercase hex")
    expect(() => parseRemoteCapabilityRegistry(registry([pluginPackage({ artifact: artifact({ size: 0 }) })]))).toThrow(
      "size",
    )
    expect(() =>
      parseRemoteCapabilityRegistry(registry([pluginPackage(), skillPackage({ artifact: artifact() })])),
    ).toThrow("reuses an artifact URL")
  })
})

describe("parseRemoteCapabilityShowcase", () => {
  test("binds each showcase entry to the exact Registry sequence, revision, identity, and version", () => {
    const current = parseRemoteCapabilityRegistry(registry())
    const parsed = parseRemoteCapabilityShowcase(showcase(), current)
    expect(parsed.schema).toBe("convax.showcase/1")
    expect(parsed.packages[0]).toMatchObject({
      animation: { mime: "image/gif" },
      id: "hello-agent",
      kind: "skill",
      poster: { mime: "image/png" },
      version: "1.0.0",
    })

    expect(() => parseRemoteCapabilityShowcase(showcase({ sequence: 2 }), current)).toThrow("sequence")
    expect(() => parseRemoteCapabilityShowcase(showcase({ revision: "2".repeat(40) }), current)).toThrow("revision")
    const versionTwo = {
      ...showcase().packages[0],
      animation: showcaseMedia("animation", {
        url: "https://github.com/microvoid/convax-plugins/releases/download/skill-hello-agent-v2.0.0/hello-agent-showcase.gif",
      }),
      poster: showcaseMedia("poster", {
        url: "https://github.com/microvoid/convax-plugins/releases/download/skill-hello-agent-v2.0.0/hello-agent-showcase.png",
      }),
      version: "2.0.0",
    }
    expect(() => parseRemoteCapabilityShowcase(showcase({ packages: [versionTwo] }), current)).toThrow(
      "current Registry",
    )
  })

  test("rejects duplicate identities, unknown fields, unsafe media URLs, and MIME-extension mismatches", () => {
    const current = parseRemoteCapabilityRegistry(registry())
    const entry = showcase().packages[0]
    expect(() => parseRemoteCapabilityShowcase(showcase({ packages: [entry, entry] }), current)).toThrow("duplicate")
    expect(() => parseRemoteCapabilityShowcase({ ...showcase(), source: "renderer" }, current)).toThrow(
      "unsupported field",
    )
    expect(() =>
      parseRemoteCapabilityShowcase(
        showcase({
          packages: [
            {
              ...entry,
              animation: showcaseMedia("animation", { url: "https://attacker.invalid/preview.gif" }),
            },
          ],
        }),
        current,
      ),
    ).toThrow("official GitHub")
    expect(() =>
      parseRemoteCapabilityShowcase(
        showcase({ packages: [{ ...entry, animation: showcaseMedia("animation", { mime: "video/mp4" }) }] }),
        current,
      ),
    ).toThrow("extension")
  })
})

describe("RemoteCapabilityRegistryClient", () => {
  test("serves a validated Registry cache immediately and single-flights background revalidation", async () => {
    const cache = new MemoryRemoteRegistryCache()
    const body = JSON.stringify(registry())
    await cache.write({
      body,
      etag: '"revision-1"',
      sha256: createHash("sha256").update(body).digest("hex"),
    })
    let now = 10_000
    let requests = 0
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock(() => {
        requests += 1
        return response
      }),
      now: () => now,
      registryRevalidateMs: 5_000,
    })

    expect((await client.fetchRegistry({ cachePolicy: "cache-first" })).source).toBe("cache")
    expect((await client.fetchRegistry({ cachePolicy: "cache-first" })).source).toBe("cache")
    expect(requests).toBe(1)
    resolveResponse(new Response(null, { headers: { etag: '"revision-1"' }, status: 304 }))
    expect((await client.fetchRegistry()).source).toBe("not-modified")

    now += 4_999
    expect((await client.fetchRegistry({ cachePolicy: "cache-first" })).source).toBe("cache")
    expect(requests).toBe(1)
  })

  test("single-flights concurrent cold Registry requests", async () => {
    let requests = 0
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(() => {
        requests += 1
        return jsonResponse(registry())
      }),
    })

    const [first, second] = await Promise.all([client.fetchRegistry(), client.fetchRegistry()])
    expect(first.registry).toEqual(second.registry)
    expect(requests).toBe(1)
  })

  test("repairs malformed persistent Registry cache after a valid network response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-registry-repair-"))
    temporaryRoots.push(root)
    const stateFile = path.join(root, "capability-registry", "index-v1.json")
    await fs.mkdir(path.dirname(stateFile), { recursive: true })
    await fs.writeFile(stateFile, "{truncated")
    const cache = new FileRemoteRegistryCache(stateFile)
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock(() => jsonResponse(registry())),
    })

    expect((await client.fetchRegistry()).source).toBe("network")
    const repaired = await cache.read()
    expect(repaired).not.toBeNull()
    expect(parseRemoteCapabilityRegistry(JSON.parse(repaired!.body))).toEqual(parseRemoteCapabilityRegistry(registry()))
  })

  test("does not roll back a newer Registry when publication reread has a transient failure", async () => {
    const initialBody = JSON.stringify(registry([], { revision: "1".repeat(40), sequence: 1 }))
    let entry: Awaited<ReturnType<RemoteRegistryCache["read"]>> = {
      body: initialBody,
      sha256: createHash("sha256").update(initialBody).digest("hex"),
    }
    let failNextRead = false
    const cache: RemoteRegistryCache = {
      async read() {
        if (failNextRead) {
          failNextRead = false
          throw new Error("transient cache read failure")
        }
        return entry
      },
      async write(next) {
        entry = next
      },
    }
    let resolveSlow!: (response: Response) => void
    let markSlowStarted!: () => void
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve
    })
    const slowResponse = new Promise<Response>((resolve) => {
      resolveSlow = resolve
    })
    let requests = 0
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock(() => {
        requests += 1
        if (requests === 1) {
          markSlowStarted()
          return slowResponse
        }
        return jsonResponse(registry([], { revision: "3".repeat(40), sequence: 3 }))
      }),
    })
    const slow = client.fetchRegistry({ signal: new AbortController().signal })
    await slowStarted
    expect((await client.fetchRegistry({ signal: new AbortController().signal })).registry.sequence).toBe(3)

    failNextRead = true
    resolveSlow(jsonResponse(registry([], { revision: "2".repeat(40), sequence: 2 })))
    await expect(slow).resolves.toMatchObject({
      registry: { sequence: 3 },
      source: "cache",
      staleReason: "transient cache read failure",
    })
    expect(parseRemoteCapabilityRegistry(JSON.parse(entry!.body)).sequence).toBe(3)
  })

  test("keeps the in-process Registry high-watermark when the published cache becomes corrupt", async () => {
    const initialBody = JSON.stringify(registry([], { revision: "1".repeat(40), sequence: 1 }))
    let entry: Awaited<ReturnType<RemoteRegistryCache["read"]>> = {
      body: initialBody,
      sha256: createHash("sha256").update(initialBody).digest("hex"),
    }
    let corruptNextRead = false
    const cache: RemoteRegistryCache = {
      async read() {
        if (corruptNextRead) {
          corruptNextRead = false
          throw new RemoteRegistryCacheCorruptionError("corrupt cache")
        }
        return entry
      },
      async write(next) {
        entry = next
      },
    }
    let resolveSlow!: (response: Response) => void
    let markSlowStarted!: () => void
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve
    })
    const slowResponse = new Promise<Response>((resolve) => {
      resolveSlow = resolve
    })
    let requests = 0
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock(() => {
        requests += 1
        if (requests === 1) {
          markSlowStarted()
          return slowResponse
        }
        return jsonResponse(registry([], { revision: "3".repeat(40), sequence: 3 }))
      }),
    })
    const slow = client.fetchRegistry({ signal: new AbortController().signal })
    await slowStarted
    expect((await client.fetchRegistry({ signal: new AbortController().signal })).registry.sequence).toBe(3)

    corruptNextRead = true
    resolveSlow(jsonResponse(registry([], { revision: "2".repeat(40), sequence: 2 })))
    await expect(slow).rejects.toThrow("roll back")
    expect(parseRemoteCapabilityRegistry(JSON.parse(entry!.body)).sequence).toBe(3)
  })

  test("never lets a slower concurrent response roll back a newer published Registry", async () => {
    const cache = new MemoryRemoteRegistryCache()
    const initialBody = JSON.stringify(registry([], { revision: "1".repeat(40), sequence: 1 }))
    await cache.write({
      body: initialBody,
      sha256: createHash("sha256").update(initialBody).digest("hex"),
    })
    let requests = 0
    let resolveSlow!: (response: Response) => void
    const slowResponse = new Promise<Response>((resolve) => {
      resolveSlow = resolve
    })
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock(() => {
        requests += 1
        return requests === 1 ? slowResponse : jsonResponse(registry([], { revision: "3".repeat(40), sequence: 3 }))
      }),
    })
    let changes = 0
    const unsubscribe = client.subscribe(() => {
      changes += 1
    })

    await client.fetchRegistry({ cachePolicy: "cache-first" })
    const explicit = await client.fetchRegistry({ signal: new AbortController().signal })
    expect(explicit.registry.sequence).toBe(3)
    expect(changes).toBe(1)
    const slow = client.fetchRegistry()
    resolveSlow(jsonResponse(registry([], { revision: "2".repeat(40), sequence: 2 })))
    await expect(slow).rejects.toThrow("roll back")

    const published = await cache.read()
    expect(parseRemoteCapabilityRegistry(JSON.parse(published!.body)).sequence).toBe(3)
    expect(changes).toBe(1)
    unsubscribe()
  })

  test("rejects a caller aborted while its validated Registry waits to publish", async () => {
    let entry: Awaited<ReturnType<RemoteRegistryCache["read"]>> = null
    let writes = 0
    let releaseFirstWrite!: () => void
    let markFirstWriteStarted!: () => void
    const firstWriteStarted = new Promise<void>((resolve) => {
      markFirstWriteStarted = resolve
    })
    const firstWriteRelease = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const cache: RemoteRegistryCache = {
      async read() {
        return entry
      },
      async write(next) {
        writes += 1
        if (writes === 1) {
          markFirstWriteStarted()
          await firstWriteRelease
        }
        entry = next
      },
    }
    let requests = 0
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock(() => {
        requests += 1
        const sequence = requests + 1
        return jsonResponse(registry([], { revision: String(sequence).repeat(40), sequence }))
      }),
    })
    const firstController = new AbortController()
    const first = client.fetchRegistry({ signal: firstController.signal })
    await firstWriteStarted

    const secondController = new AbortController()
    const second = client.fetchRegistry({ signal: secondController.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    secondController.abort()
    releaseFirstWrite()

    expect((await first).registry.sequence).toBe(2)
    await expect(second).rejects.toMatchObject({ name: "AbortError" })
    expect(parseRemoteCapabilityRegistry(JSON.parse(entry!.body)).sequence).toBe(3)
  })

  test("uses ETag revalidation and a validated 304 cache hit", async () => {
    const requests: Array<{ etag: string | null; url: string }> = []
    let call = 0
    const client = new RemoteCapabilityRegistryClient({
      cache: new MemoryRemoteRegistryCache(),
      fetch: fetchMock((url, init) => {
        requests.push({ etag: new Headers(init?.headers).get("if-none-match"), url })
        call += 1
        return call === 1
          ? jsonResponse(registry(), { headers: { etag: '"revision-1"' }, status: 200 })
          : new Response(null, { headers: { etag: '"revision-1"' }, status: 304 })
      }),
    })

    expect((await client.fetchRegistry()).source).toBe("network")
    expect((await client.fetchRegistry()).source).toBe("not-modified")
    expect(requests).toEqual([
      { etag: null, url: "https://microvoid.github.io/convax-plugins/registry/v1/index.json" },
      { etag: '"revision-1"', url: "https://microvoid.github.io/convax-plugins/registry/v1/index.json" },
    ])
  })

  test("keeps the production URL fixed while allowing a main-owned test URL seam", async () => {
    let requested = ""
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) => {
        requested = url
        return jsonResponse(registry([]))
      }),
      registryUrl: "https://registry.test/index.json",
    })
    await client.fetchRegistry()
    expect(requested).toBe("https://registry.test/index.json")
  })

  test("falls back to last-known-good only for transport failures", async () => {
    let online = true
    const client = new RemoteCapabilityRegistryClient({
      cache: new MemoryRemoteRegistryCache(),
      fetch: fetchMock(() => {
        if (!online) throw new TypeError("offline")
        return jsonResponse(registry())
      }),
    })
    await client.fetchRegistry()
    online = false
    const fallback = await client.fetchRegistry()
    expect(fallback.source).toBe("cache")
    expect(fallback.staleReason).toContain("offline")
  })

  test("does not hide malformed network content behind the cache", async () => {
    let call = 0
    const client = new RemoteCapabilityRegistryClient({
      cache: new MemoryRemoteRegistryCache(),
      fetch: fetchMock(() => {
        call += 1
        return call === 1 ? jsonResponse(registry()) : jsonResponse({ ...registry(), schema: "convax.registry/2" })
      }),
    })
    await client.fetchRegistry()
    await expect(client.fetchRegistry()).rejects.toBeInstanceOf(RemoteRegistryValidationError)
  })

  test("rejects rollback and same-sequence mutation without overwriting the cache", async () => {
    let next = registry([], { revision: "2".repeat(40), sequence: 2 })
    const client = new RemoteCapabilityRegistryClient({
      cache: new MemoryRemoteRegistryCache(),
      fetch: fetchMock(() => jsonResponse(next)),
    })
    await client.fetchRegistry()
    next = registry([], { revision: "1".repeat(40), sequence: 1 })
    await expect(client.fetchRegistry()).rejects.toThrow("roll back")
    next = registry([], { revision: "3".repeat(40), sequence: 2 })
    await expect(client.fetchRegistry()).rejects.toThrow("without increasing")
  })

  test("ignores a cache entry whose content digest was tampered", async () => {
    let sentEtag: string | null = "not called"
    const cache: RemoteRegistryCache = {
      async read() {
        return { body: JSON.stringify(registry()), etag: '"bad"', sha256: "0".repeat(64) }
      },
      async write() {},
    }
    const client = new RemoteCapabilityRegistryClient({
      cache,
      fetch: fetchMock((_url, init) => {
        sentEtag = new Headers(init?.headers).get("if-none-match")
        return jsonResponse(registry())
      }),
    })
    expect((await client.fetchRegistry()).source).toBe("network")
    expect(sentEtag).toBeNull()
  })

  test("supports timeout and caller cancellation without stale fallback", async () => {
    const waitingFetch = fetchMock(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
            once: true,
          })
        }),
    )
    const timeoutClient = new RemoteCapabilityRegistryClient({ fetch: waitingFetch, timeoutMs: 10 })
    await expect(timeoutClient.fetchRegistry()).rejects.toBeInstanceOf(RemoteRegistryTimeoutError)

    const controller = new AbortController()
    const cancelled = new RemoteCapabilityRegistryClient({ fetch: waitingFetch }).fetchRegistry({
      signal: controller.signal,
    })
    controller.abort(new DOMException("user cancelled", "AbortError"))
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
  })

  test("downloads lazily selected showcase media after validating the official sidecar and bytes", async () => {
    const gif = Uint8Array.from(Buffer.from("GIF89a-safe-preview"))
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const digest = createHash("sha256").update(gif).digest("hex")
    const posterDigest = createHash("sha256").update(png).digest("hex")
    const current = parseRemoteCapabilityRegistry(registry())
    const sidecar = showcase({
      packages: [
        {
          ...showcase().packages[0],
          animation: showcaseMedia("animation", { sha256: digest, size: gif.byteLength }),
          poster: showcaseMedia("poster", { sha256: posterDigest, size: png.byteLength }),
        },
      ],
    })
    const calls: string[] = []
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) => {
        calls.push(url)
        if (url === "https://showcase.test/index.json") return jsonResponse(sidecar)
        if (url.endsWith("hello-agent-showcase.png")) {
          return new Response(png, {
            headers: { "content-length": String(png.byteLength), "content-type": "image/png" },
            status: 200,
          })
        }
        return new Response(gif, {
          headers: { "content-length": String(gif.byteLength), "content-type": "image/gif" },
          status: 200,
        })
      }),
      showcaseUrl: "https://showcase.test/index.json",
    })
    const item = current.packages.find((candidate) => candidate.kind === "skill")!

    await expect(client.downloadSkillShowcase(current, item)).resolves.toEqual({
      altText: "A short animated Skill workflow",
      bytes: gif,
      mimeType: "image/gif",
      size: gif.byteLength,
    })
    await client.downloadSkillShowcase(current, item)
    await expect(client.downloadSkillShowcase(current, item, { media: "poster" })).resolves.toEqual({
      altText: "Skill workflow poster",
      bytes: png,
      mimeType: "image/png",
      size: png.byteLength,
    })
    expect(calls.filter((url) => url === "https://showcase.test/index.json")).toHaveLength(1)
    expect(calls.filter((url) => url.endsWith("hello-agent-showcase.gif"))).toHaveLength(2)
    expect(calls.filter((url) => url.endsWith("hello-agent-showcase.png"))).toHaveLength(1)
  })

  test("single-flights showcase downloads and reuses verified index and media caches across clients", async () => {
    const gif = Uint8Array.from(Buffer.from("GIF89a-safe-preview"))
    const digest = createHash("sha256").update(gif).digest("hex")
    const current = parseRemoteCapabilityRegistry(registry())
    const item = current.packages.find((candidate) => candidate.kind === "skill")!
    const sidecar = showcase({
      packages: [
        {
          ...showcase().packages[0],
          animation: showcaseMedia("animation", { sha256: digest, size: gif.byteLength }),
        },
      ],
    })
    const showcaseCache = new MemoryRemoteRegistryCache()
    const { cache: showcaseMediaCache } = memoryShowcaseMediaCache()
    const calls: string[] = []
    const first = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) => {
        calls.push(url)
        return url === "https://showcase.test/index.json"
          ? jsonResponse(sidecar)
          : new Response(gif, { headers: { "content-type": "image/gif" } })
      }),
      showcaseCache,
      showcaseMediaCache,
      showcaseUrl: "https://showcase.test/index.json",
    })

    const [left, right] = await Promise.all([
      first.downloadSkillShowcase(current, item),
      first.downloadSkillShowcase(current, item),
    ])
    expect(left).toEqual(right)
    expect(calls.filter((url) => url === "https://showcase.test/index.json")).toHaveLength(1)
    expect(calls.filter((url) => url.endsWith("hello-agent-showcase.gif"))).toHaveLength(1)

    const restarted = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(() => {
        throw new Error("persistent cache should avoid the network")
      }),
      showcaseCache,
      showcaseMediaCache,
      showcaseUrl: "https://showcase.test/index.json",
    })
    await expect(restarted.downloadSkillShowcase(current, item)).resolves.toEqual(left)

    const cancelled = new AbortController()
    cancelled.abort(new DOMException("cancelled cache hit", "AbortError"))
    await expect(restarted.downloadSkillShowcase(current, item, { signal: cancelled.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  test("does not let an older slow showcase overwrite a newer Registry identity", async () => {
    const gif = Uint8Array.from(Buffer.from("GIF89a-safe-preview"))
    const digest = createHash("sha256").update(gif).digest("hex")
    const older = parseRemoteCapabilityRegistry(registry())
    const newer = parseRemoteCapabilityRegistry(registry(undefined, { revision: "2".repeat(40), sequence: 2 }))
    const olderSidecar = showcase({
      packages: [
        {
          ...showcase().packages[0],
          animation: showcaseMedia("animation", { sha256: digest, size: gif.byteLength }),
        },
      ],
    })
    const newerSidecar = { ...olderSidecar, revision: newer.revision, sequence: newer.sequence }
    const showcaseCache = new MemoryRemoteRegistryCache()
    let indexRequests = 0
    let markOlderStarted!: () => void
    let resolveOlder!: (response: Response) => void
    const olderStarted = new Promise<void>((resolve) => {
      markOlderStarted = resolve
    })
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlder = resolve
    })
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) => {
        if (url === "https://showcase.test/index.json") {
          indexRequests += 1
          if (indexRequests === 1) {
            markOlderStarted()
            return olderResponse
          }
          return jsonResponse(newerSidecar)
        }
        return new Response(gif, { headers: { "content-type": "image/gif" } })
      }),
      showcaseCache,
      showcaseUrl: "https://showcase.test/index.json",
    })
    const olderItem = older.packages.find((candidate) => candidate.kind === "skill")!
    const newerItem = newer.packages.find((candidate) => candidate.kind === "skill")!

    const slow = client.downloadSkillShowcase(older, olderItem)
    await olderStarted
    await expect(client.downloadSkillShowcase(newer, newerItem)).resolves.toMatchObject({ bytes: gif })
    resolveOlder(jsonResponse(olderSidecar))
    await expect(slow).resolves.toMatchObject({ bytes: gif })

    const persisted = await showcaseCache.read()
    expect(JSON.parse(persisted!.body)).toMatchObject({ revision: newer.revision, sequence: newer.sequence })
    const invalidBody = "{}"
    await showcaseCache.write({
      body: invalidBody,
      sha256: createHash("sha256").update(invalidBody).digest("hex"),
    })
    await expect(client.downloadSkillShowcase(newer, newerItem)).resolves.toMatchObject({ bytes: gif })
    expect(indexRequests).toBe(2)
  })

  test("rejects showcase metadata drift, unsafe redirects, MIME mismatches, and digest changes", async () => {
    const gif = Uint8Array.from(Buffer.from("GIF89a-safe-preview"))
    const digest = createHash("sha256").update(gif).digest("hex")
    const current = parseRemoteCapabilityRegistry(registry())
    const item = current.packages.find((candidate) => candidate.kind === "skill")!
    const validSidecar = showcase({
      packages: [
        {
          ...showcase().packages[0],
          animation: showcaseMedia("animation", { sha256: digest, size: gif.byteLength }),
        },
      ],
    })

    const drifted = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(() => jsonResponse({ ...validSidecar, sequence: 2 })),
      showcaseUrl: "https://showcase.test/index.json",
    })
    await expect(drifted.downloadSkillShowcase(current, item)).rejects.toThrow("sequence")

    const redirecting = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) =>
        url === "https://showcase.test/index.json"
          ? jsonResponse(validSidecar)
          : new Response(null, { headers: { location: "https://attacker.invalid/preview.gif" }, status: 302 }),
      ),
      showcaseUrl: "https://showcase.test/index.json",
    })
    await expect(redirecting.downloadSkillShowcase(current, item)).rejects.toThrow("redirect host")

    const wrongMime = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) =>
        url === "https://showcase.test/index.json"
          ? jsonResponse(validSidecar)
          : new Response(gif, { headers: { "content-type": "text/html" } }),
      ),
      showcaseUrl: "https://showcase.test/index.json",
    })
    await expect(wrongMime.downloadSkillShowcase(current, item)).rejects.toThrow("Content-Type")

    const wrongDigestSidecar = showcase({
      packages: [
        {
          ...showcase().packages[0],
          animation: showcaseMedia("animation", { sha256: "0".repeat(64), size: gif.byteLength }),
        },
      ],
    })
    const wrongDigest = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) =>
        url === "https://showcase.test/index.json"
          ? jsonResponse(wrongDigestSidecar)
          : new Response(gif, { headers: { "content-type": "image/gif" } }),
      ),
      showcaseUrl: "https://showcase.test/index.json",
    })
    await expect(wrongDigest.downloadSkillShowcase(current, item)).rejects.toThrow("SHA-256")
  })

  test("downloads a companion as bounded raw bytes with exact size, digest, and redirect controls", async () => {
    const bytes = new TextEncoder().encode("native companion bytes")
    const digest = createHash("sha256").update(bytes).digest("hex")
    const generationManifest = generationPluginManifest()
    const item = parseRemoteCapabilityRegistry(
      registry([
        pluginPackage({
          companions: [
            companion({
              targets: [
                {
                  ...companion().targets[0],
                  artifact: { ...companion().targets[0].artifact, sha256: digest, size: bytes.byteLength },
                },
              ],
            }),
          ],
          compatibility: { pluginHost: "convax.plugin-host/2", pluginSchema: "convax.plugin/2" },
          manifest: generationManifest,
        }),
      ]),
    ).packages[0]!
    if (item.kind !== "plugin") throw new Error("expected Plugin")
    const companionItem = item.companions![0]!
    const target = companionItem.targets[0]!
    const calls: string[] = []
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) => {
        calls.push(url)
        return calls.length === 1
          ? new Response(null, {
              headers: { location: "https://release-assets.githubusercontent.com/release/companion" },
              status: 302,
            })
          : new Response(bytes, { headers: { "content-length": String(bytes.byteLength) }, status: 200 })
      }),
    })
    await expect(client.downloadCompanionArtifact(item, companionItem, target)).resolves.toEqual(bytes)
    expect(calls).toHaveLength(2)

    const short = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(() => new Response(bytes.slice(0, -1))),
    })
    await expect(short.downloadCompanionArtifact(item, companionItem, target)).rejects.toThrow("size mismatch")
    const changed = new Uint8Array(bytes)
    changed[0] ^= 0xff
    const corrupt = new RemoteCapabilityRegistryClient({ fetch: fetchMock(() => new Response(changed)) })
    await expect(corrupt.downloadCompanionArtifact(item, companionItem, target)).rejects.toThrow("SHA-256")
    const redirecting = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(
        () => new Response(null, { headers: { location: "https://attacker.invalid/companion" }, status: 302 }),
      ),
    })
    await expect(redirecting.downloadCompanionArtifact(item, companionItem, target)).rejects.toThrow("redirect host")
  })

  test("downloads an allowlisted redirect, verifies bytes and returns install-ready files", async () => {
    const manifest = pluginManifest()
    const zip = createTestZip([
      { content: JSON.stringify(manifest), name: "manifest.json" },
      { content: "<!doctype html><title>Hello</title>", method: 8, name: "web/index.html" },
    ])
    const item = packageWithZip(zip)
    const calls: string[] = []
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock((url) => {
        calls.push(url)
        if (calls.length === 1) {
          return new Response(null, {
            headers: { location: "https://release-assets.githubusercontent.com/github-production-release-asset/test" },
            status: 302,
          })
        }
        return new Response(zip, { headers: { "content-length": String(zip.byteLength) }, status: 200 })
      }),
    })
    const bundle = await client.downloadBundle(item)
    expect(new TextDecoder().decode(bundle.files["web/index.html"])).toContain("Hello")
    expect(calls).toHaveLength(2)
  })

  test("rejects disallowed redirect hosts, byte size changes, and SHA-256 mismatch", async () => {
    const manifest = pluginManifest()
    const zip = createTestZip([
      { content: JSON.stringify(manifest), name: "manifest.json" },
      { content: "hello", name: "web/index.html" },
    ])
    const item = packageWithZip(zip)
    const redirecting = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(
        () => new Response(null, { headers: { location: "https://example.com/asset.zip" }, status: 302 }),
      ),
    })
    await expect(redirecting.downloadBundle(item)).rejects.toThrow("redirect host")

    const short = new RemoteCapabilityRegistryClient({ fetch: fetchMock(() => new Response(zip.slice(0, -1))) })
    await expect(short.downloadBundle(item)).rejects.toThrow("size mismatch")

    const corruptItem = { ...item, artifact: { ...item.artifact, sha256: "0".repeat(64) } } as RemoteCapabilityPackage
    const corrupt = new RemoteCapabilityRegistryClient({ fetch: fetchMock(() => new Response(zip)) })
    await expect(corrupt.downloadBundle(corruptItem)).rejects.toThrow("SHA-256")
  })

  test("rejects an archive manifest that differs from the signed registry metadata", async () => {
    const zip = createTestZip([
      { content: JSON.stringify(pluginManifest({ name: "Changed" })), name: "manifest.json" },
      { content: "hello", name: "web/index.html" },
    ])
    const item = packageWithZip(zip)
    const client = new RemoteCapabilityRegistryClient({ fetch: fetchMock(() => new Response(zip)) })
    await expect(client.downloadBundle(item)).rejects.toThrow("does not match")
  })

  test("refuses to download a yanked package", async () => {
    const item = parseRemoteCapabilityRegistry(registry([pluginPackage({ yanked: true })])).packages[0]!
    const client = new RemoteCapabilityRegistryClient({
      fetch: fetchMock(() => {
        throw new Error("must not fetch")
      }),
    })
    await expect(client.downloadBundle(item)).rejects.toThrow("yanked")
  })
})

describe("unpackSafeZip", () => {
  test("unpacks stored and deflated regular files", () => {
    const files = unpackSafeZip(
      createTestZip([
        { content: "one", name: "one.txt" },
        { content: "two", method: 8, name: "nested/two.txt" },
      ]),
    )
    expect(new TextDecoder().decode(files["one.txt"])).toBe("one")
    expect(new TextDecoder().decode(files["nested/two.txt"])).toBe("two")
  })

  test("rejects zip-slip, absolute, drive, and backslash paths", () => {
    for (const name of ["../escape.txt", "/absolute.txt", "C:/drive.txt", "dir\\escape.txt"]) {
      expect(() => unpackSafeZip(createTestZip([{ content: "bad", name }]))).toThrow("portable")
    }
  })

  test("rejects duplicate and case-insensitive path collisions", () => {
    expect(() =>
      unpackSafeZip(
        createTestZip([
          { content: "first", name: "same.txt" },
          { content: "second", name: "same.txt" },
        ]),
      ),
    ).toThrow("duplicate")
    expect(() =>
      unpackSafeZip(
        createTestZip([
          { content: "first", name: "Web/index.html" },
          { content: "second", name: "web/runtime.js" },
        ]),
      ),
    ).toThrow("case-insensitive")
  })

  test("rejects symlinks, checksum changes, expanded size, and compression-ratio bombs", () => {
    expect(() =>
      unpackSafeZip(createTestZip([{ content: "target", externalAttributes: (0o120777 << 16) >>> 0, name: "link" }])),
    ).toThrow("symbolic links")
    expect(() => unpackSafeZip(createTestZip([{ content: "hello", crcOverride: 0, name: "bad.txt" }]))).toThrow(
      "checksum",
    )
    expect(() =>
      unpackSafeZip(createTestZip([{ content: "123456", name: "large.txt" }]), { maxFileBytes: 5, maxTotalBytes: 5 }),
    ).toThrow("per-file")
    expect(() =>
      unpackSafeZip(createTestZip([{ content: "a".repeat(4_096), method: 8, name: "bomb.txt" }]), {
        maxCompressionRatio: 2,
      }),
    ).toThrow("compression ratio")
  })

  test("rejects malformed archives before returning any files", () => {
    expect(() => unpackSafeZip(new Uint8Array([1, 2, 3]))).toThrow("end-of-central-directory")
    const zip = createTestZip([{ content: "hello", name: "ok.txt" }])
    zip[zip.byteLength - 22] = 0
    expect(() => unpackSafeZip(zip)).toThrow("end-of-central-directory")
  })
})

describe("FileRemoteRegistryCache", () => {
  test("atomically persists a cache record at an absolute main-owned path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-registry-cache-"))
    temporaryRoots.push(root)
    const cache = new FileRemoteRegistryCache(path.join(root, "capability-registry", "index-v1.json"))
    const body = JSON.stringify(registry())
    const entry = { body, etag: '"one"', sha256: createHash("sha256").update(body).digest("hex") }
    await cache.write(entry)
    expect(await cache.read()).toEqual(entry)
  })

  test("round-trips a maximum-size body with worst-case JSON escaping", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-registry-cache-escaped-"))
    temporaryRoots.push(root)
    const cache = new FileRemoteRegistryCache(path.join(root, "capability-registry", "index-v1.json"))
    const body = "\0".repeat(2 * 1024 * 1024)
    const entry = { body, sha256: createHash("sha256").update(body).digest("hex") }

    await cache.write(entry)
    expect(await cache.read()).toEqual(entry)
  })

  test("requires an absolute path and refuses a symlink cache target", async () => {
    expect(() => new FileRemoteRegistryCache("relative/index.json")).toThrow("absolute")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-registry-cache-link-"))
    temporaryRoots.push(root)
    const target = path.join(root, "target.json")
    const link = path.join(root, "index.json")
    await fs.writeFile(target, "{}")
    await fs.symlink(target, link)
    const cache = new FileRemoteRegistryCache(link)
    await expect(cache.write({ body: "{}", sha256: "0".repeat(64) })).rejects.toThrow("regular file")
  })
})
