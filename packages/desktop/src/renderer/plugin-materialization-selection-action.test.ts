import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createCanvasSelectionActionContext } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"

import { parseWebPluginManifest } from "../plugin-contracts"
import {
  canRunPluginMaterialization,
  listInstalledPluginMaterializationActions,
} from "./plugin-materialization-selection-action"

function plugin(schema: "convax.plugin/6" | "convax.plugin/7" = "convax.plugin/7") {
  return parseWebPluginManifest({
    capabilities: schema === "convax.plugin/7" ? ["canvas.connectedMedia.stream"] : [],
    contributes: {
      canvas: {
        renderer: { create: true },
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
    description: "Timeline",
    entry: "index.html",
    id: "timeline",
    name: "Timeline",
    schema,
    version: "1.0.0",
  })
}

describe("Plugin materialization selection action", () => {
  test("projects only installed v7 own-renderer actions and requires one managed Project video", () => {
    const actions = listInstalledPluginMaterializationActions([plugin()])
    expect(actions).toEqual([
      expect.objectContaining({
        id: "create-timeline",
        pluginId: "timeline",
        pluginVersion: "1.0.0",
      }),
    ])
    const video = {
      data: {
        kind: "video",
        label: "Source",
        metadata: {
          [projectResourceReferenceKey]: {
            kind: "managed-asset",
            mediaType: "video/mp4",
            name: "source.mp4",
            sha256: "a".repeat(64),
          },
        },
        mimeType: "video/mp4",
      },
      id: "video-1",
      position: { x: 0, y: 0 },
      type: "file" as const,
    }
    const document = createCanvasDocument({ nodes: [video] })
    const context = createCanvasSelectionActionContext(document, [video.id], [], new AbortController().signal)
    expect(canRunPluginMaterialization(context, actions[0]!)).toBeTrue()
    expect(
      canRunPluginMaterialization(
        createCanvasSelectionActionContext(document, [], [], new AbortController().signal),
        actions[0]!,
      ),
    ).toBeFalse()
  })

  test("published v6 does not gain the materialization variant", () => {
    expect(() => plugin("convax.plugin/6")).toThrow()
  })
})
