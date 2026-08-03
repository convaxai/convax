import { describe, expect, test } from "bun:test"
import {
  canonicalPortablePluginStateSchemaBytesV1,
  pluginStateSchemaDigestInputV1,
  portablePluginStateSchemaFormat,
} from "@convax/bounded-value"
import { ordinarySha256V2, parseUint32V2, parseUint64V2, type OwnerExternalFactPortV2 } from "@convax/collaboration"
import {
  createCanvasExternalFactContextV2,
  decodeCanvasExternalFactRequestV2,
  discoverCanvasIntentDependenciesV2,
  encodeCanvasExternalFactRequestV2,
  validateCanvasExternalFactResultV2,
} from "./external-facts"
import { effectiveDataDigestV2, projectedGenerationDigestV2 } from "./projection"
import type {
  CanvasExternalFactRequestV2,
  CanvasTypedIntentUnionV2,
  GenerationBeginV2,
  PluginStateEnvelopeV2,
} from "./types"
import { canvasDigestV2, deriveCanvasIdV2, derivedNodeRefV2, makeStampV2 } from "./validation"
import { validateCanvasYDocV2 } from "./ydoc"
import { context, createAgent, digest, id128, newCanvas, nodeDataGuard, SCOPE } from "./test-fixtures.test"

const U0 = parseUint32V2("0")
const U1 = parseUint32V2("1")

