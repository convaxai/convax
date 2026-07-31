import { describe, expect, test } from "bun:test"
import {
  aggregateCatalog,
  assertSelectionCurrent,
  BUILTIN_SOURCE_IDENTITY,
  builtinSourceKey,
  canonicalJson,
  canonicalProductPolicyDigest,
  classifyServerPackageForCatalog,
  computeSourceKey,
  decideSourceMutation,
  identityKeyForMcpServer,
  parseMarketplaceDescriptor,
  parseMarketplaceProductLock,
  parseBuiltinBundle,
  parseRegistryV2,
  parseShowcaseV2,
  parseServerPackage,
  issueSelectionToken,
  verifySelectionToken,
  resolveSourceRegistration,
  resolveInstallConflict,
  sha256Hex,
  versionKeyForMcpServer,
  type MarketplaceProductPolicy,
} from "./index"
import { OFFICIAL_SERVER_SCHEMA_SHA256, OFFICIAL_SERVER_SCHEMA_BYTES } from "./server-schema"

const artifact = {
  kind: "artifact" as const,
  url: "https://github.com/acme/market/releases/download/v1/plugin.zip",
  size: 10,
  sha256: "a".repeat(64),
}

const item = (marketplaceId: string, kind: "plugin" | "skill" | "mcp-server", id: string) => ({
  marketplaceId,
  sourceKey: `source:${marketplaceId}` as never,
  sourceKind: marketplaceId === "builtin" ? ("builtin" as const) : ("network" as const),
  sourceOrder: marketplaceId === "third" ? 1 : 0,
  official: marketplaceId === "official",
  kind,
  id,
  version: "1.0.0",
  catalogSequence: 1,
  catalogRevision: "a".repeat(64),
  runtimeSurface: "none" as const,
  compatibility: { convax: ">=0.1.0" },
  presentation: { name: `${marketplaceId}-${id}` },
  delivery: artifact,
})

