import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  canonicalJson,
  parseBuiltinBundleArchive,
  parseMarketplaceDescriptor,
  parseRegistryV2,
  parseShowcaseV2,
  type MarketplaceArtifactLock,
} from "@convax/marketplace"
import { constants as fsConstants } from "node:fs"
import { parseAgentSkillMarkdown } from "@convax/agent-runtime/node"

import { readMarketplaceProductLock } from "../../../scripts/marketplace-product-lock"
import { parseWebPluginManifest } from "../src/plugin-contracts"
import { unpackSafeZip } from "../src/main/safe-zip"

const maxArtifactBytes = 128 * 1024 * 1024

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function lockedBytes(root: string, lock: MarketplaceArtifactLock) {
  const file = path.join(root, lock.sha256)
  const metadata = await fs.lstat(file)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size !== lock.size) {
    throw new Error(`Locked Marketplace artifact is unavailable: ${lock.name}`)
  }
  if (metadata.size < 1 || metadata.size > maxArtifactBytes) throw new Error("Locked Marketplace artifact is oversized")
  const handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size !== metadata.size
    ) {
      throw new Error(`Locked Marketplace artifact changed: ${lock.name}`)
    }
    const bytes = new Uint8Array(opened.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (result.bytesRead < 1) throw new Error(`Locked Marketplace artifact changed: ${lock.name}`)
      offset += result.bytesRead
    }
    const after = await handle.stat()
    const pathAfter = await fs.lstat(file)
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      pathAfter.dev !== opened.dev ||
      pathAfter.ino !== opened.ino ||
      pathAfter.size !== opened.size ||
      pathAfter.mtimeMs !== opened.mtimeMs ||
      pathAfter.ctimeMs !== opened.ctimeMs ||
      pathAfter.nlink !== 1 ||
      digest(bytes) !== lock.sha256
    ) {
      throw new Error(`Locked Marketplace artifact changed or failed SHA-256: ${lock.name}`)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

function json(bytes: Uint8Array, label: string) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    throw new Error(`${label} is invalid`, { cause: error })
  }
}

function validateBuiltin(bytes: Uint8Array) {
  return parseBuiltinBundleArchive(bytes)
}

export function validateLockedPluginManifest(
  rawManifest: unknown,
  registryManifest: unknown,
  identity: { id: string; version: string },
) {
  const parsed = parseWebPluginManifest(rawManifest)
  if (parsed.id !== identity.id || parsed.version !== identity.version) {
    throw new Error("Locked Plugin identity changed")
  }
  if (registryManifest === undefined || canonicalJson(parsed) !== canonicalJson(registryManifest)) {
    throw new Error("Locked Plugin manifest projection does not canonically match the Official Registry")
  }
  return parsed
}

