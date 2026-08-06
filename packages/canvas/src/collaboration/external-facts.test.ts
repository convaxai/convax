import { describe, expect, test } from "bun:test"
import {
  canonicalPortablePluginStateSchemaBytesV1,
  pluginStateSchemaDigestInputV1,
  portablePluginStateSchemaFormat,
} from "@convax/bounded-value"
import { ordinarySha256, parseUint32, parseUint64, type OwnerExternalFactPort } from "@convax/collaboration"
import {
  createCanvasExternalFactContext,
  decodeCanvasExternalFactRequest,
  discoverCanvasIntentDependencies,
  encodeCanvasExternalFactRequest,
  validateCanvasExternalFactResult,
} from "./external-facts"
import { effectiveDataDigest, projectedGenerationDigestV2 } from "./projection"
import type {
  CanvasExternalFactRequest,
  CanvasTypedIntentUnion,
  GenerationBeginV2,
  PluginStateEnvelope,
} from "./types"
import { canvasDigest, deriveCanvasId, derivedNodeRef, makeStamp } from "./validation"
import { validateCanvasYDoc } from "./ydoc"
import { context, createAgent, digest, id128, newCanvas, nodeDataGuard, SCOPE } from "./test-fixtures.test"

const U0 = parseUint32("0")
const U1 = parseUint32("1")

describe("Canvas current external-fact closure", () => {
  test("round-trips all four closed request kinds as exact restricted JCS", () => {
    const ownerProofDigest = digest(40)
    const resource = {
      format: "convax.canvas-resource-ref" as const,
      uri: `convax-project://project/epochs/${id128(41)}/entries/pf_${"1".repeat(64)}`,
      mediaClass: "image" as const,
      mime: "image/png",
      byteLength: parseUint64("10"),
      contentDigest: digest(42),
      ownerProofDigest,
    }
    const node = derivedNodeRef(context(2, 2, 2), U0)
    const requests: readonly CanvasExternalFactRequest[] = [
      {
        format: "convax.canvas-external-fact-request",
        kind: "current-resources",
        proofs: [{
          format: "convax.canvas-resource-proof-ref",
          mode: "current-owner-state",
          resource,
          ownerProofDigest,
          requireCurrentLiveVersion: true,
        }],
      },
      {
        format: "convax.canvas-external-fact-request",
        kind: "retained-resources",
        proofs: [{
          format: "convax.canvas-resource-proof-ref",
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
        format: "convax.canvas-external-fact-request",
        kind: "generation-begin",
        scope: SCOPE,
        beginDigest: digest(45),
        beginActorId: context(3, 3, 3).actorId,
        beginAuthorizationEpochDigest: digest(46),
        toolRefDigest: digest(47),
        protocolDigest: context(3, 3, 3).protocolDigest,
      },
      { format: "convax.canvas-external-fact-request", kind: "generation-recovery", proofDigest: digest(48) },
    ]
    for (const request of requests) {
      const bytes = encodeCanvasExternalFactRequest(request)
      expect(bytes).not.toBe("rejected")
      if (bytes === "rejected") throw new Error("request codec rejected fixture")
      expect(decodeCanvasExternalFactRequest(bytes)).toEqual(request)
    }
  })

  test("discovers the exact generation-begin request from intent plus imported context", () => {
    const document = newCanvas()
    const node = createAgent(document, context(1, 1, 1))
    const operationContext = context(2, 2, 2)
    const snapshot = validateCanvasYDoc(document)
    const begin: GenerationBeginV2 = {
      format: "convax.canvas-generation-begin/2",
      generationId: deriveCanvasId("generation", operationContext, U0),
      node,
      beginActorId: operationContext.actorId,
      beginAuthorizationEpochDigest: digest(50),
      beginStamp: makeStamp(operationContext, U0),
      outputClaimStamp: makeStamp(operationContext, U1),
      toolRefDigest: digest(51),
      prompt: "generate",
      targetEffectiveDataDigest: effectiveDataDigest(snapshot, snapshot.nodes.values().next().value!),
      targetPluginDigest: null,
    }
    const intent: Extract<CanvasTypedIntentUnion, { kind: "canvas.generation.begin" }> = {
      format: "convax.typed-intent",
      kind: "canvas.generation.begin",
      guard: {
        ...nodeDataGuard(document, node),
        expectedPluginDigest: null,
        expectedProjectedGenerationDigest: projectedGenerationDigestV2(snapshot, node),
      },
      body: { begin },
    }
    const dependencies = discoverCanvasIntentDependencies(operationContext, intent)
    expect(dependencies).not.toBe("rejected")
    if (dependencies === "rejected") throw new Error("dependency discovery rejected fixture")
    expect(dependencies.validationArtifacts).toEqual([])
    expect(dependencies.externalFacts).toHaveLength(1)
    const request = decodeCanvasExternalFactRequest(dependencies.externalFacts[0]!.request.exactJcs)
    expect(request).toMatchObject({
      kind: "generation-begin",
      scope: operationContext.scope,
      beginDigest: canvasDigest("convax.canvas-generation-begin/2", begin),
      beginAuthorizationEpochDigest: begin.beginAuthorizationEpochDigest,
      toolRefDigest: begin.toolRefDigest,
      protocolDigest: operationContext.protocolDigest,
    })
    expect(dependencies.externalFacts[0]!.factDigest).toBe(begin.beginAuthorizationEpochDigest)
  })

  test("result validation rejects unknown fields, kinds and malformed digests", () => {
    const valid = {
      format: "convax.canvas-external-fact-result",
      kind: "generation-recovery",
      requestSha256: digest(60),
      factDigest: digest(61),
      decision: "verified",
    }
    expect(validateCanvasExternalFactResult(valid)).toEqual(valid)
    expect(validateCanvasExternalFactResult({ ...valid, kind: "editor-action" })).toBe("rejected")
    expect(validateCanvasExternalFactResult({ ...valid, requestSha256: "bad" })).toBe("rejected")
    expect(validateCanvasExternalFactResult({ ...valid, extra: true })).toBe("rejected")
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
    const schemaDigest = ordinarySha256(pluginStateSchemaDigestInputV1(schema))
    const plugin = {
      format: "convax.canvas-plugin-state",
      pluginId: "plugin.example",
      snapshotDigest: digest(70),
      pluginStateSchemaDigest: schemaDigest,
      validationArtifact: {
        owner: "plugin",
        format: portablePluginStateSchemaFormat,
        artifactDigest: schemaDigest,
      },
      state: { count: 2 },
    } as const satisfies PluginStateEnvelope
    const intent = {
      format: "convax.typed-intent",
      kind: "canvas.nodes.set-plugin-state",
      guard: {},
      body: { plugin },
    } as unknown as CanvasTypedIntentUnion
    const dependencies = discoverCanvasIntentDependencies(context(7, 7, 7), intent)
    expect(dependencies).not.toBe("rejected")
    if (dependencies === "rejected") throw new Error("Plugin dependency discovery rejected fixture")
    const port = {
      resolveArtifact: (ref: (typeof dependencies.validationArtifacts)[number]) => ({ status: "resolved" as const, ref, exactBytes }),
      resolveFact: () => ({ status: "rejected" as const, code: "fact-not-declared" as const }),
      consumedDependencies: () => dependencies,
    } as unknown as OwnerExternalFactPort<"canvas">
    const facts = createCanvasExternalFactContext(context(7, 7, 7), intent, port)
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
    } as unknown as OwnerExternalFactPort<"canvas">
    expect(createCanvasExternalFactContext(context(7, 7, 7), intent, noncanonicalPort)).toBe("rejected")
  })
})
