import { describe, expect, test } from "bun:test"
import type { CanvasApplicationCommand, CanvasApplicationCommandRequest } from "../application"
import { createCanvasGenerationTargetGuard } from "../application"
import { getCanvasNodeGenerationRun } from "../generation-run"
import { getCanvasResourcePresentationSize } from "../media-sizing"
import { adaptCanvasApplicationCommand } from "./application-command-adapter"
import { constructCanvasAuthoritativeIntent } from "./command-construction"
import { applyOk, context, createAgent, createPendingFile, digest, newCanvas, VALID_FACTS } from "./test-fixtures.test"
import { derivedNodeRef } from "./validation"
import { validateCanvasYDoc } from "./ydoc"
import { projectCanvas, projectCanvasDocument } from "./projection"
import { materializeCanvasSemanticHistoryIntent } from "./reducer"
import type { CanvasResourceProofRef, CanvasSnapshot } from "./types"
import { parseUint32, parseUint64 } from "@convax/collaboration"

describe("Canvas v2 application command adapter", () => {
  test("maps move, connect, group, ungroup, and incident-closed removal to closed v2 intents", () => {
    const document = newCanvas()
    const first = createAgent(document, context(1, 1, 1), "First")
    const second = createAgent(document, context(1, 2, 2), "Second")

    const moveContext = context(1, 3, 3)
    const move = requireAdaptation(document, moveContext, {
      type: "nodes.move",
      delta: { x: 12, y: -3 },
      nodeIds: [first.id],
    })
    expect(move.command.kind).toBe("geometry-set")
    applyAdapted(document, moveContext, move.command)

    const connectContext = context(1, 4, 4)
    const connect = requireAdaptation(document, connectContext, {
      type: "nodes.connect",
      connection: { source: first.id, target: second.id, data: { label: "input" } },
    })
    expect(connect.command.kind).toBe("edge-connect")
    applyAdapted(document, connectContext, connect.command)

    const groupContext = context(1, 5, 5)
    const group = requireAdaptation(document, groupContext, {
      type: "nodes.group",
      nodeIds: [first.id, second.id],
      label: "Pair",
    })
    expect(group.command.kind).toBe("nodes-group")
    applyAdapted(document, groupContext, group.command)
    const groupRef = derivedNodeRef(groupContext, parseUint32("0"))

    const ungroupContext = context(1, 6, 6)
    const ungroup = requireAdaptation(document, ungroupContext, { type: "nodes.ungroup", nodeId: groupRef.id })
    expect(ungroup.command.kind).toBe("nodes-ungroup")
    applyAdapted(document, ungroupContext, ungroup.command)

    const removeContext = context(1, 7, 7)
    const remove = requireAdaptation(document, removeContext, { type: "elements.remove", nodeIds: [first.id] })
    expect(remove.command).toMatchObject({ kind: "elements-remove" })
    if (remove.command.kind !== "elements-remove") throw new Error("Expected removal mapping")
    expect(remove.command.nodes).toHaveLength(1)
    expect(remove.command.edges).toHaveLength(1)
    applyAdapted(document, removeContext, remove.command)
  })

  test("maps absolute geometry and rejects duplicate or empty mutations", () => {
    const document = newCanvas()
    const node = createAgent(document, context(2, 1, 1), "Node")
    const operationContext = context(2, 2, 2)
    const mapped = requireAdaptation(document, operationContext, {
      type: "nodes.setGeometry",
      updates: [{ nodeId: node.id, position: { x: 80, y: 90 }, size: { width: 300, height: 180 } }],
    })
    expect(mapped.command.kind).toBe("geometry-set")
    applyAdapted(document, operationContext, mapped.command)

    expect(adapt(document, context(2, 3, 3), { type: "nodes.setGeometry", updates: [] })).toBe("rejected")
    expect(adapt(document, context(2, 4, 4), { type: "elements.remove", nodeIds: ["missing"] })).toBe("rejected")
  })

  test("duplicates live nodes through one owner-derived typed intent", () => {
    const document = newCanvas()
    const source = createAgent(document, context(20, 1, 1), "Source")
    const target = createAgent(document, context(20, 2, 2), "Target")
    const connectContext = context(20, 3, 3)
    applyAdapted(
      document,
      connectContext,
      requireAdaptation(document, connectContext, {
        type: "nodes.connect",
        connection: { source: source.id, target: target.id },
      }).command,
    )
    const operationContext = context(20, 4, 4)
    const mapped = requireAdaptation(document, operationContext, {
      type: "nodes.duplicate",
      nodeIds: [source.id],
    })
    expect(mapped.command).toMatchObject({
      kind: "nodes-duplicate",
      sources: [source],
      offset: { x: 32, y: 32 },
    })
    applyAdapted(document, operationContext, mapped.command)

    const duplicate = derivedNodeRef(operationContext, parseUint32("0"))
    const projection = projectCanvas(validateCanvasYDoc(document))
    expect(projection.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: duplicate, data: expect.objectContaining({ title: "Source" }) }),
      ]),
    )
    expect(projection.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: duplicate, target })]))
    expect(adapt(document, context(20, 5, 5), { type: "nodes.duplicate", nodeIds: ["missing"] })).toBe("rejected")
  })

  test("duplicates a Group with its containment and persists folded state", () => {
    const document = newCanvas()
    const first = createAgent(document, context(21, 1, 1), "First")
    const second = createAgent(document, context(21, 2, 2), "Second")
    const groupContext = context(21, 3, 3)
    applyAdapted(
      document,
      groupContext,
      requireAdaptation(document, groupContext, {
        type: "nodes.group",
        nodeIds: [first.id, second.id],
        folded: true,
      }).command,
    )
    const group = derivedNodeRef(groupContext, parseUint32("0"))
    expect(
      projectCanvas(validateCanvasYDoc(document)).nodes.find((node) => node.ref.id === group.id)?.data,
    ).toMatchObject({
      kind: "group",
      folded: true,
    })

    const duplicateContext = context(21, 4, 4)
    const duplicate = requireAdaptation(document, duplicateContext, { type: "nodes.duplicate", nodeIds: [group.id] })
    if (duplicate.command.kind !== "nodes-duplicate") throw new Error("Expected duplicate mapping")
    expect(duplicate.command.sources).toHaveLength(3)
    applyAdapted(document, duplicateContext, duplicate.command)

    const clonedGroup = derivedNodeRef(duplicateContext, parseUint32("0"))
    const clonedFirst = derivedNodeRef(duplicateContext, parseUint32("1"))
    const clonedSecond = derivedNodeRef(duplicateContext, parseUint32("2"))
    const projection = projectCanvas(validateCanvasYDoc(document))
    expect(projection.nodes.find((node) => node.ref.id === clonedFirst.id)?.parent).toEqual(clonedGroup)
    expect(projection.nodes.find((node) => node.ref.id === clonedSecond.id)?.parent).toEqual(clonedGroup)

    const unfoldContext = context(21, 5, 5)
    applyAdapted(
      document,
      unfoldContext,
      requireAdaptation(document, unfoldContext, {
        type: "nodes.setFolded",
        nodeId: clonedGroup.id,
        folded: false,
      }).command,
    )
    expect(
      projectCanvas(validateCanvasYDoc(document)).nodes.find((node) => node.ref.id === clonedGroup.id)?.data,
    ).toEqual({
      format: "convax.canvas-node-data",
      kind: "group",
      title: "Group",
    })
  })

  test("unfolds a folded folder without an orphan Group across repeat, undo, redo, and projection restore", () => {
    const document = newCanvas()
    const first = createAgent(document, context(81, 1, 1), "First")
    const second = createAgent(document, context(81, 2, 2), "Second")
    const initialPositions = projectCanvas(validateCanvasYDoc(document)).nodes.map((node) => ({
      id: node.ref.id,
      position: node.position,
    }))

    const groupContext = context(81, 3, 3)
    applyAdapted(
      document,
      groupContext,
      requireAdaptation(document, groupContext, {
        type: "nodes.group",
        nodeIds: [first.id, second.id],
        folded: true,
      }).command,
    )
    const group = derivedNodeRef(groupContext, parseUint32("0"))
    expect(projectCanvas(validateCanvasYDoc(document)).nodes.filter((node) => node.data.kind === "group")).toHaveLength(
      1,
    )

    const unfoldContext = context(81, 4, 4)
    const unfoldRoot = applyAdapted(
      document,
      unfoldContext,
      requireAdaptation(document, unfoldContext, { type: "nodes.ungroup", nodeId: group.id }).command,
    ).semanticHistoryRoot
    if (!unfoldRoot) throw new Error("Unfold did not create semantic history")
    expectUngroupedProjection(document, initialPositions)

    const undoContext = context(81, 5, 5)
    const undo = materializeCanvasSemanticHistoryIntent(
      validateCanvasYDoc(document),
      undoContext,
      "undo",
      unfoldRoot.rootOperationId,
    )
    if (undo === "rejected") throw new Error("Unfold undo did not materialize")
    applyOk(document, undoContext, undo, VALID_FACTS)
    expect(projectCanvas(validateCanvasYDoc(document)).nodes.filter((node) => node.data.kind === "group")).toHaveLength(
      1,
    )

    const redoContext = context(81, 6, 6)
    const redo = materializeCanvasSemanticHistoryIntent(
      validateCanvasYDoc(document),
      redoContext,
      "redo",
      unfoldRoot.rootOperationId,
    )
    if (redo === "rejected") throw new Error("Unfold redo did not materialize")
    applyOk(document, redoContext, redo, VALID_FACTS)
    expectUngroupedProjection(document, initialPositions)

    const repeatedGroupContext = context(81, 7, 7)
    applyAdapted(
      document,
      repeatedGroupContext,
      requireAdaptation(document, repeatedGroupContext, {
        type: "nodes.group",
        nodeIds: [first.id, second.id],
        folded: true,
      }).command,
    )
    const repeatedGroup = derivedNodeRef(repeatedGroupContext, parseUint32("0"))
    const repeatedUnfoldContext = context(81, 8, 8)
    applyAdapted(
      document,
      repeatedUnfoldContext,
      requireAdaptation(document, repeatedUnfoldContext, {
        type: "nodes.ungroup",
        nodeId: repeatedGroup.id,
      }).command,
    )
    expectUngroupedProjection(document, initialPositions)
  })

  test("persists title, Group appearance, and generation preference through closed node-data intents", () => {
    const document = newCanvas()
    const first = createAgent(document, context(22, 1, 1), "First")
    const second = createAgent(document, context(22, 2, 2), "Second")
    const groupContext = context(22, 3, 3)
    applyAdapted(
      document,
      groupContext,
      requireAdaptation(document, groupContext, {
        type: "nodes.group",
        nodeIds: [first.id, second.id],
      }).command,
    )
    const group = derivedNodeRef(groupContext, parseUint32("0"))

    const appearanceContext = context(22, 4, 4)
    applyAdapted(
      document,
      appearanceContext,
      requireAdaptation(document, appearanceContext, {
        type: "nodes.setGroupAppearance",
        nodeId: group.id,
        appearance: { color: "blue", emoji: "rocket" },
      }).command,
    )
    const titleContext = context(22, 5, 5)
    applyAdapted(
      document,
      titleContext,
      requireAdaptation(document, titleContext, {
        type: "nodes.setTitle",
        nodeId: group.id,
        title: "Launch",
      }).command,
    )

    const pendingContext = context(22, 6, 6)
    applyAdapted(
      document,
      pendingContext,
      requireAdaptation(document, pendingContext, {
        type: "resources.pending.create",
        kind: "image",
        label: "Image",
        nodeId: "ignored",
        placement: { anchor: { x: 0, y: 0 } },
      }).command,
    )
    const pending = derivedNodeRef(pendingContext, parseUint32("0"))
    const preferenceContext = context(22, 7, 7)
    applyAdapted(
      document,
      preferenceContext,
      requireAdaptation(document, preferenceContext, {
        type: "nodes.setGenerationToolId",
        nodeId: pending.id,
        toolId: "plugin.example:image.generate",
      }).command,
    )

    const projection = projectCanvas(validateCanvasYDoc(document))
    expect(projection.nodes.find((node) => node.ref.id === group.id)?.data).toMatchObject({
      kind: "group",
      title: "Launch",
      appearance: { color: "blue", emoji: "rocket" },
    })
    expect(projection.nodes.find((node) => node.ref.id === pending.id)?.data).toMatchObject({
      generationToolId: "plugin.example:image.generate",
    })
    const rendered = projectCanvasDocument(projection).document
    expect(rendered.nodes.find((node) => node.id === group.id)?.data.metadata).toMatchObject({
      convaxGroupAppearance: { color: "blue", emoji: "rocket", schema: "convax.group-appearance/1" },
    })
    expect(rendered.nodes.find((node) => node.id === pending.id)?.data.metadata).toMatchObject({
      convaxGenerationPreference: {
        schema: "convax.node-generation-preference/1",
        toolId: "plugin.example:image.generate",
      },
    })
  })

  test("atomically maps connected Project resources and manual media placeholders", () => {
    const document = newCanvas()
    const anchor = createAgent(document, context(9, 1, 1), "Anchor")
    const resourceContext = context(9, 2, 2)
    const proof = currentResourceProof("text", 90)
    const resource = requireAdaptation(document, resourceContext, {
      type: "resources.add",
      items: [{ item: resourceItem("text", proof, "Notes/Brief.md"), nodeId: "caller-node-id" }],
      placement: { anchor: { x: 400, y: 120 } },
      relation: { anchorNodeIds: [anchor.id], direction: "from-anchor", mode: "connect" },
    })
    expect(resource.command).toMatchObject({
      kind: "resources-create",
      relation: { anchors: [anchor], direction: "from-anchor" },
    })
    applyAdapted(document, resourceContext, resource.command)
    const resourceNode = derivedNodeRef(resourceContext, parseUint32("0"))
    expect(projectCanvas(validateCanvasYDoc(document)).edges).toEqual([
      expect.objectContaining({ source: anchor, target: resourceNode }),
    ])

    const pendingContext = context(9, 3, 3)
    const pending = requireAdaptation(document, pendingContext, {
      type: "resources.pending.create",
      kind: "image",
      label: "Image",
      nodeId: "caller-pending-id",
      placement: { anchor: { x: -400, y: 120 } },
      relation: { anchorNodeIds: [anchor.id], direction: "to-anchor", mode: "connect" },
    })
    expect(pending.command).toMatchObject({
      kind: "manual-resource-placeholders-create",
      relation: { anchors: [anchor], direction: "to-anchor" },
    })
    applyAdapted(document, pendingContext, pending.command)
    const pendingNode = derivedNodeRef(pendingContext, parseUint32("0"))
    expect(projectCanvas(validateCanvasYDoc(document)).edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: pendingNode, target: anchor })]),
    )
  })

  test("maps an unrelated resource without traversing the existing Canvas projection", () => {
    const document = newCanvas()
    const snapshot = new Proxy(validateCanvasYDoc(document), {
      get(target, property, receiver) {
        if (property === "nodes" || property === "edges" || property === "operations") {
          throw new Error(`Unexpected Canvas projection read: ${String(property)}`)
        }
        return Reflect.get(target, property, receiver)
      },
    }) as CanvasSnapshot
    const proof = currentResourceProof("text", 91)
    const adaptation = adaptCanvasApplicationCommand({
      request: request({
        type: "resources.add",
        items: [{ item: resourceItem("text", proof, "Notes/Fast.md"), nodeId: "ignored" }],
        placement: { anchor: { x: 0, y: 0 } },
      }),
      snapshot,
      context: context(9, 4, 4),
    })
    expect(adaptation).not.toBe("rejected")
    expect(adaptation === "rejected" ? null : adaptation.command).toMatchObject({
      kind: "resources-create",
      relation: null,
    })
  })

  test("commits the Canvas-owned intrinsic media size in the first resource intent", () => {
    const document = newCanvas()
    const proof = currentResourceProof("image", 92)
    const adaptation = requireAdaptation(document, context(9, 5, 5), {
      type: "resources.add",
      items: [
        {
          item: { ...resourceItem("image", proof, "hero.png"), height: 900, width: 1_600 },
          nodeId: "ignored",
        },
      ],
      placement: { anchor: { x: 0, y: 0 } },
    })

    expect(adaptation.command).toMatchObject({
      kind: "resources-create",
      items: [{ size: { height: 180, width: 320 } }],
    })
  })

  test("rejects connected resource creation when an anchor is stale or duplicated", () => {
    const document = newCanvas()
    const anchor = createAgent(document, context(10, 1, 1), "Anchor")
    const command = {
      type: "resources.pending.create" as const,
      kind: "video" as const,
      label: "Video",
      nodeId: "caller-pending-id",
      placement: { anchor: { x: 400, y: 120 } },
    }
    expect(
      adapt(document, context(10, 2, 2), {
        ...command,
        relation: { anchorNodeIds: ["missing"], mode: "connect" },
      }),
    ).toBe("rejected")
    expect(
      adapt(document, context(10, 3, 3), {
        ...command,
        relation: { anchorNodeIds: [anchor.id, anchor.id], mode: "connect" },
      }),
    ).toBe("rejected")
  })

  test("maps one reparent command to the guarded structural-parent intent and rejects an unclosed batch", () => {
    const document = newCanvas()
    const child = createAgent(document, context(6, 1, 1), "Child")
    const sibling = createAgent(document, context(6, 2, 2), "Sibling")
    const groupContext = context(6, 3, 3)
    applyAdapted(
      document,
      groupContext,
      requireAdaptation(document, groupContext, {
        type: "nodes.group",
        nodeIds: [child.id, sibling.id],
        label: "Group",
      }).command,
    )

    const operationContext = context(6, 4, 4)
    const mapped = requireAdaptation(document, operationContext, {
      type: "nodes.reparent",
      nodeIds: [child.id],
    })
    expect(mapped.command).toMatchObject({ kind: "structural-parent-set", child, parent: null })
    applyAdapted(document, operationContext, mapped.command)

    expect(
      adapt(document, context(6, 5, 5), {
        type: "nodes.reparent",
        nodeIds: [child.id, "another-child"],
      }),
    ).toBe("rejected")
  })

  test("maps primitive and business layout planners to one guarded geometry intent", () => {
    const document = newCanvas()
    const first = createAgent(document, context(5, 1, 1), "First")
    const second = createAgent(document, context(5, 2, 2), "Second")
    const third = createAgent(document, context(5, 3, 3), "Third")
    applyAdapted(
      document,
      context(5, 4, 4),
      requireAdaptation(document, context(5, 4, 4), {
        type: "nodes.setGeometry",
        updates: [
          { nodeId: first.id, position: { x: 0, y: 0 } },
          { nodeId: second.id, position: { x: 100, y: 90 } },
          { nodeId: third.id, position: { x: 700, y: 210 } },
        ],
      }).command,
    )

    for (const [operationContext, command] of [
      [context(5, 5, 5), { type: "nodes.distribute", axis: "horizontal", nodeIds: [first.id, second.id, third.id] }],
      [context(5, 6, 6), { type: "nodes.align", direction: "top", nodeIds: [first.id, second.id, third.id] }],
      [
        context(5, 7, 7),
        { type: "nodes.layout", layout: "vertical", gap: 50, nodeIds: [first.id, second.id, third.id] },
      ],
      [context(5, 8, 8), { type: "canvas.auto-layout", nodeIds: [first.id, second.id, third.id] }],
    ] as const) {
      const mapped = requireAdaptation(document, operationContext, command)
      expect(mapped.command.kind).toBe("geometry-set")
      applyAdapted(document, operationContext, mapped.command)
    }
  })

  test("uses the Canvas presentation-size policy for pending resource defaults", () => {
    const document = newCanvas()
    for (const [index, kind] of (["text", "image", "video", "audio"] as const).entries()) {
      const manual = requireAdaptation(document, context(93, index + 1, index + 1), {
        type: "resources.pending.create",
        kind,
        label: `Pending ${kind}`,
        nodeId: `ignored-manual-${kind}`,
        placement: { anchor: { x: 0, y: 0 } },
      })
      expect(manual.command).toMatchObject({
        kind: "manual-resource-placeholders-create",
        items: [{ expectedClass: kind, size: getCanvasResourcePresentationSize(kind) }],
      })
    }
  })

  test("maps a proof-backed compatible file relink and applies the constructed intent", () => {
    const document = newCanvas()
    const node = createPendingFile(document, context(7, 1, 1), "Pending image")
    const proof = currentResourceProof("image", 70)
    const item = { ...resourceItem("image", proof, "Replacement.png"), height: 900, width: 1_600 }
    const operationContext = context(7, 2, 2)

    const mapped = requireAdaptation(document, operationContext, {
      type: "resources.relink",
      item,
      metadataKeysToRemove: ["projectResource"],
      nodeId: node.id,
    })
    expect(mapped.command).toEqual({
      kind: "resource-relink",
      node,
      title: "Replacement.png",
      proof,
    })
    const relinkRoot = applyAdapted(document, operationContext, mapped.command).semanticHistoryRoot
    if (!relinkRoot) throw new Error("Relink did not create semantic history")
    expect(relinkRoot.inverseTemplate.map((template) => template.op)).toEqual(["node.data"])
    expect(relinkRoot.forwardTemplate.map((template) => template.op)).toEqual(["node.data"])

    const projected = projectCanvas(validateCanvasYDoc(document)).nodes.find(
      (candidate) => candidate.ref.id === node.id,
    )
    expect(projected).toMatchObject({
      role: "file",
      size: { height: 120, width: 240 },
      data: {
        format: "convax.canvas-node-data",
        kind: "resource",
        title: "Replacement.png",
        resource: proof.resource,
      },
    })

    const undoContext = context(7, 3, 3)
    const undo = materializeCanvasSemanticHistoryIntent(
      validateCanvasYDoc(document),
      undoContext,
      "undo",
      relinkRoot.rootOperationId,
    )
    if (undo === "rejected") throw new Error("Relink undo did not materialize")
    applyOk(document, undoContext, undo, VALID_FACTS)
    const undone = projectCanvas(validateCanvasYDoc(document)).nodes.find((candidate) => candidate.ref.id === node.id)
    expect(undone).toMatchObject({
      size: { height: 120, width: 240 },
      data: { kind: "placeholder", title: "Pending image" },
    })
  })

  test("rejects relink without a current valid proof or with incompatible node and media classes", () => {
    const document = newCanvas()
    const file = createPendingFile(document, context(8, 1, 1), "Pending image")
    const agent = createAgent(document, context(8, 2, 2), "Agent")
    const imageProof = currentResourceProof("image", 80)
    const videoProof = currentResourceProof("video", 81)

    expect(
      adapt(document, context(8, 3, 3), {
        type: "resources.relink",
        item: { ...resourceItem("image", imageProof), metadata: {} },
        nodeId: file.id,
      }),
    ).toBe("rejected")
    expect(
      adapt(document, context(8, 4, 4), {
        type: "resources.relink",
        item: resourceItem("image", { ...imageProof, ownerProofDigest: digest(99) }),
        nodeId: file.id,
      }),
    ).toBe("rejected")
    expect(
      adapt(document, context(8, 5, 5), {
        type: "resources.relink",
        item: resourceItem("video", videoProof),
        nodeId: file.id,
      }),
    ).toBe("rejected")
    expect(
      adapt(document, context(8, 6, 6), {
        type: "resources.relink",
        item: resourceItem("video", imageProof),
        nodeId: file.id,
      }),
    ).toBe("rejected")
    expect(
      adapt(document, context(8, 7, 7), {
        type: "resources.relink",
        item: resourceItem("image", imageProof),
        nodeId: agent.id,
      }),
    ).toBe("rejected")
  })

  test("persists the portable generation run from pending creation through task receipt and generated replacement", () => {
    const document = newCanvas()
    const createContext = context(30, 1, 1)
    const created = requireAdaptation(document, createContext, {
      type: "resources.pending-generation.create",
      generation: { operationId: "generation-one", prompt: "Draw a fox", toolId: "plugin.example:image.generate" },
      kind: "image",
      label: "Pending image",
      nodeId: "caller-node-id",
      placement: { anchor: { x: 0, y: 0 } },
      size: { height: 206, width: 480 },
    })
    expect(created.command.kind).toBe("manual-resource-placeholders-create")
    expect(created.command.items[0]?.size).toEqual({ height: 206, width: 480 })
    applyAdapted(document, createContext, created.command)
    const node = derivedNodeRef(createContext, parseUint32("0"))
    let projected = projectCanvasDocument(projectCanvas(validateCanvasYDoc(document))).document
    expect(getCanvasNodeGenerationRun(projected.nodes[0]!)).toMatchObject({
      operationId: "generation-one",
      status: "submitting",
      toolId: "plugin.example:image.generate",
    })

    const runningContext = context(30, 2, 2)
    const running = requireAdaptation(document, runningContext, {
      type: "generation.run.mark-running",
      nodeId: node.id,
      operationId: "generation-one",
      taskId: "task_safe_123",
    })
    expect(running.command.kind).toBe("generation-runs-update")
    applyAdapted(document, runningContext, running.command)
    projected = projectCanvasDocument(projectCanvas(validateCanvasYDoc(document))).document
    const target = projected.nodes.find((candidate) => candidate.id === node.id)!
    expect(getCanvasNodeGenerationRun(target)).toMatchObject({ status: "running", taskId: "task_safe_123" })

    const proof = currentResourceProof("image", 95)
    const completeContext = context(30, 3, 3)
    const completed = requireAdaptation(document, completeContext, {
      type: "resources.replace-generated",
      expectedTarget: createCanvasGenerationTargetGuard(target),
      item: resourceItem("image", proof, "Generated/fox.png"),
      operationId: "generation-one",
      targetNodeId: node.id,
    })
    expect(completed.command.kind).toBe("generation-runs-update")
    applyAdapted(document, completeContext, completed.command)
    const output = projectCanvasDocument(projectCanvas(validateCanvasYDoc(document))).document.nodes[0]!
    expect(output.data.kind).toBe("image")
    expect(getCanvasNodeGenerationRun(output)).toMatchObject({
      operationId: "generation-one",
      status: "succeeded",
      taskId: "task_safe_123",
    })
  })

  test("maps existing-node start, failure, and startup interruption to non-undoable run updates", () => {
    const document = newCanvas()
    const first = createPendingFile(document, context(31, 1, 1), "First")
    const second = createPendingFile(document, context(31, 2, 2), "Second")
    for (const [position, node] of [first, second].entries()) {
      const before = projectCanvasDocument(projectCanvas(validateCanvasYDoc(document))).document.nodes.find(
        (candidate) => candidate.id === node.id,
      )!
      const targetGuard = createCanvasGenerationTargetGuard(before)
      const startContext = context(31, position + 3, position + 3)
      const started = requireAdaptation(document, startContext, {
        type: "generation.run.start",
        nodeId: node.id,
        operationId: `generation-${position}`,
        prompt: "prompt",
        toolId: "plugin.example:image.generate",
      })
      applyAdapted(document, startContext, started.command)
      const after = projectCanvasDocument(projectCanvas(validateCanvasYDoc(document))).document.nodes.find(
        (candidate) => candidate.id === node.id,
      )!
      expect(after.data.status).toBe("pending")
      expect(createCanvasGenerationTargetGuard(after)).toEqual(targetGuard)
    }
    const failureContext = context(31, 5, 5)
    applyAdapted(
      document,
      failureContext,
      requireAdaptation(document, failureContext, {
        type: "generation.run.finish",
        failureMessage: "Service failed",
        nodeId: first.id,
        operationId: "generation-0",
      }).command,
    )
    const interruptContext = context(31, 6, 6)
    const interrupted = requireAdaptation(document, interruptContext, {
      type: "generation.runs.interrupt-inactive",
      liveRuns: [],
    })
    expect(interrupted.command.kind).toBe("generation-runs-update")
    applyAdapted(document, interruptContext, interrupted.command)
    const projection = projectCanvasDocument(projectCanvas(validateCanvasYDoc(document))).document
    expect(projection.nodes.map((node) => getCanvasNodeGenerationRun(node)?.status)).toEqual(["failed", "failed"])
  })

  test("exhaustively rejects every remaining public command whose v2 proof contract is not frozen", () => {
    const document = newCanvas()
    const item = {
      id: "resource",
      kind: "image" as const,
      metadata: {},
      state: { status: "stale" as const },
    }
    const target = {
      type: "file" as const,
      data: { kind: "image", label: "Image", metadata: {} },
    }
    const unsupported: readonly CanvasApplicationCommand[] = [
      { type: "resources.pending.fail", expectedTarget: target, message: "Failed", targetNodeId: "node" },
      { type: "resources.add", items: [{ item, nodeId: "node" }], placement: { anchor: { x: 0, y: 0 } } },
      { type: "resources.relink", item, nodeId: "node" },
      { type: "resources.replace", expectedTarget: target, item, targetNodeId: "node" },
      {
        type: "nodes.materialize-connected",
        node: { id: "node", type: "file", position: { x: 0, y: 0 }, data: { kind: "image", label: "Image" } },
        sourceKind: "image",
        sourceNodeId: "source",
      },
    ]
    for (const command of unsupported) expect(adapt(document, context(3, 1, 1), command)).toBe("rejected")
  })

  test("rejects unknown actor kinds before constructing authority", () => {
    const document = newCanvas()
    const node = createAgent(document, context(4, 1, 1), "Node")
    expect(
      adapt(document, context(4, 2, 2), { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: [node.id] }, "host"),
    ).toBe("rejected")
  })
})

