import { describe, expect, test } from "bun:test"

import { parseWebPluginManifest } from "./plugin-contracts"

const emptyObjectSchema = {
  additionalProperties: false,
  properties: {},
  required: [],
  type: "object",
} as const

describe("v8 inter-Plugin contribution integration", () => {
  test("uses the SDK-owned capability parser and preserves its normalized declaration", () => {
    const plugin = parseWebPluginManifest({
      capabilities: [],
      contributes: {
        capabilities: {
          exports: [
            {
              docs: { request: "No fields.", response: "No fields.", summary: "Checks readiness." },
              id: "media.runtime.ready",
              inputSchema: emptyObjectSchema,
              operation: "runtime.ready",
              outputSchema: emptyObjectSchema,
              sideEffect: "read",
              version: "1.0.0",
            },
          ],
          imports: { optional: [], required: [] },
        },
      },
      description: "Capability provider",
      hostApi: { major: 3, optional: [], required: [] },
      id: "capability-provider",
      name: "Capability Provider",
      runtime: { command: "capability-provider", type: "mcp-stdio" },
      schema: "convax.plugin/8",
      version: "1.0.0",
    })

    expect(plugin.contributes.capabilities?.exports[0]).toMatchObject({
      id: "media.runtime.ready",
      operation: "runtime.ready",
      version: "1.0.0",
    })
    expect(Object.isFrozen(plugin.contributes.capabilities)).toBeTrue()
  })

  test("keeps the new contribution out of legacy manifest schemas", () => {
    expect(() =>
      parseWebPluginManifest({
        capabilities: [],
        contributes: {
          capabilities: { exports: [], imports: { optional: [], required: [] } },
          canvas: { renderer: { nodeKinds: ["legacy"] } },
        },
        description: "Legacy Plugin",
        entry: "index.html",
        id: "legacy-plugin",
        name: "Legacy Plugin",
        schema: "convax.plugin/7",
        version: "1.0.0",
      }),
    ).toThrow("Plugin manifest must use convax.plugin/8")
  })
})
