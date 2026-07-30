import { describe, expect, test } from "bun:test"
import {
  parsePluginCapabilityDeclaration,
  type PluginCapabilityRuntimeToolDefinition,
} from "@convax/plugin-sdk"

import type { PluginCapabilityPluginIdentity } from "./plugin-capability-broker"
import {
  PluginCapabilityRuntimeReadinessAdapter,
  type PluginCapabilityRuntimeInspectionPort,
} from "./plugin-capability-runtime-readiness"

const digest = (character: string) => character.repeat(64)
const schema = {
  additionalProperties: false,
  properties: { text: { maxLength: 128, type: "string" } },
  required: ["text"],
  type: "object",
} as const
const capability = parsePluginCapabilityDeclaration({
  exports: [
    {
      docs: { request: "Text.", response: "Text.", summary: "Transform text." },
      id: "media.text.transform",
      inputSchema: schema,
      operation: "text.transform",
      outputSchema: schema,
      sideEffect: "execute",
      version: "1.0.0",
    },
  ],
  imports: { optional: [], required: [] },
}).exports[0]!
const provider: PluginCapabilityPluginIdentity = {
  activeRevision: 7,
  activeSetDigest: digest("a"),
  pluginId: "provider",
  pluginVersion: "1.0.0",
  snapshotDigest: digest("b"),
}
const tools: readonly PluginCapabilityRuntimeToolDefinition[] = [
  {
    inputSchema: capability.inputSchema,
    name: capability.operation,
    outputSchema: capability.outputSchema,
  },
]

function inspection(override: Partial<PluginCapabilityPluginIdentity> = {}) {
  let released = false
  return {
    generation: "runtime-generation-1",
    provider: { ...provider, ...override },
    get released() {
      return released
    },
    release() {
      released = true
    },
    state: "ready" as const,
    tools,
  }
}

function adapter(
  inspect: PluginCapabilityRuntimeInspectionPort["inspect"],
) {
  return new PluginCapabilityRuntimeReadinessAdapter({ inspect })
}

describe("Plugin capability runtime readiness adapter", () => {
  test.each(["setup-required", "disabled", "recovering"] as const)(
    "preserves the structured %s state",
    async (state) => {
      await expect(
        adapter(async () => ({ state })).evaluate({ capability, provider }),
      ).resolves.toEqual({ available: false, reason: state, recoverable: true })
    },
  )

  test("requires exact provider snapshot identity and both tools/list schemas", async () => {
    await expect(
      adapter(async () => inspection({ snapshotDigest: digest("c") })).evaluate({ capability, provider }),
    ).resolves.toEqual({
      available: false,
      reason: "contract-mismatch",
      recoverable: false,
    })
    await expect(
      adapter(async () => ({
        ...inspection(),
        tools: [{ inputSchema: capability.inputSchema, name: capability.operation }],
      })).evaluate({ capability, provider }),
    ).resolves.toEqual({
      available: false,
      reason: "contract-mismatch",
      recoverable: false,
    })
  })

  test("reports ready only for the exact connected tool contract", async () => {
    await expect(
      adapter(async () => inspection()).evaluate({
        capability,
        provider,
      }),
    ).resolves.toMatchObject({
      available: true,
      runtime: { generation: "runtime-generation-1", provider, released: false },
      tools,
    })
  })

  test("maps inspection failure to bounded recovering availability", async () => {
    await expect(
      adapter(async () => {
        throw new Error("secret runtime diagnostic")
      }).evaluate({ capability, provider }),
    ).resolves.toEqual({
      available: false,
      reason: "recovering",
      recoverable: true,
    })
  })
})