function request(command: CanvasApplicationCommand, actorKind = "ui"): CanvasApplicationCommandRequest {
  return {
    scopeId: "project",
    canvasId: "canvas",
    envelope: { actor: { id: "actor", kind: actorKind }, command, commandId: "command" },
  }
}

function adapt(
  document: ReturnType<typeof newCanvas>,
  operationContext: ReturnType<typeof context>,
  command: CanvasApplicationCommand,
  actorKind = "ui",
) {
  return adaptCanvasApplicationCommand({
    request: request(command, actorKind),
    snapshot: validateCanvasYDoc(document),
    context: operationContext,
  })
}

function requireAdaptation(
  document: ReturnType<typeof newCanvas>,
  operationContext: ReturnType<typeof context>,
  command: CanvasApplicationCommand,
) {
  const value = adapt(document, operationContext, command)
  if (value === "rejected") throw new Error(`Canvas application command unexpectedly rejected: ${command.type}`)
  return value
}

function applyAdapted(
  document: ReturnType<typeof newCanvas>,
  operationContext: ReturnType<typeof context>,
  command: Parameters<typeof constructCanvasAuthoritativeIntent>[0]["command"],
) {
  const constructed = constructCanvasAuthoritativeIntent({
    snapshot: validateCanvasYDoc(document),
    context: operationContext,
    command,
  })
  if (constructed === "rejected") throw new Error("Adapted Canvas command did not construct")
  return applyOk(document, operationContext, constructed.intent, VALID_FACTS)
}