export async function stageMarketplaceProductLock(options: {
  lockPath: string
  outputDirectory: string
  releaseRoot: string
}) {
  const lock = await readMarketplaceProductLock(options.lockPath)
  const releaseRoot = await fs.realpath(options.releaseRoot)
  const staged: Array<{ bytes: Uint8Array; lock: MarketplaceArtifactLock; path: string }> = []
  const add = async (entry: MarketplaceArtifactLock, relativePath: string) => {
    const bytes = await lockedBytes(releaseRoot, entry)
    staged.push({ bytes, lock: entry, path: relativePath })
    return bytes
  }
  const builtinBytes = await add(lock.resolved.builtinBundle, `builtin/${lock.resolved.builtinBundle.name}`)
  const builtin = validateBuiltin(builtinBytes)
  if (
    new URL(lock.resolved.builtinBundle.url).pathname.split("/").filter(Boolean)[4] !== `builtin-${builtin.release.id}`
  ) {
    throw new Error("Builtin bundle Release tag does not match its locked release identity")
  }
  const descriptorBytes = await add(
    lock.resolved.official.descriptor,
    `official/${lock.resolved.official.descriptor.name}`,
  )
  const registryBytes = await add(lock.resolved.official.registry, `official/${lock.resolved.official.registry.name}`)
  const showcaseBytes = await add(lock.resolved.official.showcase, `official/${lock.resolved.official.showcase.name}`)
  const descriptor = parseMarketplaceDescriptor(json(descriptorBytes, "Official descriptor"))
  const registry = parseRegistryV2(json(registryBytes, "Official Registry"))
  parseShowcaseV2(json(showcaseBytes, "Official Showcase"), registry, descriptor)
  if (
    descriptor.id !== lock.policy.official.marketplaceId ||
    descriptor.registry.v2.url !== "https://microvoid.github.io/convax-plugins/registry/v2/index.json" ||
    descriptor.registry.v1 !== undefined ||
    descriptor.showcase.v2.url !== "https://microvoid.github.io/convax-plugins/showcase/v2/index.json" ||
    registry.revision !== lock.resolved.official.revision
  ) {
    throw new Error("Official locked metadata does not close its descriptor and policy")
  }
  for (const entry of lock.resolved.packages) {
    const registryEntry = registry.packages.find(
      (candidate) => candidate.kind === entry.kind && candidate.id === entry.id && candidate.version === entry.version,
    )
    if (
      !registryEntry ||
      registryEntry.delivery.kind !== "artifact" ||
      registryEntry.delivery.url !== entry.artifact.url ||
      registryEntry.delivery.size !== entry.artifact.size ||
      registryEntry.delivery.sha256 !== entry.artifact.sha256
    ) {
      throw new Error("Locked preinstalled package does not match the Official Registry")
    }
    const packageBytes = await add(entry.artifact, `packages/${entry.id}/${entry.artifact.name}`)
    const files = unpackSafeZip(packageBytes)
    if (entry.kind === "plugin") {
      const manifest = files["manifest.json"]
      if (!manifest) throw new Error("Locked Plugin is missing manifest.json")
      const rawManifest = json(manifest, "Locked Plugin manifest")
      const parsed = validateLockedPluginManifest(rawManifest, registryEntry.manifest, entry)
      const declaredSkillNames = new Set(parsed.contributes.skills?.map((skill) => skill.name) ?? [])
      const registryOwnedSkills = registry.packages.filter(
        (candidate) => candidate.kind === "skill" && candidate.ownerPluginId === entry.id,
      )
      if (
        declaredSkillNames.size !== registryOwnedSkills.length ||
        registryOwnedSkills.some((skill) => !declaredSkillNames.has(skill.id)) ||
        entry.ownedSkills.length !== registryOwnedSkills.length
      ) {
        throw new Error("Locked Plugin owned Skills do not close its manifest and Registry")
      }
    }
    for (const skill of entry.ownedSkills) {
      const ownedSkill = registry.packages.find(
        (candidate) =>
          candidate.kind === "skill" &&
          candidate.ownerPluginId === entry.id &&
          candidate.delivery.kind === "artifact" &&
          candidate.delivery.url === skill.url &&
          candidate.delivery.size === skill.size &&
          candidate.delivery.sha256 === skill.sha256,
      )
      if (!ownedSkill) throw new Error("Locked owned Skill does not match the Official Registry")
      const bytes = await add(skill, `packages/${entry.id}/skills/${skill.name}`)
      const skillFiles = unpackSafeZip(bytes)
      const markdown = skillFiles["SKILL.md"]
      if (!markdown) throw new Error("Locked owned Skill is missing SKILL.md")
      parseAgentSkillMarkdown(new TextDecoder("utf-8", { fatal: true }).decode(markdown))
    }
    for (const companion of entry.companions) {
      const matched = registryEntry.companions?.some((declaration) =>
        declaration.targets.some(
          (target) =>
            target.platform === companion.platform &&
            target.arch === companion.arch &&
            target.artifact.url === companion.url &&
            target.artifact.size === companion.size &&
            target.artifact.sha256 === companion.sha256,
        ),
      )
      if (!matched) throw new Error("Locked companion does not match the Official Registry")
      await add(companion, `packages/${entry.id}/companions/${companion.platform}-${companion.arch}/${companion.name}`)
    }
  }
  const reservation = {
    members: lock.resolved.builtinReservations,
    schema: "convax.builtin-reservation/1",
  }
  if (
    builtin.members.length !== reservation.members.length ||
    builtin.members.some(
      (member) => !reservation.members.some((entry) => entry.id === member.id && entry.kind === member.kind),
    )
  ) {
    throw new Error("Locked Builtin bundle does not match compiled reservations")
  }
  const parent = path.dirname(options.outputDirectory)
  await fs.mkdir(parent, { recursive: true })
  const temporary = path.join(parent, `.${path.basename(options.outputDirectory)}.${randomUUID()}`)
  const backup = path.join(parent, `.${path.basename(options.outputDirectory)}.backup.${randomUUID()}`)
  await fs.mkdir(temporary, { mode: 0o700 })
  let hasBackup = false
  try {
    for (const entry of staged) {
      const target = path.join(temporary, entry.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, entry.bytes, { flag: "wx", mode: 0o600 })
    }
    await fs.writeFile(
      path.join(temporary, "manifest.json"),
      `${JSON.stringify({ lock, paths: staged.map(({ lock, path }) => ({ sha256: lock.sha256, size: lock.size, path })), reservation, schema: "convax.packaged-marketplace-product/1" })}\n`,
      { flag: "wx", mode: 0o600 },
    )
    try {
      await fs.rename(options.outputDirectory, backup)
      hasBackup = true
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error
    }
    try {
      await fs.rename(temporary, options.outputDirectory)
    } catch (error) {
      if (hasBackup) await fs.rename(backup, options.outputDirectory)
      throw error
    }
    if (hasBackup) await fs.rm(backup, { force: true, recursive: true })
  } catch (error) {
    await fs.rm(temporary, { force: true, recursive: true })
    throw error
  }
}

if (import.meta.main) {
  const lockPath = path.resolve(process.argv[2] ?? "../../marketplaces.lock.json")
  const releaseRoot = path.resolve(process.argv[3] ?? ".packaging/marketplace-cache/artifact-v1")
  await stageMarketplaceProductLock({
    lockPath,
    outputDirectory: path.resolve(".packaging/marketplace-product"),
    releaseRoot,
  })
}
