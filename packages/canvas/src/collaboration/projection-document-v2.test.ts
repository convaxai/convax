import { describe, expect, test } from "bun:test"
import type { CanvasProjectionV2, Digest } from "./types"
import {
  canvasProjectionPluginIdentityMetadataKeyV2,
  canvasProjectionPluginStateMetadataKeyV2,
  canvasProjectionResourceMetadataKeyV2,
  projectCanvasDocumentV2,
} from "./projection"

const digest = (value: string) => value.repeat(64).slice(0, 64) as Digest

function projection(): CanvasProjectionV2 {
  return {
    identity: {
      format: "convax.canvas.v2",
      scopeId: digest("a"),
      canvasId: "canvas-1" as CanvasProjectionV2["identity"]["canvasId"],
      ownerSchemaDigest: digest("b"),
      protocolDigest: digest("c"),
      canonicalizerDigest: digest("d"),
      projectIndexRouteDependencyFrameDigest: digest("e"),
      genesisDigest: digest("f"),
    },
    title: "Shared canvas",
    description: "Projected from the owner document",
    tags: ["team"],
    nodes: [
      {
        ref: { kind: "node", id: "source", incarnation: "source-v1" },
        role: "file",
        position: { x: 10, y: 20 },
        size: { width: 320, height: 240 },
        data: {
          format: "convax.canvas-node-data/2",
          kind: "resource",
          title: "Image",
          resource: {
            format: "convax.canvas-resource-ref/2",
            uri:
              `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
              `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${"1".repeat(64)}` +
              `?blob=sha256%3A${"a".repeat(64)}&path=Generated%2Fimage.png`,
            mediaClass: "image",
            mime: "image/png",
            byteLength: 12 as CanvasProjectionV2["nodes"][number]["data"] extends { kind: "resource" }
              ? CanvasProjectionV2["nodes"][number]["data"]["resource"]["byteLength"]
              : never,
            contentDigest: digest("a"),
            ownerProofDigest: digest("b"),
          },
        },
        plugin: {
          format: "convax.canvas-plugin-state/2",
          pluginId: "diagram",
          snapshotDigest: digest("c"),
          pluginStateSchemaDigest: digest("d"),
          validationArtifact: {
            owner: "plugin",
            format: "convax.plugin-validation-artifact/2",
            artifactDigest: digest("e"),
          },
          state: { color: "blue" },
        },
        parent: null,
        generationLifecycle: "none",
      },
      {
        ref: { kind: "node", id: "target", incarnation: "target-v1" },
        role: "agent",
        position: { x: 400, y: 20 },
        size: { width: 420, height: 520 },
        data: {
          format: "convax.canvas-node-data/2",
          kind: "agent",
          title: "Writer",
          instructions: "Draft the copy",
        },
        plugin: null,
        parent: null,
        generationLifecycle: "none",
      },
    ],
    edges: [
      {
        ref: { kind: "edge", id: "edge-1", incarnation: "edge-v1" },
        source: { kind: "node", id: "source", incarnation: "source-v1" },
        target: { kind: "node", id: "target", incarnation: "target-v1" },
        data: { format: "convax.canvas-edge-data/2", kind: "business", label: "input" },
      },
    ],
  }
}

describe("Canvas v2 renderer document projection", () => {
  test("keeps URI, Plugin display state, geometry, and exact node incarnation in Canvas-owned mapping", () => {
    const projected = projectCanvasDocumentV2(projection())
    const source = projected.document.nodes[0]!

    expect(projected.document).toMatchObject({
      id: "canvas-1",
      metadata: { title: "Shared canvas", description: "Projected from the owner document", tags: ["team"] },
      edges: [{ id: "edge-1", source: "source", target: "target", data: { label: "input" } }],
    })
    expect(source).toMatchObject({
      id: "source",
      type: "file",
      position: { x: 10, y: 20 },
      style: { width: 320, height: 240 },
      data: {
        kind: "plugin.diagram",
        label: "Image",
        metadata: {
          [canvasProjectionPluginIdentityMetadataKeyV2]: {
            id: "diagram",
            snapshotDigest: digest("c"),
            pluginStateSchemaDigest: digest("d"),
          },
          [canvasProjectionPluginStateMetadataKeyV2]: { color: "blue" },
          [canvasProjectionResourceMetadataKeyV2]: {
            uri: projection().nodes[0]!.data.kind === "resource" ? projection().nodes[0]!.data.resource.uri : "",
          },
        },
        resourceState: { status: "stale", mediaType: "image/png", name: "Image" },
      },
    })
    expect(projected.nodeEntities.get("source")).toEqual({
      kind: "node",
      id: "source",
      incarnation: "source-v1",
    })
    expect(source.data.metadata?.[canvasProjectionPluginIdentityMetadataKeyV2]).not.toHaveProperty("validationArtifact")
  })

  test("fails closed when two live incarnations collapse to one React Flow id", () => {
    const value = projection()
    expect(() =>
      projectCanvasDocumentV2({
        ...value,
        nodes: [...value.nodes, { ...value.nodes[1]!, ref: { kind: "node", id: "source", incarnation: "source-v2" } }],
      }),
    ).toThrow("duplicate live node id source")
  })

  test("projects a manual pending image as an idle empty card instead of an active generation", () => {
    const value = projection()
    const projected = projectCanvasDocumentV2({
      ...value,
      nodes: [
        {
          ref: { kind: "node", id: "manual-image", incarnation: "manual-image-v1" },
          role: "file",
          position: { x: 10, y: 20 },
          size: { width: 320, height: 240 },
          data: {
            format: "convax.canvas-node-data/2",
            kind: "placeholder",
            owner: "manual-pending",
            title: "Image",
            expectedClass: "image",
            state: { phase: "pending" },
          },
          plugin: null,
          parent: null,
          generationLifecycle: "none",
        },
      ],
      edges: [],
    })

    expect(projected.document.nodes[0]).toMatchObject({
      data: {
        kind: "image",
        label: "Image",
        metadata: {},
        status: "idle",
      },
    })
  })
})
