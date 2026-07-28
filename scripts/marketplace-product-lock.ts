import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { resolve } from "node:path"

export {
  canonicalProductPolicyDigest,
  canonicalJson,
  parseBuiltinBundle,
  parseBuiltinBundleArchive,
  parseMarketplaceDescriptor,
  parseMarketplaceProductLock,
  parseMarketplaceProductPolicy,
  parseRegistryV2,
  parseShowcaseV2,
  type MarketplaceArtifactLock,
  type MarketplaceProductLock,
  type MarketplaceProductPolicy,
  type RegistryPackage,
} from "@convax/marketplace"

import { parseMarketplaceProductLock } from "@convax/marketplace"

async function readStableProductLock(path: string) {
  const absolutePath = resolve(path)
  const before = await lstat(absolutePath, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new Error("Marketplace product lock must be a single-link no-follow regular file")
  }
  if (before.size < 1n || before.size > 16n * 1024n * 1024n) {
    throw new Error("Marketplace product lock exceeds its byte limit")
  }
  if ((await realpath(absolutePath)) !== absolutePath) {
    throw new Error("Marketplace product lock path is not stable")
  }
  const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error("Marketplace product lock changed before it was opened")
    }
    const bytes = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead < 1) throw new Error("Marketplace product lock changed while it was read")
      offset += bytesRead
    }
    const [after, pathAfter, realAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(absolutePath, { bigint: true }),
      realpath(absolutePath),
    ])
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
      realAfter !== absolutePath
    ) {
      throw new Error("Marketplace product lock changed while it was read")
    }
    return bytes
  } finally {
    await handle.close()
  }
}

export async function readMarketplaceProductLock(path = resolve("marketplaces.lock.json")) {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readStableProductLock(path)))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("Marketplace product lock must contain valid UTF-8 JSON", { cause: error })
    }
    throw error
  }
  return parseMarketplaceProductLock(value)
}

if (import.meta.main) {
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve("marketplaces.lock.json")
  await readMarketplaceProductLock(path)
  console.log(`Verified Marketplace product lock: ${path}`)
}
