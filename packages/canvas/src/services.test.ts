import { describe, expect, mock, test } from "bun:test"
import { createAgentNode, createFolderNode, createGroupNode, createMediaNode, createTextNode } from "./document"
import {
  getCompatibleCanvasGenerationTools,
  getCanvasGenerationInputError,
  getCanvasGenerationReferenceError,
  inferCanvasGenerationInputs,
  inferCanvasGenerationReferences,
  CanvasTextResourceConflictError,
  createCanvasPendingDraftRegistry,
  createCanvasTextDraftState,
  createCanvasTextDraftStore,
  updateCanvasTextDraft,
  type CanvasAssistantGenerationCapability,
  type CanvasGenerateService,
  type CanvasGenerationResultMode,
  type CanvasGenerationReference,
  type CanvasGenerationToolSummary,
} from "./services"

describe("Canvas text draft services", () => {
  test("keeps typed file-content conflict tokens host-neutral", () => {
    const error = new CanvasTextResourceConflictError("before", "after")

    expect(error.name).toBe("CanvasTextResourceConflictError")
    expect(error.message).toMatch(/changed outside Convax/i)
    expect(error.expectedContentRevision).toBe("before")
    expect(error.actualContentRevision).toBe("after")
  })

  test("awaits every pending draft save when the owning Project must quiesce", async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = {
      discard: mock(),
      inFlightSave: () => null,
      isDirty: () => true,
      save: mock(async () => pending),
    }
    const second = {
      discard: mock(),
      inFlightSave: () => null,
      isDirty: () => true,
      save: mock(async () => undefined),
    }
    const registry = createCanvasPendingDraftRegistry()
    registry.register(first)
    registry.register(second)

    let settled = false
    const leaving = registry.savePending({ wait: true }).then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(first.save).toHaveBeenCalledTimes(1)
    expect(second.save).toHaveBeenCalledTimes(1)
    expect(settled).toBeFalse()
    release()
    await expect(leaving).resolves.toBeUndefined()
    expect(first.discard).not.toHaveBeenCalled()
  })

  test("waits for every save to settle before reporting one draft failure", async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const failure = new Error("first draft failed")
    const registry = createCanvasPendingDraftRegistry()
    registry.register({
      discard: mock(),
      inFlightSave: () => null,
      isDirty: () => true,
      save: async () => Promise.reject(failure),
    })
    registry.register({ discard: mock(), inFlightSave: () => null, isDirty: () => true, save: async () => pending })

    let settled = false
    const leaving = registry.savePending({ wait: true }).finally(() => {
      settled = true
    })
    const observed = leaving.catch((error) => error)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(settled).toBeFalse()
    release()
    await expect(observed).resolves.toBe(failure)
  })

  test("starts pending draft saves without waiting for Canvas navigation", async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const draft = {
      discard: mock(),
      inFlightSave: () => null,
      isDirty: () => true,
      save: mock(async () => pending),
    }
    const registry = createCanvasPendingDraftRegistry()
    registry.register(draft)

    let settled = false
    await registry.savePending({ wait: false }).then(() => {
      settled = true
    })
    expect(settled).toBeTrue()
    expect(draft.save).toHaveBeenCalledTimes(1)
    release()
    await pending
  })

  test("keeps saving newer typing that arrives while a background save is in flight", async () => {
    const key = { documentId: "canvas-a", nodeId: "text-a", scopeId: "project-a" }
    const store = createCanvasTextDraftStore()
    let releaseFirst!: (value: { contentRevision: string }) => void
    const first = new Promise<{ contentRevision: string }>((resolve) => {
      releaseFirst = resolve
    })
    const save = mock(async () => {
      if (save.mock.calls.length === 1) return first
      return { contentRevision: "rev-three" }
    })
    const persistence = { describeError: () => "failed", save }
    const firstDraft = updateCanvasTextDraft(
      createCanvasTextDraftState({ contentRevision: "rev-one", text: "one" }),
      "two",
    )
    store.stage(key, firstDraft, persistence)

    const saving = store.save(key)
    await Promise.resolve()
    store.stage(key, updateCanvasTextDraft(firstDraft, "three"), persistence)
    releaseFirst({ contentRevision: "rev-two" })

    await expect(saving).resolves.toMatchObject({ baseRevision: "rev-three", content: "three", dirty: false })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ baseRevision: "rev-one", content: "two" })
    expect(save.mock.calls[1]?.[0]).toMatchObject({ baseRevision: "rev-two", content: "three" })
    expect(store.get(key)).toBeUndefined()
  })

  test("retains failed background drafts and retries them from the shared store", async () => {
    const key = { documentId: "canvas-a", nodeId: "text-a", scopeId: "project-a" }
    const failure = new Error("save failed")
    let shouldFail = true
    const save = mock(async () => {
      if (shouldFail) throw failure
      return { contentRevision: "rev-after" }
    })
    const store = createCanvasTextDraftStore()
    store.stage(
      key,
      updateCanvasTextDraft(createCanvasTextDraftState({ contentRevision: "rev-before", text: "before" }), "draft"),
      { describeError: () => "Your draft was kept.", save },
    )

    await expect(store.save(key)).rejects.toBe(failure)
    expect(store.get(key)).toMatchObject({ content: "draft", dirty: true, error: "Your draft was kept." })
    shouldFail = false
    await expect(store.save(key)).resolves.toMatchObject({ baseRevision: "rev-after", dirty: false, error: null })
  })
})

