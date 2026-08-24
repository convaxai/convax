import { describe, expect, test } from "bun:test"
import {
  encodeRestrictedJcs,
  installCurrentProtocolAuthority,
  parseUint32,
  parseUint64,
} from "@convax/collaboration"
import { appendCanvasSnapshotEntries, createCanvasSnapshotMap } from "./persistent-append-map"
import {
  applyCanvasCertifiedProjectionPatch,
  bindCanvasCertifiedProjectionPatch,
  bindCanvasCertifiedProjectionRoot,
  canvasCertifiedProjectionPatchWorkCounts,
  createCanvasIndexedProjectionCursor,
  parseCanvasCertifiedProjectionIdentity,
  parseCanvasCertifiedProjectionPatch,
  readCanvasCertifiedProjectionIdentity,
  readCanvasCertifiedProjectionPatch,
  type CanvasAppliedProjectionPatchChanges,
  type CanvasCertifiedProjectionIdentity,
} from "./projection-patch"
import {
  canvasRendererProjectionStoreWorkCounts,
  createCanvasCertifiedRendererProjectionStore,
} from "./renderer-projection-store"
import {
  CANVAS_RENDERER_VIEWPORT_MAX_NODES,
  canvasRendererViewportWorkCounts,
} from "./renderer-viewport-index"
import {
  buildCanvasProjectionIndex,
  canvasProjectionBuildCounts,
  installCanvasResourceAppendProjectionIndex,
  projectCanvas,
  projectCanvasDocument,
  type CanvasDocumentProjection,
} from "./projection"
import { armCanvasDuplicateCandidateCapture } from "./reducer"
import {
  canvasOperationReceipt,
  canvasSnapshotFromValidatedOwnerState,
  createCanvasDocumentOwnerRuntime,
} from "./session"
import type {
  BoundedOperationReceipt,
  CanvasNodeSnapshot,
  CanvasResourceRef,
  CanvasSnapshot,
  GenerationBeginV2,
  NodeDataEnvelope,
  SemanticHistoryRoot,
} from "./types"
import { canvasEntityKey, derivedNodeRef, historyRootKey, makeStamp, operationKey } from "./validation"
import { context, digest, fork, newCanvas, SCHEMA_DIGEST, U0 } from "./test-fixtures.test"
import { validateCanvasYDoc } from "./ydoc"
import * as publicSurface from "./index"
import { CanvasVisualHistoryCoordinator } from "../visual-history"
import { createCanvasDocument } from "../document"
import { CanvasCombinedPresentationStore, CanvasOptimisticOverlayCoordinator } from "../optimistic-overlay"
import { canvasCanonicalResourceIdentity } from "../resource-runtime-projection"

