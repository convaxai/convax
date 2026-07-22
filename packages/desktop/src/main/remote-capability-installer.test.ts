import { describe, expect, mock, test } from "bun:test"

import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { DesktopBuiltinSkillBundle } from "./builtin-skill-catalog"
import {
  WebPluginPublicationDeferredError,
  type WebPluginBundleInstallOptions,
  type WebPluginMutationContext,
} from "./plugin-manager"
import { RemoteCapabilityInstaller, type RemoteCapabilityRegistryPort } from "./remote-capability-installer"
import {
  remoteCapabilityRegistrySchema,
  remotePluginCapabilitySchemaV1,
  remotePluginHostSchema,
  remotePluginHostSchemaV2,
  remotePluginHostSchemaV4,
  remoteSkillSchema,
  type RemoteCapabilityPackage,
  type RemotePluginCompanion,
  type RemoteSkillShowcaseDownload,
  RemoteRegistryTimeoutError,
  RemoteRegistryValidationError,
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
  beforePluginPublish?: (pluginId: string) => Promise<void> | void,
  pluginSkillLifecycle?: {
    prepareInstall: ReturnType<typeof mock>
    reconcileInstalled: ReturnType<typeof mock>
  },
) {
  let installedPlugins = [...installed]
  const registry = {
    downloadBundle: mock(async (_item: RemoteCapabilityPackage) => ({ files })),
    downloadCompanionArtifact: mock(async () => encoder.encode("companion")),
    downloadSkillShowcase: mock(async (): Promise<RemoteSkillShowcaseDownload | null> => null),
    fetchRegistry: mock<RemoteCapabilityRegistryPort["fetchRegistry"]>(async () => ({
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
  const mutationTails = new Map<string, Promise<void>>()
  const withPluginMutation = async <Result>(
    pluginId: string,
    operation: (mutation: WebPluginMutationContext) => Promise<Result>,
  ): Promise<Result> => {
    const previous = mutationTails.get(pluginId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous.then(() => gate)
    mutationTails.set(pluginId, current)
    await previous
    try {
      return await operation({ pluginId })
    } finally {
      release()
      if (mutationTails.get(pluginId) === current) mutationTails.delete(pluginId)
    }
  }
  const pluginManager = {
    installBundle: mock(
      async (bundle: { files: Readonly<Record<string, Uint8Array>> }, options: WebPluginBundleInstallOptions = {}) => {
        const parsed = JSON.parse(new TextDecoder().decode(bundle.files["manifest.json"]))
        const plugin = parseWebPluginManifest(parsed)
        const transaction = await options.beforePublish?.(plugin, { root: "/staging/plugin" })
        await transaction?.publish()
        await transaction?.activate?.()
        await transaction?.commit()
        installedPlugins = [...installedPlugins.filter((candidate) => candidate.id !== plugin.id), plugin]
        return plugin
      },
    ),
    isBundleInstalled: mock(async () => true),
    list: mock(async () => installedPlugins),
    resolveAsset: mock(async (pluginId: string, relativePath: string) => `/plugins/${pluginId}/${relativePath}`),
    withPluginMutation,
  }
  const companionTransactions: Array<{ commit: ReturnType<typeof mock>; rollback: ReturnType<typeof mock> }> = []
  const companionStore = {
    install: mock(async () => {
      const transaction = { commit: mock(async () => {}), rollback: mock(async () => {}) }
      companionTransactions.push(transaction)
      return { binding: { path: "/managed/companion", sha256: "a".repeat(64), size: 9 }, ...transaction }
    }),
    reconcilePlugin: mock(async () => {}),
  }
  const skillManager = {
    installFromFiles: mock(
      async (_files: Readonly<Record<string, string | Uint8Array>>, _directory?: string, expectedName?: string) => ({
        location: `/managed/${expectedName}/SKILL.md`,
        management: { kind: "standalone" as const },
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
  const resolvedPluginSkillLifecycle = pluginSkillLifecycle ?? {
    prepareInstall: mock(async () => ({
      async activate() {},
      async commit() {},
      async publish() {},
      async rollback() {},
    })),
    reconcileInstalled: mock(async () => {}),
  }
  const installer = new RemoteCapabilityInstaller({
    arch: target.arch,
    authorizationStore,
    beforePluginPublish,
    builtinPlugins,
    builtinSkills,
    companionStore,
    platform: target.platform,
    pluginManager,
    pluginSkillLifecycle: resolvedPluginSkillLifecycle,
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
      {
        ...manifest("remote-plugin", "1.1.0"),
        download: { companionBytes: 0, packageBytes: 1, totalBytes: 1 },
        installed: true,
        releaseAvailable: true,
      },
    ])
    await expect(installer.getPluginReleaseUrl("remote-plugin")).resolves.toBe(
      "https://github.com/microvoid/convax-plugins/releases/tag/plugin-remote-plugin-v1.1.0",
    )
    await expect(installer.listSkillCatalog(new Set())).resolves.toEqual([
      {
        description: "remote-skill description",
        id: "remote-skill",
        installed: false,
        name: "remote-skill",
      },
    ])
    expect(registry.fetchRegistry).toHaveBeenNthCalledWith(1, { cachePolicy: "cache-first" })
    expect(registry.fetchRegistry).toHaveBeenNthCalledWith(2, { cachePolicy: "network-first" })
    expect(registry.fetchRegistry).toHaveBeenNthCalledWith(3, { cachePolicy: "cache-first" })
  })

  test("keeps Plugin-owned Skills previewable but routes installation through the owner", async () => {
    const ownedManifest = parseWebPluginManifest({
      capabilities: [],
      contributes: {
        generation: {
          models: [],
          tools: [
            {
              acceptedInputs: [],
              description: "Run a local operation",
              id: "operation.run",
              output: "text",
              title: "Run",
            },
          ],
        },
        skills: [{ name: "media-workflow", path: "skills/media-workflow" }],
      },
      description: "Media tools",
      id: "media-tools",
      name: "Media Tools",
      runtime: { command: "media-tools-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/4",
      version: "1.0.0",
    })
    const packages = [
      pluginPackage("media-tools", "1.0.0", {
        compatibility: { pluginHost: remotePluginHostSchemaV4, pluginSchema: "convax.plugin/4" },
        manifest: ownedManifest,
        name: ownedManifest.name,
      }),
      skillPackage("media-workflow", { ownerPluginId: "media-tools" }),
    ]
    const { installer, registry } = setup(packages)

    await expect(installer.listSkillCatalog(new Set())).resolves.toEqual([
      {
        description: "media-workflow description",
        id: "media-workflow",
        installed: false,
        name: "media-workflow",
        ownerPluginId: "media-tools",
        ownerPluginName: "Media Tools",
      },
    ])
    await expect(installer.installSkill("media-workflow")).rejects.toThrow("provided by Plugin media-tools")
    expect(registry.downloadBundle).not.toHaveBeenCalled()
  })

  test("publishes owned Skills inside the same remote Plugin transaction", async () => {
    const ownedManifest = parseWebPluginManifest({
      capabilities: [],
      contributes: {
        generation: {
          models: [],
          tools: [
            {
              acceptedInputs: [],
              description: "Run a local operation",
              id: "operation.run",
              output: "text",
              title: "Run",
            },
          ],
        },
        skills: [{ name: "media-workflow", path: "skills/media-workflow" }],
      },
      description: "Media tools",
      id: "media-tools",
      name: "Media Tools",
      runtime: { command: "media-tools-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/4",
      version: "1.0.0",
    })
    const item = pluginPackage("media-tools", "1.0.0", {
      compatibility: { pluginHost: remotePluginHostSchemaV4, pluginSchema: "convax.plugin/4" },
      manifest: ownedManifest,
      name: ownedManifest.name,
    })
    let setupResult: ReturnType<typeof setup> | undefined
    const ownedTransaction = {
      activate: mock(async () => undefined),
      commit: mock(async () => {
        expect(setupResult?.authorizationTransactions[0]?.commit).not.toHaveBeenCalled()
      }),
      publish: mock(async () => undefined),
      rollback: mock(async () => undefined),
    }
    const pluginSkillLifecycle = {
      prepareInstall: mock(async () => ownedTransaction),
      reconcileInstalled: mock(async () => undefined),
    }
    const files = {
      "manifest.json": encoder.encode(JSON.stringify(ownedManifest)),
      "skills/media-workflow/SKILL.md": encoder.encode("---\nname: media-workflow\ndescription: Media workflow\n---\n"),
    }
    setupResult = setup([item], files, [], undefined, undefined, pluginSkillLifecycle)

    await expect(setupResult.installer.installPlugin("media-tools")).resolves.toMatchObject({ id: "media-tools" })
    expect(pluginSkillLifecycle.prepareInstall).toHaveBeenCalledWith(ownedManifest, { root: "/staging/plugin" })
    expect(ownedTransaction.publish).toHaveBeenCalledTimes(1)
    expect(ownedTransaction.activate).toHaveBeenCalledTimes(1)
    expect(ownedTransaction.commit).toHaveBeenCalledTimes(1)
    expect(setupResult.authorizationTransactions[0]?.commit).toHaveBeenCalledTimes(1)
    expect(ownedTransaction.rollback).not.toHaveBeenCalled()
  })

  test("installs a headless v5 Project/Canvas Plugin through the same owned-Skill transaction", async () => {
    const ownedManifest = parseWebPluginManifest({
      capabilities: ["canvas.catalog.read", "canvas.document.read", "canvas.document.write"],
      contributes: {
        skills: [{ name: "canvas-workflow", path: "skills/canvas-workflow" }],
      },
      description: "Project-wide Canvas workflow",
      id: "canvas-tools",
      name: "Canvas Tools",
      schema: "convax.plugin/5",
      version: "1.0.0",
    })
    const item = pluginPackage("canvas-tools", "1.0.0", {
      compatibility: { pluginHost: remotePluginCapabilitySchemaV1, pluginSchema: "convax.plugin/5" },
      manifest: ownedManifest,
      name: ownedManifest.name,
    })
    const ownedTransaction = {
      activate: mock(async () => undefined),
      commit: mock(async () => undefined),
      publish: mock(async () => undefined),
      rollback: mock(async () => undefined),
    }
    const pluginSkillLifecycle = {
      prepareInstall: mock(async () => ownedTransaction),
      reconcileInstalled: mock(async () => undefined),
    }
    const files = {
      "manifest.json": encoder.encode(JSON.stringify(ownedManifest)),
      "skills/canvas-workflow/SKILL.md": encoder.encode(
        "---\nname: canvas-workflow\ndescription: Coordinate project Canvases\n---\n",
      ),
    }
    const setupResult = setup([item], files, [], undefined, undefined, pluginSkillLifecycle)

    const installed = await setupResult.installer.installPlugin("canvas-tools")
    expect(installed).toMatchObject({
      id: "canvas-tools",
      schema: "convax.plugin/5",
    })
    expect(installed.entry).toBeUndefined()
    expect(pluginSkillLifecycle.prepareInstall).toHaveBeenCalledWith(ownedManifest, { root: "/staging/plugin" })
    expect(ownedTransaction.publish).toHaveBeenCalledTimes(1)
    expect(ownedTransaction.activate).toHaveBeenCalledTimes(1)
    expect(ownedTransaction.commit).toHaveBeenCalledTimes(1)
    expect(ownedTransaction.rollback).not.toHaveBeenCalled()
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

  test("drains an existing service authorization before remote Plugin publication", async () => {
    const item = pluginPackage("remote-plugin")
    const files = { "manifest.json": encoder.encode(JSON.stringify(item.manifest)) }
    const beforePluginPublish = mock(async (_pluginId: string) => undefined)
    const setupResult = setup([item], files, [], { arch: "arm64", platform: "darwin" }, beforePluginPublish)

    await setupResult.installer.installPlugin(item.id)
    expect(beforePluginPublish).toHaveBeenCalledWith(item.id)
    expect(beforePluginPublish).toHaveBeenCalledTimes(1)
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
      {
        ...pluginManifest,
        download: { companionBytes: 0, packageBytes: 1, totalBytes: 1 },
        installed: false,
        releaseAvailable: true,
      },
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

    await expect(setupResult.installer.listPluginCatalog(new Set())).resolves.toEqual([
      {
        ...pluginManifest,
        download: { companionBytes: 9, packageBytes: 1, totalBytes: 10 },
        installed: false,
        releaseAvailable: true,
      },
    ])

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

  test("preserves the installed Plugin when its replacement companion download times out", async () => {
    const current = generationManifest("generation-plugin", "1.0.0")
    const next = generationManifest("generation-plugin", "2.0.0")
    const item = pluginPackage("generation-plugin", "2.0.0", {
      companions: [companion("generation-plugin", "2.0.0")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: next,
    })
    const setupResult = setup([item], { "manifest.json": encoder.encode(JSON.stringify(next)) }, [current])
    setupResult.registry.downloadCompanionArtifact.mockRejectedValueOnce(
      new RemoteRegistryTimeoutError("Remote companion artifact download stalled"),
    )

    await expect(setupResult.installer.installPlugin(item.id)).rejects.toThrow(
      "Remote companion artifact download stalled",
    )
    expect(await setupResult.pluginManager.list()).toEqual([current])
    expect(setupResult.companionStore.install).not.toHaveBeenCalled()
    expect(setupResult.authorizationStore.prepareInstall).not.toHaveBeenCalled()
    expect(setupResult.pluginManager.installBundle).not.toHaveBeenCalled()
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

  test("preserves a companion when Plugin package recovery must select the final version", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const files = { "manifest.json": encoder.encode(JSON.stringify(pluginManifest)) }
    const setupResult = setup([item], files)
    const cause = new Error("package rollback rename failed")
    setupResult.pluginManager.installBundle.mockRejectedValueOnce(
      new WebPluginPublicationDeferredError([cause], "Plugin publication requires startup recovery", { cause }),
    )

    await expect(setupResult.installer.installPlugin(item.id)).rejects.toBeInstanceOf(WebPluginPublicationDeferredError)
    expect(setupResult.companionTransactions[0]!.rollback).not.toHaveBeenCalled()
    expect(setupResult.companionTransactions[0]!.commit).not.toHaveBeenCalled()
    expect(setupResult.companionStore.reconcilePlugin).not.toHaveBeenCalled()
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

  test("returns a current installed Plugin after a metadata-only update check", async () => {
    const current = generationManifest("generation-plugin", "1.0.0")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: current,
    })
    const setupResult = setup([item], { "manifest.json": encoder.encode(JSON.stringify(current)) }, [current])

    await expect(setupResult.installer.updatePlugin(item.id)).resolves.toEqual(current)

    expect(setupResult.registry.fetchRegistry).toHaveBeenCalledWith({ cachePolicy: "network-first" })
    expect(setupResult.registry.downloadBundle).not.toHaveBeenCalled()
    expect(setupResult.registry.downloadCompanionArtifact).not.toHaveBeenCalled()
    expect(setupResult.pluginManager.installBundle).not.toHaveBeenCalled()
    expect(setupResult.pluginManager.isBundleInstalled).not.toHaveBeenCalled()
    expect(setupResult.companionStore.install).not.toHaveBeenCalled()
    expect(setupResult.authorizationStore.prepareInstall).not.toHaveBeenCalled()
  })

  test("downloads and atomically publishes only a newer Plugin during an update check", async () => {
    const current = generationManifest("generation-plugin", "1.0.0")
    const next = generationManifest("generation-plugin", "2.0.0")
    const companionItem = companion("generation-plugin", "2.0.0")
    const item = pluginPackage("generation-plugin", "2.0.0", {
      companions: [companionItem],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: next,
    })
    const files = { "manifest.json": encoder.encode(JSON.stringify(next)) }
    const setupResult = setup([item], files, [current])

    await expect(setupResult.installer.updatePlugin(item.id)).resolves.toEqual(next)

    expect(setupResult.registry.downloadBundle).toHaveBeenCalledWith(item)
    expect(setupResult.registry.downloadCompanionArtifact).toHaveBeenCalledWith(
      item,
      companionItem,
      companionItem.targets[0],
    )
    expect(setupResult.pluginManager.installBundle).toHaveBeenCalledWith(
      { files },
      expect.objectContaining({ beforePublish: expect.any(Function), replaceExisting: true }),
    )
    expect(setupResult.companionTransactions[0]!.commit).toHaveBeenCalledTimes(1)
  })

  test("rejects update checks for a missing or newer local Plugin before downloading", async () => {
    const registryManifest = generationManifest("generation-plugin", "1.0.0")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: registryManifest,
    })
    const missing = setup([item], { "manifest.json": encoder.encode(JSON.stringify(registryManifest)) })
    await expect(missing.installer.updatePlugin(item.id)).rejects.toThrow("requires an installed Plugin")
    expect(missing.registry.downloadBundle).not.toHaveBeenCalled()
    expect(missing.registry.downloadCompanionArtifact).not.toHaveBeenCalled()

    const localNewer = setup([item], { "manifest.json": encoder.encode(JSON.stringify(registryManifest)) }, [
      generationManifest("generation-plugin", "2.0.0"),
    ])
    await expect(localNewer.installer.updatePlugin(item.id)).rejects.toThrow(
      "Installed Plugin is newer than the remote Registry package",
    )
    expect(localNewer.registry.downloadBundle).not.toHaveBeenCalled()
    expect(localNewer.registry.downloadCompanionArtifact).not.toHaveBeenCalled()
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
    await expect(same.installer.installPlugin("generation-plugin", { allowCurrent: true })).resolves.toEqual(current)
    expect(same.registry.downloadBundle).toHaveBeenCalledTimes(2)
    expect(same.pluginManager.isBundleInstalled).toHaveBeenCalledTimes(2)
    expect(same.authorizationStore.prepareInstall).toHaveBeenCalledTimes(1)
  })

  test("refuses to adopt a same-version package whose bytes do not match the Registry", async () => {
    const current = generationManifest("generation-plugin", "1.0.0")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: current,
    })
    const setupResult = setup([item], { "manifest.json": encoder.encode(JSON.stringify(current)) }, [current])
    setupResult.pluginManager.isBundleInstalled.mockResolvedValueOnce(false)

    await expect(setupResult.installer.installPlugin(item.id, { allowCurrent: true })).rejects.toThrow(
      "does not match the verified Registry package",
    )
    expect(setupResult.authorizationStore.prepareInstall).not.toHaveBeenCalled()
    expect(setupResult.companionStore.install).not.toHaveBeenCalled()
  })

  test("revalidates a current Registry package after repair preparation", async () => {
    const current = generationManifest("generation-plugin", "1.0.0")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: current,
    })
    const setupResult = setup([item], { "manifest.json": encoder.encode(JSON.stringify(current)) }, [current])
    setupResult.pluginManager.isBundleInstalled.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(setupResult.installer.installPlugin(item.id, { allowCurrent: true })).rejects.toThrow(
      "changed during verified Registry repair",
    )
    expect(setupResult.pluginManager.isBundleInstalled).toHaveBeenCalledTimes(2)
    expect(setupResult.authorizationTransactions[0]!.publish).not.toHaveBeenCalled()
    expect(setupResult.authorizationTransactions[0]!.rollback).toHaveBeenCalledTimes(1)
  })

  test("serializes the complete companion and package lifecycle for concurrent same-Plugin installs", async () => {
    const pluginManifest = generationManifest("generation-plugin")
    const item = pluginPackage("generation-plugin", "1.0.0", {
      companions: [companion("generation-plugin")],
      compatibility: { pluginHost: remotePluginHostSchemaV2, pluginSchema: "convax.plugin/2" },
      manifest: pluginManifest,
    })
    const setupResult = setup([item], {
      "manifest.json": encoder.encode(JSON.stringify(pluginManifest)),
    })

    const outcomes = await Promise.allSettled([
      setupResult.installer.installPlugin(item.id),
      setupResult.installer.installPlugin(item.id),
    ])

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1)
    expect(setupResult.pluginManager.installBundle).toHaveBeenCalledTimes(1)
    expect(setupResult.companionStore.install).toHaveBeenCalledTimes(1)
    expect(setupResult.companionTransactions[0]!.commit).toHaveBeenCalledTimes(1)
    expect(setupResult.companionTransactions[0]!.rollback).not.toHaveBeenCalled()
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

  test("reads Skill details from cache when the live Registry would roll back while installs still revalidate", async () => {
    const item = skillPackage("remote-skill", { name: "Remote Skill" })
    const files = { "SKILL.md": encoder.encode("---\nname: remote-skill\n---\n") }
    const setupResult = setup([item], files)
    setupResult.registry.fetchRegistry.mockImplementation(async (options = {}) => {
      if (options.cachePolicy !== "cache-first") {
        throw new RemoteRegistryValidationError("Remote registry sequence would roll back the cache")
      }
      return {
        registry: {
          packages: [item],
          revision: "b".repeat(40),
          schema: remoteCapabilityRegistrySchema,
          sequence: 17,
        },
        source: "cache" as const,
      }
    })

    await expect(setupResult.installer.getSkillDetails("remote-skill")).resolves.toMatchObject({
      id: "remote-skill",
      name: "Remote Skill",
    })
    expect(setupResult.registry.fetchRegistry).toHaveBeenLastCalledWith({ cachePolicy: "cache-first" })

    await expect(setupResult.installer.installSkill("remote-skill")).rejects.toThrow("roll back the cache")
    expect(setupResult.registry.fetchRegistry).toHaveBeenLastCalledWith({ cachePolicy: "network-first" })
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
