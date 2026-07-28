import { canonicalJson, sha256Hex } from "./canonical"

export type MarketplaceArtifactLock = {
  name: string
  sha256: string
  size: number
  url: string
}

export type MarketplaceProductPolicy = {
  builtin: {
    marketplaceId: "convax-builtin"
    repository: "microvoid/convax-plugins"
  }
  official: {
    descriptorUrl: string
    marketplaceId: "convax-official"
    repository: "microvoid/convax-plugins"
  }
  preinstalledPackages: Array<{
    id: "ffmpeg-tools"
    kind: "plugin"
    marketplaceId: "convax-official"
    setup: "automatic"
    targets: ["darwin-arm64"]
  }>
  revision: number
}

export type MarketplaceProductLock = {
  policy: MarketplaceProductPolicy
  resolved: {
    builtinBundle: MarketplaceArtifactLock
    builtinReservations: Array<{
      id: string
      kind: "plugin" | "skill"
    }>
    official: {
      descriptor: MarketplaceArtifactLock
      registry: MarketplaceArtifactLock
      revision: string
      showcase: MarketplaceArtifactLock
    }
    packages: Array<{
      artifact: MarketplaceArtifactLock
      companions: Array<
        MarketplaceArtifactLock & {
          arch: string
          platform: string
        }
      >
      id: string
      kind: "plugin" | "skill" | "mcp-server"
      marketplaceId: string
      ownedSkills: MarketplaceArtifactLock[]
      setup: "explicit" | "none"
      version: string
    }>
    policyDigest: string
  }
  schema: "convax.marketplace-product-lock/1"
}

export function canonicalProductPolicyDigest(policy: MarketplaceProductPolicy): string {
  return sha256Hex(canonicalJson(policy))
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string) {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`${context} has unsupported or missing fields`)
  }
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${context} must be a non-empty string`)
  return value
}

function parseArtifact(
  value: unknown,
  context: string,
  options: { maxSize: number; expectedTag?: string },
): MarketplaceArtifactLock {
  const input = record(value, context)
  exactKeys(input, ["name", "sha256", "size", "url"], context)
  const name = nonEmptyString(input.name, `${context}.name`)
  const sha256 = nonEmptyString(input.sha256, `${context}.sha256`)
  const size = input.size
  const url = nonEmptyString(input.url, `${context}.url`)
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(size) ||
    Number(size) <= 0 ||
    Number(size) > options.maxSize
  ) {
    throw new Error(`${context} must declare an immutable size and SHA-256`)
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${context} must declare an immutable HTTPS URL`)
  }
  const segments = parsed.pathname.split("/").filter(Boolean)
  const releaseIndex = segments.indexOf("download")
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.pathname !== `/${segments.join("/")}` ||
    segments[0] !== "microvoid" ||
    segments[1] !== "convax-plugins" ||
    releaseIndex !== 3 ||
    segments.length !== 6 ||
    releaseIndex + 2 >= segments.length ||
    (options.expectedTag !== undefined && segments[releaseIndex + 1] !== options.expectedTag) ||
    segments[releaseIndex + 1] === "latest" ||
    segments.some((segment) => segment.toLowerCase() === "latest") ||
    segments.at(-1) !== name
  ) {
    throw new Error(`${context} must declare an immutable GitHub Release HTTPS URL`)
  }
  return { name, sha256, size: Number(size), url }
}