describe("Canvas generation services", () => {
  test("keeps create-new-result mode as an explicit separate pending-task contract", () => {
    const capability = {
      initialPrompt: "A small rabbit",
      output: "image",
      submissionMode: "create-pending-node",
    } satisfies CanvasAssistantGenerationCapability
    const resultMode = { type: capability.submissionMode } satisfies CanvasGenerationResultMode

    expect(capability).toEqual({
      initialPrompt: "A small rabbit",
      output: "image",
      submissionMode: "create-pending-node",
    })
    expect(resultMode).toEqual({ type: "create-pending-node" })
  })

  test("keeps normalized tool-owned scalar fields behind the host service", async () => {
    const service: CanvasGenerateService = {
      describeTool: async (toolId) => ({
        fields: [
          {
            choices: [{ label: "Landscape", value: "16:9" }],
            id: "aspect_ratio",
            kind: "select",
            label: "Aspect ratio",
            required: true,
          },
        ],
        toolId,
      }),
      generate: async () => ({ createdNodeIds: [], toolId: "tools/image", warnings: [] }),
      listTools: async () => [],
    }

    expect(await service.describeTool("tools/image")).toEqual({
      fields: [
        {
          choices: [{ label: "Landscape", value: "16:9" }],
          id: "aspect_ratio",
          kind: "select",
          label: "Aspect ratio",
          required: true,
        },
      ],
      toolId: "tools/image",
    })
  })

  test("partitions text prompt context from supported media references", () => {
    const nodes = [
      createTextNode({
        id: "brief",
        metadata: {},
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "A lighthouse" },
      }),
      createMediaNode({
        id: "image",
        position: { x: 0, y: 0 },
        resource: {
          id: "image-resource",
          kind: "image",
          metadata: {},
          state: { status: "ready", url: "asset://image" },
        },
      }),
      createMediaNode({
        id: "video",
        position: { x: 0, y: 0 },
        resource: {
          id: "video-resource",
          kind: "video",
          metadata: {},
          state: { status: "ready", url: "asset://video" },
        },
      }),
      createMediaNode({
        id: "audio",
        position: { x: 0, y: 0 },
        resource: {
          id: "audio-resource",
          kind: "audio",
          metadata: {},
          state: { status: "ready", url: "asset://audio" },
        },
      }),
      createMediaNode({
        id: "file",
        position: { x: 0, y: 0 },
        resource: { id: "file-resource", kind: "file", metadata: {}, state: { status: "ready", url: "asset://file" } },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: { id: "folder-resource", kind: "folder", metadata: {}, name: "Folder", state: { status: "ready" } },
      }),
      createAgentNode({ id: "agent", position: { x: 0, y: 0 } }),
      createGroupNode({ id: "group", height: 100, position: { x: 0, y: 0 }, width: 100 }),
    ]

    expect(
      inferCanvasGenerationInputs(nodes, [
        "audio",
        "brief",
        "image",
        "video",
        "file",
        "folder",
        "agent",
        "group",
        "missing",
        "image",
      ]),
    ).toEqual({
      promptContextNodeIds: ["brief"],
      references: [
        { nodeId: "audio", role: "audio" },
        { nodeId: "image", role: "reference_image" },
        { nodeId: "video", role: "reference_video" },
      ],
    })
    expect(inferCanvasGenerationReferences(nodes, ["brief", "image"])).toEqual([
      { nodeId: "image", role: "reference_image" },
    ])
  })

  test("keeps empty text and media cards prompt-only instead of inventing unusable references", () => {
    const nodes = [
      createTextNode({
        id: "empty-text",
        metadata: {},
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "   " },
      }),
      createMediaNode({
        id: "empty-image",
        position: { x: 0, y: 0 },
        resource: { id: "empty-image-resource", kind: "image", metadata: {}, state: { status: "ready" } },
      }),
      createMediaNode({
        id: "empty-video",
        position: { x: 0, y: 0 },
        resource: { id: "empty-video-resource", kind: "video", metadata: {}, state: { status: "ready" } },
      }),
      createMediaNode({
        id: "empty-audio",
        position: { x: 0, y: 0 },
        resource: { id: "empty-audio-resource", kind: "audio", metadata: {}, state: { status: "ready" } },
      }),
    ]

    expect(
      inferCanvasGenerationReferences(
        nodes,
        nodes.map((node) => node.id),
      ),
    ).toEqual([])
  })

  test("keeps explicit first and last frame roles available without guessing them", () => {
    const references: readonly CanvasGenerationReference[] = [
      { nodeId: "opening", role: "first_frame" },
      { nodeId: "ending", role: "last_frame" },
    ]
    expect(references.map((reference) => reference.role)).toEqual(["first_frame", "last_frame"])
  })

  test("selects only tools that accept every inferred reference role", () => {
    const tools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: [],
        description: "Prompt-only image tool",
        id: "prompt-image",
        output: "image",
        title: "Prompt image",
      },
      {
        acceptedInputs: ["text", "reference_image", "audio"],
        description: "Multimodal video tool",
        id: "multimodal-video",
        output: "video",
        title: "Multimodal video",
      },
    ]

    expect(
      getCompatibleCanvasGenerationTools(tools, [
        { nodeId: "brief", role: "text" },
        { nodeId: "style", role: "reference_image" },
      ]).map((tool) => tool.id),
    ).toEqual(["multimodal-video"])
    expect(getCompatibleCanvasGenerationTools(tools, [])).toEqual(tools)
  })

  test("rejects ambiguous first and last frame selections before execution", () => {
    const references: readonly CanvasGenerationReference[] = [
      { nodeId: "opening-a", role: "first_frame" },
      { nodeId: "opening-b", role: "first_frame" },
    ]
    const tools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: ["first_frame"],
        description: "Video",
        id: "video",
        output: "video",
        title: "Video",
      },
    ]

    expect(getCanvasGenerationReferenceError(references)).toBe("Choose at most one first frame.")
    expect(getCompatibleCanvasGenerationTools(tools, references)).toEqual([])
  })

  test("rejects more references than the host generation boundary accepts", () => {
    const references: readonly CanvasGenerationReference[] = Array.from({ length: 33 }, (_, index) => ({
      nodeId: `brief-${index}`,
      role: "text" as const,
    }))
    const tools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: ["text"],
        description: "Text",
        id: "text",
        output: "text",
        title: "Text",
      },
    ]

    expect(getCanvasGenerationReferenceError(references)).toBe("Choose at most 32 generation references.")
    expect(getCompatibleCanvasGenerationTools(tools, references)).toEqual([])
    expect(
      getCanvasGenerationInputError({
        promptContextNodeIds: Array.from({ length: 16 }, (_, index) => `context-${index}`),
        references: references.slice(0, 17),
      }),
    ).toBe("Choose at most 32 generation inputs.")
  })
})
