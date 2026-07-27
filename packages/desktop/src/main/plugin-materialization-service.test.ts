import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas/core"

import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginMaterializationService } from "./plugin-materialization-service"
import type { WebPluginManager } from "./plugin-manager"

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
    id: "timeline-surface",
    name: "Timeline Surface",
    schema: "convax.plugin/7",
    version,
  })
}

describe("PluginMaterializationService", () => {
  test("derives its own renderer under the publication lock and sends one revision-bound business command", async () => {
    const plugin = materializationPlugin()
    const execute = mock(async (request: Parameters<PluginMaterializationService["materialize"]>[0] | any) => {
      const node = request.envelope.command.node
      return {
        createdNodeIds: [node.id],
        document: { ...createCanvasDocument({ id: "canvas-1" }), revision: 8 },
      }
    })
    const withPluginMutation = mock(async (_pluginId: string, operation: (mutation: unknown) => Promise<unknown>) =>
      operation({ pluginId: "timeline-surface" }),
    )
    const plugins = {
      resolveCapabilityIdentity: mock(async () => ({ digest: "a".repeat(64), plugin })),
      withPluginMutation,
    } as unknown as Pick<WebPluginManager, "resolveCapabilityIdentity" | "withPluginMutation">
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
    expect(withPluginMutation).toHaveBeenCalledTimes(1)
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
      resolveCapabilityIdentity: async () => ({ digest: "b".repeat(64), plugin }),
      withPluginMutation: async (_id: string, operation: (mutation: unknown) => Promise<unknown>) => operation({}),
    } as unknown as Pick<WebPluginManager, "resolveCapabilityIdentity" | "withPluginMutation">
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
})
