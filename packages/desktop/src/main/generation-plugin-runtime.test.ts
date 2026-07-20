import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  webPluginManifestSchema,
  webPluginManifestSchemaV2,
  type InstalledWebPluginSummary,
  type WebPluginGenerationModality,
} from "../plugin-contracts"
import {
  GenerationPluginRuntime,
  generationPluginEnvironment,
  generationPluginToolHostId,
  materializeGenerationPluginExecutable,
  resolveGenerationPluginExecutable,
  type GenerationPluginExecutableBinding,
  type GenerationPluginMcpClient,
  type GenerationPluginRuntimeOptions,
  type GenerationPluginSource,
} from "./generation-plugin-runtime"
import type { McpToolCallResult, McpToolDefinition, StdioMcpClientOptions } from "./stdio-mcp-client"

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

  async callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onRequestStart?: () => void,
    requestTimeoutMs?: number | false,
  ): Promise<McpToolCallResult> {
    onRequestStart?.()
    this.calls.push({ input, name, requestTimeoutMs, signal })
    return { content: [{ text: "done", type: "text" }] }
  }

  close(force = false) {
    this.closed += 1
    this.forcedCloses.push(force)
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
  runtimeOptions: Pick<GenerationPluginRuntimeOptions, "materializeExecutable" | "platform"> = {},
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

  test("launches from a verified sibling snapshot instead of the install-authorized pathname", async () => {
    if (process.platform === "win32") return
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-snapshot-test-"))
    const executable = path.join(directory, "image-tool-cli")
    let snapshotPath = ""
    try {
      const original = "#!/bin/sh\nexit 0\n"
      await fs.writeFile(executable, original, { mode: 0o700 })
      const binding = await resolveGenerationPluginExecutable("image-tool-cli", { PATH: directory })
      const snapshot = await materializeGenerationPluginExecutable(binding)
      snapshotPath = snapshot.path
      expect(snapshot.path).not.toBe(executable)
      expect(path.dirname(snapshot.path)).toBe(path.dirname(binding.path))
      expect(await fs.readFile(snapshot.path, "utf8")).toBe(original)

      await fs.rename(executable, `${executable}.old`)
      await fs.writeFile(executable, "#!/bin/sh\nexit 9\n", { mode: 0o700 })
      expect(await fs.readFile(snapshot.path, "utf8")).toBe(original)
      snapshot.dispose()
      await expect(fs.stat(snapshot.path)).rejects.toThrow()
      snapshotPath = ""
    } finally {
      if (snapshotPath) await fs.rm(snapshotPath, { force: true })
      await fs.rm(directory, { force: true, recursive: true })
    }
  })
})