describe("Canvas certified projection patches", () => {
  test("issues only from sealed validatePost and matches a cold commitment/projection rebuild", async () => {
    const runtime = createCanvasDocumentOwnerRuntime(await installCurrentProtocolAuthority())
    const protocol = runtime.protocolPort
    const baseDocument = newCanvas()
    const baseState = protocol.validateBase(baseDocument)
    if (typeof baseState === "string") throw new Error(`base unexpectedly ${baseState}`)
    const baseSnapshot = canvasSnapshotFromValidatedOwnerState(baseState)
    if (!baseSnapshot) throw new Error("base snapshot is unavailable")
    const baseIdentity = readCanvasCertifiedProjectionIdentity(baseSnapshot)
    if (!baseIdentity) throw new Error("base commitment identity is unavailable")
    const baseProjection = projectCanvasDocument(projectCanvas(baseSnapshot))
    const cursor = createCanvasIndexedProjectionCursor({ identity: baseIdentity, projection: baseProjection })
    if (!cursor) throw new Error("base projection cursor is unavailable")

    const candidate = fork(baseDocument)
    const operationContext = context(985, 986, 1)
    const node = derivedNodeRef(operationContext, U0)
    const resource = textResource()
    const intent = {
      format: "convax.typed-intent" as const,
      kind: "canvas.resources.add" as const,
      guard: {
        existingEndpoints: [],
        derivedNodes: [{ ordinal: U0, node, expectedAbsent: true as const }],
        derivedEdges: [],
        resourceProofs: [{
          createdNodeOrdinal: U0,
          proof: {
            format: "convax.canvas-resource-proof-ref" as const,
            mode: "current-owner-state" as const,
            resource,
            ownerProofDigest: resource.ownerProofDigest,
            requireCurrentLiveVersion: true as const,
          },
        }],
      },
      body: {
        placement: { anchor: { x: 0, y: 0 }, gap: 24 as const },
        nodes: [{
          ordinal: U0,
          nodeId: node.id,
          incarnation: node.incarnation,
          size: { width: 320, height: 180 },
          title: "sealed-text",
          resource,
        }],
        edges: [],
      },
    }
    const dependencies = runtime.closurePort.discoverDependencies({ context: operationContext, intent })
    if (typeof dependencies === "string") throw new Error(`dependencies unexpectedly ${dependencies}`)
    const attempt = runtime.externalFactPortFactory.createAttemptPort({
      declared: dependencies,
      resolver: {
        owner: "canvas",
        resolveArtifact: () => ({ status: "rejected", code: "artifact-not-declared" }),
        resolveFact: (requirement) => ({
          status: "resolved",
          requirement,
          value: {
            format: "convax.canvas-external-fact-result",
            kind: requirement.kind,
            requestSha256: requirement.request.sha256,
            factDigest: requirement.factDigest,
            decision: "verified",
          },
        }),
      },
    })
    if (attempt.status !== "created") throw new Error(`fact attempt unexpectedly ${attempt.code}`)
    armCanvasDuplicateCandidateCapture(candidate, baseSnapshot, operationContext)
    let result: ReturnType<typeof protocol.applyIntent> = "rejected"
    candidate.transact(() => {
      result = protocol.applyIntent(baseState, candidate, operationContext, intent, attempt.port)
    }, "kernel-owned-certified-resource-create")
    if (typeof result === "string") throw new Error(`owner apply unexpectedly ${result}`)

    const unsealedSnapshot = validateCanvasYDoc(candidate)
    const unsealedReceipt = canvasOperationReceipt(
      unsealedSnapshot,
      operationContext.actorId,
      operationContext.operationId,
    )
    if (!unsealedReceipt) throw new Error("unsealed receipt is unavailable")
    expect(readCanvasCertifiedProjectionPatch(unsealedSnapshot, unsealedReceipt)).toBeNull()

    const postState = protocol.validatePost(baseState, candidate, result)
    if (typeof postState === "string") throw new Error(`post unexpectedly ${postState}`)
    const postSnapshot = canvasSnapshotFromValidatedOwnerState(postState)
    if (!postSnapshot) throw new Error("post snapshot is unavailable")
    const receipt = canvasOperationReceipt(postSnapshot, operationContext.actorId, operationContext.operationId)
    if (!receipt) throw new Error("sealed receipt is unavailable")
    const patch = readCanvasCertifiedProjectionPatch(postSnapshot, receipt)
    if (!patch) throw new Error("sealed projection patch is unavailable")
    expect(Object.isFrozen(patch)).toBeTrue()
    expect(Object.isFrozen(patch.nodes)).toBeTrue()
    expect(Object.isFrozen(patch.nodes[0]!)).toBeTrue()

    const applied = applyCanvasCertifiedProjectionPatch(cursor, structuredClone(patch))
    expect(applied.status).toBe("applied")
    if (applied.status !== "applied") throw new Error(`patch unexpectedly ${applied.status}`)

    const coldDocument = fork(candidate)
    const coldState = protocol.validateBase(coldDocument)
    if (typeof coldState === "string") throw new Error(`cold base unexpectedly ${coldState}`)
    const coldSnapshot = canvasSnapshotFromValidatedOwnerState(coldState)
    if (!coldSnapshot) throw new Error("cold snapshot is unavailable")
    const fastIdentity = readCanvasCertifiedProjectionIdentity(postSnapshot)
    const coldIdentity = readCanvasCertifiedProjectionIdentity(coldSnapshot)
    expect(fastIdentity).not.toBeNull()
    expect(fastIdentity).toEqual(coldIdentity)

    const incrementalProjection = applied.cursor.projection
    const coldProjection = projectCanvasDocument(projectCanvas(coldSnapshot))
    expect(incrementalProjection.document).toEqual(coldProjection.document)
    expect(sortedMapEntries(incrementalProjection.nodeEntities)).toEqual(sortedMapEntries(coldProjection.nodeEntities))
    expect(sortedMapEntries(incrementalProjection.edgeEntities)).toEqual(sortedMapEntries(coldProjection.edgeEntities))
  })

  test("keeps 1/1k/10k Add Text patch bytes and keyed work independent of N", () => {
    const byteLengths: number[] = []
    for (const entryCount of [1, 1_000, 10_000]) {
      const fixture = certifiedAppendFixture(entryCount)
      expect(fixture.firstAppendObstacleIndexBuildVisits).toBe(0)
      const cursor = createCanvasIndexedProjectionCursor({
        identity: fixture.baseIdentity,
        projection: fixture.baseProjection,
      })
      expect(cursor).not.toBeNull()
      const patchWorkBefore = canvasCertifiedProjectionPatchWorkCounts()
      const projectionWorkBefore = canvasProjectionBuildCounts()

      const patch = readCanvasCertifiedProjectionPatch(fixture.post, fixture.receipt)
      expect(patch).not.toBeNull()
      byteLengths.push(encodeRestrictedJcs(patch).byteLength)
      const applied = applyCanvasCertifiedProjectionPatch(cursor!, structuredClone(patch))
      expect(applied.status).toBe("applied")
      if (applied.status !== "applied") throw new Error(`patch unexpectedly ${applied.status}`)

      const patchWorkAfter = canvasCertifiedProjectionPatchWorkCounts()
      const projectionWorkAfter = canvasProjectionBuildCounts()
      expect(patchWorkAfter.certifiedPatchEntryVisits - patchWorkBefore.certifiedPatchEntryVisits).toBe(1)
      expect(patchWorkAfter.indexedPatchEntryVisits - patchWorkBefore.indexedPatchEntryVisits).toBe(1)
      expect(patchWorkAfter.cursorMaterializedEntryVisits - patchWorkBefore.cursorMaterializedEntryVisits).toBe(0)
      expect(projectionWorkAfter.fullBuilds - projectionWorkBefore.fullBuilds).toBe(0)
      expect(projectionWorkAfter.fullNodeTraversals - projectionWorkBefore.fullNodeTraversals).toBe(0)
      expect(projectionWorkAfter.projectionArrayEntryVisits - projectionWorkBefore.projectionArrayEntryVisits).toBe(0)
      expect(applied.changes.nodes).toHaveLength(1)
      expect(applied.changes.edges).toHaveLength(0)
      expect(applied.cursor.identity).toEqual(fixture.resultIdentity)

      // Materializing a full document is an explicit cold/reset operation. Its
      // result must still be byte-for-byte equivalent to the owner projection.
      const incrementalProjection = applied.cursor.projection
      const coldProjection = projectCanvasDocument(projectCanvas(fixture.post))
      expect(incrementalProjection.document).toEqual(coldProjection.document)
      expect(sortedMapEntries(incrementalProjection.nodeEntities)).toEqual(sortedMapEntries(coldProjection.nodeEntities))
      expect(sortedMapEntries(incrementalProjection.edgeEntities)).toEqual(sortedMapEntries(coldProjection.edgeEntities))
    }
    expect(new Set(byteLengths).size).toBe(1)
  }, 30_000)

  test("keeps a certified Add Text exact-keyed with 256/1k/4k historical generations", () => {
    for (const generationCount of [256, 1_000, 4_000]) {
      const fixture = certifiedAppendFixture(1, generationCount)
      expect(fixture.firstAppendHistoricalGenerationVisits).toBe(0)
      const cursor = createCanvasIndexedProjectionCursor({
        identity: fixture.baseIdentity,
        projection: fixture.baseProjection,
      })
      const patch = readCanvasCertifiedProjectionPatch(fixture.post, fixture.receipt)
      if (!cursor || !patch) throw new Error("generation append fixture is unavailable")
      const before = canvasProjectionBuildCounts()
      const applied = applyCanvasCertifiedProjectionPatch(cursor, structuredClone(patch))
      const after = canvasProjectionBuildCounts()
      expect(applied.status).toBe("applied")
      expect(after.historicalGenerationVisits - before.historicalGenerationVisits).toBe(0)
      expect(after.fullBuilds - before.fullBuilds).toBe(0)
      expect(after.projectionArrayEntryVisits - before.projectionArrayEntryVisits).toBe(0)
    }
  }, 30_000)

  test("publishes one bounded Renderer/history append without a full projection read at 1/1k/10k", () => {
    for (const entryCount of [1, 1_000, 10_000]) {
      const fixture = certifiedAppendFixture(entryCount)
      expect(fixture.firstAppendObstacleIndexBuildVisits).toBe(0)
      const store = createCanvasCertifiedRendererProjectionStore({
        identity: fixture.baseIdentity,
        projection: fixture.baseProjection,
        resourceHierarchy: hierarchySnapshot(fixture.baseIdentity, fixture.baseProjection),
      })
      const patch = readCanvasCertifiedProjectionPatch(fixture.post, fixture.receipt)
      if (!store || !patch) throw new Error("certified Renderer fixture is unavailable")
      let fullNotifications = 0
      const changes: Parameters<Parameters<typeof store.subscribeProjectionChanges>[0]>[0][] = []
      store.subscribe(() => { fullNotifications += 1 })
      store.subscribeProjectionChanges((change) => changes.push(change))
      const optimisticOverlay = new CanvasOptimisticOverlayCoordinator()
      const scheduledPresentationTasks: Array<() => void> = []
      const combinedPresentation = new CanvasCombinedPresentationStore({
        authoritative: {
          getSnapshot: () => store.getProjection(),
          subscribe: (listener) => store.subscribe(listener),
        },
        overlay: optimisticOverlay,
        schedule: (task) => scheduledPresentationTasks.push(task),
      })
      combinedPresentation.subscribe(() => undefined)
      const optimisticOperation = optimisticOverlay.begin(`append-${entryCount}`, [{
        kind: "ghost-node",
        presentationKey: `ghost-${entryCount}`,
        position: { x: 0, y: 0 },
        presentation: { nodeType: "text", title: "Text" },
        size: { height: 180, width: 320 },
      }])
      scheduledPresentationTasks.splice(0).forEach((task) => task())
      const projectionWorkBefore = canvasCertifiedProjectionPatchWorkCounts()
      const rendererWorkBefore = canvasRendererProjectionStoreWorkCounts()
      const viewportWorkBefore = canvasRendererViewportWorkCounts()

      const installed = store.applyCertifiedProjectionPatch(structuredClone(patch), (change) => ({
        preparedResources: change.changes.nodes.map((node, index) => {
          const resourceIdentity = canvasCanonicalResourceIdentity(node)
          const entity = change.changes.nodeEntities[index]?.entity
          if (!resourceIdentity || !entity) throw new Error("prepared Text runtime fixture is unavailable")
          return {
            entity,
            nodeId: node.id,
            resourceIdentity,
            state: {
              contentRevision: "a".repeat(64),
              editableText: true,
              status: "ready",
              text: "",
            },
          }
        }),
        resourceHierarchy: hierarchyDelta(change.identity, change.changes),
      }))
      expect(installed.status).toBe("applied")
      if (installed.status !== "applied") throw new Error(`store patch unexpectedly ${installed.status}`)
      expect(fullNotifications).toBe(0)
      expect(changes).toEqual([installed.change])
      expect(installed.change.changes.nodes).toHaveLength(1)
      expect(installed.change.changes.edges).toHaveLength(0)
      expect(installed.change.preparedResources).toHaveLength(1)
      expect(installed.change.preparedResources[0]?.state).toMatchObject({ editableText: true, status: "ready" })
      expect(store.queryResourceHierarchy({
        segments: ["notes", `${installed.change.changes.nodes[0]!.id}.md`],
      })).toMatchObject({
        status: "available",
        targets: [{ nodeId: installed.change.changes.nodes[0]!.id }],
      })
      expect(store.resolveNode(installed.change.changes.nodes[0]!.id)).toBe(installed.change.changes.nodes[0])
      const viewport = store.queryViewport({
        pinnedNodeIds: [installed.change.changes.nodes[0]!.id],
        rect: { height: 1_080, width: 1_920, x: 0, y: 0 },
      })
      expect(viewport.nodes.length).toBeLessThanOrEqual(CANVAS_RENDERER_VIEWPORT_MAX_NODES)
      expect(viewport.nodes).toContain(installed.change.changes.nodes[0]!)
      optimisticOverlay.settle(optimisticOperation.token)
      scheduledPresentationTasks.splice(0).forEach((task) => task())

      const history = new CanvasVisualHistoryCoordinator()
      const staged = history.stageCertifiedResourceAppendRoot(`append-${entryCount}`)
      expect(staged).not.toBeNull()
      expect(history.bindStagedCertifiedResourceAppend(staged!, installed.change, store)).toBeTrue()
      const prediction = history.begin("undo", `canvas:${entryCount}`)
      expect(prediction).not.toBeNull()
      const overlay = history.overlay.getSnapshot()
      expect(overlay.operations).toHaveLength(1)
      expect(overlay.operations[0]!.items).toEqual([{
        kind: "hide-entity",
        entity: {
          entityId: installed.change.changes.nodes[0]!.id,
          incarnation: installed.change.changes.nodeEntities[0]!.entity.incarnation,
          kind: "node",
        },
      }])
      expect(history.reconcile(
        prediction,
        { direction: "undo", rootOperationId: installed.change.receipt.operationId },
        { document: createCanvasDocument({ id: fixture.baseIdentity.canvasId }), edgeEntities: [], nodeEntities: [] },
      )).toBeTrue()
      const redo = history.begin("redo", `canvas:${entryCount}`)
      expect(redo).not.toBeNull()
      const redoItems = history.overlay.getSnapshot().operations[0]!.items
      expect(redoItems).toHaveLength(1)
      expect(redoItems[0]?.kind).toBe("ghost-node")

      const projectionWorkAfter = canvasCertifiedProjectionPatchWorkCounts()
      const rendererWorkAfter = canvasRendererProjectionStoreWorkCounts()
      const viewportWorkAfter = canvasRendererViewportWorkCounts()
      expect(projectionWorkAfter.cursorMaterializedEntryVisits - projectionWorkBefore.cursorMaterializedEntryVisits).toBe(0)
      expect(rendererWorkAfter.fullReads - rendererWorkBefore.fullReads).toBe(0)
      expect(rendererWorkAfter.patchEntriesPublished - rendererWorkBefore.patchEntriesPublished).toBe(1)
      expect(viewportWorkAfter.coldNodeVisits - viewportWorkBefore.coldNodeVisits).toBe(0)
      expect(viewportWorkAfter.coldEdgeVisits - viewportWorkBefore.coldEdgeVisits).toBe(0)
      expect(viewportWorkAfter.patchNodeVisits - viewportWorkBefore.patchNodeVisits).toBe(1)
      expect(viewportWorkAfter.patchEdgeVisits - viewportWorkBefore.patchEdgeVisits).toBe(0)

      const forged = structuredClone(installed.change)
      const forgedHistory = new CanvasVisualHistoryCoordinator()
      const forgedRoot = forgedHistory.stageCertifiedResourceAppendRoot(`forged-${entryCount}`)
      expect(forgedHistory.bindStagedCertifiedResourceAppend(forgedRoot!, forged, store)).toBeFalse()
      const otherStore = createCanvasCertifiedRendererProjectionStore({
        identity: fixture.baseIdentity,
        projection: fixture.baseProjection,
        resourceHierarchy: hierarchySnapshot(fixture.baseIdentity, fixture.baseProjection),
      })
      if (!otherStore) throw new Error("second certified Renderer fixture is unavailable")
      const crossSessionHistory = new CanvasVisualHistoryCoordinator()
      const crossSessionRoot = crossSessionHistory.stageCertifiedResourceAppendRoot(`cross-session-${entryCount}`)
      expect(crossSessionHistory.bindStagedCertifiedResourceAppend(
        crossSessionRoot!,
        installed.change,
        otherStore,
      )).toBeFalse()
      otherStore.dispose()
      combinedPresentation.dispose()
      store.dispose()
    }
  }, 30_000)

  test("fails closed on tamper, wrong receipt, base mismatch, and lost exact-snapshot evidence", () => {
    const fixture = certifiedAppendFixture(32)
    const patch = readCanvasCertifiedProjectionPatch(fixture.post, fixture.receipt)
    const cursor = createCanvasIndexedProjectionCursor({
      identity: fixture.baseIdentity,
      projection: fixture.baseProjection,
    })
    if (!patch || !cursor) throw new Error("certified fixture is unavailable")

    expect(
      readCanvasCertifiedProjectionPatch(fixture.post, {
        ...fixture.receipt,
        intentDigest: digest(999),
      }),
    ).toBeNull()

    const wrongBase = structuredClone(patch)
    wrongBase.baseStateCommitmentDigest = digest(998)
    expect(applyCanvasCertifiedProjectionPatch(cursor, wrongBase)).toEqual({ status: "base-mismatch" })

    const widened = structuredClone(patch) as typeof patch & { unexpected?: boolean }
    widened.unexpected = true
    expect(() => parseCanvasCertifiedProjectionPatch(widened)).toThrow()
    expect(applyCanvasCertifiedProjectionPatch(cursor, widened)).toEqual({ status: "rejected" })

    const changedIncarnation = structuredClone(patch)
    changedIncarnation.nodes[0]!.ref.incarnation = derivedNodeRef(context(995, 996, 3), parseUint32("0")).incarnation
    expect(applyCanvasCertifiedProjectionPatch(cursor, changedIncarnation)).toEqual({ status: "rejected" })

    // Weak identity is intentional: an equal reconstruction or late state has
    // no sealed validatePost evidence and must force a full owner query.
    const uncached = Object.freeze({ ...fixture.post }) as CanvasSnapshot
    expect(readCanvasCertifiedProjectionIdentity(uncached)).toBeNull()
    expect(readCanvasCertifiedProjectionPatch(uncached, fixture.receipt)).toBeNull()
    expect(parseCanvasCertifiedProjectionIdentity(fixture.baseIdentity)).toEqual(fixture.baseIdentity)
    expect(Object.isFrozen(parseCanvasCertifiedProjectionPatch(patch).nodes[0]!)).toBeTrue()
  })

  test("keeps an applied durable patch while a malformed hierarchy delta becomes sticky unavailable", () => {
    const fixture = certifiedAppendFixture(32)
    const patch = readCanvasCertifiedProjectionPatch(fixture.post, fixture.receipt)
    const store = createCanvasCertifiedRendererProjectionStore({
      identity: fixture.baseIdentity,
      projection: fixture.baseProjection,
      resourceHierarchy: hierarchySnapshot(fixture.baseIdentity, fixture.baseProjection),
    })
    if (!patch || !store) throw new Error("certified hierarchy fixture is unavailable")
    const installed = store.applyCertifiedProjectionPatch(patch, (change) => ({
      preparedResources: [],
      resourceHierarchy: {
        format: "convax.canvas-resource-hierarchy-delta",
        projectionIdentity: change.identity,
        entries: [],
      },
    }))
    expect(installed.status).toBe("applied")
    expect(store.resolveNode(patch.nodes[0]!.ref.id)).toBeDefined()
    expect(store.queryResourceHierarchy({ segments: ["notes"] })).toEqual({ status: "unavailable" })

    const resultProjection = projectCanvasDocument(projectCanvas(fixture.post))
    expect(store.resetProjection({
      identity: fixture.resultIdentity,
      projection: resultProjection,
      resourceHierarchy: hierarchySnapshot(fixture.resultIdentity, resultProjection),
    })).toBeTrue()
    expect(store.queryResourceHierarchy({ segments: ["notes"] })).toEqual({ status: "available", targets: [] })
    store.dispose()
  })

  test("keeps issuer and cache installation outside the public package surface", () => {
    expect("readCanvasCertifiedProjectionIdentity" in publicSurface).toBeTrue()
    expect("readCanvasCertifiedProjectionPatch" in publicSurface).toBeTrue()
    expect("applyCanvasCertifiedProjectionPatch" in publicSurface).toBeTrue()
    expect("createCanvasIndexedProjectionCursor" in publicSurface).toBeTrue()
    expect("parseCanvasCertifiedProjectionIdentity" in publicSurface).toBeTrue()
    expect("parseCanvasCertifiedProjectionPatch" in publicSurface).toBeTrue()
    expect("createCanvasCertifiedRendererProjectionStore" in publicSurface).toBeTrue()
    expect("parseCanvasRendererResourceHierarchySnapshot" in publicSurface).toBeTrue()
    expect("parseCanvasRendererResourceHierarchyDelta" in publicSurface).toBeTrue()
    expect("bindCanvasCertifiedProjectionRoot" in publicSurface).toBeFalse()
    expect("bindCanvasCertifiedProjectionPatch" in publicSurface).toBeFalse()
    expect("canvasCertifiedProjectionPatchWorkCounts" in publicSurface).toBeFalse()
    expect("canvasRendererProjectionStoreWorkCounts" in publicSurface).toBeFalse()
  })
})

