import { describe, expect, test } from "bun:test"

import {
  parsePluginRuntimeSurface,
  projectRegistryPackageRuntimeSurface,
} from "./marketplace-runtime-surface"

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["projects.read"],
    contributes: {},
    description: "Runtime surface fixture",
    hostApi: { major: 1, optional: [], required: [] },
    id: "runtime-surface-fixture",
    name: "Runtime surface fixture",
    schema: "convax.plugin/8",
    version: "1.0.0",
    ...overrides,
  }
}

describe("Marketplace runtime-surface projection", () => {
  test.each([
    ["none", manifest()],
    ["agent", manifest({ hooks: "hook.mjs" })],
    [
      "agent-and-convax",
      manifest({
        capabilities: [],
        contributes: { canvas: { renderer: { create: true } } },
        entry: "index.html",
        hostApi: { major: 1, optional: [], required: ["host.context.get"] },
      }),
    ],
  ] as const)("projects canonical v8 manifests to %s", (expected, value) => {
    expect(parsePluginRuntimeSurface(value).runtimeSurface).toBe(expected)
    expect(
      projectRegistryPackageRuntimeSurface({
        delivery: {
          kind: "artifact",
          sha256: "a".repeat(64),
          size: 1,
          url: "https://github.com/acme/plugins/releases/download/runtime-surface-fixture-v1.0.0/plugin.zip",
        },
        id: "runtime-surface-fixture",
        kind: "plugin",
        manifest: value,
        version: "1.0.0",
      }),
    ).toBe(expected)
  })

  test.each([
    manifest({ schema: "convax.plugin/7" }),
    manifest({ contributes: { generationTools: [] } }),
    manifest({ contributes: { services: [] } }),
    manifest({ contributes: { mcpServers: [] } }),
    manifest({ unknownField: true }),
  ])("fails closed on old, guessed or malformed Plugin fields", (value) => {
    expect(() => parsePluginRuntimeSurface(value)).toThrow()
  })

  test("rejects a valid v8 projection bound to another package identity", () => {
    expect(() =>
      parsePluginRuntimeSurface(manifest(), {
        id: "another-plugin",
        version: "1.0.0",
      }),
    ).toThrow("identity does not match")
  })

  test("keeps Skill and validated MCP display policy independent of Plugin manifests", () => {
    expect(
      projectRegistryPackageRuntimeSurface({
        delivery: {
          kind: "artifact",
          sha256: "b".repeat(64),
          size: 1,
          url: "https://github.com/acme/plugins/releases/download/skill-v1.0.0/skill.zip",
        },
        id: "skill",
        kind: "skill",
        version: "1.0.0",
      }),
    ).toBe("none")
    expect(
      projectRegistryPackageRuntimeSurface({
        delivery: {
          companions: [],
          extension: {
            productActions: [
              {
                action: "canvas.import",
                tool: "canvas_import",
              },
            ],
            runtime: {
              argv: [],
              command: "canvas-tool",
              compatibility: { targets: [] },
              kind: "managed-stdio",
            },
            schema: "convax.mcp-server-extension/1",
          },
          extensionSha256: "c".repeat(64),
          kind: "mcp-managed-stdio",
          serverJson: {},
          serverJsonSha256: "d".repeat(64),
        },
        id: "io.example/canvas-tool",
        kind: "mcp-server",
        version: "1.0.0",
      }),
    ).toBe("agent-and-convax")
  })
})
