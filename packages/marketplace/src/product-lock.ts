import { canonicalJson, sha256Hex } from "./canonical"

export type MarketplaceArtifactLock = {
  name: string
  sha256: string
  size: number
  url: string
}

export type MarketplacePreinstalledPackagePolicy = {
  id: string
  kind: "plugin"
  marketplaceId: "convax-official"
  setup: "automatic"
  targets: Array<`${"darwin" | "linux" | "win32"}-${"arm64" | "x64"}`>
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
  preinstalledPackages: MarketplacePreinstalledPackagePolicy[]
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
          arch: "arm64" | "x64"
          platform: "darwin" | "linux" | "win32"
        }
      >
      id: string
      kind: "plugin"
      marketplaceId: "convax-official"
      ownedSkills: MarketplaceArtifactLock[]
      setup: "explicit"
      version: string
    }>
    policyDigest: string
  }
  schema: "convax.marketplace-product-lock/1"
}

const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const TARGET = /^(darwin|linux|win32)-(arm64|x64)$/
const MAX_PREINSTALLED_PACKAGES = 64
const MAX_PACKAGE_CLOSURE = 64

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

function parseTarget(value: unknown, context: string): MarketplacePreinstalledPackagePolicy["targets"][number] {
  if (typeof value !== "string" || !TARGET.test(value)) {
    throw new Error(`${context} must be a supported platform-architecture target`)
  }
  return value as MarketplacePreinstalledPackagePolicy["targets"][number]
}

function parsePreinstalledPolicy(value: unknown, context: string): MarketplacePreinstalledPackagePolicy {
  const entry = record(value, context)
  exactKeys(entry, ["id", "kind", "marketplaceId", "setup", "targets"], context)
  const id = nonEmptyString(entry.id, `${context}.id`)
  if (
    !PACKAGE_ID.test(id) ||
    entry.marketplaceId !== "convax-official" ||
    entry.kind !== "plugin" ||
    entry.setup !== "automatic" ||
    !Array.isArray(entry.targets) ||
    entry.targets.length > 6
  ) {
    throw new Error(`${context} is not a valid generic automatic Plugin declaration`)
  }
  const targets = entry.targets.map((target, index) => parseTarget(target, `${context}.targets[${index}]`))
  if (new Set(targets).size !== targets.length) {
    throw new Error(`${context}.targets must be unique`)
  }
  return {
    id,
    kind: "plugin",
    marketplaceId: "convax-official",
    setup: "automatic",
    targets,
  }
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
  if (!Array.isArray(input.preinstalledPackages) || input.preinstalledPackages.length > MAX_PREINSTALLED_PACKAGES) {
    throw new Error("policy.preinstalledPackages must be a bounded array")
  }
  const preinstalledPackages = input.preinstalledPackages.map((entry, index) =>
    parsePreinstalledPolicy(entry, `policy.preinstalledPackages[${index}]`),
  )
  const identities = preinstalledPackages.map((entry) => `${entry.marketplaceId}\0${entry.kind}\0${entry.id}`)
  if (new Set(identities).size !== identities.length) {
    throw new Error("policy.preinstalledPackages identities must be unique")
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
    preinstalledPackages,
    revision: Number(input.revision),
  }
}

function parseBuiltinReservations(value: unknown): MarketplaceProductLock["resolved"]["builtinReservations"] {
  if (!Array.isArray(value) || value.length > MAX_PACKAGE_CLOSURE) {
    throw new Error("resolved.builtinReservations must be a bounded array")
  }
  const reservations = value.map((candidate, index) => {
    const entry = record(candidate, `resolved.builtinReservations[${index}]`)
    exactKeys(entry, ["id", "kind"], `resolved.builtinReservations[${index}]`)
    const id = nonEmptyString(entry.id, `resolved.builtinReservations[${index}].id`)
    if (!PACKAGE_ID.test(id) || (entry.kind !== "plugin" && entry.kind !== "skill")) {
      throw new Error(`resolved.builtinReservations[${index}] is invalid`)
    }
    const kind: "plugin" | "skill" = entry.kind
    return { id, kind }
  })
  const identities = reservations.map((entry) => `${entry.kind}\0${entry.id}`)
  if (new Set(identities).size !== identities.length) {
    throw new Error("resolved.builtinReservations identities must be unique")
  }
  return reservations
}

