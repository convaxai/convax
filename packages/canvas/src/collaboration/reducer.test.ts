import { describe, expect, test } from "bun:test"
import { comparePortableStamps, compareUtf8, parseUint32, parseUint64 } from "@convax/collaboration"
import {
  buildCanvasProjectionIndex,
  effectiveDataDigest,
  effectivePluginDigest,
  generationLifecycleCore,
  generationLifecycleDigest,
  geometryDigest,
  obstacleProjectionDigest,
  projectedGenerationDigestV2,
  projectionDigest,
} from "./projection"
import { applyCanvasCandidateIntent, materializeCanvasSemanticHistoryIntent } from "./reducer"
import { constructCanvasHistoryIntent } from "./command-construction"
import { discoverCanvasValueDependencies } from "./external-facts"
import type {
  CanvasExternalFactContext,
  CanvasHistoryBinding,
  CanvasSemanticOperation,
  CanvasTypedIntentUnion,
  PluginRequirement,
  PluginStateEnvelope,
  SemanticHistoryRoot,
  SemanticHistoryTransition,
} from "./types"
import {
  canvasDigest,
  canvasEntityKey,
  deriveCanvasId,
  derivedEdgeRef,
  derivedNodeRef,
  makeStamp,
} from "./validation"
import { encodeCanvasCanonicalState, validateCanvasYDoc } from "./ydoc"
import {
  applyOk,
  context,
  createAgent,
  createPendingFile,
  digest,
  fork,
  merge,
  newCanvas,
  nodeDataGuard,
  nodeLiveGuard,
  U0,
  VALID_FACTS,
} from "./test-fixtures.test"

const U1 = parseUint32("1")
const U2 = parseUint32("2")

