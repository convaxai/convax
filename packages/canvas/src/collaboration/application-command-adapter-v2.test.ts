import { describe, expect, test } from "bun:test"
import type { CanvasApplicationCommand, CanvasApplicationCommandRequest } from "../application"
import { adaptCanvasApplicationCommandV2 } from "./application-command-adapter"
import { constructCanvasAuthoritativeIntentV2 } from "./command-construction"
import { applyOk, context, createAgent, newCanvas, VALID_FACTS } from "./test-fixtures.test"
import { derivedNodeRefV2 } from "./validation"
import { validateCanvasYDocV2 } from "./ydoc"
import { parseUint32V2 } from "@convax/collaboration"

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
    const groupRef = derivedNodeRefV2(groupContext, parseUint32V2("0"))

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
    applyAdapted(document, context(5, 4, 4), requireAdaptation(document, context(5, 4, 4), {
      type: "nodes.setGeometry",
      updates: [
        { nodeId: first.id, position: { x: 0, y: 0 } },
        { nodeId: second.id, position: { x: 100, y: 90 } },
        { nodeId: third.id, position: { x: 700, y: 210 } },
      ],
    }).command)

    for (const [operationContext, command] of [
      [context(5, 5, 5), { type: "nodes.distribute", axis: "horizontal", nodeIds: [first.id, second.id, third.id] }],
      [context(5, 6, 6), { type: "nodes.align", direction: "top", nodeIds: [first.id, second.id, third.id] }],
      [context(5, 7, 7), { type: "nodes.layout", layout: "vertical", gap: 50, nodeIds: [first.id, second.id, third.id] }],
      [context(5, 8, 8), { type: "canvas.auto-layout", nodeIds: [first.id, second.id, third.id] }],
    ] as const) {
      const mapped = requireAdaptation(document, operationContext, command)
      expect(mapped.command.kind).toBe("geometry-set")
      applyAdapted(document, operationContext, mapped.command)
    }
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
      { type: "resources.replace-generated", expectedTarget: target, item, operationId: "operation", targetNodeId: "node" },
      {
        type: "nodes.materialize-connected",
        node: { id: "node", type: "file", position: { x: 0, y: 0 }, data: { kind: "image", label: "Image" } },
        sourceKind: "image",
        sourceNodeId: "source",
      },
      {
        type: "resources.pending-generation.create",
        generation: { operationId: "operation", prompt: "prompt", toolId: "tool" },
        kind: "image",
        label: "Pending",
        nodeId: "node",
        placement: { anchor: { x: 0, y: 0 } },
      },
      { type: "generation.run.start", nodeId: "node", operationId: "operation", prompt: "prompt", toolId: "tool" },
      { type: "generation.run.mark-running", nodeId: "node", operationId: "operation" },
      { type: "generation.run.finish", nodeId: "node", operationId: "operation" },
      { type: "generation.runs.interrupt-inactive", liveRuns: [] },
    ]
    for (const command of unsupported) expect(adapt(document, context(3, 1, 1), command)).toBe("rejected")
  })

  test("rejects unknown actor kinds before constructing authority", () => {
    const document = newCanvas()
    const node = createAgent(document, context(4, 1, 1), "Node")
    expect(adapt(document, context(4, 2, 2), { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: [node.id] }, "host"))
      .toBe("rejected")
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
  return adaptCanvasApplicationCommandV2({
    request: request(command, actorKind),
    snapshot: validateCanvasYDocV2(document),
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
  command: Parameters<typeof constructCanvasAuthoritativeIntentV2>[0]["command"],
) {
  const constructed = constructCanvasAuthoritativeIntentV2({
    snapshot: validateCanvasYDocV2(document),
    context: operationContext,
    command,
  })
  if (constructed === "rejected") throw new Error("Adapted Canvas command did not construct")
  return applyOk(document, operationContext, constructed.intent, VALID_FACTS)
}
