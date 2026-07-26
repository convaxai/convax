import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  webPluginManifestSchema,
  webPluginManifestSchemaV2,
  webPluginManifestSchemaV3,
  webPluginManifestSchemaV4,
  webPluginManifestSchemaV5,
  webPluginManifestSchemaV6,
  webPluginManifestSchemaV7,
  type InstalledWebPluginSummary,
  type WebPluginGenerationModality,
} from "../plugin-contracts"
import type { PluginCanvasCapabilityClient } from "../plugin-capability-contracts"
import {
  GenerationPluginRuntime,
  generationPluginEnvironment,
  generationPluginToolHostId,
  materializeGenerationPluginExecutable,
  resolveGenerationPluginExecutable,
  type GenerationPluginExecutableBinding,
  type GenerationPluginExecutableSnapshot,
  type GenerationPluginMcpClient,
  type GenerationPluginRuntimeOptions,
  type GenerationPluginSource,
} from "./generation-plugin-runtime"
import type { McpToolCallResult, McpToolDefinition, StdioMcpClientOptions } from "./stdio-mcp-client"
import { pluginServiceBrowserAuthorizationCompletionSchema } from "./plugin-service-browser-authorization"
import type { GenerationRecoveryMethod, GenerationRecoveryRequest } from "./generation-recovery-protocol"
import { ManagedPluginCompanionStore } from "./managed-plugin-companions"
import { toolPluginAuthorizationIdentity } from "./tool-plugin-authorizations"
import { toolPluginCanvasMcpMethods } from "./tool-plugin-canvas-capabilities"

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
    id,
    name: options.name ?? "Image Tools",
    runtime: {
      args: ["serve", "--stdio"],
      command: options.command ?? "image-tool-cli",
      type: "mcp-stdio",
    },
    schema: webPluginManifestSchemaV2,
    version: options.version ?? "1.0.0",
  }
}

function staticPlugin(): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Static renderer",
    entry: "index.html",
    id: "static-viewer",
    name: "Static Viewer",
    schema: webPluginManifestSchema,
    version: "1.0.0",
  }
}

function declarativeGenerationPlugin(
  schema:
    | typeof webPluginManifestSchemaV3
    | typeof webPluginManifestSchemaV4
    | typeof webPluginManifestSchemaV5
    | typeof webPluginManifestSchemaV6
    | typeof webPluginManifestSchemaV7 = webPluginManifestSchemaV3,
): InstalledWebPluginSummary {
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
            ...(schema === webPluginManifestSchemaV7
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
      ...(schema === webPluginManifestSchemaV4
        ? { skills: [{ name: "declarative-workflow", path: "skills/declarative-workflow" }] }
        : {}),
    },
    description: "Explicit models and operations",
    id: "declarative-tools",
    name: "Declarative Tools",
    runtime: { command: "declarative-tools-cli", type: "mcp-stdio" },
    schema,
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
    id: "account-tools",
    name: "Account Tools",
    runtime: { command: "account-tool-cli", type: "mcp-stdio" },
    schema: webPluginManifestSchemaV2,
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
    id: "xiaoyunque-generation",
    name: "XiaoYunque",
    runtime: { command: "convax-xiaoyunque-mcp", type: "mcp-stdio" },
    schema: webPluginManifestSchemaV5,
    version: "0.4.0",
  }
}

class FakePluginSource implements GenerationPluginSource {
  installed: InstalledWebPluginSummary[] = []
  readonly resolutions: Array<[string, string]> = []

  async list() {
    return this.installed
  }

  async resolveAsset(pluginId: string, relativePath: string) {
    this.resolutions.push([pluginId, relativePath])
    return path.resolve("/installed", pluginId, relativePath)
  }
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
  readonly forcedCloses: boolean[] = []
  tools: McpToolDefinition[] = [{ inputSchema: { type: "object" }, name: "generate.image" }]
  result: McpToolCallResult = { content: [{ text: "done", type: "text" }] }
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
  verifyAuthorization: GenerationPluginRuntimeOptions["verifyAuthorization"] = async () => undefined,
  resolveExecutable: (command: string) => Promise<GenerationPluginExecutableBinding> = async (command) => ({
    path: path.resolve("/resolved-tools", command),
    sha256: "a".repeat(64),
    size: 4_096,
  }),
  runtimeOptions: Pick<
    GenerationPluginRuntimeOptions,
    | "bunRuntime"
    | "canvasCapabilities"
    | "materializeExecutable"
    | "platform"
    | "recoveryRuntimeDirectory"
    | "recoveryStateDirectory"
    | "resolveManagedExecutable"
  > = {},
) {
  const plugins = new FakePluginSource()
  plugins.installed = installed
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
    materializeExecutable: async (binding) => ({
      dispose() {},
      path: binding.path,
    }),
    plugins,
    resolveExecutable,
    verifyAuthorization,
    ...runtimeOptions,
  })
  runtimes.add(runtime)
  return { clients, options, plugins, runtime }
}