describe("Canvas v2 reducer and merge invariants", () => {
  test("emits an exact sorted eight-write ledger for node create", () => {
    const document = newCanvas()
    const operationContext = context(1, 1, 1)
    const node = derivedNodeRef(operationContext, U0)
    const result = applyOk(document, operationContext, nodeCreate(operationContext, "ledger"))
    expect(result.actualWriteEvidence.changedPaths).toEqual([...result.actualWriteEvidence.changedPaths].sort())
    expect(result.actualWriteEvidence.changedPaths).toHaveLength(8)
    expect(result.actualWriteEvidence.writes).toHaveLength(8)
    expect(result.actualWriteEvidence.changedPaths).toContain(`nodes/${canvasEntityKey(node)}/creationGroup`)
    expect(result.actualWriteEvidence.changedPaths).toContain(`semanticHistory/root/${operationContext.operationId}`)
    expect(result.actualWriteEvidence.changedPaths).toContain(
      `operations/operation/${operationContext.actorId}/${operationContext.operationId}`,
    )
    expect(result.receipt.semanticRoot).toBeTrue()
    expect(result.receipt.historyMaterialDigest).toBe(result.semanticHistoryRoot!.materialDigest)
  })

  test("semantic inverse and forward use latest-state guards and recreate under a new incarnation", () => {
    const document = newCanvas()
    const rootContext = context(1, 40, 1)
    const original = derivedNodeRef(rootContext, U0)
    const rootResult = applyOk(document, rootContext, nodeCreate(rootContext, "history"))
    const root = rootResult.semanticHistoryRoot!
    const inverseTemplate = root.inverseTemplate[0]!
    expect(inverseTemplate.op).toBe("node.tombstone")
    if (inverseTemplate.op !== "node.tombstone") throw new Error("fixture history inverse is not node.tombstone")

    const undoContext = context(2, 41, 2)
    const inverseMaterial = {
      format: "convax.canvas-semantic-operation",
      template: inverseTemplate,
      materializedGuard: { op: "node.tombstone", guard: nodeLiveGuard(document, original) },
      derived: [],
      retainedResourceProofs: [],
    } as const
    const inverseOperation: CanvasSemanticOperation = {
      ...inverseMaterial,
      guardDigest: semanticGuardDigest(root, "inverse", inverseMaterial),
    }
    const undoGuard = semanticStateGuard(document, root)
    applyOk(document, undoContext, {
      format: "convax.typed-intent",
      kind: "canvas.undo.semantic-inverse",
      guard: { ...undoGuard, expectedMode: "applied" },
      body: { operations: [inverseOperation] },
    })
    expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes).toEqual([])

    const forwardTemplate = root.forwardTemplate[0]!
    expect(forwardTemplate.op).toBe("node.create")
    if (forwardTemplate.op !== "node.create") throw new Error("fixture history forward is not node.create")
    const redoContext = context(3, 42, 3)
    const recreated = derivedNodeRef(redoContext, U0)
    const forwardMaterial = {
      format: "convax.canvas-semantic-operation",
      template: forwardTemplate,
      materializedGuard: { op: "node.create", guard: null },
      derived: [{ kind: "node", handle: forwardTemplate.handle, ordinal: U0, ref: recreated }],
      retainedResourceProofs: [],
    } as const
    const forwardOperation: CanvasSemanticOperation = {
      ...forwardMaterial,
      guardDigest: semanticGuardDigest(root, "forward", forwardMaterial),
    }
    const redoGuard = semanticStateGuard(document, root)
    applyOk(document, redoContext, {
      format: "convax.typed-intent",
      kind: "canvas.redo.semantic-forward",
      guard: { ...redoGuard, expectedMode: "undone" },
      body: { operations: [forwardOperation] },
    })
    const projected = buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes
    expect(projected.map((node) => node.ref)).toEqual([recreated])
    expect(recreated).not.toEqual(original)
  })

  test("owner history materializer closes node create undo and redo without caller-authored guards", () => {
    const document = newCanvas()
    const rootContext = context(1, 45, 1)
    const root = applyOk(document, rootContext, nodeCreate(rootContext, "owner-materialized")).semanticHistoryRoot!
    const undoContext = context(2, 46, 2)
    const undo = materializeCanvasSemanticHistoryIntent(
      validateCanvasYDoc(document),
      undoContext,
      "undo",
      root.rootOperationId,
    )
    expect(undo).not.toBe("rejected")
    if (undo === "rejected" || undo.kind !== "canvas.undo.semantic-inverse") throw new Error("undo did not materialize")
    applyOk(document, undoContext, undo)
    expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes).toEqual([])

    const redoContext = context(3, 47, 3)
    const redo = materializeCanvasSemanticHistoryIntent(
      validateCanvasYDoc(document),
      redoContext,
      "redo",
      root.rootOperationId,
    )
    expect(redo).not.toBe("rejected")
    if (redo === "rejected" || redo.kind !== "canvas.redo.semantic-forward") throw new Error("redo did not materialize")
    applyOk(document, redoContext, redo)
    expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes).toHaveLength(1)
  })

  test("owner history materializer closes delete, move, connect and Plugin creation-group roots", () => {
    {
      const document = newCanvas()
      const node = createAgent(document, context(10, 100, 1), "delete")
      const root = applyOk(document, context(11, 101, 2), removeNode(document, node)).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(12, 102, 3), context(13, 103, 4))
      expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes).toEqual([])
    }
    {
      const document = newCanvas()
      const node = createAgent(document, context(20, 110, 1), "move")
      const moveContext = context(21, 111, 2)
      const root = applyOk(document, moveContext, {
        format: "convax.typed-intent",
        kind: "canvas.nodes.set-geometry",
        guard: { nodes: [{ ...nodeLiveGuard(document, node), expectedGeometryDigest: geometryDigestForTest(document, node) }] },
        body: { updates: [{ node, position: { x: 640, y: 320 }, size: null }] },
      }).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(22, 112, 3), context(23, 113, 4))
      expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).nodesByKey.get(canvasEntityKey(node))!.position).toEqual({ x: 640, y: 320 })
    }
    {
      const document = newCanvas()
      const source = createAgent(document, context(30, 120, 1), "source")
      const target = createAgent(document, context(31, 121, 2), "target")
      const root = connect(document, source, target, context(32, 122, 3)).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(33, 123, 4), context(34, 124, 5))
      expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.edges).toHaveLength(1)
    }
    {
      const document = newCanvas()
      const source = createAgent(document, context(40, 130, 1), "plugin-source")
      const pluginContext = context(41, 131, 2)
      const root = applyOk(document, pluginContext, creationGroupIntent(document, source, pluginContext)).semanticHistoryRoot!
      const redoContext = context(43, 133, 4)
      const roundTrip = materializedRoundTrip(document, root, context(42, 132, 3), redoContext)
      const dependencies = discoverCanvasValueDependencies(redoContext, roundTrip.redo)
      expect(dependencies === "rejected" ? [] : dependencies.validationArtifacts).toHaveLength(1)
      const projection = buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection
      expect(projection.nodes).toHaveLength(2)
      expect(projection.edges).toHaveLength(1)
    }
  })

  test("owner history materializer closes the remaining non-generation history families", () => {
    {
      const document = newCanvas()
      const createContext = context(50, 140, 1)
      createPendingFile(document, createContext, "pending-history")
      materializedRoundTrip(document, historyRootFor(document, createContext.operationId), context(51, 141, 2), context(52, 142, 3))
    }
    {
      const document = newCanvas()
      const node = createAgent(document, context(53, 143, 1), "data-before")
      const updateContext = context(54, 144, 2)
      const root = applyOk(document, updateContext, {
        format: "convax.typed-intent",
        kind: "canvas.nodes.update-data",
        guard: { node: nodeDataGuard(document, node), resourceProof: null },
        body: { node, data: { format: "convax.canvas-node-data", kind: "agent", title: "data-after", instructions: "updated" } },
      }).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(55, 145, 3), context(56, 146, 4))
    }
    {
      const document = newCanvas()
      const node = createAgent(document, context(57, 147, 1), "plugin-state")
      const plugin: PluginStateEnvelope = {
        format: "convax.canvas-plugin-state",
        pluginId: "plugin.state",
        snapshotDigest: digest(150),
        pluginStateSchemaDigest: digest(151),
        validationArtifact: { owner: "plugin", format: "convax.plugin-validation-artifact", artifactDigest: digest(152) },
        state: { enabled: true },
      }
      const pluginContext = context(58, 148, 2)
      const root = applyOk(document, pluginContext, {
        format: "convax.typed-intent",
        kind: "canvas.nodes.set-plugin-state",
        guard: { node: {
          ...nodeLiveGuard(document, node),
          expectedPluginDigest: null,
          requirement: {
            pluginId: plugin.pluginId,
            snapshotDigest: plugin.snapshotDigest,
            pluginStateSchemaDigest: plugin.pluginStateSchemaDigest,
            validationArtifact: plugin.validationArtifact,
          },
        } },
        body: { node, plugin },
      }).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(59, 149, 3), context(60, 150, 4))
    }
    {
      const document = newCanvas()
      const child = createAgent(document, context(61, 151, 1), "parent-child")
      const group = createGroup(document, child, context(62, 152, 2), "parent-group")
      const parentContext = context(63, 153, 3)
      const root = applyOk(document, parentContext, {
        format: "convax.typed-intent",
        kind: "canvas.nodes.set-structural-parent",
        guard: { child: { ...nodeLiveGuard(document, child), expectedOwnSlotDigest: null }, parent: null },
        body: { child, parent: null, relationId: deriveCanvasId("relation", parentContext, U0) },
      }).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(64, 154, 4), context(65, 155, 5))
      expect(group.kind).toBe("node")
    }
    {
      const document = newCanvas()
      const child = createAgent(document, context(66, 156, 1), "group-child")
      const groupContext = context(67, 157, 2)
      createGroup(document, child, groupContext, "group-root")
      materializedRoundTrip(document, historyRootFor(document, groupContext.operationId), context(68, 158, 3), context(69, 159, 4))
    }
    {
      const document = newCanvas()
      const child = createAgent(document, context(70, 160, 1), "ungroup-child")
      const group = createGroup(document, child, context(71, 161, 2), "ungroup-root")
      const ungroupContext = context(72, 162, 3)
      const root = applyOk(document, ungroupContext, {
        format: "convax.typed-intent",
        kind: "canvas.nodes.ungroup",
        guard: {
          group: nodeLiveGuard(document, group),
          children: [{ ...nodeLiveGuard(document, child), expectedOwnSlotDigest: null }],
          expectedEffectiveChildSetDigest: canvasDigest("convax.canvas-effective-child-set", {
            format: "convax.canvas-effective-child-set",
            group,
            children: [child],
          }),
        },
        body: { group, children: [child], nullRelationIds: [deriveCanvasId("relation", ungroupContext, U0)] },
      }).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(73, 163, 4), context(74, 164, 5))
    }
    {
      const document = newCanvas()
      const metadataContext = context(75, 165, 1)
      const root = applyOk(document, metadataContext, {
        format: "convax.typed-intent",
        kind: "canvas.metadata.update",
        guard: { fields: [{ field: "title", expectedEffectiveDigest: canvasDigest("convax.canvas-metadata-effective", { format: "convax.canvas-metadata-effective", field: "title", value: null }), expectedOwnSlotDigest: null }] },
        body: { fields: [{ field: "title", value: "Collaborative Canvas" }] },
      }).semanticHistoryRoot!
      materializedRoundTrip(document, root, context(76, 166, 2), context(77, 167, 3))
    }
    {
      const document = newCanvas()
      const resourceContext = context(78, 168, 1)
      const node = derivedNodeRef(resourceContext, U0)
      const resource = {
        format: "convax.canvas-resource-ref" as const,
        uri: `convax-project://project/epochs/${context(1, 1, 1).operationId}/entries/pf_${"3".repeat(64)}`,
        mediaClass: "image" as const,
        mime: "image/png",
        byteLength: parseUint64("12"),
        contentDigest: digest(170),
        ownerProofDigest: digest(171),
      }
      const root = applyOk(document, resourceContext, {
        format: "convax.typed-intent",
        kind: "canvas.resources.add",
        guard: {
          existingEndpoints: [],
          derivedNodes: [{ ordinal: U0, node, expectedAbsent: true }],
          derivedEdges: [],
          resourceProofs: [{ createdNodeOrdinal: U0, proof: { format: "convax.canvas-resource-proof-ref", mode: "current-owner-state", resource, ownerProofDigest: resource.ownerProofDigest, requireCurrentLiveVersion: true } }],
        },
        body: {
          placement: { anchor: { x: 0, y: 0 }, gap: 24, obstacleProjectionDigest: obstacleProjectionDigest(validateCanvasYDoc(document)) },
          nodes: [{ ordinal: U0, nodeId: node.id, incarnation: node.incarnation, size: { width: 240, height: 120 }, title: "resource-history", resource }],
          edges: [],
        },
      }).semanticHistoryRoot!
      const undoContext = context(79, 169, 2)
      const undo = materializeCanvasSemanticHistoryIntent(
        validateCanvasYDoc(document),
        undoContext,
        "undo",
        root.rootOperationId,
      )
      if (undo === "rejected") throw new Error("resource history undo did not materialize")
      applyOk(document, undoContext, undo)
      const redoContext = context(80, 170, 3)
      const redo = materializeCanvasSemanticHistoryIntent(
        validateCanvasYDoc(document),
        redoContext,
        "redo",
        root.rootOperationId,
      )
      if (redo === "rejected") throw new Error("resource history redo did not materialize")
      const dependencies = discoverCanvasValueDependencies(redoContext, redo)
      if (dependencies === "rejected") throw new Error("resource history dependencies were rejected")
      expect(dependencies.externalFacts).toHaveLength(1)
      const constructed = constructCanvasHistoryIntent({
        snapshot: validateCanvasYDoc(document),
        context: redoContext,
        direction: "redo",
        rootOperationId: root.rootOperationId,
        externalFacts: {
          resolveArtifact: (artifact) => ({ status: "rejected", code: "artifact-not-declared", ref: artifact } as never),
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
          consumedDependencies: () => dependencies,
        },
      })
      expect(typeof constructed).not.toBe("string")
      if (typeof constructed === "string") throw new Error(`resource history construction ${constructed}`)
      const retainedProof = constructed.intent.body.operations[0]?.retainedResourceProofs[0]
      if (!retainedProof) throw new Error("resource history construction omitted its retained proof")
      const tamperedCandidate = fork(document)
      const beforeTamper = encodeCanvasCanonicalState(tamperedCandidate)
      const tamperedIntent = {
        ...constructed.intent,
        body: {
          operations: constructed.intent.body.operations.map((operation, index) =>
            index === 0
              ? {
                  ...operation,
                  retainedResourceProofs: [
                    { ...retainedProof, sourceDataDigest: digest(249) },
                  ],
                }
              : operation,
          ),
        },
      } as CanvasTypedIntentUnion
      expect(applyCanvasCandidateIntent(tamperedCandidate, redoContext, tamperedIntent, VALID_FACTS)).toBe("rejected")
      expect(encodeCanvasCanonicalState(tamperedCandidate)).toEqual(beforeTamper)
      applyOk(document, redoContext, constructed.intent)
    }
  })

  test("pending-generation history never restarts work and restores only a retained terminal lifecycle", () => {
    const document = newCanvas()
    const rootContext = context(81, 171, 1)
    const node = derivedNodeRef(rootContext, U0)
    const generationId = deriveCanvasId("generation", rootContext, U0)
    const pendingData = {
      format: "convax.canvas-node-data" as const,
      kind: "placeholder" as const,
      owner: "generation" as const,
      title: "pending-generation-history",
      expectedClass: "image" as const,
    }
    const begin = {
      format: "convax.canvas-generation-begin/2" as const,
      generationId,
      node,
      beginActorId: rootContext.actorId,
      beginAuthorizationEpochDigest: digest(172),
      beginStamp: makeStamp(rootContext, parseUint32("5")),
      outputClaimStamp: makeStamp(rootContext, parseUint32("6")),
      toolRefDigest: digest(173),
      prompt: "generate once",
      targetEffectiveDataDigest: canvasDigest("convax.canvas-effective-data", { format: "convax.canvas-effective-data", data: pendingData }),
      targetPluginDigest: null,
    }
    const root = applyOk(document, rootContext, {
      format: "convax.typed-intent",
      kind: "canvas.resources.pending-generation.create",
      guard: { existingEndpoints: [], derivedNode: { ordinal: U0, node, expectedAbsent: true }, derivedEdges: [] },
      body: {
        placement: { anchor: { x: 0, y: 0 }, gap: 24, obstacleProjectionDigest: obstacleProjectionDigest(validateCanvasYDoc(document)) },
        node: { ordinal: U0, nodeId: node.id, incarnation: node.incarnation, size: { width: 240, height: 120 }, title: pendingData.title, expectedClass: pendingData.expectedClass },
        edges: [],
        begin,
      },
    }).semanticHistoryRoot!
    const lifecycleBase = validateCanvasYDoc(document)
    const terminalContext = context(81, 172, 2)
    applyOk(document, terminalContext, {
      format: "convax.typed-intent",
      kind: "canvas.generation.fail",
      guard: {
        ...nodeLiveGuard(document, node),
        generationId,
        beginDigest: canvasDigest("convax.canvas-generation-begin/2", begin),
        expectedLifecycleDigest: generationLifecycleDigest(lifecycleBase, generationId),
        expectedTerminalDigest: null,
        expectedDismissalDigest: null,
        expectedRecoveryFailureDigest: null,
      },
      body: { terminal: {
        format: "convax.canvas-generation-terminal/2",
        phase: "failed",
        generationId,
        node,
        beginDigest: canvasDigest("convax.canvas-generation-begin/2", begin),
        beginActorId: rootContext.actorId,
        failureCode: "generation-failed",
        publicMessage: null,
      } },
    })
    materializedRoundTrip(document, root, context(83, 173, 3), context(84, 174, 4))
    const restored = buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes[0]!
    expect(restored.data).toMatchObject({ kind: "placeholder", owner: "manual-pending", state: { phase: "failed" } })
    expect(validateCanvasYDoc(document).generationBegins.size).toBe(1)
  })

  test("semantic inverse rejects a new incident edge without changing the candidate", () => {
    const document = newCanvas()
    const rootContext = context(1, 50, 1)
    const node = derivedNodeRef(rootContext, U0)
    const root = applyOk(document, rootContext, nodeCreate(rootContext, "root")).semanticHistoryRoot!
    const other = createAgent(document, context(2, 51, 2), "other")
    connect(document, node, other, context(3, 52, 3))
    const template = root.inverseTemplate[0]!
    if (template.op !== "node.tombstone") throw new Error("fixture history inverse is not node.tombstone")
    const operationMaterial = {
      format: "convax.canvas-semantic-operation",
      template,
      materializedGuard: { op: "node.tombstone", guard: nodeLiveGuard(document, node) },
      derived: [],
      retainedResourceProofs: [],
    } as const
    const operation: CanvasSemanticOperation = {
      ...operationMaterial,
      guardDigest: semanticGuardDigest(root, "inverse", operationMaterial),
    }
    const before = encodeCanvasCanonicalState(document)
    expect(
      applyCanvasCandidateIntent(
        document,
        context(4, 53, 4),
        {
          format: "convax.typed-intent",
          kind: "canvas.undo.semantic-inverse",
          guard: { ...semanticStateGuard(document, root), expectedMode: "applied" },
          body: { operations: [operation] },
        },
        VALID_FACTS,
      ),
    ).toBe("rejected")
    expect(encodeCanvasCanonicalState(document)).toEqual(before)
  })

  test("concurrent semantic forwards retain both facts but project only the deterministic winner", () => {
    const document = newCanvas()
    const rootContext = context(1, 60, 1)
    const original = derivedNodeRef(rootContext, U0)
    const root = applyOk(document, rootContext, nodeCreate(rootContext, "concurrent-redo")).semanticHistoryRoot!
    applyOk(document, context(2, 61, 2), semanticUndoIntent(document, root, original))

    const left = fork(document)
    const right = fork(document)
    const leftContext = context(3, 62, 3)
    const rightContext = context(4, 63, 3)
    const leftRef = derivedNodeRef(leftContext, U0)
    const rightRef = derivedNodeRef(rightContext, U0)
    applyOk(left, leftContext, semanticRedoIntent(document, root, leftContext))
    applyOk(right, rightContext, semanticRedoIntent(document, root, rightContext))

    const first = merge(document, [left, right], [0, 1])
    const second = merge(document, [left, right], [1, 0], 1)
    expect(encodeCanvasCanonicalState(first)).toEqual(encodeCanvasCanonicalState(second))
    const projected = buildCanvasProjectionIndex(validateCanvasYDoc(first)).projection.nodes
    expect(projected).toHaveLength(1)
    expect([leftRef, rightRef]).toContainEqual(projected[0]!.ref)
    expect(validateCanvasYDoc(first).nodes.size).toBe(3)
  })

  test("permutations and duplicate delivery of independent frames converge", () => {
    const base = newCanvas()
    const left = fork(base)
    const right = fork(base)
    createAgent(left, context(1, 1, 1), "left")
    createAgent(right, context(2, 2, 1), "right")
    const branches = [left, right]
    const schedules = [
      merge(base, branches, [0, 1]),
      merge(base, branches, [1, 0]),
      merge(base, branches, [0, 1], 0),
      merge(base, branches, [1, 0], 1),
    ]
    const expected = encodeCanvasCanonicalState(schedules[0]!)
    const projection = projectionDigest(validateCanvasYDoc(schedules[0]!))
    for (const document of schedules) {
      expect(encodeCanvasCanonicalState(document)).toEqual(expected)
      expect(projectionDigest(validateCanvasYDoc(document))).toBe(projection)
      expect(buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes).toHaveLength(2)
    }
  })

  test("node delete versus concurrent edge create retains but hides the edge", () => {
    const base = newCanvas()
    const source = createAgent(base, context(1, 1, 1), "source")
    const target = createAgent(base, context(2, 2, 2), "target")
    const edgeContext = context(3, 3, 3)
    const edge = derivedEdgeRef(edgeContext, U0)
    const edgeBranch = fork(base)
    applyOk(edgeBranch, edgeContext, {
      format: "convax.typed-intent",
      kind: "canvas.edges.connect",
      guard: {
        edge: { ordinal: U0, edge, expectedAbsent: true },
        source: { ...nodeLiveGuard(base, source), expectedConnectable: true },
        target: { ...nodeLiveGuard(base, target), expectedConnectable: true },
      },
      body: {
        edge: {
          ordinal: U0,
          edgeId: edge.id,
          incarnation: edge.incarnation,
          source,
          target,
          data: { format: "convax.canvas-edge-data", kind: "business", label: null },
        },
      },
    })
    const deleteBranch = fork(base)
    applyOk(deleteBranch, context(4, 4, 3), removeNode(base, source))

    for (const order of [
      [0, 1],
      [1, 0],
    ] as const) {
      const merged = merge(base, [edgeBranch, deleteBranch], order)
      const snapshot = validateCanvasYDoc(merged)
      expect(snapshot.edges.has(canvasEntityKey(edge))).toBeTrue()
      expect(buildCanvasProjectionIndex(snapshot).projection.edges).toEqual([])
      expect(buildCanvasProjectionIndex(snapshot).projection.nodes.map((node) => node.ref)).toEqual([target])
    }
  })

  test("removing a structural group captures surviving children as external containment targets", () => {
    const document = newCanvas()
    const child = createAgent(document, context(1, 70, 1), "child")
    const group = createGroup(document, child, context(2, 71, 2), "group")
    const result = applyOk(document, context(3, 72, 3), removeNode(document, group))
    const containment = result.semanticHistoryRoot!.inverseTemplate.find(
      (template) => template.op === "containment.set" && template.child.mode === "external",
    )
    expect(containment).toEqual({
      op: "containment.set",
      child: { mode: "external", ref: child },
      parent: { mode: "handle", handle: "n/0" },
    })
    const projectedChild = buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection.nodes.find(
      (node) => canvasEntityKey(node.ref) === canvasEntityKey(child),
    )!
    expect(projectedChild.parent).toBeNull()
  })

  test("Plugin artifact pending writes nothing and concurrent source delete hides the whole creation group", () => {
    const base = newCanvas()
    const source = createAgent(base, context(1, 1, 1), "source")
    const pluginContext = context(2, 2, 2)
    const pluginIntent = creationGroupIntent(base, source, pluginContext)
    const pending = fork(base)
    const before = encodeCanvasCanonicalState(pending)
    const pendingFacts: CanvasExternalFactContext = { ...VALID_FACTS, validatePluginArtifact: () => "pending" }
    expect(applyCanvasCandidateIntent(pending, pluginContext, pluginIntent, pendingFacts)).toBe("pending")
    expect(encodeCanvasCanonicalState(pending)).toEqual(before)
    const mismatched = fork(base)
    const mismatchedIntent = structuredClone(pluginIntent) as typeof pluginIntent
    ;(mismatchedIntent.body.nodes[0]!.plugin as { validationArtifact: unknown }).validationArtifact = {
      ...mismatchedIntent.body.nodes[0]!.plugin!.validationArtifact,
      artifactDigest: digest(99),
    }
    expect(applyCanvasCandidateIntent(mismatched, pluginContext, mismatchedIntent, VALID_FACTS)).toBe("rejected")
    expect(encodeCanvasCanonicalState(mismatched)).toEqual(before)

    const pluginBranch = fork(base)
    applyOk(pluginBranch, pluginContext, pluginIntent)
    const deleteBranch = fork(base)
    applyOk(deleteBranch, context(3, 3, 2), removeNode(base, source))
    const schedules = [
      merge(base, [pluginBranch, deleteBranch], [0, 1]),
      merge(base, [pluginBranch, deleteBranch], [1, 0], 0),
    ]
    const expected = encodeCanvasCanonicalState(schedules[0]!)
    for (const merged of schedules) {
      const snapshot = validateCanvasYDoc(merged)
      expect(encodeCanvasCanonicalState(merged)).toEqual(expected)
      expect(snapshot.nodes.size).toBe(2)
      expect(snapshot.edges.size).toBe(1)
      expect(buildCanvasProjectionIndex(snapshot).projection.nodes).toEqual([])
      expect(buildCanvasProjectionIndex(snapshot).projection.edges).toEqual([])
    }
  })

  test("delete wins over a late generation terminal without discarding lifecycle facts", () => {
    const document = newCanvas()
    const node = createPendingFile(document, context(1, 1, 1), "pending")
    const beginContext = context(4, 20, 2)
    const baseSnapshot = validateCanvasYDoc(document)
    const record = baseSnapshot.nodes.get(canvasEntityKey(node))!
    const generationId = deriveCanvasId("generation", beginContext, U0)
    const begin = {
      format: "convax.canvas-generation-begin/2" as const,
      generationId,
      node,
      beginActorId: beginContext.actorId,
      beginAuthorizationEpochDigest: digest(90),
      beginStamp: makeStamp(beginContext, U0),
      outputClaimStamp: makeStamp(beginContext, U1),
      toolRefDigest: digest(91),
      prompt: "generate",
      targetEffectiveDataDigest: effectiveDataDigest(baseSnapshot, record),
      targetPluginDigest: effectivePluginDigest(record),
    }
    applyOk(document, beginContext, {
      format: "convax.typed-intent",
      kind: "canvas.generation.begin",
      guard: {
        ...nodeDataGuard(document, node),
        expectedPluginDigest: null,
        expectedProjectedGenerationDigest: projectedGenerationDigestV2(baseSnapshot, node),
      },
      body: { begin },
    })
    const causalBase = fork(document)
    const deleteBranch = fork(causalBase)
    applyOk(deleteBranch, context(5, 21, 3), removeNode(causalBase, node))
    const terminalBranch = fork(causalBase)
    const terminalContext = context(4, 22, 3)
    const lifecycleBase = validateCanvasYDoc(causalBase)
    const lifecycle = generationLifecycleCore(lifecycleBase, generationId)
    const terminal = {
      format: "convax.canvas-generation-terminal/2" as const,
      phase: "failed" as const,
      generationId,
      node,
      beginDigest: canvasDigest("convax.canvas-generation-begin/2", begin),
      beginActorId: beginContext.actorId,
      failureCode: "failed",
      publicMessage: null,
    }
    applyOk(terminalBranch, terminalContext, {
      format: "convax.typed-intent",
      kind: "canvas.generation.fail",
      guard: {
        ...nodeLiveGuard(causalBase, node),
        generationId,
        beginDigest: terminal.beginDigest,
        expectedLifecycleDigest: generationLifecycleDigest(lifecycleBase, generationId),
        expectedTerminalDigest: null,
        expectedDismissalDigest: lifecycle.dismissal === null ? null : digest(1),
        expectedRecoveryFailureDigest: lifecycle.recoveryFailure === null ? null : digest(1),
      },
      body: { terminal },
    })
    const merged = merge(causalBase, [deleteBranch, terminalBranch], [1, 0], 1)
    const snapshot = validateCanvasYDoc(merged)
    expect(snapshot.generationTerminals.size).toBe(1)
    expect(buildCanvasProjectionIndex(snapshot).projection.nodes).toEqual([])
  })

  test("dismissal outranks a surviving success and suppresses its output claim", () => {
    const document = newCanvas()
    const node = createPendingFile(document, context(1, 1, 1), "original-placeholder")
    const beginContext = context(7, 30, 2)
    const before = validateCanvasYDoc(document)
    const record = before.nodes.get(canvasEntityKey(node))!
    const generationId = deriveCanvasId("generation", beginContext, U0)
    const begin = {
      format: "convax.canvas-generation-begin/2" as const,
      generationId,
      node,
      beginActorId: beginContext.actorId,
      beginAuthorizationEpochDigest: digest(101),
      beginStamp: makeStamp(beginContext, U0),
      outputClaimStamp: makeStamp(beginContext, U1),
      toolRefDigest: digest(102),
      prompt: "generate",
      targetEffectiveDataDigest: effectiveDataDigest(before, record),
      targetPluginDigest: null,
    }
    applyOk(document, beginContext, {
      format: "convax.typed-intent",
      kind: "canvas.generation.begin",
      guard: {
        ...nodeDataGuard(document, node),
        expectedPluginDigest: null,
        expectedProjectedGenerationDigest: projectedGenerationDigestV2(before, node),
      },
      body: { begin },
    })
    const active = validateCanvasYDoc(document)
    const canonicalResource = {
      format: "convax.canvas-resource-ref" as const,
      uri: `convax-project://project/epochs/${context(1, 1, 1).operationId}/entries/pf_${"1".repeat(64)}`,
      mediaClass: "image" as const,
      mime: "image/png",
      byteLength: parseUint64("10"),
      contentDigest: digest(103),
      ownerProofDigest: digest(104),
    }
    const proof = {
      format: "convax.canvas-resource-proof-ref" as const,
      mode: "current-owner-state" as const,
      resource: canonicalResource,
      ownerProofDigest: canonicalResource.ownerProofDigest,
      requireCurrentLiveVersion: true as const,
    }
    const beginDigest = canvasDigest("convax.canvas-generation-begin/2", begin)
    const completeContext = context(7, 31, 3)
    applyOk(document, completeContext, {
      format: "convax.typed-intent",
      kind: "canvas.generation.complete",
      guard: {
        ...nodeLiveGuard(document, node),
        generationId,
        beginDigest,
        expectedLifecycleDigest: generationLifecycleDigest(active, generationId),
        expectedTerminalDigest: null,
        expectedDismissalDigest: null,
        expectedRecoveryFailureDigest: null,
        resourceProof: proof,
      },
      body: {
        terminal: {
          format: "convax.canvas-generation-terminal/2",
          phase: "succeeded",
          generationId,
          node,
          beginDigest,
          beginActorId: beginContext.actorId,
          outputData: {
            format: "convax.canvas-node-data",
            kind: "resource",
            title: "generated",
            resource: canonicalResource,
          },
          outputProofDigest: canonicalResource.ownerProofDigest,
        },
      },
    })
    expect(
      buildCanvasProjectionIndex(validateCanvasYDoc(document)).nodesByKey.get(canvasEntityKey(node))!.data.kind,
    ).toBe("resource")
    const completed = validateCanvasYDoc(document)
    const terminal = generationLifecycleCore(completed, generationId).terminal!
    const dismissContext = context(8, 32, 4)
    applyOk(document, dismissContext, {
      format: "convax.typed-intent",
      kind: "canvas.generation.dismiss",
      guard: {
        ...nodeLiveGuard(document, node),
        generationId,
        beginDigest,
        expectedLifecycleDigest: generationLifecycleDigest(completed, generationId),
        expectedTerminalDigest: canvasDigest("convax.canvas-generation-terminal/2", terminal),
        expectedDismissalDigest: null,
        expectedRecoveryFailureDigest: null,
      },
      body: {
        dismissal: { format: "convax.canvas-generation-dismissal/2", generationId, beginDigest, marker: "dismissed" },
      },
    })
    const projected = buildCanvasProjectionIndex(validateCanvasYDoc(document)).nodesByKey.get(
      canvasEntityKey(node),
    )!
    expect(projected.generationLifecycle).toBe("dismissed")
    expect(projected.data.kind).toBe("placeholder")
  })

  test("structural containment cycles project deterministically while business edge cycles remain live", () => {
    const base = newCanvas()
    const childA = createAgent(base, context(1, 1, 1), "a")
    const childB = createAgent(base, context(2, 2, 2), "b")
    const childC = createAgent(base, context(3, 3, 3), "c")
    const groupA = createGroup(base, childA, context(4, 4, 4), "A")
    const groupB = createGroup(base, childB, context(5, 5, 5), "B")
    const groupC = createGroup(base, childC, context(6, 6, 6), "C")
    const pairs = [
      [groupA, groupB],
      [groupB, groupC],
      [groupC, groupA],
    ] as const
    const branches = pairs.map(([child, parent], index) => {
      const branch = fork(base)
      const operationContext = context(10 + index, 10 + index, 10)
      applyOk(branch, operationContext, {
        format: "convax.typed-intent",
        kind: "canvas.nodes.set-structural-parent",
        guard: {
          child: { ...nodeLiveGuard(base, child), expectedOwnSlotDigest: null },
          parent: nodeLiveGuard(base, parent),
        },
        body: { child, parent, relationId: deriveCanvasId("relation", operationContext, U0) },
      })
      return branch
    })
    const first = merge(base, branches, [0, 1, 2])
    const second = merge(base, branches, [2, 0, 1], 2)
    expect(encodeCanvasCanonicalState(first)).toEqual(encodeCanvasCanonicalState(second))
    const firstIndex = buildCanvasProjectionIndex(validateCanvasYDoc(first))
    expect(
      [...firstIndex.selectedContainments.values()].filter((choice) => choice?.parent !== null && choice !== null),
    ).toHaveLength(5)

    const business = fork(base)
    connect(business, groupChild(base, childA), groupChild(base, childB), context(20, 20, 20))
    connect(business, groupChild(base, childB), groupChild(base, childA), context(21, 21, 21))
    expect(buildCanvasProjectionIndex(validateCanvasYDoc(business)).projection.edges).toHaveLength(2)
  })
})

