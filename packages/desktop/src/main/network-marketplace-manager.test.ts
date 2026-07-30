import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, mock, test } from "bun:test"
import { canonicalJson, sha256Hex } from "@convax/marketplace"

import { NetworkMarketplaceManager } from "./network-marketplace-manager"
import type { PinnedHttpsFetcher } from "./pinned-https-fetch"

const roots: string[] = []

async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "convax-network-marketplace-"))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => fs.rm(entry, { force: true, recursive: true })))
})

function fixture(id = "acme", sequence = 1) {
  const descriptorUrl = `https://${id}.github.io/market/marketplace.json`
  const registryUrl = `https://${id}.github.io/market/registry-v2.json`
  const descriptor = {
    compatibility: { convax: ">=0.1.0" },
    delivery: { kind: "github-pages-releases" },
    id,
    name: id,
    publisher: { name: id },
    registry: { v2: { url: registryUrl } },
    repository: { name: "market", owner: id },
    schema: "convax.marketplace/1",
    showcase: { v2: { url: `https://${id}.github.io/market/showcase-v2.json` } },
  }
  const packages = [
    {
      compatibility: { convax: ">=0.1.0" },
      delivery: {
        kind: "artifact" as const,
        sha256: "a".repeat(64),
        size: 100,
        url: `https://github.com/${id}/market/releases/download/skill-example-v1.0.0/example.zip`,
      },
      id: "example",
      kind: "skill" as const,
      presentation: { description: "Example", name: "Example" },
      version: "1.0.0",
    },
  ]
  const registry = {
    marketplaceId: id,
    packages,
    revision: sha256Hex(canonicalJson(packages)),
    schema: "convax.registry/2",
    sequence,
  }
  const fetch = mock(async (url: string) =>
    new TextEncoder().encode(JSON.stringify(url === descriptorUrl ? descriptor : registry)),
  )
  return { descriptorUrl, fetch, registry }
}

test("binds previews to their renderer and keeps source order monotonic across removal", async () => {
  const directory = await root()
  const first = fixture("acme")
  const second = fixture("other")
  const manager = new NetworkMarketplaceManager({
    fetcher: {
      fetch: mock(async (url: string) => (url.startsWith("https://acme.") ? first.fetch(url) : second.fetch(url))),
    } as unknown as PinnedHttpsFetcher,
    root: directory,
  })
  const preview = await manager.preview(first.descriptorUrl, "renderer-1")
  await expect(manager.add(preview.previewToken, "renderer-2")).rejects.toThrow("expired")
  const retry = await manager.preview(first.descriptorUrl, "renderer-1")
  await manager.add(retry.previewToken, "renderer-1")
  expect((await manager.listCatalog())[0]).toMatchObject({
    catalogRevision: first.registry.revision,
    catalogSequence: first.registry.sequence,
    sourceOrder: 0,
  })
  await manager.remove("acme")
  const next = await manager.preview(second.descriptorUrl, "renderer-1")
  await manager.add(next.previewToken, "renderer-1")
  expect((await manager.listSources())[0]?.sourceOrder).toBe(1)
})

test("rejects a persisted graph whose nested descriptor or computed SourceKey was altered", async () => {
  const directory = await root()
  const file = path.join(directory, "sources-v1.json")
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify({
      nextSourceOrder: 1,
      revision: 1,
      schema: "convax.network-marketplace-sources/1",
      sources: [
        {
          descriptor: fixture("acme").registry,
          descriptorUrl: "https://acme.github.io/market/marketplace.json",
          sourceKey: "a".repeat(64),
          sourceOrder: 0,
        },
      ],
    }),
  )
  const manager = new NetworkMarketplaceManager({
    fetcher: { fetch: mock(async () => new Uint8Array()) } as unknown as PinnedHttpsFetcher,
    root: directory,
  })
  await expect(manager.listSources()).rejects.toThrow("unknown property")
})
