import { describe, expect, test } from "bun:test"
import { parseUint64 } from "@convax/collaboration"
import {
  constructCanvasAuthoritativeIntentV2,
  type CanvasPluginCreationGroupCommandV2,
} from "./command-construction"
import { applyCanvasCandidateIntentV2 } from "./reducer"
import type { CanvasResourceProofRefV2, PluginRequirementV2, PluginStateEnvelopeV2 } from "./types"
import {
  applyOk,
  context,
  createAgent,
  createPendingFile,
  digest,
  fork,
  newCanvas,
  nodeLiveGuard,
  VALID_FACTS,
} from "./test-fixtures.test"
import { validateCanvasYDocV2 } from "./ydoc"

describe("Canvas v2 authoritative command construction", () => {
  test("constructs UI geometry, Agent create/connect, and Plugin creation-group guards in the Canvas owner", () => {
    const document = newCanvas()
    const source = createAgent(document, context(1, 1, 1), "Source")
    const target = createAgent(document, context(1, 2, 2), "Target")

    const geometryContext = context(1, 3, 3)
    const geometry = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: geometryContext,
        command: {
          kind: "renderer",
          command: {
            format: "convax.canvas-renderer-command/2",
            kind: "canvas.nodes.set-geometry/2",
            body: { updates: [{ node: source, position: { x: 40, y: 60 } }] },
          },
        },
      }),
    )
    expect(geometry.intent.kind).toBe("canvas.nodes.set-geometry/2")
    applyOk(document, geometryContext, geometry.intent)

    const createContext = context(2, 4, 4)
    const created = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: createContext,
        command: {
          kind: "agent-node-create",
          title: "New agent",
          instructions: null,
          position: { x: 100, y: 100 },
          size: { width: 240, height: 120 },
        },
      }),
    )
    expect(created.intent.kind).toBe("canvas.nodes.create/2")
    applyOk(document, createContext, created.intent)

    const connectContext = context(2, 5, 5)
    const connected = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: connectContext,
        command: { kind: "edge-connect", source, target, label: "input" },
      }),
    )
    expect(connected.intent.kind).toBe("canvas.edges.connect/2")
    applyOk(document, connectContext, connected.intent)

    const plugin = pluginRequirement()
    applyOk(document, context(3, 29, 5), {
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.set-plugin-state/2",
      guard: {
        node: {
          ...nodeLiveGuard(document, target),
          expectedPluginDigest: null,
          requirement: plugin,
        },
      },
      body: {
        node: target,
        plugin: { format: "convax.canvas-plugin-state/2", ...plugin, state: { selected: false } },
      },
    })
    const stateContext = context(3, 6, 6)
    const state = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: stateContext,
        command: {
          kind: "plugin-state-set",
          node: target,
          owner: plugin,
          plugin: { format: "convax.canvas-plugin-state/2", ...plugin, state: { selected: true } },
        },
      }),
    )
    expect(state.intent.kind).toBe("canvas.nodes.set-plugin-state/2")
    expect(state.dependencies.validationArtifacts).toEqual([plugin.validationArtifact])
    applyOk(document, stateContext, state.intent)
    const otherOwner = { ...plugin, pluginId: "plugin.other" }
    expect(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: context(3, 30, 7),
        command: {
          kind: "plugin-state-set",
          node: target,
          owner: otherOwner,
          plugin: { format: "convax.canvas-plugin-state/2", ...otherOwner, state: { selected: true } },
        },
      }),
    ).toBe("rejected")

    const pluginContext = context(3, 7, 7)
    const group = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: pluginContext,
        command: pluginCreationGroup(source, plugin),
      }),
    )
    expect(group.intent.kind).toBe("canvas.plugin.creation-group.create/2")
    expect(group.dependencies.validationArtifacts).toEqual([plugin.validationArtifact])
    applyOk(document, pluginContext, group.intent)
  })

  test("relink ignores concurrent layout but rejects concurrent content replacement and delete", () => {
    const base = newCanvas()
    const node = createPendingFile(base, context(1, 10, 1), "Image")
    const relinkContext = context(1, 11, 2)
    const relink = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(base),
        context: relinkContext,
        command: { kind: "resource-relink", node, title: "Replacement", proof: resourceProof("a") },
      }),
    )
    expect(relink.intent.kind).toBe("canvas.nodes.update-data/2")
    expect(relink.dependencies.externalFacts).toHaveLength(1)

    const layoutBranch = fork(base)
    const layoutContext = context(2, 12, 3)
    const layout = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(layoutBranch),
        context: layoutContext,
        command: {
          kind: "renderer",
          command: {
            format: "convax.canvas-renderer-command/2",
            kind: "canvas.nodes.set-geometry/2",
            body: { updates: [{ node, position: { x: 500, y: 600 } }] },
          },
        },
      }),
    )
    applyOk(layoutBranch, layoutContext, layout.intent)
    expect(applyCanvasCandidateIntentV2(layoutBranch, relinkContext, relink.intent, VALID_FACTS)).not.toBe("rejected")

    const contentBranch = fork(base)
    const otherContext = context(2, 13, 3)
    const other = requireConstruction(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(contentBranch),
        context: otherContext,
        command: { kind: "resource-relink", node, title: "Other content", proof: resourceProof("b") },
      }),
    )
    applyOk(contentBranch, otherContext, other.intent)
    expect(applyCanvasCandidateIntentV2(contentBranch, relinkContext, relink.intent, VALID_FACTS)).toBe("rejected")

    const deletedBranch = fork(base)
    applyOk(deletedBranch, context(2, 14, 3), {
      format: "convax.typed-intent/2",
      kind: "canvas.elements.remove/2",
      guard: { nodes: [nodeLiveGuard(deletedBranch, node)], edges: [], requireObservedIncidentEdgeClosure: true },
      body: { nodes: [node], edges: [] },
    })
    expect(applyCanvasCandidateIntentV2(deletedBranch, relinkContext, relink.intent, VALID_FACTS)).toBe("rejected")
  })

  test("rejects a stale incarnation before constructing a renderer command", () => {
    const document = newCanvas()
    const node = createAgent(document, context(1, 20, 1))
    expect(
      constructCanvasAuthoritativeIntentV2({
        snapshot: validateCanvasYDocV2(document),
        context: context(1, 21, 2),
        command: {
          kind: "renderer",
          command: {
            format: "convax.canvas-renderer-command/2",
            kind: "canvas.nodes.set-geometry/2",
            body: { updates: [{ node: { ...node, incarnation: `${node.incarnation}-stale` }, position: { x: 1, y: 2 } }] },
          },
        },
      }),
    ).toBe("rejected")
  })
})

