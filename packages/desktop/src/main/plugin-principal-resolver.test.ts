import { describe, expect, test } from "bun:test"

import type { InstalledPlugin } from "../plugin-api"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"

function manifest(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    capabilities: ["canvas.document.read"],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Canvas tool",
    entry: "web/index.html",
    id: "canvas-tool",
    name: "Canvas Tool",
    schema: "convax.plugin/5",
    version: "1.0.0",
    ...overrides,
  }
}

describe("InstalledPluginPrincipalResolver", () => {
  test("issues and continuously verifies an exact installed package identity", async () => {
    let current: { digest: string; plugin: ReturnType<typeof manifest> } | null = {
      digest: "a".repeat(64),
      plugin: manifest(),
    }
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return current
      },
    })

    const principal = await resolver.issue("canvas-tool", "web")
    expect(principal).toEqual({
      manifestDigest: "a".repeat(64),
      pluginId: "canvas-tool",
      pluginVersion: "1.0.0",
      runtime: "web",
    })
    expect(await resolver.resolve(principal)).toMatchObject({
      capabilities: ["canvas.document.read"],
      pluginId: "canvas-tool",
    })

    current = { digest: "b".repeat(64), plugin: manifest() }
    expect(await resolver.resolve(principal)).toBeNull()
  })

  test("keeps Web, Tool, and built-in runtime identities distinct", async () => {
    let plugin = manifest()
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return { digest: "a".repeat(64), plugin }
      },
    })

    await expect(resolver.issue("canvas-tool", "tool")).rejects.toThrow("Static Plugin")
    await expect(resolver.issue("canvas-tool", "builtin")).rejects.toThrow("Imported Plugin")
    plugin = manifest({ entry: undefined, runtime: { command: "canvas-tool-mcp", type: "mcp-stdio" } })
    await expect(resolver.issue("canvas-tool", "web")).rejects.toThrow("Headless Plugin")
    expect((await resolver.issue("canvas-tool", "tool")).runtime).toBe("tool")
  })

  test("refuses to issue a Tool principal for a stale discovered manifest", async () => {
    const current = manifest({ entry: undefined, runtime: { command: "canvas-tool-mcp", type: "mcp-stdio" } })
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return { digest: "a".repeat(64), plugin: current }
      },
    })

    await expect(resolver.issue("canvas-tool", "tool", { ...current, version: "0.9.0" })).rejects.toThrow(
      "changed before its capability principal was issued",
    )
  })
})
