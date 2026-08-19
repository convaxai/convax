import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type {
  GenerationCanvasAdmissionRequest,
  GenerationCanvasRequest,
  GenerationCanvasResult,
  GenerationListToolsRequest,
  GenerationToolSummary,
} from "../generation-contracts"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"

type InvokeHandler = (event: TestEvent, input?: unknown) => unknown
type EventHandler = (event: TestEvent, input?: unknown) => void

interface TestEvent {
  sender: TestSender
}

class TestSender {
  readonly #listeners = new Map<string, Set<() => void>>()

  constructor(readonly id: number) {}

  once(event: string, listener: () => void) {
    const listeners = this.#listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(event, listeners)
  }

  removeListener(event: string, listener: () => void) {
    this.#listeners.get(event)?.delete(listener)
  }

  destroy() {
    const listeners = [...(this.#listeners.get("destroyed") ?? [])]
    this.#listeners.delete("destroyed")
    listeners.forEach((listener) => listener())
  }

  listenerCount(event: string) {
    return this.#listeners.get(event)?.size ?? 0
  }
}

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, EventHandler>()
const removedHandlers: string[] = []
const removedListeners: string[] = []

beforeEach(() => {
  configureElectronMock({
    ipcMain: {
      handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
      on: (channel: string, listener: EventHandler) => listeners.set(channel, listener),
      removeHandler: (channel: string) => {
        removedHandlers.push(channel)
        handlers.delete(channel)
      },
      removeListener: (channel: string) => {
        removedListeners.push(channel)
        listeners.delete(channel)
      },
    },
  })
})

afterEach(() => {
  handlers.clear()
  listeners.clear()
  removedHandlers.splice(0)
  removedListeners.splice(0)
  resetElectronMock()
})

const request: GenerationCanvasRequest = {
  anchor: { x: 40, y: -20 },
  operationId: "generation-1",
  output: "image",
  prompt: "Draw a quiet harbor at dawn",
  ref: { canvasId: "canvas_1", scopeId: "project-1" },
  references: [{ nodeId: "image_1", role: "reference_image" }],
  toolId: "example-plugin/generate_image",
}

const result: GenerationCanvasResult = {
  createdNodeIds: ["generated_1"],
  operationReceipt: null,
  projection: { id: "canvas_1", metadata: { title: "Main" }, nodes: [], edges: [] },
  toolId: "example-plugin/generate_image",
  warnings: [],
}

const replacementGuard = Object.freeze({
  data: Object.freeze({ kind: "image", label: "Owner", metadata: Object.freeze({}) }),
  type: "file" as const,
})

const tool: GenerationToolSummary = {
  acceptedInputs: ["reference_image"],
  description: "Generate an image",
  id: "example-plugin/generate_image",
  kind: "model",
  modelName: "Image",
  output: "image",
  pluginId: "example-plugin",
  pluginName: "Example",
  serviceId: "example-plugin",
  title: "Image",
  toolId: "generate_image",
}

const description = {
  fields: [
    {
      choices: [
        { label: "Square", value: "1:1" },
        { label: "Landscape", value: "16:9" },
      ],
      id: "aspect_ratio",
      kind: "select" as const,
      label: "Aspect ratio",
      required: false,
    },
  ],
  toolId: tool.id,
}

function invoke(channel: string, input: unknown, source = new TestSender(1)) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender: source }, input)
}

