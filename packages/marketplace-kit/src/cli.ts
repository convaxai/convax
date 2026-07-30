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
  type MarketplacePublishSelection,
  type StarterKind,
} from "./index"

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function fetchReleaseArtifact(artifact: { url: string; size: number; sha256: string }): Promise<Uint8Array> {
  let url = new URL(artifact.url)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const allowedHost =
      url.hostname.toLowerCase() === "github.com" || url.hostname.toLowerCase().endsWith(".githubusercontent.com")
    if (url.protocol !== "https:" || !allowedHost || url.port || url.username || url.password || url.hash) {
      throw new TypeError("artifact fetch URL left the bounded GitHub HTTPS origin")
    }
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/octet-stream" },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location")
      if (!location || redirects === 5) throw new TypeError("artifact fetch exceeded safe redirects")
      url = new URL(location, url)
      continue
    }
    if (!response.ok || !response.body) {
      throw new TypeError(`artifact fetch failed with HTTP ${response.status}`)
    }
    const contentLength = response.headers.get("content-length")
    if (contentLength !== null && Number(contentLength) > artifact.size) {
      throw new TypeError("artifact response exceeds its declared immutable size")
    }
    const bytes = new Uint8Array(artifact.size)
    let offset = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        if (offset + chunk.byteLength > bytes.byteLength) {
          throw new TypeError("artifact response exceeds its declared immutable size")
        }
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
    } finally {
      reader.releaseLock()
    }
    if (offset !== bytes.byteLength) throw new TypeError("artifact response size is incomplete")
    return bytes
  }
  throw new TypeError("artifact fetch failed")
}

export async function runMarketplaceCli(args = process.argv.slice(2)): Promise<void> {
  const [command, rootArgument, ...rest] = args
  if (command === "check") {
    await checkMarketplace(rootArgument ?? ".")
    return
  }
  if (command === "build-index") {
    const changedPath = option(rest, "--changed")
    const changed = changedPath ? ((await Bun.file(changedPath).json()) as MarketplacePublishSelection[]) : undefined
    await buildMarketplace({
      root: rootArgument ?? ".",
      outDir: option(rest, "--out") ?? "dist",
      official: rest.includes("--official"),
      sequence: option(rest, "--sequence") ? Number(option(rest, "--sequence")) : undefined,
      previousDescriptorPath: option(rest, "--previous-descriptor"),
      previousRegistryPath: option(rest, "--previous"),
      previousShowcasePath: option(rest, "--previous-showcase"),
      previousRegistryV1Path: option(rest, "--previous-v1"),
      previousShowcaseV1Path: option(rest, "--previous-showcase-v1"),
      bootstrapPreviousV1Path: option(rest, "--bootstrap-previous-v1"),
      initialOfficial: rest.includes("--initial"),
      v1Revision: option(rest, "--v1-revision"),
      publishSelections: changed,
      fetchArtifact: changed ? fetchReleaseArtifact : undefined,
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
