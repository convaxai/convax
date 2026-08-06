import { describe, expect, test } from "bun:test"
import { parseUint32 } from "@convax/collaboration"
import { adaptCanvasApplicationCommandV2 } from "./application-command-adapter"
import { constructCanvasAuthoritativeIntentV2 } from "./command-construction"
import { createCanvasFileRendererRegistry } from "../file-renderer-registry"
import { buildCanvasProjectionIndexV2, projectCanvasDocumentV2 } from "./projection"
import { applyCanvasCandidateIntentV2 } from "./reducer"
import type { CanvasExternalFactContextV2, CanvasTypedIntentUnionV2, PluginStateEnvelopeV2 } from "./types"
import { canvasEntityKeyV2, derivedNodeRefV2 } from "./validation"
import { encodeCanvasCanonicalStateV2, validateCanvasYDocV2 } from "./ydoc"
import { applyOk, context, createAgent, digest, newCanvas, U0, VALID_FACTS } from "./test-fixtures.test"

const PLUGIN: PluginStateEnvelopeV2 = Object.freeze({
  format: "convax.canvas-plugin-state/2",
  pluginId: "acme.storyboard",
  snapshotDigest: digest(70),
  pluginStateSchemaDigest: digest(71),
  validationArtifact: Object.freeze({
    owner: "plugin",
    format: "convax.plugin-validation-artifact/2",
    artifactDigest: digest(72),
  }),
  state: { board: "empty" },
})

