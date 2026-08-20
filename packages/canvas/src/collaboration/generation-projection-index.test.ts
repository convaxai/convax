import { describe, expect, test } from "bun:test"
import { parseUint32 } from "@convax/collaboration"
import { appendCanvasSnapshotEntries, createCanvasSnapshotMap } from "./persistent-append-map"
import {
  buildCanvasGenerationProjectionIndex,
  canvasGenerationProjectionWorkCounts,
  installCanvasGenerationProjectionIndex,
} from "./generation-projection-index"
import { effectiveNodeData } from "./projection"
import type {
  CanvasNodeSnapshot,
  CanvasResourceRef,
  CanvasSnapshot,
  GenerationBeginV2,
  NodeDataEnvelope,
  OwnerGenerationTerminalV2,
} from "./types"
import { canvasEntityKey, derivedNodeRef, makeStamp } from "./validation"
import { validateCanvasYDoc } from "./ydoc"
import { context, digest, newCanvas, U0 } from "./test-fixtures.test"

describe("Canvas persistent generation projection index", () => {
  test("path-copies begin lifecycle changes without revisiting 256/1k/4k historical generations", () => {
    for (const generationCount of [256, 1_000, 4_000]) {
      const { base, generationIds, node } = generationFixture(generationCount)
      buildCanvasGenerationProjectionIndex(base)
      const generationId = generationIds.at(-1)!
      const begin = base.generationBegins.get(generationId)!
      const terminalKey = `${generationId}/owner/${begin.beginActorId}`
      const terminal: OwnerGenerationTerminalV2 = Object.freeze({
        format: "convax.canvas-generation-terminal/2",
        phase: "succeeded",
        generationId,
        node: begin.node,
        beginDigest: digest(81),
        beginActorId: begin.beginActorId,
        outputData: resourceData(`generated-${generationCount}`),
        outputProofDigest: digest(82),
      })
      const succeeded: CanvasSnapshot = Object.freeze({
        ...base,
        generationTerminals: appendCanvasSnapshotEntries(base.generationTerminals, [[terminalKey, terminal]]),
      })
      const dismissed: CanvasSnapshot = Object.freeze({
        ...base,
        generationDismissals: appendCanvasSnapshotEntries(base.generationDismissals, [[generationId, Object.freeze({
          format: "convax.canvas-generation-dismissal/2" as const,
          generationId,
          beginDigest: digest(81),
          marker: "dismissed" as const,
        })]]),
      })
      const recoveryFailed: CanvasSnapshot = Object.freeze({
        ...base,
        generationRecoveryFailures: appendCanvasSnapshotEntries(base.generationRecoveryFailures, [[generationId, Object.freeze({
          format: "convax.canvas-generation-recovery-failure/2" as const,
          generationId,
          beginDigest: digest(81),
          proofDigest: digest(83),
          failureCode: "generation-owner-unavailable" as const,
        })]]),
      })

      const before = canvasGenerationProjectionWorkCounts()
      installCanvasGenerationProjectionIndex(base, succeeded, [generationId])
      expect(effectiveNodeData(succeeded, node)).toMatchObject({
        data: { title: `generated-${generationCount}` },
        lifecycle: "succeeded",
      })
      installCanvasGenerationProjectionIndex(base, dismissed, [generationId])
      expect(effectiveNodeData(dismissed, node)).toMatchObject({
        data: { title: "original" },
        lifecycle: "dismissed",
      })
      installCanvasGenerationProjectionIndex(base, recoveryFailed, [generationId])
      expect(effectiveNodeData(recoveryFailed, node).lifecycle).toBe("recovery-failed")
      const after = canvasGenerationProjectionWorkCounts()

      expect(after.historicalGenerationVisits - before.historicalGenerationVisits).toBe(0)
      expect(after.incrementalGenerationUpdates - before.incrementalGenerationUpdates).toBe(3)
      expect(after.pathCopies - before.pathCopies).toBeLessThan(128)
      expect(after.nodeLocalGenerationVisits - before.nodeLocalGenerationVisits).toBe(0)
    }
  }, 30_000)
})

function generationFixture(generationCount: number) {
  const genesis = validateCanvasYDoc(newCanvas())
  const nodeContext = context(71, 72, 1)
  const node = snapshotNode(nodeContext, resourceData("original"))
  const generationIds: string[] = []
  const begins: Array<readonly [string, GenerationBeginV2]> = []
  for (let index = 0; index < generationCount; index += 1) {
    const generationContext = context(73, 74 + (index % 251), index + 2)
    const generationId = `g_${index.toString(36).padStart(43, "0")}`
    generationIds.push(generationId)
    begins.push([generationId, Object.freeze({
      format: "convax.canvas-generation-begin/2",
      generationId,
      node: node.identity.ref,
      beginActorId: generationContext.actorId,
      beginAuthorizationEpochDigest: digest(75),
      beginStamp: makeStamp(generationContext, U0),
      outputClaimStamp: makeStamp(generationContext, parseUint32("1")),
      toolRefDigest: digest(76),
      prompt: `generation-${index}`,
      targetEffectiveDataDigest: digest(77),
      targetPluginDigest: null,
    })])
  }
  const empty = <T>() => createCanvasSnapshotMap<T>([])
  const base: CanvasSnapshot = Object.freeze({
    identity: genesis.identity,
    meta: genesis.meta,
    nodes: createCanvasSnapshotMap([[node.key, node]]),
    edges: empty(),
    containments: empty(),
    generationBegins: createCanvasSnapshotMap(begins),
    generationTerminals: empty(),
    generationDismissals: empty(),
    generationRecoveryFailures: empty(),
    semanticHistory: empty(),
    operations: empty(),
  })
  return { base, generationIds, node }
}

function snapshotNode(operationContext: ReturnType<typeof context>, data: NodeDataEnvelope): CanvasNodeSnapshot {
  const ref = derivedNodeRef(operationContext, U0)
  const claim = <T>(value: T) => Object.freeze({
    format: "convax.canvas-stamped-claim" as const,
    stamp: makeStamp(operationContext, U0),
    value,
  })
  return Object.freeze({
    key: canvasEntityKey(ref),
    identity: Object.freeze({
      format: "convax.canvas-node-identity" as const,
      ref,
      role: "file" as const,
      createdBy: operationContext.operationId,
    }),
    position: Object.freeze([[operationContext.actorId, claim(Object.freeze({ x: 0, y: 0 }))] as const]),
    size: Object.freeze([[operationContext.actorId, claim(Object.freeze({ width: 320, height: 180 }))] as const]),
    data: Object.freeze([[operationContext.actorId, claim(Object.freeze(data))] as const]),
    plugin: Object.freeze([[operationContext.actorId, claim(null)] as const]),
    tombstones: Object.freeze([]),
    creationGroup: null,
  })
}

function resourceData(title: string): NodeDataEnvelope & { readonly kind: "resource" } {
  return Object.freeze({
    format: "convax.canvas-node-data",
    kind: "resource",
    title,
    resource: Object.freeze({
      format: "convax.canvas-resource-ref",
      uri: `convax-project://project/epochs/${context(1, 1, 1).operationId}/entries/pf_${"b".repeat(64)}`,
      mediaClass: "text",
      mime: "text/plain",
      byteLength: "1" as CanvasResourceRef["byteLength"],
      contentDigest: digest(78),
      ownerProofDigest: digest(79),
    }),
  })
}
