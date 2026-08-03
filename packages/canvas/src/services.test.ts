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

  test("awaits every pending draft save before allowing departure", async () => {
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
    const leaving = registry
      .prepareToLeave(async () => "save" as const)
      .then((result) => {
        settled = true
        return result
      })
    await Promise.resolve()

    expect(first.save).toHaveBeenCalledTimes(1)
    expect(second.save).toHaveBeenCalledTimes(1)
    expect(settled).toBeFalse()
    release()
    await expect(leaving).resolves.toBeTrue()
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
    const leaving = registry
      .prepareToLeave(async () => "save" as const)
      .finally(() => {
        settled = true
      })
    const observed = leaving.catch((error) => error)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(settled).toBeFalse()
    release()
    await expect(observed).resolves.toBe(failure)
  })

  test("discards callbacks or cleanly cancels without running saves", async () => {
    let dirty = true
    const draft = {
      discard: mock(() => {
        dirty = false
      }),
      inFlightSave: () => null,
      isDirty: () => dirty,
      save: mock(async () => undefined),
    }
    const registry = createCanvasPendingDraftRegistry()
    const unregister = registry.register(draft)

    await expect(registry.prepareToLeave(async () => "cancel" as const)).resolves.toBeFalse()
    expect(registry.hasPending()).toBeTrue()
    expect(draft.discard).not.toHaveBeenCalled()
    expect(draft.save).not.toHaveBeenCalled()

    await expect(registry.prepareToLeave(async () => "discard" as const)).resolves.toBeTrue()
    expect(draft.discard).toHaveBeenCalledTimes(1)
    expect(draft.save).not.toHaveBeenCalled()
    unregister()
    expect(registry.hasPending()).toBeFalse()
  })

  test("settles an already-started save before offering discard", async () => {
    let dirty = true
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = () => {
        dirty = false
        resolve()
      }
    })
    const decide = mock(async () => "discard" as const)
    const discard = mock(() => {
      dirty = false
    })
    const registry = createCanvasPendingDraftRegistry()
    registry.register({ discard, inFlightSave: () => pending, isDirty: () => dirty, save: mock() })

    const leaving = registry.prepareToLeave(decide)
    await Promise.resolve()

    expect(decide).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
    release()
    await expect(leaving).resolves.toBeTrue()
    expect(decide).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  test("keeps the draft and stops departure when an already-started save fails", async () => {
    const failure = new Error("save failed")
    const decide = mock(async () => "discard" as const)
    const discard = mock()
    const registry = createCanvasPendingDraftRegistry()
    registry.register({
      discard,
      inFlightSave: () => Promise.reject(failure),
      isDirty: () => true,
      save: mock(),
    })

    await expect(registry.prepareToLeave(decide)).rejects.toBe(failure)
    expect(decide).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
    expect(registry.hasPending()).toBeTrue()
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