function rejectWhenAborted(signal?: AbortSignal) {
  return new Promise<GenerationCanvasResult>((_resolve, reject) => {
    if (!signal) return reject(new Error("Missing AbortSignal"))
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

async function rejectionMessage(value: unknown) {
  try {
    await Promise.resolve(value)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("Expected the operation to reject")
}

describe("generation IPC", () => {
  test("reconciles one exact Canvas reference without exposing paths or resume controls", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const reconcileResult = {
      failedNodeIds: ["node-one"],
      operationReceipt: null,
      projection: { id: "canvas-one", metadata: { title: "Main" }, nodes: [], edges: [] },
    }
    const reconcileCanvas = mock(async () => reconcileResult)
    const dispose = registerGenerationIpc(
      {
        describeTool: async () => description,
        generate: async () => result,
        listTools: async () => [tool],
        reconcileCanvas,
      },
      { isTrustedSender: (event) => event.sender.id === 1 },
    )

    await expect(
      Promise.resolve(
        invoke(generationIpcChannels.reconcileCanvas, {
          ref: { canvasId: "canvas-one", scopeId: "project-one" },
        }),
      ),
    ).resolves.toEqual(reconcileResult)
    expect(reconcileCanvas).toHaveBeenCalledWith({ ref: { canvasId: "canvas-one", scopeId: "project-one" } })
    await expect(
      rejectionMessage(
        Promise.resolve().then(() =>
          invoke(generationIpcChannels.reconcileCanvas, {
            ref: { canvasId: "canvas-one", scopeId: "project-one" },
            resume: true,
          }),
        ),
      ),
    ).resolves.toContain("reconciliation request is invalid")
    dispose()
  })

  test("lists tools through a narrow, trusted and validated request", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const listTools = mock(async (_input: GenerationListToolsRequest) => [tool])
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools },
      { isTrustedSender: (event) => event.sender.id === 1 },
    )

    expect(
      await Promise.resolve(
        invoke(generationIpcChannels.listTools, {
          output: "image",
          refresh: true,
          scopeId: "project-1",
        }),
      ),
    ).toEqual([tool])
    expect(listTools).toHaveBeenCalledWith({ output: "image", refresh: true, scopeId: "project-1" })

    expect(
      await rejectionMessage(
        Promise.resolve().then(() =>
          invoke(generationIpcChannels.listTools, { scopeId: "project-1", provider: "hidden" }),
        ),
      ),
    ).toContain("tool list request is invalid")
    expect(
      await rejectionMessage(
        Promise.resolve().then(() => invoke(generationIpcChannels.listTools, { scopeId: "/native/path" })),
      ),
    ).toContain("scope id is invalid")
    expect(
      await rejectionMessage(
        Promise.resolve().then(() => invoke(generationIpcChannels.listTools, { refresh: "yes", scopeId: "project-1" })),
      ),
    ).toContain("tool list refresh is invalid")
    expect(
      await rejectionMessage(
        Promise.resolve().then(() =>
          invoke(generationIpcChannels.listTools, { scopeId: "project-1" }, new TestSender(2)),
        ),
      ),
    ).toContain("untrusted renderer")
    expect(listTools).toHaveBeenCalledTimes(1)

    dispose()
  })

  test("describes one selected tool without exposing an arbitrary schema request", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const describeTool = mock(async () => description)
    const dispose = registerGenerationIpc(
      { describeTool, generate: async () => result, listTools: async () => [] },
      { isTrustedSender: () => true },
    )

    await expect(
      Promise.resolve(
        invoke(generationIpcChannels.describeTool, {
          scopeId: "project-1",
          toolId: "example-plugin/generate_image",
        }),
      ),
    ).resolves.toEqual(description)
    expect(describeTool).toHaveBeenCalledWith({
      scopeId: "project-1",
      toolId: "example-plugin/generate_image",
    })
    await expect(
      Promise.resolve().then(() =>
        invoke(generationIpcChannels.describeTool, {
          method: "tools/list",
          scopeId: "project-1",
          toolId: "example-plugin/generate_image",
        }),
      ),
    ).rejects.toThrow("description request is invalid")
    await expect(
      Promise.resolve().then(() =>
        invoke(generationIpcChannels.describeTool, { scopeId: "project-1", toolId: "callTool" }),
      ),
    ).rejects.toThrow("tool id is invalid")

    dispose()
  })

  test("preserves a trusted host-derived direct incoming reference constraint", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const constrained = {
      ...request,
      referenceConstraint: { ownerNodeId: "plugin-card", type: "direct-incoming" as const },
    }

    await expect(Promise.resolve(invoke(generationIpcChannels.generate, constrained))).resolves.toEqual(result)
    expect(generate).toHaveBeenCalledWith(constrained, expect.any(AbortSignal))

    dispose()
  })

  test("accepts text prompt context as the complete typed prompt", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const contextOnly = {
      ...request,
      prompt: "",
      promptContextNodeIds: ["brief"],
      references: [],
    }

    await expect(Promise.resolve(invoke(generationIpcChannels.generate, contextOnly))).resolves.toEqual(result)
    expect(generate).toHaveBeenCalledWith(contextOnly, expect.any(AbortSignal))

    dispose()
  })

  test("preserves trusted host-only relation anchors without turning them into tool references", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const related = {
      ...request,
      expectedOutputCount: 1,
      parentId: "focused-group",
      relationAnchorNodeIds: ["silent-video"],
    }

    await expect(Promise.resolve(invoke(generationIpcChannels.generate, related))).resolves.toEqual(result)
    expect(generate).toHaveBeenCalledWith(related, expect.any(AbortSignal))

    dispose()
  })

  test("passes only bounded scalar tool input to the Main executor", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const configured = {
      ...request,
      resultMode: { expectedTarget: replacementGuard, nodeId: "owner-card", type: "replace-node" as const },
      toolInput: { enabled: true, quality: "high", seed: 42 },
    }

    await expect(Promise.resolve(invoke(generationIpcChannels.generate, configured))).resolves.toEqual(result)
    expect(generate).toHaveBeenCalledWith(configured, expect.any(AbortSignal))

    dispose()
  })

  test("accepts the host-owned pending-node result mode without a caller-selected node id", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const pending = { ...request, resultMode: { type: "create-pending-node" as const } }

    await expect(Promise.resolve(invoke(generationIpcChannels.generate, pending))).resolves.toEqual(result)
    expect(generate).toHaveBeenCalledWith(pending, expect.any(AbortSignal))

    dispose()
  })

  test("admits a bounded linked pending batch under one sender cancellation scope", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const admissionResult = {
      operations: [
        { nodeId: "pending-video", operationId: "operation-video" },
        { nodeId: "pending-audio", operationId: "operation-audio" },
      ],
    }
    const admitCanvas = mock(async (_input: GenerationCanvasAdmissionRequest, _signal?: AbortSignal) => admissionResult)
    const dispose = registerGenerationIpc(
      {
        admitCanvas,
        describeTool: async () => description,
        generate: async () => result,
        listTools: async () => [],
      },
      { isTrustedSender: () => true },
    )
    const pendingRequest = (operationId: string) => ({
      ...request,
      expectedOutputCount: 1,
      operationId,
      resultMode: { type: "create-pending-node" as const },
    })
    const admissionRequest = {
      steps: [
        { request: pendingRequest("operation-video") },
        { relationAnchorStepIndexes: [0], request: pendingRequest("operation-audio") },
      ],
    } satisfies GenerationCanvasAdmissionRequest

    await expect(Promise.resolve(invoke(generationIpcChannels.admitCanvas, admissionRequest))).resolves.toEqual(
      admissionResult,
    )
    expect(admitCanvas).toHaveBeenCalledWith(admissionRequest, expect.any(AbortSignal))
    await expect(
      rejectionMessage(
        Promise.resolve().then(() =>
          invoke(generationIpcChannels.admitCanvas, {
            steps: [
              { request: pendingRequest("operation-video") },
              { relationAnchorStepIndexes: [1], request: pendingRequest("operation-audio") },
            ],
          }),
        ),
      ),
    ).resolves.toContain("must reference a prior step")

    dispose()
  })

  test("passes the exact host-owned return result mode to Main for declared bounded operations", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const returnResult = { ...result, createdNodeIds: [], outputText: "Imported one media file." }
    const generate = mock(async () => returnResult)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const returned = { ...request, expectedOutputCount: 1, resultMode: { type: "return" as const } }

    await expect(Promise.resolve(invoke(generationIpcChannels.generate, returned))).resolves.toEqual(returnResult)
    expect(generate).toHaveBeenCalledWith(returned, expect.any(AbortSignal))

    dispose()
  })

  test("scopes duplicate ids and cancellation to the originating renderer", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const capturedSignals: AbortSignal[] = []
    const generate = mock(async (_input: GenerationCanvasRequest, signal?: AbortSignal) => {
      if (signal) capturedSignals.push(signal)
      return rejectWhenAborted(signal)
    })
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const owner = new TestSender(1)
    const pending = Promise.resolve(invoke(generationIpcChannels.generate, request, owner))
    const ownerRejection = rejectionMessage(pending)

    expect(await rejectionMessage(Promise.resolve(invoke(generationIpcChannels.generate, request, owner)))).toContain(
      "operation id is already active",
    )

    const otherOwner = new TestSender(2)
    const otherPending = Promise.resolve(invoke(generationIpcChannels.generate, request, otherOwner))
    const otherRejection = rejectionMessage(otherPending)
    await invoke(generationIpcChannels.cancel, { operationId: request.operationId }, otherOwner)
    expect(await otherRejection).toContain("canceled")
    expect(capturedSignals[0]?.aborted).toBeFalse()
    await invoke(generationIpcChannels.cancel, { operationId: request.operationId }, owner)
    expect(await ownerRejection).toContain("canceled")
    expect(generate).toHaveBeenCalledTimes(2)
    expect(owner.listenerCount("destroyed")).toBe(0)
    expect(otherOwner.listenerCount("destroyed")).toBe(0)

    dispose()
  })

  test("routes cancellation to Main recovery when no live renderer call owns the operation", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const cancel = mock(async () => undefined)
    const dispose = registerGenerationIpc(
      {
        cancel,
        describeTool: async () => description,
        generate: async () => result,
        listTools: async () => [],
      },
      { isTrustedSender: (event) => event.sender.id === 1 },
    )

    await expect(
      Promise.resolve(
        invoke(generationIpcChannels.cancel, {
          operationId: "operation-after-restart",
        }),
      ),
    ).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledWith({ operationId: "operation-after-restart" })
    await expect(
      Promise.resolve(
        invoke(generationIpcChannels.cancel, { operationId: "operation-after-restart" }, new TestSender(2)),
      ),
    ).rejects.toThrow("untrusted")
    dispose()
  })

  test("rejects non-contract fields, paths, generic tools, and malformed multimodal inputs", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async () => result)
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )

    const invalidRequests: Array<[unknown, string]> = [
      [{ ...request, path: "/tmp/output.png" }, "Generation request is invalid"],
      [{ ...request, ref: { ...request.ref, scopeId: "C:\\Users\\owner" } }, "scope id is invalid"],
      [{ ...request, toolId: "callTool" }, "tool id is invalid"],
      [{ ...request, output: "model" }, "output modality is invalid"],
      [{ ...request, prompt: "", promptContextNodeIds: [] }, "prompt is invalid"],
      [{ ...request, promptContextNodeIds: ["brief", "brief"] }, "duplicate node id"],
      [{ ...request, promptContextNodeIds: ["/native/path"] }, "prompt context node id is invalid"],
      [{ ...request, promptContextNodeIds: ["image_1"] }, "contain the same node"],
      [
        { ...request, promptContextNodeIds: Array.from({ length: 33 }, (_, index) => `context-${index}`) },
        "prompt context nodes are invalid",
      ],
      [
        {
          ...request,
          promptContextNodeIds: Array.from({ length: 16 }, (_, index) => `context-${index}`),
          references: Array.from({ length: 17 }, (_, index) => ({
            nodeId: `reference-${index}`,
            role: "reference_image",
          })),
        },
        "exceed the input limit",
      ],
      [{ ...request, references: [{ nodeId: "image_1", role: "provider_image" }] }, "reference role is invalid"],
      [
        {
          ...request,
          references: [
            { nodeId: "image_1", role: "reference_image" },
            { nodeId: "image_1", role: "reference_image" },
          ],
        },
        "duplicate node and role",
      ],
      [{ ...request, anchor: { x: Number.POSITIVE_INFINITY, y: 0 } }, "anchor is invalid"],
      [{ ...request, expectedOutputCount: 0 }, "expected output count is invalid"],
      [{ ...request, expectedOutputCount: 17 }, "expected output count is invalid"],
      [{ ...request, expectedOutputCount: 1.5 }, "expected output count is invalid"],
      [{ ...request, resultMode: { type: "replace-node" } }, "result mode is invalid"],
      [
        { ...request, resultMode: { expectedTarget: replacementGuard, nodeId: "/native/path", type: "replace-node" } },
        "replacement node id is invalid",
      ],
      [
        {
          ...request,
          resultMode: {
            expectedTarget: { type: "file", data: { kind: "image" } },
            nodeId: "owner",
            type: "replace-node",
          },
        },
        "replacement target data is invalid",
      ],
      [{ ...request, resultMode: { nodeId: "extra", type: "add" } }, "result mode is invalid"],
      [
        { ...request, resultMode: { nodeId: "caller-selected", type: "create-pending-node" } },
        "result mode is invalid",
      ],
      [{ ...request, resultMode: { type: "provider-result" } }, "result mode is invalid"],
      [
        { ...request, referenceConstraint: { ownerNodeId: "plugin-card", type: "arbitrary" } },
        "reference constraint is invalid",
      ],
      [
        {
          ...request,
          referenceConstraint: { ownerNodeId: "plugin-card", type: "direct-incoming" },
          relationAnchorNodeIds: [],
        },
        "Constrained generation cannot include relation anchors",
      ],
      [{ ...request, relationAnchorNodeIds: ["silent-video", "silent-video"] }, "duplicate node id"],
      [{ ...request, relationAnchorNodeIds: ["/native/path"] }, "relation anchor node id is invalid"],
      [
        { ...request, relationAnchorNodeIds: Array.from({ length: 33 }, (_, index) => `node-${index}`) },
        "relation anchors are invalid",
      ],
      [{ ...request, toolInput: { prompt: "override" } }, "cannot override host field"],
      [{ ...request, toolInput: { quality: { provider: "hidden" } } }, "tool input value is invalid"],
      [{ ...request, toolInput: { quality: Number.POSITIVE_INFINITY } }, "tool input value is invalid"],
    ]
    for (const [input, message] of invalidRequests) {
      expect(
        await rejectionMessage(Promise.resolve().then(() => invoke(generationIpcChannels.generate, input))),
      ).toContain(message)
    }
    expect(generate).not.toHaveBeenCalled()

    dispose()
  })

  test("aborts every sender operation on destruction and removes all lifecycle hooks on disposal", async () => {
    const { generationIpcChannels, registerGenerationIpc } = await import("./generation-ipc")
    const generate = mock(async (_input: GenerationCanvasRequest, signal?: AbortSignal) => rejectWhenAborted(signal))
    const dispose = registerGenerationIpc(
      { describeTool: async () => description, generate, listTools: async () => [] },
      { isTrustedSender: () => true },
    )
    const owner = new TestSender(1)
    const first = Promise.resolve(invoke(generationIpcChannels.generate, { ...request, operationId: "first" }, owner))
    const second = Promise.resolve(invoke(generationIpcChannels.generate, { ...request, operationId: "second" }, owner))
    const firstOutcome = first.then(
      () => null,
      (error: unknown) => error,
    )
    const secondOutcome = second.then(
      () => null,
      (error: unknown) => error,
    )
    expect(owner.listenerCount("destroyed")).toBe(1)
    owner.destroy()
    expect(await firstOutcome).toMatchObject({ name: "AbortError" })
    expect(await secondOutcome).toMatchObject({ name: "AbortError" })

    const thirdOwner = new TestSender(3)
    const third = Promise.resolve(
      invoke(generationIpcChannels.generate, { ...request, operationId: "third" }, thirdOwner),
    )
    const thirdOutcome = third.then(
      () => null,
      (error: unknown) => error,
    )
    expect(thirdOwner.listenerCount("destroyed")).toBe(1)
    dispose()
    dispose()
    expect(await thirdOutcome).toMatchObject({ name: "AbortError" })
    expect(thirdOwner.listenerCount("destroyed")).toBe(0)
    expect(removedHandlers.sort()).toEqual(
      [
        generationIpcChannels.admitCanvas,
        generationIpcChannels.cancel,
        generationIpcChannels.describeTool,
        generationIpcChannels.generate,
        generationIpcChannels.listTools,
        generationIpcChannels.reconcileCanvas,
      ].sort(),
    )
    expect(removedListeners).toEqual([])
  })
})
