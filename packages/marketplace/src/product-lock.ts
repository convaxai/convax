import { canonicalJson, sha256Hex } from "./canonical"

export type MarketplaceArtifactLock = {
  name: string
  sha256: string
  size: number
  url: string
}

export type MarketplaceProductTarget = `${"darwin" | "linux" | "win32"}-${"arm64" | "x64"}`

export type MarketplaceProductPackagePurpose = "default-install" | "retired-recovery"

export type MarketplaceRetiredPluginBinding = {
  artifact: {
    sha256: string
    size: number
  }
  hostApiMajor: number
  snapshotDigest: string
  sourceKey: string
  version: string
}

type MarketplacePackagedPackagePolicyBase = {
  id: string
  marketplaceId: "convax-official"
  targets: MarketplaceProductTarget[]
}

export type MarketplacePackagedPackagePolicy =
  | (MarketplacePackagedPackagePolicyBase & {
      kind: "skill"
      purposes: ["default-install"]
    })
  | (MarketplacePackagedPackagePolicyBase & {
      kind: "plugin"
      purposes: ["default-install"]
    })
  | (MarketplacePackagedPackagePolicyBase & {
      kind: "plugin"
      purposes: ["retired-recovery"] | ["default-install", "retired-recovery"]
      retired: MarketplaceRetiredPluginBinding
      version: string
    })

export type MarketplaceProductPolicy = {
  builtin: {
    marketplaceId: "convax-builtin"
    repository: "convaxai/convax-plugins"
  }
  official: {
    descriptorUrl: string
    marketplaceId: "convax-official"
    repository: "convaxai/convax-plugins"
  }
  packages: MarketplacePackagedPackagePolicy[]
  revision: number
}

type MarketplaceLockedPackageBase = {
  artifact: MarketplaceArtifactLock
  id: string
  marketplaceId: "convax-official"
  targets: MarketplaceProductTarget[]
  version: string
}

type MarketplaceLockedPluginPackageBase = MarketplaceLockedPackageBase & {
  companions: Array<
    MarketplaceArtifactLock & {
      arch: "arm64" | "x64"
      platform: "darwin" | "linux" | "win32"
    }
  >
  kind: "plugin"
  ownedSkills: MarketplaceArtifactLock[]
}

export type MarketplaceLockedPluginPackage =
  | (MarketplaceLockedPluginPackageBase & {
      purposes: ["default-install"]
    })
  | (MarketplaceLockedPluginPackageBase & {
      purposes: ["retired-recovery"] | ["default-install", "retired-recovery"]
      retired: MarketplaceRetiredPluginBinding
    })

export type MarketplaceLockedStandaloneSkillPackage = MarketplaceLockedPackageBase & {
  kind: "skill"
  purposes: ["default-install"]
}

export type MarketplaceLockedPackage = MarketplaceLockedPluginPackage | MarketplaceLockedStandaloneSkillPackage

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
    packages: MarketplaceLockedPackage[]
    policyDigest: string
  }
  schema: "convax.marketplace-product-lock/3"
}

const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const TARGET = /^(darwin|linux|win32)-(arm64|x64)$/
const MAX_PACKAGED_PACKAGES = 64
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
    segments[0] !== "convaxai" ||
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

function parseTarget(value: unknown, context: string): MarketplaceProductTarget {
  if (typeof value !== "string" || !TARGET.test(value)) {
    throw new Error(`${context} must be a supported platform-architecture target`)
  }
  return value as MarketplaceProductTarget
}

function parseTargets(value: unknown, context: string) {
  if (!Array.isArray(value) || value.length > 6) {
    throw new Error(`${context} must be a bounded array`)
  }
  const targets = value.map((target, index) => parseTarget(target, `${context}[${index}]`))
  if (new Set(targets).size !== targets.length) {
    throw new Error(`${context} must be unique`)
  }
  if (canonicalJson(targets) !== canonicalJson([...targets].sort())) {
    throw new Error(`${context} must be in canonical order`)
  }
  return targets
}

