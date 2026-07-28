import fs from "node:fs/promises"
import path from "node:path"

import { sha256Hex, type RegistryPackage } from "@convax/marketplace"

import { readBoundedAuthorityFile } from "./bounded-authority-file"
import type { VerifiedMarketplaceCandidate } from "./remote-capability-installer"

const maxArtifactBytes = 128 * 1024 * 1024
const maxReleasePlanBytes = 4 * 1024 * 1024

interface DevelopmentReleaseAsset {
  name: string
  path: string
  sha256: string
  size: number
  url: string
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function parseAsset(value: unknown): DevelopmentReleaseAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Development Official release asset is invalid")
  }
  const input = value as Record<string, unknown>
  if (
    !exactKeys(input, ["name", "path", "sha256", "size", "url"]) ||
    typeof input.name !== "string" ||
    typeof input.path !== "string" ||
    typeof input.sha256 !== "string" ||
    typeof input.size !== "number" ||
    typeof input.url !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u.test(input.name) ||
    !/^[a-f0-9]{64}$/u.test(input.sha256) ||
    !Number.isSafeInteger(input.size) ||
    input.size < 1 ||
    input.size > maxArtifactBytes ||
    path.posix.isAbsolute(input.path) ||
    input.path.includes("\\") ||
    input.path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    path.posix.basename(input.path) !== input.name
  ) {
    throw new Error("Development Official release asset is invalid")
  }
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    throw new Error("Development Official release asset URL is invalid")
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Development Official release asset URL is invalid")
  }
  return {
    name: input.name,
    path: input.path,
    sha256: input.sha256,
    size: input.size,
    url: url.href,
  }
}

function parseReleasePlan(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Development Official release plan is invalid")
  }
  const input = value as Record<string, unknown>
  if (
    !exactKeys(input, ["releases", "schema"]) ||
    input.schema !== "convax.release-plan/1" ||
    !Array.isArray(input.releases) ||
    input.releases.length < 1 ||
    input.releases.length > 1024
  ) {
    throw new Error("Development Official release plan is invalid")
  }
  const assets: DevelopmentReleaseAsset[] = []
  for (const value of input.releases) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Development Official release is invalid")
    }
    const release = value as Record<string, unknown>
    if (
      !exactKeys(release, ["assets", "tag"]) ||
      typeof release.tag !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u.test(release.tag) ||
      !Array.isArray(release.assets) ||
      release.assets.length < 1
    ) {
      throw new Error("Development Official release is invalid")
    }
    assets.push(...release.assets.map(parseAsset))
    if (assets.length > 4096) throw new Error("Development Official release plan is too large")
  }
  const urls = new Set<string>()
  const paths = new Set<string>()
  for (const asset of assets) {
    if (urls.has(asset.url) || paths.has(asset.path)) {
      throw new Error("Development Official release asset is duplicated")
    }
    urls.add(asset.url)
    paths.add(asset.path)
  }
  return assets
}

export class DevelopmentOfficialMarketplaceArtifacts {
  readonly #assets: ReadonlyMap<string, DevelopmentReleaseAsset>
  readonly #root: string

  private constructor(root: string, assets: readonly DevelopmentReleaseAsset[]) {
    this.#assets = new Map(assets.map((asset) => [asset.url, asset]))
    this.#root = root
  }

  static async load(root: string) {
    if (!path.isAbsolute(root)) throw new Error("Development Official artifact root must be absolute")
    const absolute = path.resolve(root)
    const canonical = await fs.realpath(absolute)
    if (canonical !== absolute) throw new Error("Development Official artifact root must be canonical")
    const plan = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readBoundedAuthorityFile(
          path.join(canonical, "release-plan.json"),
          maxReleasePlanBytes,
          "Development Official release plan",
        ),
      ),
    )
    return new DevelopmentOfficialMarketplaceArtifacts(canonical, parseReleasePlan(plan))
  }

  async #read(artifact: { sha256: string; size: number; url: string }) {
    const declared = this.#assets.get(artifact.url)
    if (
      !declared ||
      declared.sha256 !== artifact.sha256 ||
      declared.size !== artifact.size
    ) {
      throw new Error("Development Official artifact is not declared by the release plan")
    }
    const file = path.resolve(this.#root, ...declared.path.split("/"))
    const relative = path.relative(this.#root, file)
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Development Official artifact escapes its root")
    }
    if ((await fs.realpath(file)) !== file) {
      throw new Error("Development Official artifact path must be canonical")
    }
    const bytes = await readBoundedAuthorityFile(file, declared.size, "Development Official artifact")
    if (bytes.byteLength !== declared.size || sha256Hex(bytes) !== declared.sha256) {
      throw new Error("Development Official artifact does not match its immutable identity")
    }
    return bytes
  }

  async verifiedCandidate(
    item: RegistryPackage,
    runtime: { arch?: NodeJS.Architecture; platform?: NodeJS.Platform } = {},
  ): Promise<VerifiedMarketplaceCandidate> {
    if (item.delivery.kind !== "artifact") {
      throw new Error("Development Official candidate must use artifact delivery")
    }
    const platform = runtime.platform ?? process.platform
    const arch = runtime.arch ?? process.arch
    const companionBytes: Record<string, Uint8Array> = {}
    for (const companion of item.companions ?? []) {
      const target = companion.targets.find((entry) => entry.platform === platform && entry.arch === arch)
      if (target) companionBytes[companion.command] = await this.#read(target.artifact)
    }
    return {
      artifactBytes: await this.#read(item.delivery),
      ...(Object.keys(companionBytes).length ? { companionBytes } : {}),
      item,
    }
  }
}
