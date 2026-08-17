import { constants as fsConstants } from "node:fs"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { sha256Hex, type MarketplaceArtifactLock, type MarketplaceProductLock } from "@convax/marketplace"

import { PinnedHttpsFetcher } from "../src/main/pinned-https-fetch"
import { readMarketplaceProductLock } from "../../../scripts/marketplace-product-lock"

function artifacts(lock: MarketplaceProductLock) {
  const resolved = [
    lock.resolved.builtinBundle,
    lock.resolved.official.descriptor,
    lock.resolved.official.registry,
    lock.resolved.official.showcase,
    ...lock.resolved.packages.flatMap((entry) =>
      entry.kind === "plugin" ? [entry.artifact, ...entry.ownedSkills, ...entry.companions] : [entry.artifact],
    ),
  ]
  const unique = new Map<string, MarketplaceArtifactLock>()
  for (const artifact of resolved) {
    const existing = unique.get(artifact.sha256)
    if (existing && existing.size !== artifact.size) {
      throw new Error(`Marketplace product lock reuses one digest with incompatible sizes: ${artifact.sha256}`)
    }
    if (!existing) unique.set(artifact.sha256, artifact)
  }
  return [...unique.values()]
}

export async function runBoundedMarketplaceTasks<T>(options: {
  concurrency: number
  items: readonly T[]
  task: (item: T, index: number) => Promise<void>
}) {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error("Marketplace artifact concurrency must be an integer from 1 through 8")
  }
  let cursor = 0
  let failed = false
  let firstError: unknown
  const worker = async () => {
    while (!failed) {
      const index = cursor
      cursor += 1
      if (index >= options.items.length) return
      try {
        await options.task(options.items[index]!, index)
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.items.length) }, () => worker()))
  if (failed) throw firstError
}

async function readExact(file: string, artifact: MarketplaceArtifactLock) {
  const metadata = await fs.lstat(file)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size !== artifact.size) {
    throw new Error(`Marketplace artifact is not one exact regular file: ${artifact.sha256}`)
  }
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
      throw new Error(`Marketplace artifact changed before reading: ${artifact.sha256}`)
    }
    const bytes = new Uint8Array(opened.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (result.bytesRead < 1) throw new Error(`Marketplace artifact changed while reading: ${artifact.sha256}`)
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
      sha256Hex(bytes) !== artifact.sha256
    ) {
      throw new Error(`Marketplace artifact does not match its product lock: ${artifact.sha256}`)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

function localReleaseCoordinates(artifact: MarketplaceArtifactLock) {
  const url = new URL(artifact.url)
  const segments = url.pathname.split("/")
  if (
    segments.length !== 7 ||
    segments[0] !== "" ||
    segments[1] !== "convaxai" ||
    segments[2] !== "convax-plugins" ||
    segments[3] !== "releases" ||
    segments[4] !== "download"
  ) {
    throw new Error("Marketplace product lock URL is not an exact convax-plugins Release artifact")
  }
  const encodedTag = segments[5]
  const encodedName = segments[6]
  if (/%2f|%5c/iu.test(encodedTag) || /%2f|%5c/iu.test(encodedName)) {
    throw new Error("Marketplace product lock URL contains encoded path separators")
  }
  const tag = decodeURIComponent(encodedTag)
  const name = decodeURIComponent(encodedName)
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u.test(tag) ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u.test(name) ||
    name !== artifact.name
  ) {
    throw new Error("Marketplace product lock URL contains an unsafe Release coordinate")
  }
  return { name, tag }
}

async function readLocalRelease(root: string, artifact: MarketplaceArtifactLock) {
  const { name, tag } = localReleaseCoordinates(artifact)
  const candidates = [
    path.join(root, "catalog", "releases", tag, name),
    path.join(root, "builtin", "releases", tag, name),
  ]
  const matches: string[] = []
  for (const candidate of candidates) {
    try {
      await fs.lstat(candidate)
      matches.push(candidate)
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Locked Marketplace artifact is absent from the Kit release roots"
        : "Locked Marketplace artifact is ambiguous across Kit release roots",
    )
  }
  return readExact(matches[0], artifact)
}

