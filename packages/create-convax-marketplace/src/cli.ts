#!/usr/bin/env node
import { create } from "./index"
import type { StarterKind } from "@convax/marketplace-kit"

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export async function runCreateMarketplaceCli(args = process.argv.slice(2)): Promise<void> {
  const directory = args.find((arg) => !arg.startsWith("-")) ?? "convax-marketplace"
  const id = option(args, "--id") ?? directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "convax-marketplace"
  const name = option(args, "--name") ?? id
  const owner = option(args, "--owner")
  const repository = option(args, "--repository") ?? id
  const starter = option(args, "--starter") ?? "mcp-server"
  if (!owner) throw new TypeError("--owner is required")
  if (starter !== "plugin" && starter !== "skill" && starter !== "mcp-server") {
    throw new TypeError("--starter must be plugin, skill, or mcp-server")
  }
  await create({
    directory,
    id,
    name,
    owner,
    repository,
    starter: starter as StarterKind,
    install: !args.includes("--skip-install"),
  })
}

if (import.meta.main) {
  await runCreateMarketplaceCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
