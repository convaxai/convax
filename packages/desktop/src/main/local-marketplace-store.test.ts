import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { computeSourceKey } from "@convax/marketplace"

import { LocalMarketplaceStore } from "./local-marketplace-store"

const roots: string[] = []

async function directory(label: string) {
  const root = await fs.mkdtemp(path.join(tmpdir(), `convax-local-${label}-`))
  roots.push(root)
  return root
}

function localStore(options: Omit<ConstructorParameters<typeof LocalMarketplaceStore>[0], "transition">) {
  return new LocalMarketplaceStore({
    transition: {
      async run(input) {
        await input.commitIndex()
      },
    },
    ...options,
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("LocalMarketplaceStore", () => {
  test("creates independent stable source identities for multiple Local instances", async () => {
    const firstRoot = await directory("first")
    const secondRoot = await directory("second")
    const first = localStore({ marketplaceId: "local-a", root: firstRoot })
    const second = localStore({ marketplaceId: "local-b", root: secondRoot })

    const firstIdentity = await first.initialize()
    const secondIdentity = await second.initialize()
    expect(firstIdentity.sourceInstanceId).not.toBe(secondIdentity.sourceInstanceId)
    expect((await localStore({ marketplaceId: "local-a", root: firstRoot }).initialize()).sourceInstanceId).toBe(
      firstIdentity.sourceInstanceId,
    )
  })

  test("single-flights concurrent initialization and never returns competing source identities", async () => {
    const root = await directory("concurrent-identity")
    const store = localStore({ marketplaceId: "convax-local", root })
    const identities = await Promise.all(Array.from({ length: 16 }, () => store.initialize()))
    expect(new Set(identities.map((entry) => entry.sourceInstanceId)).size).toBe(1)
  })

  test("fails degraded when identity is missing beside prior index or package authority", async () => {
    const root = await directory("missing-identity")
    await fs.writeFile(
      path.join(root, "index-v1.json"),
      JSON.stringify({ packages: [], revision: 1, schema: "convax.local-marketplace-index/1" }),
    )
    await expect(localStore({ marketplaceId: "convax-local", root }).initialize()).rejects.toThrow(
      "identity is missing",
    )
    expect(await fs.readdir(root)).toEqual(["index-v1.json"])
  })

  test.each([
    [
      "plugin",
      "manifest.json",
      '{"schema":"convax.plugin/8","id":"local-plugin","name":"Local Plugin","description":"Local plugin","version":"1.0.0","hostApi":{"major":3,"required":[],"optional":[]},"capabilities":["projects.read"],"contributes":{}}',
    ],
    ["skill", "SKILL.md", "---\nname: local-skill\ndescription: Local skill\n---\n"],
    [
      "mcp-server",
      "server.json",
      '{"$schema":"https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json","name":"io.example/local","description":"Local MCP Server","version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://mcp.example.com/mcp"}]}',
    ],
  ] as const)("imports one strict %s root into an immutable snapshot", async (kind, marker, contents) => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, marker), contents)
    const store = localStore({ marketplaceId: "convax-local", root })
    const imported = await store.importDirectory(source)
    expect(imported.kind).toBe(kind)
    expect(imported.revision).toBe(1)
    expect(imported.snapshotKey.startsWith(`${kind}/`)).toBe(true)
    const snapshotDirectory = store.resolveSnapshotDirectory(imported)
    expect(await fs.readFile(path.join(snapshotDirectory, marker), "utf8")).toBe(contents)

    await fs.writeFile(path.join(source, marker), `${contents}\nchanged`)
    expect(await fs.readFile(path.join(snapshotDirectory, marker), "utf8")).toBe(contents)
    expect(await fs.readFile(path.join(root, "index-v1.json"), "utf8")).not.toContain(root)
  })

  test("projects only canonical v8 contribution fields into Local runtime surfaces", async () => {
    const root = await directory("runtime-surface-store")
    const store = localStore({ marketplaceId: "convax-local", root })
    const identity = await store.initialize()
    const sourceKey = computeSourceKey({ kind: "local", ...identity })
    const cases = [
      {
        expected: "none",
        id: "authority-only",
        manifest: {
          capabilities: ["projects.read"],
          contributes: {},
          description: "Authority only",
          hostApi: { major: 3, optional: [], required: [] },
          name: "Authority only",
          schema: "convax.plugin/8",
          version: "1.0.0",
        },
      },
      {
        expected: "agent",
        id: "agent-hook",
        manifest: {
          capabilities: [],
          contributes: {},
          description: "Agent hook",
          hooks: "hook.mjs",
          hostApi: { major: 3, optional: [], required: [] },
          name: "Agent hook",
          schema: "convax.plugin/8",
          version: "1.0.0",
        },
      },
      {
        expected: "agent-and-convax",
        id: "canvas-surface",
        manifest: {
          capabilities: [],
          contributes: { canvas: { renderer: { create: true } } },
          description: "Canvas surface",
          entry: "index.html",
          hostApi: { major: 3, optional: [], required: ["host.context.get"] },
          name: "Canvas surface",
          schema: "convax.plugin/8",
          version: "1.0.0",
        },
      },
    ] as const

    for (const item of cases) {
      const source = await directory(item.id)
      await fs.writeFile(
        path.join(source, "manifest.json"),
        JSON.stringify({ ...item.manifest, id: item.id }),
      )
      const imported = await store.importDirectory(source)
      const projected = await store.projectCatalogItem(imported, sourceKey)
      expect(projected.runtimeSurface).toBe(item.expected)
      expect(projected.presentation.description).toBe(item.manifest.description)
    }
  })

  test("treats an exact duplicate as a no-op without advancing revision", async () => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: same\ndescription: same\n---\n")
    const store = localStore({ marketplaceId: "convax-local", root })
    const first = await store.importDirectory(source)
    const second = await store.importDirectory(source)
    expect(second).toEqual(first)
    expect((await store.list()).revision).toBe(1)
  })

  test("rejects zero or multiple root markers without publishing an index entry", async () => {
    const root = await directory("store")
    const source = await directory("source")
    const store = localStore({ marketplaceId: "convax-local", root })
    await fs.writeFile(path.join(source, "README.md"), "nothing")
    await expect(store.importDirectory(source)).rejects.toThrow("exactly one root marker")
    await fs.writeFile(path.join(source, "manifest.json"), "{}")
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: conflict\ndescription: conflict\n---\n")
    await expect(store.importDirectory(source)).rejects.toThrow("exactly one root marker")
    expect((await store.list()).packages).toEqual([])
  })

  test("rejects symlinks, unsafe portable names and special files", async () => {
    const root = await directory("store")
    const source = await directory("source")
    const store = localStore({ marketplaceId: "convax-local", root })
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: unsafe\ndescription: unsafe\n---\n")
    await fs.symlink(path.join(source, "SKILL.md"), path.join(source, "linked.md"))
    await expect(store.importDirectory(source)).rejects.toThrow("symbolic links")
    await fs.rm(path.join(source, "linked.md"))
    await fs.writeFile(path.join(source, "CON.txt"), "reserved")
    await expect(store.importDirectory(source)).rejects.toThrow("unsafe path segment")
  })

  test("detects source mutation across the copy boundary and leaves no visible snapshot", async () => {
    const root = await directory("store")
    const source = await directory("source")
    const skill = path.join(source, "SKILL.md")
    await fs.writeFile(skill, "---\nname: unstable\ndescription: unstable\n---\n")
    const store = localStore({
      beforeSourceRecheck: async () => {
        await fs.writeFile(skill, "---\nname: unstable\ndescription: changed\n---\n")
      },
      marketplaceId: "convax-local",
      root,
    })
    await expect(store.importDirectory(source)).rejects.toThrow("changed during import")
    expect((await store.list()).packages).toEqual([])
  })

  test("keeps MCP snapshots inert by rejecting executable and script content", async () => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, "server.json"), '{"name":"io.example/local","version":"1.0.0","remotes":[]}')
    await fs.writeFile(path.join(source, "server.js"), "console.log('must not execute')")
    await expect(localStore({ marketplaceId: "convax-local", root }).importDirectory(source)).rejects.toThrow(
      "Local MCP snapshot contains executable or server script content",
    )
  })

  test.each([
    ["plugin", "manifest.json", '{"schema":"convax.plugin/999","id":"bad","version":"1.0.0"}'],
    ["skill", "SKILL.md", "---\nname: bad\n---\n"],
    ["mcp-server", "server.json", '{"name":"not/a-valid-package"}'],
  ] as const)("does not publish an invalid %s snapshot or advance its index", async (_kind, marker, contents) => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, marker), contents)
    const store = localStore({ marketplaceId: "convax-local", root })
    await expect(store.importDirectory(source)).rejects.toThrow()
    expect(await store.list()).toMatchObject({ packages: [], revision: 0 })
    await expect(fs.readdir(path.join(root, "snapshots"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("rejects active SVG presentation bytes from an otherwise inert Local MCP snapshot", async () => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.mkdir(path.join(source, "assets"))
    await fs.writeFile(
      path.join(source, "server.json"),
      '{"$schema":"https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json","name":"io.example/local","version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://mcp.example.com/mcp"}]}',
    )
    await fs.writeFile(path.join(source, "assets", "active.svg"), "<svg><script>alert(1)</script></svg>")
    const store = localStore({ marketplaceId: "convax-local", root })
    await expect(store.importDirectory(source)).rejects.toThrow("script content")
    expect((await store.list()).packages).toEqual([])
  })

  test("keeps a referenced missing Local source degraded instead of creating a new identity", async () => {
    const parent = await directory("parent")
    const missing = path.join(parent, "missing-local")
    const store = localStore({
      hasRetainedReferences: async () => true,
      marketplaceId: "convax-local",
      root: missing,
    })
    await expect(store.initialize()).rejects.toThrow("degraded")
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("rejects a symlink root and multiply-linked files", async () => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: linked\ndescription: linked\n---\n")
    const linkedRoot = path.join(await directory("links"), "source")
    await fs.symlink(source, linkedRoot)
    await expect(localStore({ marketplaceId: "convax-local", root }).importDirectory(linkedRoot)).rejects.toThrow(
      "symbolic link",
    )
    await fs.link(path.join(source, "SKILL.md"), path.join(source, "README.md"))
    await expect(localStore({ marketplaceId: "convax-local", root }).importDirectory(source)).rejects.toThrow(
      "multiple hard links",
    )
  })

  test("retains the committed index and immutable snapshot when transition finalization crashes", async () => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: durable\ndescription: durable\n---\n")
    const store = new LocalMarketplaceStore({
      marketplaceId: "convax-local",
      root,
      transition: {
        async run(input) {
          await input.commitIndex()
          throw new Error("simulated crash after commit point")
        },
      },
    })

    await expect(store.importDirectory(source)).rejects.toThrow("simulated crash")
    const [committed] = (await store.list()).packages
    expect(committed?.id).toBe("durable")
    await expect(
      fs.readFile(path.join(store.resolveSnapshotDirectory(committed!), "SKILL.md"), "utf8"),
    ).resolves.toContain("name: durable")
  })

  test("cancels before publication without advancing the Local index", async () => {
    const root = await directory("store")
    const source = await directory("source")
    await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: canceled\ndescription: canceled\n---\n")
    const controller = new AbortController()
    controller.abort("user canceled")
    const store = localStore({ marketplaceId: "convax-local", root })
    await expect(store.importDirectory(source, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect((await store.list()).packages).toEqual([])
  })

  test("delayed GC removes only unreferenced superseded snapshots and always keeps the current revision", async () => {
    const root = await directory("store")
    const source = await directory("source")
    const skill = path.join(source, "SKILL.md")
    const store = localStore({ marketplaceId: "convax-local", root })
    await fs.writeFile(skill, "---\nname: evolving\ndescription: first\n---\n")
    const first = await store.importDirectory(source)
    await fs.writeFile(skill, "---\nname: evolving\ndescription: second\n---\n")
    const second = await store.importDirectory(source)
    const removed = await store.garbageCollect(async () => false)
    expect(removed).toEqual([first])
    expect((await store.list()).packages).toEqual([second])
    await expect(fs.lstat(store.resolveSnapshotDirectory(first))).rejects.toMatchObject({ code: "ENOENT" })
    expect((await fs.lstat(store.resolveSnapshotDirectory(second))).isDirectory()).toBe(true)
  })
})