function requireConstruction(value: ReturnType<typeof constructCanvasAuthoritativeIntentV2>) {
  if (value === "rejected") throw new Error("Canvas intent construction unexpectedly rejected")
  return value
}

function resourceProof(seed: "a" | "b"): Extract<CanvasResourceProofRefV2, { mode: "current-owner-state" }> {
  const ownerProofDigest = digest(seed === "a" ? 40 : 41)
  return {
    format: "convax.canvas-resource-proof-ref/2",
    mode: "current-owner-state",
    resource: {
      format: "convax.canvas-resource-ref/2",
      uri:
        `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
        `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${(seed === "a" ? "1" : "2").repeat(64)}` +
        `?blob=sha256%3A${seed.repeat(64)}&path=Generated%2Fimage.png`,
      mediaClass: "image",
      mime: "image/png",
      byteLength: parseUint64("12"),
      contentDigest: digest(seed === "a" ? 42 : 43),
      ownerProofDigest,
    },
    ownerProofDigest,
    requireCurrentLiveVersion: true,
  }
}

function pluginRequirement(): PluginRequirementV2 {
  return {
    pluginId: "plugin.image",
    snapshotDigest: digest(50),
    pluginStateSchemaDigest: digest(51),
    validationArtifact: {
      owner: "plugin",
      format: "convax.plugin-validation-artifact/2",
      artifactDigest: digest(52),
    },
  }
}

function pluginCreationGroup(
  source: ReturnType<typeof createAgent>,
  requirement: PluginRequirementV2,
): CanvasPluginCreationGroupCommandV2 {
  const plugin: PluginStateEnvelopeV2 = {
    format: "convax.canvas-plugin-state/2",
    ...requirement,
    state: { task: "render" },
  }
  return {
    kind: "plugin-creation-group",
    source,
    plugin: requirement,
    nodes: [
      {
        role: "agent",
        position: { x: 300, y: 0 },
        size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data/2", kind: "agent", title: "Result", instructions: null },
        plugin,
      },
    ],
    edges: [
      {
        source: { mode: "existing", ref: source },
        target: { mode: "created", nodeIndex: 0 },
        label: null,
      },
    ],
  }
}