export function parseMarketplaceProductPolicy(value: unknown): MarketplaceProductPolicy {
  const input = record(value, "policy")
  exactKeys(input, ["builtin", "official", "preinstalledPackages", "revision"], "policy")
  const builtin = record(input.builtin, "policy.builtin")
  exactKeys(builtin, ["marketplaceId", "repository"], "policy.builtin")
  const official = record(input.official, "policy.official")
  exactKeys(official, ["descriptorUrl", "marketplaceId", "repository"], "policy.official")
  if (
    builtin.marketplaceId !== "convax-builtin" ||
    builtin.repository !== "microvoid/convax-plugins" ||
    official.marketplaceId !== "convax-official" ||
    official.repository !== "microvoid/convax-plugins" ||
    official.descriptorUrl !== "https://microvoid.github.io/convax-plugins/marketplace.json" ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 1
  ) {
    throw new Error("policy source declarations are not the approved product policy")
  }
  if (!Array.isArray(input.preinstalledPackages) || input.preinstalledPackages.length !== 1) {
    throw new Error("policy.preinstalledPackages must contain only ffmpeg-tools")
  }
  const entry = record(input.preinstalledPackages[0], "policy.preinstalledPackages[0]")
  exactKeys(entry, ["id", "kind", "marketplaceId", "setup", "targets"], "policy.preinstalledPackages[0]")
  if (
    entry.marketplaceId !== "convax-official" ||
    entry.kind !== "plugin" ||
    entry.id !== "ffmpeg-tools" ||
    entry.setup !== "automatic" ||
    !Array.isArray(entry.targets) ||
    entry.targets.length !== 1 ||
    entry.targets[0] !== "darwin-arm64"
  ) {
    throw new Error("policy.preinstalledPackages must be the approved darwin-arm64 ffmpeg-tools entry")
  }
  return {
    builtin: {
      marketplaceId: "convax-builtin",
      repository: "microvoid/convax-plugins",
    },
    official: {
      descriptorUrl: "https://microvoid.github.io/convax-plugins/marketplace.json",
      marketplaceId: "convax-official",
      repository: "microvoid/convax-plugins",
    },
    preinstalledPackages: [
      {
        id: "ffmpeg-tools",
        kind: "plugin",
        marketplaceId: "convax-official",
        setup: "automatic",
        targets: ["darwin-arm64"],
      },
    ],
    revision: Number(input.revision),
  }
}

