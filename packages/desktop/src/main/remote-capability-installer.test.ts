import { describe, expect, mock, test } from "bun:test"

import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { DesktopBuiltinSkillBundle } from "./builtin-skill-catalog"
import { RemoteCapabilityInstaller, type RemoteCapabilityRegistryPort } from "./remote-capability-installer"
import {
  remoteCapabilityRegistrySchema,
  remotePluginHostSchema,
  remoteSkillSchema,
  type RemoteCapabilityPackage,
  type RemoteSkillShowcaseDownload,
} from "./remote-capability-registry"

const encoder = new TextEncoder()

function manifest(id: string, version = "1.0.0", name = id): WebPluginManifest {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: `${id} description`,
    entry: "index.html",
    id,
    name,
    schema: "convax.plugin/1",
    version,
  })
}

function pluginPackage(
  id: string,
  version = "1.0.0",
  overrides: Partial<Extract<RemoteCapabilityPackage, { kind: "plugin" }>> = {},
): Extract<RemoteCapabilityPackage, { kind: "plugin" }> {
  const pluginManifest = overrides.manifest ?? manifest(id, version, overrides.name ?? id)
  return {
    artifact: {
      sha256: "a".repeat(64),
      size: 1,
      url: `https://github.com/microvoid/convax-plugins/releases/download/plugin-${id}-v${version}/${id}.zip`,
    },
    compatibility: { pluginHost: remotePluginHostSchema, pluginSchema: "convax.plugin/1" },
    description: pluginManifest.description,
    id,
    kind: "plugin",
    manifest: pluginManifest,
    name: pluginManifest.name,
    version,
    yanked: false,
    ...overrides,
  }
}

function skillPackage(
  id: string,
  overrides: Partial<Extract<RemoteCapabilityPackage, { kind: "skill" }>> = {},
): Extract<RemoteCapabilityPackage, { kind: "skill" }> {
  return {
    artifact: {
      sha256: "b".repeat(64),
      size: 1,
      url: `https://github.com/microvoid/convax-plugins/releases/download/skill-${id}-v1.0.0/${id}.zip`,
    },
    compatibility: { skillSchema: remoteSkillSchema },
    description: `${id} description`,
    id,
    kind: "skill",
    name: id,
    version: "1.0.0",
    yanked: false,
    ...overrides,
  }
}

function setup(packages: RemoteCapabilityPackage[], files: Readonly<Record<string, Uint8Array>> = {}) {
  const registry = {
    downloadBundle: mock(async (_item: RemoteCapabilityPackage) => ({ files })),
    downloadSkillShowcase: mock(async (): Promise<RemoteSkillShowcaseDownload | null> => null),
    fetchRegistry: mock(async (_options: { signal?: AbortSignal } = {}) => ({
      registry: {
        packages,
        revision: "a".repeat(40),
        schema: remoteCapabilityRegistrySchema,
        sequence: 1,
      },
      source: "network" as const,
    })),
  } satisfies RemoteCapabilityRegistryPort
  const pluginManager = {
    installBundle: mock(async (bundle: { files: Readonly<Record<string, Uint8Array>> }) => {
      const parsed = JSON.parse(new TextDecoder().decode(bundle.files["manifest.json"]))
      return parseWebPluginManifest(parsed)
    }),
  }
  const skillManager = {
    installFromFiles: mock(
      async (_files: Readonly<Record<string, string | Uint8Array>>, _directory?: string, expectedName?: string) => ({
        location: `/managed/${expectedName}/SKILL.md`,
        managed: true,
        name: expectedName!,
        source: "managed" as const,
      }),
    ),
  }
  const builtinPlugins: DesktopBuiltinPluginBundle[] = [
    {
      bundle: { files: { "index.html": "built in", "manifest.json": "{}" } },
      manifest: manifest("builtin-plugin", "1.0.0", "Built In Plugin"),
    },
  ]
  const builtinSkills: DesktopBuiltinSkillBundle[] = [
    {
      description: "Built in",
      files: { "SKILL.md": "built in" },
      id: "builtin-skill",
      name: "Built In Skill",
      version: "0.1.0",
    },
  ]
  const installer = new RemoteCapabilityInstaller({
    builtinPlugins,
    builtinSkills,
    pluginManager,
    registry,
    skillManager,
  })
  return { installer, pluginManager, registry, skillManager }
}

