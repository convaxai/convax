interface PluginInput {
  directory: string
}

interface ProtectedPathPluginOptions {
  marker?: unknown
  paths?: unknown
}

interface ToolHookInput {
  tool: string
}

interface ToolHookOutput {
  args: unknown
}

/**
 * OpenCode server plugin used internally by the runtime's explicit protected-path guard.
 *
 * Keep this factory self-contained and as this module's only function export. The runtime
 * serializes it into a private temporary module so the guard remains available when the
 * agent-runtime package itself is bundled into a host executable. OpenCode also treats every
 * function export in a legacy plugin module as a plugin factory.
 */
export default async function protectedPathPlugin(input: PluginInput, options?: ProtectedPathPluginOptions) {
  const { lstat, readlink, readdir } = await import("node:fs/promises")
  const { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } = await import("node:path")

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
  }

  function errorCode(value: unknown) {
    return isRecord(value) && typeof value.code === "string" ? value.code : undefined
  }

  async function canonicalize(target: string, seen = new Set<string>()): Promise<string> {
    const absolute = resolve(target)
    const root = parse(absolute).root
    const parts = absolute.slice(root.length).split(sep).filter(Boolean)
    let cursor = root

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!
      const candidate = join(cursor, part)
      let info
      try {
        info = await lstat(candidate)
      } catch (error) {
        const code = errorCode(error)
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error
        return resolve(candidate, ...parts.slice(index + 1))
      }

      if (!info.isSymbolicLink()) {
        cursor = candidate
        continue
      }

      const key = pathKey(candidate)
      if (seen.has(key) || seen.size >= 40) throw new Error("Host-protected path guard rejected a symlink loop")
      seen.add(key)
      const target = await readlink(candidate)
      return canonicalize(resolve(dirname(candidate), target, ...parts.slice(index + 1)), seen)
    }

    return cursor
  }

  function pathKey(value: string) {
    let normalized = value.normalize("NFC")
    if (process.platform === "win32") {
      normalized = normalized.split(/[\\/]/).map((segment) => segment.replace(/[. ]+$/g, "")).join(sep)
    }
    return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized
  }

  function containsPath(parent: string, candidate: string) {
    const pathFromParent = relative(pathKey(parent), pathKey(candidate))
    return pathFromParent === ""
      || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
  }

  function pathsOverlap(left: string, right: string) {
    return containsPath(left, right) || containsPath(right, left)
  }

  function concretePaths(value: unknown) {
    if (!Array.isArray(value)) throw new Error("Protected path guard requires a paths array")
    const paths = value.map((item) => {
      if (typeof item !== "string" || !item.trim() || item.includes("\0")) {
        throw new Error("Protected path guard paths must be non-empty strings")
      }
      return item.trim()
    })
    if (paths.length === 0) throw new Error("Protected path guard requires at least one path")
    return [...new Set(paths)]
  }

  function toolArgs(value: unknown) {
    if (!isRecord(value)) throw new Error("Host-protected path guard could not validate tool arguments")
    return value
  }

  function stringArgument(args: Record<string, unknown>, names: readonly string[]) {
    for (const name of names) {
      const value = args[name]
      if (typeof value === "string" && value.trim()) return value
    }
    throw new Error("Host-protected path guard could not validate a tool path")
  }

  function patchPaths(patchText: string) {
    const paths: string[] = []
    const pattern = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm
    for (const match of patchText.matchAll(pattern)) {
      const value = match[1]?.trim()
      if (value) paths.push(value)
    }
    if (paths.length === 0) throw new Error("Host-protected path guard could not validate patch paths")
    return paths
  }

  const configured = concretePaths(options?.paths)
  const marker = options?.marker
  if (typeof marker !== "string" || !marker) throw new Error("Protected path guard requires a marker")
  const absoluteRoots = configured.map((item) => isAbsolute(item) ? resolve(item) : resolve(input.directory, item))

  async function protectedRoots() {
    return Promise.all(absoluteRoots.map((root) => canonicalize(root)))
  }

  function absoluteToolPath(value: string) {
    return isAbsolute(value) ? resolve(value) : resolve(input.directory, value)
  }

  async function assertDirectPath(value: string) {
    const [candidate, roots] = await Promise.all([canonicalize(absoluteToolPath(value)), protectedRoots()])
    if (roots.some((root) => containsPath(root, candidate))) {
      throw new Error("This tool cannot access a host-protected path")
    }
  }

  async function assertNoProtectedSymlink(searchRoot: string, roots: string[]) {
    const pending = [searchRoot]
    while (pending.length > 0) {
      const directory = pending.pop()!
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        const code = errorCode(error)
        if (code === "ENOENT" || code === "ENOTDIR") continue
        throw error
      }

      for (const entry of entries) {
        const candidate = join(directory, entry.name)
        if (entry.isSymbolicLink()) {
          const target = await canonicalize(candidate)
          if (roots.some((root) => pathsOverlap(root, target))) {
            throw new Error("This recursive tool cannot traverse a symlink to a host-protected path")
          }
          continue
        }
        if (entry.isDirectory()) pending.push(candidate)
      }
    }
  }

  async function assertSearchRoot(value: string) {
    const lexical = absoluteToolPath(value)
    const [candidate, roots] = await Promise.all([canonicalize(lexical), protectedRoots()])
    if (roots.some((root) => pathsOverlap(root, candidate))) {
      throw new Error("This recursive tool cannot overlap a host-protected path; use a narrower path")
    }
    await assertNoProtectedSymlink(candidate, roots)
  }

  return {
    config: async (config: Record<string, unknown>) => {
      const watcher = isRecord(config.watcher) ? config.watcher : {}
      const ignore = Array.isArray(watcher.ignore)
        ? watcher.ignore.filter((item): item is string => typeof item === "string")
        : []
      config.watcher = { ...watcher, ignore: [...new Set([...ignore, marker])] }
    },
    "tool.execute.before": async ({ tool }: ToolHookInput, output: ToolHookOutput) => {
      if (tool === "bash" || tool === "shell" || tool === "lsp") {
        throw new Error(`The ${tool} tool is disabled while host-protected paths are active`)
      }

      if (tool === "read" || tool === "edit" || tool === "write") {
        const args = toolArgs(output.args)
        await assertDirectPath(stringArgument(args, ["filePath", "file_path", "path"]))
        return
      }

      if (tool === "apply_patch") {
        const args = toolArgs(output.args)
        const patchText = stringArgument(args, ["patchText", "patch_text"])
        for (const path of patchPaths(patchText)) await assertDirectPath(path)
        return
      }

      if (tool === "grep" || tool === "glob" || tool === "list" || tool === "find") {
        const args = toolArgs(output.args)
        const path = typeof args.path === "string" && args.path.trim() ? args.path : input.directory
        await assertSearchRoot(path)
      }
    },
  }
}
