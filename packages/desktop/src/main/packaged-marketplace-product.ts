import fs from "node:fs/promises"
import path from "node:path"

import {
  builtinSourceKey,
  parseBuiltinBundleArchive,
  computeSourceKey,
  parseMarketplaceDescriptor,
  parseMarketplaceProductLock,
  parseRegistryV2,
  parseShowcaseV2,
  projectBuiltinMemberDelivery,
  readBuiltinBundleMember,
  sha256Hex,
  type BuiltinBundle,
  type MarketplaceArtifactLock,
  type MarketplaceDescriptor,
  type MarketplaceProductLock,
  type RegistryPackage,
  type RegistryV2,
  type ShowcaseV2,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import { readBoundedAuthorityFile } from "./bounded-authority-file"
import {
  parsePluginRuntimeSurface,
  projectRegistryPackageRuntimeSurface,
  type MarketplaceRuntimeSurface,
} from "./marketplace-runtime-surface"
import type { VerifiedMarketplaceCandidate } from "./marketplace-artifact-installer"
import { unpackSafeZip } from "./safe-zip"

const maxManifestBytes = 4 * 1024 * 1024
const maxArtifactBytes = 128 * 1024 * 1024

interface PackagedPath {
  path: string
  sha256: string
  size: number
}

interface PackagedManifest {
  lock: MarketplaceProductLock
  paths: PackagedPath[]
  reservation: {
    members: Array<{ id: string; kind: "plugin" | "skill" }>
    schema: "convax.builtin-reservation/1"
  }
  schema: "convax.packaged-marketplace-product/1"
}

export interface PackagedRetiredPluginRecovery {
  readonly artifact: { readonly sha256: string; readonly size: number }
  readonly hostApiMajor: number
  readonly pluginId: string
  readonly snapshotDigest: string
  readonly sourceIdentity: string
  readonly version: string
}

export interface PackagedRetiredPluginSourceMigration {
  readonly fromSourceIdentity: string
  readonly pluginId: string
  readonly toSourceIdentity: string
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function parseRelativePath(value: unknown) {
  if (
    typeof value !== "string" ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Packaged Marketplace product path is invalid")
  }
  return value
}

function parseManifest(value: unknown): PackagedManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Packaged Marketplace product manifest is invalid")
  }
  const input = value as Record<string, unknown>
  if (
    !exactKeys(input, ["lock", "paths", "reservation", "schema"]) ||
    input.schema !== "convax.packaged-marketplace-product/1" ||
    !Array.isArray(input.paths)
  ) {
    throw new Error("Packaged Marketplace product manifest is invalid")
  }
  const lock = parseMarketplaceProductLock(input.lock)
  const seenPaths = new Set<string>()
  const seenDigests = new Set<string>()
  const paths = input.paths.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Packaged Marketplace product path is invalid")
    }
    const entry = value as Record<string, unknown>
    const relativePath = parseRelativePath(entry.path)
    if (
      !exactKeys(entry, ["path", "sha256", "size"]) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) ||
      Number(entry.size) < 1 ||
      Number(entry.size) > maxArtifactBytes ||
      seenPaths.has(relativePath) ||
      seenDigests.has(entry.sha256)
    ) {
      throw new Error("Packaged Marketplace product path is invalid")
    }
    seenPaths.add(relativePath)
    seenDigests.add(entry.sha256)
    return { path: relativePath, sha256: entry.sha256, size: Number(entry.size) }
  })
  const reservation = input.reservation
  if (
    !reservation ||
    typeof reservation !== "object" ||
    Array.isArray(reservation) ||
    !exactKeys(reservation as Record<string, unknown>, ["members", "schema"]) ||
    (reservation as Record<string, unknown>).schema !== "convax.builtin-reservation/1" ||
    !Array.isArray((reservation as Record<string, unknown>).members)
  ) {
    throw new Error("Packaged Marketplace reservation is invalid")
  }
  const members = (reservation as { members: unknown[] }).members.map((member) => {
    if (
      !member ||
      typeof member !== "object" ||
      Array.isArray(member) ||
      !exactKeys(member as Record<string, unknown>, ["id", "kind"]) ||
      typeof (member as Record<string, unknown>).id !== "string" ||
      !["plugin", "skill"].includes(String((member as Record<string, unknown>).kind))
    ) {
      throw new Error("Packaged Marketplace reservation is invalid")
    }
    return {
      id: (member as { id: string }).id,
      kind: (member as { kind: "plugin" | "skill" }).kind,
    }
  })
  if (
    members.length !== lock.resolved.builtinReservations.length ||
    members.some(
      (member) =>
        !lock.resolved.builtinReservations.some(
          (expected) => expected.id === member.id && expected.kind === member.kind,
        ),
    )
  ) {
    throw new Error("Packaged Marketplace reservation does not match the product lock")
  }
  return {
    lock,
    paths,
    reservation: { members, schema: "convax.builtin-reservation/1" },
    schema: "convax.packaged-marketplace-product/1",
  }
}

