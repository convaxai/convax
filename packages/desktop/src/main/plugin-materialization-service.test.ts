import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas/core"

import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginMaterializationService } from "./plugin-materialization-service"

function materializationPlugin(version = "1.0.0") {
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
      major: 1,
      optional: ["canvas.inputs.list", "canvas.inputs.open", "canvas.inputs.close"],
      required: ["host.context.get"],
    },
    id: "timeline-surface",
    name: "Timeline Surface",
    schema: "convax.plugin/8",
    version,
  })
}

describe("PluginMaterializationService", () => {
  test("derives its own renderer under one snapshot lease and sends one revision-bound business command", async () => {
    const plugin = materializationPlugin()
    const execute = mock(async (request: Parameters<PluginMaterializationService["materialize"]>[0] | any) => {
      const node = request.envelope.command.node
      return {
        createdNodeIds: [node.id],
        document: { ...createCanvasDocument({ id: "canvas-1" }), revision: 8 },
      }
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
      expectedRevision: 7,
      pluginId: "timeline-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    })

    expect(result.revision).toBe(8)
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
        expectedRevision: 7,
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
      expectedRevision: 1,
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
      return {
        createdNodeIds: [request.envelope.command.node.id],
        document: { ...createCanvasDocument({ id: "canvas-1" }), revision: 2 },
      }
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
      expectedRevision: 1,
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
        expectedRevision: 1,
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
