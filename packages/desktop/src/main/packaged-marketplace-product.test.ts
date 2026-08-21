import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  canonicalJson,
  canonicalProductPolicyDigest,
  computeSourceKey,
  parseBuiltinBundleArchive,
  sha256Hex,
  type MarketplaceArtifactLock,
  type MarketplaceProductLock,
} from "@convax/marketplace"

import {
  PackagedMarketplaceProduct,
  projectPackagedBuiltinRuntimeProjections,
  projectPackagedBuiltinRuntimeSurfaces,
} from "./packaged-marketplace-product"

interface ZipEntry {
  readonly bytes: Uint8Array
  readonly path: string
}

function uint16(value: number) {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function uint32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function concat(chunks: readonly Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffff_ffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

/** Mirrors the deterministic stored-ZIP contract used by Marketplace Kit. */
function deterministicZip(entriesValue: readonly ZipEntry[]) {
  const entries = [...entriesValue].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  const localRecords: Uint8Array[] = []
  const centralRecords: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path)
    const checksum = crc32(entry.bytes)
    const local = concat([
      uint32(0x0403_4b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(33),
      uint32(checksum),
      uint32(entry.bytes.byteLength),
      uint32(entry.bytes.byteLength),
      uint16(name.byteLength),
      uint16(0),
      name,
      entry.bytes,
    ])
    localRecords.push(local)
    centralRecords.push(
      concat([
        uint32(0x0201_4b50),
        uint16(0x031e),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(0),
        uint16(33),
        uint32(checksum),
        uint32(entry.bytes.byteLength),
        uint32(entry.bytes.byteLength),
        uint16(name.byteLength),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0o644 << 16),
        uint32(offset),
        name,
      ]),
    )
    offset += local.byteLength
  }
  const central = concat(centralRecords)
  return concat([
    ...localRecords,
    central,
    uint32(0x0605_4b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(central.byteLength),
    uint32(offset),
    uint16(0),
  ])
}

function manifest(surface: "agent" | "canvas", overrides: Record<string, unknown> = {}) {
  return {
    capabilities: [],
    contributes: surface === "canvas" ? { canvas: { renderer: { create: true } } } : {},
    description: "Packaged Builtin Plugin fixture",
    ...(surface === "canvas" ? { entry: "index.html" } : { hooks: "hook.mjs" }),
    hostApi: {
      major: 3,
      optional: [],
      required: surface === "canvas" ? ["host.context.get"] : [],
    },
    id: "builtin-fixture",
    name: "Builtin fixture",
    schema: "convax.plugin/8",
    version: "1.0.0",
    ...overrides,
  }
}

function builtinFixture(
  pluginManifest: Record<string, unknown>,
  memberIdentity = { id: "builtin-fixture", version: "1.0.0" },
) {
  const pluginEntries: ZipEntry[] = [
    {
      bytes: new TextEncoder().encode(JSON.stringify(pluginManifest)),
      path: "manifest.json",
    },
  ]
  if (typeof pluginManifest.entry === "string") {
    pluginEntries.push({
      bytes: new TextEncoder().encode("<!doctype html><title>fixture</title>"),
      path: pluginManifest.entry,
    })
  }
  if (typeof pluginManifest.hooks === "string") {
    pluginEntries.push({
      bytes: new TextEncoder().encode("export const Plugin = async () => ({})\n"),
      path: pluginManifest.hooks,
    })
  }
  const pluginBytes = deterministicZip(pluginEntries)
  const posterBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  const members = [
    {
      artifact: {
        path: "members/builtin-fixture.zip",
        sha256: sha256Hex(pluginBytes),
        size: pluginBytes.byteLength,
      },
      id: memberIdentity.id,
      kind: "plugin" as const,
      presentation: {
        poster: {
          mime: "image/png",
          path: "presentation/builtin-fixture.png",
          sha256: sha256Hex(posterBytes),
          size: posterBytes.byteLength,
        },
      },
      version: memberIdentity.version,
    },
  ]
  const bundle = {
    members,
    release: { id: sha256Hex(canonicalJson(members)) },
    schema: "convax.builtin-bundle/1",
  }
  const archive = deterministicZip([
    {
      bytes: new TextEncoder().encode(`${canonicalJson(bundle)}\n`),
      path: "bundle.json",
    },
    { bytes: pluginBytes, path: members[0].artifact.path },
    { bytes: posterBytes, path: members[0].presentation.poster.path },
  ])
  return {
    archive,
    bundle: parseBuiltinBundleArchive(archive),
  }
}

describe("Packaged Builtin Plugin runtime-surface projection", () => {
  test.each([
    ["canvas", "agent-and-convax"],
    ["agent", "agent"],
  ] as const)("reads a canonical v8 %s manifest from the member artifact", (surface, expected) => {
    const fixture = builtinFixture(manifest(surface))
    const projected = projectPackagedBuiltinRuntimeSurfaces(fixture.bundle, fixture.archive)
    expect(projected.get(`builtin-fixture\0${"1.0.0"}`)).toBe(expected)
  })

  test("carries manifest-derived categories with the Builtin runtime projection", () => {
    const fixture = builtinFixture(
      manifest("agent", {
        contributes: {
          generation: {
            models: [],
            tools: [
              {
                acceptedInputs: [],
                description: "Create video",
                id: "video.create",
                output: "video",
                title: "Create video",
              },
            ],
          },
          skills: [{ name: "video-helper", path: "skills/video-helper" }],
        },
        hooks: undefined,
        runtime: { command: "builtin-fixture", type: "mcp-stdio" },
      }),
    )
    const projected = projectPackagedBuiltinRuntimeProjections(fixture.bundle, fixture.archive)
    expect(projected.get(`builtin-fixture\0${"1.0.0"}`)).toMatchObject({
      pluginCategories: ["video", "skill"],
      runtimeSurface: "agent-and-convax",
    })
  })

  test("fails closed when the artifact manifest identity differs from the bundle member", () => {
    const fixture = builtinFixture(manifest("canvas", { id: "another-plugin" }))
    expect(() => projectPackagedBuiltinRuntimeSurfaces(fixture.bundle, fixture.archive)).toThrow(
      "identity does not match",
    )
  })

  test("fails closed when the artifact contains a pre-v8 manifest", () => {
    const fixture = builtinFixture(manifest("canvas", { schema: "convax.plugin/7" }))
    expect(() => projectPackagedBuiltinRuntimeSurfaces(fixture.bundle, fixture.archive)).toThrow(
      "must use convax.plugin/8",
    )
  })
})

function lockedArtifact(name: string, tag: string, bytes: Uint8Array): MarketplaceArtifactLock {
  return {
    name,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    url: `https://github.com/convaxai/convax-plugins/releases/download/${tag}/${name}`,
  }
}

test("exposes packaged recovery bytes only for one exact retired Plugin binding", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-packaged-recovery-"))
  try {
    const builtin = builtinFixture(manifest("canvas"))
    const pluginManifest = {
      capabilities: [],
      contributes: { canvas: { renderer: { create: true } } },
      description: "Current replacement fixture",
      entry: "index.html",
      hostApi: { major: 3, optional: [], required: ["host.context.get"] },
      id: "legacy-tools",
      name: "Legacy Tools",
      schema: "convax.plugin/8",
      version: "2.0.0",
    }
    const pluginBytes = deterministicZip([
      { bytes: new TextEncoder().encode("<!doctype html><title>Legacy Tools</title>"), path: "index.html" },
      { bytes: new TextEncoder().encode(JSON.stringify(pluginManifest)), path: "manifest.json" },
    ])
    const pluginArtifact = lockedArtifact("plugin-legacy-tools-2.0.0.zip", "plugin-legacy-tools-v2.0.0", pluginBytes)
    const registryPackages = [
      {
        compatibility: { convax: ">=0.1.0" },
        delivery: {
          kind: "artifact" as const,
          sha256: pluginArtifact.sha256,
          size: pluginArtifact.size,
          url: pluginArtifact.url,
        },
        id: "legacy-tools",
        kind: "plugin" as const,
        manifest: pluginManifest,
        presentation: { description: "Current replacement fixture", name: "Legacy Tools" },
        version: "2.0.0",
      },
    ]
    const officialRevision = sha256Hex(canonicalJson(registryPackages))
    const descriptor = {
      compatibility: { convax: ">=0.1.0" },
      delivery: { kind: "github-pages-releases" },
      id: "convax-official",
      name: "Convax Official",
      publisher: { name: "Convax" },
      registry: { v2: { url: "https://convaxai.github.io/convax-plugins/registry/v2/index.json" } },
      repository: { name: "convax-plugins", owner: "convaxai" },
      schema: "convax.marketplace/1",
      showcase: { v2: { url: "https://convaxai.github.io/convax-plugins/showcase/v2/index.json" } },
    }
    const registry = {
      marketplaceId: "convax-official",
      packages: registryPackages,
      revision: officialRevision,
      schema: "convax.registry/2",
      sequence: 1,
    }
    const showcase = {
      marketplaceId: "convax-official",
      packages: [],
      revision: officialRevision,
      schema: "convax.showcase/2",
    }
    const descriptorBytes = new TextEncoder().encode(`${JSON.stringify(descriptor)}\n`)
    const registryBytes = new TextEncoder().encode(`${JSON.stringify(registry)}\n`)
    const showcaseBytes = new TextEncoder().encode(`${JSON.stringify(showcase)}\n`)
    const retired = {
      artifact: { sha256: "c".repeat(64), size: 2_048 },
      hostApiMajor: 2,
      snapshotDigest: "d".repeat(64),
      sourceKey: "e".repeat(64),
      version: "1.0.0",
    }
    const policy: MarketplaceProductLock["policy"] = {
      builtin: { marketplaceId: "convax-builtin", repository: "convaxai/convax-plugins" },
      official: {
        descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
        marketplaceId: "convax-official",
        repository: "convaxai/convax-plugins",
      },
      packages: [
        {
          id: "legacy-tools",
          kind: "plugin",
          marketplaceId: "convax-official",
          purposes: ["retired-recovery"],
          retired,
          targets: [],
          version: "2.0.0",
        },
      ],
      revision: 3,
    }
    const lock: MarketplaceProductLock = {
      policy,
      resolved: {
        builtinBundle: lockedArtifact(
          "convax-builtin-bundle.zip",
          `builtin-${builtin.bundle.release.id}`,
          builtin.archive,
        ),
        builtinReservations: builtin.bundle.members.map(({ id, kind }) => ({ id, kind })),
        official: {
          descriptor: lockedArtifact("marketplace.json", `registry-v2-${officialRevision}`, descriptorBytes),
          registry: lockedArtifact("registry-v2.json", `registry-v2-${officialRevision}`, registryBytes),
          revision: officialRevision,
          showcase: lockedArtifact("showcase-v2.json", `registry-v2-${officialRevision}`, showcaseBytes),
        },
        packages: [
          {
            artifact: pluginArtifact,
            companions: [],
            id: "legacy-tools",
            kind: "plugin",
            marketplaceId: "convax-official",
            ownedSkills: [],
            purposes: ["retired-recovery"],
            retired,
            targets: [],
            version: "2.0.0",
          },
        ],
        policyDigest: canonicalProductPolicyDigest(policy),
      },
      schema: "convax.marketplace-product-lock/3",
    }
    const staged = [
      { artifact: lock.resolved.builtinBundle, bytes: builtin.archive, relativePath: "builtin/bundle.zip" },
      {
        artifact: lock.resolved.official.descriptor,
        bytes: descriptorBytes,
        relativePath: "official/marketplace.json",
      },
      { artifact: lock.resolved.official.registry, bytes: registryBytes, relativePath: "official/registry-v2.json" },
      { artifact: lock.resolved.official.showcase, bytes: showcaseBytes, relativePath: "official/showcase-v2.json" },
      { artifact: pluginArtifact, bytes: pluginBytes, relativePath: "recovery-artifacts/legacy-tools/plugin.zip" },
    ]
    for (const entry of staged) {
      const target = path.join(root, entry.relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, entry.bytes)
    }
    const packagedManifest = {
      lock,
      paths: staged.map(({ artifact, relativePath }) => ({
        path: relativePath,
        sha256: artifact.sha256,
        size: artifact.size,
      })),
      reservation: { members: lock.resolved.builtinReservations, schema: "convax.builtin-reservation/1" },
      schema: "convax.packaged-marketplace-product/1",
    }
    const manifestPath = path.join(root, "manifest.json")
    const writeManifest = (value: unknown) => fs.writeFile(manifestPath, `${JSON.stringify(value)}\n`)

    await writeManifest({ ...packagedManifest, paths: packagedManifest.paths.slice(0, -1) })
    await expect(PackagedMarketplaceProduct.load(root)).rejects.toThrow("do not exactly close")

    await writeManifest({
      ...packagedManifest,
      paths: [...packagedManifest.paths, { path: "unreferenced/extra.bin", sha256: "f".repeat(64), size: 1 }],
    })
    await expect(PackagedMarketplaceProduct.load(root)).rejects.toThrow("do not exactly close")

    const changedDescriptorBytes = new TextEncoder().encode(
      `${JSON.stringify({ ...descriptor, repository: { ...descriptor.repository, owner: "ConvaxAI" } })}\n`,
    )
    const changedDescriptorArtifact = lockedArtifact(
      "marketplace.json",
      `registry-v2-${officialRevision}`,
      changedDescriptorBytes,
    )
    await fs.writeFile(path.join(root, "official/marketplace.json"), changedDescriptorBytes)
    await writeManifest({
      ...packagedManifest,
      lock: {
        ...lock,
        resolved: {
          ...lock.resolved,
          official: { ...lock.resolved.official, descriptor: changedDescriptorArtifact },
        },
      },
      paths: packagedManifest.paths.map((entry) =>
        entry.sha256 === lock.resolved.official.descriptor.sha256
          ? { ...entry, sha256: changedDescriptorArtifact.sha256, size: changedDescriptorArtifact.size }
          : entry,
      ),
    })
    await expect(PackagedMarketplaceProduct.load(root)).rejects.toThrow("canonical product source identity")

    await fs.writeFile(path.join(root, "official/marketplace.json"), descriptorBytes)
    await writeManifest(packagedManifest)

    const product = await PackagedMarketplaceProduct.load(root)
    const item = product.registry.packages[0]!
    await expect(product.verifiedCandidate(item)).rejects.toThrow("not selected")

    const exactRecovery = {
      ...retired,
      pluginId: "legacy-tools",
      sourceIdentity: retired.sourceKey,
    }
    await expect(product.verifiedRecoveryCandidate(item, exactRecovery)).resolves.toMatchObject({
      artifactBytes: pluginBytes,
      item,
    })
    expect(product.retiredPluginSourceMigrations()).toEqual([
      {
        fromSourceIdentity: retired.sourceKey,
        pluginId: "legacy-tools",
        toSourceIdentity: computeSourceKey({
          deliveryPolicy: "github-pages-releases",
          descriptorUrl: policy.official.descriptorUrl,
          kind: "network",
          marketplaceId: "convax-official",
          repository: { name: "convax-plugins", owner: "convaxai" },
        }),
      },
    ])
    for (const mismatch of [
      { ...exactRecovery, artifact: { ...exactRecovery.artifact, sha256: "e".repeat(64) } },
      { ...exactRecovery, artifact: { ...exactRecovery.artifact, size: 2_049 } },
      { ...exactRecovery, hostApiMajor: 1 },
      { ...exactRecovery, pluginId: "another-plugin" },
      { ...exactRecovery, snapshotDigest: "e".repeat(64) },
      { ...exactRecovery, sourceIdentity: "f".repeat(64) },
      { ...exactRecovery, version: "1.0.1" },
    ]) {
      await expect(product.verifiedRecoveryCandidate(item, mismatch)).resolves.toBeNull()
    }
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})
