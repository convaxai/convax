import { describe, expect, mock, test } from "bun:test"

import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { DesktopBuiltinSkillBundle } from "./builtin-skill-catalog"
import type { WebPluginBundleInstallOptions } from "./plugin-manager"
import { RemoteCapabilityInstaller, type RemoteCapabilityRegistryPort } from "./remote-capability-installer"
import {
  remoteCapabilityRegistrySchema,
  remotePluginHostSchema,
  remotePluginHostSchemaV2,
  remoteSkillSchema,
  type RemoteCapabilityPackage,
  type RemotePluginCompanion,
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

function generationManifest(id: string, version = "1.0.0", name = id): WebPluginManifest {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      canvas: { renderer: { create: true } },
      generation: {
        tools: [
          {
            acceptedInputs: ["text", "reference_image"],
            description: `${id} image generation`,
            id: "generate-image",
            output: "image",
            title: "Generate image",
          },
        ],
      },
    },
    description: `${id} description`,
    entry: "index.html",
    id,
    name,
    runtime: { command: "example-image-tool", type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version,
  })
}

function companion(pluginId: string, pluginVersion = "1.0.0"): RemotePluginCompanion {
  return {
    command: "example-image-tool",
    targets: [
      {
        arch: "arm64" as const,
        artifact: {
          sha256: "c".repeat(64),
          size: 9,
          url:
            `https://github.com/microvoid/convax-plugins/releases/download/plugin-${pluginId}-v${pluginVersion}/` +
            "convax-companion-example-image-tool-3.0.0-darwin-arm64",
        },
        platform: "darwin" as const,
      },
    ],
    version: "3.0.0",
  }
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

function setup(
  packages: RemoteCapabilityPackage[],
  files: Readonly<Record<string, Uint8Array>> = {},
  installed: WebPluginManifest[] = [],
  target: { arch: NodeJS.Architecture; platform: NodeJS.Platform } = { arch: "arm64", platform: "darwin" },
) {
  const registry = {
    downloadBundle: mock(async (_item: RemoteCapabilityPackage) => ({ files })),
    downloadCompanionArtifact: mock(async () => encoder.encode("companion")),
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
  const authorizationTransactions: Array<{
    commit: ReturnType<typeof mock>
    publish: ReturnType<typeof mock>
    rollback: ReturnType<typeof mock>
  }> = []
  const authorizationStore = {
    prepareInstall: mock(async () => {
      const transaction = {
        commit: mock(async () => {}),
        publish: mock(async () => {}),
        rollback: mock(async () => {}),
      }
      authorizationTransactions.push(transaction)
      return transaction
    }),
  }
  const pluginManager = {
    installBundle: mock(
      async (bundle: { files: Readonly<Record<string, Uint8Array>> }, options: WebPluginBundleInstallOptions = {}) => {
        const parsed = JSON.parse(new TextDecoder().decode(bundle.files["manifest.json"]))
        const plugin = parseWebPluginManifest(parsed)
        const transaction = await options.beforePublish?.(plugin)
        await transaction?.publish()
        await transaction?.commit()
        return plugin
      },
    ),
    list: mock(async () => installed),
  }
  const companionTransactions: Array<{ commit: ReturnType<typeof mock>; rollback: ReturnType<typeof mock> }> = []
  const companionStore = {
    install: mock(async () => {
      const transaction = { commit: mock(async () => {}), rollback: mock(async () => {}) }
      companionTransactions.push(transaction)
      return { binding: { path: "/managed/companion", sha256: "a".repeat(64), size: 9 }, ...transaction }
    }),
    reconcile: mock(async () => {}),
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
    arch: target.arch,
    authorizationStore,
    builtinPlugins,
    builtinSkills,
    companionStore,
    platform: target.platform,
    pluginManager,
    registry,
    skillManager,
  })
  return {
    authorizationStore,
    authorizationTransactions,
    companionStore,
    companionTransactions,
    installer,
    pluginManager,
    registry,
    skillManager,
  }
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
    expect(setupResult.pluginManager.installBundle).toHaveBeenCalledWith(
      { files },
      expect.objectContaining({ beforePublish: expect.any(Function) }),
    )

    const tampered = setup([item], {
      ...files,
      "manifest.json": encoder.encode(JSON.stringify(manifest("different-plugin"))),
    })
    await expect(tampered.installer.installPlugin("remote-plugin")).rejects.toThrow("does not match the registry")
    expect(tampered.pluginManager.installBundle).not.toHaveBeenCalled()
  })

  test("lists and installs generation Tool Plugins through the same verified bundle path", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const files = {
      "index.html": encoder.encode("<!doctype html>"),
      "manifest.json": encoder.encode(JSON.stringify(pluginManifest)),
    }
    const setupResult = setup([item], files)

    await expect(setupResult.installer.listPluginCatalog(new Set())).resolves.toEqual([
      { ...pluginManifest, installed: false },
    ])
    await expect(setupResult.installer.installPlugin("generation-plugin")).resolves.toMatchObject({
      id: "generation-plugin",
      runtime: { command: "example-image-tool", type: "mcp-stdio" },
      schema: "convax.plugin/2",
    })
    expect(setupResult.pluginManager.installBundle).toHaveBeenCalledWith(
      { files },
      expect.objectContaining({ beforePublish: expect.any(Function) }),
    )
  })

  test("selects and commits the exact current-platform companion before publishing its Plugin", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const companionItem = companion("generation-plugin")
    companionItem.targets.push({
      arch: "x64",
      artifact: {
        sha256: "d".repeat(64),
        size: 10,
        url:
          "https://github.com/microvoid/convax-plugins/releases/download/plugin-generation-plugin-v1.0.0/" +
          "convax-companion-example-image-tool-3.0.0-linux-x64",
      },
      platform: "linux",
    })
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companionItem],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const files = { "manifest.json": encoder.encode(JSON.stringify(pluginManifest)) }
    const setupResult = setup([item], files)

    await setupResult.installer.installPlugin(item.id)

    expect(setupResult.registry.downloadCompanionArtifact).toHaveBeenCalledWith(
      item,
      companionItem,
      companionItem.targets[0],
    )
    expect(setupResult.companionStore.install).toHaveBeenCalledWith(
      expect.objectContaining({
        arch: "arm64",
        command: "example-image-tool",
        platform: "darwin",
        pluginId: item.id,
        pluginVersion: item.version,
        version: "3.0.0",
      }),
    )
    expect(setupResult.authorizationStore.prepareInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: item.id, version: item.version }),
      {
        binding: { path: "/managed/companion", sha256: "a".repeat(64), size: 9 },
        kind: "managed",
      },
    )
    expect(setupResult.companionTransactions[0]!.commit).toHaveBeenCalledTimes(1)
    expect(setupResult.companionTransactions[0]!.rollback).not.toHaveBeenCalled()
  })

  test("fails before any download when a declared companion has no exact host target", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const setupResult = setup([item], {}, [], { arch: "x64", platform: "linux" })

    await expect(setupResult.installer.installPlugin(item.id)).rejects.toThrow("no target")
    expect(setupResult.registry.downloadBundle).not.toHaveBeenCalled()
    expect(setupResult.registry.downloadCompanionArtifact).not.toHaveBeenCalled()
    expect(setupResult.pluginManager.installBundle).not.toHaveBeenCalled()
  })

  test("rolls back a published companion when Plugin publication fails", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const files = { "manifest.json": encoder.encode(JSON.stringify(pluginManifest)) }
    const setupResult = setup([item], files)
    setupResult.pluginManager.installBundle.mockRejectedValueOnce(new Error("Plugin publish failed"))

    await expect(setupResult.installer.installPlugin(item.id)).rejects.toThrow("Plugin publish failed")
    expect(setupResult.companionTransactions[0]!.rollback).toHaveBeenCalledTimes(1)
    expect(setupResult.companionTransactions[0]!.commit).not.toHaveBeenCalled()
  })

  test("does not report or attempt rollback after Plugin success when companion cleanup fails", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const files = { "manifest.json": encoder.encode(JSON.stringify(pluginManifest)) }
    const setupResult = setup([item], files)
    const transaction = {
      binding: { path: "/managed/companion", sha256: "a".repeat(64), size: 9 },
      commit: mock(async () => {
        throw new Error("obsolete cleanup failed")
      }),
      rollback: mock(async () => {}),
    }
    setupResult.companionStore.install.mockResolvedValueOnce(transaction)

    await expect(setupResult.installer.installPlugin(item.id)).resolves.toMatchObject({ id: item.id })
    expect(transaction.commit).toHaveBeenCalledTimes(1)
    expect(transaction.rollback).not.toHaveBeenCalled()
  })

  test("does not roll back a published companion when post-publication Plugin listing fails", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const setupResult = setup([item], { "manifest.json": encoder.encode(JSON.stringify(pluginManifest)) })
    setupResult.pluginManager.list.mockResolvedValueOnce([]).mockImplementationOnce(() => {
      throw new Error("post-publication list failed")
    })

    await expect(setupResult.installer.installPlugin(item.id)).resolves.toMatchObject({
      id: item.id,
    })
    expect(setupResult.companionTransactions[0]!.commit).toHaveBeenCalledTimes(1)
    expect(setupResult.companionTransactions[0]!.rollback).not.toHaveBeenCalled()
  })

  test("updates only to a newer Plugin version and uses the existing atomic replacement path", async () => {
    const current = generationManifest("generation-plugin", "1.0.0")
    const next = generationManifest("generation-plugin", "2.0.0")
    const item = pluginPackage("generation-plugin", "2.0.0", {
      companions: [companion("generation-plugin", "2.0.0")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: next,
    })
    const files = { "manifest.json": encoder.encode(JSON.stringify(next)) }
    const setupResult = setup([item], files, [current])

    await setupResult.installer.installPlugin(item.id)
    expect(setupResult.pluginManager.installBundle).toHaveBeenCalledWith(
      { files },
      expect.objectContaining({ beforePublish: expect.any(Function), replaceExisting: true }),
    )
    expect(setupResult.companionTransactions[0]!.commit).toHaveBeenCalledTimes(1)

    const same = setup(
      [
        pluginPackage("generation-plugin", "1.0.0", {
          compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
          manifest: current,
        }),
      ],
      { "manifest.json": encoder.encode(JSON.stringify(current)) },
      [current],
    )
    await expect(same.installer.installPlugin("generation-plugin")).rejects.toThrow("newer version")
    expect(same.registry.downloadBundle).not.toHaveBeenCalled()
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
