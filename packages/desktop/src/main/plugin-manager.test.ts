import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { parseWebPluginManifest } from "../plugin-contracts"
import { WebPluginManager } from "./plugin-manager"

const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-manager-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["canvas.node.read", "agent.prompt"],
    contributes: {
      canvas: {
        renderer: {
          create: true,
          extensions: [".SCENE"],
          height: 640,
          mimeTypes: ["Application/X-Convax-Scene"],
          nodeKinds: ["scene.director"],
          width: 960,
        },
        toolbar: [{ command: "scene.render", id: "render", title: "Render" }],
      },
    },
    description: "A sandboxed director surface",
    entry: "web/index.html",
    id: "director-stage",
    name: "Director Stage",
    schema: "convax.plugin/1",
    skill: "skills/director/SKILL.md",
    version: "1.2.3-beta.1+desktop",
    ...overrides,
  }
}

async function writePackage(root: string, value: Record<string, unknown> = manifest()) {
  await fs.mkdir(path.join(root, "web"), { recursive: true })
  await fs.mkdir(path.join(root, "skills", "director"), { recursive: true })
  await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(value))
  await fs.writeFile(path.join(root, "web", "index.html"), "<!doctype html><title>Director</title>")
  await fs.writeFile(path.join(root, "web", "runtime.js"), "globalThis.director = true")
  await fs.writeFile(path.join(root, "skills", "director", "SKILL.md"), "# Director\n")
}

describe("parseWebPluginManifest", () => {
  test("parses the versioned manifest and canonicalizes match values", () => {
    expect(parseWebPluginManifest(manifest())).toEqual({
      ...manifest(),
      capabilities: ["canvas.node.read", "agent.prompt"],
      contributes: {
        canvas: {
          renderer: {
            create: true,
            extensions: [".scene"],
            height: 640,
            mimeTypes: ["application/x-convax-scene"],
            nodeKinds: ["scene.director"],
            width: 960,
          },
          toolbar: [{ command: "scene.render", id: "render", title: "Render" }],
        },
      },
      schema: "convax.plugin/1" as const,
    })
  })

  test("requires a supported schema, kebab id, SemVer, and HTML entry", () => {
    expect(() => parseWebPluginManifest(manifest({ schema: "convax.plugin/2" }))).toThrow("schema")
    expect(() => parseWebPluginManifest(manifest({ id: "DirectorStage" }))).toThrow("kebab-case")
    expect(() => parseWebPluginManifest(manifest({ id: "con" }))).toThrow("Windows filename")
    expect(() => parseWebPluginManifest(manifest({ version: "01.2.3" }))).toThrow("SemVer")
    expect(() => parseWebPluginManifest(manifest({ entry: "web/index.js" }))).toThrow("HTML")
  })

  test("rejects undeclared capabilities and renderer or toolbar ambiguity", () => {
    expect(() => parseWebPluginManifest(manifest({ capabilities: ["filesystem.full"] }))).toThrow("capability")
    expect(() => parseWebPluginManifest(manifest({
      contributes: { canvas: { renderer: { create: false } } },
    }))).toThrow("creatable")
    expect(() => parseWebPluginManifest(manifest({
      contributes: {
        canvas: {
          renderer: { extensions: [".scene"] },
          toolbar: [
            { command: "first", id: "same", title: "First" },
            { command: "second", id: "same", title: "Second" },
          ],
        },
      },
    }))).toThrow("duplicate ids")
  })

  test("rejects traversal and Windows-unsafe entry or skill paths", () => {
    for (const entry of [
      "../index.html",
      "web\\index.html",
      "C:/plugin/index.html",
      "web/con.txt/index.html",
      "web/file:stream.html",
      "web/index.html.",
      "web//index.html",
    ]) expect(() => parseWebPluginManifest(manifest({ entry }))).toThrow()
    for (const skill of ["skills/../SKILL.md", "skills/PRN/SKILL.md", "skills/SKILL.md "]) {
      expect(() => parseWebPluginManifest(manifest({ skill }))).toThrow()
    }
  })

  test("rejects unknown fields instead of silently ignoring manifest mistakes", () => {
    expect(() => parseWebPluginManifest({ ...manifest(), executable: "server.js" })).toThrow("unsupported field")
    expect(() => parseWebPluginManifest(manifest({
      contributes: { canvas: { renderer: { create: true, executable: "server.js" } } },
    }))).toThrow("unsupported field")
  })
})

