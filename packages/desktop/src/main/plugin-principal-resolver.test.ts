import { describe, expect, test } from "bun:test"

import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { InstalledPlugin } from "../plugin-api"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"

function manifest(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    capabilities: ["canvas.document.read"],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Canvas tool",
    entry: "web/index.html",
    hostApi: {
      major: 2,
      optional: [],
      required: ["host.context.get", "canvas.document.get"],
    },
    id: "canvas-tool",
    name: "Canvas Tool",
    schema: "convax.plugin/8",
    version: "1.0.0",
    ...overrides,
  }
}

function activeIdentity(plugin = manifest()) {
  return {
    activeRevision: 7,
    activeSetDigest: "b".repeat(64),
    digest: "a".repeat(64),
    plugin,
    snapshotDigest: "c".repeat(64),
  }
}

describe("InstalledPluginPrincipalResolver", () => {
  test("issues and continuously verifies one exact ActiveSet generation", async () => {
    let current = activeIdentity()
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return current
      },
    })

    const principal = await resolver.issue("canvas-tool", "web")
    expect(principal).toEqual({
      activeRevision: 7,
      activeSetDigest: "b".repeat(64),
      manifestDigest: "a".repeat(64),
      pluginId: "canvas-tool",
      pluginVersion: "1.0.0",
      runtime: "web",
      snapshotDigest: "c".repeat(64),
    })
    expect(await resolver.resolve(principal)).toMatchObject({
      activeRevision: 7,
      activeSetDigest: "b".repeat(64),
      capabilities: ["canvas.document.read"],
      pluginId: "canvas-tool",
      snapshotDigest: "c".repeat(64),
    })

    for (const replacement of [
      { ...current, activeRevision: 8 },
      { ...current, activeSetDigest: "d".repeat(64) },
      { ...current, snapshotDigest: "e".repeat(64) },
      { ...current, digest: "f".repeat(64) },
    ]) {
      current = replacement
      expect(await resolver.resolve(principal)).toBeNull()
      current = activeIdentity()
    }
  })

  test("rejects legacy manifests and incomplete immutable identity", async () => {
    let current: ReturnType<typeof activeIdentity> | Record<string, unknown> = activeIdentity()
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return current as ReturnType<typeof activeIdentity>
      },
    })

    current = { digest: "a".repeat(64), plugin: manifest() }
    await expect(resolver.issue("canvas-tool", "web")).rejects.toThrow(
      "not bound to an active immutable snapshot",
    )

    current = {
      ...activeIdentity(),
      plugin: { ...manifest(), schema: "convax.plugin/7" },
    }
    await expect(resolver.issue("canvas-tool", "web")).rejects.toThrow(
      "does not expose the capability API",
    )
  })

  test("checks required APIs while preserving unavailable future optional APIs", async () => {
    let plugin = manifest({
      capabilities: ["canvas.node.read"],
      hostApi: {
        major: 2,
        optional: ["future.canvas.inspect"],
        required: ["host.context.get", "canvas.node.get"],
      },
    })
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return activeIdentity(plugin)
      },
    })

    const principal = await resolver.issue("canvas-tool", "web")
    expect(await resolver.resolve(principal)).toMatchObject({
      hostApi: {
        optional: ["future.canvas.inspect"],
        required: ["host.context.get", "canvas.node.get"],
      },
    })

    plugin = {
      ...plugin,
      hostApi: {
        major: 2,
        optional: [],
        required: ["host.context.get", "future.canvas.mutate"],
      },
    }
    await expect(resolver.issue("canvas-tool", "web")).rejects.toThrow(
      "future.canvas.mutate: unsupported-host",
    )
  })

  test("keeps Web and Tool identities distinct and rejects every unknown runtime", async () => {
    let plugin = manifest()
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return activeIdentity(plugin)
      },
    })

    await expect(resolver.issue("canvas-tool", "tool")).rejects.toThrow("Static Plugin")
    await expect(
      resolver.issue("canvas-tool", "builtin" as never),
    ).rejects.toThrow("runtime is unsupported")

    plugin = manifest({
      capabilities: ["projects.read"],
      contributes: {},
      entry: undefined,
      hostApi: { major: 2, optional: [], required: ["projects.list"] },
      runtime: { command: "canvas-tool-mcp", type: "mcp-stdio" },
    })
    await expect(resolver.issue("canvas-tool", "web")).rejects.toThrow("Headless Plugin")
    expect((await resolver.issue("canvas-tool", "tool")).runtime).toBe("tool")

    const forged = {
      ...(await resolver.issue("canvas-tool", "tool")),
      runtime: "builtin",
    } as unknown as PluginPrincipal
    expect(await resolver.resolve(forged)).toBeNull()
  })

  test("refuses to issue a Tool principal for a stale discovered manifest", async () => {
    const current = manifest({
      capabilities: ["projects.read"],
      contributes: {},
      entry: undefined,
      hostApi: { major: 2, optional: [], required: ["projects.list"] },
      runtime: { command: "canvas-tool-mcp", type: "mcp-stdio" },
    })
    const resolver = new InstalledPluginPrincipalResolver({
      async resolveCapabilityIdentity() {
        return activeIdentity(current)
      },
    })

    await expect(
      resolver.issue("canvas-tool", "tool", { ...current, version: "0.9.0" }),
    ).rejects.toThrow("changed before its capability principal was issued")
  })
})
