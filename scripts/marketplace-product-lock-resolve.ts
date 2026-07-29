import { constants } from "node:fs"
import { lstat, open, realpath, type FileHandle } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"

import {
  canonicalProductPolicyDigest,
  canonicalJson,
  parseBuiltinBundle,
  parseBuiltinBundleArchive,
  parseMarketplaceDescriptor,
  parseMarketplaceProductPolicy,
  parseMarketplaceProductLock,
  parseRegistryV2,
  parseShowcaseV2,
  type MarketplaceArtifactLock,
  type MarketplaceProductLock,
  type MarketplaceProductPolicy,
  type RegistryPackage,
} from "./marketplace-product-lock"

type ProductLockInputArtifact = {
  path: string
  url: string
}

export type MarketplaceProductLockInput = {
  builtinBundle: ProductLockInputArtifact
  builtinManifestPath: string
  builtinReservations: Array<{ id: string; kind: "plugin" | "skill" }>
  official: {
    descriptor: ProductLockInputArtifact
    registry: ProductLockInputArtifact
    revision: string
    showcase: ProductLockInputArtifact
  }
  packages: Array<{
    artifact: ProductLockInputArtifact
    companions: Array<ProductLockInputArtifact & { arch: string; platform: string }>
    id: string
    kind: "plugin" | "skill" | "mcp-server"
    marketplaceId: string
    ownedSkills: ProductLockInputArtifact[]
    setup: "explicit" | "none"
    version: string
  }>
  schema: "convax.product-lock-input/1"
}

function inputRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactInputKeys(value: Record<string, unknown>, keys: readonly string[], context: string) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} has unsupported or missing fields`)
  }
}

function parseInputArtifact(value: unknown, context: string): ProductLockInputArtifact {
  const input = inputRecord(value, context)
  exactInputKeys(input, ["path", "url"], context)
  if (typeof input.path !== "string" || typeof input.url !== "string") {
    throw new Error(`${context} must contain path and URL strings`)
  }
  return { path: input.path, url: input.url }
}

function parseProductLockInput(value: unknown): MarketplaceProductLockInput {
  const input = inputRecord(value, "product-lock input")
  exactInputKeys(
    input,
    ["builtinBundle", "builtinManifestPath", "builtinReservations", "official", "packages", "schema"],
    "product-lock input",
  )
  if (
    input.schema !== "convax.product-lock-input/1" ||
    typeof input.builtinManifestPath !== "string" ||
    !Array.isArray(input.builtinReservations) ||
    input.builtinReservations.length > 128 ||
    !Array.isArray(input.packages) ||
    input.packages.length > 16_384
  ) {
    throw new Error("product-lock input is invalid")
  }
  const builtinReservations = input.builtinReservations.map((value, index) => {
    const reservation = inputRecord(value, `builtinReservations[${index}]`)
    exactInputKeys(reservation, ["id", "kind"], `builtinReservations[${index}]`)
    if (typeof reservation.id !== "string" || (reservation.kind !== "plugin" && reservation.kind !== "skill")) {
      throw new Error(`builtinReservations[${index}] is invalid`)
    }
    return { id: reservation.id, kind: reservation.kind }
  })
  const official = inputRecord(input.official, "official")
  exactInputKeys(official, ["descriptor", "registry", "revision", "showcase"], "official")
  if (typeof official.revision !== "string") throw new Error("official.revision must be a string")
  const packages = input.packages.map((value, packageIndex) => {
    const entry = inputRecord(value, `packages[${packageIndex}]`)
    exactInputKeys(
      entry,
      ["artifact", "companions", "id", "kind", "marketplaceId", "ownedSkills", "setup", "version"],
      `packages[${packageIndex}]`,
    )
    if (
      typeof entry.id !== "string" ||
      typeof entry.marketplaceId !== "string" ||
      typeof entry.version !== "string" ||
      (entry.kind !== "plugin" && entry.kind !== "skill" && entry.kind !== "mcp-server") ||
      (entry.setup !== "explicit" && entry.setup !== "none") ||
      !Array.isArray(entry.companions) ||
      entry.companions.length > 16 ||
      !Array.isArray(entry.ownedSkills) ||
      entry.ownedSkills.length > 128
    ) {
      throw new Error(`packages[${packageIndex}] is invalid`)
    }
    const companions = entry.companions.map((value, companionIndex) => {
      const context = `packages[${packageIndex}].companions[${companionIndex}]`
      const companion = inputRecord(value, context)
      exactInputKeys(companion, ["arch", "path", "platform", "url"], context)
      if (typeof companion.arch !== "string" || typeof companion.platform !== "string") {
        throw new Error(`${context} is invalid`)
      }
      return {
        ...parseInputArtifact({ path: companion.path, url: companion.url }, `${context}.artifact`),
        arch: companion.arch,
        platform: companion.platform,
      }
    })
    return {
      artifact: parseInputArtifact(entry.artifact, `packages[${packageIndex}].artifact`),
      companions,
      id: entry.id,
      kind: entry.kind,
      marketplaceId: entry.marketplaceId,
      ownedSkills: entry.ownedSkills.map((skill, skillIndex) =>
        parseInputArtifact(skill, `packages[${packageIndex}].ownedSkills[${skillIndex}]`),
      ),
      setup: entry.setup,
      version: entry.version,
    }
  })
  return {
    builtinBundle: parseInputArtifact(input.builtinBundle, "builtinBundle"),
    builtinManifestPath: input.builtinManifestPath,
    builtinReservations,
    official: {
      descriptor: parseInputArtifact(official.descriptor, "official.descriptor"),
      registry: parseInputArtifact(official.registry, "official.registry"),
      revision: official.revision,
      showcase: parseInputArtifact(official.showcase, "official.showcase"),
    },
    packages,
    schema: "convax.product-lock-input/1",
  }
}

function relativeInputPath(path: unknown, context: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${context} must be a normalized relative path`)
  }
  return path
}

