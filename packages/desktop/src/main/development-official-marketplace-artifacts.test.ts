import { createHash } from "node:crypto"
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { expect, test } from "bun:test"
import type { RegistryPackage } from "@convax/marketplace"

import { DevelopmentOfficialMarketplaceArtifacts } from "./development-official-marketplace-artifacts"

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function fixture() {
  const root = join(await realpath(tmpdir()), `convax-official-link-${crypto.randomUUID()}`)
  await mkdir(join(root, "releases", "plugin-p-v1.0.0"), { recursive: true })
  const packageBytes = new TextEncoder().encode("package")
  const companionBytes = new TextEncoder().encode("companion")
  const packageArtifact = {
    name: "plugin-p-1.0.0.zip",
    path: "releases/plugin-p-v1.0.0/plugin-p-1.0.0.zip",
    sha256: digest(packageBytes),
    size: packageBytes.byteLength,
    url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-p-v1.0.0/plugin-p-1.0.0.zip",
  }
  const companionArtifact = {
    name: "p-1.0.0-darwin-arm64-companion",
    path: "releases/plugin-p-v1.0.0/p-1.0.0-darwin-arm64-companion",
    sha256: digest(companionBytes),
    size: companionBytes.byteLength,
    url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-p-v1.0.0/p-1.0.0-darwin-arm64-companion",
  }
  await writeFile(join(root, packageArtifact.path), packageBytes)
  await writeFile(join(root, companionArtifact.path), companionBytes)
  await writeFile(
    join(root, "release-plan.json"),
    `${JSON.stringify({
      releases: [{ assets: [packageArtifact, companionArtifact], tag: "plugin-p-v1.0.0" }],
      schema: "convax.release-plan/1",
    })}\n`,
  )
  const item = {
    companions: [
      {
        command: "companion",
        targets: [{ arch: "arm64", artifact: companionArtifact, platform: "darwin" }],
        version: "1.0.0",
      },
    ],
    compatibility: { convax: ">=0.1.0" },
    delivery: { kind: "artifact", ...packageArtifact },
    id: "p",
    kind: "plugin",
    manifest: {
      id: "p",
      name: "P",
      runtime: { command: "companion", type: "mcp-stdio" },
      schema: "convax.plugin/2",
      version: "1.0.0",
    },
    presentation: { name: "P" },
    version: "1.0.0",
    yanked: false,
  } as RegistryPackage
  return { companionBytes, item, packageBytes, root }
}

test("development Official artifacts prepare exact package and companion bytes from a linked release plan", async () => {
  const { companionBytes, item, packageBytes, root } = await fixture()
  const store = await DevelopmentOfficialMarketplaceArtifacts.load(root)

  const candidate = await store.verifiedCandidate(item, { arch: "arm64", platform: "darwin" })

  expect(candidate.artifactBytes).toEqual(packageBytes)
  expect(candidate.companionBytes).toEqual({ companion: companionBytes })
})

test("development Official artifacts reject undeclared bytes and path aliases", async () => {
  const { item, root } = await fixture()
  const store = await DevelopmentOfficialMarketplaceArtifacts.load(root)
  const changed = {
    ...item,
    delivery: { ...item.delivery, sha256: "0".repeat(64) },
  } as RegistryPackage
  await expect(store.verifiedCandidate(changed, { arch: "arm64", platform: "darwin" })).rejects.toThrow(
    "not declared",
  )

  const aliasRoot = join(await realpath(tmpdir()), `convax-official-link-alias-${crypto.randomUUID()}`)
  await mkdir(aliasRoot)
  await symlink(root, join(aliasRoot, "linked"))
  await expect(DevelopmentOfficialMarketplaceArtifacts.load(join(aliasRoot, "linked"))).rejects.toThrow("canonical")
})