function artifactKey(artifact: { sha256: string; size: number }) {
  return `${artifact.sha256}\0${artifact.size}`
}

export class PackagedMarketplaceProduct {
  readonly builtin: BuiltinBundle
  readonly descriptor: MarketplaceDescriptor
  readonly lock: MarketplaceProductLock
  readonly registry: RegistryV2
  readonly showcase: ShowcaseV2
  readonly #builtinRuntimeSurfaces: ReadonlyMap<string, MarketplaceRuntimeSurface>
  readonly #paths: ReadonlyMap<string, PackagedPath>
  readonly #root: string
  readonly #builtinArchive: Uint8Array

  private constructor(input: {
    builtin: BuiltinBundle
    builtinArchive: Uint8Array
    builtinRuntimeSurfaces: ReadonlyMap<string, MarketplaceRuntimeSurface>
    descriptor: MarketplaceDescriptor
    lock: MarketplaceProductLock
    paths: ReadonlyMap<string, PackagedPath>
    registry: RegistryV2
    root: string
    showcase: ShowcaseV2
  }) {
    this.builtin = input.builtin
    this.#builtinArchive = Uint8Array.from(input.builtinArchive)
    this.#builtinRuntimeSurfaces = new Map(input.builtinRuntimeSurfaces)
    this.descriptor = input.descriptor
    this.lock = input.lock
    this.#paths = input.paths
    this.registry = input.registry
    this.#root = input.root
    this.showcase = input.showcase
  }

