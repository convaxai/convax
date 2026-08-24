import { describe, expect, test } from "bun:test"
import { parseUint32, parseUint64 } from "@convax/collaboration"
import { createCanvasDocument, createTextNode } from "../document"
import {
  canvasPersistentRuntimeMapWorkCounts,
} from "../persistent-runtime-map"
import { canvasProjectionResourceMetadataKey, type CanvasDocumentProjection } from "./projection"
import type {
  CanvasAppliedProjectionPatchChanges,
  CanvasCertifiedProjectionIdentity,
} from "./projection-patch"
import {
  CanvasRendererResourceHierarchyIndex,
  canvasRendererResourceHierarchyWorkCounts,
  parseCanvasRendererResourceHierarchyDelta,
  parseCanvasRendererResourceHierarchySnapshot,
  type CanvasRendererResourceHierarchyClassification,
  type CanvasRendererResourceHierarchyEntry,
  type CanvasRendererResourceHierarchySnapshot,
} from "./renderer-resource-hierarchy-index"
import type { CanvasEntityRef, CanvasResourceRef } from "./types"
import { derivedNodeRef } from "./validation"
import { context, digest, SCHEMA_DIGEST, SCOPE } from "./test-fixtures.test"

describe("Canvas Renderer exact resource hierarchy index", () => {
  test("keeps exact append/query work structural at 1/1k/10k retained resources", () => {
    for (const resourceCount of [1, 1_000, 10_000]) {
      const fixture = hierarchyFixture(resourceCount, (index) => ({
        kind: "path",
        key: { coverage: "leaf", segments: ["assets", `${String(index).padStart(6, "0")}.md`] },
      }))
      const coldBefore = canvasRendererResourceHierarchyWorkCounts()
      const index = CanvasRendererResourceHierarchyIndex.fromSnapshot({
        identity: fixture.identity,
        projection: fixture.projection,
        resourceHierarchy: fixture.snapshot,
      })
      const coldAfter = canvasRendererResourceHierarchyWorkCounts()
      expect(coldAfter.coldProjectionNodeVisits - coldBefore.coldProjectionNodeVisits).toBe(resourceCount)
      expect(coldAfter.coldClassificationVisits - coldBefore.coldClassificationVisits).toBe(resourceCount)

      const runtimeBeforeQuery = canvasPersistentRuntimeMapWorkCounts()
      const hierarchyBeforeQuery = canvasRendererResourceHierarchyWorkCounts()
      const queried = index.query({ segments: ["assets", `${String(resourceCount - 1).padStart(6, "0")}.md`] })
      const runtimeAfterQuery = canvasPersistentRuntimeMapWorkCounts()
      const hierarchyAfterQuery = canvasRendererResourceHierarchyWorkCounts()
      expect(queried.status).toBe("available")
      if (queried.status !== "available") throw new Error("hierarchy query is unavailable")
      expect(queried.targets.map((target) => target.nodeId)).toEqual([fixture.nodes[resourceCount - 1]!.id])
      expect(hierarchyAfterQuery.queryAncestorLookups - hierarchyBeforeQuery.queryAncestorLookups).toBe(1)
      expect(hierarchyAfterQuery.queryPrefixBucketsVisited - hierarchyBeforeQuery.queryPrefixBucketsVisited).toBe(1)
      expect(hierarchyAfterQuery.queryTargetsVisited - hierarchyBeforeQuery.queryTargetsVisited).toBe(1)
      expect(runtimeAfterQuery.rangeEntryVisits - runtimeBeforeQuery.rangeEntryVisits).toBe(1)
      expect(runtimeAfterQuery.rangeBoundaryVisits - runtimeBeforeQuery.rangeBoundaryVisits).toBeLessThanOrEqual(64)

      const appended = resourceNode(20_000 + resourceCount)
      const appendedEntity = derivedNodeRef(context(60, 61, 1), parseUint32(String(20_000 + resourceCount)))
      const resultIdentity = projectionIdentity(90 + resourceCount)
      const changes: CanvasAppliedProjectionPatchChanges = Object.freeze({
        nodes: Object.freeze([appended]),
        edges: Object.freeze([]),
        nodeEntities: Object.freeze([{ nodeId: appended.id, entity: appendedEntity }]),
        edgeEntities: Object.freeze([]),
      })
      const delta = {
        format: "convax.canvas-resource-hierarchy-delta" as const,
        projectionIdentity: resultIdentity,
        entries: [{
          entity: appendedEntity,
          nodeId: appended.id,
          classification: {
            kind: "path" as const,
            key: { coverage: "leaf" as const, segments: ["notes", `new-${resourceCount}.md`] },
          },
        }],
      }
      const runtimeBeforeAppend = canvasPersistentRuntimeMapWorkCounts()
      const hierarchyBeforeAppend = canvasRendererResourceHierarchyWorkCounts()
      index.applyDelta({ changes, identity: resultIdentity, resourceHierarchy: delta })
      const runtimeAfterAppend = canvasPersistentRuntimeMapWorkCounts()
      const hierarchyAfterAppend = canvasRendererResourceHierarchyWorkCounts()
      expect(hierarchyAfterAppend.deltaClassificationVisits - hierarchyBeforeAppend.deltaClassificationVisits).toBe(1)
      expect(runtimeAfterAppend.historicalEntryVisits - runtimeBeforeAppend.historicalEntryVisits).toBe(0)
      expect(runtimeAfterAppend.pathCopies - runtimeBeforeAppend.pathCopies).toBeLessThanOrEqual(128)
      expect(index.query({ segments: ["notes", `new-${resourceCount}.md`] })).toMatchObject({
        status: "available",
        targets: [{ nodeId: appended.id }],
      })
    }
  }, 30_000)

  test("matches descendant leaves plus proper-ancestor subtree resources without sibling widening", () => {
    const classifications: CanvasRendererResourceHierarchyClassification[] = [
      { kind: "path", key: { coverage: "subtree", segments: ["notes"] } },
      { kind: "path", key: { coverage: "leaf", segments: ["notes", "a.md"] } },
      { kind: "path", key: { coverage: "leaf", segments: ["notes", "nested", "b.md"] } },
      { kind: "path", key: { coverage: "leaf", segments: ["notes2", "outside.md"] } },
      { kind: "not-path-backed" },
    ]
    const fixture = hierarchyFixture(classifications.length, (index) => classifications[index]!)
    const index = CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: fixture.identity,
      projection: fixture.projection,
      resourceHierarchy: fixture.snapshot,
    })

    expect(targetIds(index.query({ segments: ["notes"] }))).toEqual(new Set([
      fixture.nodes[0]!.id,
      fixture.nodes[1]!.id,
      fixture.nodes[2]!.id,
    ]))
    expect(targetIds(index.query({ segments: ["notes", "a.md"] }))).toEqual(new Set([
      fixture.nodes[0]!.id,
      fixture.nodes[1]!.id,
    ]))
    expect(targetIds(index.query({ segments: ["notes", "nested", "b.md"] }))).toEqual(new Set([
      fixture.nodes[0]!.id,
      fixture.nodes[2]!.id,
    ]))
    expect(targetIds(index.query({ segments: ["notes", "missing.md"] }))).toEqual(new Set([
      fixture.nodes[0]!.id,
    ]))
    expect(targetIds(index.query({ segments: ["notes2"] }))).toEqual(new Set([fixture.nodes[3]!.id]))
    expect(targetIds(index.query({ segments: ["unrelated"] }))).toEqual(new Set())
  })

  test("becomes sticky unavailable on missing, duplicate, illegal, or stale classification until a complete reset", () => {
    const fixture = hierarchyFixture(2, (index) => ({
      kind: "path",
      key: { coverage: "leaf", segments: ["notes", `${index}.md`] },
    }))
    const missing = structuredClone(fixture.snapshot)
    missing.entries.pop()
    const unavailable = CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: fixture.identity,
      projection: fixture.projection,
      resourceHierarchy: missing,
    })
    expect(unavailable.query({ segments: ["notes"] })).toEqual({ status: "unavailable" })

    const appended = resourceNode(100)
    const appendedEntity = derivedNodeRef(context(60, 61, 1), parseUint32("100"))
    const resultIdentity = projectionIdentity(102)
    unavailable.applyDelta({
      identity: resultIdentity,
      changes: {
        nodes: [appended],
        edges: [],
        nodeEntities: [{ nodeId: appended.id, entity: appendedEntity }],
        edgeEntities: [],
      },
      resourceHierarchy: {
        format: "convax.canvas-resource-hierarchy-delta",
        projectionIdentity: resultIdentity,
        entries: [{
          entity: appendedEntity,
          nodeId: appended.id,
          classification: { kind: "path", key: { coverage: "leaf", segments: ["notes", "new.md"] } },
        }],
      },
    })
    expect(unavailable.query({ segments: ["notes", "new.md"] })).toEqual({ status: "unavailable" })

    const available = CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: fixture.identity,
      projection: fixture.projection,
      resourceHierarchy: fixture.snapshot,
    })
    expect(targetIds(available.query({ segments: ["notes"] })).size).toBe(2)
    available.applyDelta({
      identity: resultIdentity,
      changes: {
        nodes: [appended],
        edges: [],
        nodeEntities: [{ nodeId: appended.id, entity: appendedEntity }],
        edgeEntities: [],
      },
      resourceHierarchy: {
        format: "convax.canvas-resource-hierarchy-delta",
        projectionIdentity: fixture.identity,
        entries: [],
      },
    })
    expect(available.query({ segments: ["notes"] })).toEqual({ status: "unavailable" })

    const reset = CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: fixture.identity,
      projection: fixture.projection,
      resourceHierarchy: fixture.snapshot,
    })
    expect(targetIds(reset.query({ segments: ["notes"] })).size).toBe(2)

    const duplicate = structuredClone(fixture.snapshot)
    duplicate.entries[1] = structuredClone(duplicate.entries[0]!)
    expect(CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: fixture.identity,
      projection: fixture.projection,
      resourceHierarchy: duplicate,
    }).query({ segments: ["notes"] })).toEqual({ status: "unavailable" })
  })

  test("strictly clones/freezes the closed host-neutral codecs", () => {
    const fixture = hierarchyFixture(1, () => ({
      kind: "path",
      key: { coverage: "leaf", segments: ["notes", "a.md"] },
    }))
    const parsed = parseCanvasRendererResourceHierarchySnapshot(fixture.snapshot)
    expect(Object.isFrozen(parsed)).toBeTrue()
    expect(Object.isFrozen(parsed.entries[0]?.classification)).toBeTrue()
    const widened = structuredClone(fixture.snapshot) as CanvasRendererResourceHierarchySnapshot & { extra?: boolean }
    widened.extra = true
    expect(() => parseCanvasRendererResourceHierarchySnapshot(widened)).toThrow()
    const unavailableWithEntries = structuredClone(fixture.snapshot)
    unavailableWithEntries.completeness = "unavailable"
    expect(() => parseCanvasRendererResourceHierarchySnapshot(unavailableWithEntries)).toThrow()

    const illegal = {
      format: "convax.canvas-resource-hierarchy-delta",
      projectionIdentity: fixture.identity,
      entries: [{
        ...fixture.snapshot.entries[0],
        classification: { kind: "path", key: { coverage: "leaf", segments: [".."] } },
      }],
    }
    expect(() => parseCanvasRendererResourceHierarchyDelta(illegal)).toThrow()
  })
})