function expectUngroupedProjection(
  document: ReturnType<typeof newCanvas>,
  expectedPositions: readonly Readonly<{ id: string; position: Readonly<{ x: number; y: number }> }>[],
) {
  const projection = projectCanvas(validateCanvasYDoc(document))
  expect(projection.nodes).toHaveLength(expectedPositions.length)
  expect(projection.nodes.some((node) => node.data.kind === "group")).toBe(false)
  expect(projection.nodes.map((node) => ({ id: node.ref.id, parent: node.parent, position: node.position }))).toEqual(
    expectedPositions.map((node) => ({ ...node, parent: null })),
  )
}

function currentResourceProof(
  mediaClass: "text" | "image" | "video" | "audio" | "file",
  seed: number,
): Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> {
  const ownerProofDigest = digest(seed)
  return {
    format: "convax.canvas-resource-proof-ref",
    mode: "current-owner-state",
    resource: {
      format: "convax.canvas-resource-ref",
      uri:
        `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
        `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${String(seed % 10).repeat(64)}` +
        `?blob=sha256%3A${String((seed + 1) % 10).repeat(64)}&path=Media%2Fresource.bin`,
      mediaClass,
      mime: mediaClass === "image" ? "image/png" : mediaClass === "video" ? "video/mp4" : "application/octet-stream",
      byteLength: parseUint64("12"),
      contentDigest: digest(seed + 1),
      ownerProofDigest,
    },
    ownerProofDigest,
    requireCurrentLiveVersion: true,
  }
}

function resourceItem(
  kind: "text" | "image" | "video" | "audio" | "file",
  proof: CanvasResourceProofRef,
  name = "Resource",
) {
  return {
    id: `resource-${kind}`,
    kind,
    metadata: { convaxCanvasResourceProof: proof },
    name,
    state: { status: "stale" as const },
  }
}