function parseResolvedPackage(
  value: unknown,
  index: number,
  policyEntry: MarketplacePreinstalledPackagePolicy,
): MarketplaceProductLock["resolved"]["packages"][number] {
  const context = `resolved.packages[${index}]`
  const input = record(value, context)
  exactKeys(
    input,
    ["artifact", "companions", "id", "kind", "marketplaceId", "ownedSkills", "setup", "version"],
    context,
  )
  if (
    input.marketplaceId !== policyEntry.marketplaceId ||
    input.kind !== policyEntry.kind ||
    input.id !== policyEntry.id ||
    input.setup !== "explicit" ||
    !Array.isArray(input.companions) ||
    input.companions.length > MAX_PACKAGE_CLOSURE ||
    !Array.isArray(input.ownedSkills) ||
    input.ownedSkills.length > MAX_PACKAGE_CLOSURE
  ) {
    throw new Error(`${context} does not match policy.preinstalledPackages`)
  }
  const version = nonEmptyString(input.version, `${context}.version`)
  if (!SEMVER.test(version)) {
    throw new Error(`${context}.version must be SemVer`)
  }
  const releaseTag = `plugin-${policyEntry.id}-v${version}`
  const companions = input.companions.map((value, companionIndex) => {
    const companionContext = `${context}.companions[${companionIndex}]`
    const companion = record(value, companionContext)
    exactKeys(companion, ["arch", "name", "platform", "sha256", "size", "url"], companionContext)
    if (
      (companion.platform !== "darwin" && companion.platform !== "linux" && companion.platform !== "win32") ||
      (companion.arch !== "arm64" && companion.arch !== "x64")
    ) {
      throw new Error(`${companionContext} has an unsupported target`)
    }
    const platform: "darwin" | "linux" | "win32" = companion.platform
    const arch: "arm64" | "x64" = companion.arch
    return {
      ...parseArtifact(
        {
          name: companion.name,
          sha256: companion.sha256,
          size: companion.size,
          url: companion.url,
        },
        companionContext,
        { maxSize: 128 * 1024 * 1024, expectedTag: releaseTag },
      ),
      arch,
      platform,
    }
  })
  const companionTargets = companions.map(({ platform, arch }) => `${platform}-${arch}`)
  if (
    new Set(companionTargets).size !== companionTargets.length ||
    canonicalJson([...companionTargets].sort()) !== canonicalJson([...policyEntry.targets].sort())
  ) {
    throw new Error(`${context}.companions must exactly close the declared policy targets`)
  }
  const ownedSkills = input.ownedSkills.map((entry, skillIndex) =>
    parseArtifact(entry, `${context}.ownedSkills[${skillIndex}]`, {
      maxSize: 10 * 1024 * 1024,
    }),
  )
  if (new Set(ownedSkills.map(({ url }) => url)).size !== ownedSkills.length) {
    throw new Error(`${context}.ownedSkills must be unique`)
  }
  return {
    artifact: parseArtifact(input.artifact, `${context}.artifact`, {
      maxSize: 10 * 1024 * 1024,
      expectedTag: releaseTag,
    }),
    companions,
    id: policyEntry.id,
    kind: "plugin",
    marketplaceId: "convax-official",
    ownedSkills,
    setup: "explicit",
    version,
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
  const revision = nonEmptyString(official.revision, "resolved.official.revision")
  if (!/^[a-f0-9]{64}$/.test(revision)) {
    throw new Error("resolved.official.revision must be a 64-character lowercase content SHA-256")
  }
  const builtinReservations = parseBuiltinReservations(resolved.builtinReservations)
  if (!Array.isArray(resolved.packages) || resolved.packages.length !== policy.preinstalledPackages.length) {
    throw new Error("resolved.packages must exactly close policy.preinstalledPackages")
  }
  const resolvedByIdentity = new Map<string, { value: unknown; index: number }>()
  resolved.packages.forEach((entry, index) => {
    const candidate = record(entry, `resolved.packages[${index}]`)
    const identity = `${String(candidate.marketplaceId)}\0${String(candidate.kind)}\0${String(candidate.id)}`
    if (resolvedByIdentity.has(identity)) throw new Error("resolved.packages identities must be unique")
    resolvedByIdentity.set(identity, { value: entry, index })
  })
  const packages = policy.preinstalledPackages.map((policyEntry) => {
    const identity = `${policyEntry.marketplaceId}\0${policyEntry.kind}\0${policyEntry.id}`
    const selected = resolvedByIdentity.get(identity)
    if (!selected) throw new Error("resolved.packages must exactly close policy.preinstalledPackages")
    return parseResolvedPackage(selected.value, selected.index, policyEntry)
  })
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
          expectedTag: `registry-v2-${revision}`,
        }),
        registry: parseArtifact(official.registry, "resolved.official.registry", {
          maxSize: 8 * 1024 * 1024,
          expectedTag: `registry-v2-${revision}`,
        }),
        revision,
        showcase: parseArtifact(official.showcase, "resolved.official.showcase", {
          maxSize: 8 * 1024 * 1024,
          expectedTag: `registry-v2-${revision}`,
        }),
      },
      packages,
      policyDigest,
    },
    schema: "convax.marketplace-product-lock/1",
  }
}
