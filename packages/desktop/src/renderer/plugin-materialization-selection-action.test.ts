import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createCanvasSelectionActionContext } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"

import { parseWebPluginManifest } from "../plugin-contracts"
import {
  canRunPluginMaterialization,
  listInstalledPluginMaterializationActions,
} from "./plugin-materialization-selection-action"

function plugin() {
  return {
    ...parseWebPluginManifest({
      capabilities: ["canvas.connectedMedia.stream"],
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
      hostApi: {
        major: 1,
        optional: ["canvas.inputs.open", "canvas.inputs.close"],
        required: ["host.context.get"],
      },
      id: "timeline",
      name: "Timeline",
      schema: "convax.plugin/8",
      version: "1.0.0",
    }),
    activeRevision: 1,
    activeSetDigest: "a".repeat(64),
    snapshotDigest: "b".repeat(64),
  }
}

describe("Plugin materialization selection action", () => {
  test("projects only installed v8 own-renderer actions and requires one managed Project video", () => {
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

  test("legacy manifests do not gain the materialization variant", () => {
    const legacy = { ...plugin(), schema: "convax.plugin/7" } as unknown as ReturnType<typeof plugin>
    expect(listInstalledPluginMaterializationActions([legacy])).toEqual([])
  })
})
