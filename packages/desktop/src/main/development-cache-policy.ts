import { existsSync, renameSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"

export interface ChromiumCommandLineSwitch {
  name: string
  value?: string
}

export interface DevelopmentCachePolicy {
  legacyDirectoryNames: readonly string[]
  switches: readonly ChromiumCommandLineSwitch[]
  v8CacheOptions?: "none"
}

export interface DevelopmentCacheQuarantine {
  failures: Array<{ directoryName: string; error: unknown }>
  paths: string[]
}

const quarantinePrefix = ".convax-development-cache-cleanup-"

const disabledPolicy: DevelopmentCachePolicy = {
  legacyDirectoryNames: [],
  switches: [],
}

/**
 * Vite gives changed modules timestamped URLs, so Chromium's persistent caches
 * retain many obsolete copies during long-running Desktop development. Keep
 * packaged builds cached, but bypass both HTTP and V8 code caches for the dev
 * server, where Vite already owns dependency caching and invalidation.
 */
export function desktopDevelopmentCachePolicy(input: {
  isPackaged: boolean
  rendererUrl?: string
}): DevelopmentCachePolicy {
  if (input.isPackaged || !input.rendererUrl) return disabledPolicy

  return {
    legacyDirectoryNames: ["Cache", "Code Cache"],
    switches: [{ name: "disable-http-cache" }],
    v8CacheOptions: "none",
  }
}

/**
 * Atomically moves old caches out of Chromium's well-known paths. Renaming on
 * the same volume does not scale with cache size, unlike deleting thousands of
 * entries before the first window can open.
 */
export function quarantineLegacyDevelopmentCaches(
  userDataDirectory: string,
  directoryNames: readonly string[],
  quarantineId = `${Date.now()}-${process.pid}`,
): DevelopmentCacheQuarantine {
  const result: DevelopmentCacheQuarantine = { failures: [], paths: [] }

  directoryNames.forEach((directoryName, index) => {
    const source = join(userDataDirectory, directoryName)
    if (!existsSync(source)) return

    const target = join(userDataDirectory, `${quarantinePrefix}${quarantineId}-${index}`)
    try {
      renameSync(source, target)
      result.paths.push(target)
    } catch (error) {
      result.failures.push({ directoryName, error })
    }
  })

  return result
}

/** Removes current and crash-leftover quarantines without delaying startup. */
export async function removeQuarantinedDevelopmentCaches(userDataDirectory: string) {
  const entries = await readdir(userDataDirectory, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith(quarantinePrefix))
      .map((entry) => rm(join(userDataDirectory, entry.name), { force: true, recursive: true })),
  )
}
