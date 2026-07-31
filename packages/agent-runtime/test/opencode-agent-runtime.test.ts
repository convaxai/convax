import { describe, expect, mock, test } from "bun:test"
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  OpenCodeAgentRuntime,
  isAgentSessionInDirectory,
  prepareAgentResourceParts,
  withAgentHookModules,
  withAgentSkillPaths,
  withProtectedPathGuard,
  withProtectedPathPermissions,
} from "../src/node/opencode-agent-runtime"
import { ensureOpenCodeBinaryOnPath } from "../src/node/opencode-binary-path"
import protectedPathPlugin from "../src/node/protected-path-plugin"

async function writeSkill(directory: string, name: string, description = `${name} description`) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${description}`, "---", "", `Use the ${name} workflow.`].join("\n"),
  )
}

function restoreTestEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function writeOpenCodeStub(binaryDirectory: string) {
  const executable = join(binaryDirectory, process.platform === "win32" ? "opencode.exe" : "opencode")
  await writeFile(executable, "")
  if (process.platform !== "win32") await chmod(executable, 0o755)
}

function completedAssistantMessage(sessionId: string) {
  const now = Date.now()
  return {
    data: {
      info: {
        id: "assistant-message",
        role: "assistant" as const,
        sessionID: sessionId,
        time: { completed: now, created: now },
      },
      parts: [],
    },
  }
}

describe("OpenCode agent runtime boundaries", () => {
  test("uses only the canonical host-provided OpenCode binary directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-binary-directory-"))
    const binaryDirectory = join(root, "bin")
    const binaryDirectoryLink = join(root, "bin-link")
    const previousPath = process.env.PATH
    try {
      await mkdir(binaryDirectory)
      await writeOpenCodeStub(binaryDirectory)
      await symlink(binaryDirectory, binaryDirectoryLink, "dir")
      const existing = join(root, "host-bin")
      const trailing = join(root, "trailing-bin")
      const canonical = await realpath(binaryDirectory)
      process.env.PATH = [existing, canonical, trailing].join(delimiter)

      const directories = await ensureOpenCodeBinaryOnPath(binaryDirectoryLink)

      expect(directories).toEqual([canonical])
      expect(process.env.PATH?.split(delimiter)).toEqual([canonical, existing, trailing])
    } finally {
      restoreTestEnvironment("PATH", previousPath)
      await rm(root, { force: true, recursive: true })
    }
  })

  test("rejects a missing or non-directory explicit OpenCode binary directory without changing PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-invalid-binary-directory-"))
    const file = join(root, "not-a-directory")
    const emptyDirectory = join(root, "empty-directory")
    const previousPath = process.env.PATH
    try {
      await writeFile(file, "not a directory")
      await mkdir(emptyDirectory)
      process.env.PATH = "/host/existing/bin"

      await expect(ensureOpenCodeBinaryOnPath(join(root, "missing"))).rejects.toThrow("does not exist")
      await expect(ensureOpenCodeBinaryOnPath(file)).rejects.toThrow("is not a directory")
      await expect(ensureOpenCodeBinaryOnPath(emptyDirectory)).rejects.toThrow("executable was not found")
      expect(process.env.PATH).toBe("/host/existing/bin")
    } finally {
      restoreTestEnvironment("PATH", previousPath)
      await rm(root, { force: true, recursive: true })
    }
  })

  test("fails the runtime closed when its explicit OpenCode binary directory disappears", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-removed-binary-directory-"))
    const binaryDirectory = join(root, "bin")
    await mkdir(binaryDirectory)
    const runtime = new OpenCodeAgentRuntime({ binaryDirectory })
    await rm(binaryDirectory, { recursive: true })

    try {
      await expect(runtime.listSessions({ directory: root })).rejects.toThrow("does not exist")
      expect(await runtime.getStatus()).toMatchObject({
        state: "error",
        error: expect.stringContaining("does not exist"),
      })
    } finally {
      await runtime.dispose()
      await rm(root, { force: true, recursive: true })
    }
  })

  test("rejects empty or PATH-injecting OpenCode binary directories", async () => {
    expect(() => new OpenCodeAgentRuntime({ binaryDirectory: "  " })).toThrow("binary directory is required")
    expect(() => new OpenCodeAgentRuntime({ binaryDirectory: `/safe${delimiter}/injected` })).toThrow("PATH delimiter")
  })

  test("keeps session history scoped to the opened directory", () => {
    expect(isAgentSessionInDirectory("/workspace/a", "/workspace/a")).toBe(true)
    expect(isAgentSessionInDirectory("/workspace/other", "/workspace/a")).toBe(false)
  })

  test("merges caller-supplied protected paths without mutating config", () => {
    const config = {
      model: "provider/model",
      permission: {
        bash: "ask" as const,
        edit: "allow" as const,
        read: { "*": "ask" as const, ".host/**": "allow" as const },
      },
    }

    const merged = withProtectedPathPermissions(config, [".host", ".host/**", " .host/** "])

    expect(merged).not.toBe(config)
    expect(merged.model).toBe("provider/model")
    expect(config.permission.read[".host/**"]).toBe("allow")
    expect(merged.permission).toMatchObject({ bash: "ask" })
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission.read).toMatchObject({ "*": "ask", ".host": "deny", ".host/**": "deny" })
    expect(merged.permission.edit).toMatchObject({ "*": "allow", ".host": "deny", ".host/**": "deny" })
  })

  test("preserves a global permission fallback for protected paths", () => {
    const merged = withProtectedPathPermissions({ permission: "ask" }, [".runtime/**"])
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission["*"]).toBe("ask")
    expect(merged.permission.read).toMatchObject({ "*": "ask", ".runtime/**": "deny" })
    expect(merged.permission.edit).toMatchObject({ "*": "ask", ".runtime/**": "deny" })
  })

  test("does not add an implicit protected path", () => {
    const permission = { read: { ".private/**": "allow" as const } }
    const merged = withProtectedPathPermissions({ permission }, [])
    expect(merged.permission).toBe(permission)
  })

  test("disables remote skill indexes without replacing explicit paths", async () => {
    const config = {
      skills: {
        paths: ["/managed/skills"],
        urls: ["https://example.com/skills"],
      },
    }
    const runtime = new OpenCodeAgentRuntime({ config })
    const bounded = (
      runtime as unknown as {
        options: { config: typeof config }
      }
    ).options.config

    expect(bounded.skills?.paths).toEqual(["/managed/skills"])
    expect(bounded.skills?.urls).toEqual([])
    expect(config.skills.urls).toEqual(["https://example.com/skills"])
    const runtimeWithoutPaths = new OpenCodeAgentRuntime()
    const boundedWithoutPaths = (
      runtimeWithoutPaths as unknown as {
        options: { config: { skills?: { paths?: string[]; urls?: string[] } } }
      }
    ).options.config
    expect("paths" in boundedWithoutPaths.skills!).toBe(false)
    await Promise.all([runtime.dispose(), runtimeWithoutPaths.dispose()])
  })

  test("projects the OpenCode provider catalog without exposing provider configuration", async () => {
    const directory = join(tmpdir(), "agent-runtime-model-catalog")
    const list = mock(async () => ({
      data: {
        all: [
          {
            env: ["CONNECTED_PROVIDER_TOKEN"],
            id: "connected-provider",
            key: "must-not-cross-the-runtime-boundary",
            models: {
              primary: {
                id: "primary-model",
                name: "Primary model",
                options: { credential: "must-not-cross-the-runtime-boundary" },
                providerID: "connected-provider",
              },
              secondary: {
                id: "secondary-model",
                name: "Secondary model",
                providerID: "connected-provider",
              },
            },
            name: "Connected provider",
            options: { apiKey: "must-not-cross-the-runtime-boundary" },
            source: "env",
          },
          {
            env: [],
            id: "available-provider",
            models: {
              available: {
                id: "available-model",
                name: "Available model",
                providerID: "available-provider",
              },
            },
            name: "Available provider",
            options: {},
            source: "api",
          },
        ],
        connected: ["connected-provider"],
        default: { "connected-provider": "primary-model" },
      },
    }))
    const runtime = new OpenCodeAgentRuntime()
    ;(runtime as unknown as { client: unknown }).client = { provider: { list } }

    try {
      const catalog = await runtime.listModels({ directory })

      expect(list).toHaveBeenCalledWith({ directory })
      expect(catalog).toEqual({
        providers: [
          {
            connected: true,
            defaultModelId: "primary-model",
            models: [
              { default: true, modelId: "primary-model", modelName: "Primary model" },
              { default: false, modelId: "secondary-model", modelName: "Secondary model" },
            ],
            providerId: "connected-provider",
            providerName: "Connected provider",
          },
          {
            connected: false,
            defaultModelId: undefined,
            models: [{ default: false, modelId: "available-model", modelName: "Available model" }],
            providerId: "available-provider",
            providerName: "Available provider",
          },
        ],
      })
      expect(JSON.stringify(catalog)).not.toContain("must-not-cross-the-runtime-boundary")
      expect(catalog.providers[0]).not.toHaveProperty("env")
      expect(catalog.providers[0]).not.toHaveProperty("key")
      expect(catalog.providers[0]).not.toHaveProperty("options")
    } finally {
      await runtime.dispose()
    }
  })

  test("resolves host-owned provider configuration only when creating a server configuration", async () => {
    let apiKey = "first-secret"
    const resolveProviders = mock(async () => ({
      "plugin-example-provider": {
        models: { main: { name: "Main" } },
        name: "Example",
        npm: "@ai-sdk/openai-compatible",
        options: { apiKey, baseURL: "http://127.0.0.1:43123/v1" },
      },
    }))
    const runtime = new OpenCodeAgentRuntime({
      config: { model: "builtin/default" },
      resolveProviders,
    })
    const serverConfig = () =>
      (
        runtime as unknown as {
          serverConfig(): Promise<Record<string, unknown>>
        }
      ).serverConfig()
    try {
      const first = await serverConfig()
      expect(first.model).toBe("builtin/default")
      expect(first.provider).toMatchObject({
        "plugin-example-provider": { options: { apiKey: "first-secret" } },
      })
      apiKey = "rotated-secret"
      const second = await serverConfig()
      expect(second.provider).toMatchObject({
        "plugin-example-provider": { options: { apiKey: "rotated-secret" } },
      })
      expect(resolveProviders).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.dispose()
    }
  })

  test("lazily merges normalized immutable Skill paths without mutating provider snapshots", async () => {
    const configured = join(tmpdir(), "host", "configured-skills")
    const resolved = join(tmpdir(), "host", "plugin-skills")
    const mutablePaths = [join(resolved, "..", "plugin-skills"), resolved]
    const resolvePluginConfiguration = mock(async () => ({ skillPaths: mutablePaths }))
    const runtime = new OpenCodeAgentRuntime({
      config: { skills: { paths: [configured] } },
      resolvePluginConfiguration,
    })
    const serverConfig = () =>
      (
        runtime as unknown as {
          serverConfig(): Promise<{ skills?: { paths?: string[]; urls?: string[] } }>
        }
      ).serverConfig()

    try {
      expect(resolvePluginConfiguration).not.toHaveBeenCalled()
      const first = await serverConfig()
      expect(first.skills).toEqual({ paths: [configured, resolved], urls: [] })
      mutablePaths[0] = join(tmpdir(), "host", "changed-after-resolution")
      expect(first.skills?.paths).toEqual([configured, resolved])

      const second = await serverConfig()
      expect(second.skills?.paths).toEqual([configured, mutablePaths[0], resolved])
      expect(first.skills?.paths).toEqual([configured, resolved])
      expect(resolvePluginConfiguration).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.dispose()
    }
  })

  test("keeps empty Skill path providers inert and rejects invalid or failed providers", async () => {
    const empty = new OpenCodeAgentRuntime({ resolvePluginConfiguration: async () => ({ skillPaths: [] }) })
    const invalid = new OpenCodeAgentRuntime({
      resolvePluginConfiguration: async () => ({ skillPaths: ["relative/skill"] }),
    })
    const failed = new OpenCodeAgentRuntime({
      resolvePluginConfiguration: async () => {
        throw new Error("Skill path provider failed")
      },
    })
    const serverConfig = (runtime: OpenCodeAgentRuntime) =>
      (
        runtime as unknown as {
          serverConfig(): Promise<{ skills?: { paths?: string[]; urls?: string[] } }>
        }
      ).serverConfig()

    try {
      expect((await serverConfig(empty)).skills).toEqual({ urls: [] })
      await expect(serverConfig(invalid)).rejects.toThrow("non-empty absolute directory path")
      await expect(serverConfig(failed)).rejects.toThrow("Skill path provider failed")
    } finally {
      await Promise.all([empty.dispose(), invalid.dispose(), failed.dispose()])
    }
  })

  test("deduplicates configured and resolved absolute Skill paths without changing base config", () => {
    const root = join(tmpdir(), "host", "skills")
    const config = { skills: { paths: [root], urls: [] as string[] } }
    const merged = withAgentSkillPaths(config, [join(root, "."), `${root}/../skills`])

    expect(merged.skills).toEqual({ paths: [root], urls: [] })
    expect(config.skills.paths).toEqual([root])
  })

  test("resolves remote MCP, Hooks, and Skills once as one generic configuration generation", async () => {
    const skillPath = join(tmpdir(), "host", "skills", "remote")
    const hook = pathToFileURL(join(tmpdir(), "host", "hooks", "remote.mjs")).href
    const resolvedServer = {
      headers: { "x-surface": "convax" },
      networkBoundary: "host-validated-https" as const,
      oauth: false as const,
      timeout: 12_345,
      type: "remote" as const,
      url: "https://mcp.example.com/mcp",
    }
    const resolvePluginConfiguration = mock(async () => ({
      hookModules: [{ fileUrl: hook }],
      mcpServers: { plugin_remote: resolvedServer },
      skillPaths: [skillPath],
    }))
    const runtime = new OpenCodeAgentRuntime({ resolvePluginConfiguration })
    const serverConfig = () =>
      (
        runtime as unknown as {
          serverConfig(): Promise<{
            mcp?: Record<string, unknown>
            plugin?: Array<string | [string, unknown]>
            skills?: { paths?: string[] }
          }>
        }
      ).serverConfig()

    try {
      expect(resolvePluginConfiguration).not.toHaveBeenCalled()
      await runtime.refreshConfiguration()
      expect(resolvePluginConfiguration).not.toHaveBeenCalled()

      const config = await serverConfig()
      expect(resolvePluginConfiguration).toHaveBeenCalledTimes(1)
      expect(config.mcp).toEqual({
        plugin_remote: {
          headers: resolvedServer.headers,
          oauth: false,
          timeout: resolvedServer.timeout,
          type: "remote",
          url: resolvedServer.url,
        },
      })
      expect(config.plugin).toEqual([hook])
      expect(config.skills?.paths).toEqual([skillPath])
      expect(config.mcp?.plugin_remote).not.toBe(resolvedServer)
      expect(resolvedServer.networkBoundary).toBe("host-validated-https")
    } finally {
      await runtime.dispose()
    }
  })

  test.each([
    ["HTTP URL", { networkBoundary: "host-validated-https", type: "remote", url: "http://mcp.example.com/mcp" }],
    [
      "URL credentials",
      { networkBoundary: "host-validated-https", type: "remote", url: "https://user:pass@mcp.example.com/mcp" },
    ],
    [
      "sensitive header",
      {
        headers: { Authorization: "Bearer plugin-secret" },
        networkBoundary: "host-validated-https",
        type: "remote",
        url: "https://mcp.example.com/mcp",
      },
    ],
    [
      "OAuth credentials",
      {
        networkBoundary: "host-validated-https",
        oauth: { clientSecret: "plugin-secret" },
        type: "remote",
        url: "https://mcp.example.com/mcp",
      },
    ],
  ])("rejects a host-validated HTTPS MCP with %s", async (_case, server) => {
    const runtime = new OpenCodeAgentRuntime({
      resolvePluginConfiguration: async () => ({
        mcpServers: { remote: server as never },
      }),
    })
    try {
      await expect(
        (
          runtime as unknown as {
            serverConfig(): Promise<Record<string, unknown>>
          }
        ).serverConfig(),
      ).rejects.toThrow()
    } finally {
      await runtime.dispose()
    }
  })

  test("admits only an authenticated Main-owned loopback MCP bridge", async () => {
    const token = "a".repeat(32)
    const runtime = new OpenCodeAgentRuntime({
      resolvePluginConfiguration: async () => ({
        mcpServers: {
          managed: {
            headers: { Authorization: `Bearer ${token}` },
            networkBoundary: "host-authenticated-loopback",
            oauth: false,
            type: "remote",
            url: "http://127.0.0.1:43127/mcp",
          },
        },
      }),
    })
    try {
      const config = await (
        runtime as unknown as {
          serverConfig(): Promise<{ mcp?: Record<string, unknown> }>
        }
      ).serverConfig()
      expect(config.mcp?.managed).toEqual({
        headers: { Authorization: `Bearer ${token}` },
        oauth: false,
        type: "remote",
        url: "http://127.0.0.1:43127/mcp",
      })
    } finally {
      await runtime.dispose()
    }
  })

  test.each([
    ["hostname", "http://localhost:43127/mcp"],
    ["unspecified IPv4", "http://0.0.0.0:43127/mcp"],
    ["query", "http://127.0.0.1:43127/mcp?token=secret"],
    ["credentials", "http://user:pass@127.0.0.1:43127/mcp"],
  ])("rejects an unsafe managed MCP %s URL", async (_case, url) => {
    const runtime = new OpenCodeAgentRuntime({
      resolvePluginConfiguration: async () => ({
        mcpServers: {
          managed: {
            headers: { Authorization: `Bearer ${"a".repeat(32)}` },
            networkBoundary: "host-authenticated-loopback",
            oauth: false,
            type: "remote",
            url,
          },
        },
      }),
    })
    try {
      await expect(
        (
          runtime as unknown as {
            serverConfig(): Promise<Record<string, unknown>>
          }
        ).serverConfig(),
      ).rejects.toThrow("Managed MCP bridge must use an exact loopback URL")
    } finally {
      await runtime.dispose()
    }
  })

  test("rejects resolved MCP conflicts and every unmarked base MCP entry", async () => {
    const conflict = new OpenCodeAgentRuntime({
      config: {
        mcp: {
          shared: { oauth: false, type: "remote", url: "https://base.example/mcp" },
        },
      },
      resolvePluginConfiguration: async () => ({
        mcpServers: {
          shared: {
            networkBoundary: "host-validated-https",
            type: "remote",
            url: "https://resolved.example/mcp",
          },
        },
      }),
    })
    const local = new OpenCodeAgentRuntime({
      config: { mcp: { bypass: { command: ["/usr/bin/example"], type: "local" } } },
    })
    const unmarkedRemote = new OpenCodeAgentRuntime({
      config: { mcp: { bypass: { oauth: false, type: "remote", url: "https://mcp.example.com/mcp" } } },
    })
    const serverConfig = (runtime: OpenCodeAgentRuntime) =>
      (
        runtime as unknown as {
          serverConfig(): Promise<Record<string, unknown>>
        }
      ).serverConfig()
    try {
      await expect(serverConfig(conflict)).rejects.toThrow(
        "Resolved MCP server conflicts with base OpenCode config: shared",
      )
      await expect(serverConfig(local)).rejects.toThrow("Local MCP commands are not admitted into Agent Runtime")
      await expect(serverConfig(unmarkedRemote)).rejects.toThrow("missing a supported Host network boundary")
    } finally {
      await Promise.all([conflict.dispose(), local.dispose(), unmarkedRemote.dispose()])
    }
  })

  test("lazily appends immutable Hook modules before the strong path guard", async () => {
    const base = pathToFileURL(join(tmpdir(), "host", "base-plugin.mjs")).href
    const hook = pathToFileURL(join(tmpdir(), "host", "plugin-hooks", "example.mjs")).href
    const modules = [{ fileUrl: hook }]
    const resolvePluginConfiguration = mock(async () => ({ hookModules: modules }))
    const runtime = new OpenCodeAgentRuntime({
      config: { plugin: [base] },
      protectedPaths: [".convax"],
      resolvePluginConfiguration,
    })
    const serverConfig = () =>
      (
        runtime as unknown as {
          serverConfig(): Promise<{ plugin?: Array<string | [string, unknown]> }>
        }
      ).serverConfig()

    try {
      expect(resolvePluginConfiguration).not.toHaveBeenCalled()
      const config = await serverConfig()
      expect(resolvePluginConfiguration).toHaveBeenCalledTimes(1)
      expect(config.plugin?.[0]).toBe(base)
      expect(config.plugin?.[1]).toBe(hook)
      const guard = config.plugin?.at(-1)
      expect(Array.isArray(guard)).toBe(true)
      if (!Array.isArray(guard)) throw new Error("Expected protected path guard")
      expect(guard[0]).toContain("agent-runtime-protected-path-")
      expect(modules).toEqual([{ fileUrl: hook }])
    } finally {
      await runtime.dispose()
    }
  })

  test("accepts only unique absolute file URLs from the Hook resolver", () => {
    const fileUrl = pathToFileURL(join(tmpdir(), "host", "plugin-hooks", "example.mjs")).href
    const config = { plugin: ["base-plugin"] }
    const merged = withAgentHookModules(config, [{ fileUrl }])

    expect(config.plugin).toEqual(["base-plugin"])
    expect(merged.plugin).toEqual(["base-plugin", fileUrl])
    expect(() => withAgentHookModules({}, [{ fileUrl: "https://example.com/hook.mjs" }])).toThrow("absolute file URL")
    expect(() => withAgentHookModules({}, [{ fileUrl: `${fileUrl}?changed=1` }])).toThrow(
      "without credentials, query, or fragment",
    )
    expect(() => withAgentHookModules({}, [{ fileUrl }, { fileUrl }])).toThrow("duplicated")
    expect(() => withAgentHookModules({ plugin: [fileUrl] }, [{ fileUrl }])).toThrow("duplicated")
  })

  test("gracefully disposes loaded Hook instances before a hard configuration refresh", async () => {
    const dispose = mock(async () => ({ data: true }))
    const close = mock(() => undefined)
    const runtime = new OpenCodeAgentRuntime()
    const state = runtime as unknown as {
      client?: { global: { dispose(): Promise<unknown> } }
      lifecycle: { state: string }
      server?: { close(): void }
    }
    state.client = { global: { dispose } }
    state.server = { close }
    state.lifecycle = { state: "ready" }

    await runtime.refreshConfiguration()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(await runtime.getStatus()).toEqual({ state: "stopped" })
    await runtime.dispose()
  })

  test("fails a hard refresh closed when server close throws and lazily resolves fresh Plugin config", async () => {
    const directory = join(tmpdir(), "agent-runtime-failed-configuration-refresh")
    const oldHook = pathToFileURL(join(tmpdir(), "host", "plugin-hooks", "old.mjs")).href
    const newHook = pathToFileURL(join(tmpdir(), "host", "plugin-hooks", "new.mjs")).href
    const oldSkillPath = join(tmpdir(), "host", "plugin-skills", "old")
    const newSkillPath = join(tmpdir(), "host", "plugin-skills", "new")
    let pluginConfiguration = {
      hookModules: [{ fileUrl: oldHook }],
      skillPaths: [oldSkillPath],
    }
    const resolvePluginConfiguration = mock(async () => pluginConfiguration)
    const dispose = mock(async () => ({ data: true }))
    const oldSessionList = mock(async () => {
      throw new Error("The stale OpenCode client was reused")
    })
    const newSessionList = mock(async () => ({ data: [] }))
    const close = mock(() => {
      throw new Error("OpenCode server close failed")
    })
    const runtime = new OpenCodeAgentRuntime({ resolvePluginConfiguration })
    type ServerConfig = {
      plugin?: Array<string | [string, unknown]>
      skills?: { paths?: string[] }
    }
    type ClientStub = {
      global?: { dispose(): Promise<unknown> }
      session: {
        list(input: unknown): Promise<{ data: unknown[] }>
      }
    }
    const state = runtime as unknown as {
      client?: ClientStub
      getClient(): Promise<ClientStub>
      lifecycle: { state: string }
      server?: { close(): void }
      serverConfig(): Promise<ServerConfig>
      startup?: Promise<ClientStub>
    }
    const oldConfig = await state.serverConfig()
    const oldClient: ClientStub = {
      global: { dispose },
      session: { list: oldSessionList },
    }
    state.client = oldClient
    state.server = { close }
    state.startup = Promise.resolve(oldClient)
    state.lifecycle = { state: "ready" }
    const lazilyResolvedConfigs: ServerConfig[] = []
    state.getClient = async () => {
      if (state.client) return state.client
      const config = await state.serverConfig()
      lazilyResolvedConfigs.push(config)
      const client: ClientStub = {
        session: { list: newSessionList },
      }
      state.client = client
      return client
    }

    try {
      expect(oldConfig.plugin).toEqual([oldHook])
      expect(oldConfig.skills?.paths).toEqual([oldSkillPath])
      pluginConfiguration = {
        hookModules: [{ fileUrl: newHook }],
        skillPaths: [newSkillPath],
      }

      await expect(runtime.refreshConfiguration()).rejects.toThrow("OpenCode server close failed")

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
      expect(state.client).toBeUndefined()
      expect(state.server).toBeUndefined()
      expect(state.startup).toBeUndefined()
      expect(await runtime.getStatus()).toEqual({ state: "stopped" })

      await expect(runtime.listSessions({ directory })).resolves.toEqual([])

      expect(oldSessionList).not.toHaveBeenCalled()
      expect(newSessionList).toHaveBeenCalledTimes(1)
      expect(lazilyResolvedConfigs).toEqual([
        expect.objectContaining({
          plugin: [newHook],
          skills: { paths: [newSkillPath], urls: [] },
        }),
      ])
      expect(JSON.stringify(lazilyResolvedConfigs)).not.toContain(oldHook)
      expect(JSON.stringify(lazilyResolvedConfigs)).not.toContain(oldSkillPath)
      expect(resolvePluginConfiguration).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.dispose()
    }
  })

  test("absorbs refreshes queued during a hard refresh without starting another OpenCode generation", async () => {
    let releaseDispose!: () => void
    let markDisposeStarted!: () => void
    const disposeRelease = new Promise<void>((resolve) => {
      releaseDispose = resolve
    })
    const disposeStarted = new Promise<void>((resolve) => {
      markDisposeStarted = resolve
    })
    const dispose = mock(async () => {
      markDisposeStarted()
      await disposeRelease
      return { data: true }
    })
    const getClient = mock(async () => {
      throw new Error("A hard refresh must not eagerly start another OpenCode generation")
    })
    const close = mock(() => undefined)
    const runtime = new OpenCodeAgentRuntime()
    const state = runtime as unknown as {
      client?: { global: { dispose(): Promise<unknown> } }
      getClient(): Promise<unknown>
      server?: { close(): void }
    }
    state.client = { global: { dispose } }
    state.getClient = getClient
    state.server = { close }

    try {
      const configurationRefresh = runtime.refreshConfiguration()
      await disposeStarted
      const skillRefresh = runtime.refreshSkills()
      releaseDispose()
      await Promise.all([configurationRefresh, skillRefresh])

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
      expect(getClient).not.toHaveBeenCalled()
      expect(await runtime.getStatus()).toEqual({ state: "stopped" })
    } finally {
      releaseDispose()
      await runtime.dispose()
    }
  })

  test("adds the explicit strong guard after caller plugins and disables unsafe built-ins", () => {
    const config = {
      permission: {
        bash: "allow" as const,
        lsp: "ask" as const,
        read: "allow" as const,
      },
      plugin: ["file:///host/first-plugin.js"],
    }

    const merged = withProtectedPathGuard(config, [".host", " .host "])

    expect(config.permission.bash).toBe("allow")
    expect(config.plugin).toEqual(["file:///host/first-plugin.js"])
    if (typeof merged.permission !== "object") throw new Error("Expected permission object")
    expect(merged.permission).toMatchObject({ bash: "deny", lsp: "deny", read: "allow" })
    expect(merged.plugin?.[0]).toBe("file:///host/first-plugin.js")
    const guard = merged.plugin?.at(-1)
    if (!Array.isArray(guard)) throw new Error("Expected protected path plugin config")
    expect(guard[0]).toMatch(/\/protected-path-plugin\.(?:js|ts)$/)
    expect(Bun.file(fileURLToPath(guard[0])).size).toBeGreaterThan(0)
    expect(guard[1]).toEqual({ marker: ".agent-runtime-protected-path-guard", paths: [".host"] })
    expect(() => withProtectedPathGuard({}, [".host/**"])).toThrow("concrete paths")
  })

  test("strong guard blocks direct and symlinked paths plus unsafe built-ins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-runtime-protected-path-"))
    try {
      await mkdir(join(directory, ".host"), { recursive: true })
      await mkdir(join(directory, "src"), { recursive: true })
      await mkdir(join(directory, "safe"), { recursive: true })
      await writeFile(join(directory, ".host", "secret.txt"), "private")
      await writeFile(join(directory, "src", "safe.txt"), "public")
      await writeFile(join(directory, "safe", "safe.txt"), "public")
      await symlink(".host", join(directory, "alias"), "dir")
      await symlink(".host/missing.txt", join(directory, "dangling"), "file")
      await symlink("chain-two", join(directory, "chain-one"), "dir")
      await symlink(".host", join(directory, "chain-two"), "dir")
      await symlink("../.host", join(directory, "src", "protected-alias"), "dir")

      const hooks = await protectedPathPlugin(
        { directory },
        {
          marker: ".agent-runtime-protected-path-guard-test",
          paths: [".host"],
        },
      )
      const execute = (tool: string, args?: unknown) => hooks["tool.execute.before"]({ tool }, { args })

      await expect(execute("read", { filePath: ".host/secret.txt" })).rejects.toThrow("host-protected")
      if (process.platform === "darwin" || process.platform === "win32") {
        await expect(execute("read", { filePath: ".HOST/secret.txt" })).rejects.toThrow("host-protected")
      }
      await expect(execute("read", { filePath: "alias/secret.txt" })).rejects.toThrow("host-protected")
      await expect(execute("read", { filePath: "chain-one/secret.txt" })).rejects.toThrow("host-protected")
      await expect(execute("edit", { filePath: "alias/new.txt" })).rejects.toThrow("host-protected")
      await expect(execute("edit", { filePath: "dangling" })).rejects.toThrow("host-protected")
      await expect(
        execute("apply_patch", {
          patchText: "*** Begin Patch\n*** Update File: alias/secret.txt\n@@\n-private\n+changed\n*** End Patch",
        }),
      ).rejects.toThrow("host-protected")
      await expect(execute("grep", { path: ".", pattern: "private" })).rejects.toThrow("recursive tool")
      await expect(execute("glob", { path: "alias", pattern: "**/*" })).rejects.toThrow("recursive tool")
      await expect(execute("list", { path: "." })).rejects.toThrow("recursive tool")
      await expect(execute("grep", { path: "src", pattern: "private" })).rejects.toThrow("symlink")
      await expect(execute("bash", { command: "cat .host/secret.txt" })).rejects.toThrow("disabled")
      await expect(execute("lsp", { filePath: "src/safe.txt" })).rejects.toThrow("disabled")

      await expect(execute("read", { filePath: "src/safe.txt" })).resolves.toBeUndefined()
      await expect(execute("grep", { path: "safe", pattern: "public" })).resolves.toBeUndefined()
      await expect(execute("host_tool")).resolves.toBeUndefined()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test("validates the configurable tool server name", () => {
    expect(() => new OpenCodeAgentRuntime({ toolServerName: "not a name" })).toThrow("Tool server name")
  })

  test("delegates remote MCP status and authorization lifecycle to OpenCode", async () => {
    const status = mock(async () => ({
      data: {
        connected: { status: "connected" as const },
        registration: {
          error: "A public client id is required",
          status: "needs_client_registration" as const,
        },
      },
    }))
    const authenticate = mock(async () => ({ data: { status: "connected" as const } }))
    const connect = mock(async () => ({ data: true }))
    const disconnect = mock(async () => ({ data: true }))
    const remove = mock(async () => ({ data: { success: true as const } }))
    const runtime = new OpenCodeAgentRuntime()
    ;(runtime as unknown as { client: unknown }).client = {
      mcp: {
        auth: { authenticate, remove },
        connect,
        disconnect,
        status,
      },
    }

    try {
      await expect(runtime.listMcpStatuses({ directory: "/workspace" })).resolves.toEqual({
        connected: { status: "connected" },
        registration: {
          error: "A public client id is required",
          status: "needs_client_registration",
        },
      })
      await expect(
        runtime.authenticateMcp({ directory: "/workspace", name: "plugin-remote-editor--main" }),
      ).resolves.toEqual({ status: "connected" })
      await runtime.connectMcp({ directory: "/workspace", name: "plugin-remote-editor--main" })
      await runtime.disconnectMcp({ directory: "/workspace", name: "plugin-remote-editor--main" })
      await runtime.removeMcpAuth({ directory: "/workspace", name: "plugin-remote-editor--main" })

      expect(status).toHaveBeenCalledWith({ directory: "/workspace" })
      expect(authenticate).toHaveBeenCalledWith({
        directory: "/workspace",
        name: "plugin-remote-editor--main",
      })
      expect(connect).toHaveBeenCalledWith({
        directory: "/workspace",
        name: "plugin-remote-editor--main",
      })
      expect(disconnect).toHaveBeenCalledWith({
        directory: "/workspace",
        name: "plugin-remote-editor--main",
      })
      expect(remove).toHaveBeenCalledWith({
        directory: "/workspace",
        name: "plugin-remote-editor--main",
      })
      await expect(runtime.authenticateMcp({ directory: "/workspace", name: "not a name" })).rejects.toThrow(
        "MCP server name",
      )
    } finally {
      await runtime.dispose()
    }
  })

  test("validates the host tool call timeout", () => {
    expect(() => new OpenCodeAgentRuntime({ toolCallTimeout: 0 })).toThrow("positive integer")
  })

  test("scopes the host tool timeout to its dynamically registered MCP server", async () => {
    const add = mock(async () => ({ data: { bridge: { status: "connected" as const } } }))
    const config = {
      experimental: {
        batch_tool: true,
        mcp_timeout: 500,
      },
    }
    const runtime = new OpenCodeAgentRuntime({
      config,
      timeout: 1_234,
      toolCallTimeout: 60 * 60_000,
      toolProvider: {
        callTool: async () => undefined,
        listTools: () => [{ description: "Wait for host work", inputSchema: {}, name: "wait" }],
      },
      toolServerName: "bridge",
    })
    ;(runtime as unknown as { client: unknown }).client = {
      app: { skills: async () => ({ data: [] }) },
      mcp: { add },
      tool: { ids: async () => ({ data: [] }) },
    }

    const runtimeConfig = (
      runtime as unknown as {
        options: { config: { experimental?: { mcp_timeout?: number } } }
      }
    ).options.config

    try {
      const capabilities = await runtime.listCapabilities({ directory: "/workspace", scopeId: "scope-a" })

      expect(capabilities.toolIds).toContain("bridge_wait")
      expect(add).toHaveBeenCalledTimes(1)
      expect(add.mock.calls[0]?.[0]).toMatchObject({
        config: {
          timeout: 60 * 60_000,
          type: "remote",
        },
        directory: "/workspace",
        name: "bridge",
      })
      expect(add.mock.calls[0]?.[0]).not.toMatchObject({ config: { timeout: 1_234 } })
      expect(runtimeConfig.experimental).toMatchObject({ batch_tool: true, mcp_timeout: 500 })
      expect(config.experimental.mcp_timeout).toBe(500)
    } finally {
      await runtime.dispose()
    }
  })

  test("discovers global and managed skills without project external skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skills-"))
    const directory = join(root, "workspace")
    const xdgConfig = join(root, "xdg")
    const configDirectory = join(root, "managed-config")
    const configuredSkills = join(root, "configured-skills")
    await mkdir(directory, { recursive: true })
    await writeSkill(join(xdgConfig, "opencode", "skills", "global-skill"), "global-skill")
    await writeSkill(join(configDirectory, "skills", "managed-skill"), "managed-skill")
    await writeSkill(join(configuredSkills, "configured-skill"), "configured-skill")
    await writeSkill(join(directory, ".agents", "skills", "project-external-skill"), "project-external-skill")

    const previousXdgConfig = process.env.XDG_CONFIG_HOME
    const previousConfigDirectory = process.env.OPENCODE_CONFIG_DIR
    const previousDisableExternalSkills = process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS
    process.env.XDG_CONFIG_HOME = xdgConfig
    process.env.OPENCODE_CONFIG_DIR = "parent-config-must-be-restored"
    process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "parent-value-must-be-restored"
    const runtime = new OpenCodeAgentRuntime({
      config: {
        skills: {
          paths: [configuredSkills],
          // A malformed URL would fail discovery if the host boundary did not
          // force remote Skill indexes off while preserving explicit paths.
          urls: ["not a valid skill index URL"],
        },
      },
      configDirectory,
      timeout: 15_000,
    })

    try {
      const skills = await runtime.listSkills({ directory })
      const names = skills.map((skill) => skill.name)
      expect(names).toContain("global-skill")
      expect(names).toContain("managed-skill")
      expect(names).toContain("configured-skill")
      expect(names).not.toContain("project-external-skill")
      expect(skills.find((skill) => skill.name === "global-skill")?.location).toBe(
        join(xdgConfig, "opencode", "skills", "global-skill", "SKILL.md"),
      )
      expect(skills.find((skill) => skill.name === "managed-skill")?.location).toBe(
        join(configDirectory, "skills", "managed-skill", "SKILL.md"),
      )
      expect(process.env.OPENCODE_CONFIG_DIR).toBe("parent-config-must-be-restored")
      expect(process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("parent-value-must-be-restored")
    } finally {
      await runtime.dispose()
      restoreTestEnvironment("XDG_CONFIG_HOME", previousXdgConfig)
      restoreTestEnvironment("OPENCODE_CONFIG_DIR", previousConfigDirectory)
      restoreTestEnvironment("OPENCODE_DISABLE_EXTERNAL_SKILLS", previousDisableExternalSkills)
      await rm(root, { force: true, recursive: true })
    }
  }, 30_000)

  test("defers a skill refresh until the active prompt finishes", async () => {
    const directory = join(tmpdir(), "agent-runtime-skill-refresh-prompt")
    const runtime = new OpenCodeAgentRuntime()
    let releasePrompt!: () => void
    let markPromptStarted!: () => void
    const promptRelease = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    const promptStarted = new Promise<void>((resolve) => {
      markPromptStarted = resolve
    })
    let disposeCalls = 0
    const now = Date.now()
    const session = {
      id: "persistent-session",
      title: "Persistent session",
      directory,
      time: { created: now, updated: now },
    }
    const internals = runtime as unknown as {
      client: unknown
      protectedPathRegistrations: Map<string, Promise<void>>
      toolRegistrations: Map<string, Promise<void>>
    }
    internals.client = {
      global: {
        dispose: async () => {
          disposeCalls += 1
          return { data: true }
        },
      },
      session: {
        list: async () => ({ data: [session] }),
        prompt: async () => {
          markPromptStarted()
          await promptRelease
          return {
            data: {
              info: {
                id: "assistant-message",
                role: "assistant",
                sessionID: "deferred-session",
                time: { completed: now, created: now },
              },
              parts: [],
            },
          }
        },
      },
    }
    internals.toolRegistrations.set("tool", Promise.resolve())
    internals.protectedPathRegistrations.set("guard", Promise.resolve())

    try {
      expect((await runtime.listSessions({ directory })).map((item) => item.id)).toEqual([session.id])
      const prompt = runtime.prompt({ directory, sessionId: "deferred-session", text: "Hello" })
      await promptStarted
      let refreshFinished = false
      const refresh = runtime.refreshSkills().then(() => {
        refreshFinished = true
      })
      await Promise.resolve()
      expect(disposeCalls).toBe(0)
      expect(refreshFinished).toBe(false)

      releasePrompt()
      await prompt
      await refresh
      expect(disposeCalls).toBe(1)
      expect(refreshFinished).toBe(true)
      expect(internals.toolRegistrations.size).toBe(0)
      expect(internals.protectedPathRegistrations.size).toBe(0)
      expect((await runtime.listSessions({ directory })).map((item) => item.id)).toEqual([session.id])
    } finally {
      releasePrompt()
      await runtime.dispose()
    }
  })

  test("blocks a new prompt behind a queued configuration refresh without interrupting the active prompt", async () => {
    const directory = join(tmpdir(), "agent-runtime-configuration-refresh-prompt")
    const runtime = new OpenCodeAgentRuntime()
    let releaseActivePrompt!: () => void
    let markActivePromptStarted!: () => void
    const activePromptRelease = new Promise<void>((resolve) => {
      releaseActivePrompt = resolve
    })
    const activePromptStarted = new Promise<void>((resolve) => {
      markActivePromptStarted = resolve
    })
    let refreshedPromptStarted = false
    const oldPrompt = mock(async () => {
      markActivePromptStarted()
      await activePromptRelease
      return completedAssistantMessage("active-session")
    })
    const newPrompt = mock(async () => {
      refreshedPromptStarted = true
      return completedAssistantMessage("new-session")
    })
    const oldClient = { session: { prompt: oldPrompt } }
    const newClient = { session: { prompt: newPrompt } }
    let selectedClient: unknown = oldClient
    let closeCalls = 0
    const internals = runtime as unknown as {
      client?: unknown
      getClient(): Promise<unknown>
      server?: { close(): void }
    }
    internals.client = oldClient
    internals.getClient = async () => selectedClient
    internals.server = {
      close() {
        closeCalls += 1
        selectedClient = newClient
      },
    }

    try {
      const activePrompt = runtime.prompt({
        directory,
        sessionId: "active-session",
        text: "Keep running",
      })
      await activePromptStarted

      const refresh = runtime.refreshConfiguration()
      const promptAfterRefresh = runtime.prompt({
        directory,
        sessionId: "new-session",
        text: "Use the new configuration",
      })
      await Promise.resolve()
      expect(refreshedPromptStarted).toBe(false)
      expect(closeCalls).toBe(0)

      releaseActivePrompt()
      await activePrompt
      await refresh
      await promptAfterRefresh

      expect(oldPrompt).toHaveBeenCalledTimes(1)
      expect(newPrompt).toHaveBeenCalledTimes(1)
      expect(closeCalls).toBe(1)
    } finally {
      releaseActivePrompt()
      await runtime.dispose()
    }
  })

  test("admits a same-tick prompt before a configuration refresh can dispose its client", async () => {
    const directory = join(tmpdir(), "agent-runtime-same-tick-prompt-refresh")
    const runtime = new OpenCodeAgentRuntime()
    const events: string[] = []
    const oldClient = {
      global: {
        dispose: mock(async () => {
          events.push("dispose")
        }),
      },
      session: {
        prompt: mock(async () => {
          events.push("prompt")
          return completedAssistantMessage("same-tick-session")
        }),
      },
    }
    const internals = runtime as unknown as {
      client?: unknown
      getClient(): Promise<unknown>
      server?: { close(): void }
    }
    internals.client = oldClient
    internals.getClient = async () => oldClient
    internals.server = {
      close() {
        events.push("close")
      },
    }

    try {
      const prompt = runtime.prompt({
        directory,
        sessionId: "same-tick-session",
        text: "Start before refresh",
      })
      const refresh = runtime.refreshConfiguration()

      await prompt
      await refresh

      expect(events).toEqual(["prompt", "dispose", "close"])
    } finally {
      await runtime.dispose()
    }
  })

  test("holds a same-tick session creation lease until configuration refresh", async () => {
    const directory = join(tmpdir(), "agent-runtime-same-tick-session-refresh")
    const runtime = new OpenCodeAgentRuntime()
    const events: string[] = []
    let releaseCreate!: () => void
    let markCreateStarted!: () => void
    const createRelease = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve
    })
    const oldClient = {
      session: {
        create: mock(async () => {
          events.push("create")
          markCreateStarted()
          await createRelease
          return {
            data: {
              id: "same-tick-session",
              title: "Same tick",
              directory,
              time: { created: 1, updated: 1 },
            },
          }
        }),
      },
    }
    const internals = runtime as unknown as {
      getClient(): Promise<unknown>
    }
    internals.getClient = async () => oldClient

    try {
      const session = runtime.createSession({ directory, title: "Same tick" })
      let refreshFinished = false
      const refresh = runtime.refreshConfiguration().then(() => {
        refreshFinished = true
        events.push("refresh")
      })
      await createStarted

      expect(refreshFinished).toBe(false)
      releaseCreate()
      await expect(session).resolves.toMatchObject({ id: "same-tick-session" })
      await refresh

      expect(events).toEqual(["create", "refresh"])
    } finally {
      releaseCreate()
      await runtime.dispose()
    }
  })

  test("blocks Skill, model, and capability discovery behind a queued configuration refresh", async () => {
    const directory = join(tmpdir(), "agent-runtime-configuration-refresh-discovery")
    const runtime = new OpenCodeAgentRuntime()
    let releaseActivePrompt!: () => void
    let markActivePromptStarted!: () => void
    const activePromptRelease = new Promise<void>((resolve) => {
      releaseActivePrompt = resolve
    })
    const activePromptStarted = new Promise<void>((resolve) => {
      markActivePromptStarted = resolve
    })
    const oldSkills = mock(async () => ({ data: [{ name: "old-skill" }] }))
    const oldModels = mock(async () => ({ data: { all: [], connected: [], default: {} } }))
    const oldTools = mock(async () => ({ data: ["plugin_old_tool"] }))
    const newSkills = mock(async () => ({
      data: [{ description: "New Skill", location: "/skills/new/SKILL.md", name: "new-skill" }],
    }))
    const newModels = mock(async () => ({
      data: {
        all: [
          {
            env: [],
            id: "new-provider",
            models: {
              main: {
                id: "new-model",
                name: "New model",
                providerID: "new-provider",
              },
            },
            name: "New provider",
            options: {},
            source: "api",
          },
        ],
        connected: ["new-provider"],
        default: { "new-provider": "new-model" },
      },
    }))
    const newTools = mock(async () => ({ data: ["plugin_new_tool"] }))
    const oldClient = {
      app: { skills: oldSkills },
      provider: { list: oldModels },
      session: {
        prompt: async () => {
          markActivePromptStarted()
          await activePromptRelease
          return completedAssistantMessage("active-session")
        },
      },
      tool: { ids: oldTools },
    }
    const newClient = {
      app: { skills: newSkills },
      provider: { list: newModels },
      tool: { ids: newTools },
    }
    let selectedClient: unknown = oldClient
    const internals = runtime as unknown as {
      client?: unknown
      getClient(): Promise<unknown>
      server?: { close(): void }
    }
    internals.client = oldClient
    internals.getClient = async () => selectedClient
    internals.server = {
      close() {
        selectedClient = newClient
      },
    }

    try {
      const activePrompt = runtime.prompt({
        directory,
        sessionId: "active-session",
        text: "Keep running",
      })
      await activePromptStarted

      const refresh = runtime.refreshConfiguration()
      const skills = runtime.listSkills({ directory })
      const models = runtime.listModels({ directory })
      const capabilities = runtime.listCapabilities({ directory })
      await Promise.resolve()

      expect(oldSkills).not.toHaveBeenCalled()
      expect(oldModels).not.toHaveBeenCalled()
      expect(oldTools).not.toHaveBeenCalled()
      expect(newSkills).not.toHaveBeenCalled()
      expect(newModels).not.toHaveBeenCalled()
      expect(newTools).not.toHaveBeenCalled()

      releaseActivePrompt()
      await activePrompt
      await refresh

      await expect(skills).resolves.toEqual([
        {
          description: "New Skill",
          location: "/skills/new/SKILL.md",
          name: "new-skill",
        },
      ])
      await expect(models).resolves.toEqual({
        providers: [
          {
            connected: true,
            defaultModelId: "new-model",
            models: [{ default: true, modelId: "new-model", modelName: "New model" }],
            providerId: "new-provider",
            providerName: "New provider",
          },
        ],
      })
      await expect(capabilities).resolves.toEqual({
        skills: [
          {
            description: "New Skill",
            location: "/skills/new/SKILL.md",
            name: "new-skill",
          },
        ],
        toolIds: ["plugin_new_tool"],
      })
      expect(newSkills).toHaveBeenCalledTimes(2)
      expect(newModels).toHaveBeenCalledTimes(1)
      expect(newTools).toHaveBeenCalledTimes(1)
    } finally {
      releaseActivePrompt()
      await runtime.dispose()
    }
  })

  test("loads a selected Skill through a synthetic skill-tool instruction", async () => {
    const runtime = new OpenCodeAgentRuntime()
    const prompt = mock(async () => completedAssistantMessage("skill-session"))
    const command = mock(async () => {
      throw new Error("The Skill command endpoint must not be used")
    })
    ;(runtime as unknown as { client: unknown }).client = {
      app: {
        skills: async () => ({ data: [{ name: "review", location: "/skills/review/SKILL.md" }] }),
      },
      session: { command, prompt },
    }

    try {
      await runtime.prompt({
        directory: "/workspace",
        resources: [{ kind: "skill", name: "review" }],
        sessionId: "skill-session",
        text: "Review this change",
      })

      expect(command).not.toHaveBeenCalled()
      expect(prompt).toHaveBeenCalledTimes(1)
      const request = prompt.mock.calls[0]?.[0] as { parts: unknown[] }
      expect(request.parts).toEqual([
        {
          metadata: { "convax.agent.skill": "review" },
          synthetic: true,
          text: 'Use the skill tool to load the Skill named "review" before handling the request.',
          type: "text",
        },
        { text: "Review this change", type: "text" },
      ])
    } finally {
      await runtime.dispose()
    }
  })

  test("deduplicates multiple Skills while keeping one semantic instruction for each", async () => {
    const runtime = new OpenCodeAgentRuntime()
    const prompt = mock(async () => completedAssistantMessage("multi-skill-session"))
    ;(runtime as unknown as { client: unknown }).client = {
      app: {
        skills: async () => ({ data: [{ name: "review" }, { name: "release" }] }),
      },
      session: { prompt },
    }

    try {
      await runtime.prompt({
        directory: "/workspace",
        resources: [
          { kind: "skill", name: "review" },
          { kind: "skill", name: "release" },
          { kind: "skill", name: "review" },
        ],
        sessionId: "multi-skill-session",
        text: "Prepare the release",
      })

      const request = prompt.mock.calls[0]?.[0] as { parts: Array<{ metadata?: Record<string, unknown> }> }
      expect(request.parts.slice(0, 2).map((part) => part.metadata)).toEqual([
        { "convax.agent.skill": "review" },
        { "convax.agent.skill": "release" },
      ])
      expect(request.parts).toHaveLength(3)
    } finally {
      await runtime.dispose()
    }
  })

  test("rejects a selected Skill that is not in OpenCode discovery", async () => {
    const runtime = new OpenCodeAgentRuntime()
    const prompt = mock(async () => completedAssistantMessage("missing-skill-session"))
    ;(runtime as unknown as { client: unknown }).client = {
      app: { skills: async () => ({ data: [{ name: "review" }] }) },
      session: { prompt },
    }

    try {
      await expect(
        runtime.prompt({
          directory: "/workspace",
          resources: [{ kind: "skill", name: "missing" }],
          sessionId: "missing-skill-session",
          text: "Use it",
        }),
      ).rejects.toThrow("OpenCode skill was not found: missing")
      expect(prompt).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })

  test("restores semantic Skill parts from persisted text metadata", async () => {
    const runtime = new OpenCodeAgentRuntime()
    const now = Date.now()
    const sessionId = "history-skill-session"
    ;(runtime as unknown as { client: unknown }).client = {
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => ({ data: [] }) },
      session: {
        get: async () => ({
          data: {
            directory: "/workspace",
            id: sessionId,
            time: { created: now, updated: now },
            title: "Skill history",
          },
        }),
        messages: async () => ({
          data: [
            {
              info: {
                agent: "build",
                id: "user-message",
                model: { modelID: "model", providerID: "provider" },
                role: "user",
                sessionID: sessionId,
                time: { created: now },
              },
              parts: [
                {
                  id: "skill-part",
                  messageID: "user-message",
                  metadata: { "convax.agent.skill": "review" },
                  sessionID: sessionId,
                  synthetic: true,
                  text: "Hidden Skill instruction",
                  type: "text",
                },
                {
                  id: "text-part",
                  messageID: "user-message",
                  sessionID: sessionId,
                  text: "Review this change",
                  type: "text",
                },
              ],
            },
          ],
        }),
        status: async () => ({ data: { [sessionId]: { type: "idle" } } }),
      },
    }

    try {
      const state = await runtime.getSessionState({ directory: "/workspace", sessionId })
      expect(state.messages[0]?.parts).toEqual([
        { id: "skill-part", name: "review", type: "skill" },
        { id: "text-part", synthetic: undefined, text: "Review this change", type: "text" },
      ])
    } finally {
      await runtime.dispose()
    }
  })

  test("does not discover executable extensions from an opened workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-runtime-boundary-"))
    const toolDirectory = join(directory, ".opencode", "tools")
    const skillDirectory = join(directory, ".opencode", "skills", "workspace-extension-probe")
    await mkdir(toolDirectory, { recursive: true })
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(
      join(toolDirectory, "workspace_extension_probe.ts"),
      [
        "export default {",
        "  description: 'Workspace extension probe',",
        "  args: {},",
        "  execute: async () => 'loaded',",
        "}",
      ].join("\n"),
    )
    await writeFile(
      join(skillDirectory, "SKILL.md"),
      [
        "---",
        "name: workspace-extension-probe",
        "description: Workspace extension probe",
        "---",
        "",
        "This workspace-local skill must remain outside the host runtime boundary.",
      ].join("\n"),
    )

    const runtime = new OpenCodeAgentRuntime({
      protectedPaths: [".host"],
      timeout: 15_000,
      toolServerName: "bridge",
      toolProvider: {
        async callTool(_scope, _name, input) {
          return input
        },
        listTools: () => [
          {
            description: "Echo input",
            inputSchema: { type: "object" },
            name: "echo",
          },
        ],
      },
    })
    try {
      const capabilities = await runtime.listCapabilities({ directory, scopeId: "workspace-a" })
      expect(capabilities.toolIds).not.toContain("workspace_extension_probe")
      expect(capabilities.skills.map((skill) => skill.name)).not.toContain("workspace-extension-probe")
      expect(capabilities.toolIds).toContain("bridge_echo")
      expect(capabilities.toolIds).not.toContain("bash")
      expect(capabilities.toolIds).not.toContain("lsp")
    } finally {
      await runtime.dispose()
      await rm(directory, { force: true, recursive: true })
    }
  }, 20_000)

  test("inlines host-prepared structured resource content without a second MCP lookup", async () => {
    const content = JSON.stringify({ documentId: "document-1", section: "summary" })
    const [part] = await prepareAgentResourceParts("/directory/that/does/not/exist", [
      {
        clientName: "host",
        content,
        kind: "resource",
        mime: "application/json",
        name: "Launch brief",
        uri: "host://documents/document-1/sections/summary",
      },
    ])

    expect(part?.filename).toBe("Launch brief")
    expect(part?.mime).toBe("text/plain")
    expect(part?.source).toBeUndefined()
    expect(Buffer.from(part.url.split(",")[1]!, "base64").toString("utf8")).toBe(content)
  })

  test("rejects invalid host-prepared structured resource metadata", async () => {
    await expect(
      prepareAgentResourceParts("/unused", [
        {
          clientName: "host",
          content: "{}",
          kind: "resource",
          mime: "application/json",
          uri: "not a URI",
        },
      ]),
    ).rejects.toThrow("URI is invalid")
  })
})