describe("@convax/marketplace strict contracts", () => {
  test("canonicalizes and derives distinct source identities without member data", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"z":1}')
    const firstBundle = {
      releaseId: "a".repeat(64),
      members: [{ kind: "skill", id: "canvas-storyboard" }],
    }
    const nextBundle = {
      releaseId: "b".repeat(64),
      members: [
        { kind: "skill", id: "canvas-storyboard" },
        { kind: "skill", id: "new-builtin-skill" },
      ],
    }
    expect(firstBundle).not.toEqual(nextBundle)
    expect(builtinSourceKey()).toBe(computeSourceKey(BUILTIN_SOURCE_IDENTITY))
    expect(builtinSourceKey()).toBe(builtinSourceKey())
    // @ts-expect-error Builtin identity is product-defined; bundle data is not source identity.
    computeSourceKey({ ...BUILTIN_SOURCE_IDENTITY, releaseId: firstBundle.releaseId })
    // @ts-expect-error Builtin identity cannot be replaced by a release-derived source instance.
    computeSourceKey({ ...BUILTIN_SOURCE_IDENTITY, sourceInstanceId: nextBundle.releaseId })
  })

  test("strictly parses descriptors and rejects unknown keys", () => {
    const valid = {
      schema: "convax.marketplace/1",
      id: "acme",
      name: "Acme",
      publisher: { name: "Acme" },
      repository: { owner: "acme", name: "market" },
      registry: { v2: { url: "https://acme.github.io/market/registry-v2.json" } },
      showcase: { v2: { url: "https://acme.github.io/market/showcase-v2.json" } },
      compatibility: { convax: ">=0.1.0" },
      delivery: { kind: "github-pages-releases" },
    }
    expect(parseMarketplaceDescriptor(valid).id).toBe("acme")
    expect(() => parseMarketplaceDescriptor({ ...valid, trust: true })).toThrow("unknown")
    expect(() =>
      parseMarketplaceDescriptor({
        ...valid,
        registry: {
          v1: { url: "https://acme.github.io/market/registry-v1.json" },
          v2: { url: "https://acme.github.io/market/registry-v2.json" },
        },
      }),
    ).toThrow("unknown")
    expect(() =>
      parseMarketplaceDescriptor({
        ...valid,
        registry: { v2: { url: "https://acme.github.io:8443/market/registry-v2.json" } },
      }),
    ).toThrow("GitHub Pages")
    expect(() =>
      parseMarketplaceDescriptor({
        ...valid,
        repository: { owner: "acme", name: "market/escaped" },
      }),
    ).toThrow("repository")
    expect(() =>
      parseMarketplaceDescriptor({
        ...valid,
        registry: { v2: { url: "https://acme.github.io/market//registry-v2.json" } },
      }),
    ).toThrow("GitHub Pages")
  })

  test("rejects duplicate registry identities and admits current or historical Plugin projections", () => {
    const mcpServer = {
      name: "io.example/m",
      description: "Example MCP",
      version: "1.0.0",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    }
    const plugin = {
      ...item("official", "plugin", "p"),
      compatibility: { convax: ">=0.1.0" },
      presentation: { name: "P", description: "Plugin P" },
      manifest: {
        schema: "convax.plugin/8",
        id: "p",
        version: "1.0.0",
        hostApi: { major: 2, required: [], optional: [] },
      },
      delivery: {
        ...artifact,
        url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-p-v1.0.0/plugin-p-1.0.0.zip",
      },
    }
    const mcp = {
      ...item("official", "mcp-server", "io.example/m"),
      presentation: { name: "M", description: "MCP M" },
      delivery: {
        kind: "mcp-http" as const,
        serverJson: mcpServer,
        serverJsonSha256: sha256Hex(`${canonicalJson(mcpServer)}\n`),
        runtime: { endpoint: "https://example.com/mcp", transport: "streamable-http" as const },
      },
    }
    const packages = [plugin, mcp].map(
      ({
        marketplaceId: _marketplaceId,
        sourceKey: _sourceKey,
        sourceKind: _sourceKind,
        sourceOrder: _sourceOrder,
        official: _official,
        catalogRevision: _catalogRevision,
        catalogSequence: _catalogSequence,
        runtimeSurface: _runtimeSurface,
        ...entry
      }) => entry,
    )
    const registry = {
      schema: "convax.registry/2",
      marketplaceId: "official",
      sequence: 1,
      revision: sha256Hex(canonicalJson(packages)),
      packages,
    }
    const parsed = parseRegistryV2(registry)
    expect(parsed.packages[0]?.manifest).toMatchObject({
      schema: "convax.plugin/8",
      hostApi: { major: 2, required: [], optional: [] },
    })
    const futureMinorPackages = registry.packages.map((entry) =>
      "manifest" in entry
        ? {
            ...entry,
            manifest: {
              ...entry.manifest,
              hostApi: { major: 2, required: ["future.capability.invoke"], optional: [] },
            },
          }
        : entry,
    )
    expect(
      parseRegistryV2({
        ...registry,
        revision: sha256Hex(canonicalJson(futureMinorPackages)),
        packages: futureMinorPackages,
      }).packages[0]?.manifest?.hostApi,
    ).toEqual({ major: 2, required: ["future.capability.invoke"], optional: [] })
    const legacyMajorPackages = registry.packages.map((entry) =>
      "manifest" in entry
        ? {
            ...entry,
            manifest: {
              ...entry.manifest,
              hostApi: { major: 1, required: [], optional: [] },
            },
          }
        : entry,
    )
    expect(() =>
      parseRegistryV2({
        ...registry,
        revision: sha256Hex(canonicalJson(legacyMajorPackages)),
        packages: legacyMajorPackages,
      }),
    ).toThrow("major must be 2")
    expect(() => parseRegistryV2({ ...registry, packages: [registry.packages[0], registry.packages[0]] })).toThrow(
      "duplicate",
    )
    expect(() => parseRegistryV2({ ...registry, marketplaceId: "Official-" })).toThrow("Marketplace slug")
    expect(() => parseRegistryV2({ ...registry, sequence: 0 })).toThrow("positive")
    expect(() => parseRegistryV2({ ...registry, revision: "a".repeat(40) })).toThrow("content SHA-256")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [{ ...registry.packages[0], version: "../mutable" }],
      }),
    ).toThrow("version")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            manifest: { schema: "convax.plugin/4", id: "different-plugin", version: "1.0.0" },
          },
        ],
      }),
    ).toThrow("manifest identity")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            manifest: { schema: "convax.plugin/999", id: "p", version: "1.0.0" },
          },
        ],
      }),
    ).toThrow("manifest schema")
    const historicalPackages = registry.packages.map((entry) =>
      "manifest" in entry
        ? {
            ...entry,
            manifest: {
              schema: "convax.plugin/7",
              id: "p",
              version: "1.0.0",
            },
          }
        : entry,
    )
    expect(
      parseRegistryV2({
        ...registry,
        revision: sha256Hex(canonicalJson(historicalPackages)),
        packages: historicalPackages,
      }).packages[0]?.manifest,
    ).toEqual({
      schema: "convax.plugin/7",
      id: "p",
      version: "1.0.0",
    })
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: registry.packages.map((entry) =>
          entry.kind === "mcp-server"
            ? { ...entry, delivery: { ...entry.delivery, serverJsonSha256: "b".repeat(64) } }
            : entry,
        ),
      }),
    ).toThrow("canonical server.json")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            delivery: { ...artifact, url: `${artifact.url}?mutable=true` },
          },
        ],
      }),
    ).toThrow("query")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            delivery: {
              ...artifact,
              url: "https://github.com/acme/market/releases/download/latest/plugin.zip",
            },
          },
        ],
      }),
    ).toThrow("immutable")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            delivery: {
              ...artifact,
              url: "https://github.com:8443/acme/market/releases/download/v1/plugin.zip",
            },
          },
        ],
      }),
    ).toThrow("immutable")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            delivery: {
              ...artifact,
              url: "https://github.com/acme/market/releases/download/LATEST/plugin.zip",
            },
          },
        ],
      }),
    ).toThrow("immutable")
    expect(() =>
      parseRegistryV2({
        ...registry,
        packages: [
          {
            ...registry.packages[0],
            delivery: {
              ...artifact,
              url: "https://github.com/acme/market/releases/download/v1//plugin.zip",
            },
          },
        ],
      }),
    ).toThrow("immutable")
  })

  test("aggregates one display card without treating its representative as an install winner", () => {
    const group = aggregateCatalog([
      item("third", "plugin", "shared"),
      item("official", "plugin", "shared"),
      item("builtin", "plugin", "shared"),
    ])[0]
    expect(group?.representative.marketplaceId).toBe("builtin")
    expect(group?.representative).toMatchObject({
      catalogSequence: 1,
      catalogRevision: "a".repeat(64),
      runtimeSurface: "none",
    })
    expect(group?.requiresSourceSelection).toBe(true)
    expect(group?.sources).toHaveLength(3)
  })

  test("locks installed identity to exact source", () => {
    const installed = { kind: "plugin" as const, id: "p", sourceKey: "source:a" as never, version: "1" }
    expect(resolveInstallConflict(installed, { kind: "plugin", id: "p", sourceKey: "source:a" as never })).toBe(
      "same-source-update",
    )
    expect(resolveInstallConflict(installed, { kind: "plugin", id: "p", sourceKey: "source:b" as never })).toBe(
      "source-conflict",
    )
  })

  test("source mutation rejects rollback and same-version changed contracts", () => {
    const current = {
      sequence: 2,
      revision: "a".repeat(64),
      catalogDigest: "b".repeat(64),
      versionContracts: { "plugin\u0000p\u00001": "c".repeat(64) },
    }
    expect(() => decideSourceMutation(current, { ...current, sequence: 1 })).toThrow("rollback")
    expect(() =>
      decideSourceMutation(current, {
        sequence: 3,
        revision: "d".repeat(64),
        catalogDigest: "d".repeat(64),
        versionContracts: { "plugin\u0000p\u00001": "e".repeat(64) },
      }),
    ).toThrow("changed")
  })

  test("preserves source identity registration and re-add high-water semantics", () => {
    const sourceA = "a".repeat(64) as never
    const sourceB = "b".repeat(64) as never
    expect(resolveSourceRegistration(undefined, { marketplaceId: "same", sourceKey: sourceA })).toBe("add")
    expect(
      resolveSourceRegistration(
        { marketplaceId: "same", sourceKey: sourceA },
        { marketplaceId: "same", sourceKey: sourceA },
      ),
    ).toBe("no-op")
    expect(
      resolveSourceRegistration(
        { marketplaceId: "same", sourceKey: sourceA },
        { marketplaceId: "same", sourceKey: sourceB },
      ),
    ).toBe("identity-collision")
    const retained = {
      sequence: 10,
      revision: "a".repeat(64),
      catalogDigest: "c".repeat(64),
      versionContracts: {},
    }
    expect(() => decideSourceMutation(retained, { ...retained, sequence: 9 })).toThrow("rollback")
  })

  test("fails closed instead of pruning SourceSecurityState hard limits", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 16_385 }, (_, index) => [`plugin\u0000p${index}\u00001`, "d".repeat(64)]),
    )
    expect(() =>
      decideSourceMutation(undefined, {
        sequence: 1,
        revision: "a".repeat(64),
        catalogDigest: "e".repeat(64),
        versionContracts: tooMany,
      }),
    ).toThrow("limit")
    const tooLarge = Object.fromEntries(
      Array.from({ length: 16_384 }, (_, index) => [
        `plugin\u0000${String(index).padStart(6, "0")}${"x".repeat(450)}\u00001`,
        "f".repeat(64),
      ]),
    )
    expect(() =>
      decideSourceMutation(undefined, {
        sequence: 1,
        revision: "a".repeat(64),
        catalogDigest: "e".repeat(64),
        versionContracts: tooLarge,
      }),
    ).toThrow("byte")
  })

  test("uses sender-scoped HMAC selection tokens and rejects stale or changed payloads", () => {
    const secret = new Uint8Array(32).fill(7)
    const payload = {
      senderId: "renderer-1",
      expiresAt: 2_000,
      ref: { marketplaceId: "official", kind: "plugin" as const, id: "p" },
      sourceKey: "a".repeat(64) as never,
      catalogSequence: 2,
      catalogRevision: "a".repeat(64),
      version: "1.0.0",
      metadataDigest: "b".repeat(64),
      artifact: {
        url: "https://github.com/acme/market/releases/download/v1/p.zip",
        size: 10,
        sha256: "c".repeat(64),
      },
      companion: null,
    }
    const token = issueSelectionToken(payload, secret, 1_000)
    const verified = verifySelectionToken(token, { senderId: "renderer-1", now: 1_000 }, secret)
    expect(verified).toEqual(payload)
    expect(() => verifySelectionToken(token, { senderId: "renderer-2", now: 1_000 }, secret)).toThrow("sender")
    const [encoded, signature] = token.split(".")
    const changedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`
    expect(() =>
      verifySelectionToken(`${encoded}.${changedSignature}` as never, { senderId: "renderer-1", now: 1_000 }, secret),
    ).toThrow("signature")
    expect(() => issueSelectionToken({ ...payload, expiresAt: 1_000 + 5 * 60 * 1_000 + 1 }, secret, 1_000)).toThrow(
      "payload",
    )
    expect(() =>
      assertSelectionCurrent(verified, {
        ...payload,
        catalogRevision: "d".repeat(64),
      }),
    ).toThrow("stale")
  })

  test("pins exact reviewed server schema bytes and safe native keys", () => {
    expect(new Bun.CryptoHasher("sha256").update(OFFICIAL_SERVER_SCHEMA_BYTES).digest("hex")).toBe(
      OFFICIAL_SERVER_SCHEMA_SHA256,
    )
    expect(OFFICIAL_SERVER_SCHEMA_SHA256).toBe("3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0")
    expect(identityKeyForMcpServer("io.example/server")).toMatch(/^[0-9a-f]{64}$/)
    expect(versionKeyForMcpServer("io.example/server", "../CON:1.0.0 ")).toMatch(/^[0-9a-f]{64}$/)
  })

  test("accepts one fixed HTTPS HTTP entry and rejects mixed or ambiguous profiles", () => {
    const server = {
      $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
      name: "io.example/server",
      description: "Example",
      version: "1.0.0",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    }
    expect(parseServerPackage(server).runtime).toEqual({
      kind: "http-agent",
      endpoint: "https://example.com/mcp",
      transport: "streamable-http",
    })
    expect(() => parseServerPackage({ ...server, remotes: [...server.remotes, ...server.remotes] })).toThrow(
      "exactly one",
    )
    expect(() => parseServerPackage({ ...server, remotes: [] })).toThrow("exactly one")
    expect(() =>
      parseServerPackage({
        ...server,
        remotes: [{ type: "streamable-http", url: "https://example.com/{tenant}", variables: { tenant: {} } }],
      }),
    ).toThrow("exactly one")
    const unsupported = classifyServerPackageForCatalog({
      ...server,
      remotes: [{ type: "streamable-http", url: "https://example.com/{tenant}", variables: { tenant: {} } }],
    })
    expect(unsupported).toMatchObject({
      supported: false,
      id: "io.example/server",
      version: "1.0.0",
      reason: "no-supported-runtime",
    })
    const packageMetadata = {
      registryType: "npm",
      identifier: "@example/mcp",
      transport: { type: "stdio" },
    }
    const supportedWithMetadata = classifyServerPackageForCatalog({
      ...server,
      packages: [packageMetadata],
    })
    expect(supportedWithMetadata.supported).toBe(true)
    if (supportedWithMetadata.supported) {
      expect(supportedWithMetadata.package.definition.packages).toEqual([packageMetadata])
    }
    expect(() =>
      parseServerPackage({
        ...server,
        icons: [{ src: "https://example.com/icon.exe", mimeType: "application/x-msdownload" }],
      }),
    ).toThrow("official schema")
    expect(() =>
      parseServerPackage({
        ...server,
        remotes: [{ type: "streamable-http", url: "https://example.com/mcp", headers: [{ name: "X-Key" }] }],
      }),
    ).toThrow("exactly one")
    expect(() =>
      parseServerPackage(server, {
        schema: "convax.mcp-server-extension/1",
        runtime: {
          kind: "managed-stdio",
          command: "example-mcp",
          argv: [],
          compatibility: { targets: ["darwin-arm64"] },
        },
      }),
    ).toThrow("mixed")
  })

  test("strictly rejects unsafe managed commands and secret environment fields", () => {
    const server = { name: "io.example/local", description: "Local MCP", version: "1.0.0", packages: [] }
    const extension = (command: string, extra: Record<string, unknown> = {}) => ({
      schema: "convax.mcp-server-extension/1",
      runtime: {
        kind: "managed-stdio",
        command,
        argv: [],
        compatibility: { targets: ["darwin-arm64"] },
        ...extra,
      },
    })
    expect(() => parseServerPackage(server, extension("../server"))).toThrow("command")
    expect(() => parseServerPackage(server, extension("CON"))).toThrow("command")
    expect(() => parseServerPackage(server, extension("server", { environment: { TOKEN: "secret" } }))).toThrow(
      "unknown",
    )
    const managedExtension = extension("server")
    const managedPackage = {
      kind: "mcp-server",
      id: server.name,
      version: server.version,
      compatibility: { convax: ">=0.1.0" },
      presentation: { name: "Local MCP", description: "Local MCP" },
      delivery: {
        kind: "mcp-managed-stdio",
        serverJson: server,
        serverJsonSha256: sha256Hex(`${canonicalJson(server)}\n`),
        extension: managedExtension,
        extensionSha256: sha256Hex(`${canonicalJson(managedExtension)}\n`),
        companions: [
          {
            target: "darwin-arm64",
            command: "server",
            url: "https://github.com/acme/market/releases/download/mcp-server-a-v1.0.0/server",
            size: 10,
            sha256: "b".repeat(64),
          },
        ],
      },
    }
    const managedRegistry = {
      schema: "convax.registry/2",
      marketplaceId: "acme",
      sequence: 1,
      revision: sha256Hex(canonicalJson([managedPackage])),
      packages: [managedPackage],
    }
    expect(parseRegistryV2(managedRegistry).packages[0]?.delivery.kind).toBe("mcp-managed-stdio")
    expect(() =>
      parseRegistryV2({
        ...managedRegistry,
        packages: [
          {
            ...managedRegistry.packages[0],
            delivery: { ...managedRegistry.packages[0].delivery, extensionSha256: "c".repeat(64) },
          },
        ],
      }),
    ).toThrow("canonical extension")
  })

  test("enforces the declared GitHub Pages descriptor shape", () => {
    const descriptor = {
      schema: "convax.marketplace/1",
      id: "acme",
      name: "Acme",
      publisher: { name: "Acme" },
      repository: { owner: "acme", name: "market" },
      registry: { v2: { url: "https://evil.example/registry-v2.json" } },
      showcase: { v2: { url: "https://acme.github.io/market/showcase-v2.json" } },
      compatibility: { convax: ">=0.1.0" },
      delivery: { kind: "github-pages-releases" },
    }
    expect(() => parseMarketplaceDescriptor(descriptor)).toThrow("GitHub Pages")
  })

  test("strictly binds Showcase presentation assets to one Registry identity and revision", () => {
    const descriptor = parseMarketplaceDescriptor({
      schema: "convax.marketplace/1",
      id: "acme",
      name: "Acme",
      publisher: { name: "Acme" },
      repository: { owner: "acme", name: "market" },
      registry: { v2: { url: "https://acme.github.io/market/registry-v2.json" } },
      showcase: { v2: { url: "https://acme.github.io/market/showcase-v2.json" } },
      compatibility: { convax: ">=0.1.0" },
      delivery: { kind: "github-pages-releases" },
    })
    const showcaseRegistryPackages = [
      {
        kind: "skill",
        id: "storyboard",
        version: "1.0.0",
        compatibility: { convax: ">=0.1.0" },
        presentation: { name: "Storyboard", description: "Storyboard workflow" },
        delivery: artifact,
      },
    ]
    const registry = parseRegistryV2({
      schema: "convax.registry/2",
      marketplaceId: "acme",
      sequence: 1,
      revision: sha256Hex(canonicalJson(showcaseRegistryPackages)),
      packages: showcaseRegistryPackages,
    })
    const showcase = {
      schema: "convax.showcase/2",
      marketplaceId: "acme",
      revision: registry.revision,
      packages: [
        {
          kind: "skill",
          id: "storyboard",
          version: "1.0.0",
          presentation: {
            name: "Storyboard",
            description: "Storyboard workflow",
            poster: {
              url: `https://github.com/acme/market/releases/download/registry-v2-${registry.revision}/poster.png`,
              size: 10,
              sha256: "b".repeat(64),
              mime: "image/png",
            },
          },
        },
      ],
    }
    expect(parseShowcaseV2(showcase, registry, descriptor).packages).toHaveLength(1)
    expect(() =>
      parseShowcaseV2(
        {
          ...showcase,
          packages: [
            {
              ...showcase.packages[0],
              presentation: {
                ...showcase.packages[0].presentation,
                poster: {
                  ...showcase.packages[0].presentation.poster,
                  url: "https://github.com/acme/market/releases/download/registry-v2-wrong/poster.png",
                },
              },
            },
          ],
        },
        registry,
        descriptor,
      ),
    ).toThrow("Registry revision Release")
    expect(() => parseShowcaseV2({ ...showcase, revision: "c".repeat(64) }, registry, descriptor)).toThrow(
      "does not match",
    )
    expect(() =>
      parseShowcaseV2(
        {
          ...showcase,
          packages: [{ ...showcase.packages[0], version: "2.0.0" }],
        },
        registry,
        descriptor,
      ),
    ).toThrow("does not match")
    expect(() =>
      parseShowcaseV2(
        {
          ...showcase,
          packages: [
            {
              ...showcase.packages[0],
              presentation: { ...showcase.packages[0].presentation, internalPath: "/tmp/poster.png" },
            },
          ],
        },
        registry,
        descriptor,
      ),
    ).toThrow("unknown")
    expect(() =>
      parseShowcaseV2(
        {
          ...showcase,
          packages: [
            {
              ...showcase.packages[0],
              presentation: {
                ...showcase.packages[0].presentation,
                poster: {
                  ...showcase.packages[0].presentation.poster,
                  url: "https://github.com/evil/market/releases/download/registry-v2-a/poster.png",
                },
              },
            },
          ],
        },
        registry,
        descriptor,
      ),
    ).toThrow("declared repository")
  })

  test("binds the Builtin release id to the exact canonical member closure", () => {
    const members = [
      {
        kind: "skill" as const,
        id: "canvas-storyboard",
        version: "1.0.0",
        artifact: { path: "members/storyboard.zip", size: 1, sha256: "a".repeat(64) },
        presentation: {
          poster: {
            path: "presentation/storyboard.png",
            mime: "image/png",
            size: 1,
            sha256: "b".repeat(64),
          },
        },
      },
    ]
    const releaseId = sha256Hex(canonicalJson(members))
    expect(
      parseBuiltinBundle({
        schema: "convax.builtin-bundle/1",
        release: { id: releaseId },
        members,
      }).release.id,
    ).toBe(releaseId)
    expect(() =>
      parseBuiltinBundle({
        schema: "convax.builtin-bundle/1",
        release: { id: "c".repeat(64) },
        members,
      }),
    ).toThrow("canonical member content digest")
  })

  test("parses generic preinstall identities symmetrically and rejects Release path injection", () => {
    const lockedArtifact = (name: string, tag: string) => ({
      name,
      url: `https://github.com/microvoid/convax-plugins/releases/download/${tag}/${name}`,
      size: 10,
      sha256: "a".repeat(64),
    })
    const officialRevision = "b".repeat(64)
    const lockFor = (id: string) => {
      const policy = {
        builtin: { marketplaceId: "convax-builtin" as const, repository: "microvoid/convax-plugins" as const },
        official: {
          descriptorUrl: "https://microvoid.github.io/convax-plugins/marketplace.json",
          marketplaceId: "convax-official" as const,
          repository: "microvoid/convax-plugins" as const,
        },
        preinstalledPackages: [
          {
            marketplaceId: "convax-official",
            kind: "plugin",
            id,
            targets: ["darwin-arm64"],
            setup: "automatic",
          },
        ],
        revision: 1,
      } satisfies MarketplaceProductPolicy
      return {
        schema: "convax.marketplace-product-lock/1",
        policy,
        resolved: {
          policyDigest: canonicalProductPolicyDigest(policy),
          builtinBundle: lockedArtifact("convax-builtin-bundle.zip", `builtin-${"c".repeat(64)}`),
          builtinReservations: [
            { kind: "skill", id: "workflow-foundation" },
            { kind: "plugin", id: "headless-foundation" },
          ],
          official: {
            revision: officialRevision,
            descriptor: lockedArtifact("marketplace.json", `registry-v2-${officialRevision}`),
            registry: lockedArtifact("registry-v2.json", `registry-v2-${officialRevision}`),
            showcase: lockedArtifact("showcase-v2.json", `registry-v2-${officialRevision}`),
          },
          packages: [
            {
              marketplaceId: "convax-official",
              kind: "plugin",
              id,
              version: "0.3.1",
              setup: "explicit",
              artifact: lockedArtifact(`plugin-${id}-0.3.1.zip`, `plugin-${id}-v0.3.1`),
              ownedSkills: [lockedArtifact(`skill-${id}-workflow.zip`, `skill-${id}-workflow-v0.3.1`)],
              companions: [
                {
                  ...lockedArtifact(`${id}-companion`, `plugin-${id}-v0.3.1`),
                  platform: "darwin",
                  arch: "arm64",
                },
              ],
            },
          ],
        },
      }
    }
    const first = parseMarketplaceProductLock(lockFor("alpha-tools"))
    const unknown = parseMarketplaceProductLock(lockFor("unknown-extension"))
    const normalize = (value: ReturnType<typeof parseMarketplaceProductLock>) => ({
      policy: {
        ...value.policy,
        preinstalledPackages: value.policy.preinstalledPackages.map((entry) => ({ ...entry, id: "<plugin>" })),
      },
      resolved: {
        ...value.resolved,
        policyDigest: "<digest>",
        packages: value.resolved.packages.map((entry) => ({
          ...entry,
          id: "<plugin>",
          artifact: { ...entry.artifact, name: "<artifact>", url: "<artifact-url>" },
          ownedSkills: entry.ownedSkills.map((skill) => ({ ...skill, name: "<skill>", url: "<skill-url>" })),
          companions: entry.companions.map((companion) => ({
            ...companion,
            name: "<companion>",
            url: "<companion-url>",
          })),
        })),
      },
    })
    expect(first.resolved.packages[0]?.id).toBe("alpha-tools")
    expect(unknown.resolved.packages[0]?.id).toBe("unknown-extension")
    expect(normalize(first)).toEqual(normalize(unknown))

    const lock = lockFor("alpha-tools")
    expect(() =>
      parseMarketplaceProductLock({
        ...lock,
        policy: {
          ...lock.policy,
          preinstalledPackages: [
            ...lock.policy.preinstalledPackages,
            {
              marketplaceId: "convax-official",
              kind: "plugin",
              id: "alpha-tools",
              targets: ["linux-x64"],
              setup: "automatic",
            },
          ],
        },
      }),
    ).toThrow("identities")
    expect(() =>
      parseMarketplaceProductLock({
        ...lock,
        resolved: {
          ...lock.resolved,
          packages: [
            {
              ...lock.resolved.packages[0],
              companions: [
                {
                  ...lockedArtifact("linux-companion", "plugin-alpha-tools-v0.3.1"),
                  platform: "linux",
                  arch: "x64",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow("policy targets")
    expect(() =>
      parseMarketplaceProductLock({
        ...lock,
        resolved: {
          ...lock.resolved,
          builtinBundle: {
            ...lock.resolved.builtinBundle,
            url: `${lock.resolved.builtinBundle.url}/extra`,
          },
        },
      }),
    ).toThrow("immutable")
    expect(() =>
      parseMarketplaceProductLock({
        ...lock,
        resolved: {
          ...lock.resolved,
          builtinBundle: {
            ...lock.resolved.builtinBundle,
            url: lock.resolved.builtinBundle.url.replace("convax-builtin-bundle.zip", "convax-builtin%2Dbundle.zip"),
          },
        },
      }),
    ).toThrow("immutable")
    expect(() =>
      parseMarketplaceProductLock({
        ...lock,
        resolved: {
          ...lock.resolved,
          builtinBundle: {
            ...lock.resolved.builtinBundle,
            url: lock.resolved.builtinBundle.url.replace("/convax-builtin-bundle.zip", "//convax-builtin-bundle.zip"),
          },
        },
      }),
    ).toThrow("immutable")
  })
})
