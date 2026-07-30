import { describe, expect, test } from "bun:test"

import {
  applyCanvasApplicationCommand,
  CanvasCommandValidationError,
  createCanvasGenerationTargetGuard,
  createCanvasPendingGenerationResourceCommand,
} from "./application/commands"
import { duplicateCanvasSelection } from "./commands"
import { createAgentNode, createCanvasDocument, createMediaNode, parseCanvasDocument } from "./document"
import {
  canvasNodeGenerationPreferenceKey,
  canvasNodeGenerationPreferenceSchema,
  getCanvasNodeGenerationToolId,
  setCanvasNodeGenerationToolId,
} from "./generation-preference"
import {
  CanvasNodeGenerationRunValidationError,
  canvasNodeGenerationRunKey,
  canvasNodeGenerationRunSchema,
  canvasNodeGenerationRunSchemaV1,
  canvasNodeGenerationRunSchemaV2,
  finishCanvasNodeGenerationRun,
  getCanvasNodeGenerationRun,
  inspectCanvasNodeGenerationRun,
  interruptInactiveCanvasNodeGenerationRuns,
  markCanvasNodeGenerationRunRunning,
  maximumCanvasGenerationPromptLength,
  startCanvasNodeGenerationRun,
} from "./generation-run"

function imageNode(metadata: Record<string, unknown> = {}) {
  return createMediaNode({
    id: "image-one",
    position: { x: 10, y: 20 },
    resource: {
      id: "resource-one",
      kind: "image",
      metadata,
      mimeType: "image/png",
      name: "before.png",
      state: { status: "ready", url: "convax://before" },
    },
  })
}

function document(metadata: Record<string, unknown> = {}) {
  return createCanvasDocument({ id: "canvas-one", nodes: [imageNode(metadata)], title: "Canvas" })
}

function start(input = document()) {
  return startCanvasNodeGenerationRun(input, "image-one", {
    operationId: "operation-one",
    prompt: "Draw a fox",
    toolId: "creative-tools/image.generate",
  })
}