function certifiedAppendFixture(entryCount: number, generationCount = 0) {
  const genesis = validateCanvasYDoc(newCanvas())
  const baseContext = context(930, 940, 1)
  const baseNodes = Array.from({ length: entryCount }, (_, index) => {
    const ordinal = parseUint32(String(index))
    const node = snapshotNode(
      baseContext,
      ordinal,
      { format: "convax.canvas-node-data", kind: "agent", title: `base-${index}`, instructions: null },
      { x: index * 400, y: 1_000 },
      "agent",
    )
    return [node.key, node] as const
  }).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
  const empty = <T>() => createCanvasSnapshotMap<T>([])
  const generationTarget = baseNodes[0]?.[1]
  const generationBegins = generationTarget
    ? Array.from({ length: generationCount }, (_, index) => {
        const generationContext = context(931, 941 + (index % 251), index + 2)
        const generationId = `g_${index.toString(36).padStart(43, "0")}`
        const begin: GenerationBeginV2 = Object.freeze({
          format: "convax.canvas-generation-begin/2",
          generationId,
          node: generationTarget.identity.ref,
          beginActorId: generationContext.actorId,
          beginAuthorizationEpochDigest: digest(942),
          beginStamp: makeStamp(generationContext, U0),
          outputClaimStamp: makeStamp(generationContext, parseUint32("1")),
          toolRefDigest: digest(943),
          prompt: `historical-${index}`,
          targetEffectiveDataDigest: digest(944),
          targetPluginDigest: null,
        })
        return [generationId, begin] as const
      })
    : []
  const base: CanvasSnapshot = Object.freeze({
    identity: genesis.identity,
    meta: genesis.meta,
    nodes: createCanvasSnapshotMap(baseNodes),
    edges: empty(),
    containments: empty(),
    generationBegins: createCanvasSnapshotMap(generationBegins),
    generationTerminals: empty(),
    generationDismissals: empty(),
    generationRecoveryFailures: empty(),
    semanticHistory: empty(),
    operations: empty(),
  })
  buildCanvasProjectionIndex(base)
  const baseProjection = projectCanvasDocument(projectCanvas(base))

  const appendContext = context(950, 960, 2)
  const appended = snapshotNode(
    appendContext,
    parseUint32("20000"),
    {
      format: "convax.canvas-node-data",
      kind: "resource",
      title: "Text",
      resource: textResource(),
    },
    { x: 0, y: 0 },
    "file",
  )
  const receipt: BoundedOperationReceipt = Object.freeze({
    format: "convax.canvas-operation-receipt",
    operationId: appendContext.operationId,
    actorId: appendContext.actorId,
    intentKind: "canvas.resources.add",
    intentDigest: appendContext.intentDigest,
    baseFrontierDigest: appendContext.baseFrontierDigest,
    resultEntities: Object.freeze([appended.identity.ref]),
    semanticRoot: true,
    historyMaterialDigest: digest(970),
  })
  const receiptKey = operationKey(receipt.actorId, receipt.operationId)
  const historyKey = historyRootKey(receipt.operationId)
  const historyRoot: SemanticHistoryRoot = Object.freeze({
    format: "convax.canvas-semantic-history-root",
    rootOperationId: receipt.operationId,
    sourceIntentKind: "canvas.resources.add",
    sourceIntentDigest: receipt.intentDigest,
    initialBindings: Object.freeze([]),
    inverseTemplate: Object.freeze([]),
    forwardTemplate: Object.freeze([]),
    retainedResources: Object.freeze([]),
    materialDigest: receipt.historyMaterialDigest!,
  })
  const post: CanvasSnapshot = Object.freeze({
    ...base,
    nodes: appendCanvasSnapshotEntries(base.nodes, [[appended.key, appended]]),
    semanticHistory: appendCanvasSnapshotEntries(base.semanticHistory, [[historyKey, historyRoot]]),
    operations: appendCanvasSnapshotEntries(base.operations, [[receiptKey, receipt]]),
  })
  const projectionWorkBeforeAppend = canvasProjectionBuildCounts()
  installCanvasResourceAppendProjectionIndex(base, post, [appended.key], [])
  const projectionWorkAfterAppend = canvasProjectionBuildCounts()
  const firstAppendObstacleIndexBuildVisits =
    projectionWorkAfterAppend.obstacleIndexBuildVisits - projectionWorkBeforeAppend.obstacleIndexBuildVisits
  const firstAppendHistoricalGenerationVisits =
    projectionWorkAfterAppend.historicalGenerationVisits - projectionWorkBeforeAppend.historicalGenerationVisits
  bindCanvasCertifiedProjectionRoot({
    snapshot: base,
    ownerSchemaDigest: SCHEMA_DIGEST,
    stateCommitmentDigest: digest(971),
  })
  bindCanvasCertifiedProjectionRoot({
    snapshot: post,
    ownerSchemaDigest: SCHEMA_DIGEST,
    stateCommitmentDigest: digest(972),
  })
  bindCanvasCertifiedProjectionPatch({
    base,
    result: post,
    changed: new Map([
      ["nodes", [appended.key]],
      ["operations", [receiptKey]],
      ["semanticHistory", [historyKey]],
    ]),
    receipt,
  })
  const baseIdentity = readCanvasCertifiedProjectionIdentity(base)
  const resultIdentity = readCanvasCertifiedProjectionIdentity(post)
  if (!baseIdentity || !resultIdentity) throw new Error("fixture roots are unavailable")
  return {
    base,
    post,
    receipt,
    baseIdentity,
    resultIdentity,
    baseProjection,
    firstAppendObstacleIndexBuildVisits,
    firstAppendHistoricalGenerationVisits,
  }
}