describe("GenerationPluginRuntime", () => {
  test("connects declared v5 LLM providers through a validated Main-only gateway descriptor", async () => {
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
    const dynamic = llmPlugin()
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

  test("discovers only v2 generation contributions without starting their commands", async () => {
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
        modelName: "Generate",
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
        modelName: "Generate",
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

  test("derives v3 model and operation metadata without inferring from Plugin identity", async () => {
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

  test("admits a v7 LRO only after the runtime handshake and binds fixed control calls", async () => {
    const { clients, runtime } = setup([declarativeGenerationPlugin(webPluginManifestSchemaV7)])
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

  test("recovers through pinned authorized bytes after the Plugin is removed and its source changes", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-pinned-recovery-runtime-test-"))
    const executable = path.join(directory, "sidecar")
    const original = Buffer.from("#!/bin/sh\nexit 0\n")
    try {
      await fs.writeFile(executable, original, { mode: 0o700 })
      const setupResult = setup(
        [declarativeGenerationPlugin(webPluginManifestSchemaV7)],
        ["generate.image"],
        async () => undefined,
        async () => ({
          path: executable,
          sha256: createHash("sha256").update(original).digest("hex"),
          size: original.byteLength,
        }),
        {
          materializeExecutable: materializeGenerationPluginExecutable,
          recoveryRuntimeDirectory: path.join(directory, "runtime-v1"),
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
      await fs.writeFile(executable, "#!/bin/sh\nexit 9\n", { mode: 0o700 })

      const pinned = await setupResult.runtime.prepareRecoveryTool(binding)
      expect(pinned.tool).toEqual(summary)
      expect(
        await pinned.execution.recovery!.get({
          operationId: "operation-one",
          requestDigest: "a".repeat(64),
        }),
      ).toMatchObject({ status: "running", taskId: "task_123" })
      expect(setupResult.clients).toHaveLength(2)
      expect(setupResult.options[1]!.command).not.toBe(executable)
      expect(setupResult.options[1]!.command).toContain(path.join("runtime-v1", binding.executionBindingDigest))
      setupResult.runtime.dispose()
      runtimes.delete(setupResult.runtime)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("preserves declarative generation, operation, and service behavior for v4 Plugins with owned Skills", async () => {
    const v3 = setup([declarativeGenerationPlugin()])
    const v4Plugin = declarativeGenerationPlugin(webPluginManifestSchemaV4)
    const v4 = setup([v4Plugin], ["generate.image", "transform.video", "service.status"])

    expect(v4Plugin.contributes.skills).toEqual([{ name: "declarative-workflow", path: "skills/declarative-workflow" }])
    expect(await v4.runtime.listTools()).toEqual(await v3.runtime.listTools())
    expect(await v4.runtime.listServices()).toEqual(await v3.runtime.listServices())
    expect(v4.clients).toHaveLength(0)

    await v4.runtime.callTool("declarative-tools/transform.video", { operation: "trim" })
    expect(v4.clients[0].calls).toEqual([
      {
        input: { operation: "trim" },
        name: "transform.video",
        requestTimeoutMs: false,
        signal: undefined,
      },
    ])
  })

  test("preserves declarative generation and operation behavior for v6 Plugins", async () => {
    const v3 = setup([declarativeGenerationPlugin()])
    const v6 = setup([declarativeGenerationPlugin(webPluginManifestSchemaV6)])

    expect(await v6.runtime.listTools()).toEqual(await v3.runtime.listTools())
    expect(await v6.runtime.listServices()).toEqual(await v3.runtime.listServices())
  })

  test("projects a v6 direct-incoming operation binding into the stable tool summary", async () => {
    const installed = declarativeGenerationPlugin(webPluginManifestSchemaV6)
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

  test("injects the fixed reverse Canvas handler only for an all-bound v5 Tool principal", async () => {
    const installed = {
      ...declarativeGenerationPlugin(webPluginManifestSchemaV5),
      capabilities: ["projects.read", "canvas.document.read"] as InstalledWebPluginSummary["capabilities"],
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
      broker: {
        async connect() {
          return capabilityClient
        },
      },
      principals: {
        async issue(_pluginId, _runtime, expected) {
          if (expected) expectedPrincipals.push(expected)
          return {
            manifestDigest: "a".repeat(64),
            pluginId: installed.id,
            pluginVersion: installed.version,
            runtime: "tool",
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
      toolPluginCanvasMcpMethods.listProjects,
      toolPluginCanvasMcpMethods.getDocument,
      toolPluginCanvasMcpMethods.queryNodes,
    ])
    await expect(
      options[0]!.serverRequestHandler!.handle(
        { method: toolPluginCanvasMcpMethods.listProjects },
        { sendNotification() {}, signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ projects: [{ available: true, id: "project-one", name: "One" }] })

    const noProjectScope = {
      ...installed,
      capabilities: ["canvas.document.read"] as InstalledWebPluginSummary["capabilities"],
    }
    const withoutScope = setup([noProjectScope], ["generate.image"], async () => undefined, undefined, {
      canvasCapabilities,
    })
    await withoutScope.runtime.callTool("declarative-tools/generate.image", {})
    expect(withoutScope.options[0]?.serverRequestHandler).toBeUndefined()
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
    let verifications = 0
    const installedService = servicePlugin()
    const executable = {
      path: path.resolve("/resolved-tools", "account-tool-cli"),
      sha256: "a".repeat(64),
      size: 4_096,
    }
    const { clients, runtime } = setup(
      [staticPlugin(), installedService],
      ["service.status", "service.sign_out"],
      async () => {
        verifications += 1
      },
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
    await runtime.callService("account-tools", "sign_out")
    expect(firstStatus.authorizationIdentity).toBe(
      toolPluginAuthorizationIdentity(installedService, "path", executable),
    )
    expect(secondStatus.authorizationIdentity).toBe(firstStatus.authorizationIdentity)
    expect(verifications).toBe(1)
    expect(clients).toHaveLength(1)
    expect(clients[0].calls.map(({ input, name, requestTimeoutMs }) => ({ input, name, requestTimeoutMs }))).toEqual([
      { input: {}, name: "service.status", requestTimeoutMs: undefined },
      { input: {}, name: "service.status", requestTimeoutMs: undefined },
      { input: {}, name: "service.sign_out", requestTimeoutMs: undefined },
    ])
  })

  test("derives service capabilities and model labels from the same generation manifest", async () => {
    const combined = generationPlugin({
      id: "creative-service",
      name: "Creative Service",
      output: "video",
      toolId: "video.generate",
    })
    combined.contributes.service = { actions: ["authorize"] }
    combined.contributes.generation!.tools.unshift({
      acceptedInputs: ["text", "reference_image"],
      description: "Generate image",
      id: "image.generate",
      output: "image",
      title: "Image Model",
    })
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
    const combined = llmPlugin()
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

  test("lazily starts a manifest-scoped MCP command with a narrow environment", async () => {
    let verifications = 0
    const { clients, options, plugins, runtime } = setup([generationPlugin()], ["generate.image"], async () => {
      verifications += 1
    })
    const controller = new AbortController()

    expect(await runtime.callTool("image-tools/generate.image", { prompt: "a fox" }, controller.signal)).toEqual({
      content: [{ text: "done", type: "text" }],
    })

    expect(plugins.resolutions).toEqual([["image-tools", "manifest.json"]])
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      args: ["serve", "--stdio"],
      command: path.resolve("/resolved-tools/image-tool-cli"),
      env: {
        HOME: "/Users/tester",
        LANG: "zh_CN.UTF-8",
        PATH: "/usr/local/bin:/usr/bin",
      },
    })
    expect(path.dirname(options[0]!.cwd)).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(options[0]!.cwd)).toStartWith("convax-generation-runtime-")
    expect(options[0]!.cwd).not.toContain("/installed/image-tools")
    expect(options[0].env).not.toHaveProperty("SECRET_API_KEY")
    expect(clients[0].listSignals).toEqual([controller.signal])
    expect(clients[0].calls).toEqual([
      {
        input: { prompt: "a fox" },
        name: "generate.image",
        requestTimeoutMs: false,
        signal: controller.signal,
      },
    ])

    await runtime.callTool("image-tools/generate.image", { prompt: "a cat" })
    expect(verifications).toBe(1)
    expect(clients).toHaveLength(1)
    expect(clients[0].listSignals).toEqual([controller.signal, undefined])
    expect(clients[0].calls).toHaveLength(2)
  })

  test("injects one private binding-scoped recovery journal directory without exposing its identity", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-recovery-state-test-"))
    const root = path.join(parent, "operation-v1")
    try {
      const { options, runtime } = setup(
        [declarativeGenerationPlugin(webPluginManifestSchemaV7)],
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
        [declarativeGenerationPlugin(webPluginManifestSchemaV7)],
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

  test("prefers the Plugin/version-scoped managed companion over the explicit PATH fallback", async () => {
    const managedCalls: Array<[string, string, string]> = []
    let pathCalls = 0
    const verifications: Parameters<GenerationPluginRuntimeOptions["verifyAuthorization"]>[0][] = []
    const setupResult = setup(
      [generationPlugin({ version: "2.0.0" })],
      ["generate.image"],
      async (input) => {
        verifications.push(input)
      },
      async () => {
        pathCalls += 1
        return { path: "/path/fallback", sha256: "f".repeat(64), size: 10 }
      },
      {
        resolveManagedExecutable: async (pluginId, pluginVersion, command) => {
          managedCalls.push([pluginId, pluginVersion, command])
          return { path: "/managed/image-tool-cli", sha256: "b".repeat(64), size: 20 }
        },
      },
    )

    await setupResult.runtime.callTool("image-tools/generate.image", {})

    expect(managedCalls).toEqual([
      ["image-tools", "2.0.0", "image-tool-cli"],
      ["image-tools", "2.0.0", "image-tool-cli"],
    ])
    expect(pathCalls).toBe(0)
    expect(verifications[0]).toMatchObject({
      binding: {
        path: "/managed/image-tool-cli",
        sha256: "b".repeat(64),
      },
      bindingKind: "managed",
    })
    expect(setupResult.options[0]!.command).toBe("/managed/image-tool-cli")
  })

  test("runs an interpreted managed companion through the app-owned Bun runtime", async () => {
    const setupResult = setup(
      [generationPlugin({ version: "2.0.0" })],
      ["generate.image"],
      async () => undefined,
      undefined,
      {
        bunRuntime: { command: "/app/resources/opencode/bin/opencode", env: { BUN_BE_BUN: "1" } },
        materializeExecutable: async (binding) => ({
          dispose() {},
          path: "/private/snapshot/entrypoint",
          runtime: binding.runtime,
        }),
        resolveManagedExecutable: async () => ({
          path: "/managed/image-tool-cli",
          runtime: "bun",
          sha256: "b".repeat(64),
          size: 20,
        }),
      },
    )

    await setupResult.runtime.callTool("image-tools/generate.image", {})

    expect(setupResult.options[0]!.command).toBe("/app/resources/opencode/bin/opencode")
    expect(setupResult.options[0]!.args).toEqual(["/private/snapshot/entrypoint", "serve", "--stdio"])
    expect(setupResult.options[0]!.env).toMatchObject({ BUN_BE_BUN: "1" })
  })

  test("fails closed when an interpreted companion has no app-owned Bun runtime", async () => {
    const { runtime } = setup([generationPlugin()], ["generate.image"], async () => undefined, undefined, {
      materializeExecutable: async (binding) => ({ dispose() {}, path: binding.path, runtime: binding.runtime }),
      resolveManagedExecutable: async () => ({
        path: "/managed/image-tool-cli",
        runtime: "bun",
        sha256: "b".repeat(64),
        size: 20,
      }),
    })

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("Bun runtime is unavailable")
  })

  test("retains the explicit PATH integration when no managed companion is installed", async () => {
    let managedCalls = 0
    let pathCalls = 0
    const { runtime } = setup(
      [generationPlugin()],
      ["generate.image"],
      async () => undefined,
      async (command) => {
        pathCalls += 1
        return { path: `/path/${command}`, sha256: "a".repeat(64), size: 10 }
      },
      {
        resolveManagedExecutable: async () => {
          managedCalls += 1
          return null
        },
      },
    )

    await runtime.callTool("image-tools/generate.image", {})
    expect(managedCalls).toBe(2)
    expect(pathCalls).toBe(2)
  })

  test("fails closed when a managed companion digest changes after installation verification", async () => {
    let resolutions = 0
    let pathCalls = 0
    const { clients, runtime } = setup(
      [generationPlugin()],
      ["generate.image"],
      async () => undefined,
      async () => {
        pathCalls += 1
        return { path: "/path/fallback", sha256: "f".repeat(64), size: 10 }
      },
      {
        resolveManagedExecutable: async () => ({
          path: "/managed/image-tool-cli",
          sha256: (resolutions++ === 0 ? "a" : "b").repeat(64),
          size: 20,
        }),
      },
    )

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("changed after installation")
    expect(pathCalls).toBe(0)
    expect(clients).toHaveLength(0)
  })

  test("does not cache a failed installation authorization verification", async () => {
    let verifications = 0
    const { clients, runtime } = setup([generationPlugin()], ["generate.image"], async () => {
      verifications += 1
      if (verifications === 1) throw new Error("reinstall Plugin: image-tools")
    })

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("reinstall Plugin")
    expect(clients).toHaveLength(0)
    await runtime.callTool("image-tools/generate.image", {})
    expect(verifications).toBe(2)
    expect(clients).toHaveLength(1)
  })

  test("re-verifies the resolved executable bytes whenever a failed runtime is restarted", async () => {
    let digest = "a".repeat(64)
    const verifications: Parameters<GenerationPluginRuntimeOptions["verifyAuthorization"]>[0][] = []
    const { clients, runtime } = setup(
      [generationPlugin()],
      ["some-other-tool"],
      async (input) => {
        verifications.push(input)
      },
      async () => ({ path: "/resolved/image-tool-cli", sha256: digest, size: 4_096 }),
    )

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("did not expose")
    digest = "b".repeat(64)
    clients.at(-1)!.tools = [{ inputSchema: { type: "object" }, name: "some-other-tool" }]
    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("did not expose")

    expect(verifications.map(({ binding, bindingKind }) => ({ binding, bindingKind }))).toEqual([
      {
        binding: { path: "/resolved/image-tool-cli", sha256: "a".repeat(64), size: 4_096 },
        bindingKind: "path",
      },
      {
        binding: { path: "/resolved/image-tool-cli", sha256: "b".repeat(64), size: 4_096 },
        bindingKind: "path",
      },
    ])
  })

  test("fails closed when the executable changes between verification and spawn", async () => {
    let resolutions = 0
    const { clients, runtime } = setup(
      [generationPlugin()],
      ["generate.image"],
      async () => undefined,
      async () => ({
        path: "/resolved/image-tool-cli",
        sha256: (resolutions++ === 0 ? "a" : "b").repeat(64),
        size: 4_096,
      }),
    )

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("changed after installation")
    expect(clients).toHaveLength(0)
  })

  test("re-verifies installation authorization after a Plugin update", async () => {
    const versions: string[] = []
    const setupResult = setup([generationPlugin()], ["generate.image"], async ({ plugin }) => {
      versions.push(plugin.version)
    })

    await setupResult.runtime.callTool("image-tools/generate.image", {})
    setupResult.plugins.installed = [generationPlugin({ version: "2.0.0" })]
    await setupResult.runtime.listTools()
    await setupResult.runtime.callTool("image-tools/generate.image", {})
    expect(versions).toEqual(["1.0.0", "2.0.0"])
    expect(setupResult.clients).toHaveLength(2)
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

    await expect(
      prepared.call({ prompt: "must remain unbilled" }, undefined, async (event) => {
        if (event.type === "external-started") {
          plugins.installed = [generationPlugin({ output: "video", version: "2.0.0" })]
        }
      }),
    ).rejects.toThrow("changed before the external call")
    expect(clients[0].calls).toHaveLength(0)
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
    let verifications = 0
    const { clients, runtime } = setup(
      [generationPlugin()],
      ["generate.image"],
      async () => {
        verifications += 1
      },
      undefined,
      { platform: "win32" },
    )

    await expect(runtime.callTool("image-tools/generate.image", {})).rejects.toThrow("Job Object")
    expect(verifications).toBe(0)
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

  test("resolves and fingerprints only an executable in an absolute PATH entry", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-executable-test-"))
    const executable = path.join(directory, "image-tool-cli")
    try {
      await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
      const binding = await resolveGenerationPluginExecutable("image-tool-cli", {
        PATH: `relative-tools${path.delimiter}${directory}`,
      })
      expect(binding).toMatchObject({ path: await fs.realpath(executable), size: 17 })
      expect(binding.sha256).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("launches from a verified private temporary snapshot instead of the install-authorized pathname", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-snapshot-test-"))
    const executable = path.join(directory, "image-tool-cli")
    let snapshotPath = ""
    let snapshotDirectory = ""
    try {
      const original = "#!/bin/sh\nexit 0\n"
      await fs.writeFile(executable, original, { mode: 0o700 })
      const binding = await resolveGenerationPluginExecutable("image-tool-cli", { PATH: directory })
      const snapshot = await materializeGenerationPluginExecutable(binding)
      snapshotPath = snapshot.path
      snapshotDirectory = path.dirname(snapshot.path)
      expect(snapshot.path).not.toBe(executable)
      expect(snapshotDirectory).not.toBe(path.dirname(binding.path))
      expect((await fs.stat(snapshotDirectory)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(snapshot.path)).mode & 0o777).toBe(0o500)
      expect(await fs.readFile(snapshot.path, "utf8")).toBe(original)

      await fs.rename(executable, `${executable}.old`)
      await fs.writeFile(executable, "#!/bin/sh\nexit 9\n", { mode: 0o700 })
      expect(await fs.readFile(snapshot.path, "utf8")).toBe(original)
      snapshot.dispose()
      await expect(fs.stat(snapshot.path)).rejects.toThrow()
      await expect(fs.stat(snapshotDirectory)).rejects.toThrow()
      snapshotPath = ""
      snapshotDirectory = ""
    } finally {
      if (snapshotDirectory) await fs.rm(snapshotDirectory, { force: true, recursive: true })
      else if (snapshotPath) await fs.rm(snapshotPath, { force: true })
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("keeps managed companion resolution valid while concurrent launch snapshots are active", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-managed-snapshot-test-"))
    const store = new ManagedPluginCompanionStore(path.join(directory, "plugin-companions"), {
      arch: process.arch,
      platform: process.platform,
    })
    const bytes = new TextEncoder().encode("#!/bin/sh\nexit 0\n")
    let snapshots: GenerationPluginExecutableSnapshot[] = []
    try {
      const transaction = await store.install({
        arch: process.arch,
        bytes,
        command: "image-tool-cli",
        platform: process.platform,
        pluginId: "image-tools",
        pluginVersion: "1.0.0",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        version: "1.0.0",
      })
      await transaction.commit()
      const binding = await store.resolve("image-tools", "1.0.0", "image-tool-cli")
      expect(binding).not.toBeNull()

      snapshots = await Promise.all([
        materializeGenerationPluginExecutable(binding!),
        materializeGenerationPluginExecutable(binding!),
      ])
      expect(snapshots[0]!.path).not.toBe(snapshots[1]!.path)
      expect(path.dirname(snapshots[0]!.path)).not.toBe(path.dirname(binding!.path))
      expect(path.dirname(snapshots[1]!.path)).not.toBe(path.dirname(binding!.path))
      expect(await store.resolve("image-tools", "1.0.0", "image-tool-cli")).toEqual(binding)

      const firstDirectory = path.dirname(snapshots[0]!.path)
      snapshots[0]!.dispose()
      await expect(fs.stat(firstDirectory)).rejects.toThrow()
      expect(await fs.readFile(snapshots[1]!.path, "utf8")).toBe("#!/bin/sh\nexit 0\n")
      expect(await store.resolve("image-tools", "1.0.0", "image-tool-cli")).toEqual(binding)

      const secondDirectory = path.dirname(snapshots[1]!.path)
      snapshots[1]!.dispose()
      await expect(fs.stat(secondDirectory)).rejects.toThrow()
      snapshots = []
    } finally {
      for (const snapshot of snapshots) snapshot.dispose()
      await fs.rm(directory, { force: true, recursive: true })
    }
  })
})
