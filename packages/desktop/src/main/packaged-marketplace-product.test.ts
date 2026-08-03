import { describe, expect, test } from "bun:test"

import {
  canonicalJson,
  parseBuiltinBundleArchive,
  sha256Hex,
} from "@convax/marketplace"

import { projectPackagedBuiltinRuntimeSurfaces } from "./packaged-marketplace-product"

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
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  )
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

function manifest(
  surface: "agent" | "canvas",
  overrides: Record<string, unknown> = {},
) {
  return {
    capabilities: [],
    contributes:
      surface === "canvas"
        ? { canvas: { renderer: { create: true } } }
        : {},
    description: "Packaged Builtin Plugin fixture",
    ...(surface === "canvas"
      ? { entry: "index.html" }
      : { hooks: "hook.mjs" }),
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
    const projected = projectPackagedBuiltinRuntimeSurfaces(
      fixture.bundle,
      fixture.archive,
    )
    expect(projected.get(`builtin-fixture\0${"1.0.0"}`)).toBe(expected)
  })

  test("fails closed when the artifact manifest identity differs from the bundle member", () => {
    const fixture = builtinFixture(
      manifest("canvas", { id: "another-plugin" }),
    )
    expect(() =>
      projectPackagedBuiltinRuntimeSurfaces(fixture.bundle, fixture.archive),
    ).toThrow("identity does not match")
  })

  test("fails closed when the artifact contains a pre-v8 manifest", () => {
    const fixture = builtinFixture(
      manifest("canvas", { schema: "convax.plugin/7" }),
    )
    expect(() =>
      projectPackagedBuiltinRuntimeSurfaces(fixture.bundle, fixture.archive),
    ).toThrow("must use convax.plugin/8")
  })
})