  static async load(root: string) {
    const absoluteRoot = await fs.realpath(root)
    const manifest = parseManifest(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBoundedAuthorityFile(
            path.join(absoluteRoot, "manifest.json"),
            maxManifestBytes,
            "Packaged Marketplace product manifest",
          ),
        ),
      ),
    )
    const paths = new Map(manifest.paths.map((entry) => [artifactKey(entry), entry]))
    const read = async (artifact: MarketplaceArtifactLock) => {
      const entry = paths.get(artifactKey(artifact))
      if (!entry) throw new Error("Packaged Marketplace product is missing a locked artifact")
      const bytes = await readBoundedAuthorityFile(
        path.join(absoluteRoot, entry.path),
        Math.min(maxArtifactBytes, entry.size),
        "Packaged Marketplace artifact",
      )
      if (bytes.byteLength !== entry.size || sha256Hex(bytes) !== entry.sha256) {
        throw new Error("Packaged Marketplace artifact does not match its product lock")
      }
      return bytes
    }
    const builtinArchive = await read(manifest.lock.resolved.builtinBundle)
    const builtin = parseBuiltinBundleArchive(builtinArchive)
    const builtinRuntimeSurfaces = projectPackagedBuiltinRuntimeSurfaces(builtin, builtinArchive)
    const descriptor = parseMarketplaceDescriptor(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await read(manifest.lock.resolved.official.descriptor)),
      ),
    )
    const registry = parseRegistryV2(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await read(manifest.lock.resolved.official.registry)),
      ),
    )
    const showcase = parseShowcaseV2(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await read(manifest.lock.resolved.official.showcase)),
      ),
      registry,
      descriptor,
    )
    if (
      registry.revision !== manifest.lock.resolved.official.revision ||
      builtin.members.length !== manifest.reservation.members.length ||
      builtin.members.some(
        (member) =>
          !manifest.reservation.members.some((expected) => expected.id === member.id && expected.kind === member.kind),
      )
    ) {
      throw new Error("Packaged Marketplace product metadata is not closed by its lock")
    }
    return new PackagedMarketplaceProduct({
      builtin,
      builtinArchive,
      builtinRuntimeSurfaces,
      descriptor,
      lock: manifest.lock,
      paths,
      registry,
      root: absoluteRoot,
      showcase,
    })
  }

  readBuiltinArtifact(item: SourceQualifiedItem) {
    if (item.sourceKind !== "builtin" || item.delivery.kind !== "builtin-artifact") {
      throw new Error("Packaged Builtin delivery is required")
    }
    const member = this.builtin.members.find(
      (entry) => entry.kind === item.kind && entry.id === item.id && entry.version === item.version,
    )
    if (!member) throw new Error("Builtin Marketplace member is unavailable")
    return readBuiltinBundleMember(this.#builtinArchive, item.delivery)
  }

  async verifiedCandidate(item: RegistryPackage): Promise<VerifiedMarketplaceCandidate> {
    if (item.delivery.kind !== "artifact") {
      throw new Error("Only packaged Plugin and Skill artifacts use the verified candidate publisher")
    }
    const lockedPackage = this.lock.resolved.packages.find(
      (entry) => entry.kind === item.kind && entry.id === item.id && entry.version === item.version,
    )
    if (!lockedPackage || artifactKey(lockedPackage.artifact) !== artifactKey(item.delivery)) {
      throw new Error("Package is not selected by the Marketplace product lock")
    }
    return this.#verifiedLockedCandidate(item, lockedPackage)
  }

  async verifiedRecoveryCandidate(
    item: RegistryPackage,
    recovery: PackagedRetiredPluginRecovery,
  ): Promise<VerifiedMarketplaceCandidate | null> {
    if (item.kind !== "plugin" || item.delivery.kind !== "artifact") return null
    const delivery = item.delivery
    const lockedPackage = this.lock.resolved.recoveryArtifacts.find(
      (entry) =>
        entry.kind === item.kind &&
        entry.id === item.id &&
        entry.version === item.version &&
        artifactKey(entry.artifact) === artifactKey(delivery),
    )
    if (!lockedPackage) return null
    const retired = lockedPackage.retired
    if (
      recovery.pluginId !== lockedPackage.id ||
      recovery.sourceIdentity !== retired.sourceKey ||
      recovery.version !== retired.version ||
      artifactKey(recovery.artifact) !== artifactKey(retired.artifact) ||
      recovery.snapshotDigest !== retired.snapshotDigest ||
      recovery.hostApiMajor !== retired.hostApiMajor
    ) {
      return null
    }
    return this.#verifiedLockedCandidate(item, lockedPackage)
  }

  retiredPluginSourceMigrations(): readonly PackagedRetiredPluginSourceMigration[] {
    const toSourceIdentity = this.#officialSourceKey()
    return Object.freeze(
      this.lock.resolved.recoveryArtifacts.map((entry) =>
        Object.freeze({
          fromSourceIdentity: entry.retired.sourceKey,
          pluginId: entry.id,
          toSourceIdentity,
        }),
      ),
    )
  }

  async #verifiedLockedCandidate(
    item: RegistryPackage,
    lockedPackage: MarketplaceProductLock["resolved"]["packages"][number],
  ): Promise<VerifiedMarketplaceCandidate> {
    const artifactBytes = await this.#read(lockedPackage.artifact)
    const companionBytes: Record<string, Uint8Array> = {}
    for (const declaration of item.companions ?? []) {
      const target = declaration.targets.find(
        (entry) => entry.platform === process.platform && entry.arch === process.arch,
      )
      if (!target) continue
      const locked = lockedPackage.companions.find(
        (entry) =>
          entry.platform === target.platform &&
          entry.arch === target.arch &&
          artifactKey(entry) === artifactKey(target.artifact),
      )
      if (!locked) throw new Error("Packaged companion is not selected by the product lock")
      companionBytes[declaration.command] = await this.#read(locked)
    }
    return {
      artifactBytes,
      ...(Object.keys(companionBytes).length ? { companionBytes } : {}),
      item,
    }
  }

  #officialSourceKey() {
    return computeSourceKey({
      deliveryPolicy: "github-pages-releases",
      descriptorUrl: this.lock.policy.official.descriptorUrl,
      kind: "network",
      marketplaceId: this.descriptor.id,
      repository: {
        name: this.descriptor.repository.name,
        owner: this.descriptor.repository.owner,
      },
    })
  }

  catalog(): SourceQualifiedItem[] {
    const officialSourceKey = this.#officialSourceKey()
    const builtinKey = builtinSourceKey()
    return [
      ...this.builtin.members.map(
        (member): SourceQualifiedItem => ({
          catalogRevision: this.builtin.release.id,
          catalogSequence: this.lock.policy.revision,
          compatibility: { convax: "*" },
          delivery: projectBuiltinMemberDelivery(this.builtin, member),
          id: member.id,
          kind: member.kind,
          marketplaceId: this.lock.policy.builtin.marketplaceId,
          official: false,
          presentation: { name: member.id },
          runtimeSurface:
            member.kind === "skill"
              ? "none"
              : requireBuiltinRuntimeSurface(this.#builtinRuntimeSurfaces, member.id, member.version),
          sourceKey: builtinKey,
          sourceKind: "builtin",
          sourceOrder: 0,
          version: member.version,
        }),
      ),
      ...this.registry.packages
        .filter((item) => !item.yanked)
        .map(
          (item): SourceQualifiedItem => ({
            catalogRevision: this.registry.revision,
            catalogSequence: this.registry.sequence,
            compatibility: item.compatibility,
            delivery: item.delivery,
            id: item.id,
            kind: item.kind,
            marketplaceId: this.descriptor.id,
            official: true,
            ...(item.ownerPluginId === undefined ? {} : { ownerPluginId: item.ownerPluginId }),
            presentation: item.presentation,
            runtimeSurface: projectRegistryPackageRuntimeSurface(item),
            sourceKey: officialSourceKey,
            sourceKind: "network",
            sourceOrder: 0,
            version: item.version,
          }),
        ),
    ]
  }

  async #read(artifact: MarketplaceArtifactLock) {
    const entry = this.#paths.get(artifactKey(artifact))
    if (!entry) throw new Error("Packaged Marketplace product is missing a locked artifact")
    const bytes = await readBoundedAuthorityFile(
      path.join(this.#root, entry.path),
      Math.min(maxArtifactBytes, entry.size),
      "Packaged Marketplace artifact",
    )
    if (bytes.byteLength !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      throw new Error("Packaged Marketplace artifact does not match its product lock")
    }
    return bytes
  }
}