export function parseMarketplaceProductLock(value: unknown): MarketplaceProductLock {
  const input = record(value, "marketplaces.lock.json")
  exactKeys(input, ["policy", "resolved", "schema"], "marketplaces.lock.json")
  if (input.schema !== "convax.marketplace-product-lock/1")
    throw new Error("unsupported Marketplace product lock schema")
  const policy = parseMarketplaceProductPolicy(input.policy)
  const resolved = record(input.resolved, "resolved")
  exactKeys(resolved, ["builtinBundle", "builtinReservations", "official", "packages", "policyDigest"], "resolved")
  const policyDigest = nonEmptyString(resolved.policyDigest, "resolved.policyDigest")
  if (policyDigest !== canonicalProductPolicyDigest(policy)) {
    throw new Error("resolved.policyDigest does not match policy; run the explicit lock refresh")
  }
  const official = record(resolved.official, "resolved.official")
  exactKeys(official, ["descriptor", "registry", "revision", "showcase"], "resolved.official")
  if (!Array.isArray(resolved.builtinReservations) || resolved.builtinReservations.length !== 1) {
    throw new Error("resolved.builtinReservations must exactly contain canvas-storyboard")
  }
  const reservation = record(resolved.builtinReservations[0], "resolved.builtinReservations[0]")
  exactKeys(reservation, ["id", "kind"], "resolved.builtinReservations[0]")
  if (reservation.kind !== "skill" || reservation.id !== "canvas-storyboard") {
    throw new Error("resolved.builtinReservations must exactly contain skill/canvas-storyboard")
  }
  const builtinReservations: MarketplaceProductLock["resolved"]["builtinReservations"] = [
    { kind: "skill", id: "canvas-storyboard" },
  ]
  if (!Array.isArray(resolved.packages) || resolved.packages.length !== 1) {
    throw new Error("resolved.packages must exactly close policy.preinstalledPackages")
  }
  const packageInput = record(resolved.packages[0], "resolved.packages[0]")
  exactKeys(
    packageInput,
    ["artifact", "companions", "id", "kind", "marketplaceId", "ownedSkills", "setup", "version"],
    "resolved.packages[0]",
  )
  if (
    packageInput.marketplaceId !== "convax-official" ||
    packageInput.kind !== "plugin" ||
    packageInput.id !== "ffmpeg-tools" ||
    packageInput.setup !== "explicit" ||
    !Array.isArray(packageInput.companions) ||
    !Array.isArray(packageInput.ownedSkills)
  ) {
    throw new Error("resolved package does not match policy.preinstalledPackages")
  }
  if (
    typeof packageInput.version !== "string" ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      packageInput.version,
    )
  ) {
    throw new Error("resolved ffmpeg-tools version must be SemVer")
  }
  const companions = packageInput.companions.map((value, index) => {
    const companion = record(value, `resolved.packages[0].companions[${index}]`)
    exactKeys(companion, ["arch", "name", "platform", "sha256", "size", "url"], `resolved companion ${index}`)
    const parsed = parseArtifact(
      {
        name: companion.name,
        sha256: companion.sha256,
        size: companion.size,
        url: companion.url,
      },
      `resolved.packages[0].companions[${index}]`,
      {
        maxSize: 128 * 1024 * 1024,
        expectedTag: `plugin-ffmpeg-tools-v${String(packageInput.version)}`,
      },
    )
    return {
      ...parsed,
      arch: nonEmptyString(companion.arch, "companion.arch"),
      platform: nonEmptyString(companion.platform, "companion.platform"),
    }
  })
  if (companions.length !== 1 || companions[0].platform !== "darwin" || companions[0].arch !== "arm64") {
    throw new Error("resolved ffmpeg-tools requires exactly one darwin-arm64 companion")
  }
  if (packageInput.ownedSkills.length !== 1) {
    throw new Error("resolved ffmpeg-tools must lock its exact owned Skill closure")
  }
  return {
    policy,
    resolved: {
      builtinBundle: parseArtifact(resolved.builtinBundle, "resolved.builtinBundle", {
        maxSize: 128 * 1024 * 1024,
      }),
      builtinReservations,
      official: {
        descriptor: parseArtifact(official.descriptor, "resolved.official.descriptor", {
          maxSize: 1024 * 1024,
          expectedTag: `registry-v2-${String(official.revision)}`,
        }),
        registry: parseArtifact(official.registry, "resolved.official.registry", {
          maxSize: 8 * 1024 * 1024,
          expectedTag: `registry-v2-${String(official.revision)}`,
        }),
        revision: (() => {
          const revision = nonEmptyString(official.revision, "resolved.official.revision")
          if (!/^[a-f0-9]{64}$/.test(revision))
            throw new Error("resolved.official.revision must be a 64-character lowercase content SHA-256")
          return revision
        })(),
        showcase: parseArtifact(official.showcase, "resolved.official.showcase", {
          maxSize: 8 * 1024 * 1024,
          expectedTag: `registry-v2-${String(official.revision)}`,
        }),
      },
      packages: [
        {
          artifact: parseArtifact(packageInput.artifact, "resolved.packages[0].artifact", {
            maxSize: 10 * 1024 * 1024,
            expectedTag: `plugin-ffmpeg-tools-v${String(packageInput.version)}`,
          }),
          companions,
          id: "ffmpeg-tools",
          kind: "plugin",
          marketplaceId: "convax-official",
          ownedSkills: packageInput.ownedSkills.map((entry, index) =>
            parseArtifact(entry, `resolved.packages[0].ownedSkills[${index}]`, {
              maxSize: 10 * 1024 * 1024,
              expectedTag: `skill-ffmpeg-canvas-v${String(packageInput.version)}`,
            }),
          ),
          setup: "explicit",
          version: nonEmptyString(packageInput.version, "resolved.packages[0].version"),
        },
      ],
      policyDigest,
    },
    schema: "convax.marketplace-product-lock/1",
  }
}