describe("Canvas R5 external-fact closure", () => {
  test("round-trips all four closed request kinds as exact restricted JCS", () => {
    const ownerProofDigest = digest(40)
    const resource = {
      format: "convax.canvas-resource-ref/2" as const,
      uri: `convax-project://project/epochs/${id128(41)}/entries/pf_${"1".repeat(64)}`,
      mediaClass: "image" as const,
      mime: "image/png",
      byteLength: parseUint64V2("10"),
      contentDigest: digest(42),
      ownerProofDigest,
    }
    const node = derivedNodeRefV2(context(2, 2, 2), U0)
    const requests: readonly CanvasExternalFactRequestV2[] = [
      {
        format: "convax.canvas-external-fact-request/2",
        kind: "current-resources",
        proofs: [{
          format: "convax.canvas-resource-proof-ref/2",
          mode: "current-owner-state",
          resource,
          ownerProofDigest,
          requireCurrentLiveVersion: true,
        }],
      },
      {
        format: "convax.canvas-external-fact-request/2",
        kind: "retained-resources",
        proofs: [{
          format: "convax.canvas-resource-proof-ref/2",
          mode: "retained-canvas-history",
          sourceState: "history-root-post",
          sourceOperationId: id128(43),
          sourceNode: node,
          sourceDataDigest: digest(44),
          resource,
          requireExactRetainedMaterial: true,
        }],
      },
      {
        format: "convax.canvas-external-fact-request/2",
        kind: "generation-begin",
        scope: SCOPE,
        beginDigest: digest(45),
        beginActorId: context(3, 3, 3).actorId,
        beginAuthorizationEpochDigest: digest(46),
        toolRefDigest: digest(47),
        protocolDigest: context(3, 3, 3).protocolDigest,
      },
      { format: "convax.canvas-external-fact-request/2", kind: "generation-recovery", proofDigest: digest(48) },
    ]
    for (const request of requests) {
      const bytes = encodeCanvasExternalFactRequestV2(request)
      expect(bytes).not.toBe("rejected")
      if (bytes === "rejected") throw new Error("request codec rejected fixture")
      expect(decodeCanvasExternalFactRequestV2(bytes)).toEqual(request)
    }
  })

  test("discovers the exact generation-begin request from intent plus imported context", () => {
    const document = newCanvas()
    const node = createAgent(document, context(1, 1, 1))
    const operationContext = context(2, 2, 2)
    const snapshot = validateCanvasYDocV2(document)
    const begin: GenerationBeginV2 = {
      format: "convax.canvas-generation-begin/2",
      generationId: deriveCanvasIdV2("generation", operationContext, U0),
      node,
      beginActorId: operationContext.actorId,
      beginAuthorizationEpochDigest: digest(50),
      beginStamp: makeStampV2(operationContext, U0),
      outputClaimStamp: makeStampV2(operationContext, U1),
      toolRefDigest: digest(51),
      prompt: "generate",
      targetEffectiveDataDigest: effectiveDataDigestV2(snapshot, snapshot.nodes.values().next().value!),
      targetPluginDigest: null,
    }
    const intent: Extract<CanvasTypedIntentUnionV2, { kind: "canvas.generation.begin/2" }> = {
      format: "convax.typed-intent/2",
      kind: "canvas.generation.begin/2",
      guard: {
        ...nodeDataGuard(document, node),
        expectedPluginDigest: null,
        expectedProjectedGenerationDigest: projectedGenerationDigestV2(snapshot, node),
      },
      body: { begin },
    }
    const dependencies = discoverCanvasIntentDependenciesV2(operationContext, intent)
    expect(dependencies).not.toBe("rejected")
    if (dependencies === "rejected") throw new Error("dependency discovery rejected fixture")
    expect(dependencies.validationArtifacts).toEqual([])
    expect(dependencies.externalFacts).toHaveLength(1)
    const request = decodeCanvasExternalFactRequestV2(dependencies.externalFacts[0]!.request.exactJcs)
    expect(request).toMatchObject({
      kind: "generation-begin",
      scope: operationContext.scope,
      beginDigest: canvasDigestV2("convax.canvas-generation-begin/2", begin),
      beginAuthorizationEpochDigest: begin.beginAuthorizationEpochDigest,
      toolRefDigest: begin.toolRefDigest,
      protocolDigest: operationContext.protocolDigest,
    })
    expect(dependencies.externalFacts[0]!.factDigest).toBe(begin.beginAuthorizationEpochDigest)
  })

  test("result validation rejects unknown fields, kinds and malformed digests", () => {
    const valid = {
      format: "convax.canvas-external-fact-result/2",
      kind: "generation-recovery",
      requestSha256: digest(60),
      factDigest: digest(61),
      decision: "verified",
    }
    expect(validateCanvasExternalFactResultV2(valid)).toEqual(valid)
    expect(validateCanvasExternalFactResultV2({ ...valid, kind: "editor-action" })).toBe("rejected")
    expect(validateCanvasExternalFactResultV2({ ...valid, requestSha256: "bad" })).toBe("rejected")
    expect(validateCanvasExternalFactResultV2({ ...valid, extra: true })).toBe("rejected")
  })

  test("validates Plugin state against the exact canonical declarative artifact bytes", () => {
    const schema = {
      type: "object",
      maxProperties: "1",
      required: ["count"],
      properties: { count: { type: "integer", minimum: "0", maximum: "3" } },
      additionalProperties: false,
    } as const
    const exactBytes = canonicalPortablePluginStateSchemaBytesV1(schema)
    const schemaDigest = ordinarySha256V2(pluginStateSchemaDigestInputV1(schema))
    const plugin = {
      format: "convax.canvas-plugin-state/2",
      pluginId: "plugin.example",
      snapshotDigest: digest(70),
      pluginStateSchemaDigest: schemaDigest,
      validationArtifact: {
        owner: "plugin",
        format: portablePluginStateSchemaFormat,
        artifactDigest: schemaDigest,
      },
      state: { count: 2 },
    } as const satisfies PluginStateEnvelopeV2
    const intent = {
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.set-plugin-state/2",
      guard: {},
      body: { plugin },
    } as unknown as CanvasTypedIntentUnionV2
    const dependencies = discoverCanvasIntentDependenciesV2(context(7, 7, 7), intent)
    expect(dependencies).not.toBe("rejected")
    if (dependencies === "rejected") throw new Error("Plugin dependency discovery rejected fixture")
    const port = {
      resolveArtifact: (ref: (typeof dependencies.validationArtifacts)[number]) => ({ status: "resolved" as const, ref, exactBytes }),
      resolveFact: () => ({ status: "rejected" as const, code: "fact-not-declared" as const }),
      consumedDependencies: () => dependencies,
    } as unknown as OwnerExternalFactPortV2<"canvas">
    const facts = createCanvasExternalFactContextV2(context(7, 7, 7), intent, port)
    expect(facts).not.toBe("pending")
    expect(facts).not.toBe("rejected")
    if (facts === "pending" || facts === "rejected") throw new Error("Plugin artifact was not resolved")
    expect(facts.validatePluginState(plugin)).toBe("valid")
    expect(facts.validatePluginState({ ...plugin, state: { count: 4 } })).toBe("invalid")

    const noncanonicalPort = {
      ...port,
      resolveArtifact: (ref: (typeof dependencies.validationArtifacts)[number]) => ({
        status: "resolved" as const,
        ref,
        exactBytes: new TextEncoder().encode(` ${new TextDecoder().decode(exactBytes)}`),
      }),
    } as unknown as OwnerExternalFactPortV2<"canvas">
    expect(createCanvasExternalFactContextV2(context(7, 7, 7), intent, noncanonicalPort)).toBe("rejected")
  })
})