async function lockArtifact(
  root: string,
  input: ProductLockInputArtifact,
  context: string,
  maxBytes = 128 * 1024 * 1024,
): Promise<{ artifact: MarketplaceArtifactLock; bytes: Uint8Array }> {
  if (!input || typeof input !== "object") throw new Error(`${context} must be an artifact input`)
  const path = relativeInputPath(input.path, `${context}.path`)
  if (typeof input.url !== "string") throw new Error(`${context}.url must be a string`)
  const absoluteRoot = await realpath(root)
  const absolutePath = resolve(absoluteRoot, path)
  const fromRoot = relative(absoluteRoot, absolutePath)
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new Error(`${context}.path escapes its release root`)
  const metadata = await lstat(absolutePath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`${context}.path must be a regular single-link no-follow file`)
  }
  const resolvedPath = await realpath(absolutePath)
  const resolvedFromRoot = relative(absoluteRoot, resolvedPath)
  if (resolvedFromRoot === ".." || resolvedFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`${context}.path escapes its release root`)
  }
  let handle: FileHandle | undefined
  try {
    handle = await open(resolvedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== BigInt(metadata.dev) ||
      opened.ino !== BigInt(metadata.ino) ||
      opened.size !== BigInt(metadata.size)
    ) {
      throw new Error(`${context}.path changed before it was locked`)
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || opened.size < 1n || opened.size > BigInt(maxBytes)) {
      throw new Error(`${context}.path must be non-empty and within its byte limit`)
    }
    const bytes = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (result.bytesRead < 1) throw new Error(`${context}.path changed while it was locked`)
      offset += result.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    const pathAfter = await lstat(absolutePath, { bigint: true })
    const resolvedAfter = await realpath(absolutePath)
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      pathAfter.dev !== opened.dev ||
      pathAfter.ino !== opened.ino ||
      pathAfter.size !== opened.size ||
      pathAfter.mtimeNs !== opened.mtimeNs ||
      pathAfter.ctimeNs !== opened.ctimeNs ||
      pathAfter.nlink !== 1n ||
      resolvedAfter !== resolvedPath
    ) {
      throw new Error(`${context}.path changed while it was locked`)
    }
    return {
      artifact: {
        name: basename(path),
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        url: input.url,
      },
      bytes,
    }
  } finally {
    await handle?.close()
  }
}

function parseJsonBytes(bytes: Uint8Array, context: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    throw new Error(`${context} must contain valid UTF-8 JSON`, { cause: error })
  }
}