function hierarchyFixture(
  resourceCount: number,
  classification: (index: number) => CanvasRendererResourceHierarchyClassification,
) {
  const nodes = Array.from({ length: resourceCount }, (_, index) => resourceNode(index))
  const entities = nodes.map((node, index) => {
    const entity = derivedNodeRef(context(60, 61, 1), parseUint32(String(index)))
    return [node.id, entity] as const
  })
  const projection: CanvasDocumentProjection = {
    document: createCanvasDocument({ id: SCOPE.docId, nodes }),
    nodeEntities: new Map(entities),
    edgeEntities: new Map(),
  }
  const identity = projectionIdentity(80)
  const entries: CanvasRendererResourceHierarchyEntry[] = entities.map(([nodeId, entity], index) => ({
    entity,
    nodeId,
    classification: classification(index),
  }))
  const snapshot: CanvasRendererResourceHierarchySnapshot = {
    format: "convax.canvas-resource-hierarchy-snapshot",
    projectionIdentity: identity,
    completeness: "complete",
    entries,
  }
  return { identity, nodes, projection, snapshot }
}

function resourceNode(index: number) {
  const entity = derivedNodeRef(context(60, 61, 1), parseUint32(String(index)))
  return createTextNode({
    id: entity.id,
    metadata: { [canvasProjectionResourceMetadataKey]: resourceRef(index) },
    position: { x: index * 4, y: 0 },
    resourceState: { status: "stale" },
  })
}

function resourceRef(index: number): CanvasResourceRef {
  const suffix = (index % 16).toString(16)
  return {
    format: "convax.canvas-resource-ref",
    uri: `convax-project://project/epochs/${context(1, 1, 1).operationId}/entries/pf_${suffix.repeat(64)}`,
    mediaClass: "text",
    mime: "text/markdown",
    byteLength: parseUint64("1"),
    contentDigest: digest(110 + (index % 100)),
    ownerProofDigest: digest(210 + (index % 40)),
  }
}

function projectionIdentity(seed: number): CanvasCertifiedProjectionIdentity {
  return {
    format: "convax.canvas-certified-projection-identity",
    canvasId: SCOPE.docId,
    ownerSchemaDigest: SCHEMA_DIGEST,
    stateCommitmentDigest: digest(seed),
  }
}

function targetIds(result: ReturnType<CanvasRendererResourceHierarchyIndex["query"]>) {
  if (result.status !== "available") throw new Error("hierarchy query is unavailable")
  return new Set(result.targets.map((target) => target.nodeId))
}
