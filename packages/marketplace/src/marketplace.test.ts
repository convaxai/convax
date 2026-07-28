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
  parseRegistryV1,
  parseRegistryV2,
  parseShowcaseV2,
  parseServerPackage,
  projectRegistryV1,
  issueSelectionToken,
  verifySelectionToken,
  resolveSourceRegistration,
  resolveInstallConflict,
  sha256Hex,
  versionKeyForMcpServer,
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

  test("rejects duplicate registry identities and excludes MCP from strict v1 projection", () => {
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
      manifest: { schema: "convax.plugin/4", id: "p", version: "1.0.0" },
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
    const v1 = projectRegistryV1(parsed, "c".repeat(40))
    expect(v1.packages.map((entry) => entry.kind)).toEqual(["plugin"])
    expect(v1).not.toHaveProperty("marketplaceId")
    expect(v1.packages[0]).toMatchObject({ name: "P", description: "Plugin P", yanked: false })
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

  test("enforces declared GitHub Pages descriptor shape and exact v1 wire", () => {
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
    const v1 = {
      schema: "convax.registry/1" as const,
      sequence: 1,
      revision: "a".repeat(40),
      packages: [
        {
          kind: "skill",
          id: "storyboard",
          name: "Storyboard",
          description: "Storyboard workflow",
          version: "1.0.0",
          compatibility: { skillSchema: "opencode.skill/1" },
          artifact: {
            url: "https://github.com/microvoid/convax-plugins/releases/download/v1/storyboard.zip",
            size: 10,
            sha256: "b".repeat(64),
          },
          yanked: false,
        },
      ],
    }
    expect(canonicalJson(parseRegistryV1(v1))).toBe(canonicalJson(v1))
    expect(() => parseRegistryV1({ ...v1, marketplaceId: "forbidden" })).toThrow("unknown")
    expect(() => parseRegistryV1({ ...v1, packages: [{ ...v1.packages[0], kind: "mcp-server" }] })).toThrow("only")
    expect(() =>
      parseRegistryV1({
        ...v1,
        packages: [
          {
            ...v1.packages[0],
            artifact: {
              ...v1.packages[0].artifact,
              url: "https://github.com/microvoid/convax-plugins/releases/download/latest/storyboard.zip",
            },
          },
        ],
      }),
    ).toThrow("immutable")
    const companionTarget = {
      platform: "darwin" as const,
      arch: "arm64" as const,
      artifact: {
        url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-tools-v1.0.0/tool",
        size: 10,
        sha256: "c".repeat(64),
      },
    }
    const pluginWithCompanions = {
      kind: "plugin" as const,
      id: "tools",
      name: "Tools",
      description: "Tools plugin",
      version: "1.0.0",
      compatibility: { pluginSchema: "convax.plugin/4", pluginHost: "convax.plugin-host/4" },
      artifact: {
        url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-tools-v1.0.0/tools.zip",
        size: 10,
        sha256: "d".repeat(64),
      },
      yanked: false,
      manifest: { schema: "convax.plugin/4", id: "tools", version: "1.0.0" },
      companions: [
        {
          command: "convax-tools",
          version: "1.0.0",
          targets: [companionTarget, companionTarget],
        },
      ],
    }
    expect(() => parseRegistryV1({ ...v1, packages: [pluginWithCompanions] })).toThrow("duplicate")
    expect(() =>
      parseRegistryV1({
        ...v1,
        packages: [
          {
            ...pluginWithCompanions,
            companions: [
              { ...pluginWithCompanions.companions[0], targets: [companionTarget] },
              { ...pluginWithCompanions.companions[0], targets: [companionTarget] },
            ],
          },
        ],
      }),
    ).toThrow("duplicate")
  })

  test("losslessly projects current v6/v7 Plugin compatibility without dropping identities", () => {
    const packages = (["6", "7"] as const).map((version) => ({
      kind: "plugin" as const,
      id: `plugin-v${version}`,
      version: "1.0.0",
      compatibility: { convax: ">=0.1.0" },
      presentation: { name: `Plugin V${version}`, description: `Plugin schema V${version}` },
      delivery: {
        kind: "artifact" as const,
        url: `https://github.com/microvoid/convax-plugins/releases/download/plugin-plugin-v${version}-v1.0.0/plugin-plugin-v${version}-1.0.0.zip`,
        size: 10,
        sha256: version.repeat(64),
      },
      yanked: false,
      manifest: { schema: `convax.plugin/${version}`, id: `plugin-v${version}`, version: "1.0.0" },
    }))
    const v1 = projectRegistryV1(
      {
        schema: "convax.registry/2",
        marketplaceId: "convax-official",
        sequence: 45,
        revision: "a".repeat(64),
        packages,
      },
      "b".repeat(40),
    )
    expect(v1.packages.map(({ id }) => id)).toEqual(["plugin-v6", "plugin-v7"])
    expect(v1.packages.map((entry) => entry.kind === "plugin" && entry.compatibility.pluginHost)).toEqual([
      "convax.plugin-capability/1",
      "convax.plugin-capability/2",
    ])
  })

  test("v1 projection is identity-lossless for Plugin and Skill and fails closed for unrepresentable entries", () => {
    const plugin = {
      kind: "plugin" as const,
      id: "plugin",
      version: "1.0.0",
      compatibility: { convax: ">=0.1.0" },
      presentation: { name: "Plugin", description: "Plugin description" },
      delivery: {
        ...artifact,
        url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-plugin-v1.0.0/plugin-plugin-1.0.0.zip",
      },
      manifest: { schema: "convax.plugin/7", id: "plugin", version: "1.0.0" },
    }
    const skill = {
      kind: "skill" as const,
      id: "skill",
      version: "1.0.0",
      compatibility: { convax: ">=0.1.0" },
      presentation: { name: "Skill", description: "Skill description" },
      delivery: {
        ...artifact,
        url: "https://github.com/microvoid/convax-plugins/releases/download/skill-skill-v1.0.0/skill-skill-1.0.0.zip",
      },
    }
    const mcpServer = {
      name: "io.example/server",
      description: "MCP description",
      version: "1.0.0",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    }
    const mcp = {
      kind: "mcp-server" as const,
      id: "io.example/server",
      version: "1.0.0",
      compatibility: { convax: ">=0.1.0" },
      presentation: { name: "MCP", description: "MCP description" },
      delivery: {
        kind: "mcp-http" as const,
        serverJson: mcpServer,
        serverJsonSha256: sha256Hex(`${canonicalJson(mcpServer)}\n`),
        runtime: { endpoint: "https://example.com/mcp", transport: "streamable-http" as const },
      },
    }
    const identityPackages = [plugin, skill, mcp]
    const registry = parseRegistryV2({
      schema: "convax.registry/2",
      marketplaceId: "official",
      sequence: 1,
      revision: sha256Hex(canonicalJson(identityPackages)),
      packages: identityPackages,
    })
    const v1 = projectRegistryV1(registry, "f".repeat(40))
    const expected = registry.packages
      .filter(({ kind }) => kind !== "mcp-server")
      .map(({ kind, id }) => `${kind}\0${id}`)
      .sort()
    expect(v1.packages.map(({ kind, id }) => `${kind}\0${id}`).sort()).toEqual(expected)
    expect(() =>
      projectRegistryV1({ ...registry, packages: [{ ...plugin, manifest: undefined }] }, "f".repeat(40)),
    ).toThrow("requires manifest")
    expect(() =>
      projectRegistryV1(
        {
          ...registry,
          packages: [{ ...plugin, manifest: { schema: "convax.plugin/999", id: "plugin", version: "1.0.0" } }],
        },
        "f".repeat(40),
      ),
    ).toThrow("does not support schema")
    expect(() => projectRegistryV1(registry, "e".repeat(64))).toThrow("source Git revision")
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

  test("rejects product-lock Release path and encoded-basename injection", () => {
    const policy = {
      builtin: { marketplaceId: "convax-builtin" as const, repository: "microvoid/convax-plugins" as const },
      official: {
        descriptorUrl: "https://microvoid.github.io/convax-plugins/marketplace.json",
        marketplaceId: "convax-official" as const,
        repository: "microvoid/convax-plugins" as const,
      },
      preinstalledPackages: [
        {
          marketplaceId: "convax-official" as const,
          kind: "plugin" as const,
          id: "ffmpeg-tools" as const,
          targets: ["darwin-arm64"] as ["darwin-arm64"],
          setup: "automatic" as const,
        },
      ],
      revision: 1,
    }
    const lockedArtifact = (name: string, tag: string) => ({
      name,
      url: `https://github.com/microvoid/convax-plugins/releases/download/${tag}/${name}`,
      size: 10,
      sha256: "a".repeat(64),
    })
    const officialRevision = "b".repeat(64)
    const lock = {
      schema: "convax.marketplace-product-lock/1",
      policy,
      resolved: {
        policyDigest: canonicalProductPolicyDigest(policy),
        builtinBundle: lockedArtifact("convax-builtin-bundle.zip", `builtin-${"c".repeat(64)}`),
        builtinReservations: [{ kind: "skill", id: "canvas-storyboard" }],
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
            id: "ffmpeg-tools",
            version: "0.3.1",
            setup: "explicit",
            artifact: lockedArtifact("plugin-ffmpeg-tools-0.3.1.zip", "plugin-ffmpeg-tools-v0.3.1"),
            ownedSkills: [lockedArtifact("skill-ffmpeg-canvas-0.3.1.zip", "skill-ffmpeg-canvas-v0.3.1")],
            companions: [
              {
                ...lockedArtifact("ffmpeg-tools", "plugin-ffmpeg-tools-v0.3.1"),
                platform: "darwin",
                arch: "arm64",
              },
            ],
          },
        ],
      },
    }
    expect(parseMarketplaceProductLock(lock).resolved.packages[0]?.id).toBe("ffmpeg-tools")
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