describe("Canvas generic Plugin surface creation", () => {
  test("creates one independent top-level node with Canvas-owned identity and placement", () => {
    const document = newCanvas()
    const operationContext = context(1, 1, 1)
    const node = derivedNodeRefV2(operationContext, U0)
    const result = applyOk(document, operationContext, pluginSurfaceIntent(document, operationContext))

    const snapshot = validateCanvasYDocV2(document)
    const projection = buildCanvasProjectionIndexV2(snapshot).projection
    expect(projection.nodes).toHaveLength(1)
    expect(projection.edges).toEqual([])
    const created = projection.nodes[0]!
    expect(canvasEntityKeyV2(created.ref)).toBe(canvasEntityKeyV2(node))
    expect(created.role).toBe("file")
    expect(created.parent).toBeNull()
    expect(snapshot.nodes.get(canvasEntityKeyV2(node))!.creationGroup).toBeNull()
    expect(created.data).toEqual({
      format: "convax.canvas-node-data/2",
      kind: "plugin-surface",
      title: "Storyboard",
    })
    expect(created.plugin).toEqual(PLUGIN)
    expect(created.position).toEqual({ x: 0, y: 0 })
    expect(result.semanticHistoryRoot).not.toBeNull()
    expect(result.receipt.semanticRoot).toBeTrue()
    expect(result.receipt.intentKind).toBe("canvas.plugin.surface.create")
  })

  test("places a second surface beside the live obstacle instead of overlapping it", () => {
    const document = newCanvas()
    createAgent(document, context(1, 1, 1))
    applyOk(document, context(1, 2, 2), pluginSurfaceIntent(document, context(1, 2, 2)))

    const projection = buildCanvasProjectionIndexV2(validateCanvasYDocV2(document)).projection
    const surface = projection.nodes.find((candidate) => candidate.data.kind === "plugin-surface")!
    expect(surface.position).toEqual({ x: 264, y: 0 })
  })

  test("an unverified Plugin artifact or state writes nothing", () => {
    for (const facts of [rejecting("validatePluginArtifact"), rejecting("validatePluginState")]) {
      const document = newCanvas()
      const before = encodeCanvasCanonicalStateV2(document)
      const operationContext = context(1, 1, 1)
      const outcome = applyCanvasCandidateIntentV2(
        document,
        operationContext,
        pluginSurfaceIntent(document, operationContext),
        facts,
      )
      expect(outcome).toBe("rejected")
      expect(encodeCanvasCanonicalStateV2(document)).toEqual(before)
    }
  })

  test("rejects a caller-selected node id, a second ordinal, and a stale placement", () => {
    const document = newCanvas()
    const operationContext = context(1, 1, 1)
    const foreign = derivedNodeRefV2(context(2, 9, 9), U0)

    const forged = pluginSurfaceIntent(document, operationContext)
    const forgedBody = forged.body as { node: { nodeId: string } }
    forgedBody.node.nodeId = foreign.id
    expect(applyCanvasCandidateIntentV2(document, operationContext, forged, VALID_FACTS)).toBe("rejected")

    const misordinal = pluginSurfaceIntent(document, operationContext)
    ;(misordinal.body as { node: { ordinal: unknown } }).node.ordinal = parseUint32("1")
    expect(applyCanvasCandidateIntentV2(document, operationContext, misordinal, VALID_FACTS)).toBe("rejected")

    const stale = pluginSurfaceIntent(document, operationContext)
    ;(stale.body as { placement: { obstacleProjectionDigest: unknown } }).placement.obstacleProjectionDigest = digest(9)
    expect(applyCanvasCandidateIntentV2(document, operationContext, stale, VALID_FACTS)).toBe("rejected")
  })

  test("projects an installed surface as the Plugin renderer kind and keeps its portable state", () => {
    const document = newCanvas()
    const operationContext = context(1, 1, 1)
    applyOk(document, operationContext, pluginSurfaceIntent(document, operationContext))

    const projection = buildCanvasProjectionIndexV2(validateCanvasYDocV2(document)).projection
    const projected = projectCanvasDocumentV2(projection).document.nodes[0]!
    expect(projected.data.kind).toBe(`plugin.${PLUGIN.pluginId}`)
    expect(projected.data.label).toBe("Storyboard")
    expect(projected.data.metadata).toEqual({
      convaxPlugin: {
        id: PLUGIN.pluginId,
        snapshotDigest: PLUGIN.snapshotDigest,
        pluginStateSchemaDigest: PLUGIN.pluginStateSchemaDigest,
      },
      convaxPluginState: { board: "empty" },
    })

    // Uninstalling only unregisters the renderer. The node keeps its projected
    // kind and portable state while the editor falls back to the unknown file.
    const registry = createCanvasFileRendererRegistry()
    const dispose = registry.register({
      id: `plugin.${PLUGIN.pluginId}`,
      matches: (data) => data.kind === `plugin.${PLUGIN.pluginId}`,
      render: () => null,
    })
    expect(registry.resolve(projected.data)?.id).toBe(`plugin.${PLUGIN.pluginId}`)
    dispose()
    expect(registry.resolve(projected.data)).toBeUndefined()
    expect(projected.data.metadata).toMatchObject({ convaxPluginState: { board: "empty" } })
  })

  test("adapts the Host business command without accepting an id, position, or digest", () => {
    const document = newCanvas()
    const snapshot = validateCanvasYDocV2(document)
    const operationContext = context(1, 1, 1)
    const adaptation = adaptCanvasApplicationCommandV2({
      request: {
        canvasId: "canvas",
        scopeId: "project",
        envelope: {
          actor: { id: "host", kind: "ui" },
          commandId: "command",
          command: {
            type: "plugin.surface.create",
            label: "Storyboard",
            size: { width: 480, height: 320 },
            plugin: {
              id: PLUGIN.pluginId,
              snapshotDigest: PLUGIN.snapshotDigest,
              pluginStateSchemaDigest: PLUGIN.pluginStateSchemaDigest,
              validationArtifact: PLUGIN.validationArtifact,
              state: PLUGIN.state,
            },
          },
        },
      },
      snapshot,
      context: operationContext,
    })
    if (adaptation === "rejected") throw new Error("Plugin surface command was rejected")
    expect(adaptation.command).toEqual({
      kind: "plugin-surface-create",
      title: "Storyboard",
      size: { width: 480, height: 320 },
      plugin: PLUGIN,
    })

    const construction = constructCanvasAuthoritativeIntentV2({
      snapshot,
      context: operationContext,
      command: adaptation.command,
    })
    if (construction === "rejected") throw new Error("Plugin surface intent construction was rejected")
    expect(construction.intent.kind).toBe("canvas.plugin.surface.create")
    expect(construction.dependencies.validationArtifacts).toEqual([PLUGIN.validationArtifact])
    const body = construction.intent.body as { node: { nodeId: string }; placement: { anchor: unknown } }
    expect(body.node.nodeId).toBe(derivedNodeRefV2(operationContext, U0).id)
    expect(body.placement.anchor).toEqual({ x: 0, y: 0 })
  })
})

function pluginSurfaceIntent(
  document: ReturnType<typeof newCanvas>,
  operationContext: ReturnType<typeof context>,
): CanvasTypedIntentUnionV2 {
  const construction = constructCanvasAuthoritativeIntentV2({
    snapshot: validateCanvasYDocV2(document),
    context: operationContext,
    command: {
      kind: "plugin-surface-create",
      title: "Storyboard",
      size: { width: 480, height: 320 },
      plugin: PLUGIN,
    },
  })
  if (construction === "rejected") throw new Error("Fixture Plugin surface construction was rejected")
  return structuredClone(construction.intent)
}

function rejecting(method: keyof CanvasExternalFactContextV2): CanvasExternalFactContextV2 {
  return { ...VALID_FACTS, [method]: () => "invalid" }
}