function parsePurposes(
  value: unknown,
  context: string,
): ["default-install"] | ["retired-recovery"] | ["default-install", "retired-recovery"] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be a canonical, non-empty purpose array`)
  }
  if (canonicalJson(value) === canonicalJson(["default-install"])) return ["default-install"]
  if (canonicalJson(value) === canonicalJson(["retired-recovery"])) return ["retired-recovery"]
  if (canonicalJson(value) === canonicalJson(["default-install", "retired-recovery"])) {
    return ["default-install", "retired-recovery"]
  }
  throw new Error(`${context} must contain unique purposes in canonical order`)
}

function parsePackagedPackagePolicy(value: unknown, context: string): MarketplacePackagedPackagePolicy {
  const entry = record(value, context)
  const id = nonEmptyString(entry.id, `${context}.id`)
  const purposes = parsePurposes(entry.purposes, `${context}.purposes`)
  if (!PACKAGE_ID.test(id) || entry.marketplaceId !== "convax-official") {
    throw new Error(`${context} is not a valid Official packaged package declaration`)
  }
  const targets = parseTargets(entry.targets, `${context}.targets`)

  if (entry.kind === "skill") {
    exactKeys(entry, ["id", "kind", "marketplaceId", "purposes", "targets"], context)
    if (canonicalJson(purposes) !== canonicalJson(["default-install"]) || targets.length !== 0) {
      throw new Error(`${context} standalone Skill must be portable and may only declare default-install`)
    }
    return {
      id,
      kind: "skill",
      marketplaceId: "convax-official",
      purposes: ["default-install"],
      targets,
    }
  }
  if (entry.kind !== "plugin") {
    throw new Error(`${context}.kind must be plugin or skill`)
  }
  if (!purposes.some((purpose) => purpose === "retired-recovery")) {
    exactKeys(entry, ["id", "kind", "marketplaceId", "purposes", "targets"], context)
    return {
      id,
      kind: "plugin",
      marketplaceId: "convax-official",
      purposes: ["default-install"],
      targets,
    }
  }
  exactKeys(entry, ["id", "kind", "marketplaceId", "purposes", "retired", "targets", "version"], context)
  const version = nonEmptyString(entry.version, `${context}.version`)
  if (!SEMVER.test(version)) {
    throw new Error(`${context}.version must be SemVer`)
  }
  return {
    id,
    kind: "plugin",
    marketplaceId: "convax-official",
    purposes: purposes.length === 1 ? ["retired-recovery"] : ["default-install", "retired-recovery"],
    retired: parseRetiredPluginBinding(entry.retired, `${context}.retired`),
    targets,
    version,
  }
}

function parseRetiredPluginBinding(value: unknown, context: string): MarketplaceRetiredPluginBinding {
  const input = record(value, context)
  exactKeys(input, ["artifact", "hostApiMajor", "snapshotDigest", "sourceKey", "version"], context)
  const artifact = record(input.artifact, `${context}.artifact`)
  exactKeys(artifact, ["sha256", "size"], `${context}.artifact`)
  const sha256 = nonEmptyString(artifact.sha256, `${context}.artifact.sha256`)
  const snapshotDigest = nonEmptyString(input.snapshotDigest, `${context}.snapshotDigest`)
  const sourceKey = nonEmptyString(input.sourceKey, `${context}.sourceKey`)
  const version = nonEmptyString(input.version, `${context}.version`)
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    Number(artifact.size) < 1 ||
    Number(artifact.size) > 10 * 1024 * 1024 ||
    !Number.isSafeInteger(input.hostApiMajor) ||
    Number(input.hostApiMajor) < 1 ||
    Number(input.hostApiMajor) > 65_535 ||
    !/^[a-f0-9]{64}$/.test(snapshotDigest) ||
    !/^[a-f0-9]{64}$/.test(sourceKey) ||
    !SEMVER.test(version)
  ) {
    throw new Error(
      `${context} must bind one exact retired Plugin archive, snapshot, source, version, and Host API major`,
    )
  }
  return {
    artifact: { sha256, size: Number(artifact.size) },
    hostApiMajor: Number(input.hostApiMajor),
    snapshotDigest,
    sourceKey,
    version,
  }
}

export function parseMarketplaceProductPolicy(value: unknown): MarketplaceProductPolicy {
  const input = record(value, "policy")
  exactKeys(input, ["builtin", "official", "packages", "revision"], "policy")
  const builtin = record(input.builtin, "policy.builtin")
  exactKeys(builtin, ["marketplaceId", "repository"], "policy.builtin")
  const official = record(input.official, "policy.official")
  exactKeys(official, ["descriptorUrl", "marketplaceId", "repository"], "policy.official")
  if (
    builtin.marketplaceId !== "convax-builtin" ||
    builtin.repository !== "convaxai/convax-plugins" ||
    official.marketplaceId !== "convax-official" ||
    official.repository !== "convaxai/convax-plugins" ||
    official.descriptorUrl !== "https://convaxai.github.io/convax-plugins/marketplace.json" ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 1
  ) {
    throw new Error("policy source declarations are not the approved product policy")
  }
  if (!Array.isArray(input.packages) || input.packages.length > MAX_PACKAGED_PACKAGES) {
    throw new Error("policy.packages must be a bounded array")
  }
  const packages = input.packages.map((entry, index) => parsePackagedPackagePolicy(entry, `policy.packages[${index}]`))
  const identities = packages.map((entry) => `${entry.marketplaceId}\0${entry.kind}\0${entry.id}`)
  if (new Set(identities).size !== identities.length) {
    throw new Error("policy.packages identities must be unique")
  }
  return {
    builtin: {
      marketplaceId: "convax-builtin",
      repository: "convaxai/convax-plugins",
    },
    official: {
      descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
      marketplaceId: "convax-official",
      repository: "convaxai/convax-plugins",
    },
    packages,
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
  policyEntry: MarketplacePackagedPackagePolicy,
  context = `resolved.packages[${index}]`,
): MarketplaceLockedPackage {
  const input = record(value, context)
  const purposes = parsePurposes(input.purposes, `${context}.purposes`)
  const targets = parseTargets(input.targets, `${context}.targets`)
  if (
    input.marketplaceId !== policyEntry.marketplaceId ||
    input.kind !== policyEntry.kind ||
    input.id !== policyEntry.id ||
    canonicalJson(purposes) !== canonicalJson(policyEntry.purposes) ||
    canonicalJson(targets) !== canonicalJson(policyEntry.targets)
  ) {
    throw new Error(`${context} does not match policy.packages`)
  }
  const version = nonEmptyString(input.version, `${context}.version`)
  if (!SEMVER.test(version)) {
    throw new Error(`${context}.version must be SemVer`)
  }

  if (policyEntry.kind === "skill") {
    exactKeys(input, ["artifact", "id", "kind", "marketplaceId", "purposes", "targets", "version"], context)
    return {
      artifact: parseArtifact(input.artifact, `${context}.artifact`, {
        maxSize: 10 * 1024 * 1024,
        expectedTag: `skill-${policyEntry.id}-v${version}`,
      }),
      id: policyEntry.id,
      kind: "skill",
      marketplaceId: "convax-official",
      purposes: ["default-install"],
      targets,
      version,
    }
  }

  const hasRecoveryPurpose = policyEntry.purposes.some((purpose) => purpose === "retired-recovery")
  exactKeys(
    input,
    [
      "artifact",
      "companions",
      "id",
      "kind",
      "marketplaceId",
      "ownedSkills",
      "purposes",
      ...(hasRecoveryPurpose ? ["retired"] : []),
      "targets",
      "version",
    ],
    context,
  )
  if (
    !Array.isArray(input.companions) ||
    input.companions.length > MAX_PACKAGE_CLOSURE ||
    !Array.isArray(input.ownedSkills) ||
    input.ownedSkills.length > MAX_PACKAGE_CLOSURE
  ) {
    throw new Error(`${context} must declare a bounded Plugin closure`)
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
    canonicalJson(companionTargets) !== canonicalJson(targets)
  ) {
    throw new Error(`${context}.companions must exactly close policy.packages targets in canonical order`)
  }
  const ownedSkills = input.ownedSkills.map((entry, skillIndex) =>
    parseArtifact(entry, `${context}.ownedSkills[${skillIndex}]`, {
      maxSize: 10 * 1024 * 1024,
    }),
  )
  if (new Set(ownedSkills.map(({ url }) => url)).size !== ownedSkills.length) {
    throw new Error(`${context}.ownedSkills must be unique`)
  }
  const artifact = parseArtifact(input.artifact, `${context}.artifact`, {
    maxSize: 10 * 1024 * 1024,
    expectedTag: releaseTag,
  })
  if (hasRecoveryPurpose) {
    if (!("retired" in policyEntry) || policyEntry.version !== version) {
      throw new Error(`${context}.version does not match policy.packages retired-recovery target`)
    }
    const retired = parseRetiredPluginBinding(input.retired, `${context}.retired`)
    if (canonicalJson(retired) !== canonicalJson(policyEntry.retired)) {
      throw new Error(`${context}.retired does not match policy.packages`)
    }
    return {
      artifact,
      companions,
      id: policyEntry.id,
      kind: "plugin",
      marketplaceId: "convax-official",
      ownedSkills,
      purposes: policyEntry.purposes.length === 1 ? ["retired-recovery"] : ["default-install", "retired-recovery"],
      retired,
      targets,
      version,
    }
  }
  return {
    artifact,
    companions,
    id: policyEntry.id,
    kind: "plugin",
    marketplaceId: "convax-official",
    ownedSkills,
    purposes: ["default-install"],
    targets,
    version,
  }
}

export function parseMarketplaceProductLock(value: unknown): MarketplaceProductLock {
  const input = record(value, "marketplaces.lock.json")
  exactKeys(input, ["policy", "resolved", "schema"], "marketplaces.lock.json")
  if (input.schema !== "convax.marketplace-product-lock/3")
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
  if (!Array.isArray(resolved.packages) || resolved.packages.length !== policy.packages.length) {
    throw new Error("resolved.packages must exactly close policy.packages")
  }
  const resolvedByIdentity = new Map<string, { value: unknown; index: number }>()
  resolved.packages.forEach((entry, index) => {
    const candidate = record(entry, `resolved.packages[${index}]`)
    const identity = `${String(candidate.marketplaceId)}\0${String(candidate.kind)}\0${String(candidate.id)}`
    if (resolvedByIdentity.has(identity)) throw new Error("resolved.packages identities must be unique")
    resolvedByIdentity.set(identity, { value: entry, index })
  })
  const packages = policy.packages.map((policyEntry) => {
    const identity = `${policyEntry.marketplaceId}\0${policyEntry.kind}\0${policyEntry.id}`
    const selected = resolvedByIdentity.get(identity)
    if (!selected) throw new Error("resolved.packages must exactly close policy.packages")
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
    schema: "convax.marketplace-product-lock/3",
  }
}