function builtinIdentity(id: string, version: string) {
  return `${id}\0${version}`
}

function requireBuiltinRuntimeSurface(
  surfaces: ReadonlyMap<string, MarketplaceRuntimeSurface>,
  id: string,
  version: string,
) {
  const surface = surfaces.get(builtinIdentity(id, version))
  if (surface === undefined) {
    throw new Error("Packaged Builtin Plugin runtime projection is unavailable")
  }
  return surface
}

export function projectPackagedBuiltinRuntimeSurfaces(
  bundle: BuiltinBundle,
  archive: Uint8Array,
): ReadonlyMap<string, MarketplaceRuntimeSurface> {
  const surfaces = new Map<string, MarketplaceRuntimeSurface>()
  for (const member of bundle.members) {
    if (member.kind !== "plugin") continue
    const artifact = readBuiltinBundleMember(archive, projectBuiltinMemberDelivery(bundle, member))
    const manifestBytes = unpackSafeZip(artifact)["manifest.json"]
    if (manifestBytes === undefined) {
      throw new Error("Packaged Builtin Plugin is missing manifest.json")
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes))
    } catch (error) {
      throw new Error("Packaged Builtin Plugin manifest is invalid", {
        cause: error,
      })
    }
    const projected = parsePluginRuntimeSurface(value, member)
    surfaces.set(builtinIdentity(member.id, member.version), projected.runtimeSurface)
  }
  return surfaces
}
