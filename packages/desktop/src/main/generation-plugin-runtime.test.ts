import { afterEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  webPluginManifestSchemaV8,
  type InstalledWebPluginSummary,
  type WebPluginGenerationModality,
} from "../plugin-contracts"
import type { PluginCanvasCapabilityClient } from "../plugin-capability-contracts"
import {
  GenerationPluginRuntime,
  generationPluginEnvironment,
  generationPluginToolHostId,
  type GenerationPluginExecutableBinding,
  type GenerationPluginMcpClient,
  type GenerationPluginRuntimeOptions,
  type GenerationPluginSource,
} from "./generation-plugin-runtime"
import type { McpToolCallResult, McpToolDefinition, StdioMcpClientOptions } from "./stdio-mcp-client"
import { pluginCapabilityNestedInvokeMcpMethod } from "./plugin-capability-sidecar-bridge"
import { pluginServiceBrowserAuthorizationCompletionSchema } from "./plugin-service-browser-authorization"
import type { GenerationRecoveryMethod, GenerationRecoveryRequest } from "./generation-recovery-protocol"
import { pluginSnapshotCanonicalDigest } from "./plugin-installation-snapshots"

type DeepMutable<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? DeepMutable<Item>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
      : Value

function mutablePlugin(plugin: InstalledWebPluginSummary): DeepMutable<InstalledWebPluginSummary> {
  return structuredClone(plugin) as DeepMutable<InstalledWebPluginSummary>
}
import { toolPluginCompanionMcpMethod } from "./tool-plugin-canvas-capabilities"
import { generationModelIdRole } from "./generation-tool-input-schema"

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error("Operation rejected with a non-Error value", { cause: error })
  }
  throw new Error("Expected operation to reject")
}

function generationPlugin(
  options: {
    command?: string
    id?: string
    name?: string
    output?: WebPluginGenerationModality
    toolId?: string
    version?: string
  } = {},
): InstalledWebPluginSummary {
  const id = options.id ?? "image-tools"
  return {
    capabilities: [],
    contributes: {
      generation: {
        models: [{ name: options.name ?? "Image Tools", tool: options.toolId ?? "generate.image" }],
        tools: [
          {
            acceptedInputs: ["text", "reference_image"],
            description: `Generate ${options.output ?? "image"}`,
            id: options.toolId ?? "generate.image",
            output: options.output ?? "image",
            title: "Generate",
          },
        ],
      },
    },
    description: "External generation tools",
    hostApi: { major: 2, optional: [], required: [] },
    id,
    name: options.name ?? "Image Tools",
    runtime: {
      args: ["serve", "--stdio"],
      command: options.command ?? "image-tool-cli",
      type: "mcp-stdio",
    },
    schema: webPluginManifestSchemaV8,
    version: options.version ?? "1.0.0",
  }
}

function staticPlugin(): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Static renderer",
    entry: "index.html",
    hostApi: { major: 2, optional: [], required: ["host.context.get"] },
    id: "static-viewer",
    name: "Static Viewer",
    schema: webPluginManifestSchemaV8,
    version: "1.0.0",
  }
}

function declarativeGenerationPlugin(options: { recovery?: boolean; skill?: boolean } = {}): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {
      agent: { tools: [{ id: "transform_video", tool: "transform.video" }] },
      generation: {
        models: [{ name: "Example Image 1", tool: "generate.image" }],
        tools: [
          {
            acceptedInputs: ["reference_image"],
            description: "Generate image",
            id: "generate.image",
            output: "image",
            ...(options.recovery
              ? {
                  recovery: {
                    mode: "long-running-operation" as const,
                    schema: "convax.generation-lro/1" as const,
                  },
                }
              : {}),
            title: "Image generation tool",
          },
          {
            acceptedInputs: ["reference_video"],
            description: "Transform video",
            id: "transform.video",
            output: "video",
            title: "Video operation",
          },
        ],
      },
      service: { actions: [] },
      ...(options.skill ? { skills: [{ name: "declarative-workflow", path: "skills/declarative-workflow" }] } : {}),
    },
    description: "Explicit models and operations",
    hostApi: { major: 2, optional: [], required: [] },
    id: "declarative-tools",
    name: "Declarative Tools",
    runtime: { command: "declarative-tools-cli", type: "mcp-stdio" },
    schema: webPluginManifestSchemaV8,
    version: "1.0.0",
  }
}

function servicePlugin(
  actions: NonNullable<InstalledWebPluginSummary["contributes"]["service"]>["actions"] = ["sign_out"],
): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: { service: { actions } },
    description: "External account service",
    hostApi: { major: 2, optional: [], required: [] },
    id: "account-tools",
    name: "Account Tools",
    runtime: { command: "account-tool-cli", type: "mcp-stdio" },
    schema: webPluginManifestSchemaV8,
    version: "1.0.0",
  }
}

function llmPlugin(): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {
      llm: {
        models: [{ id: "pippit-glm-main", name: "Pippit GLM Main" }],
        provider: { id: "pippit-glm", name: "Pippit GLM" },
      },
    },
    description: "External LLM provider",
    hostApi: { major: 2, optional: [], required: [] },
    id: "xiaoyunque-generation",
    name: "XiaoYunque",
    runtime: { command: "convax-xiaoyunque-mcp", type: "mcp-stdio" },
    schema: webPluginManifestSchemaV8,
    version: "0.4.0",
  }
}

class FakePluginSource implements GenerationPluginSource {
  acquired = 0
  activeRevision = 1
  activeSetDigest = "a".repeat(64)
  readonly authorizationIdentities = new Map<string, string>()
  companionAuthorized = true
  companionPresent = true
  companionResolutionPaths: string[] = []
  resolveCompanionBinding: (
    plugin: InstalledWebPluginSummary,
  ) => Promise<GenerationPluginExecutableBinding & { path: string }> = async (plugin) => ({
    path: path.resolve("/active-plugin-snapshots", plugin.id, plugin.version, "companion"),
    sha256: "b".repeat(64),
    size: 4_096,
  })
  installed: InstalledWebPluginSummary[] = []
  readonly ownerPins = new Map<string, Awaited<ReturnType<FakePluginSource["activeIdentity"]>>>()
  released = 0
  readonly resolutions: Array<[string, string]> = []
  readonly snapshots = new Map<
    string,
    {
      authorizationIdentity: string
      binding: GenerationPluginExecutableBinding & { path: string }
      plugin: InstalledWebPluginSummary
    }
  >()

  async list() {
    return this.installed
  }

  async resolveCapabilityIdentity(pluginId: string) {
    const plugin = this.installed.find((candidate) => candidate.id === pluginId)
    if (!plugin) return null
    return {
      activeRevision: this.activeRevision,
      activeSetDigest: this.activeSetDigest,
      digest: pluginSnapshotCanonicalDigest(plugin),
      plugin,
      snapshotDigest: createHash("sha256").update(`snapshot:${plugin.id}:${plugin.version}`).digest("hex"),
    }
  }

  private async activeIdentity(pluginId: string) {
    const identity = await this.resolveCapabilityIdentity(pluginId)
    if (!identity) throw new Error(`Plugin is not active: ${pluginId}`)
    return {
      activeRevision: identity.activeRevision,
      activeSetDigest: identity.activeSetDigest,
      pluginId,
      snapshotDigest: identity.snapshotDigest,
      version: identity.plugin.version,
    }
  }

  async acquireActivePlugin(pluginId: string) {
    const identity = await this.activeIdentity(pluginId)
    const plugin = this.installed.find((candidate) => candidate.id === pluginId)!
    const binding = await this.resolveCompanionBinding(plugin)
    const authorizationIdentity = createHash("sha256")
      .update(
        JSON.stringify([
          identity.snapshotDigest,
          binding.sha256,
          binding.size,
          binding.runtime === "bun" ? "convax-bun" : "native",
        ]),
      )
      .digest("hex")
    this.authorizationIdentities.set(pluginId, authorizationIdentity)
    this.snapshots.set(identity.snapshotDigest, { authorizationIdentity, binding, plugin })
    return this.createHandle(identity, plugin, binding, authorizationIdentity)
  }

  async acquirePluginSnapshot(identity: {
    activeRevision: number
    activeSetDigest: string
    pluginId: string
    pluginVersion: string
    snapshotDigest: string
  }) {
    const current = await this.activeIdentity(identity.pluginId)
    if (
      current.activeRevision === identity.activeRevision &&
      current.activeSetDigest === identity.activeSetDigest &&
      current.snapshotDigest === identity.snapshotDigest &&
      current.version === identity.pluginVersion
    ) {
      return this.acquireActivePlugin(identity.pluginId)
    }
    const snapshot = this.snapshots.get(identity.snapshotDigest)
    if (!snapshot) throw new Error("Historical Plugin snapshot is missing")
    return this.createHandle(
      {
        activeRevision: identity.activeRevision,
        activeSetDigest: identity.activeSetDigest,
        pluginId: identity.pluginId,
        snapshotDigest: identity.snapshotDigest,
        version: identity.pluginVersion,
      },
      snapshot.plugin,
      snapshot.binding,
      snapshot.authorizationIdentity,
    )
  }

  async acquirePinnedPlugin(ownerKey: string, identity: Awaited<ReturnType<FakePluginSource["activeIdentity"]>>) {
    const pinned = this.ownerPins.get(ownerKey)
    if (!pinned || !sameFakeIdentity(pinned, identity)) throw new Error("Plugin snapshot pin owner is missing or stale")
    const snapshot = this.snapshots.get(identity.snapshotDigest)
    if (!snapshot) throw new Error("Pinned Plugin snapshot is missing")
    return this.createHandle(identity, snapshot.plugin, snapshot.binding, snapshot.authorizationIdentity)
  }

