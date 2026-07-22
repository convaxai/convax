import { realpath, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { delimiter, dirname, join, resolve } from "node:path"

function pathKey(path: string) {
  return process.platform === "win32" ? path.toLowerCase() : path
}

function validatePathEntry(path: string) {
  if (path.includes("\0")) throw new Error("OpenCode binary directory cannot contain null bytes")
  if (path.includes(delimiter)) {
    throw new Error(`OpenCode binary directory cannot contain the PATH delimiter ${JSON.stringify(delimiter)}`)
  }
}

/** Normalize a host-provided binary directory without consulting workspace packages. */
export function normalizeOpenCodeBinaryDirectory(binaryDirectory: string | undefined) {
  if (binaryDirectory === undefined) return undefined
  const configured = binaryDirectory.trim()
  if (!configured) throw new Error("OpenCode binary directory is required")
  validatePathEntry(configured)
  return resolve(configured)
}

async function validatedExplicitBinaryDirectory(binaryDirectory: string) {
  let canonical: string
  try {
    canonical = await realpath(binaryDirectory)
  } catch (cause) {
    throw new Error(`OpenCode binary directory does not exist: ${binaryDirectory}`, { cause })
  }
  validatePathEntry(canonical)
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error(`OpenCode binary directory is not a directory: ${binaryDirectory}`)
  }
  const executable = join(canonical, process.platform === "win32" ? "opencode.exe" : "opencode")
  const executableStat = await stat(executable).catch((cause: unknown) => {
    throw new Error(`OpenCode executable was not found in the binary directory: ${executable}`, { cause })
  })
  if (!executableStat.isFile()) {
    throw new Error(`OpenCode executable is not a file: ${executable}`)
  }
  return canonical
}

function developmentBinaryDirectories() {
  const require = createRequire(import.meta.url)
  const runtimeEntry = require.resolve("@convax/agent-runtime")
  const packageJson = createRequire(runtimeEntry).resolve("opencode-ai/package.json")
  return [resolve(dirname(runtimeEntry), "../node_modules/.bin"), join(dirname(dirname(packageJson)), ".bin")]
}

/**
 * Put OpenCode on PATH before the SDK synchronously spawns it.
 *
 * A supplied directory is a packaged-host boundary: validate and use only that
 * directory. Package resolution remains a source/development fallback when the
 * host did not supply a binary directory.
 */
export async function ensureOpenCodeBinaryOnPath(binaryDirectory: string | undefined) {
  const current = process.env.PATH ?? ""
  if (binaryDirectory !== undefined) {
    const canonical = await validatedExplicitBinaryDirectory(binaryDirectory)
    const remaining = current
      .split(delimiter)
      .filter(Boolean)
      .filter((entry) => pathKey(entry) !== pathKey(canonical))
    // A packaged host directory is authoritative even if the same canonical
    // entry was already present later in PATH behind another `opencode`.
    process.env.PATH = [canonical, ...remaining].join(delimiter)
    return [canonical]
  }

  const binaryDirectories = developmentBinaryDirectories()
  const currentKeys = new Set(current.split(delimiter).filter(Boolean).map(pathKey))
  const missing = binaryDirectories.filter((directory) => !currentKeys.has(pathKey(directory)))
  if (missing.length > 0) process.env.PATH = [...missing, current].filter(Boolean).join(delimiter)
  return binaryDirectories
}
