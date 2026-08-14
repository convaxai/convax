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

function fixture(id = "acme", sequence = 1, packageOverrides?: Record<string, unknown>[]) {
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
  const packages = packageOverrides ?? [
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

function pluginPackage(id: string, contributes: Record<string, unknown>) {
  return {
    compatibility: { convax: ">=0.1.0" },
    delivery: {
      kind: "artifact" as const,
      sha256: "b".repeat(64),
      size: 100,
      url: `https://github.com/acme/market/releases/download/${id}-v1.0.0/${id}.zip`,
    },
    id,
    kind: "plugin" as const,
    manifest: {
      capabilities: [],
      contributes,
      description: id,
      entry: "index.html",
      hostApi: { major: 3, optional: [], required: ["host.context.get"] },
      id,
      name: id,
      schema: "convax.plugin/8",
      version: "1.0.0",
    },
    presentation: { description: id, name: id },
    version: "1.0.0",
  }
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

test("preserves Plugin ownership when projecting a Registry Skill into a source-qualified candidate", async () => {
  const directory = await root()
  const ownedSkill = {
    compatibility: { convax: ">=0.1.0" },
    delivery: {
      kind: "artifact" as const,
      sha256: "a".repeat(64),
      size: 100,
      url: "https://github.com/acme/market/releases/download/skill-owned-v1.0.0/owned.zip",
    },
    id: "owned-skill",
    kind: "skill" as const,
    ownerPluginId: "owner-plugin",
    presentation: { description: "Owned", name: "Owned" },
    version: "1.0.0",
  }
  const remote = fixture("acme", 1, [ownedSkill])
  const manager = new NetworkMarketplaceManager({
    fetcher: { fetch: remote.fetch } as unknown as PinnedHttpsFetcher,
    root: directory,
  })
  const preview = await manager.preview(remote.descriptorUrl, "renderer-1")
  await manager.add(preview.previewToken, "renderer-1")

  expect((await manager.listCatalog())[0]).toMatchObject({
    id: ownedSkill.id,
    ownerPluginId: ownedSkill.ownerPluginId,
  })
})

test("resolves Showcase presentation only against the accepted Registry revision", async () => {
  const directory = await root()
  const remote = fixture("acme")
  const showcaseUrl = "https://acme.github.io/market/showcase-v2.json"
  const showcase = {
    marketplaceId: "acme",
    packages: [
      {
        id: "example",
        kind: "skill",
        presentation: {
          description: "Example",
          name: "Example",
          poster: {
            mime: "image/png",
            sha256: "c".repeat(64),
            size: 8,
            url: `https://github.com/acme/market/releases/download/registry-v2-${remote.registry.revision}/example.png`,
          },
        },
        version: "1.0.0",
      },
    ],
    revision: remote.registry.revision,
    schema: "convax.showcase/2",
  }
  const fetch = mock(async (url: string) =>
    url === showcaseUrl ? new TextEncoder().encode(JSON.stringify(showcase)) : remote.fetch(url),
  )
  const manager = new NetworkMarketplaceManager({
    fetcher: { fetch } as unknown as PinnedHttpsFetcher,
    root: directory,
  })
  const preview = await manager.preview(remote.descriptorUrl, "renderer-1")
  await manager.add(preview.previewToken, "renderer-1")
  const item = (await manager.listCatalog())[0]!

  await expect(manager.resolveShowcasePresentation(item)).resolves.toMatchObject({
    poster: { mime: "image/png", size: 8 },
  })
  expect(fetch).toHaveBeenCalledWith(
    showcaseUrl,
    "showcase",
    expect.objectContaining({ declaredUrl: showcaseUrl, maxBytes: 8 * 1024 * 1024 }),
  )
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

test("projects Network Plugin surfaces only after canonical v8 parsing", async () => {
  const directory = await root()
  const remote = fixture("acme", 1, [pluginPackage("canvas-plugin", { canvas: { renderer: { create: true } } })])
  const manager = new NetworkMarketplaceManager({
    fetcher: { fetch: remote.fetch } as unknown as PinnedHttpsFetcher,
    root: directory,
  })
  const preview = await manager.preview(remote.descriptorUrl, "renderer-1")
  await manager.add(preview.previewToken, "renderer-1")
  expect((await manager.listCatalog())[0]?.runtimeSurface).toBe("agent-and-convax")
})

test("keeps accepted Network metadata for diagnosis but refuses guessed legacy fields", async () => {
  const directory = await root()
  const legacy = pluginPackage("legacy-fields", { tools: [{ id: "guess-me" }] })
  delete (legacy.manifest as Record<string, unknown>).entry
  ;(legacy.manifest as Record<string, unknown>).hostApi = {
    major: 3,
    optional: [],
    required: [],
  }
  const remote = fixture("acme", 1, [legacy])
  const manager = new NetworkMarketplaceManager({
    fetcher: { fetch: remote.fetch } as unknown as PinnedHttpsFetcher,
    root: directory,
  })
  const preview = await manager.preview(remote.descriptorUrl, "renderer-1")
  await manager.add(preview.previewToken, "renderer-1")

  await expect(manager.listCatalog()).rejects.toThrow("unsupported field: tools")
  const source = await manager.listSources()
  const retained = await manager.resolvePackage({
    id: "legacy-fields",
    kind: "plugin",
    sourceKey: source[0]!.sourceKey,
    version: "1.0.0",
  })
  expect(retained.manifest?.contributes).toEqual({ tools: [{ id: "guess-me" }] })
})
