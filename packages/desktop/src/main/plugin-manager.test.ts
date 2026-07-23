import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { type WebPluginManifest, compareWebPluginVersions, parseWebPluginManifest } from "../plugin-contracts"
import { WebPluginManager, WebPluginPublicationDeferredError } from "./plugin-manager"

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

function ownedBundle(version: string, includeSkill = true) {
  const ownedManifest = {
    capabilities: [],
    contributes: {
      canvas: { renderer: { create: true, height: 320, width: 480 } },
      ...(includeSkill ? { skills: [{ name: "director-workflow", path: "skills/director-workflow" }] } : {}),
    },
    description: "Director workflow surface",
    entry: "index.html",
    id: "director-tools",
    name: "Director Tools",
    schema: "convax.plugin/4",
    version,
  }
  return {
    files: {
      "index.html": "<!doctype html><title>Director</title>",
      "manifest.json": JSON.stringify(ownedManifest),
      ...(includeSkill
        ? {
            "skills/director-workflow/SKILL.md": [
              "---",
              "name: director-workflow",
              "description: Direct a scene",
              "---",
            ].join("\n"),
          }
        : {}),
    },
  }
}

function projectCanvasManifest(overrides: Partial<WebPluginManifest> = {}): WebPluginManifest {
  return {
    capabilities: [
      "projects.read",
      "canvas.catalog.read",
      "canvas.document.read",
      "canvas.document.write",
      "canvas.events.subscribe",
    ],
    contributes: {
      skills: [{ name: "director-workflow", path: "skills/director-workflow" }],
    },
    description: "Project-wide Canvas automation",
    id: "director-tools",
    name: "Director Tools",
    schema: "convax.plugin/5",
    version: "1.0.0",
    ...overrides,
  }
}

const noOpPublication = async () => ({
  async activate() {},
  async commit() {},
  async publish() {},
  async rollback() {},
})