function semanticGuardDigest(
  root: SemanticHistoryRoot,
  direction: "inverse" | "forward",
  operation: Pick<CanvasSemanticOperation, "template" | "materializedGuard">,
) {
  return canvasDigest("convax.canvas-semantic-guard", {
    format: "convax.canvas-semantic-guard",
    rootOperationId: root.rootOperationId,
    direction,
    operationIndex: U0,
    template: operation.template,
    materializedGuard: operation.materializedGuard,
  })
}

function materializedRoundTrip(
  document: ReturnType<typeof newCanvas>,
  root: SemanticHistoryRoot,
  undoContext: ReturnType<typeof context>,
  redoContext: ReturnType<typeof context>,
) {
  const undo = materializeCanvasSemanticHistoryIntent(validateCanvasYDoc(document), undoContext, "undo", root.rootOperationId)
  if (undo === "rejected" || undo.kind !== "canvas.undo.semantic-inverse") throw new Error("history undo did not materialize")
  applyOk(document, undoContext, undo)
  const redo = materializeCanvasSemanticHistoryIntent(validateCanvasYDoc(document), redoContext, "redo", root.rootOperationId)
  if (redo === "rejected" || redo.kind !== "canvas.redo.semantic-forward") throw new Error("history redo did not materialize")
  applyOk(document, redoContext, redo)
  return { undo, redo }
}

