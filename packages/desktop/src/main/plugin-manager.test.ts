import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { compareWebPluginVersions, parseWebPluginManifest } from "../plugin-contracts"
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

const recoveryUuid1 = "00000000-0000-4000-8000-000000000001"
const recoveryUuid2 = "00000000-0000-4000-8000-000000000002"

function simpleBundle(version: string, content: string, id = "director-stage") {
  return {
    files: {
      "index.html": content,
      "manifest.json": JSON.stringify(manifest({ entry: "index.html", id, skill: undefined, version })),
    },
  }
}

async function writeSimplePackage(root: string, version: string, content: string, id = "director-stage") {
  const bundle = simpleBundle(version, content, id)
  await fs.mkdir(root, { recursive: true })
  await Promise.all(
    Object.entries(bundle.files).map(([relativePath, value]) => fs.writeFile(path.join(root, relativePath), value)),
  )
}

function testBundleDigest(bundle: { files: Readonly<Record<string, string | Uint8Array>> }) {
  const digest = createHash("sha256")
  const files = Object.entries(bundle.files)
    .map(([relativePath, content]) => ({
      content: typeof content === "string" ? Buffer.from(content) : Buffer.from(content),
      relativePath,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  for (const file of files) {
    digest.update(String(Buffer.byteLength(file.relativePath)))
    digest.update(":")
    digest.update(file.relativePath)
    digest.update(":")
    digest.update(String(file.content.byteLength))
    digest.update(":")
    digest.update(file.content)
  }
  return digest.digest("hex")
}

describe("parseWebPluginManifest", () => {
  test("compares stable, prerelease, numeric prerelease, and build versions", () => {
    expect(compareWebPluginVersions("1.0.0", "1.0.0-rc.9")).toBeGreaterThan(0)
    expect(compareWebPluginVersions("0.0.1-convax.2", "0.0.1-convax.1")).toBeGreaterThan(0)
    expect(compareWebPluginVersions("1.0.0-alpha.10", "1.0.0-alpha.2")).toBeGreaterThan(0)
    expect(compareWebPluginVersions("1.0.0+new", "1.0.0+old")).toBe(0)
    expect(compareWebPluginVersions("2.0.0", "10.0.0")).toBeLessThan(0)
    expect(() => compareWebPluginVersions("latest", "1.0.0")).toThrow("SemVer")
  })

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
    expect(() => parseWebPluginManifest(manifest({ schema: "convax.plugin/4" }))).toThrow("schema")
    expect(() => parseWebPluginManifest(manifest({ id: "DirectorStage" }))).toThrow("kebab-case")
    expect(() => parseWebPluginManifest(manifest({ id: "con" }))).toThrow("Windows filename")
    expect(() => parseWebPluginManifest(manifest({ version: "01.2.3" }))).toThrow("SemVer")
    expect(() => parseWebPluginManifest(manifest({ entry: "web/index.js" }))).toThrow("HTML")
  })

  test("rejects undeclared capabilities and renderer or toolbar ambiguity", () => {
    expect(() => parseWebPluginManifest(manifest({ capabilities: ["filesystem.full"] }))).toThrow("capability")
    expect(() =>
      parseWebPluginManifest(
        manifest({
          contributes: { canvas: { renderer: { create: false } } },
        }),
      ),
    ).toThrow("creatable")
    expect(() =>
      parseWebPluginManifest(
        manifest({
          contributes: {
            canvas: {
              renderer: { extensions: [".scene"] },
              toolbar: [
                { command: "first", id: "same", title: "First" },
                { command: "second", id: "same", title: "Second" },
              ],
            },
          },
        }),
      ),
    ).toThrow("duplicate ids")
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
    ])
      expect(() => parseWebPluginManifest(manifest({ entry }))).toThrow()
    for (const skill of ["skills/../SKILL.md", "skills/PRN/SKILL.md", "skills/SKILL.md "]) {
      expect(() => parseWebPluginManifest(manifest({ skill }))).toThrow()
    }
  })

  test("rejects unknown fields instead of silently ignoring manifest mistakes", () => {
    expect(() => parseWebPluginManifest({ ...manifest(), executable: "server.js" })).toThrow("unsupported field")
    expect(() =>
      parseWebPluginManifest(
        manifest({
          contributes: { canvas: { renderer: { create: true, executable: "server.js" } } },
        }),
      ),
    ).toThrow("unsupported field")
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
    expect(installed.contributes.canvas!.renderer?.extensions).toEqual([".scene"])
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

  test("reserves catalog ids and marks only host-installed built-in bundles as trusted", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    const manager = new WebPluginManager(path.join(root, "installed"), {}, ["director-stage"])
    await expect(manager.install(source)).rejects.toThrow("reserved for a built-in")

    const bundle = {
      files: {
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined })),
        "index.html": "<!doctype html><title>Built-in</title>",
      },
    }
    await expect(manager.installBundle(bundle)).rejects.toThrow("reserved for a built-in")
    const installed = await manager.installOrUpdateBuiltinBundle(bundle)
    expect(installed.trustedBuiltin).toBe(true)
    expect(await manager.isBuiltinBundleInstalled(bundle)).toBe(true)
    expect(await manager.list()).toEqual([installed])

    const updatedBundle = {
      files: {
        ...bundle.files,
        "index.html": "<!doctype html><title>Updated built-in</title>",
        "manifest.json": JSON.stringify(
          manifest({ entry: "index.html", skill: undefined, version: "1.2.3-beta.2+desktop" }),
        ),
      },
    }
    await expect(
      manager.installOrUpdateBuiltinBundle(updatedBundle, {
        legacyBundleDigests: [{ bundleDigest: testBundleDigest(bundle), version: "1.2.3-beta.1+desktop" }],
      }),
    ).resolves.toMatchObject({ trustedBuiltin: true })
    expect(await manager.isBuiltinBundleInstalled(bundle)).toBe(false)
    expect(await manager.isBuiltinBundleInstalled(updatedBundle)).toBe(true)

    const legacyRoot = path.join(root, "legacy")
    await new WebPluginManager(legacyRoot).installBundle(bundle)
    const legacy = new WebPluginManager(legacyRoot, {}, ["director-stage"])
    await expect(legacy.installOrUpdateBuiltinBundle(bundle)).resolves.toMatchObject({ trustedBuiltin: true })
    expect(await legacy.isBuiltinBundleInstalled(bundle)).toBe(true)
  })

  test("adopts only an exact host-listed legacy bundle before upgrading it", async () => {
    const root = await temporaryRoot()
    const oldBundle = {
      files: {
        "index.html": "<!doctype html><title>Legacy built-in</title>",
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined, version: "1.0.0" })),
      },
    }
    const currentBundle = {
      files: {
        "index.html": "<!doctype html><title>Current built-in</title>",
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined, version: "2.0.0" })),
      },
    }
    const legacyBundleDigests = [{ bundleDigest: testBundleDigest(oldBundle), version: "1.0.0" }]

    const installRoot = path.join(root, "installed")
    await new WebPluginManager(installRoot).installBundle(oldBundle)
    const manager = new WebPluginManager(installRoot, {}, ["director-stage"])
    await expect(manager.installOrUpdateBuiltinBundle(currentBundle, { legacyBundleDigests })).resolves.toMatchObject({
      trustedBuiltin: true,
      version: "2.0.0",
    })
    expect(await manager.isBuiltinBundleInstalled(currentBundle)).toBe(true)

    const forgedRoot = path.join(root, "forged")
    await new WebPluginManager(forgedRoot).installBundle({
      files: { ...oldBundle.files, "index.html": "<!doctype html><title>Forged</title>" },
    })
    const forged = new WebPluginManager(forgedRoot, {}, ["director-stage"])
    await expect(forged.installOrUpdateBuiltinBundle(currentBundle, { legacyBundleDigests })).rejects.toThrow(
      "non-built-in Plugin",
    )

    await fs.writeFile(path.join(installRoot, "director-stage", "index.html"), "tampered")
    const nextBundle = {
      files: {
        ...currentBundle.files,
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined, version: "3.0.0" })),
      },
    }
    await expect(manager.installOrUpdateBuiltinBundle(nextBundle)).rejects.toThrow("do not match their provenance")
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
    await expect(
      total.installBundle({
        files: {
          "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined })),
          "index.html": "x".repeat(700),
        },
      }),
    ).rejects.toThrow("total size")
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

  test("atomically upgrades a validated bundle and rejects same-version or downgrade replacement", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const bundle = (version: string, application: string) => ({
      files: {
        "index.html": application,
        "manifest.json": JSON.stringify(manifest({ entry: "index.html", skill: undefined, version })),
      },
    })
    await manager.installBundle(bundle("1.0.0", "old application"))

    await expect(
      manager.installBundle(bundle("1.1.0", "new application"), { replaceExisting: true }),
    ).resolves.toMatchObject({ version: "1.1.0" })
    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "new application",
    )
    await expect(manager.installBundle(bundle("1.1.0", "same application"), { replaceExisting: true })).rejects.toThrow(
      "newer version",
    )
    await expect(
      manager.installBundle(bundle("1.0.0", "downgraded application"), { replaceExisting: true }),
    ).rejects.toThrow("newer version")
    await expect(
      manager.installBundle(
        {
          files: {
            "manifest.json": JSON.stringify(manifest({ entry: "missing.html", skill: undefined, version: "2.0.0" })),
          },
        },
        { replaceExisting: true },
      ),
    ).rejects.toThrow("does not exist")
    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "new application",
    )
  })

  test("restores the unique validated backup after a crash between the two update renames", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.installBundle(simpleBundle("1.0.0", "old application"))
    const target = path.join(installRoot, "director-stage")
    const backup = path.join(installRoot, `.replaced-director-stage-${recoveryUuid1}`)
    const staging = path.join(installRoot, `.staging-bundle-${recoveryUuid2}`)
    await fs.rename(target, backup)
    await writeSimplePackage(staging, "2.0.0", "unpublished application")

    await manager.reconcilePublicationState()

    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "old application",
    )
    expect(await manager.list()).toEqual([expect.objectContaining({ id: "director-stage", version: "1.0.0" })])
    expect(await fs.readdir(installRoot)).toEqual(["director-stage"])
  })

  test("keeps a valid canonical update and removes its validated stale backup", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.installBundle(simpleBundle("1.0.0", "old application"))
    const target = path.join(installRoot, "director-stage")
    const backup = path.join(installRoot, `.replaced-director-stage-${recoveryUuid1}`)
    await fs.rename(target, backup)
    await manager.installBundle(simpleBundle("2.0.0", "published application"))

    await manager.reconcilePublicationState()

    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "published application",
    )
    expect(await fs.readdir(installRoot)).toEqual(["director-stage"])
  })

  test("does not guess between ambiguous backups or trust invalid transaction remnants", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.installBundle(simpleBundle("1.0.0", "first backup"))
    const target = path.join(installRoot, "director-stage")
    const firstBackup = path.join(installRoot, `.replaced-director-stage-${recoveryUuid1}`)
    const secondBackup = path.join(installRoot, `.replaced-director-stage-${recoveryUuid2}`)
    await fs.rename(target, firstBackup)
    await writeSimplePackage(secondBackup, "0.9.0", "second backup")

    await expect(manager.reconcilePublicationState()).rejects.toThrow("did not accept every transaction remnant")
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await fs.lstat(firstBackup)).isDirectory()).toBe(true)
    expect((await fs.lstat(secondBackup)).isDirectory()).toBe(true)

    await fs.rm(secondBackup, { recursive: true })
    const mismatched = path.join(installRoot, `.replaced-director-stage-${recoveryUuid2}`)
    await writeSimplePackage(mismatched, "3.0.0", "wrong identity", "different-plugin")
    await expect(manager.reconcilePublicationState()).rejects.toThrow("did not accept every transaction remnant")
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await fs.lstat(firstBackup)).isDirectory()).toBe(true)
    expect((await fs.lstat(mismatched)).isDirectory()).toBe(true)
  })

  test("rejects symlink remnants without disturbing a valid canonical package", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.installBundle(simpleBundle("2.0.0", "canonical application"))
    const outside = path.join(root, "outside")
    await writeSimplePackage(outside, "3.0.0", "outside application")
    const staging = path.join(installRoot, `.staging-director-stage-${recoveryUuid1}`)
    await fs.symlink(outside, staging)
    const arbitrary = path.join(installRoot, ".replaced-director-stage-not-a-host-uuid")
    await writeSimplePackage(arbitrary, "4.0.0", "arbitrary application")

    await expect(manager.reconcilePublicationState()).rejects.toThrow("did not accept every transaction remnant")
    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "canonical application",
    )
    expect((await fs.lstat(staging)).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(arbitrary)).isDirectory()).toBe(true)
  })

  test("restores only a provenance-verified built-in backup", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const bundle = simpleBundle("1.0.0", "trusted built-in")
    const manager = new WebPluginManager(installRoot, {}, ["director-stage"])
    await manager.installOrUpdateBuiltinBundle(bundle)
    const target = path.join(installRoot, "director-stage")
    const backup = path.join(installRoot, `.replaced-director-stage-${recoveryUuid1}`)
    await fs.rename(target, backup)

    await manager.reconcilePublicationState()
    expect(await manager.isBuiltinBundleInstalled(bundle)).toBe(true)
    expect(await manager.list()).toEqual([
      expect.objectContaining({ id: "director-stage", trustedBuiltin: true, version: "1.0.0" }),
    ])

    await fs.rename(target, backup)
    await fs.rm(path.join(backup, ".convax-builtin.json"))
    await expect(manager.reconcilePublicationState()).rejects.toThrow("did not accept every transaction remnant")
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("reports cleanup failure without replacing the canonical package and retries safely", async () => {
    if (process.platform === "win32") return
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.installBundle(simpleBundle("1.0.0", "old application"))
    const target = path.join(installRoot, "director-stage")
    const backup = path.join(installRoot, `.replaced-director-stage-${recoveryUuid1}`)
    await fs.rename(target, backup)
    await manager.installBundle(simpleBundle("2.0.0", "canonical application"))
    await fs.chmod(installRoot, 0o500)
    try {
      await expect(manager.reconcilePublicationState()).rejects.toThrow("did not accept every transaction remnant")
    } finally {
      await fs.chmod(installRoot, 0o700)
    }

    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "canonical application",
    )
    expect((await fs.lstat(backup)).isDirectory()).toBe(true)
    await manager.reconcilePublicationState()
    await expect(fs.lstat(backup)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("rejects unsafe bundle names and file-directory collisions", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const manifestJson = JSON.stringify(manifest({ entry: "index.html", skill: undefined }))
    await expect(
      manager.installBundle({
        files: { "CON/file.txt": "x", "index.html": "x", "manifest.json": manifestJson },
      }),
    ).rejects.toThrow("Windows filename")
    await expect(
      manager.installBundle({
        files: { asset: "x", "asset/file.txt": "x", "index.html": "x", "manifest.json": manifestJson },
      }),
    ).rejects.toThrow("both a file and directory")
    await expect(
      manager.installBundle({
        files: { ".Convax-Builtin.json": "{}", "index.html": "x", "manifest.json": manifestJson },
      }),
    ).rejects.toThrow("reserved by the host")
  })
})