describe("WebPluginManager", () => {
  test("installs, lists, resolves contained assets, and atomically uninstalls a package", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    const manager = new WebPluginManager(path.join(root, "installed"))

    const installed = await manager.install(source)
    expect(installed.id).toBe("director-stage")
    expect(installed.contributes.canvas.renderer.extensions).toEqual([".scene"])
    expect(JSON.stringify(installed)).not.toContain(root)
    expect(await manager.list()).toEqual([installed])
    expect(await manager.resolveAsset("director-stage", "web/index.html")).toBe(
      await fs.realpath(path.join(root, "installed", "director-stage", "web", "index.html")),
    )
    expect(await manager.uninstall("director-stage")).toBe(true)
    expect(await manager.uninstall("director-stage")).toBe(false)
    expect(await manager.list()).toEqual([])
  })

  test("installs an in-memory marketplace bundle through the same validation", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const installed = await manager.installBundle({
      files: {
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: "SKILL.md" })),
        "index.html": "<!doctype html><title>Bundled</title>",
        "SKILL.md": new TextEncoder().encode("# Bundled skill\n"),
      },
    })

    expect(installed.id).toBe("director-stage")
    expect(await fs.readFile(await manager.resolveAsset(installed.id, "SKILL.md"), "utf8")).toContain("Bundled skill")
  })

  test("requires real HTML and SKILL.md files and leaves no staging state on failure", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    await fs.rm(path.join(source, "web", "index.html"))
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)

    await expect(manager.install(source)).rejects.toThrow("entry does not exist")
    expect(await fs.readdir(installRoot)).toEqual([])

    await fs.writeFile(path.join(source, "web", "index.html"), "ok")
    await fs.rm(path.join(source, "skills", "director", "SKILL.md"))
    await fs.mkdir(path.join(source, "skills", "director", "SKILL.md"))
    await expect(manager.install(source)).rejects.toThrow("regular file")
    expect(await fs.readdir(installRoot)).toEqual([])
  })

  test("rejects symbolic links instead of importing or resolving through them", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    const outside = path.join(root, "outside.js")
    await fs.writeFile(outside, "secret")
    await fs.symlink(outside, path.join(source, "web", "linked.js"))
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await expect(manager.install(source)).rejects.toThrow(/symbolic links|escapes/)

    await fs.rm(path.join(source, "web", "linked.js"))
    await manager.install(source)
    await fs.symlink(outside, path.join(installRoot, "director-stage", "web", "linked.js"))
    await expect(manager.resolveAsset("director-stage", "web/linked.js")).rejects.toThrow(/symbolic link|escapes/)
    await expect(manager.resolveAsset("director-stage", "../outside.js")).rejects.toThrow("relative path")
  })

  test("enforces entry count, per-file, and total package limits", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    const tinyCount = new WebPluginManager(path.join(root, "count"), { maxEntryCount: 3 })
    await expect(tinyCount.install(source)).rejects.toThrow("entry count")

    const tinyFile = new WebPluginManager(path.join(root, "file"), { maxFileBytes: 80, maxTotalBytes: 1_000 })
    await expect(tinyFile.install(source)).rejects.toThrow(/per-file|manifest exceeds/)

    const total = new WebPluginManager(path.join(root, "total"), { maxFileBytes: 1_000, maxTotalBytes: 1_000 })
    await expect(total.installBundle({
      files: {
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined })),
        "index.html": "x".repeat(700),
      },
    })).rejects.toThrow("total size")
  })

  test("does not replace an installed plugin or expose externally tampered entries", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.install(source)
    await expect(manager.install(source)).rejects.toThrow("already installed")

    await fs.rm(path.join(installRoot, "director-stage", "web", "index.html"))
    expect(await manager.list()).toEqual([])
  })

  test("rejects unsafe bundle names and file-directory collisions", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const manifestJson = JSON.stringify(manifest({ entry: "index.html", skill: undefined }))
    await expect(manager.installBundle({
      files: { "CON/file.txt": "x", "index.html": "x", "manifest.json": manifestJson },
    })).rejects.toThrow("Windows filename")
    await expect(manager.installBundle({
      files: { "asset": "x", "asset/file.txt": "x", "index.html": "x", "manifest.json": manifestJson },
    })).rejects.toThrow("both a file and directory")
  })
})