function historyRootFor(document: ReturnType<typeof newCanvas>, operationId: string): SemanticHistoryRoot {
  const value = validateCanvasYDoc(document).semanticHistory.get(`root/${operationId}`)
  if (value?.format !== "convax.canvas-semantic-history-root") throw new Error("history root is absent")
  return value
}

function geometryDigestForTest(document: ReturnType<typeof newCanvas>, node: ReturnType<typeof derivedNodeRef>) {
  return geometryDigest(validateCanvasYDoc(document).nodes.get(canvasEntityKey(node))!)
}

function semanticStateGuard(document: ReturnType<typeof newCanvas>, root: SemanticHistoryRoot) {
  const snapshot = validateCanvasYDoc(document)
  const receipt = [...snapshot.operations.values()].find((candidate) => candidate.operationId === root.rootOperationId)!
  const entries = [...snapshot.semanticHistory.entries()]
    .filter(
      (entry): entry is [string, SemanticHistoryTransition] =>
        entry[1].format === "convax.canvas-semantic-history-transition" &&
        entry[1].rootOperationId === root.rootOperationId,
    )
    .sort((left, right) => compareUtf8(left[0], right[0]))
  const transitions = entries.map(([, transition]) => transition)
  const effective = entries.reduce<(typeof entries)[number] | null>((winner, candidate) => {
    if (winner === null) return candidate
    const stampOrder = comparePortableStamps(winner[1].stamp, candidate[1].stamp)
    return stampOrder < 0 || (stampOrder === 0 && compareUtf8(winner[0], candidate[0]) < 0) ? candidate : winner
  }, null)?.[1]
  const effectiveBindings: readonly CanvasHistoryBinding[] = effective?.resultBindings ?? root.initialBindings
  const effectiveMode = effective?.mode === "undone" ? "undone" : "applied"
  const expectedRootReceiptDigest = canvasDigest("convax.canvas-operation-receipt", receipt)
  const expectedHistoryRootDigest = canvasDigest("convax.canvas-semantic-history-root", root)
  return {
    rootOperationId: root.rootOperationId,
    expectedRootReceiptDigest,
    expectedHistoryRootDigest,
    expectedHistoryStateDigest: canvasDigest("convax.canvas-semantic-history-state", {
      format: "convax.canvas-semantic-history-state",
      rootReceiptDigest: expectedRootReceiptDigest,
      historyRootDigest: expectedHistoryRootDigest,
      transitions,
      effectiveTransitionOperationId: effective?.transitionOperationId ?? null,
      effectiveMode,
      effectiveBindings,
    }),
  }
}

