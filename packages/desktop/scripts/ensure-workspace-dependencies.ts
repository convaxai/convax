import { join } from "node:path"

const repositoryRoot = join(import.meta.dir, "../../..")
const dependencyFilter = "@convax/desktop^..."

export interface WorkspaceDependencyBuildOptions {
  managedByTurbo?: boolean
  repositoryRoot?: string
  run?: (command: readonly string[], cwd: string) => Promise<number>
}

async function run(command: readonly string[], cwd: string) {
  const child = Bun.spawn([...command], {
    cwd,
    stderr: "inherit",
    stdout: "inherit",
  })
  return child.exited
}

/**
 * Build Desktop's workspace dependencies when Desktop was launched directly.
 * Turbo already performs the same `^build` dependency step for Turbo-managed
 * Desktop tasks, so those tasks must not recursively launch another Turbo run.
 */
export async function ensureWorkspaceDependencies(options: WorkspaceDependencyBuildOptions = {}) {
  const managedByTurbo = options.managedByTurbo ?? Boolean(process.env.TURBO_HASH)
  if (managedByTurbo) return false

  const command = [process.execPath, "turbo", "build", `--filter=${dependencyFilter}`]
  const exitCode = await (options.run ?? run)(command, options.repositoryRoot ?? repositoryRoot)
  if (exitCode !== 0) {
    throw new Error(`Workspace dependency build failed with exit code ${exitCode}`)
  }
  return true
}

if (import.meta.main) await ensureWorkspaceDependencies()
