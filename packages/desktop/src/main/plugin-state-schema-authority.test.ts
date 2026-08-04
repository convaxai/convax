import { describe, expect, test } from "bun:test"
import {
  canonicalPortablePluginStateSchemaBytesV1,
  type PortableBoundedValueSchemaV1,
} from "@convax/plugin-sdk"

import type { PluginPrincipal } from "../plugin-capability-contracts"
import {
  PluginStateSchemaAuthorityV1,
  type PluginStateSchemaRuntimePort,
} from "./plugin-state-schema-authority"

const schema = Object.freeze({
  type: "object" as const,
  maxProperties: "1",
  required: Object.freeze(["enabled"]),
  properties: Object.freeze({ enabled: Object.freeze({ type: "boolean" as const }) }),
  additionalProperties: false as const,
}) satisfies PortableBoundedValueSchemaV1

const principal = Object.freeze({
  activeRevision: 7,
  activeSetDigest: "a".repeat(64),
  manifestDigest: "b".repeat(64),
  pluginId: "stateful",
  pluginVersion: "1.2.3",
  runtime: "web" as const,
  snapshotDigest: "c".repeat(64),
}) satisfies PluginPrincipal

describe("PluginStateSchemaAuthorityV1", () => {
  test("derives authority only from the exact immutable principal closure", async () => {
    let released = false
    const acquired: unknown[] = []
    const authority = new PluginStateSchemaAuthorityV1({
      async acquirePluginSnapshot(identity) {
        acquired.push(identity)
        return {
          plugin: { contributes: { canvas: { renderer: { stateSchema: schema } } } },
          release: () => (released = true),
        } as never
      },
      acquireActivePluginSet: unexpected,
    })

    const resolved = await authority.resolvePrincipal(principal)

    expect(acquired).toEqual([
      {
        activeRevision: principal.activeRevision,
        activeSetDigest: principal.activeSetDigest,
        pluginId: principal.pluginId,
        pluginVersion: principal.pluginVersion,
        snapshotDigest: principal.snapshotDigest,
      },
    ])
    expect(released).toBe(true)
    if (!resolved) throw new Error("state schema was not resolved")
    expect(resolved.validationArtifact).toEqual({
      owner: "plugin",
      format: "convax.plugin-state-schema/1",
      artifactDigest: resolved.pluginStateSchemaDigest,
    })
    expect(resolved.pluginStateSchemaDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(authority.resolveArtifact(resolved.validationArtifact)).toMatchObject({ status: "resolved" })
    expect(() => authority.validateState(resolved, { enabled: true })).not.toThrow()
    expect(() => authority.validateState(resolved, { enabled: "yes" })).toThrow("boolean")
  })

  test("fails closed for a missing declaration and verifies replicated exact bytes", async () => {
    const authority = new PluginStateSchemaAuthorityV1(runtimeWithSchema(undefined))
    expect(await authority.resolvePrincipal(principal)).toBeNull()

    const source = new PluginStateSchemaAuthorityV1(runtimeWithSchema(schema))
    const resolved = await source.resolvePrincipal(principal)
    const ref = resolved!.validationArtifact
    expect(authority.resolveArtifact(ref)).toEqual({ status: "pending", ref })
    expect(authority.admitExactArtifact(ref, canonicalPortablePluginStateSchemaBytesV1(schema))).toBe(true)
    expect(authority.resolveArtifact(ref)).toMatchObject({ status: "resolved", ref })
    expect(
      authority.admitExactArtifact({ ...ref, artifactDigest: "d".repeat(64) as typeof ref.artifactDigest }, resolved!.exactBytes),
    ).toBe(false)
  })
})

function runtimeWithSchema(value: PortableBoundedValueSchemaV1 | undefined): PluginStateSchemaRuntimePort {
  return {
    async acquirePluginSnapshot() {
      return {
        plugin: { contributes: { canvas: { renderer: value === undefined ? {} : { stateSchema: value } } } },
        release() {},
      } as never
    },
    acquireActivePluginSet: unexpected,
  }
}

async function unexpected(): Promise<never> {
  throw new Error("unexpected")
}