function semanticUndoIntent(
  document: ReturnType<typeof newCanvas>,
  root: SemanticHistoryRoot,
  node: ReturnType<typeof derivedNodeRef>,
): Extract<CanvasTypedIntentUnion, { kind: "canvas.undo.semantic-inverse" }> {
  const template = root.inverseTemplate[0]!
  if (template.op !== "node.tombstone") throw new Error("fixture history inverse is not node.tombstone")
  const material = {
    format: "convax.canvas-semantic-operation",
    template,
    materializedGuard: { op: "node.tombstone", guard: nodeLiveGuard(document, node) },
    derived: [],
    retainedResourceProofs: [],
  } as const
  return {
    format: "convax.typed-intent",
    kind: "canvas.undo.semantic-inverse",
    guard: { ...semanticStateGuard(document, root), expectedMode: "applied" },
    body: { operations: [{ ...material, guardDigest: semanticGuardDigest(root, "inverse", material) }] },
  }
}

function semanticRedoIntent(
  document: ReturnType<typeof newCanvas>,
  root: SemanticHistoryRoot,
  operationContext: ReturnType<typeof context>,
): Extract<CanvasTypedIntentUnion, { kind: "canvas.redo.semantic-forward" }> {
  const template = root.forwardTemplate[0]!
  if (template.op !== "node.create") throw new Error("fixture history forward is not node.create")
  const material = {
    format: "convax.canvas-semantic-operation",
    template,
    materializedGuard: { op: "node.create", guard: null },
    derived: [{ kind: "node", handle: template.handle, ordinal: U0, ref: derivedNodeRef(operationContext, U0) }],
    retainedResourceProofs: [],
  } as const
  return {
    format: "convax.typed-intent",
    kind: "canvas.redo.semantic-forward",
    guard: { ...semanticStateGuard(document, root), expectedMode: "undone" },
    body: { operations: [{ ...material, guardDigest: semanticGuardDigest(root, "forward", material) }] },
  }
}