function snapshotNode(
  operationContext: ReturnType<typeof context>,
  ordinal: ReturnType<typeof parseUint32>,
  data: NodeDataEnvelope,
  position: { readonly x: number; readonly y: number },
  role: "agent" | "file",
): CanvasNodeSnapshot {
  const ref = derivedNodeRef(operationContext, ordinal)
  const claim = <T>(value: T) => Object.freeze({
    format: "convax.canvas-stamped-claim" as const,
    stamp: makeStamp(operationContext, ordinal),
    value,
  })
  const key = canvasEntityKey(ref)
  return Object.freeze({
    key,
    identity: Object.freeze({
      format: "convax.canvas-node-identity" as const,
      ref,
      role,
      createdBy: operationContext.operationId,
    }),
    position: Object.freeze([[operationContext.actorId, claim(Object.freeze({ ...position }))] as const]),
    size: Object.freeze([[operationContext.actorId, claim(Object.freeze({ width: 320, height: 180 }))] as const]),
    data: Object.freeze([[operationContext.actorId, claim(Object.freeze(data))] as const]),
    plugin: Object.freeze([[operationContext.actorId, claim(null)] as const]),
    tombstones: Object.freeze([]),
    creationGroup: null,
  })
}

function textResource(): CanvasResourceRef {
  return Object.freeze({
    format: "convax.canvas-resource-ref",
    uri: `convax-project://project/epochs/${context(1, 1, 1).operationId}/entries/pf_${"a".repeat(64)}`,
    mediaClass: "text",
    mime: "text/plain",
    byteLength: parseUint64("1"),
    contentDigest: digest(980),
    ownerProofDigest: digest(981),
  })
}

