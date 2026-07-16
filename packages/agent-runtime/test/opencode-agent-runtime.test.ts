import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  OpenCodeAgentRuntime,
  isAgentSessionInDirectory,
  prepareAgentResourceParts,
  withProtectedPathGuard,
  withProtectedPathPermissions,
} from "../src/node/opencode-agent-runtime"
import protectedPathPlugin from "../src/node/protected-path-plugin"

async function writeSkill(directory: string, name: string, description = `${name} description`) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `Use the ${name} workflow.`,
  ].join("\n"))
}

function restoreTestEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe("OpenCode agent runtime boundaries", () => {
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
    const bounded = (runtime as unknown as {
      options: { config: typeof config }
    }).options.config

    expect(bounded.skills?.paths).toEqual(["/managed/skills"])
    expect(bounded.skills?.urls).toEqual([])
    expect(config.skills.urls).toEqual(["https://example.com/skills"])
    const runtimeWithoutPaths = new OpenCodeAgentRuntime()
    const boundedWithoutPaths = (runtimeWithoutPaths as unknown as {
      options: { config: { skills?: { paths?: string[]; urls?: string[] } } }
    }).options.config
    expect("paths" in boundedWithoutPaths.skills!).toBe(false)
    await Promise.all([runtime.dispose(), runtimeWithoutPaths.dispose()])
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

      const hooks = await protectedPathPlugin({ directory }, {
        marker: ".agent-runtime-protected-path-guard-test",
        paths: [".host"],
      })
      const execute = (tool: string, args?: unknown) => hooks["tool.execute.before"]({ tool }, { args })

      await expect(execute("read", { filePath: ".host/secret.txt" })).rejects.toThrow("host-protected")
      if (process.platform === "darwin" || process.platform === "win32") {
        await expect(execute("read", { filePath: ".HOST/secret.txt" })).rejects.toThrow("host-protected")
      }
      await expect(execute("read", { filePath: "alias/secret.txt" })).rejects.toThrow("host-protected")
      await expect(execute("read", { filePath: "chain-one/secret.txt" })).rejects.toThrow("host-protected")
      await expect(execute("edit", { filePath: "alias/new.txt" })).rejects.toThrow("host-protected")
      await expect(execute("edit", { filePath: "dangling" })).rejects.toThrow("host-protected")
      await expect(execute("apply_patch", {
        patchText: "*** Begin Patch\n*** Update File: alias/secret.txt\n@@\n-private\n+changed\n*** End Patch",
      })).rejects.toThrow("host-protected")
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

  test("does not discover executable extensions from an opened workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-runtime-boundary-"))
    const toolDirectory = join(directory, ".opencode", "tools")
    const skillDirectory = join(directory, ".opencode", "skills", "workspace-extension-probe")
    await mkdir(toolDirectory, { recursive: true })
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(toolDirectory, "workspace_extension_probe.ts"), [
      "export default {",
      "  description: 'Workspace extension probe',",
      "  args: {},",
      "  execute: async () => 'loaded',",
      "}",
    ].join("\n"))
    await writeFile(join(skillDirectory, "SKILL.md"), [
      "---",
      "name: workspace-extension-probe",
      "description: Workspace extension probe",
      "---",
      "",
      "This workspace-local skill must remain outside the host runtime boundary.",
    ].join("\n"))

    const runtime = new OpenCodeAgentRuntime({
      protectedPaths: [".host"],
      timeout: 15_000,
      toolServerName: "bridge",
      toolProvider: {
        async callTool(_scope, _name, input) {
          return input
        },
        listTools: () => [{
          description: "Echo input",
          inputSchema: { type: "object" },
          name: "echo",
        }],
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
    const [part] = await prepareAgentResourceParts("/directory/that/does/not/exist", [{
      clientName: "host",
      content,
      kind: "resource",
      mime: "application/json",
      name: "Launch brief",
      uri: "host://documents/document-1/sections/summary",
    }])

    expect(part?.filename).toBe("Launch brief")
    expect(part?.mime).toBe("text/plain")
    expect(part?.source).toBeUndefined()
    expect(Buffer.from(part.url.split(",")[1]!, "base64").toString("utf8")).toBe(content)
  })

  test("rejects invalid host-prepared structured resource metadata", async () => {
    await expect(prepareAgentResourceParts("/unused", [{
      clientName: "host",
      content: "{}",
      kind: "resource",
      mime: "application/json",
      uri: "not a URI",
    }])).rejects.toThrow("URI is invalid")
  })
})