function nodeCreate(
  operationContext: ReturnType<typeof context>,
  title: string,
): Extract<CanvasTypedIntentUnion, { kind: "canvas.agent.create" }> {
  const node = derivedNodeRef(operationContext, U0)
  return {
    format: "convax.typed-intent",
    kind: "canvas.agent.create",
    guard: { ordinal: U0, node, expectedAbsent: true },
    body: {
      node: {
        ordinal: U0,
        nodeId: node.id,
        incarnation: node.incarnation,
        role: "agent",
        position: { x: 0, y: 0 },
        size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data", kind: "agent", title, instructions: null },
        plugin: null,
      },
    },
  }
}

function removeNode(
  document: ReturnType<typeof newCanvas>,
  node: ReturnType<typeof derivedNodeRef>,
): Extract<CanvasTypedIntentUnion, { kind: "canvas.elements.remove" }> {
  return {
    format: "convax.typed-intent",
    kind: "canvas.elements.remove",
    guard: { nodes: [nodeLiveGuard(document, node)], edges: [], requireObservedIncidentEdgeClosure: true },
    body: { nodes: [node], edges: [] },
  }
}

function creationGroupIntent(
  document: ReturnType<typeof newCanvas>,
  source: ReturnType<typeof derivedNodeRef>,
  operationContext: ReturnType<typeof context>,
): Extract<CanvasTypedIntentUnion, { kind: "canvas.plugin.creation-group.create" }> {
  const node = derivedNodeRef(operationContext, U1)
  const edge = derivedEdgeRef(operationContext, U2)
  const requirement: PluginRequirement = {
    pluginId: "plugin.image",
    snapshotDigest: digest(30),
    pluginStateSchemaDigest: digest(31),
    validationArtifact: {
      owner: "plugin",
      format: "convax.plugin-validation-artifact",
      artifactDigest: digest(32),
    },
  }
  const plugin: PluginStateEnvelope = {
    format: "convax.canvas-plugin-state",
    ...requirement,
    state: { task: "render" },
  }
  return {
    format: "convax.typed-intent",
    kind: "canvas.plugin.creation-group.create",
    guard: {
      source: nodeDataGuard(document, source),
      pluginRequirement: requirement,
      derivedNodes: [{ ordinal: U1, node, expectedAbsent: true }],
      derivedEdges: [{ ordinal: U2, edge, expectedAbsent: true }],
      resourceProofs: [],
    },
    body: {
      groupOrdinal: U0,
      source,
      nodes: [
        {
          ordinal: U1,
          nodeId: node.id,
          incarnation: node.incarnation,
          role: "agent",
          position: { x: 300, y: 0 },
          size: { width: 240, height: 120 },
          data: { format: "convax.canvas-node-data", kind: "agent", title: "result", instructions: null },
          plugin,
        },
      ],
      edges: [
        {
          ordinal: U2,
          edgeId: edge.id,
          incarnation: edge.incarnation,
          source,
          target: { createdNodeOrdinal: U1 },
          data: { format: "convax.canvas-edge-data", kind: "business", label: null },
        },
      ],
    },
  }
}

