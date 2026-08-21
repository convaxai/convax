import { describe, expect, mock, test } from "bun:test"
import type { PortableBoundedValueSchemaV1 } from "@convax/plugin-sdk"

import { webPluginManifestSchemaV8, webPluginManifestSchemaV9 } from "../plugin-contracts"
import { PluginSurfaceService } from "./plugin-surface-service"
import { PluginStateSchemaAuthorityV1, type PluginStateSchemaRuntimePort } from "./plugin-state-schema-authority"

const schema = Object.freeze({
  type: "object" as const,
  maxProperties: "1",
  required: Object.freeze([] as const),
  properties: Object.freeze({}),
  additionalProperties: false as const,
}) satisfies PortableBoundedValueSchemaV1

const identity = Object.freeze({
  activeRevision: 3,
  activeSetDigest: "a".repeat(64),
  pluginId: "surface-plugin",
  snapshotDigest: "b".repeat(64),
  version: "2.0.0",
})

describe("PluginSurfaceService", () => {
  test("creates through Canvas using only lease-derived Plugin fields", async () => {
    const assertCurrentActivePlugin = mock(async () => undefined)
    const execute = mock(async (request: any) => {
      await request.beforeCommit?.()
      expect(request.envelope.command).toMatchObject({
        type: "plugin.surface.create",
        label: "Surface Plugin",
        plugin: {
          id: identity.pluginId,
          snapshotDigest: identity.snapshotDigest,
          state: {},
        },
        size: { width: 640, height: 420 },
      })
      const command = request.envelope.command as {
        plugin: { pluginStateSchemaDigest: string; validationArtifact: { artifactDigest: string } }
      }
      expect(command.plugin.pluginStateSchemaDigest).toBe(command.plugin.validationArtifact.artifactDigest)
      return {
        affectedNodeIds: ["node-1"],
        changed: true,
        createdNodeIds: ["node-1"],
        document: { id: "canvas", nodes: [], edges: [] },
        operationReceipt: { operationId: "op" },
        warnings: [],
      }
    })
    const schemas = new PluginStateSchemaAuthorityV1(unusedRuntime())
    const service = new PluginSurfaceService({
      application: { execute } as any,
      plugins: {
        acquireActivePlugin: mock(async () => ({
          identity,
          plugin: installedPlugin(schema, webPluginManifestSchemaV9),
          release: mock(() => undefined),
        })),
        assertCurrentActivePlugin,
      },
      schemas,
    })

    const result = await service.create({
      canvasId: "canvas-1",
      pluginId: identity.pluginId,
      projectId: "project-1",
    })

    expect(result.createdNodeId).toBe("node-1")
    expect(assertCurrentActivePlugin).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test("rejects requests with extra fields or missing schema", async () => {
    const schemas = new PluginStateSchemaAuthorityV1(unusedRuntime())
    const service = new PluginSurfaceService({
      application: {
        execute: async () => {
          throw new Error("should not execute")
        },
      } as any,
      plugins: {
        acquireActivePlugin: async () => ({
          identity,
          plugin: installedPlugin(undefined),
          release() {},
        }),
        assertCurrentActivePlugin: async () => undefined,
      },
      schemas,
    })

    await expect(
      service.create({
        canvasId: "canvas-1",
        pluginId: identity.pluginId,
        projectId: "project-1",
        // @ts-expect-error intentional extra field
        snapshotDigest: "c".repeat(64),
      }),
    ).rejects.toThrow("only projectId, canvasId, and pluginId")

    await expect(
      service.create({
        canvasId: "canvas-1",
        pluginId: identity.pluginId,
        projectId: "project-1",
      }),
    ).rejects.toThrow("state schema artifact is unavailable")
  })

  test("stale lease before commit performs zero Canvas write", async () => {
    let executeCalls = 0
    const schemas = new PluginStateSchemaAuthorityV1(unusedRuntime())
    const service = new PluginSurfaceService({
      application: {
        execute: async (request: any) => {
          executeCalls += 1
          await request.beforeCommit?.()
          return {
            affectedNodeIds: ["node-1"],
            changed: true,
            createdNodeIds: ["node-1"],
            document: { id: "canvas", nodes: [], edges: [] },
            operationReceipt: { operationId: "op" },
            warnings: [],
          }
        },
      } as any,
      plugins: {
        acquireActivePlugin: async () => ({
          identity,
          plugin: installedPlugin(schema),
          release() {},
        }),
        assertCurrentActivePlugin: async () => {
          throw new Error("ActiveSet lease became stale")
        },
      },
      schemas,
    })

    await expect(
      service.create({
        canvasId: "canvas-1",
        pluginId: identity.pluginId,
        projectId: "project-1",
      }),
    ).rejects.toThrow("ActiveSet lease became stale")
    expect(executeCalls).toBe(0)
  })
})

function installedPlugin(
  stateSchema: PortableBoundedValueSchemaV1 | undefined,
  manifestSchema: typeof webPluginManifestSchemaV8 | typeof webPluginManifestSchemaV9 = webPluginManifestSchemaV8,
) {
  return {
    schema: manifestSchema,
    hostApi: { required: [], optional: [] },
    id: identity.pluginId,
    name: "Surface Plugin",
    version: identity.version,
    entry: "index.html",
    contributes: {
      canvas: {
        renderer: {
          create: true,
          ...(stateSchema ? { stateSchema } : {}),
        },
      },
    },
  } as never
}

function unusedRuntime(): PluginStateSchemaRuntimePort {
  return {
    acquirePluginSnapshot: async () => {
      throw new Error("unexpected")
    },
    acquireActivePluginSet: async () => {
      throw new Error("unexpected")
    },
  }
}