describe("RemoteCapabilityInstaller", () => {
  test("lists non-yanked packages and derives managed installation state", async () => {
    const packages = [
      pluginPackage("remote-plugin", "1.1.0"),
      pluginPackage("hidden-plugin", "1.0.0", { yanked: true }),
      skillPackage("remote-skill"),
      skillPackage("hidden-skill", { yanked: true }),
    ]
    const { installer, registry } = setup(packages)

    await expect(installer.listPluginCatalog(new Set(["remote-plugin"]))).resolves.toEqual([
      { ...manifest("remote-plugin", "1.1.0"), installed: true },
    ])
    await expect(installer.listSkillCatalog(new Set())).resolves.toEqual([
      {
        description: "remote-skill description",
        id: "remote-skill",
        installed: false,
        name: "remote-skill",
      },
    ])
    expect(registry.fetchRegistry).toHaveBeenNthCalledWith(1, { cachePolicy: "cache-first" })
    expect(registry.fetchRegistry).toHaveBeenNthCalledWith(2, { cachePolicy: "cache-first" })
  })

  test("rechecks the downloaded Plugin manifest before using the ordinary bundle installer", async () => {
    const item = pluginPackage("remote-plugin")
    const files = {
      "index.html": encoder.encode("<!doctype html>"),
      "manifest.json": encoder.encode(JSON.stringify(item.manifest)),
    }
    const setupResult = setup([item], files)

    await expect(setupResult.installer.installPlugin("remote-plugin")).resolves.toMatchObject({
      id: "remote-plugin",
    })
    expect(setupResult.registry.fetchRegistry).toHaveBeenCalledWith({ cachePolicy: "network-first" })
    expect(setupResult.registry.downloadBundle).toHaveBeenCalledWith(item)
    expect(setupResult.pluginManager.installBundle).toHaveBeenCalledWith({ files })

    const tampered = setup([item], {
      ...files,
      "manifest.json": encoder.encode(JSON.stringify(manifest("different-plugin"))),
    })
    await expect(tampered.installer.installPlugin("remote-plugin")).rejects.toThrow("does not match the registry")
    expect(tampered.pluginManager.installBundle).not.toHaveBeenCalled()
  })

  test("installs Skills from verified files with the Registry id as the expected Skill name", async () => {
    const item = skillPackage("remote-skill")
    const files = { "SKILL.md": encoder.encode("---\nname: remote-skill\n---\n") }
    const setupResult = setup([item], files)

    await expect(setupResult.installer.installSkill("remote-skill")).resolves.toMatchObject({
      name: "remote-skill",
    })
    expect(setupResult.skillManager.installFromFiles).toHaveBeenCalledWith(files, undefined, "remote-skill")
  })

  test("returns a bounded verified Skill tree with text previews and binary metadata", async () => {
    const item = skillPackage("remote-skill", { name: "Remote Skill" })
    const previewChunk = "x".repeat(240 * 1024)
    const files = {
      "SKILL.md": encoder.encode("---\nname: remote-skill\n---\n"),
      "assets/icon.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      "references/one.txt": encoder.encode(previewChunk),
      "references/two.txt": encoder.encode(previewChunk),
      "references/three.txt": encoder.encode(previewChunk),
      "references/four.txt": encoder.encode(previewChunk),
      "references/five.txt": encoder.encode(previewChunk),
      "scripts/large.py": encoder.encode("x".repeat(256 * 1024 + 1)),
    }
    const setupResult = setup([item], files)

    const details = await setupResult.installer.getSkillDetails("remote-skill")
    expect(details).toMatchObject({
      description: "remote-skill description",
      id: "remote-skill",
      name: "Remote Skill",
      version: "1.0.0",
    })
    expect(details.files.map(({ kind, path, size }) => ({ kind, path, size }))).toContainEqual({
      kind: "binary",
      path: "assets/icon.png",
      size: 4,
    })
    expect(details.files.find((file) => file.path === "SKILL.md")).toMatchObject({
      content: "---\nname: remote-skill\n---\n",
      kind: "text",
    })
    expect(details.files.find((file) => file.path === "scripts/large.py")).toMatchObject({ kind: "binary" })
    expect(details.files.filter((file) => file.path.startsWith("references/") && file.kind === "text")).toHaveLength(4)
    expect(details.files.find((file) => file.path === "references/two.txt")).toMatchObject({ kind: "binary" })
    expect(setupResult.registry.downloadBundle).toHaveBeenCalledWith(item, {
      zipLimits: { maxEntries: 1_000, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 },
    })

    const unsafe = setup([item], { "../private.txt": encoder.encode("secret") })
    await expect(unsafe.installer.getSkillDetails("remote-skill")).rejects.toThrow("unsafe portable path")
  })

  test("loads showcase bytes through Main and degrades every sidecar failure to no media", async () => {
    const item = skillPackage("remote-skill")
    const setupResult = setup([item])
    const media = {
      altText: "A short workflow preview",
      bytes: Uint8Array.from([1, 2, 3]),
      mimeType: "video/mp4" as const,
      size: 3,
    }
    setupResult.registry.downloadSkillShowcase.mockResolvedValueOnce(media)

    await expect(setupResult.installer.getSkillShowcase("remote-skill", "animation")).resolves.toEqual(media)
    expect(setupResult.registry.downloadSkillShowcase).toHaveBeenCalledWith(
      expect.objectContaining({ revision: "a".repeat(40), sequence: 1 }),
      item,
      { media: "animation" },
    )

    setupResult.registry.downloadSkillShowcase.mockRejectedValueOnce(new Error("sidecar mismatch"))
    await expect(setupResult.installer.getSkillShowcase("remote-skill", "poster")).resolves.toBeNull()
    await expect(setupResult.installer.getSkillShowcase("missing-skill", "animation")).resolves.toBeNull()
  })

  test("fails closed before download when a remote id or name collides with a built-in", async () => {
    for (const item of [
      pluginPackage("builtin-plugin"),
      pluginPackage("remote-plugin", "1.0.0", { name: "built in plugin" }),
      skillPackage("builtin-skill"),
      skillPackage("remote-skill", { name: "BUILT IN SKILL" }),
    ]) {
      const setupResult = setup([item])
      const operation =
        item.kind === "plugin"
          ? setupResult.installer.installPlugin(item.id)
          : setupResult.installer.installSkill(item.id)
      await expect(operation).rejects.toThrow("collides with a built-in")
      expect(setupResult.registry.downloadBundle).not.toHaveBeenCalled()
    }
  })
})
