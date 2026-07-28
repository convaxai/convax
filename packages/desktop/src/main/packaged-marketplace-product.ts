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
import type {
  VerifiedMarketplaceCandidate,
} from "./remote-capability-installer"

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
  readonly #paths: ReadonlyMap<string, PackagedPath>
  readonly #root: string
  readonly #builtinArchive: Uint8Array

  private constructor(input: {
    builtin: BuiltinBundle
    builtinArchive: Uint8Array
    descriptor: MarketplaceDescriptor
    lock: MarketplaceProductLock
    paths: ReadonlyMap<string, PackagedPath>
    registry: RegistryV2
    root: string
    showcase: ShowcaseV2
  }) {
    this.builtin = input.builtin
    this.#builtinArchive = Uint8Array.from(input.builtinArchive)
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
    const descriptor = parseMarketplaceDescriptor(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await read(manifest.lock.resolved.official.descriptor),
      )),
    )
    const registry = parseRegistryV2(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await read(manifest.lock.resolved.official.registry),
      )),
    )
    const showcase = parseShowcaseV2(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await read(manifest.lock.resolved.official.showcase),
      )),
      registry,
      descriptor,
    )
    if (
      registry.revision !== manifest.lock.resolved.official.revision ||
      builtin.members.length !== manifest.reservation.members.length ||
      builtin.members.some(
        (member) =>
          !manifest.reservation.members.some(
            (expected) => expected.id === member.id && expected.kind === member.kind,
          ),
      )
    ) {
      throw new Error("Packaged Marketplace product metadata is not closed by its lock")
    }
    return new PackagedMarketplaceProduct({
      builtin,
      builtinArchive,
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

  catalog(): SourceQualifiedItem[] {
    const officialSourceKey = computeSourceKey({
      deliveryPolicy: "github-pages-releases",
      descriptorUrl: this.lock.policy.official.descriptorUrl,
      kind: "network",
      marketplaceId: this.descriptor.id,
      repository: {
        name: this.descriptor.repository.name,
        owner: this.descriptor.repository.owner,
      },
    })
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
          runtimeSurface: "none",
          sourceKey: builtinKey,
          sourceKind: "builtin",
          sourceOrder: 0,
          version: member.version,
        }),
      ),
      ...this.registry.packages.filter((item) => !item.yanked).map(
        (item): SourceQualifiedItem => ({
          catalogRevision: this.registry.revision,
          catalogSequence: this.registry.sequence,
          compatibility: item.compatibility,
          delivery: item.delivery,
          id: item.id,
          kind: item.kind,
          marketplaceId: this.descriptor.id,
          official: true,
          presentation: item.presentation,
          runtimeSurface: runtimeSurface(item),
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

function runtimeSurface(item: RegistryPackage): SourceQualifiedItem["runtimeSurface"] {
  if (item.kind === "skill") return "none"
  if (item.kind === "mcp-server") {
    return item.delivery.kind === "mcp-managed-stdio" && (item.delivery.extension.productActions?.length ?? 0) > 0
      ? "agent-and-convax"
      : "agent"
  }
  const contributions = (item.manifest as { contributes?: Record<string, unknown> } | undefined)?.contributes
  if (!contributions) return "none"
  if (
    ["tools", "generation", "services"].some((key) => {
      const value = contributions[key]
      return Array.isArray(value) ? value.length > 0 : value && typeof value === "object"
    })
  ) {
    return "agent-and-convax"
  }
  return Object.keys(contributions).some((key) => ["hooks", "llms", "mcpServers", "skills"].includes(key))
    ? "agent"
    : "none"
}
