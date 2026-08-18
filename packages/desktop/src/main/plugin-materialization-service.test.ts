import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas/core"

import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginMaterializationService } from "./plugin-materialization-service"

function materializationPlugin(version = "1.0.0", schema: "convax.plugin/8" | "convax.plugin/9" = "convax.plugin/8") {
  return parseWebPluginManifest({
    capabilities: ["canvas.connectedInputs.read", "canvas.node.read", "canvas.node.write"],
    contributes: {
      canvas: {
        renderer: { create: true, height: 760, width: 1120 },
        selectionActions: [
          {
            action: { connect: "selection-to-created", type: "materialize-own-plugin-node" },
            description: { default: "Create a timeline" },
            id: "create-timeline",
            target: "video",
            title: { default: "Create Timeline" },
          },
        ],
      },
    },
    description: "Timeline surface",
    entry: "index.html",
    hostApi: {
      major: 3,
      optional: ["canvas.inputs.list", "canvas.inputs.open", "canvas.inputs.close"],
      required: ["host.context.get"],
    },
    id: "timeline-surface",
    name: "Timeline Surface",
    schema,
    version,
  })
}

describe("PluginMaterializationService", () => {
  const operationReceipt = (operationId: string) => ({ actorId: "timeline-surface", operationId }) as never
  const commandResult = (canvasId: string, createdNodeIds: string[], operationId: string) => ({
    createdNodeIds,
    document: createCanvasDocument({ id: canvasId }),
    operationReceipt: operationReceipt(operationId),
  })

  test("derives its own renderer under one snapshot lease and sends one business command", async () => {
    const plugin = materializationPlugin("1.0.0", "convax.plugin/9")
    const execute = mock(async (request: Parameters<PluginMaterializationService["materialize"]>[0] | any) => {
      const node = request.envelope.command.node
      return commandResult("canvas-1", [node.id], "materialize-1")
    })
    const release = mock(() => undefined)
    const assertCurrentActivePlugin = mock(async () => undefined)
    const plugins = {
      acquireActivePlugin: mock(async () => ({
        identity: {
          activeRevision: 1,
          activeSetDigest: "b".repeat(64),
          pluginId: plugin.id,
          snapshotDigest: "c".repeat(64),
          version: plugin.version,
        },
        plugin,
        release,
      })),
      assertCurrentActivePlugin,
    }
    const service = new PluginMaterializationService({ application: { execute } as any, plugins })

    const result = await service.materialize({
      actionId: "create-timeline",
      canvasId: "canvas-1",
      pluginId: "timeline-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    })

    expect(result.operationReceipt).toEqual(operationReceipt("materialize-1"))
    expect(result.projection).toEqual(createCanvasDocument({ id: "canvas-1" }))
    expect(plugins.acquireActivePlugin).toHaveBeenCalledTimes(1)
    expect(assertCurrentActivePlugin).toHaveBeenCalledWith({
      activeRevision: 1,
      activeSetDigest: "b".repeat(64),
      pluginId: plugin.id,
      snapshotDigest: "c".repeat(64),
      version: plugin.version,
    })
    expect(release).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    const request = execute.mock.calls[0]![0] as any
    expect(request).toMatchObject({
      canvasId: "canvas-1",
      envelope: {
        actor: { id: "timeline-surface@1.0.0", kind: "plugin" },
        command: {
          sourceKind: "video",
          sourceNodeId: "video-1",
          type: "nodes.materialize-connected",
        },
      },
      scopeId: "project-1",
    })
    expect(request.envelope.command.node).toMatchObject({
      data: {
        kind: "plugin.timeline-surface",
        metadata: {
          convaxPlugin: { entry: "index.html", id: "timeline-surface", version: "1.0.0" },
          convaxPluginState: {},
        },
      },
      style: { height: 760, width: 1120 },
      type: "file",
    })
  })

  test("rejects stale installed versions and unavailable declared actions before Canvas mutation", async () => {
    const execute = mock(async () => {
      throw new Error("must not execute")
    })
    let plugin = materializationPlugin("2.0.0")
    const plugins = {
      acquireActivePlugin: async () => ({
        identity: {
          activeRevision: 1,
          activeSetDigest: "c".repeat(64),
          pluginId: plugin.id,
          snapshotDigest: "d".repeat(64),
          version: plugin.version,
        },
        plugin,
        release() {},
      }),
      assertCurrentActivePlugin: async () => undefined,
    }
    const service = new PluginMaterializationService({ application: { execute } as any, plugins })
    const request = {
      actionId: "create-timeline",
      canvasId: "canvas-1",
      pluginId: "timeline-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    }
    await expect(service.materialize(request)).rejects.toThrow("Plugin changed")

    plugin = parseWebPluginManifest({
      ...materializationPlugin(),
      contributes: { canvas: { renderer: { create: true } } },
    })
    await expect(service.materialize(request)).rejects.toThrow("action is unavailable")
    expect(execute).not.toHaveBeenCalled()
  })

  test("retains the exact ActiveSet lease through the Canvas mutation boundary", async () => {
    const plugin = materializationPlugin()
    let released = false
    const execute = mock(async (request: any) => {
      expect(released).toBeFalse()
      return commandResult("canvas-1", [request.envelope.command.node.id], "materialize-2")
    })
    const plugins = {
      acquireActivePlugin: async () => ({
        identity: {
          activeRevision: 4,
          activeSetDigest: "a".repeat(64),
          pluginId: plugin.id,
          snapshotDigest: "c".repeat(64),
          version: plugin.version,
        },
        plugin,
        release() {
          released = true
        },
      }),
      assertCurrentActivePlugin: async () => {
        expect(released).toBeFalse()
      },
    }
    const service = new PluginMaterializationService({ application: { execute } as any, plugins })

    await service.materialize({
      actionId: "create-timeline",
      canvasId: "canvas-1",
      pluginId: "timeline-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(released).toBeTrue()
  })

  test("fails stale when update or uninstall wins immediately before Canvas persistence", async () => {
    const plugin = materializationPlugin()
    const execute = mock(async () => {
      throw new Error("must not execute")
    })
    const release = mock(() => undefined)
    const identity = {
      activeRevision: 4,
      activeSetDigest: "a".repeat(64),
      pluginId: plugin.id,
      snapshotDigest: "c".repeat(64),
      version: plugin.version,
    }
    const assertCurrentActivePlugin = mock(async () => {
      throw new Error("Active Plugin set changed before final mutation")
    })
    const service = new PluginMaterializationService({
      application: { execute } as any,
      plugins: {
        acquireActivePlugin: async () => ({ identity, plugin, release }),
        assertCurrentActivePlugin,
      },
    })

    await expect(
      service.materialize({
        actionId: "create-timeline",
        canvasId: "canvas-1",
        pluginId: plugin.id,
        pluginVersion: plugin.version,
        projectId: "project-1",
        sourceNodeId: "video-1",
      }),
    ).rejects.toThrow("Active Plugin set changed")
    expect(assertCurrentActivePlugin).toHaveBeenCalledWith(identity)
    expect(execute).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
