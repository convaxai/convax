import { describe, expect, mock, test } from "bun:test"

import { parseWebPluginManifest } from "../plugin-contracts"
import type {
  ActivePluginRuntimeHandle,
  ActivePluginRuntimeSetHandle,
} from "./plugin-installation-runtime"
import { PluginAgentConfigurationResolver } from "./plugin-agent-configuration"

function plugin(version: string, url: string, skillName: string) {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      agent: { mcp: { type: "remote", url } },
      canvas: { renderer: { create: true } },
      skills: [{ name: skillName, path: `skills/${skillName}` }],
    },
    description: "Agent configuration test Plugin",
    entry: "index.html",
    hostApi: { major: 3, optional: [], required: ["host.context.get"] },
    id: "remote-editor",
    name: "Remote Editor",
    schema: "convax.plugin/8",
    version,
  })
}

function activeSet(input: {
  activeSetDigest: string
  plugin: ReturnType<typeof plugin>
  revision: number
  skillPath: () => Promise<string>
}) {
  let released = false
  const handle = {
    descriptor: { authorizations: {} },
    identity: {
      activeRevision: input.revision,
      activeSetDigest: input.activeSetDigest,
      pluginId: input.plugin.id,
      snapshotDigest: `${input.activeSetDigest}-snapshot`,
      version: input.plugin.version,
    },
    plugin: input.plugin,
    get released() {
      return released
    },
    release() {
      released = true
    },
    resolveOwnedSkillDirectory: input.skillPath,
  } as unknown as ActivePluginRuntimeHandle
  const set = {
    activeSetDigest: input.activeSetDigest,
    plugins: [handle],
    revision: input.revision,
    get released() {
      return released
    },
    release() {
      if (released) return
      released = true
      handle.release()
    },
  } as ActivePluginRuntimeSetHandle
  return { handle, set }
}

describe("Plugin Agent configuration resolver", () => {
  test("keeps MCP and Skill contributions on one exact generation during an update race", async () => {
    let releaseFirstSkill: ((path: string) => void) | undefined
    const firstSkill = new Promise<string>((resolve) => {
      releaseFirstSkill = resolve
    })
    const first = activeSet({
      activeSetDigest: "a".repeat(64),
      plugin: plugin("1.0.0", "https://v1.example.com/mcp", "workflow-v1"),
      revision: 1,
      skillPath: () => firstSkill,
    })
    const second = activeSet({
      activeSetDigest: "b".repeat(64),
      plugin: plugin("2.0.0", "https://v2.example.com/mcp", "workflow-v2"),
      revision: 2,
      skillPath: async () => "/immutable/v2/skills/workflow-v2",
    })
    let current = first.set
    const acquireActivePluginSet = mock(async () => current)
    const resolver = new PluginAgentConfigurationResolver({
      plugins: { acquireActivePluginSet },
      readMarketplaceState: async () => undefined,
    })

    const resolvingFirst = resolver.resolve()
    await Promise.resolve()
    current = second.set
    const resolvingSecond = resolver.resolve()
    releaseFirstSkill?.("/immutable/v1/skills/workflow-v1")
    const firstConfiguration = await resolvingFirst

    expect(firstConfiguration.skillPaths).toEqual(["/immutable/v1/skills/workflow-v1"])
    expect(firstConfiguration.mcpServers?.plugin_remote_editor?.url).toBe("https://v1.example.com/mcp")
    expect(first.set.released).toBeFalse()

    const secondConfiguration = await resolvingSecond
    expect(secondConfiguration.skillPaths).toEqual(["/immutable/v2/skills/workflow-v2"])
    expect(secondConfiguration.mcpServers?.plugin_remote_editor?.url).toBe("https://v2.example.com/mcp")
    expect(first.set.released).toBeTrue()
    expect(second.set.released).toBeFalse()
    expect(acquireActivePluginSet).toHaveBeenCalledTimes(2)

    resolver.dispose()
    expect(second.set.released).toBeTrue()
  })

  test("fails closed and releases a mixed-generation set", async () => {
    const mixed = activeSet({
      activeSetDigest: "c".repeat(64),
      plugin: plugin("1.0.0", "https://remote.example.com/mcp", "workflow"),
      revision: 3,
      skillPath: async () => "/immutable/skills/workflow",
    })
    ;(mixed.handle.identity as { activeRevision: number }).activeRevision = 2
    const resolver = new PluginAgentConfigurationResolver({
      plugins: { acquireActivePluginSet: async () => mixed.set },
      readMarketplaceState: async () => undefined,
    })

    await expect(resolver.resolve()).rejects.toThrow("mixed ActiveSet generation")
    expect(mixed.set.released).toBeTrue()
  })
})