function createGroup(
  document: ReturnType<typeof newCanvas>,
  child: ReturnType<typeof derivedNodeRef>,
  operationContext: ReturnType<typeof context>,
  title: string,
) {
  const group = derivedNodeRef(operationContext, U0)
  const projectedChild = buildCanvasProjectionIndex(validateCanvasYDoc(document)).nodesByKey.get(
    canvasEntityKey(child),
  )!
  const groupPosition = { x: projectedChild.position.x - 20, y: projectedChild.position.y - 20 }
  const groupSize = { width: projectedChild.size.width + 40, height: projectedChild.size.height + 40 }
  const expectedGeometryPlanDigest = canvasDigest("convax.canvas-group-geometry-plan", {
    format: "convax.canvas-group-geometry-plan",
    children: [{ node: child, position: projectedChild.position, size: projectedChild.size }],
    groupPosition,
    groupSize,
  })
  applyOk(document, operationContext, {
    format: "convax.typed-intent",
    kind: "canvas.nodes.group",
    guard: {
      group: { ordinal: U0, node: group, expectedAbsent: true },
      children: [{ ...nodeLiveGuard(document, child), expectedOwnSlotDigest: null }],
      expectedGeometryPlanDigest,
    },
    body: {
      group: {
        ordinal: U0,
        nodeId: group.id,
        incarnation: group.incarnation,
        role: "file",
        position: groupPosition,
        size: groupSize,
        data: { format: "convax.canvas-node-data", kind: "group", title },
        plugin: null,
      },
      children: [child],
      relationIds: [deriveCanvasId("relation", operationContext, U1)],
    },
  })
  return group
}

function connect(
  document: ReturnType<typeof newCanvas>,
  source: ReturnType<typeof derivedNodeRef>,
  target: ReturnType<typeof derivedNodeRef>,
  operationContext: ReturnType<typeof context>,
) {
  const edge = derivedEdgeRef(operationContext, U0)
  return applyOk(document, operationContext, {
    format: "convax.typed-intent",
    kind: "canvas.edges.connect",
    guard: {
      edge: { ordinal: U0, edge, expectedAbsent: true },
      source: { ...nodeLiveGuard(document, source), expectedConnectable: true },
      target: { ...nodeLiveGuard(document, target), expectedConnectable: true },
    },
    body: {
      edge: {
        ordinal: U0,
        edgeId: edge.id,
        incarnation: edge.incarnation,
        source,
        target,
        data: { format: "convax.canvas-edge-data", kind: "business", label: null },
      },
    },
  })
}

function groupChild(_document: ReturnType<typeof newCanvas>, child: ReturnType<typeof derivedNodeRef>) {
  return child
}