  async assertCurrentActivePlugin(identity: Awaited<ReturnType<FakePluginSource["activeIdentity"]>>) {
    if (!sameFakeIdentity(await this.activeIdentity(identity.pluginId), identity)) {
      throw new Error(`Plugin changed before the current-identity guard: ${identity.pluginId}`)
    }
  }

  async listOwnerPins() {
    return [...this.ownerPins].map(([ownerKey, identity]) => ({ identity, ownerKey }))
  }

  async pinActivePluginForOwner(ownerKey: string, identity: Awaited<ReturnType<FakePluginSource["activeIdentity"]>>) {
    await this.assertCurrentActivePlugin(identity)
    const existing = this.ownerPins.get(ownerKey)
    if (existing && !sameFakeIdentity(existing, identity)) throw new Error("Plugin snapshot pin owner changed")
    this.ownerPins.set(ownerKey, structuredClone(identity))
  }

  async unpinPluginOwner(ownerKey: string, identity: Awaited<ReturnType<FakePluginSource["activeIdentity"]>>) {
    const existing = this.ownerPins.get(ownerKey)
    if (!existing) return false
    if (!sameFakeIdentity(existing, identity)) throw new Error("Plugin snapshot pin owner changed")
    this.ownerPins.delete(ownerKey)
    return true
  }

  private createHandle(
    identity: Awaited<ReturnType<FakePluginSource["activeIdentity"]>>,
    plugin: InstalledWebPluginSummary,
    binding: GenerationPluginExecutableBinding & { path: string },
    authorizationIdentity: string,
  ) {
    this.acquired += 1
    let released = false
    const releaseLease = () => {
      if (released) return
      released = true
      this.released += 1
    }
    let companionResolution = 0
    return {
      descriptor: {
        authorizations: {
          capabilityContractDigest: pluginSnapshotCanonicalDigest(plugin),
          ...(this.companionAuthorized ? { companionExecutionDigest: authorizationIdentity } : {}),
        },
        ...(this.companionPresent
          ? {
              companion: {
                entryPath: "companion",
                mode: binding.runtime === "bun" ? ("convax-bun" as const) : ("native" as const),
                sha256: binding.sha256,
                size: binding.size,
                target: "test-target",
              },
            }
          : {}),
      },
      identity: {
        activeRevision: identity.activeRevision,
        activeSetDigest: identity.activeSetDigest,
        pluginId: identity.pluginId,
        snapshotDigest: identity.snapshotDigest,
        version: identity.version,
      },
      plugin,
      release: releaseLease,
      resolveCompanion: async () => {
        if (released) throw new Error("Plugin lease is released")
        this.resolutions.push([identity.pluginId, "companion"])
        return this.companionResolutionPaths[companionResolution++] ?? binding.path
      },
    }
  }
}

function sameFakeIdentity(
  left: {
    activeRevision: number
    activeSetDigest: string
    pluginId: string
    snapshotDigest: string
    version: string
  },
  right: {
    activeRevision: number
    activeSetDigest: string
    pluginId: string
    snapshotDigest: string
    version: string
  },
) {
  return (
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.pluginId === right.pluginId &&
    left.snapshotDigest === right.snapshotDigest &&
    left.version === right.version
  )
}

class FakeMcpClient implements GenerationPluginMcpClient {
  readonly calls: Array<{
    input: Record<string, unknown>
    name: string
    requestTimeoutMs?: number | false
    signal?: AbortSignal
  }> = []
  readonly listSignals: Array<AbortSignal | undefined> = []
  closed = 0
  closeAndWait?: (force?: boolean) => Promise<void>
  readonly forcedCloses: boolean[] = []
  tools: McpToolDefinition[] = [{ inputSchema: { type: "object" }, name: "generate.image" }]
  result: McpToolCallResult = { content: [{ text: "done", type: "text" }] }
  readonly toolErrors = new Map<string, Error>()
  readonly toolResults = new Map<string, McpToolCallResult>()
  readonly recoveryCalls: Array<{ input: unknown; method: string }> = []

  async callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    lifecycleObserver?: import("./stdio-mcp-client").GenerationToolLifecycleObserver,
    requestTimeoutMs?: number | false,
  ): Promise<McpToolCallResult> {
    await lifecycleObserver?.({ type: "external-started" })
    this.calls.push({ input, name, requestTimeoutMs, signal })
    const configuredError = this.toolErrors.get(name)
    if (configuredError) throw configuredError
    const configuredResult = this.toolResults.get(name)
    if (configuredResult) return configuredResult
    if (name === "llm.gateway.start") {
      return {
        content: [{ text: "started", type: "text" }],
        structuredContent: {
          api_key: "a".repeat(43),
          base_url: "http://127.0.0.1:43123/v1",
          schema: "convax.llm-gateway/1",
        },
      }
    }
    if (name === "llm.models.list") {
      return {
        content: [{ text: "listed", type: "text" }],
        structuredContent: {
          models: [
            { id: "~openai/gpt-latest", name: "OpenAI GPT Latest" },
            { id: "deepseek/deepseek-v4-flash:free", name: "DeepSeek V4 Flash Free" },
          ],
          schema: "convax.llm-model-catalog/1",
        },
      }
    }
    return this.result
  }

  close(force = false) {
    this.closed += 1
    this.forcedCloses.push(force)
  }

  async generationRecoveryCapability() {
    return {
      binding: "test-account-binding",
      mode: "long-running-operation" as const,
      schema: "convax.generation-lro/1" as const,
    }
  }

  async callGenerationRecovery(method: GenerationRecoveryMethod, input: Omit<GenerationRecoveryRequest, "schema">) {
    this.recoveryCalls.push({ input, method })
    if (method === "convax/generation/operations/acknowledge") {
      return { acknowledged: true, schema: "convax.generation-lro-acknowledgement/1" }
    }
    return {
      schema: "convax.generation-lro-snapshot/1",
      status: "running",
      taskId: "task_123",
    }
  }

  async listTools(signal?: AbortSignal) {
    this.listSignals.push(signal)
    return this.tools
  }
}

const runtimes = new Set<GenerationPluginRuntime>()

afterEach(() => {
  for (const runtime of runtimes) runtime.dispose()
  runtimes.clear()
})

function setup(
  installed: InstalledWebPluginSummary[] = [generationPlugin()],
  exposedTools: readonly (string | McpToolDefinition)[] = ["generate.image"],
  _obsoleteAuthorizationSeam?: () => void | Promise<void>,
  resolveCompanion: (command: string) => Promise<GenerationPluginExecutableBinding & { path: string }> = async (
    command,
  ) => ({
    path: path.resolve("/active-plugin-snapshots", command),
    sha256: "a".repeat(64),
    size: 4_096,
  }),
  runtimeOptions: Pick<
    GenerationPluginRuntimeOptions,
    "bunRuntime" | "canvasCapabilities" | "platform" | "recoveryRuntimeDirectory" | "recoveryStateDirectory"
  > = {},
) {
  const plugins = new FakePluginSource()
  plugins.installed = installed
  plugins.resolveCompanionBinding = (plugin) => resolveCompanion(plugin.runtime!.command)
  const clients: FakeMcpClient[] = []
  const options: StdioMcpClientOptions[] = []
  const runtime = new GenerationPluginRuntime({
    createClient(clientOptions) {
      options.push(clientOptions)
      const client = new FakeMcpClient()
      client.tools = exposedTools.map((tool) =>
        typeof tool === "string" ? { inputSchema: { type: "object" }, name: tool } : tool,
      )
      clients.push(client)
      return client
    },
    environment: {
      HOME: "/Users/tester",
      LANG: "zh_CN.UTF-8",
      PATH: "/usr/local/bin:/usr/bin",
      SECRET_API_KEY: "must-not-leak",
    },
    plugins,
    ...runtimeOptions,
  })
  runtimes.add(runtime)
  return { clients, options, plugins, runtime }
}

function runtimeModelDefinition(
  choices: readonly { id: string; name: string }[] = [
    { id: "vendor/alpha:image", name: "Alpha Image" },
    { id: "vendor/beta:image", name: "Beta Image" },
  ],
): McpToolDefinition {
  return {
    inputSchema: {
      properties: {
        engine: {
          "x-convax-role": generationModelIdRole,
          oneOf: choices.map(({ id, name }) => ({ const: id, title: name })),
          title: "Engine",
          type: "string",
        },
        quality: { enum: ["standard", "high"], title: "Quality", type: "string" },
      },
      required: ["engine"],
      type: "object",
    },
    name: "generate.image",
  }
}

