import { describe, expect, test } from "bun:test"
import { parsePluginCapabilityDeclaration, type PluginCapabilityDeclaration } from "@convax/plugin-sdk"

import {
  planPluginCapabilityTopology,
  projectPluginCapabilityTopology,
  verifyPluginCapabilityTopology,
  type PublishedPluginCapabilityContract,
} from "./plugin-capability-binding-plan"

const digest = (character: string) => character.repeat(64)
const schema = {
  additionalProperties: false,
  properties: {},
  required: [],
  type: "object",
} as const

function declaration(input: {
  exports?: string[]
  required?: string[]
  optional?: string[]
}): PluginCapabilityDeclaration {
  return parsePluginCapabilityDeclaration({
    exports: (input.exports ?? []).map((id) => ({
      docs: { request: "No fields.", response: "No fields.", summary: `Provides ${id}.` },
      id,
      inputSchema: schema,
      operation: "capability.invoke",
      outputSchema: schema,
      sideEffect: "execute",
      version: "1.0.0",
    })),
    imports: {
      required: (input.required ?? []).map((id) => ({
        id,
        inputSchema: schema,
        outputSchema: schema,
        version: { minimum: "1.0.0", maximumExclusive: "2.0.0" },
      })),
      optional: (input.optional ?? []).map((id) => ({
        id,
        inputSchema: schema,
        outputSchema: schema,
        version: { minimum: "1.0.0", maximumExclusive: "2.0.0" },
      })),
    },
  })
}

function plugins(): readonly PublishedPluginCapabilityContract[] {
  return [
    {
      identity: { pluginId: "caller", pluginVersion: "1.0.0", snapshotDigest: digest("a") },
      capabilities: declaration({ required: ["media.render"] }),
    },
    {
      identity: { pluginId: "provider", pluginVersion: "1.0.0", snapshotDigest: digest("b") },
      capabilities: declaration({ exports: ["media.render"] }),
    },
  ]
}

describe("published Plugin capability topology", () => {
  test("contains no pointer revision or ActiveSet digest and projects them only at runtime", () => {
    const result = planPluginCapabilityTopology(plugins())
    expect(result.ok).toBeTrue()
    if (!result.ok) return
    expect(JSON.stringify(result.topology.descriptor)).not.toContain("activeRevision")
    expect(JSON.stringify(result.topology.descriptor)).not.toContain("activeSetDigest")
    expect(result.topology.topologyDigest).toMatch(/^[a-f0-9]{64}$/)

    const first = projectPluginCapabilityTopology(
      result.topology,
      { revision: 3, activeSetDigest: digest("c") },
      plugins(),
    )
    const second = projectPluginCapabilityTopology(
      result.topology,
      { revision: 9, activeSetDigest: digest("d") },
      plugins(),
    )
    expect(first.bindingDigest).toBe(second.bindingDigest)
    expect(first.activeRevision).toBe(3)
    expect(second.activeRevision).toBe(9)
    expect(first.activeSetDigest).not.toBe(second.activeSetDigest)
  })

  test("recomputes provider selection and rejects persisted topology drift", () => {
    const result = planPluginCapabilityTopology(plugins())
    if (!result.ok) throw new Error("Invalid fixture")
    expect(verifyPluginCapabilityTopology(result.topology, plugins())).toBeTrue()
    const changed = {
      ...result.topology,
      descriptor: {
        ...result.topology.descriptor,
        bindings: result.topology.descriptor.bindings.map((binding) => ({
          ...binding,
          provider: binding.provider ? { ...binding.provider, snapshotDigest: digest("f") } : null,
        })),
      },
    }
    expect(verifyPluginCapabilityTopology(changed, plugins())).toBeFalse()
  })

  test("rejects a version-compatible provider whose closed schemas differ from the caller import", () => {
    const caller = parsePluginCapabilityDeclaration({
      exports: [],
      imports: {
        optional: [],
        required: [
          {
            id: "media.render",
            inputSchema: {
              additionalProperties: false,
              properties: { text: { maxLength: 64, type: "string" } },
              required: ["text"],
              type: "object",
            },
            outputSchema: schema,
            version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
          },
        ],
      },
    })
    const result = planPluginCapabilityTopology([
      {
        identity: { pluginId: "caller", pluginVersion: "1.0.0", snapshotDigest: digest("a") },
        capabilities: caller,
      },
      {
        identity: { pluginId: "provider", pluginVersion: "1.0.0", snapshotDigest: digest("b") },
        capabilities: declaration({ exports: ["media.render"] }),
      },
    ])
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          capabilityId: "media.render",
          callerPluginId: "caller",
          code: "required-provider-incompatible",
          providerPluginIds: ["provider"],
        },
      ],
    })
  })
})