describe("Canvas node generation run", () => {
  test("round-trips valid state while preserving unknown and invalid schemas without defaults", () => {
    const valid = start()
    const parsed = parseCanvasDocument(JSON.parse(JSON.stringify(valid)), valid.id)
    expect(parsed).not.toBeNull()
    expect(getCanvasNodeGenerationRun(parsed!.nodes[0]!)).toEqual({
      operationId: "operation-one",
      prompt: "Draw a fox",
      schema: canvasNodeGenerationRunSchema,
      status: "submitting",
      toolId: "creative-tools/image.generate",
    })

    for (const raw of [
      { schema: "convax.node-generation-run/99", future: true },
      { schema: canvasNodeGenerationRunSchema, operationId: "bad path/id" },
    ]) {
      const source = document({ [canvasNodeGenerationRunKey]: raw })
      const roundTrip = parseCanvasDocument(JSON.parse(JSON.stringify(source)), source.id)
      expect(
        (roundTrip?.nodes[0]?.data.metadata as Record<string, unknown> | undefined)?.[
          canvasNodeGenerationRunKey
        ],
      ).toEqual(raw)
      expect(inspectCanvasNodeGenerationRun(roundTrip!.nodes[0]!)).toMatchObject({ kind: "unreadable" })
      expect(() => startCanvasNodeGenerationRun(roundTrip!, "image-one", {
        operationId: "new-operation",
        prompt: "Do not overwrite",
        toolId: "creative-tools/image.generate",
      })).toThrow(CanvasNodeGenerationRunValidationError)
    }
  })

  test("migrates readable v1 and v2 runs to v3 without overwriting unknown schemas", () => {
    const source = document({
      [canvasNodeGenerationRunKey]: {
        operationId: "legacy-operation",
        prompt: "Legacy prompt",
        schema: canvasNodeGenerationRunSchemaV1,
        status: "running",
        taskId: "legacy_task",
        toolId: "creative-tools/image.generate",
      },
    })
    expect(getCanvasNodeGenerationRun(source.nodes[0]!)).toEqual({
      operationId: "legacy-operation",
      prompt: "Legacy prompt",
      schema: canvasNodeGenerationRunSchema,
      status: "running",
      taskId: "legacy_task",
      toolId: "creative-tools/image.generate",
    })

    const terminal = document({
      [canvasNodeGenerationRunKey]: {
        operationId: "legacy-terminal",
        prompt: "Legacy failed prompt",
        schema: canvasNodeGenerationRunSchemaV1,
        status: "failed",
        toolId: "creative-tools/image.generate",
      },
    })
    expect(getCanvasNodeGenerationRun(terminal.nodes[0]!)).toMatchObject({
      retrySafety: "unknown",
      schema: canvasNodeGenerationRunSchema,
      status: "failed",
    })

    const v2 = document({
      [canvasNodeGenerationRunKey]: {
        operationId: "version-two-operation",
        prompt: "Version two prompt",
        retrySafety: "safe",
        schema: canvasNodeGenerationRunSchemaV2,
        status: "failed",
        toolId: "creative-tools/image.generate",
      },
    })
    expect(getCanvasNodeGenerationRun(v2.nodes[0]!)).toEqual({
      operationId: "version-two-operation",
      prompt: "Version two prompt",
      retrySafety: "safe",
      schema: canvasNodeGenerationRunSchema,
      status: "failed",
      toolId: "creative-tools/image.generate",
    })
  })

  test("persists an empty editable prompt for a prompt-context-only run", () => {
    const running = startCanvasNodeGenerationRun(document(), "image-one", {
      operationId: "context-only-operation",
      prompt: "",
      toolId: "creative-tools/image.generate",
    })
    expect(getCanvasNodeGenerationRun(running.nodes[0]!)).toEqual({
      operationId: "context-only-operation",
      prompt: "",
      schema: canvasNodeGenerationRunSchema,
      status: "submitting",
      toolId: "creative-tools/image.generate",
    })

    const legacyEmpty = document({
      [canvasNodeGenerationRunKey]: {
        operationId: "legacy-empty-operation",
        prompt: "",
        schema: canvasNodeGenerationRunSchemaV2,
        status: "running",
        toolId: "creative-tools/image.generate",
      },
    })
    expect(inspectCanvasNodeGenerationRun(legacyEmpty.nodes[0]!)).toMatchObject({ kind: "unreadable" })
  })

  test("keeps next-run preference separate from the resolved historical tool", () => {
    const source = document({
      [canvasNodeGenerationPreferenceKey]: {
        schema: canvasNodeGenerationPreferenceSchema,
        toolId: "creative-tools/next-model",
      },
    })
    const running = startCanvasNodeGenerationRun(source, "image-one", {
      operationId: "operation-one",
      prompt: "Resolved with the previous default",
      toolId: "creative-tools/actual-model",
    })
    expect(getCanvasNodeGenerationToolId(running.nodes[0]!)).toBe("creative-tools/next-model")
    expect(getCanvasNodeGenerationRun(running.nodes[0]!)?.toolId).toBe("creative-tools/actual-model")
  })

  test("enforces legal, idempotent and operation-bound transitions", () => {
    const submitting = start()
    const running = markCanvasNodeGenerationRunRunning(submitting, "image-one", "operation-one")
    expect(getCanvasNodeGenerationRun(running.nodes[0]!)?.status).toBe("running")
    expect(markCanvasNodeGenerationRunRunning(running, "image-one", "operation-one")).toBe(running)

    const receipted = markCanvasNodeGenerationRunRunning(running, "image-one", "operation-one", "task_123")
    expect(getCanvasNodeGenerationRun(receipted.nodes[0]!)?.taskId).toBe("task_123")
    expect(markCanvasNodeGenerationRunRunning(receipted, "image-one", "operation-one", "task_123")).toBe(
      receipted,
    )
    expect(() =>
      markCanvasNodeGenerationRunRunning(receipted, "image-one", "operation-one", "task_456"),
    ).toThrow("different task id")
    expect(() => markCanvasNodeGenerationRunRunning(receipted, "image-one", "other-operation")).toThrow(
      "does not own",
    )

    for (const status of ["failed", "cancelled", "interrupted"] as const) {
      const terminal = finishCanvasNodeGenerationRun(receipted, "image-one", "operation-one", status, "safe")
      expect(getCanvasNodeGenerationRun(terminal.nodes[0]!)?.status).toBe(status)
      expect(getCanvasNodeGenerationRun(terminal.nodes[0]!)?.retrySafety).toBe("safe")
      expect(() => markCanvasNodeGenerationRunRunning(terminal, "image-one", "operation-one")).toThrow(
        "cannot return",
      )
      expect(() => finishCanvasNodeGenerationRun(terminal, "image-one", "operation-one", status, "safe")).toThrow(
        "already terminal",
      )
      expect(() =>
        startCanvasNodeGenerationRun(terminal, "image-one", {
          operationId: `retry-${status}`,
          prompt: "Retry prompt",
          toolId: "creative-tools/image.generate",
        }),
      ).not.toThrow()
    }
  })

  test("blocks a fresh operation after an indeterminate terminal state until safety is proven", () => {
    const interrupted = finishCanvasNodeGenerationRun(
      markCanvasNodeGenerationRunRunning(start(), "image-one", "operation-one"),
      "image-one",
      "operation-one",
      "interrupted",
      "unknown",
    )
    expect(() =>
      startCanvasNodeGenerationRun(interrupted, "image-one", {
        operationId: "new-operation",
        prompt: "Could charge twice",
        toolId: "creative-tools/image.generate",
      }),
    ).toThrow("retry safety is unknown")
  })

  test("bounds prompt, task identifiers and the complete serialized record", () => {
    expect(() =>
      startCanvasNodeGenerationRun(document(), "image-one", {
        operationId: "operation-one",
        prompt: "x".repeat(maximumCanvasGenerationPromptLength + 1),
        toolId: "creative-tools/image.generate",
      }),
    ).toThrow("prompt is invalid")
    expect(() =>
      markCanvasNodeGenerationRunRunning(start(), "image-one", "operation-one", "https://vendor.example/task/1"),
    ).toThrow("task id is invalid")
    expect(() =>
      markCanvasNodeGenerationRunRunning(start(), "image-one", "operation-one", "/Users/example/private-task"),
    ).toThrow("task id is invalid")
    expect(() =>
      markCanvasNodeGenerationRunRunning(start(), "image-one", "operation-one", "token:secret-value"),
    ).toThrow("task id is invalid")

    expect(() =>
      startCanvasNodeGenerationRun(document(), "image-one", {
        operationId: "operation-one",
        prompt: "\u0001".repeat(maximumCanvasGenerationPromptLength),
        toolId: "creative-tools/image.generate",
      }),
    ).toThrow("run is invalid")
  })

  test("atomically creates a pending owner with submitting state and terminalizes its presentation", () => {
    const created = applyCanvasApplicationCommand(
      createCanvasDocument({ id: "canvas-one", title: "Canvas" }),
      createCanvasPendingGenerationResourceCommand({
        anchor: { x: 20, y: 30 },
        generation: {
          operationId: "operation-pending",
          prompt: "Create an image",
          toolId: "creative-tools/image.generate",
        },
        kind: "image",
        label: "Generated image",
      }),
    )
    const nodeId = created.createdNodeIds[0]!
    const node = created.document.nodes.find((candidate) => candidate.id === nodeId)!
    expect(node.data.status).toBe("pending")
    expect(getCanvasNodeGenerationRun(node)).toMatchObject({
      operationId: "operation-pending",
      status: "submitting",
      toolId: "creative-tools/image.generate",
    })

    const failed = finishCanvasNodeGenerationRun(created.document, nodeId, "operation-pending", "failed", "safe")
    const failedNode = failed.nodes.find((candidate) => candidate.id === nodeId)!
    expect(failedNode.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
    expect(getCanvasNodeGenerationRun(failedNode)?.status).toBe("failed")
    expect(getCanvasNodeGenerationRun(failedNode)?.retrySafety).toBe("safe")

    const restarted = interruptInactiveCanvasNodeGenerationRuns(created.document, [])
    const restartedNode = restarted.nodes.find((candidate) => candidate.id === nodeId)!
    expect(restartedNode.data).toMatchObject({
      error: "Generation was interrupted",
      status: "error",
    })
    expect(getCanvasNodeGenerationRun(restartedNode)?.status).toBe("interrupted")
    expect(getCanvasNodeGenerationRun(restartedNode)?.retrySafety).toBe("unknown")
  })

  test("starts runs only on file nodes", () => {
    const agent = createAgentNode({ id: "agent-one", position: { x: 0, y: 0 } })
    const source = createCanvasDocument({ id: "canvas-one", nodes: [agent], title: "Canvas" })
    expect(() =>
      startCanvasNodeGenerationRun(source, agent.id, {
        operationId: "operation-one",
        prompt: "Do not run here",
        toolId: "creative-tools/image.generate",
      }),
    ).toThrow("requires a file node")
  })

  test("keeps an empty resource target guard stable while Canvas adds generation-owned metadata", () => {
    const source = document()
    const before = createCanvasGenerationTargetGuard(source.nodes[0]!)
    const running = markCanvasNodeGenerationRunRunning(
      startCanvasNodeGenerationRun(source, "image-one", {
        operationId: "operation-one",
        prompt: "Draw a fox",
        toolId: "creative-tools/actual-model",
      }),
      "image-one",
      "operation-one",
    )

    expect(before.data).not.toHaveProperty("metadata")
    expect(createCanvasGenerationTargetGuard(running.nodes[0]!)).toEqual(before)
  })

  test("keeps a pending resource target guard stable across runtime-only hydration changes", () => {
    const source = document()
    const pending = {
      ...source.nodes[0]!,
      data: {
        ...source.nodes[0]!.data,
        durationMs: null,
        height: null,
        mimeType: null,
        name: null,
        resourceState: undefined,
        status: "pending" as const,
        width: null,
      },
    }
    const before = createCanvasGenerationTargetGuard(pending)
    for (const key of ["durationMs", "height", "mimeType", "name", "resourceState", "width"] as const) {
      expect(before.data).not.toHaveProperty(key)
    }
    const hydrated = {
      ...pending,
      data: {
        ...pending.data,
        durationMs: undefined,
        height: undefined,
        mimeType: undefined,
        name: undefined,
        resourceState: { status: "ready" as const, url: "" },
        width: undefined,
      },
    }

    const after = createCanvasGenerationTargetGuard(hydrated)
    for (const key of ["durationMs", "height", "mimeType", "name", "resourceState", "width"] as const) {
      expect(after.data).not.toHaveProperty(key)
    }
    expect(after).toEqual(before)
  })

  test("lets run and next-preference updates pass the generated guard and atomically succeeds replacement", () => {
    const preference = {
      schema: canvasNodeGenerationPreferenceSchema,
      toolId: "creative-tools/next-model",
    }
    const source = document({
      [canvasNodeGenerationPreferenceKey]: preference,
      convaxPluginState: { schema: "plugin.state/1", value: "old" },
      sourceOnly: true,
    })
    const guard = createCanvasGenerationTargetGuard(source.nodes[0]!)
    const running = markCanvasNodeGenerationRunRunning(startCanvasNodeGenerationRun(source, "image-one", {
      operationId: "operation-one",
      prompt: "Draw a fox",
      toolId: "creative-tools/actual-model",
    }), "image-one", "operation-one", "task_123")
    const changedPreference = setCanvasNodeGenerationToolId(
      running,
      "image-one",
      "creative-tools/following-model",
    )

    const result = applyCanvasApplicationCommand(changedPreference, {
      type: "resources.replace-generated",
      expectedTarget: guard,
      item: {
        id: "resource-two",
        kind: "image",
        metadata: {
          [canvasNodeGenerationPreferenceKey]: { forged: true },
          [canvasNodeGenerationRunKey]: { forged: true },
          projectFileReference: { path: ".convax/assets/generated.png" },
        },
        mimeType: "image/png",
        name: "generated.png",
        state: { status: "ready", url: "convax://generated" },
      },
      operationId: "operation-one",
      targetNodeId: "image-one",
    })

    const replaced = result.document.nodes[0]!
    expect(replaced.data).toMatchObject({ resourceState: { url: "convax://generated" } })
    expect(replaced.data.metadata).toEqual({
      [canvasNodeGenerationPreferenceKey]: {
        schema: canvasNodeGenerationPreferenceSchema,
        toolId: "creative-tools/following-model",
      },
      [canvasNodeGenerationRunKey]: {
        operationId: "operation-one",
        prompt: "Draw a fox",
        schema: canvasNodeGenerationRunSchema,
        status: "succeeded",
        taskId: "task_123",
        toolId: "creative-tools/actual-model",
      },
      projectFileReference: { path: ".convax/assets/generated.png" },
    })
    expect(replaced.data.metadata).not.toHaveProperty("convaxPluginState")
    expect(result.affectedNodeIds).toEqual(["image-one"])
  })

  test("keeps real replacement content guarded while rejecting deleted and stale owners", () => {
    const source = start()
    const guard = createCanvasGenerationTargetGuard(source.nodes[0]!)
    const changed = {
      ...source,
      nodes: source.nodes.map((node) => ({ ...node, data: { ...node.data, mimeType: "image/webp" } })),
    }
    expect(() => applyCanvasApplicationCommand(changed, {
      type: "resources.replace-generated",
      expectedTarget: guard,
      item: { id: "two", kind: "image", metadata: {}, state: { status: "ready", url: "convax://two" } },
      operationId: "operation-one",
      targetNodeId: "image-one",
    })).toThrow(CanvasCommandValidationError)

    expect(() =>
      finishCanvasNodeGenerationRun({ ...source, nodes: [] }, "image-one", "operation-one", "failed", "safe"),
    ).toThrow("not found")
    expect(() => applyCanvasApplicationCommand(source, {
      type: "resources.replace-generated",
      expectedTarget: guard,
      item: { id: "two", kind: "image", metadata: {}, state: { status: "ready", url: "convax://two" } },
      operationId: "late-operation",
      targetNodeId: "image-one",
    })).toThrow("does not own")
  })

  test("duplicates active history without copying task ownership", () => {
    const running = markCanvasNodeGenerationRunRunning(start(), "image-one", "operation-one", "task_123")
    const duplicated = duplicateCanvasSelection(running, ["image-one"])
    const cloneId = duplicated.duplicatedNodeIdBySourceId.get("image-one")
    const clone = duplicated.document.nodes.find((node) => node.id === cloneId)
    expect(getCanvasNodeGenerationRun(clone!)).toEqual({
      operationId: "operation-one",
      prompt: "Draw a fox",
      schema: canvasNodeGenerationRunSchema,
      status: "interrupted",
      retrySafety: "unknown",
      toolId: "creative-tools/image.generate",
    })
    expect(getCanvasNodeGenerationRun(running.nodes[0]!)?.status).toBe("running")
  })

  test("duplicates an active pending owner as interrupted error history", () => {
    const created = applyCanvasApplicationCommand(
      createCanvasDocument({ id: "canvas-one", title: "Canvas" }),
      createCanvasPendingGenerationResourceCommand({
        anchor: { x: 0, y: 0 },
        generation: {
          operationId: "operation-pending",
          prompt: "Create an image",
          toolId: "creative-tools/image.generate",
        },
        kind: "image",
        label: "Generated image",
      }),
    )
    const sourceNodeId = created.createdNodeIds[0]!
    const duplicated = duplicateCanvasSelection(created.document, [sourceNodeId])
    const cloneId = duplicated.duplicatedNodeIdBySourceId.get(sourceNodeId)!
    const clone = duplicated.document.nodes.find((node) => node.id === cloneId)!
    expect(clone.data).toMatchObject({
      error: "Generation was interrupted",
      status: "error",
    })
    expect(getCanvasNodeGenerationRun(clone)).toMatchObject({
      operationId: "operation-pending",
      status: "interrupted",
    })
  })
})