function releaseAssetIdentity(input: ProductLockInputArtifact, context: string) {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    throw new Error(`${context}.url must be an immutable Official Release URL`)
  }
  const segments = url.pathname.split("/").filter(Boolean)
  const tag = segments[4] ?? ""
  const name = segments[5] ?? ""
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/${segments.join("/")}` ||
    segments[0] !== "microvoid" ||
    segments[1] !== "convax-plugins" ||
    segments[2] !== "releases" ||
    segments[3] !== "download" ||
    segments.length !== 6 ||
    tag.toLowerCase() === "latest" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(tag) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name)
  ) {
    throw new Error(`${context}.url must be an immutable Official Release URL`)
  }
  const pathSegments = input.path.split("/")
  const releaseIndex = pathSegments.lastIndexOf("releases")
  if (
    name !== basename(input.path) ||
    (releaseIndex >= 0 &&
      (pathSegments[releaseIndex + 1] !== tag ||
        pathSegments[releaseIndex + 2] !== name ||
        releaseIndex + 3 !== pathSegments.length))
  ) {
    throw new Error(`${context} path and URL identify different Release bytes`)
  }
  return { name, tag }
}

function assertRegistryArtifact(
  locked: MarketplaceArtifactLock,
  delivery: { sha256: string; size: number; url: string },
  context: string,
) {
  if (locked.url !== delivery.url || locked.size !== delivery.size || locked.sha256 !== delivery.sha256) {
    throw new Error(`${context} does not match the locked Official Registry`)
  }
}

function pluginOwnedSkillNames(value: RegistryPackage): string[] {
  if (value.kind !== "plugin") return []
  const contributes = value.manifest?.contributes
  if (!contributes || typeof contributes !== "object" || Array.isArray(contributes)) return []
  const skills = (contributes as Record<string, unknown>).skills
  if (skills === undefined) return []
  if (!Array.isArray(skills)) throw new Error("Official Plugin owned Skill projection is invalid")
  const names = skills.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Official Plugin owned Skill projection is invalid")
    }
    const name = (entry as Record<string, unknown>).name
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Official Plugin owned Skill projection is invalid")
    }
    return name
  })
  if (new Set(names).size !== names.length) {
    throw new Error("Official Plugin owned Skill projection contains duplicates")
  }
  return names.sort()
}

export async function resolveMarketplaceProductLock(
  rawPolicy: MarketplaceProductPolicy,
  releaseRoot: string,
  rawInput: unknown,
): Promise<MarketplaceProductLock> {
  const policy = parseMarketplaceProductPolicy(rawPolicy)
  const input = parseProductLockInput(rawInput)
  const lockedBuiltin = await lockArtifact(releaseRoot, input.builtinBundle, "builtinBundle")
  const builtin = parseBuiltinBundleArchive(lockedBuiltin.bytes)
  const builtinRelease = releaseAssetIdentity(input.builtinBundle, "builtinBundle")
  if (builtinRelease.tag !== `builtin-${builtin.release.id}`) {
    throw new Error("Builtin bundle Release tag does not match bundle.json")
  }
  const manifestPath = relativeInputPath(input.builtinManifestPath, "builtinManifestPath")
  const manifestBytes = await lockArtifact(
    releaseRoot,
    { path: manifestPath, url: input.builtinBundle.url },
    "builtinManifestPath",
  )
  const manifest = parseJsonBytes(manifestBytes.bytes, "builtinManifestPath")
  const parsedManifest = parseBuiltinBundle(manifest)
  if (canonicalJson(parsedManifest) !== canonicalJson(builtin)) {
    throw new Error("Builtin bundle.json does not match its locked outer archive")
  }
  const builtinReservations = builtin.members.map(({ id, kind }) => ({ id, kind }))
  if (canonicalJson(input.builtinReservations) !== canonicalJson(builtinReservations)) {
    throw new Error("Builtin reservation input does not match the locked outer archive")
  }
  const descriptorLocked = await lockArtifact(releaseRoot, input.official.descriptor, "official.descriptor")
  const registryLocked = await lockArtifact(releaseRoot, input.official.registry, "official.registry")
  const showcaseLocked = await lockArtifact(releaseRoot, input.official.showcase, "official.showcase")
  const descriptor = parseMarketplaceDescriptor(parseJsonBytes(descriptorLocked.bytes, "official.descriptor"))
  const registry = parseRegistryV2(parseJsonBytes(registryLocked.bytes, "official.registry"))
  parseShowcaseV2(parseJsonBytes(showcaseLocked.bytes, "official.showcase"), registry, descriptor)
  const metadataTag = `registry-v2-${registry.revision}`
  for (const [context, artifact] of [
    ["official.descriptor", input.official.descriptor],
    ["official.registry", input.official.registry],
    ["official.showcase", input.official.showcase],
  ] as const) {
    if (releaseAssetIdentity(artifact, context).tag !== metadataTag) {
      throw new Error(`${context} metadata Release tag does not match the locked Registry revision`)
    }
  }
  const officialPagesRoot = "https://microvoid.github.io/convax-plugins"
  if (
    descriptor.id !== policy.official.marketplaceId ||
    descriptor.repository.owner !== "microvoid" ||
    descriptor.repository.name !== "convax-plugins" ||
    descriptor.registry.v1?.url !== `${officialPagesRoot}/registry/v1/index.json` ||
    descriptor.registry.v2.url !== `${officialPagesRoot}/registry/v2/index.json` ||
    descriptor.showcase.v2.url !== `${officialPagesRoot}/showcase/v2/index.json` ||
    registry.marketplaceId !== descriptor.id ||
    input.official.revision !== registry.revision
  ) {
    throw new Error("Official metadata does not match canonical Official metadata paths and locked revision")
  }

  const selectedInputs = policy.preinstalledPackages.map((policyEntry) => {
    const matches = input.packages.filter(
      (entry) =>
        entry.marketplaceId === policyEntry.marketplaceId &&
        entry.kind === policyEntry.kind &&
        entry.id === policyEntry.id,
    )
    if (matches.length !== 1) {
      throw new Error(
        `product-lock input must contain exactly one ${policyEntry.marketplaceId}/${policyEntry.kind}/${policyEntry.id}`,
      )
    }
    const selected = matches[0]!
    if (selected.setup !== "explicit") {
      throw new Error(`product-lock input must retain explicit catalog setup for ${policyEntry.kind}/${policyEntry.id}`)
    }
    const companions = selected.companions.filter((companion) =>
      policyEntry.targets.includes(`${companion.platform}-${companion.arch}` as never),
    )
    if (companions.length !== policyEntry.targets.length) {
      throw new Error(`product-lock input does not close target companions for ${policyEntry.kind}/${policyEntry.id}`)
    }
    return { ...selected, companions }
  })
  const packages = await Promise.all(
    selectedInputs.map(async (entry, packageIndex) => {
      const registryEntry = registry.packages.find(
        (candidate) => candidate.kind === entry.kind && candidate.id === entry.id,
      )
      if (!registryEntry || registryEntry.version !== entry.version || registryEntry.delivery.kind !== "artifact") {
        throw new Error(`packages[${packageIndex}] does not identify the current Official Registry artifact`)
      }
      if (registryEntry.yanked === true) {
        throw new Error(`packages[${packageIndex}] cannot lock a yanked Official Registry package`)
      }
      const artifact = (await lockArtifact(releaseRoot, entry.artifact, `packages[${packageIndex}].artifact`)).artifact
      assertRegistryArtifact(artifact, registryEntry.delivery, `packages[${packageIndex}].artifact`)

      const ownedSkillNames = pluginOwnedSkillNames(registryEntry)
      const ownedByRegistry = registry.packages
        .filter((candidate) => candidate.kind === "skill" && candidate.ownerPluginId === registryEntry.id)
        .map(({ id }) => id)
        .sort()
      if (canonicalJson(ownedByRegistry) !== canonicalJson(ownedSkillNames)) {
        throw new Error("Official Registry owned Skills do not match the Plugin manifest")
      }
      const ownedRegistryEntries = ownedSkillNames.map((name) => {
        const owned = registry.packages.find(
          (candidate) =>
            candidate.kind === "skill" && candidate.id === name && candidate.ownerPluginId === registryEntry.id,
        )
        if (!owned || owned.delivery.kind !== "artifact") {
          throw new Error(`Official Registry is missing owned Skill ${name}`)
        }
        if (owned.yanked === true) {
          throw new Error(`Official Registry owned Skill ${name} is yanked`)
        }
        return owned
      })
      if (entry.ownedSkills.length !== ownedRegistryEntries.length) {
        throw new Error(`packages[${packageIndex}].ownedSkills does not close the Official Plugin manifest`)
      }
      const ownedSkills = await Promise.all(
        entry.ownedSkills.map((skill, skillIndex) =>
          lockArtifact(releaseRoot, skill, `packages[${packageIndex}].ownedSkills[${skillIndex}]`).then(
            ({ artifact }) => artifact,
          ),
        ),
      )
      const unmatchedOwned = [...ownedRegistryEntries]
      for (const owned of ownedSkills) {
        const matchIndex = unmatchedOwned.findIndex(
          ({ delivery }) =>
            delivery.kind === "artifact" &&
            delivery.url === owned.url &&
            delivery.size === owned.size &&
            delivery.sha256 === owned.sha256,
        )
        if (matchIndex < 0) {
          throw new Error(`packages[${packageIndex}].ownedSkills does not match the Official Registry`)
        }
        unmatchedOwned.splice(matchIndex, 1)
      }

      const expectedTargets =
        registryEntry.companions?.flatMap((companion) =>
          companion.targets.map((target) => ({
            arch: target.arch,
            delivery: target.artifact,
            platform: target.platform,
          })),
        ) ?? []
      const policyTargets = policy.preinstalledPackages.find(
        (candidate) =>
          candidate.marketplaceId === entry.marketplaceId && candidate.kind === entry.kind && candidate.id === entry.id,
      )!.targets
      const expectedSelectedTargets = expectedTargets.filter((target) =>
        policyTargets.includes(`${target.platform}-${target.arch}` as never),
      )
      if (expectedSelectedTargets.length !== entry.companions.length) {
        throw new Error(`packages[${packageIndex}].companions does not close every policy target`)
      }
      const companions = await Promise.all(
        entry.companions.map(async (companion, companionIndex) => ({
          ...(await lockArtifact(releaseRoot, companion, `packages[${packageIndex}].companions[${companionIndex}]`))
            .artifact,
          arch: companion.arch,
          platform: companion.platform,
        })),
      )
      for (const companion of companions) {
        const expected = expectedSelectedTargets.find(
          (target) => target.platform === companion.platform && target.arch === companion.arch,
        )
        if (!expected) {
          throw new Error(`packages[${packageIndex}].companions target is absent from the Official Registry`)
        }
        assertRegistryArtifact(companion, expected.delivery, `packages[${packageIndex}].companions`)
      }
      return {
        artifact,
        companions,
        id: entry.id,
        kind: entry.kind,
        marketplaceId: entry.marketplaceId,
        ownedSkills: ownedSkills.sort((left, right) => (left.url < right.url ? -1 : left.url > right.url ? 1 : 0)),
        setup: entry.setup,
        version: entry.version,
      }
    }),
  )
  return parseMarketplaceProductLock({
    policy,
    resolved: {
      builtinBundle: lockedBuiltin.artifact,
      builtinReservations,
      official: {
        descriptor: descriptorLocked.artifact,
        registry: registryLocked.artifact,
        revision: input.official.revision,
        showcase: showcaseLocked.artifact,
      },
      packages,
      policyDigest: canonicalProductPolicyDigest(policy),
    },
    schema: "convax.marketplace-product-lock/1",
  })
}

if (import.meta.main) {
  const manifestPath = process.argv[2]
  const policyPath = process.argv[3] ?? resolve("marketplaces.lock.json")
  if (!manifestPath) {
    throw new Error("usage: marketplace-product-lock-resolve <product-lock-input.json> [marketplaces.lock.json]")
  }
  const absoluteManifestPath = resolve(manifestPath)
  const inputBytes = await lockArtifact(
    dirname(absoluteManifestPath),
    { path: basename(absoluteManifestPath), url: "https://invalid.local/product-lock-input.json" },
    "product-lock input",
    16 * 1024 * 1024,
  )
  const input = parseProductLockInput(parseJsonBytes(inputBytes.bytes, "product-lock input"))
  const absolutePolicyPath = resolve(policyPath)
  const policyBytes = await lockArtifact(
    dirname(absolutePolicyPath),
    { path: basename(absolutePolicyPath), url: "https://invalid.local/marketplaces.lock.json" },
    "Marketplace product policy",
    16 * 1024 * 1024,
  )
  const policyInput = inputRecord(
    parseJsonBytes(policyBytes.bytes, "Marketplace product policy"),
    "Marketplace product policy",
  )
  const policy = parseMarketplaceProductPolicy("policy" in policyInput ? policyInput.policy : policyInput)
  const lock = await resolveMarketplaceProductLock(policy, dirname(absoluteManifestPath), input)
  process.stdout.write(`${JSON.stringify(lock, null, 2)}\n`)
}