function sortedMapEntries<T>(value: ReadonlyMap<string, T>) {
  return [...value.entries()].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
}

function hierarchySnapshot(
  projectionIdentity: CanvasCertifiedProjectionIdentity,
  projection: CanvasDocumentProjection,
) {
  return {
    format: "convax.canvas-resource-hierarchy-snapshot" as const,
    projectionIdentity,
    completeness: "complete" as const,
    entries: projection.document.nodes.flatMap((node) => {
      if (canvasCanonicalResourceIdentity(node) === undefined) return []
      const entity = projection.nodeEntities.get(node.id)
      if (!entity) throw new Error("hierarchy fixture entity is unavailable")
      return [{ entity, nodeId: node.id, classification: { kind: "not-path-backed" as const } }]
    }),
  }
}

function hierarchyDelta(
  projectionIdentity: CanvasCertifiedProjectionIdentity,
  changes: CanvasAppliedProjectionPatchChanges,
) {
  const entities = new Map(changes.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
  return {
    format: "convax.canvas-resource-hierarchy-delta" as const,
    projectionIdentity,
    entries: changes.nodes.flatMap((node) => {
      if (canvasCanonicalResourceIdentity(node) === undefined) return []
      const entity = entities.get(node.id)
      if (!entity) throw new Error("hierarchy delta fixture entity is unavailable")
      return [{
        entity,
        nodeId: node.id,
        classification: {
          kind: "path" as const,
          key: { coverage: "leaf" as const, segments: ["notes", `${node.id}.md`] },
        },
      }]
    }),
  }
}