function activationFailurePublication(phases: string[]) {
  return {
    async activate() {
      phases.push("activate")
      throw new Error("simulated capability activation failure")
    },
    async commit() {
      phases.push("commit")
    },
    async deferToRecovery() {
      phases.push("defer")
    },
    async publish() {
      phases.push("publish")
    },
    async rollback() {
      phases.push("rollback")
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
    expect(() => parseWebPluginManifest(manifest({ schema: "convax.plugin/6" }))).toThrow("schema")
    expect(() => parseWebPluginManifest(manifest({ id: "DirectorStage" }))).toThrow("kebab-case")
    expect(() => parseWebPluginManifest(manifest({ id: "con" }))).toThrow("Windows filename")
    expect(() => parseWebPluginManifest(manifest({ version: "01.2.3" }))).toThrow("SemVer")
    expect(() => parseWebPluginManifest(manifest({ entry: "web/index.js" }))).toThrow("HTML")
  })

  test("parses a headless v5 Project/Canvas Plugin while preserving its owned Skills", () => {
    expect(parseWebPluginManifest(projectCanvasManifest())).toEqual(projectCanvasManifest())
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

  test("restores an installed Plugin when an owned-capability uninstall transaction cannot commit", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source")
    await writePackage(source)
    const manager = new WebPluginManager(path.join(root, "installed"))
    await manager.install(source)
    let activated = 0
    let published = 0
    let rolledBack = 0

    await expect(
      manager.uninstall("director-stage", {
        beforeRemove: async () => ({
          async activate() {
            activated += 1
            expect(await manager.list()).toEqual([])
          },
          async commit() {
            throw new Error("owned capability commit failed")
          },
          async publish() {
            published += 1
            expect((await manager.list()).map((plugin) => plugin.id)).toEqual(["director-stage"])
          },
          async rollback() {
            rolledBack += 1
          },
        }),
      }),
    ).rejects.toThrow("Plugin uninstall rollback failed")

    expect(published).toBe(1)
    expect(activated).toBe(1)
    expect(rolledBack).toBe(1)
    expect((await manager.list()).map((plugin) => plugin.id)).toEqual(["director-stage"])
  })

  test("activates host capabilities only after install/update publication and exposes the validated previous package", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const phases: string[] = []
    await manager.installBundle(simpleBundle("1.0.0", "first"), {
      beforePublish: async (_plugin, candidate) => {
        expect(candidate.previous).toBeUndefined()
        return {
          async activate() {
            phases.push("activate-install")
            expect((await manager.list())[0]?.version).toBe("1.0.0")
          },
          async commit() {
            phases.push("commit-install")
          },
          async publish() {
            phases.push("publish-install")
            expect(await manager.list()).toEqual([])
          },
          async rollback() {},
        }
      },
    })
    await manager.installBundle(simpleBundle("2.0.0", "second"), {
      beforePublish: async (_plugin, candidate) => {
        expect(candidate.previous?.plugin.version).toBe("1.0.0")
        expect(candidate.previous?.root).toBe(await fs.realpath(path.join(root, "installed", "director-stage")))
        return {
          async activate() {
            phases.push("activate-update")
            expect((await manager.list())[0]?.version).toBe("2.0.0")
          },
          async commit() {
            phases.push("commit-update")
          },
          async publish() {
            phases.push("publish-update")
            expect((await manager.list())[0]?.version).toBe("1.0.0")
          },
          async rollback() {},
        }
      },
      replaceExisting: true,
    })

    expect(phases).toEqual([
      "publish-install",
      "activate-install",
      "commit-install",
      "publish-update",
      "activate-update",
      "commit-update",
    ])
  })

  test("rejects staging or previous-package changes made during publication callbacks", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    let installRollback = 0

    await expect(
      manager.installBundle(simpleBundle("1.0.0", "candidate"), {
        beforePublish: async (_plugin, candidate) => ({
          async commit() {},
          async publish() {
            await fs.writeFile(path.join(candidate.root, "index.html"), "tampered candidate")
          },
          async rollback() {
            installRollback += 1
          },
        }),
      }),
    ).rejects.toThrow("changed before the package switch")
    expect(installRollback).toBe(1)
    expect(await manager.list()).toEqual([])

    await manager.installBundle(simpleBundle("1.0.0", "previous"))
    let updateRollback = 0
    await expect(
      manager.installBundle(simpleBundle("2.0.0", "candidate"), {
        beforePublish: async (_plugin, candidate) => ({
          async commit() {},
          async publish() {
            await fs.writeFile(path.join(candidate.previous!.root, "index.html"), "tampered previous")
          },
          async rollback() {
            updateRollback += 1
          },
        }),
        replaceExisting: true,
      }),
    ).rejects.toThrow("changed before the package switch")
    expect(updateRollback).toBe(1)
    expect((await manager.list())[0]?.version).toBe("1.0.0")
  })

  test("does not let staging cleanup failure mask publication success or typed recovery", async () => {
    const root = await temporaryRoot()
    const installationRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installationRoot)
    const originalRemove = fs.rm.bind(fs)
    let failCleanup = true
    const remove = spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (failCleanup && path.basename(String(target)).startsWith(".staging-bundle-")) {
        failCleanup = false
        throw new Error("simulated staging cleanup failure")
      }
      return originalRemove(target, options)
    })
    try {
      await expect(manager.installBundle(simpleBundle("1.0.0", "candidate"))).resolves.toMatchObject({
        version: "1.0.0",
      })
    } finally {
      remove.mockRestore()
    }

    const phases: string[] = []
    const originalRename = fs.rename.bind(fs)
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (
        path.basename(String(source)) === "director-stage" &&
        path.basename(String(destination)).startsWith(".staging-bundle-")
      ) {
        throw new Error("simulated rollback rename failure")
      }
      return originalRename(source, destination)
    })
    failCleanup = true
    const removeDeferred = spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (failCleanup && path.basename(String(target)).startsWith(".staging-bundle-")) {
        failCleanup = false
        throw new Error("simulated deferred cleanup failure")
      }
      return originalRemove(target, options)
    })
    try {
      await expect(
        manager.installBundle(simpleBundle("2.0.0", "candidate"), {
          beforePublish: async () => activationFailurePublication(phases),
          replaceExisting: true,
        }),
      ).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    } finally {
      removeDeferred.mockRestore()
      rename.mockRestore()
    }
  })

  test("defers capability recovery when a new Plugin package cannot be rolled back", async () => {
    const root = await temporaryRoot()
    const installationRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installationRoot)
    const phases: string[] = []
    const originalRename = fs.rename.bind(fs)
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (
        path.basename(String(source)) === "director-stage" &&
        path.basename(String(destination)).startsWith(".staging-bundle-")
      ) {
        throw new Error("simulated package rollback rename failure")
      }
      return originalRename(source, destination)
    })
    try {
      await expect(
        manager.installBundle(simpleBundle("1.0.0", "candidate"), {
          beforePublish: async () => activationFailurePublication(phases),
        }),
      ).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    } finally {
      rename.mockRestore()
    }

    expect(phases).toEqual(["publish", "activate", "defer"])
    expect(await manager.list()).toEqual([expect.objectContaining({ id: "director-stage", version: "1.0.0" })])
    await manager.reconcilePublicationState()
    expect((await fs.readdir(installationRoot)).filter((name) => name.startsWith("."))).toEqual([])
  })

  test("defers capability recovery when an updated Plugin package remains canonical", async () => {
    const root = await temporaryRoot()
    const installationRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installationRoot)
    await manager.installBundle(simpleBundle("1.0.0", "previous"))
    const phases: string[] = []
    const originalRename = fs.rename.bind(fs)
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (
        path.basename(String(source)) === "director-stage" &&
        path.basename(String(destination)).startsWith(".staging-bundle-")
      ) {
        throw new Error("simulated update rollback rename failure")
      }
      return originalRename(source, destination)
    })
    try {
      await expect(
        manager.installBundle(simpleBundle("2.0.0", "candidate"), {
          beforePublish: async () => activationFailurePublication(phases),
          replaceExisting: true,
        }),
      ).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    } finally {
      rename.mockRestore()
    }

    expect(phases).toEqual(["publish", "activate", "defer"])
    expect(await manager.list()).toEqual([expect.objectContaining({ version: "2.0.0" })])
    expect((await fs.readdir(installationRoot)).some((name) => name.startsWith(".replaced-director-stage-"))).toBe(true)
    await manager.reconcilePublicationState()
    expect(await manager.list()).toEqual([expect.objectContaining({ version: "2.0.0" })])
    expect((await fs.readdir(installationRoot)).filter((name) => name.startsWith("."))).toEqual([])
  })

  test("defers capability recovery when a failed update cannot restore its backup", async () => {
    const root = await temporaryRoot()
    const installationRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installationRoot)
    await manager.installBundle(simpleBundle("1.0.0", "previous"))
    const phases: string[] = []
    const originalRename = fs.rename.bind(fs)
    const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      const sourceName = path.basename(String(source))
      const destinationName = path.basename(String(destination))
      if (
        (sourceName.startsWith(".staging-bundle-") || sourceName.startsWith(".replaced-director-stage-")) &&
        destinationName === "director-stage"
      ) {
        throw new Error("simulated update switch or restore failure")
      }
      return originalRename(source, destination)
    })
    try {
      await expect(
        manager.installBundle(simpleBundle("2.0.0", "candidate"), {
          beforePublish: async () => ({
            async commit() {},
            async deferToRecovery() {
              phases.push("defer")
            },
            async publish() {
              phases.push("publish")
            },
            async rollback() {
              phases.push("rollback")
            },
          }),
          replaceExisting: true,
        }),
      ).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    } finally {
      rename.mockRestore()
    }

    expect(phases).toEqual(["publish", "defer"])
    expect(await manager.list()).toEqual([])
    await manager.reconcilePublicationState()
    expect(await manager.list()).toEqual([expect.objectContaining({ version: "1.0.0" })])
    expect((await fs.readdir(installationRoot)).filter((name) => name.startsWith("."))).toEqual([])
  })

  test("defers built-in update and uninstall capabilities when their package rollback fails", async () => {
    const root = await temporaryRoot()
    const installationRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installationRoot, {}, ["director-stage"])
    const initial = simpleBundle("1.0.0", "previous")
    const updated = simpleBundle("2.0.0", "candidate")
    await manager.installOrUpdateBuiltinBundle(initial)

    const updatePhases: string[] = []
    const originalRename = fs.rename.bind(fs)
    let rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (
        path.basename(String(source)) === "director-stage" &&
        path.basename(String(destination)).startsWith(".staging-bundle-")
      ) {
        throw new Error("simulated built-in rollback failure")
      }
      return originalRename(source, destination)
    })
    try {
      await expect(
        manager.installOrUpdateBuiltinBundle(updated, {
          beforePublish: async () => activationFailurePublication(updatePhases),
          legacyBundleDigests: [{ bundleDigest: testBundleDigest(initial), version: "1.0.0" }],
        }),
      ).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    } finally {
      rename.mockRestore()
    }
    expect(updatePhases).toEqual(["publish", "activate", "defer"])
    expect(await manager.list()).toEqual([expect.objectContaining({ trustedBuiltin: true, version: "2.0.0" })])
    await manager.reconcilePublicationState()

    const uninstallPhases: string[] = []
    rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (
        path.basename(String(source)).startsWith(".removed-director-stage-") &&
        path.basename(String(destination)) === "director-stage"
      ) {
        throw new Error("simulated uninstall rollback failure")
      }
      return originalRename(source, destination)
    })
    try {
      await expect(
        manager.uninstall("director-stage", {
          beforeRemove: async () => activationFailurePublication(uninstallPhases),
        }),
      ).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    } finally {
      rename.mockRestore()
    }
    expect(uninstallPhases).toEqual(["publish", "activate", "defer"])
    expect(await manager.list()).toEqual([])
    await manager.reconcilePublicationState()
    expect((await fs.readdir(installationRoot)).filter((name) => name.startsWith("."))).toEqual([])
  })

  test("revalidates a built-in staging package after publication callbacks", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"), {}, ["director-stage"])
    const initial = simpleBundle("1.0.0", "previous")
    await manager.installOrUpdateBuiltinBundle(initial)
    let rolledBack = 0

    await expect(
      manager.installOrUpdateBuiltinBundle(simpleBundle("2.0.0", "candidate"), {
        beforePublish: async (_plugin, candidate) => ({
          async commit() {},
          async publish() {
            await fs.writeFile(path.join(candidate.root, "index.html"), "tampered built-in candidate")
          },
          async rollback() {
            rolledBack += 1
          },
        }),
        legacyBundleDigests: [{ bundleDigest: testBundleDigest(initial), version: "1.0.0" }],
      }),
    ).rejects.toThrow(/changed before the package switch|provenance does not match/)

    expect(rolledBack).toBe(1)
    expect((await manager.list())[0]?.version).toBe("1.0.0")
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

  test("requires every v4 owned Skill directory to be present in the Plugin package", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const manifestV4 = {
      capabilities: [],
      contributes: {
        generation: {
          models: [],
          tools: [
            {
              acceptedInputs: [],
              description: "Run an operation",
              id: "operation.run",
              output: "text",
              title: "Run",
            },
          ],
        },
        skills: [{ name: "director-workflow", path: "skills/director-workflow" }],
      },
      description: "Director tools",
      id: "director-tools",
      name: "Director Tools",
      runtime: { command: "director-tools-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/4",
      version: "1.0.0",
    }

    await expect(manager.installBundle({ files: { "manifest.json": JSON.stringify(manifestV4) } })).rejects.toThrow(
      "Plugin-owned Skill director-workflow does not exist",
    )
    await expect(
      manager.installBundle({
        files: {
          "manifest.json": JSON.stringify(manifestV4),
          "skills/director-workflow/SKILL.md": [
            "---",
            "name: director-workflow",
            "description: Direct a scene",
            "---",
          ].join("\n"),
        },
      }),
    ).rejects.toThrow("host publication lifecycle")
  })

  test("installs a headless v5 Project/Canvas Plugin through the inherited owned-Skill lifecycle", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const manifestV5 = projectCanvasManifest()

    await expect(
      manager.installBundle(
        { files: { "manifest.json": JSON.stringify(manifestV5) } },
        { beforePublish: noOpPublication },
      ),
    ).rejects.toThrow("Plugin-owned Skill director-workflow does not exist")

    const installed = await manager.installBundle(
      {
        files: {
          "manifest.json": JSON.stringify(manifestV5),
          "skills/director-workflow/SKILL.md": [
            "---",
            "name: director-workflow",
            "description: Direct a project Canvas",
            "---",
          ].join("\n"),
        },
      },
      { beforePublish: noOpPublication },
    )

    expect(installed).toMatchObject({
      capabilities: expect.arrayContaining(["canvas.document.read", "canvas.document.write"]),
      contributes: { skills: [{ name: "director-workflow", path: "skills/director-workflow" }] },
      id: "director-tools",
      schema: "convax.plugin/5",
    })
    expect(installed.entry).toBeUndefined()
  })

  test("cannot bypass the owned-Skill lifecycle when an update removes the last Skill or uninstalls", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    await manager.installBundle(ownedBundle("1.0.0"), { beforePublish: noOpPublication })

    await expect(manager.installBundle(ownedBundle("2.0.0", false), { replaceExisting: true })).rejects.toThrow(
      "host publication lifecycle",
    )
    await expect(manager.uninstall("director-tools")).rejects.toThrow("host publication lifecycle")
    expect(await manager.list()).toEqual([expect.objectContaining({ id: "director-tools", version: "1.0.0" })])

    await expect(
      manager.installBundle(ownedBundle("2.0.0", false), {
        beforePublish: noOpPublication,
        replaceExisting: true,
      }),
    ).resolves.toMatchObject({ version: "2.0.0" })
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

  test("retires verified built-in provenance without removing the installed Plugin", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const builtInManager = new WebPluginManager(installRoot, {}, ["director-stage"])
    const builtInBundle = simpleBundle("1.0.0", "legacy built-in")
    await builtInManager.installOrUpdateBuiltinBundle(builtInBundle)
    expect(await builtInManager.list()).toEqual([
      expect.objectContaining({ id: "director-stage", trustedBuiltin: true, version: "1.0.0" }),
    ])

    const registryManager = new WebPluginManager(installRoot)
    await expect(registryManager.retireInstalledBuiltinProvenance("director-stage")).resolves.toBe(true)
    await expect(registryManager.retireInstalledBuiltinProvenance("director-stage")).resolves.toBe(false)
    expect(await registryManager.list()).toEqual([expect.not.objectContaining({ trustedBuiltin: true })])

    await expect(
      registryManager.installBundle(simpleBundle("1.1.0", "Registry package"), { replaceExisting: true }),
    ).resolves.toMatchObject({ id: "director-stage", version: "1.1.0" })
    expect(await fs.readFile(await registryManager.resolveAsset("director-stage", "index.html"), "utf8")).toBe(
      "Registry package",
    )
  })

  test("does not retire tampered built-in provenance", async () => {
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot, {}, ["director-stage"])
    await manager.installOrUpdateBuiltinBundle(simpleBundle("1.0.0", "trusted built-in"))
    await fs.writeFile(path.join(installRoot, "director-stage", "index.html"), "tampered")

    await expect(manager.retireInstalledBuiltinProvenance("director-stage")).rejects.toThrow(
      "do not match their provenance",
    )
    expect(await fs.readFile(path.join(installRoot, "director-stage", ".convax-builtin.json"), "utf8")).toContain(
      "convax.plugin-builtin/1",
    )
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

  test("serializes same-Plugin publications so a waiting older update cannot overwrite a newer one", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    await manager.installBundle(simpleBundle("1.0.0", "initial"))
    let releaseOlder!: () => void
    const olderBlocked = new Promise<void>((resolve) => {
      releaseOlder = resolve
    })
    let enterOlder!: () => void
    const olderEntered = new Promise<void>((resolve) => {
      enterOlder = resolve
    })
    let newerPrepared = false
    const older = manager.installBundle(simpleBundle("2.0.0", "older request"), {
      beforePublish: async () => {
        enterOlder()
        await olderBlocked
        return noOpPublication()
      },
      replaceExisting: true,
    })
    await olderEntered
    const newer = manager.installBundle(simpleBundle("3.0.0", "newer request"), {
      beforePublish: async () => {
        newerPrepared = true
        return noOpPublication()
      },
      replaceExisting: true,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(newerPrepared).toBe(false)

    releaseOlder()
    await expect(older).resolves.toMatchObject({ version: "2.0.0" })
    await expect(newer).resolves.toMatchObject({ version: "3.0.0" })
    expect((await manager.list())[0]?.version).toBe("3.0.0")
    expect(await fs.readFile(await manager.resolveAsset("director-stage", "index.html"), "utf8")).toBe("newer request")
  })

  test("extends the same-Plugin lock across host lifecycle work with an opaque mutation context", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const phases: string[] = []
    let enterFirst!: () => void
    const entered = new Promise<void>((resolve) => {
      enterFirst = resolve
    })
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = manager.withPluginMutation("director-stage", async (mutation) => {
      phases.push("first:start")
      enterFirst()
      await gate
      await manager.installBundle(simpleBundle("1.0.0", "first"), { mutation })
      phases.push("first:end")
    })
    await entered
    const second = manager.withPluginMutation("director-stage", async () => {
      phases.push("second:start")
      expect((await manager.list())[0]?.version).toBe("1.0.0")
    })
    await Promise.resolve()
    expect(phases).toEqual(["first:start"])
    releaseFirst()
    await Promise.all([first, second])
    expect(phases).toEqual(["first:start", "first:end", "second:start"])

    await expect(
      manager.installBundle(simpleBundle("1.0.0", "forged", "other-plugin"), {
        mutation: { pluginId: "other-plugin" },
      }),
    ).rejects.toThrow("mutation context")
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

  test("finishes a validated uninstall tombstone and rejects a symlinked one during startup recovery", async () => {
    if (process.platform === "win32") return
    const root = await temporaryRoot()
    const installRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installRoot)
    await manager.installBundle(simpleBundle("1.0.0", "removed application"))
    const target = path.join(installRoot, "director-stage")
    const removed = path.join(installRoot, `.removed-director-stage-${recoveryUuid1}`)
    await fs.rename(target, removed)

    await manager.reconcilePublicationState()
    expect(await manager.list()).toEqual([])
    await expect(fs.lstat(removed)).rejects.toMatchObject({ code: "ENOENT" })

    const outside = path.join(root, "outside-removed")
    await writeSimplePackage(outside, "2.0.0", "outside application")
    const symlink = path.join(installRoot, `.removed-director-stage-${recoveryUuid2}`)
    await fs.symlink(outside, symlink)
    await expect(manager.reconcilePublicationState()).rejects.toThrow("did not accept every transaction remnant")
    expect((await fs.lstat(symlink)).isSymbolicLink()).toBe(true)
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
