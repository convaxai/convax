import { createMarketplaceStarter, type StarterKind } from "@convax/marketplace-kit"

export interface CreateMarketplaceOptions {
  directory: string
  id: string
  name: string
  owner: string
  repository: string
  starter: StarterKind
  install?: boolean
}

export async function create(options: CreateMarketplaceOptions): Promise<void> {
  await createMarketplaceStarter(options.directory, {
    id: options.id,
    name: options.name,
    owner: options.owner,
    repository: options.repository,
    starter: options.starter,
  })
  if (options.install) {
    const process = Bun.spawn(["bun", "install", "--ignore-scripts"], {
      cwd: options.directory,
      stdout: "inherit",
      stderr: "inherit",
      env: { ...globalThis.process.env, BUN_INSTALL_CACHE_DIR: `${options.directory}/.bun-cache` },
    })
    const exitCode = await process.exited
    if (exitCode !== 0) throw new Error(`bun install --ignore-scripts failed with exit code ${exitCode}`)
  }
}
