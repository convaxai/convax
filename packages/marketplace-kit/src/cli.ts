#!/usr/bin/env node
import {
  addMarketplaceDirectory,
  addTarget,
  buildBuiltinBundle,
  buildMarketplace,
  checkMarketplace,
  changedMarketplaceVersions,
  createMarketplaceTemplate,
  composeProductLockInput,
  type StarterKind,
} from "./index"

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export async function runMarketplaceCli(args = process.argv.slice(2)): Promise<void> {
  const [command, rootArgument, ...rest] = args
  if (command === "check") {
    await checkMarketplace(rootArgument ?? ".")
    return
  }
  if (command === "build-index") {
    const changedPath = option(rest, "--changed")
    const changed = changedPath
      ? ((await Bun.file(changedPath).json()) as Array<{ kind: string; id: string }>)
      : undefined
    await buildMarketplace({
      root: rootArgument ?? ".",
      outDir: option(rest, "--out") ?? "dist",
      official: rest.includes("--official"),
      sequence: option(rest, "--sequence") ? Number(option(rest, "--sequence")) : undefined,
      previousRegistryPath: option(rest, "--previous"),
      bootstrapPreviousV1Path: option(rest, "--bootstrap-previous-v1"),
      initialOfficial: rest.includes("--initial"),
      v1Revision: option(rest, "--v1-revision"),
      publishIdentities: changed?.map(({ kind, id }) => `${kind}\0${id}`),
    })
    return
  }
  if (command === "changed") {
    const base = option(rest, "--base")
    if (!base) throw new TypeError("changed requires --base")
    console.log(JSON.stringify(await changedMarketplaceVersions(rootArgument ?? ".", base)))
    return
  }
  if (command === "bundle") {
    await buildBuiltinBundle({ root: rootArgument ?? ".", outDir: option(rest, "--out") ?? "dist/builtin" })
    return
  }
  if (command === "lock-input") {
    const lockInputArgs = rootArgument === undefined ? rest : [rootArgument, ...rest]
    const catalogDir = option(lockInputArgs, "--catalog")
    const builtinDir = option(lockInputArgs, "--builtin")
    const outFile = option(lockInputArgs, "--out")
    if (!catalogDir || !builtinDir || !outFile) {
      throw new TypeError("lock-input requires --catalog, --builtin, and --out")
    }
    await composeProductLockInput({ catalogDir, builtinDir, outFile })
    return
  }
  if (command === "add") {
    if (!rootArgument) throw new TypeError("add requires a source directory")
    await addMarketplaceDirectory(option(rest, "--root") ?? ".", rootArgument)
    return
  }
  if (command === "new") {
    if (rootArgument !== "plugin" && rootArgument !== "skill" && rootArgument !== "mcp-server") {
      throw new TypeError("new requires plugin, skill, or mcp-server")
    }
    const id = option(rest, "--id") ?? `new-${rootArgument}`
    await createMarketplaceTemplate(option(rest, "--root") ?? ".", rootArgument as StarterKind, id)
    return
  }
  if (command === "add-target") {
    if (!rootArgument) throw new TypeError("add-target requires an MCP directory")
    const target = option(rest, "--target")
    const file = option(rest, "--file")
    if (!target || !file) throw new TypeError("add-target requires --target and --file")
    await addTarget(option(rest, "--root") ?? ".", rootArgument, { target, file })
    return
  }
  throw new TypeError("usage: convax-marketplace check|changed|build-index|bundle|lock-input|add|new|add-target")
}

if (import.meta.main) {
  await runMarketplaceCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