async function syncDirectory(directory: string) {
  // Windows does not expose a synchronizable directory handle. File bytes are
  // still fsynced before publication, so skip only this unsupported durability
  // barrier instead of swallowing write or verification failures.
  if (process.platform === "win32") return
  const handle = await fs.open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function materializeMarketplaceProductLock(options: {
  cacheRoot: string
  downloadConcurrency?: number
  fetcher?: Pick<PinnedHttpsFetcher, "fetch">
  localReleaseRoot?: string
  lockPath: string
  onPlan?: (plan: {
    cachedArtifacts: number
    downloadArtifacts: number
    downloadBytes: number
    totalArtifacts: number
    totalBytes: number
  }) => void
  onProgress?: (progress: {
    completedArtifacts: number
    completedBytes: number
    downloadArtifacts: number
    downloadBytes: number
  }) => void
}) {
  const lock = await readMarketplaceProductLock(options.lockPath)
  const root = path.resolve(options.cacheRoot, "artifact-v1")
  await fs.mkdir(root, { mode: 0o700, recursive: true })
  const fetcher = options.fetcher ?? new PinnedHttpsFetcher()
  const resolvedArtifacts = artifacts(lock)
  const missingArtifacts: MarketplaceArtifactLock[] = []
  let cachedArtifacts = 0
  for (const artifact of resolvedArtifacts) {
    const target = path.join(root, artifact.sha256)
    try {
      await readExact(target, artifact)
      cachedArtifacts += 1
      continue
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        await fs.rm(target, { force: true })
      }
    }
    missingArtifacts.push(artifact)
  }
  const downloadBytes = missingArtifacts.reduce((total, artifact) => total + artifact.size, 0)
  options.onPlan?.({
    cachedArtifacts,
    downloadArtifacts: missingArtifacts.length,
    downloadBytes,
    totalArtifacts: resolvedArtifacts.length,
    totalBytes: resolvedArtifacts.reduce((total, artifact) => total + artifact.size, 0),
  })
  let completedArtifacts = 0
  let completedBytes = 0
  await runBoundedMarketplaceTasks({
    concurrency: options.downloadConcurrency ?? 4,
    items: missingArtifacts,
    task: async (artifact) => {
      const target = path.join(root, artifact.sha256)
      const bytes = options.localReleaseRoot
        ? await readLocalRelease(path.resolve(options.localReleaseRoot), artifact)
        : await fetcher.fetch(artifact.url, "release", {
            maxBytes: artifact.size,
            repository: { owner: "convaxai", repository: "convax-plugins" },
          })
      if (bytes.byteLength !== artifact.size || sha256Hex(bytes) !== artifact.sha256) {
        throw new Error(`Materialized Marketplace artifact does not match its product lock: ${artifact.sha256}`)
      }
      const temporary = path.join(root, `.${artifact.sha256}.${randomUUID()}.tmp`)
      const handle = await fs.open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await fs.link(temporary, target)
        await fs.unlink(temporary)
        await syncDirectory(root)
      } catch (error) {
        await fs.rm(temporary, { force: true })
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error
      }
      await readExact(target, artifact)
      completedArtifacts += 1
      completedBytes += artifact.size
      options.onProgress?.({
        completedArtifacts,
        completedBytes,
        downloadArtifacts: missingArtifacts.length,
        downloadBytes,
      })
    },
  })
  return { artifactRoot: root, lock }
}

if (import.meta.main) {
  const lockPath = path.resolve(process.argv[2] ?? "../../marketplaces.lock.json")
  const cacheRoot = path.resolve(process.argv[3] ?? ".packaging/marketplace-cache")
  const localReleaseRoot = process.argv[4] ? path.resolve(process.argv[4]) : undefined
  await materializeMarketplaceProductLock({
    cacheRoot,
    ...(localReleaseRoot ? { localReleaseRoot } : {}),
    lockPath,
  })
}