describe("GenerationPluginRuntime", () => {
  test("connects declared v8 LLM providers through a validated Main-only gateway descriptor", async () => {
    const { clients, runtime } = setup([llmPlugin()], ["llm.gateway.start"])
    expect(await runtime.connectLlmProviders()).toEqual([
      {
        apiKey: "a".repeat(43),
        baseUrl: "http://127.0.0.1:43123/v1",
        models: [{ id: "pippit-glm-main", name: "Pippit GLM Main" }],
        name: "Pippit GLM",
        pluginId: "xiaoyunque-generation",
        providerId: "plugin-xiaoyunque-generation-pippit-glm",
      },
    ])
    expect(clients[0]!.calls[0]).toMatchObject({ input: {}, name: "llm.gateway.start" })
  })

  test("loads a bounded runtime LLM model catalog before starting the provider gateway", async () => {
    const dynamic = mutablePlugin(llmPlugin())
    dynamic.contributes.llm!.modelCatalog = "runtime"
    const { clients, runtime } = setup([dynamic], ["llm.models.list", "llm.gateway.start"])

    expect(await runtime.connectLlmProviders()).toEqual([
      {
        apiKey: "a".repeat(43),
        baseUrl: "http://127.0.0.1:43123/v1",
        models: [
          { id: "~openai/gpt-latest", name: "OpenAI GPT Latest" },
          { id: "deepseek/deepseek-v4-flash:free", name: "DeepSeek V4 Flash Free" },
        ],
        name: "Pippit GLM",
        pluginId: "xiaoyunque-generation",
        providerId: "plugin-xiaoyunque-generation-pippit-glm",
      },
    ])
    expect(clients[0]!.calls.map(({ name }) => name)).toEqual(["llm.models.list", "llm.gateway.start"])
  })

  test("keeps a shared service authorization runtime alive when its LLM catalog reports an error", async () => {
    const combined = mutablePlugin(llmPlugin())
    combined.contributes.llm!.modelCatalog = "runtime"
    combined.contributes.service = { actions: ["authorize"] }
    const { clients, runtime } = setup(
      [combined],
      ["llm.models.list", "llm.gateway.start", "service.authorize", "service.authorization.complete"],
    )
    const authorization = await runtime.callService(combined.id, "authorize")
    clients[0]!.toolResults.set("llm.models.list", {
      content: [{ text: "Sign in before loading models", type: "text" }],
      isError: true,
    })

    await expect(runtime.connectLlmProviders()).rejects.toThrow(
      `Plugin LLM model catalog failed to load: ${combined.id}`,
    )
    expect(clients[0]!.closed).toBe(0)

    await authorization.completeAuthorization!({
      authorization_id: "request_0123456789abcdef",
      schema: "convax.plugin-service-external-authorization-completion/1",
    })
    expect(clients[0]!.calls.map(({ name }) => name)).toEqual([
      "service.authorize",
      "llm.models.list",
      "service.authorization.complete",
    ])
    expect(clients[0]!.closed).toBe(0)
  })

  test("discovers only explicit v8 generation contributions without starting their commands", async () => {
    const video = generationPlugin({
      id: "video-tools",
      name: "Video Tools",
      output: "video",
      toolId: "generate-video",
    })
    const { clients, runtime } = setup([staticPlugin(), video, generationPlugin()])

    expect(await runtime.listTools()).toEqual([
      {
        acceptedInputs: ["text", "reference_image"],
        description: "Generate image",
        id: "image-tools/generate.image",
        kind: "model",
        modelName: "Image Tools",
        output: "image",
        pluginId: "image-tools",
        pluginName: "Image Tools",
        title: "Generate",
        toolId: "generate.image",
      },
      {
        acceptedInputs: ["text", "reference_image"],
        description: "Generate video",
        id: "video-tools/generate-video",
        kind: "model",
        modelName: "Video Tools",
        output: "video",
        pluginId: "video-tools",
        pluginName: "Video Tools",
        title: "Generate",
        toolId: "generate-video",
      },
    ])
    expect((await runtime.listTools({ output: "video" })).map((tool) => tool.id)).toEqual([
      "video-tools/generate-video",
    ])
    expect(clients).toHaveLength(0)
  })

  test("derives v8 model and operation metadata without inferring from Plugin identity", async () => {
    const { clients, runtime } = setup([declarativeGenerationPlugin()])

    expect(await runtime.listTools()).toEqual([
      {
        acceptedInputs: ["reference_image"],
        description: "Generate image",
        id: "declarative-tools/generate.image",
        kind: "model",
        modelName: "Example Image 1",
        output: "image",
        pluginId: "declarative-tools",
        pluginName: "Declarative Tools",
        title: "Image generation tool",
        toolId: "generate.image",
      },
      {
        acceptedInputs: ["reference_video"],
        agentId: "transform_video",
        description: "Transform video",
        id: "declarative-tools/transform.video",
        kind: "operation",
        output: "video",
        pluginId: "declarative-tools",
        pluginName: "Declarative Tools",
        title: "Video operation",
        toolId: "transform.video",
      },
    ])
    expect(await runtime.listServices()).toEqual([
      {
        actions: [],
        capabilities: ["image"],
        description: "Explicit models and operations",
        models: [{ capability: "image", id: "generate.image", name: "Example Image 1" }],
        pluginId: "declarative-tools",
        pluginName: "Declarative Tools",
        version: "1.0.0",
      },
    ])
    expect(clients).toHaveLength(0)
  })

  test("expands an explicitly marked model selector into opaque stable host selections", async () => {
    const { clients, runtime } = setup([declarativeGenerationPlugin()], [runtimeModelDefinition()])
    const base = (await runtime.listTools()).find((tool) => tool.kind === "model")!

    const first = await runtime.expandModelTool(base)
    expect(first.map(({ modelName, toolId }) => ({ modelName, toolId }))).toEqual([
      { modelName: "Alpha Image", toolId: "generate.image" },
      { modelName: "Beta Image", toolId: "generate.image" },
    ])
    expect(first.map(({ id }) => id)).toEqual([
      expect.stringMatching(/^declarative-tools\/generate\.image\.model-selection-[a-f0-9]{64}$/),
      expect.stringMatching(/^declarative-tools\/generate\.image\.model-selection-[a-f0-9]{64}$/),
    ])
    expect(first[0]!.id).not.toContain("vendor/alpha:image")
    expect(first[1]!.id).not.toContain("vendor/beta:image")
    expect(new Set(first.map(({ id }) => id)).size).toBe(2)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.calls).toEqual([])

    clients[0]!.tools = [
      runtimeModelDefinition([
        { id: "vendor/beta:image", name: "Beta Renamed" },
        { id: "vendor/alpha:image", name: "Alpha Renamed" },
      ]),
    ]
    const reordered = await runtime.expandModelTool(base)
    const firstIdsByValueOrder = [first[1]!.id, first[0]!.id]
    expect(reordered.map(({ id }) => id)).toEqual(firstIdsByValueOrder)
    expect(reordered.map(({ modelName }) => modelName)).toEqual(["Beta Renamed", "Alpha Renamed"])
  })

  test("inspects every model family from one tools/list and keeps preparation live", async () => {
    const basePlugin = declarativeGenerationPlugin()
    const plugin: InstalledWebPluginSummary = {
      ...basePlugin,
      contributes: {
        ...basePlugin.contributes,
        generation: {
          models: [
            ...(basePlugin.contributes.generation?.models ?? []),
            { name: "Example Thumbnail", tool: "generate.thumbnail" },
          ],
          tools: [
            ...(basePlugin.contributes.generation?.tools ?? []),
            {
              acceptedInputs: [],
              description: "Generate thumbnail",
              id: "generate.thumbnail",
              output: "image",
              title: "Generate thumbnail",
            },
          ],
        },
      },
    }
    const { clients, runtime } = setup(
      [plugin],
      [runtimeModelDefinition(), { ...runtimeModelDefinition(), name: "generate.thumbnail" }],
    )
    const models = (await runtime.listTools()).filter((tool) => tool.kind === "model")

    const inspected = await runtime.inspectModelCatalog(models)

    expect(inspected).toHaveLength(4)
    expect(new Set(inspected.map(({ summary }) => summary.toolId))).toEqual(
      new Set(["generate.image", "generate.thumbnail"]),
    )
    expect(inspected.every(({ description, summary }) => description.toolId === summary.id)).toBeTrue()
    expect(inspected.every(({ description }) => description.fields.every(({ id }) => id !== "engine"))).toBeTrue()
    expect(clients[0].listSignals).toHaveLength(1)

    await runtime.prepareTool(inspected[0].summary)
    expect(clients[0].listSignals).toHaveLength(2)
  })

  test("hides and host-binds a concrete runtime model selector", async () => {
    const { clients, runtime } = setup([declarativeGenerationPlugin()], [runtimeModelDefinition()])
    const base = (await runtime.listTools()).find((tool) => tool.kind === "model")!
    const [selected] = await runtime.expandModelTool(base)

    expect(await runtime.describeTool(selected!.id)).toEqual({
      fields: [
        {
          choices: [
            { label: "standard", value: "standard" },
            { label: "high", value: "high" },
          ],
          id: "quality",
          kind: "select",
          label: "Quality",
          required: false,
        },
      ],
      toolId: selected!.id,
    })

    const prepared = await runtime.prepareTool(selected!)
    expect(prepared.validateInput({ quality: "high" })).toEqual({
      engine: "vendor/alpha:image",
      quality: "high",
    })
    expect(() => prepared.validateInput({ engine: "vendor/beta:image" })).toThrow("not declared")
    await expect(prepared.call({ engine: "vendor/beta:image", quality: "high" })).rejects.toThrow(
      "cannot override host-bound model selection",
    )
    expect(clients[0]!.calls).toEqual([])

    const fresh = await runtime.prepareTool(selected!)
    await fresh.call({ quality: "high" })
    expect(clients.at(-1)!.calls).toEqual([
      expect.objectContaining({
        input: { engine: "vendor/alpha:image", quality: "high" },
        name: "generate.image",
        requestTimeoutMs: false,
      }),
    ])
  })

  test("isolates recovery bindings for base tools that expose the same runtime model selector", async () => {
    const plugin = mutablePlugin(declarativeGenerationPlugin({ recovery: true }))
    const generation = plugin.contributes.generation!
    plugin.contributes.generation = {
      ...generation,
      models: [...(generation.models ?? []), { name: "Example Thumbnail 1", tool: "generate.thumbnail" }],
      tools: [
        ...generation.tools,
        {
          acceptedInputs: ["reference_image"],
          description: "Generate thumbnail",
          id: "generate.thumbnail",
          output: "image",
          recovery: {
            mode: "long-running-operation",
            schema: "convax.generation-lro/1",
          },
          title: "Thumbnail generation tool",
        },
      ],
    }
    const { runtime } = setup(
      [plugin],
      [runtimeModelDefinition(), { ...runtimeModelDefinition(), name: "generate.thumbnail" }],
    )
    const baseTools = (await runtime.listTools()).filter((tool) => tool.kind === "model")
    const imageBase = baseTools.find((tool) => tool.toolId === "generate.image")!
    const thumbnailBase = baseTools.find((tool) => tool.toolId === "generate.thumbnail")!
    const imageSelection = (await runtime.expandModelTool(imageBase))[0]!
    const thumbnailSelection = (await runtime.expandModelTool(thumbnailBase))[0]!

    const image = await runtime.prepareTool(imageSelection)
    const thumbnail = await runtime.prepareTool(thumbnailSelection)

    expect(image.recovery!.executionBindingDigest).not.toBe(thumbnail.recovery!.executionBindingDigest)
  })

  test("rejects a stale runtime model selection before tools call", async () => {
    const { clients, runtime } = setup([declarativeGenerationPlugin()], [runtimeModelDefinition()])
    const base = (await runtime.listTools()).find((tool) => tool.kind === "model")!
    const [selected] = await runtime.expandModelTool(base)
    const prepared = await runtime.prepareTool(selected!)

    clients[0]!.tools = [runtimeModelDefinition([{ id: "vendor/beta:image", name: "Beta Image" }])]
    await expect(prepared.call({ quality: "high" })).rejects.toThrow("changed while inputs were being staged")
    expect(clients[0]!.calls).toEqual([])
    await expect(runtime.prepareTool(selected!)).rejects.toThrow("no longer installed")
  })

  test("admits a v8 LRO only after the runtime handshake and binds fixed control calls", async () => {
    const { clients, runtime } = setup([declarativeGenerationPlugin({ recovery: true })])
    const summary = (await runtime.listTools()).find((tool) => tool.toolId === "generate.image")!
    expect(summary.recovery).toBe("long-running-operation")
    const prepared = await runtime.prepareTool(summary)
    expect(prepared.recovery).toMatchObject({
      bindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      executionBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      pluginPackageDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      runtimeAuthorizationDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(
      await prepared.recovery!.get({
        operationId: "operation-one",
        requestDigest: "a".repeat(64),
      }),
    ).toMatchObject({ status: "running", taskId: "task_123" })
    await prepared.recovery!.acknowledge({
      operationId: "operation-one",
      requestDigest: "a".repeat(64),
      taskId: "task_123",
    })
    expect(clients[0]!.recoveryCalls.map((call) => call.method)).toEqual([
      "convax/generation/operations/get",
      "convax/generation/operations/acknowledge",
    ])
  })

  test("shares one durable binding owner across two same-binding operations and releases it after the last ledger", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-shared-recovery-owner-test-"))
    try {
      const setupResult = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        undefined,
        undefined,
        { recoveryRuntimeDirectory: path.join(directory, "runtime-v3") },
      )
      const summary = (await setupResult.runtime.listTools()).find((entry) => entry.recovery)!
      const firstOperation = await setupResult.runtime.prepareTool(summary)
      const secondOperation = await setupResult.runtime.prepareTool(summary)

      expect(secondOperation.recovery!.executionBindingDigest).toBe(firstOperation.recovery!.executionBindingDigest)
      expect([...setupResult.plugins.ownerPins.keys()]).toEqual([
        `generation-binding:${firstOperation.recovery!.executionBindingDigest}`,
      ])

      // GenerationCanvasService calls this only after its final ledger for the
      // shared execution binding disappears.
      await setupResult.runtime.releaseRecoveryTool(firstOperation.recovery!.executionBindingDigest)
      expect(setupResult.plugins.ownerPins.size).toBe(0)
      await expect(
        setupResult.runtime.prepareRecoveryTool({
          executionBindingDigest: firstOperation.recovery!.executionBindingDigest,
          pluginPackageDigest: firstOperation.recovery!.pluginPackageDigest,
          runtimeAuthorizationDigest: firstOperation.recovery!.runtimeAuthorizationDigest,
          sidecarRecoveryBindingDigest: firstOperation.recovery!.bindingDigest,
          toolId: summary.id,
        }),
      ).rejects.toThrow()
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("startup removes record-first deletion orphan pins and rejects records whose durable pin is missing", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-reconcile-test-"))
    try {
      const recoveryRuntimeDirectory = path.join(directory, "runtime-v3")
      const setupResult = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        undefined,
        undefined,
        { recoveryRuntimeDirectory },
      )
      const summary = (await setupResult.runtime.listTools()).find((entry) => entry.recovery)!
      const prepared = await setupResult.runtime.prepareTool(summary)
      const digest = prepared.recovery!.executionBindingDigest
      setupResult.runtime.dispose()
      runtimes.delete(setupResult.runtime)

      await fs.rm(path.join(recoveryRuntimeDirectory, digest), { force: true, recursive: true })
      const orphanCleanup = new GenerationPluginRuntime({
        createClient: () => new FakeMcpClient(),
        plugins: setupResult.plugins,
        recoveryRuntimeDirectory,
      })
      runtimes.add(orphanCleanup)
      await orphanCleanup.initialize()
      expect(setupResult.plugins.ownerPins.size).toBe(0)
      orphanCleanup.dispose()
      runtimes.delete(orphanCleanup)

      const missingPinSetup = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        undefined,
        undefined,
        { recoveryRuntimeDirectory },
      )
      const missingSummary = (await missingPinSetup.runtime.listTools()).find((entry) => entry.recovery)!
      await missingPinSetup.runtime.prepareTool(missingSummary)
      missingPinSetup.runtime.dispose()
      runtimes.delete(missingPinSetup.runtime)
      missingPinSetup.plugins.ownerPins.clear()

      const missingPinRestart = new GenerationPluginRuntime({
        createClient: () => new FakeMcpClient(),
        plugins: missingPinSetup.plugins,
        recoveryRuntimeDirectory,
      })
      runtimes.add(missingPinRestart)
      await expect(missingPinRestart.initialize()).rejects.toThrow("missing or stale snapshot owner")
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("rolls back a newly created snapshot owner when recovery record publication fails", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-publication-fault-test-"))
    try {
      const recoveryRuntimeDirectory = path.join(directory, "runtime-v3")
      const setupResult = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        undefined,
        undefined,
        { recoveryRuntimeDirectory },
      )
      await setupResult.runtime.initialize()
      await fs.mkdir(recoveryRuntimeDirectory, { mode: 0o700, recursive: true })
      const publishPin = setupResult.plugins.pinActivePluginForOwner.bind(setupResult.plugins)
      setupResult.plugins.pinActivePluginForOwner = async (ownerKey, identity) => {
        await publishPin(ownerKey, identity)
        await fs.writeFile(path.join(recoveryRuntimeDirectory, ownerKey.slice("generation-binding:".length)), "blocked")
      }
      const summary = (await setupResult.runtime.listTools()).find((entry) => entry.recovery)!

      await expect(setupResult.runtime.prepareTool(summary)).rejects.toThrow(
        "Pinned generation recovery runtime directory is invalid",
      )
      expect(setupResult.plugins.ownerPins.size).toBe(0)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("pins distinct reopenable recovery runtimes for static tools sharing one sidecar binding", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-static-tool-recovery-test-"))
    const executable = path.join(directory, "sidecar")
    const original = Buffer.from("#!/bin/sh\nexit 0\n")
    try {
      await fs.writeFile(executable, original, { mode: 0o700 })
      const plugin = mutablePlugin(declarativeGenerationPlugin({ recovery: true }))
      const generation = plugin.contributes.generation!
      plugin.contributes.generation = {
        ...generation,
        models: [...(generation.models ?? []), { name: "Example Thumbnail 1", tool: "generate.thumbnail" }],
        tools: [
          ...generation.tools,
          {
            acceptedInputs: ["reference_image"],
            description: "Generate thumbnail",
            id: "generate.thumbnail",
            output: "image",
            recovery: {
              mode: "long-running-operation",
              schema: "convax.generation-lro/1",
            },
            title: "Thumbnail generation tool",
          },
        ],
      }
      const setupResult = setup(
        [plugin],
        ["generate.image", "generate.thumbnail"],
        async () => undefined,
        async () => ({
          path: executable,
          sha256: createHash("sha256").update(original).digest("hex"),
          size: original.byteLength,
        }),
        {
          recoveryRuntimeDirectory: path.join(directory, "runtime-v3"),
          recoveryStateDirectory: path.join(directory, "operation-v1"),
        },
      )
      const summaries = (await setupResult.runtime.listTools()).filter((entry) => entry.recovery)
      const imageSummary = summaries.find((entry) => entry.toolId === "generate.image")!
      const thumbnailSummary = summaries.find((entry) => entry.toolId === "generate.thumbnail")!
      const image = await setupResult.runtime.prepareTool(imageSummary)
      const thumbnail = await setupResult.runtime.prepareTool(thumbnailSummary)

      expect(image.recovery!.executionBindingDigest).not.toBe(thumbnail.recovery!.executionBindingDigest)

      setupResult.plugins.installed = []
      await setupResult.runtime.listTools()
      const reopened = await Promise.all(
        [
          { prepared: image, summary: imageSummary },
          { prepared: thumbnail, summary: thumbnailSummary },
        ].map(({ prepared, summary }) =>
          setupResult.runtime.prepareRecoveryTool({
            executionBindingDigest: prepared.recovery!.executionBindingDigest,
            pluginPackageDigest: prepared.recovery!.pluginPackageDigest,
            runtimeAuthorizationDigest: prepared.recovery!.runtimeAuthorizationDigest,
            sidecarRecoveryBindingDigest: prepared.recovery!.bindingDigest,
            toolId: summary.id,
          }),
        ),
      )
      expect(reopened.map(({ tool }) => tool.id)).toEqual([imageSummary.id, thumbnailSummary.id])
      expect(setupResult.clients).toHaveLength(3)
      setupResult.runtime.dispose()
      runtimes.delete(setupResult.runtime)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("recovers through an owner-pinned immutable closure after the Plugin is removed", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-pinned-recovery-runtime-test-"))
    const executable = path.join(directory, "sidecar")
    const original = Buffer.from("#!/bin/sh\nexit 0\n")
    try {
      await fs.writeFile(executable, original, { mode: 0o700 })
      const setupResult = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        async () => undefined,
        async () => ({
          path: executable,
          sha256: createHash("sha256").update(original).digest("hex"),
          size: original.byteLength,
        }),
        {
          recoveryRuntimeDirectory: path.join(directory, "runtime-v3"),
          recoveryStateDirectory: path.join(directory, "operation-v1"),
        },
      )
      const summary = (await setupResult.runtime.listTools()).find((entry) => entry.recovery)!
      const live = await setupResult.runtime.prepareTool(summary)
      const binding = {
        executionBindingDigest: live.recovery!.executionBindingDigest,
        pluginPackageDigest: live.recovery!.pluginPackageDigest,
        runtimeAuthorizationDigest: live.recovery!.runtimeAuthorizationDigest,
        sidecarRecoveryBindingDigest: live.recovery!.bindingDigest,
        toolId: summary.id,
      }
      setupResult.plugins.installed = []
      await setupResult.runtime.listTools()

      const pinned = await setupResult.runtime.prepareRecoveryTool(binding)
      expect(pinned.tool).toEqual(summary)
      expect(
        await pinned.execution.recovery!.get({
          operationId: "operation-one",
          requestDigest: "a".repeat(64),
        }),
      ).toMatchObject({ status: "running", taskId: "task_123" })
      expect(setupResult.clients).toHaveLength(2)
      expect(setupResult.options[1]!.command).toBe(executable)
      setupResult.runtime.dispose()
      runtimes.delete(setupResult.runtime)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("pins and reopens a recovery-capable runtime model after its live catalog changes", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-pinned-model-recovery-test-"))
    const executable = path.join(directory, "sidecar")
    const original = Buffer.from("#!/bin/sh\nexit 0\n")
    try {
      await fs.writeFile(executable, original, { mode: 0o700 })
      const setupResult = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        [runtimeModelDefinition()],
        async () => undefined,
        async () => ({
          path: executable,
          sha256: createHash("sha256").update(original).digest("hex"),
          size: original.byteLength,
        }),
        {
          recoveryRuntimeDirectory: path.join(directory, "runtime-v3"),
          recoveryStateDirectory: path.join(directory, "operation-v1"),
        },
      )
      const base = (await setupResult.runtime.listTools()).find((tool) => tool.kind === "model")!
      const [selected] = await setupResult.runtime.expandModelTool(base)
      const live = await setupResult.runtime.prepareTool(selected!)
      const requestDigest = "a".repeat(64)
      await live.call(live.validateInput({ quality: "high" }), undefined, undefined, {
        operationId: "operation-one",
        recovery: "required",
        requestDigest,
      })
      const binding = {
        executionBindingDigest: live.recovery!.executionBindingDigest,
        pluginPackageDigest: live.recovery!.pluginPackageDigest,
        runtimeAuthorizationDigest: live.recovery!.runtimeAuthorizationDigest,
        sidecarRecoveryBindingDigest: live.recovery!.bindingDigest,
        toolId: selected!.id,
      }

      setupResult.clients[0]!.tools = [runtimeModelDefinition([{ id: "vendor/beta:image", name: "Beta Image" }])]
      expect((await setupResult.runtime.expandModelTool(base)).map(({ modelName }) => modelName)).toEqual([
        "Beta Image",
      ])
      await expect(setupResult.runtime.prepareTool(selected!)).rejects.toThrow("no longer installed")
      await expect(live.recovery!.get({ operationId: "operation-one", requestDigest })).resolves.toMatchObject({
        status: "running",
        taskId: "task_123",
      })

      setupResult.plugins.installed = []
      await setupResult.runtime.listTools()
      const pinned = await setupResult.runtime.prepareRecoveryTool(binding)
      expect(pinned.tool).toEqual(selected!)
      await expect(
        pinned.execution.recovery!.get({ operationId: "operation-one", requestDigest }),
      ).resolves.toMatchObject({ status: "running", taskId: "task_123" })
      expect(setupResult.clients).toHaveLength(2)
      setupResult.runtime.dispose()
      runtimes.delete(setupResult.runtime)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("preserves v8 declarative behavior when the Plugin also owns Skills", async () => {
    const plain = setup([declarativeGenerationPlugin()])
    const pluginWithSkill = declarativeGenerationPlugin({ skill: true })
    const withSkill = setup([pluginWithSkill], ["generate.image", "transform.video", "service.status"])

    expect(pluginWithSkill.contributes.skills).toEqual([
      { name: "declarative-workflow", path: "skills/declarative-workflow" },
    ])
    expect(await withSkill.runtime.listTools()).toEqual(await plain.runtime.listTools())
    expect(await withSkill.runtime.listServices()).toEqual(await plain.runtime.listServices())
    expect(withSkill.clients).toHaveLength(0)

    await withSkill.runtime.callTool("declarative-tools/transform.video", { operation: "trim" })
    expect(withSkill.clients[0].calls).toEqual([
      {
        input: { operation: "trim" },
        name: "transform.video",
        requestTimeoutMs: false,
        signal: undefined,
      },
    ])
  })

  test("rejects legacy schemas instead of retaining executable aliases", async () => {
    const legacy = {
      ...declarativeGenerationPlugin(),
      schema: "convax.plugin/7",
    } as unknown as InstalledWebPluginSummary
    const { runtime } = setup([legacy])
    expect(await runtime.listTools()).toEqual([])
    expect(await runtime.listServices()).toEqual([])
  })

  test("projects a v8 direct-incoming operation binding into the stable tool summary", async () => {
    const installed = mutablePlugin(declarativeGenerationPlugin())
    installed.contributes.generation!.tools[1] = {
      ...installed.contributes.generation!.tools[1]!,
      inputBinding: "direct-incoming",
    }
    const { runtime } = setup([installed])

    expect(await runtime.listTools()).toContainEqual(
      expect.objectContaining({
        id: "declarative-tools/transform.video",
        inputBinding: "direct-incoming",
        kind: "operation",
        pluginId: "declarative-tools",
      }),
    )
  })

  test("injects the fixed reverse Canvas handler only for an all-bound v8 Tool principal", async () => {
    const installed = {
      ...declarativeGenerationPlugin(),
      capabilities: ["projects.read", "canvas.document.read"] as InstalledWebPluginSummary["capabilities"],
      hostApi: {
        major: 2,
        optional: ["canvas.document.get", "canvas.nodes.query"],
        required: ["projects.list"],
      },
    }
    const capabilityClient: PluginCanvasCapabilityClient = {
      async getDocument(ref) {
        return {
          document: { edges: [], id: ref.canvasId, nodes: [], revision: 1, title: "Main" },
          projection: "geometry",
          ref,
          storageVersion: "v1",
        }
      },
      async listCanvases(projectId) {
        return { canvases: [], projectId }
      },
      async listProjects() {
        return [{ available: true, id: "project-one", name: "One" }]
      },
      async queryNodes(ref) {
        return { nodes: [], ref, revision: 1, storageVersion: "v1" }
      },
      async subscribe() {
        return { close() {} }
      },
      async transact(request) {
        return {
          affectedNodeIds: [],
          changed: false,
          createdNodeIds: [],
          ref: request.ref,
          revision: request.expectedRevision,
          storageVersion: "v1",
          warnings: [],
        }
      },
    }
    const expectedPrincipals: InstalledWebPluginSummary[] = []
    const canvasCapabilities: NonNullable<GenerationPluginRuntimeOptions["canvasCapabilities"]> = {
      async connect() {
        return {
          close() {},
          async execute(call, requestContext) {
            if (call.method !== "projects.list") throw new Error(`Unexpected Host API: ${call.method}`)
            return { projects: await capabilityClient.listProjects(requestContext.signal) }
          },
          supports(method) {
            return Boolean(
              installed.hostApi && [...installed.hostApi.required, ...installed.hostApi.optional].includes(method),
            )
          },
        }
      },
      principals: {
        async issue(_pluginId, _runtime, expected) {
          if (expected) expectedPrincipals.push(expected)
          return {
            activeRevision: 1,
            activeSetDigest: "b".repeat(64),
            manifestDigest: "a".repeat(64),
            pluginId: installed.id,
            pluginVersion: installed.version,
            runtime: "tool",
            snapshotDigest: "c".repeat(64),
          }
        },
      },
    }
    const { options, runtime } = setup([installed], ["generate.image"], async () => undefined, undefined, {
      canvasCapabilities,
    })

    await runtime.callTool("declarative-tools/generate.image", {})
    expect(expectedPrincipals).toEqual([installed])
    expect(options[0]?.serverRequestHandler?.methods).toEqual([
      pluginCapabilityNestedInvokeMcpMethod,
      toolPluginCompanionMcpMethod("projects.list"),
      toolPluginCompanionMcpMethod("canvas.document.get"),
      toolPluginCompanionMcpMethod("canvas.nodes.query"),
    ])
    await expect(
      options[0]!.serverRequestHandler!.handle(
        { method: toolPluginCompanionMcpMethod("projects.list") },
        { sendNotification() {}, signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ projects: [{ available: true, id: "project-one", name: "One" }] })

    const noProjectScope = {
      ...installed,
      capabilities: ["canvas.document.read"] as InstalledWebPluginSummary["capabilities"],
      hostApi: {
        major: 2,
        optional: ["canvas.document.get", "canvas.nodes.query"],
        required: [],
      },
    }
    const withoutScope = setup([noProjectScope], ["generate.image"], async () => undefined, undefined, {
      canvasCapabilities,
    })
    await withoutScope.runtime.callTool("declarative-tools/generate.image", {})
    expect(withoutScope.options[0]?.serverRequestHandler?.methods).toEqual([pluginCapabilityNestedInvokeMcpMethod])
  })

  test("lazily describes only one selected tool through a bounded scalar schema", async () => {
    const { clients, runtime } = setup(
      [generationPlugin()],
      [
        {
          inputSchema: {
            properties: {
              enabled: { default: true, description: "Apply enhancement", title: "Enhance", type: "boolean" },
              operation_id: { type: "string" },
              prompt: { type: "string" },
              quality: {
                default: "high",
                description: "Output quality preset",
                oneOf: [
                  { const: "standard", title: "Standard" },
                  { const: "high", title: "High" },
                ],
                title: "Quality",
                type: "string",
              },
              seed: { maximum: 999, minimum: 0, title: "Seed", type: "integer" },
              strength: { default: 0.5, maximum: 1, minimum: 0, title: "Strength", type: "number" },
              suffix: { default: "", maxLength: 40, minLength: 0, title: "Suffix", type: "string" },
              unsupported: { type: "object" },
            },
            required: ["schema", "operation_id", "prompt", "quality"],
            type: "object",
          },
          name: "generate.image",
        },
      ],
    )

    expect(clients).toHaveLength(0)
    await expect(runtime.describeTool("image-tools/generate.image")).resolves.toEqual({
      fields: [
        {
          defaultValue: true,
          description: "Apply enhancement",
          id: "enabled",
          kind: "boolean",
          label: "Enhance",
          required: false,
        },
        {
          choices: [
            { label: "Standard", value: "standard" },
            { label: "High", value: "high" },
          ],
          defaultValue: "high",
          description: "Output quality preset",
          id: "quality",
          kind: "select",
          label: "Quality",
          required: true,
        },
        {
          id: "seed",
          kind: "integer",
          label: "Seed",
          maximum: 999,
          minimum: 0,
          required: false,
        },
        {
          defaultValue: 0.5,
          id: "strength",
          kind: "number",
          label: "Strength",
          maximum: 1,
          minimum: 0,
          required: false,
        },
        {
          defaultValue: "",
          id: "suffix",
          kind: "text",
          label: "Suffix",
          maxLength: 40,
          minLength: 0,
          required: false,
        },
      ],
      toolId: "image-tools/generate.image",
    })
    expect(clients).toHaveLength(1)
    expect(clients[0]!.calls).toEqual([])
    expect(clients[0]!.listSignals).toEqual([undefined])
  })

  test("fails closed and evicts a sidecar whose required custom schema is unsafe or unbounded", async () => {
    const { clients, runtime } = setup(
      [generationPlugin()],
      [
        {
          inputSchema: {
            properties: {
              advanced: { type: "object" },
              prompt: { type: "string" },
            },
            required: ["prompt", "advanced"],
            type: "object",
          },
          name: "generate.image",
        },
      ],
    )

    await expect(runtime.describeTool("image-tools/generate.image")).rejects.toThrow("not a supported scalar field")
    expect(clients[0]!.closed).toBe(1)
    expect(clients[0]!.calls).toEqual([])

    await expect(
      setup(
        [generationPlugin()],
        [
          {
            inputSchema: {
              properties: { notes: { description: "x".repeat(70_000), type: "string" } },
              type: "object",
            },
            name: "generate.image",
          },
        ],
      ).runtime.describeTool("image-tools/generate.image"),
    ).rejects.toThrow("schema is too large")
  })

  test("validates tool input against the current schema and binds a prepared call to that definition", async () => {
    const properties = {
      prompt: { type: "string" },
      quality: { enum: ["standard", "high"], type: "string" },
      steps: { maximum: 50, minimum: 1, type: "integer" },
    }
    const definition: McpToolDefinition = {
      inputSchema: {
        properties,
        required: ["prompt", "quality"],
        type: "object",
      },
      name: "generate.image",
    }
    const { clients, runtime } = setup([generationPlugin()], [definition])
    const [declared] = await runtime.listTools()
    const prepared = await runtime.prepareTool(declared!)

    expect(prepared.validateInput({ quality: "high", steps: 12 })).toEqual({ quality: "high", steps: 12 })
    expect(() => prepared.validateInput({ steps: 12 })).toThrow("required: quality")
    expect(() => prepared.validateInput({ quality: "ultra" })).toThrow("declared choices")
    expect(() => prepared.validateInput({ prompt: "override", quality: "high" })).toThrow("cannot override")
    expect(() => prepared.validateInput({ quality: "high", steps: 1.5 })).toThrow("numeric range")

    clients[0]!.tools = [
      {
        ...definition,
        inputSchema: {
          ...definition.inputSchema,
          properties: {
            ...properties,
            steps: { maximum: 100, minimum: 1, type: "integer" },
          },
        },
      },
    ]
    await runtime.describeTool("image-tools/generate.image")
    await expect(prepared.call({ quality: "high" })).rejects.toThrow("changed while inputs were being staged")
    expect(clients[0]!.calls).toEqual([])
  })

  test("discovers service-only contributions without starting commands and uses fixed MCP names", async () => {
    const installedService = servicePlugin()
    const executable = {
      path: path.resolve("/resolved-tools", "account-tool-cli"),
      sha256: "a".repeat(64),
      size: 4_096,
    }
    const { clients, plugins, runtime } = setup(
      [staticPlugin(), installedService],
      ["service.status", "service.sign_out"],
      undefined,
      async () => executable,
    )

    expect(await runtime.listServices()).toEqual([
      {
        actions: ["sign_out"],
        capabilities: [],
        description: "External account service",
        models: [],
        pluginId: "account-tools",
        pluginName: "Account Tools",
        version: "1.0.0",
      },
    ])
    expect(clients).toHaveLength(0)

    const firstStatus = await runtime.callService("account-tools", "status")
    const secondStatus = await runtime.callService("account-tools", "status")
    expect(clients[0]!.listSignals).toEqual([])
    await runtime.callService("account-tools", "sign_out")
    expect(firstStatus.authorizationIdentity).toBe(plugins.authorizationIdentities.get(installedService.id))
    expect(firstStatus.snapshotDigest).toBe(
      createHash("sha256").update(`snapshot:${installedService.id}:${installedService.version}`).digest("hex"),
    )
    expect(secondStatus.authorizationIdentity).toBe(firstStatus.authorizationIdentity)
    expect(secondStatus.snapshotDigest).toBe(firstStatus.snapshotDigest)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.listSignals).toHaveLength(1)
    expect(clients[0].calls.map(({ input, name, requestTimeoutMs }) => ({ input, name, requestTimeoutMs }))).toEqual([
      { input: {}, name: "service.status", requestTimeoutMs: undefined },
      { input: {}, name: "service.status", requestTimeoutMs: undefined },
      { input: {}, name: "service.sign_out", requestTimeoutMs: undefined },
    ])
  })

  test("derives service capabilities and model labels from the same generation manifest", async () => {
    const combined = mutablePlugin(
      generationPlugin({
        id: "creative-service",
        name: "Creative Service",
        output: "video",
        toolId: "video.generate",
      }),
    )
    combined.contributes.service = { actions: ["authorize"] }
    combined.contributes.generation!.tools.unshift({
      acceptedInputs: ["text", "reference_image"],
      description: "Generate image",
      id: "image.generate",
      output: "image",
      title: "Image Model",
    })
    combined.contributes.generation!.models = [
      { name: "Image Model", tool: "image.generate" },
      { name: "Video Model", tool: "video.generate" },
    ]
    combined.contributes.generation!.tools[1]!.title = "Video Model"
    const { clients, runtime } = setup([combined])

    expect(await runtime.listServices()).toEqual([
      {
        actions: ["authorize"],
        capabilities: ["image", "video"],
        description: "External generation tools",
        models: [
          { capability: "image", id: "image.generate", name: "Image Model" },
          { capability: "video", id: "video.generate", name: "Video Model" },
        ],
        pluginId: "creative-service",
        pluginName: "Creative Service",
        version: "1.0.0",
      },
    ])
    expect(clients).toHaveLength(0)
  })

  test("derives LLM service capabilities and models from the LLM manifest", async () => {
    const combined = mutablePlugin(llmPlugin())
    combined.contributes.service = { actions: ["authorize"] }
    const { clients, runtime } = setup([combined])

    expect(await runtime.listServices()).toEqual([
      {
        actions: ["authorize"],
        capabilities: ["llm"],
        description: "External LLM provider",
        models: [{ capability: "llm", id: "pippit-glm-main", name: "Pippit GLM Main" }],
        pluginId: "xiaoyunque-generation",
        pluginName: "XiaoYunque",
        version: "0.4.0",
      },
    ])
    expect(clients).toHaveLength(0)
  })

  test("binds browser authorization completion to the exact service runtime and fixed MCP tool", async () => {
    const { clients, runtime } = setup(
      [servicePlugin(["authorize"])],
      ["service.authorize", "service.authorization.complete", "service.status"],
    )
    const initial = await runtime.callService("account-tools", "authorize")
    expect(initial.completeAuthorization).toBeFunction()
    await initial.completeAuthorization!({
      authorization_id: "request_0123456789abcdef",
      cookie_origin: "https://accounts.example.com",
      cookies: [{ name: "session_id", value: "main-only-cookie" }],
      schema: pluginServiceBrowserAuthorizationCompletionSchema,
    })

    expect(clients[0]!.calls.map(({ name }) => name)).toEqual(["service.authorize", "service.authorization.complete"])
    expect(clients[0]!.calls[1]!.input).toEqual({
      authorization_id: "request_0123456789abcdef",
      cookie_origin: "https://accounts.example.com",
      cookies: [{ name: "session_id", value: "main-only-cookie" }],
      schema: pluginServiceBrowserAuthorizationCompletionSchema,
    })
    await expect(
      initial.completeAuthorization!({
        authorization_id: "request_0123456789abcdef",
        cookie_origin: "https://accounts.example.com",
        cookies: [{ name: "session_id", value: "must-not-be-sent-twice" }],
        schema: pluginServiceBrowserAuthorizationCompletionSchema,
      }),
    ).rejects.toThrow("already used")
    expect(clients[0]!.calls).toHaveLength(2)
  })

  test("rejects browser authorization completion when the Plugin changed", async () => {
    const { clients, plugins, runtime } = setup(
      [servicePlugin(["authorize"])],
      ["service.authorize", "service.authorization.complete"],
    )
    const initial = await runtime.callService("account-tools", "authorize")
    plugins.installed = [{ ...servicePlugin(["authorize"]), version: "2.0.0" }]

    await expect(
      initial.completeAuthorization!({
        authorization_id: "request_0123456789abcdef",
        cookie_origin: "https://accounts.example.com",
        cookies: [{ name: "session_id", value: "must-not-reach-updated-plugin" }],
        schema: pluginServiceBrowserAuthorizationCompletionSchema,
      }),
    ).rejects.toThrow("changed before browser authorization completed")
    expect(clients[0]!.calls.map(({ name }) => name)).toEqual(["service.authorize"])
  })

  test("requires each service action in the manifest and the matching fixed sidecar tool", async () => {
    const undeclared = setup([servicePlugin([])], ["service.status", "service.sign_out"])
    await expect(undeclared.runtime.callService("account-tools", "sign_out")).rejects.toThrow("not declared")
    expect(undeclared.clients).toHaveLength(0)

    const missing = setup([servicePlugin(["sign_out"])], ["service.status"])
    await expect(missing.runtime.callService("account-tools", "sign_out")).rejects.toThrow(
      "did not expose its fixed MCP tool: service.sign_out",
    )
    expect(missing.clients[0].calls).toHaveLength(0)
  })

  test("passes only the selected Plan key to the fixed Checkout tool", async () => {
    const { clients, runtime } = setup([servicePlugin(["checkout"])], ["service.checkout", "service.status"])

    await runtime.callService("account-tools", "checkout", undefined, { planKey: "pro-monthly" })

    expect(clients[0]?.calls).toEqual([
      {
        input: { plan_key: "pro-monthly" },
        name: "service.checkout",
        requestTimeoutMs: undefined,
      },
    ])
    await expect(runtime.callService("account-tools", "checkout")).rejects.toThrow("input is invalid")
    await expect(runtime.callService("account-tools", "status", undefined, { planKey: "pro-monthly" })).rejects.toThrow(
      "input is invalid",
    )
  })

  test("reuses one verified sidecar for generation and service contributions", async () => {
    const generation = generationPlugin()
    const combined: InstalledWebPluginSummary = {
      ...generation,
      contributes: {
        ...generation.contributes,
        service: { actions: ["sign_out"] },
      },
    }
    const { clients, runtime } = setup([combined], ["generate.image", "service.status", "service.sign_out"])

    await runtime.callTool("image-tools/generate.image", {})
    await runtime.callService("image-tools", "status")
    await runtime.callService("image-tools", "sign_out")
    expect(clients).toHaveLength(1)
    expect(clients[0].calls.map((call) => call.name)).toEqual(["generate.image", "service.status", "service.sign_out"])
  })

  test("does not evict an accepted recovery runtime when a shared status probe fails", async () => {
    const combined = declarativeGenerationPlugin({ recovery: true })
    const { clients, runtime } = setup([combined], ["generate.image", "transform.video", "service.status"])
    const selected = (await runtime.listTools()).find(({ toolId }) => toolId === "generate.image")!
    const prepared = await runtime.prepareTool(selected)
    const statusError = new Error("Transient status transport failure")
    clients[0]!.toolErrors.set("service.status", statusError)

    await expect(runtime.callService(combined.id, "status")).rejects.toBe(statusError)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.closed).toBe(0)

    await expect(
      prepared.recovery!.get({
        operationId: "operation-shared-status",
        requestDigest: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ status: "running", taskId: "task_123" })
    expect(clients[0]!.recoveryCalls).toHaveLength(1)
    expect(clients[0]!.closed).toBe(0)
  })

  test("lazily starts a manifest-scoped MCP command with a narrow environment", async () => {
    const { clients, options, plugins, runtime } = setup([generationPlugin()], ["generate.image"])
    const controller = new AbortController()

    expect(await runtime.callTool("image-tools/generate.image", { prompt: "a fox" }, controller.signal)).toEqual({
      content: [{ text: "done", type: "text" }],
    })

    expect(plugins.resolutions).toEqual([
      ["image-tools", "companion"],
      ["image-tools", "companion"],
    ])
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      args: ["serve", "--stdio"],
      command: path.resolve("/active-plugin-snapshots/image-tool-cli"),
      env: {
        HOME: "/Users/tester",
        LANG: "zh_CN.UTF-8",
        PATH: "/usr/local/bin:/usr/bin",
      },
    })
    expect(path.dirname(options[0]!.cwd)).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(options[0]!.cwd)).toStartWith("convax-generation-runtime-")
    expect(options[0]!.cwd).not.toContain("/active-plugin-snapshots/image-tools")
    expect(options[0].env).not.toHaveProperty("SECRET_API_KEY")
    expect(clients[0].listSignals).toEqual([controller.signal, controller.signal])
    expect(clients[0].calls).toEqual([
      {
        input: { prompt: "a fox" },
        name: "generate.image",
        requestTimeoutMs: false,
        signal: controller.signal,
      },
    ])

    await runtime.callTool("image-tools/generate.image", { prompt: "a cat" })
    expect(clients).toHaveLength(1)
    expect(clients[0].listSignals).toEqual([controller.signal, controller.signal, undefined, undefined])
    expect(clients[0].calls).toHaveLength(2)
  })

  test("invalidates the cached sidecar and releases its snapshot lease when the ActiveSet changes", async () => {
    const { clients, plugins, runtime } = setup([generationPlugin()], ["generate.image"])
    await runtime.callTool("image-tools/generate.image", { prompt: "first" })
    expect(plugins.acquired).toBe(1)
    expect(plugins.released).toBe(0)

    plugins.activeRevision += 1
    plugins.activeSetDigest = "d".repeat(64)
    await runtime.callTool("image-tools/generate.image", { prompt: "second" })

    expect(clients).toHaveLength(2)
    expect(clients[0]!.closed).toBe(1)
    expect(plugins.acquired).toBe(2)
    expect(plugins.released).toBe(1)
    runtime.dispose()
    expect(plugins.released).toBe(2)
  })

  test("holds the executable snapshot lease until the real child-exit barrier settles", async () => {
    const { clients, options, plugins, runtime } = setup([generationPlugin()], ["generate.image"])
    await runtime.callTool("image-tools/generate.image", { prompt: "barrier" })
    let releaseExit!: () => void
    const childExit = new Promise<void>((resolve) => {
      releaseExit = resolve
    })
    clients[0]!.closeAndWait = async (force = false) => {
      clients[0]!.close(force)
      await childExit
    }

    const disposed = runtime.disposeAndWait()
    await Bun.sleep(0)
    expect(clients[0]!.closed).toBe(1)
    expect(plugins.released).toBe(0)
    expect(await fs.stat(options[0]!.cwd)).toBeDefined()

    releaseExit()
    await disposed
    expect(plugins.released).toBe(1)
    await expect(fs.stat(options[0]!.cwd)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("injects one private binding-scoped recovery journal directory without exposing its identity", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-recovery-state-test-"))
    const root = path.join(parent, "operation-v1")
    try {
      const { options, runtime } = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        async () => undefined,
        undefined,
        { recoveryStateDirectory: root },
      )
      const [tool] = await runtime.listTools()
      await runtime.prepareTool(tool!)
      const injected = options[0]?.env?.CONVAX_GENERATION_LRO_DIRECTORY
      const realRoot = await fs.realpath(root)
      expect(injected).toMatch(new RegExp(`^${realRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[a-f0-9]{64}$`))
      expect((await fs.stat(realRoot)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(injected!)).mode & 0o777).toBe(0o700)
      expect(path.basename(injected!)).not.toContain("image-tools")
      expect(options[0]?.env).not.toHaveProperty("SECRET_API_KEY")
    } finally {
      await fs.rm(parent, { force: true, recursive: true })
    }
  })

  test("rejects a symbolic recovery journal root before starting the sidecar", async () => {
    if (process.platform === "win32") return
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-recovery-symlink-test-"))
    const real = path.join(parent, "real")
    const linked = path.join(parent, "linked")
    try {
      await fs.mkdir(real, { mode: 0o700 })
      await fs.symlink(real, linked)
      const { clients, runtime } = setup(
        [declarativeGenerationPlugin({ recovery: true })],
        ["generate.image"],
        async () => undefined,
        undefined,
        { recoveryStateDirectory: linked },
      )
      const [tool] = await runtime.listTools()
      await expect(runtime.prepareTool(tool!)).rejects.toThrow("must be a real directory")
      expect(clients).toHaveLength(0)
    } finally {
      await fs.rm(parent, { force: true, recursive: true })
    }
  })

  test("starts only the lease-bound immutable snapshot companion", async () => {
    const setupResult = setup([generationPlugin({ version: "2.0.0" })], ["generate.image"], undefined, async () => ({
      path: "/plugin-installations/closures/snapshot/companion/entrypoint",
      sha256: "b".repeat(64),
      size: 20,
    }))

    await setupResult.runtime.callTool("image-tools/generate.image", {})

    expect(setupResult.options[0]!.command).toBe("/plugin-installations/closures/snapshot/companion/entrypoint")
    expect(setupResult.plugins.resolutions).toEqual([
      ["image-tools", "companion"],
      ["image-tools", "companion"],
    ])
    expect(setupResult.plugins.acquired).toBe(1)
    expect(setupResult.plugins.released).toBe(0)
  })

  test("runs a lease-bound convax-bun companion through the app-owned Bun runtime", async () => {
    const setupResult = setup(
      [generationPlugin({ version: "2.0.0" })],
      ["generate.image"],
      undefined,
      async () => ({
        path: "/plugin-installations/closures/snapshot/companion/entrypoint",
        runtime: "bun",
        sha256: "b".repeat(64),
        size: 20,
      }),
      {
        bunRuntime: { command: "/app/resources/opencode/bin/opencode", env: { BUN_BE_BUN: "1" } },
      },
    )

    await setupResult.runtime.callTool("image-tools/generate.image", {})

    expect(setupResult.options[0]!.command).toBe("/app/resources/opencode/bin/opencode")
    expect(setupResult.options[0]!.args).toEqual([
      "/plugin-installations/closures/snapshot/companion/entrypoint",
      "serve",
      "--stdio",
    ])
    expect(setupResult.options[0]!.env).toMatchObject({ BUN_BE_BUN: "1" })
  })

  test("fails closed when a lease-bound convax-bun companion has no app-owned Bun runtime", async () => {
    const { runtime } = setup([generationPlugin()], ["generate.image"], undefined, async () => ({
      path: "/plugin-installations/closures/snapshot/companion/entrypoint",
      runtime: "bun",
      sha256: "b".repeat(64),
      size: 20,
    }))

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("Bun runtime is unavailable")
  })

  test("never falls back to PATH when the active snapshot has no authorized companion", async () => {
    const missing = setup([generationPlugin()])
    missing.plugins.companionPresent = false
    await expect(missing.runtime.callTool("image-tools/generate.image", {})).rejects.toThrow(
      "no immutable active companion",
    )
    expect(missing.clients).toHaveLength(0)

    const unauthorized = setup([generationPlugin()])
    unauthorized.plugins.companionAuthorized = false
    await expect(unauthorized.runtime.callTool("image-tools/generate.image", {})).rejects.toThrow(
      "companion setup is required",
    )
    expect(unauthorized.clients).toHaveLength(0)
  })

  test("re-resolves the leased companion immediately before process creation", async () => {
    const setupResult = setup([generationPlugin()])
    setupResult.plugins.companionResolutionPaths = [
      "/plugin-installations/closures/snapshot/companion/entrypoint",
      "/plugin-installations/closures/replaced/companion/entrypoint",
    ]

    await expect(setupResult.runtime.callTool("image-tools/generate.image", {})).rejects.toThrow(
      "companion changed immediately before process start",
    )
    expect(setupResult.clients).toHaveLength(0)
    expect(setupResult.plugins.released).toBe(1)
  })

  test("requires the sidecar to expose the exact tool declared by the installed manifest", async () => {
    const { clients, runtime } = setup([generationPlugin()], ["some-other-tool"])

    expect((await rejection(runtime.callTool("image-tools/generate.image", { prompt: "a fox" }))).message).toContain(
      "did not expose its declared MCP tool",
    )
    expect(clients[0].calls).toHaveLength(0)
    expect(clients[0].closed).toBe(1)
    expect(clients[0].forcedCloses).toEqual([false])
  })

  test("invalidates cached processes when an installation changes or disappears", async () => {
    const { clients, plugins, runtime } = setup()
    await runtime.callTool("image-tools/generate.image", { prompt: "first" })
    expect(clients).toHaveLength(1)

    plugins.installed = [generationPlugin({ command: "image-tool-v2", version: "2.0.0" })]
    await runtime.listTools()
    expect(clients[0].closed).toBe(1)
    expect(clients[0].forcedCloses).toEqual([false])
    expect(clients).toHaveLength(1)

    await runtime.callTool("image-tools/generate.image", { prompt: "second" })
    expect(clients).toHaveLength(2)
    expect(clients[1].closed).toBe(0)

    plugins.installed = []
    expect(await runtime.listTools()).toEqual([])
    expect(clients[1].closed).toBe(1)
    expect(clients[1].forcedCloses).toEqual([false])
    expect((await rejection(runtime.callTool("image-tools/generate.image", {}))).message).toContain("not installed")
  })

  test("binds a prepared execution to one Plugin fingerprint and tool declaration", async () => {
    const { clients, plugins, runtime } = setup()
    const [declared] = await runtime.listTools()
    const prepared = await runtime.prepareTool(declared!)
    expect(clients).toHaveLength(1)

    plugins.installed = [generationPlugin({ output: "video", version: "2.0.0" })]
    await expect(prepared.call({ prompt: "must not reach the replacement" })).rejects.toThrow(
      "changed while inputs were being staged",
    )
    expect(clients[0].calls).toHaveLength(0)
  })

  test("revalidates a prepared execution after external-started before writing tools/call", async () => {
    const { clients, plugins, runtime } = setup()
    const [declared] = await runtime.listTools()
    const prepared = await runtime.prepareTool(declared!)
    const dispatchGuard = mock(async () => undefined)

    await expect(
      prepared.call({ prompt: "must remain unbilled" }, undefined, undefined, undefined, {
        guard: dispatchGuard,
        validate: async () => {
          plugins.installed = [generationPlugin({ output: "video", version: "2.0.0" })]
        },
      }),
    ).rejects.toThrow("changed before the external call")
    expect(dispatchGuard).not.toHaveBeenCalled()
    expect(clients[0].calls).toHaveLength(0)
  })

  test("keeps a prepared runtime cached when a host guard rejects before dispatch", async () => {
    const { clients, runtime } = setup()
    const [declared] = await runtime.listTools()
    const prepared = await runtime.prepareTool(declared!)
    const guardError = new Error("Generation model service disconnected")

    await expect(
      prepared.call({ prompt: "must remain unbilled" }, undefined, undefined, undefined, {
        guard: () => {
          throw guardError
        },
      }),
    ).rejects.toBe(guardError)
    expect(clients).toHaveLength(1)
    expect(clients[0].calls).toHaveLength(0)
    expect(clients[0].closed).toBe(0)

    await expect(prepared.call({ prompt: "safe follow-up" })).resolves.toBeDefined()
    expect(clients).toHaveLength(1)
    expect(clients[0].calls).toHaveLength(1)
    expect(clients[0].closed).toBe(0)
  })

  test("supports sender cancellation and explicit Plugin/all disposal", async () => {
    const { clients, runtime } = setup()
    const canceled = new AbortController()
    canceled.abort("user canceled")
    expect(await rejection(runtime.callTool("image-tools/generate.image", {}, canceled.signal))).toMatchObject({
      name: "AbortError",
    })
    expect(clients).toHaveLength(0)

    await runtime.callTool("image-tools/generate.image", {})
    expect(runtime.disposePlugin("image-tools")).toBe(true)
    expect(clients[0].closed).toBe(1)
    expect(clients[0].forcedCloses).toEqual([false])
    expect(runtime.disposePlugin("image-tools")).toBe(false)

    await runtime.callTool("image-tools/generate.image", {})
    runtime.dispose()
    expect(clients[1].closed).toBe(1)
    expect(clients[1].forcedCloses).toEqual([true])
    runtime.dispose()
    expect((await rejection(runtime.listTools())).message).toContain("disposed")
  })

  test("fails closed on Windows until the host can own a Job Object", async () => {
    const { clients, runtime } = setup([generationPlugin()], ["generate.image"], undefined, undefined, {
      platform: "win32",
    })

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("Job Object")
    expect(clients).toHaveLength(0)
  })
})

describe("generation Plugin identifiers and environment", () => {
  test("uses an unambiguous host id and rejects command/path-shaped ids", () => {
    expect(generationPluginToolHostId("image-tools", "generate.image")).toBe("image-tools/generate.image")
    expect(() => generationPluginToolHostId("image/tools", "generate.image")).toThrow("Invalid Plugin id")
    expect(() => generationPluginToolHostId("image-tools", "../generate")).toThrow("Invalid generation tool id")
  })

  test("normalizes Windows environment casing and drops NUL-bearing values", () => {
    expect(
      generationPluginEnvironment({
        home: "C:\\Users\\Tester",
        Path: "C:\\Tools",
        SECRET: "no",
        TEMP: "bad\0path",
      }),
    ).toEqual({ HOME: "C:\\Users\\Tester", PATH: "C:\\Tools" })
  })
})
