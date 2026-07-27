import {
  createCanvasDocument,
  createFolderNode,
  createGroupNode,
  createMediaNode,
  createTextNode,
  type CanvasAssistantRequest,
  type CanvasGenerateRequest,
  type CanvasGenerateResult,
  type CanvasGenerateService,
  type CanvasGenerationToolDescription,
  type CanvasGenerationToolSummary,
  type CanvasNode,
} from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import {
  CanvasCardConversationPanel,
  CanvasCardGenerationCatalogRequestTracker,
  canvasCardAgentContextNodeIds,
  canvasCardAgentInitialMentionNodeIds,
  canvasCardGenerationOutput,
  canvasCardGenerationPromptContextNodeIds,
  canvasCardGenerationReferenceConstraint,
  canvasCardGenerationReferences,
  compatibleCanvasCardGenerationTools,
  createCanvasCardGenerationRequest,
  executeCanvasCardGeneration,
  generationErrorMessage,
  resolveCanvasCardGenerationTool,
  validateCanvasCardGenerationToolInput,
} from "./canvas-card-conversation-panel"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    HTMLTextAreaElement: testWindow.HTMLTextAreaElement,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  return async () => {
    testWindow.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function imageNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    ...createMediaNode({
      id: "image-card",
      position: { x: 10, y: 20 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/reference.png" } },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "ready", url: "convax-project://Media/reference.png" },
      },
    }),
    style: { height: 320, width: 480 },
    ...overrides,
  }
}

function assistantRequest(
  node: CanvasNode,
  nodes: CanvasNode[] = [node],
  mentionedNodeIds: readonly string[] = [],
): CanvasAssistantRequest {
  const output = node.data.kind === "image" || node.data.kind === "video" ? node.data.kind : undefined
  return {
    document: {
      ...createCanvasDocument({ id: "canvas-one", nodes }),
      revision: 7,
    },
    ...(output ? { generation: { output } } : {}),
    mentionedNodeIds,
    mode: "file",
    ownerNodeId: node.id,
  }
}

function tool(overrides: Partial<CanvasGenerationToolSummary> = {}): CanvasGenerationToolSummary {
  return {
    acceptedInputs: ["reference_image"],
    description: "Generate media",
    id: "creative-tools/image.generate",
    output: "image",
    title: "Creative image",
    ...overrides,
  }
}

const description: CanvasGenerationToolDescription = {
  fields: [
    {
      choices: [
        { label: "Square", value: "1:1" },
        { label: "Landscape", value: "16:9" },
      ],
      id: "aspect_ratio",
      kind: "select",
      label: "Aspect ratio",
      required: true,
    },
    {
      defaultValue: 12,
      id: "steps",
      kind: "integer",
      label: "Steps",
      maximum: 50,
      minimum: 1,
      required: false,
    },
  ],
  toolId: "creative-tools/image.generate",
}

describe("Canvas card generation output", () => {
  test("uses the request's supported direct-generation output without rendering modality tabs", () => {
    const nodes = [
      createTextNode({
        id: "text",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/notes.md" } },
        name: "notes.md",
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "Reference notes" },
      }),
      imageNode({ id: "image" }),
      createMediaNode({
        id: "video",
        position: { x: 0, y: 0 },
        resource: {
          id: "video-resource",
          kind: "video",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/video.mp4" } },
          state: { status: "ready", url: "convax-project://Media/video.mp4" },
        },
      }),
      createMediaNode({
        id: "audio",
        position: { x: 0, y: 0 },
        resource: {
          id: "audio-resource",
          kind: "audio",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/audio.mp3" } },
          state: { status: "ready", url: "convax-project://Media/audio.mp3" },
        },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: {
          id: "folder-resource",
          kind: "folder",
          metadata: { [projectResourceReferenceKey]: { kind: "project-directory", path: "Media" } },
          name: "Folder",
          state: { status: "ready" },
        },
      }),
      {
        data: { kind: "plugin.example", label: "Plugin" },
        id: "plugin",
        position: { x: 0, y: 0 },
        type: "file" as const,
      },
    ]

    expect(nodes.map((node) => canvasCardGenerationOutput(assistantRequest(node, nodes)))).toEqual([
      undefined,
      "image",
      "video",
      undefined,
      undefined,
      undefined,
    ])
  })

  test("binds replace-card references to the owner's direct incoming edges", () => {
    expect(
      canvasCardGenerationReferenceConstraint({
        resultMode: { nodeId: "image-card", type: "replace-node" },
      }),
    ).toEqual({ ownerNodeId: "image-card", type: "direct-incoming" })
    expect(canvasCardGenerationReferenceConstraint({ resultMode: { type: "add" } })).toBeUndefined()
  })

  test("inherits the Agent model until this node stores its own override", () => {
    const first = tool()
    const second = tool({ id: "tools/other", title: "Other image" })
    const third = tool({ id: "tools/third", title: "Third image" })

    expect(resolveCanvasCardGenerationTool(undefined, [first, second], { id: first.id, output: "image" })).toBe(first)
    expect(resolveCanvasCardGenerationTool(undefined, [first, second], { id: second.id, output: "image" })).toBe(second)
    expect(resolveCanvasCardGenerationTool(second.id, [first, second], { id: first.id, output: "image" })).toBe(second)
    expect(resolveCanvasCardGenerationTool(second.id, [second, third], { id: third.id, output: "image" })).toBe(second)
  })

  test("prefers an input-compatible default without hiding the installed fallback", () => {
    const incompatible = tool({ acceptedInputs: ["reference_image"], id: "tools/image-only" })
    const compatible = tool({ acceptedInputs: ["text"], id: "tools/text-image" })
    const agentDefault = { id: incompatible.id, output: "image" as const }

    expect(
      resolveCanvasCardGenerationTool(undefined, [incompatible, compatible], agentDefault, "image", [compatible]),
    ).toBe(compatible)
    expect(resolveCanvasCardGenerationTool(undefined, [incompatible], agentDefault, "image", [])).toBe(incompatible)
    expect(
      resolveCanvasCardGenerationTool(incompatible.id, [incompatible, compatible], agentDefault, "image", [compatible]),
    ).toBe(incompatible)
  })

  test("fails closed for a stale persisted id instead of silently changing models", () => {
    const staleId = "xiaoyunque-generation/image.nova2"
    const image = tool()
    const otherImage = tool({ id: "tools/other-image", title: "Other image" })
    const video = tool({ id: "tools/video", output: "video", title: "Video" })
    const agentVideo = { id: video.id, output: "video" as const }

    expect(resolveCanvasCardGenerationTool(staleId, [image, video], agentVideo, "image")).toBeUndefined()
    expect(resolveCanvasCardGenerationTool(staleId, [image, otherImage, video], agentVideo, "image")).toBeUndefined()
    expect(resolveCanvasCardGenerationTool(video.id, [image, video], agentVideo, "image")).toBeUndefined()

    const request = createCanvasCardGenerationRequest({
      description: { fields: [], toolId: image.id },
      prompt: "A small rabbit",
      request: assistantRequest(imageNode()),
      signal: new AbortController().signal,
      tool: image,
      toolInput: {},
    })
    expect(request.toolId).toBe(image.id)
    expect(request.toolId).not.toBe(staleId)
  })

  test("keeps an image card strictly on image models, including persisted overrides and Agent defaults", () => {
    const image = tool()
    const otherImage = tool({ id: "tools/other-image", title: "Other image" })
    const video = tool({ id: "tools/video", output: "video", title: "Video" })
    const agentVideo = { id: video.id, output: "video" as const }
    const emptyImage = imageNode({
      data: { kind: "image", label: "Image", metadata: {}, resourceState: { status: "ready", url: "" } },
    })
    const ownerOutput = canvasCardGenerationOutput(assistantRequest(emptyImage))

    expect(ownerOutput).toBe("image")
    expect(resolveCanvasCardGenerationTool(undefined, [image, video], agentVideo, ownerOutput)).toBe(image)
    expect(resolveCanvasCardGenerationTool(undefined, [image, otherImage, video], agentVideo, ownerOutput)).toBe(image)
    expect(resolveCanvasCardGenerationTool(undefined, [video], agentVideo, ownerOutput)).toBeUndefined()
    expect(resolveCanvasCardGenerationTool(video.id, [image, video], agentVideo, ownerOutput)).toBeUndefined()

    const agentImage = { id: image.id, output: "image" as const }
    expect(resolveCanvasCardGenerationTool(undefined, [image, video], agentImage, "video")).toBe(video)
    expect(resolveCanvasCardGenerationTool(image.id, [image, video], agentImage, "video")).toBeUndefined()
  })
})

describe("Canvas card generation request", () => {
  test("passes a trimmed prompt and validated tool-owned inputs beside a nested card in world coordinates", () => {
    const group = createGroupNode({
      id: "group",
      height: 500,
      position: { x: 100, y: 200 },
      width: 800,
    })
    const node = imageNode({ extent: "parent", parentId: group.id })
    const request = assistantRequest(node, [group, node], [node.id])
    const controller = new AbortController()

    expect(
      createCanvasCardGenerationRequest({
        description,
        operationId: "operation-one",
        prompt: "  Turn this into a poster  ",
        request,
        signal: controller.signal,
        tool: tool(),
        toolInput: { aspect_ratio: "16:9", steps: 24 },
      }),
    ).toEqual({
      anchor: { x: 654, y: 220 },
      context: {
        documentId: "canvas-one",
        selectedNodeIds: ["image-card"],
        source: "canvas-card",
      },
      expectedRevision: 7,
      operationId: "operation-one",
      output: "image",
      prompt: "Turn this into a poster",
      references: [{ nodeId: "image-card", role: "reference_image" }],
      resultMode: { nodeId: "image-card", type: "replace-node" },
      signal: controller.signal,
      toolId: "creative-tools/image.generate",
      toolInput: { aspect_ratio: "16:9", steps: 24 },
    })
  })

  test("creates a fresh host operation id for every retry request", () => {
    const node = imageNode()
    const request = assistantRequest(node, [node])
    const create = () =>
      createCanvasCardGenerationRequest({
        description,
        prompt: "Retry this prompt",
        request,
        signal: new AbortController().signal,
        tool: tool(),
        toolInput: { aspect_ratio: "16:9", steps: 24 },
      })

    const first = create()
    const second = create()
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.operationId).not.toBe(first.operationId)
  })

  test("carries mentioned text as prompt context and allows it to be the entire prompt", () => {
    const owner = imageNode()
    const notes = createTextNode({
      id: "notes",
      metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/prompt.txt" } },
      name: "prompt.txt",
      position: { x: -320, y: 0 },
      resourceState: { status: "ready", text: "A rainy neon alley" },
    })
    const reference = imageNode({ id: "style-image" })
    const selected = tool()

    expect(
      createCanvasCardGenerationRequest({
        description: { fields: [], toolId: selected.id },
        prompt: "   ",
        request: assistantRequest(owner, [owner, notes, reference], [notes.id, reference.id]),
        signal: new AbortController().signal,
        tool: selected,
        toolInput: {},
      }),
    ).toMatchObject({
      prompt: "",
      promptContextNodeIds: [notes.id],
      references: [{ nodeId: reference.id, role: "reference_image" }],
    })
  })

  test("rejects direct generation for generic and non-visual media cards", () => {
    const folder = createFolderNode({
      id: "folder",
      position: { x: 3, y: 4 },
      resource: {
        id: "folder-resource",
        kind: "folder",
        metadata: { [projectResourceReferenceKey]: { kind: "project-directory", path: "Media" } },
        name: "Folder",
        state: { status: "ready" },
      },
    })
    const audio = createMediaNode({
      id: "audio",
      position: { x: 3, y: 4 },
      resource: {
        id: "audio-resource",
        kind: "audio",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/audio.mp3" } },
        state: { status: "ready", url: "asset://audio" },
      },
    })
    const selected = tool({ acceptedInputs: [], id: "sound/audio.generate", output: "audio" })
    const emptyDescription = { fields: [], toolId: selected.id } satisfies CanvasGenerationToolDescription

    for (const node of [folder, audio]) {
      expect(() =>
        createCanvasCardGenerationRequest({
          description: emptyDescription,
          prompt: "A soft opening",
          request: assistantRequest(node),
          signal: new AbortController().signal,
          tool: selected,
          toolInput: {},
        }),
      ).toThrow("only for image and video cards")
    }

    expect(() =>
      createCanvasCardGenerationRequest({
        description: { fields: [], toolId: tool().id },
        prompt: "A forged visual replacement",
        request: { ...assistantRequest(folder), generation: { output: "image" } },
        signal: new AbortController().signal,
        tool: tool(),
        toolInput: {},
      }),
    ).toThrow("only for image and video cards")
  })

  test("generates from an empty image card as prompt-only output instead of treating the placeholder as input", () => {
    const node = imageNode({
      data: {
        kind: "image",
        label: "Image",
        metadata: {},
        resourceState: { status: "ready", url: "" },
      },
    })
    const selected = tool({ acceptedInputs: [] })
    const emptyDescription = { fields: [], toolId: selected.id } satisfies CanvasGenerationToolDescription

    expect(
      createCanvasCardGenerationRequest({
        description: emptyDescription,
        prompt: "A small rabbit",
        request: assistantRequest(node, [node], [node.id]),
        signal: new AbortController().signal,
        tool: selected,
        toolInput: {},
      }),
    ).toMatchObject({
      output: "image",
      prompt: "A small rabbit",
      references: [],
      resultMode: { nodeId: "image-card", type: "replace-node" },
    })
  })

  test("rejects a video model before it can replace an image card", () => {
    const node = imageNode()
    const selected = tool({ acceptedInputs: [], id: "creative-tools/video.generate", output: "video" })
    const emptyDescription = { fields: [], toolId: selected.id } satisfies CanvasGenerationToolDescription

    expect(() =>
      createCanvasCardGenerationRequest({
        description: emptyDescription,
        prompt: "Bring the character to life",
        request: assistantRequest(node),
        signal: new AbortController().signal,
        tool: selected,
        toolInput: {},
      }),
    ).toThrow("cannot replace this image card")
  })

  test("does not implicitly use a managed image owner unless the user explicitly mentions it", () => {
    const node = imageNode()

    expect(canvasCardGenerationReferences(assistantRequest(node))).toEqual([])
    expect(canvasCardGenerationReferences(assistantRequest(node, [node], [node.id]))).toEqual([
      { nodeId: node.id, role: "reference_image" },
    ])

    const selected = tool({ acceptedInputs: [] })
    expect(
      createCanvasCardGenerationRequest({
        description: { fields: [], toolId: selected.id },
        prompt: "A new scene",
        request: assistantRequest(node),
        signal: new AbortController().signal,
        tool: selected,
        toolInput: {},
      }),
    ).toMatchObject({ references: [] })
  })

  test("rejects missing, invalid, and stale model configuration", () => {
    expect(() => validateCanvasCardGenerationToolInput(description, {})).toThrow("Aspect ratio")
    expect(() => validateCanvasCardGenerationToolInput(description, { aspect_ratio: "4:3" })).toThrow("aspect_ratio")
    expect(() =>
      createCanvasCardGenerationRequest({
        description: { ...description, toolId: "old/tool" },
        prompt: "Poster",
        request: assistantRequest(imageNode()),
        signal: new AbortController().signal,
        tool: tool(),
        toolInput: { aspect_ratio: "1:1" },
      }),
    ).toThrow("configuration is stale")
  })

  test("infers text prompt context separately from media references", () => {
    const nodes = [
      createTextNode({
        id: "text",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/notes.md" } },
        name: "notes.md",
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "Reference notes" },
      }),
      imageNode({ id: "image" }),
      createMediaNode({
        id: "video",
        position: { x: 0, y: 0 },
        resource: {
          id: "video-resource",
          kind: "video",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/video.mp4" } },
          state: { status: "ready", url: "convax-project://Media/video.mp4" },
        },
      }),
      createMediaNode({
        id: "audio",
        position: { x: 0, y: 0 },
        resource: {
          id: "audio-resource",
          kind: "audio",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/audio.mp3" } },
          state: { status: "ready", url: "convax-project://Media/audio.mp3" },
        },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: {
          id: "folder-resource",
          kind: "folder",
          metadata: { [projectResourceReferenceKey]: { kind: "project-directory", path: "Media" } },
          name: "Folder",
          state: { status: "ready" },
        },
      }),
      {
        data: { kind: "plugin.example", label: "Plugin" },
        id: "plugin",
        position: { x: 0, y: 0 },
        type: "file" as const,
      },
    ]

    expect(nodes.map((node) => canvasCardGenerationReferences(assistantRequest(node, nodes, [node.id])))).toEqual([
      [],
      [{ nodeId: "image", role: "reference_image" }],
      [{ nodeId: "video", role: "reference_video" }],
      [{ nodeId: "audio", role: "audio" }],
      [],
      [],
    ])
    expect(
      nodes.map((node) => canvasCardGenerationPromptContextNodeIds(assistantRequest(node, nodes, [node.id]))),
    ).toEqual([["text"], [], [], [], [], []])
  })

  test("locks direct cards to their output kind while preserving explicit image input for video generation", () => {
    const references = [{ nodeId: "image-card", role: "reference_image" as const }]
    const tools = [
      tool(),
      tool({ id: "tools/prompt-image", acceptedInputs: [] }),
      tool({ id: "tools/video-with-reference", output: "video" }),
    ]

    expect(compatibleCanvasCardGenerationTools(tools, "image", references).map((item) => item.id)).toEqual([
      "creative-tools/image.generate",
    ])
    expect(compatibleCanvasCardGenerationTools(tools, "video", references).map((item) => item.id)).toEqual([
      "tools/video-with-reference",
    ])
    expect(compatibleCanvasCardGenerationTools(tools, "image", []).map((item) => item.id)).toEqual([
      "creative-tools/image.generate",
      "tools/prompt-image",
    ])
  })
})

describe("Canvas card generation lifecycle", () => {
  function generationRequest(signal = new AbortController().signal): CanvasGenerateRequest {
    return {
      anchor: { x: 0, y: 0 },
      context: { documentId: "canvas-one", selectedNodeIds: ["image-card"], source: "canvas-card" },
      expectedRevision: 7,
      output: "image",
      prompt: "A small rabbit",
      references: [],
      resultMode: { nodeId: "image-card", type: "replace-node" },
      signal,
      toolId: "creative-tools/image.generate",
    }
  }

  test("keeps accepted generation alive until the Main-owned operation completes", async () => {
    let resolveGeneration!: (result: CanvasGenerateResult) => void
    const generate: CanvasGenerateService["generate"] = () =>
      new Promise((resolve) => {
        resolveGeneration = resolve
      })
    const pending = executeCanvasCardGeneration({
      generate,
      request: generationRequest(),
    })

    resolveGeneration({
      createdNodeIds: ["generated"],
      revision: 8,
      toolId: "creative-tools/image.generate",
      warnings: [],
    })
    await expect(pending).resolves.toMatchObject({ createdNodeIds: ["generated"] })
  })

  test("keeps an accepted generation alive when switching Canvas unmounts the card", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    let acceptedSignal: AbortSignal | undefined
    let resolveGeneration!: (result: CanvasGenerateResult) => void
    const generate = mock(
      (request: CanvasGenerateRequest) =>
        new Promise<CanvasGenerateResult>((resolve) => {
          acceptedSignal = request.signal
          resolveGeneration = resolve
        }),
    )
    const owner = imageNode()
    const request = assistantRequest(owner)
    const service: CanvasGenerateService = {
      describeTool: async (toolId) => ({ fields: [], toolId }),
      generate,
      listTools: async () => [tool({ acceptedInputs: [] })],
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <CanvasCardConversationPanel
            agent={<div>Agent conversation</div>}
            request={{
              ...request,
              generation: { ...request.generation!, initialPrompt: "Keep generating while I switch Canvas" },
            }}
            service={service}
          />,
        )
      })
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
        if (button && !button.disabled) break
        await act(async () => {
          await Promise.resolve()
        })
      }
      const generateButton = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
      expect(generateButton?.disabled).toBeFalse()
      await act(async () => {
        generateButton?.click()
      })
      expect(generate).toHaveBeenCalledTimes(1)
      expect(acceptedSignal?.aborted).toBeFalse()

      await act(async () => {
        root?.render(<div data-active-canvas-id="canvas-two">Another Canvas</div>)
      })
      expect(document.querySelector("[data-active-canvas-id='canvas-two']")).not.toBeNull()
      expect(acceptedSignal?.aborted).toBeFalse()

      await act(async () => {
        root?.render(
          <CanvasCardConversationPanel
            agent={<div>Agent conversation</div>}
            request={{
              ...request,
              generation: {
                ...request.generation!,
                initialPrompt: "Keep generating while I switch Canvas",
                ownerToolId: "creative-tools/image.generate",
              },
            }}
            service={service}
          />,
        )
      })
      expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "Keep generating while I switch Canvas",
      )
      expect(acceptedSignal?.aborted).toBeFalse()

      resolveGeneration({
        createdNodeIds: ["generated"],
        revision: 8,
        toolId: "creative-tools/image.generate",
        warnings: [],
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(acceptedSignal?.aborted).toBeFalse()

      await act(async () => {
        root?.render(<div data-active-canvas-id="canvas-two">Another Canvas</div>)
        await Promise.resolve()
        root?.render(
          <CanvasCardConversationPanel
            agent={<div>Agent conversation</div>}
            request={{
              ...request,
              generation: {
                ...request.generation!,
                initialPrompt: "Keep generating while I switch Canvas",
              },
            }}
            service={service}
          />,
        )
      })
      expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "Keep generating while I switch Canvas",
      )
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("propagates terminal failure and explicit cancellation without creating renderer-owned task state", async () => {
    await expect(
      executeCanvasCardGeneration({
        generate: async () => {
          throw new Error("Generation service unavailable")
        },
        request: generationRequest(),
      }),
    ).rejects.toThrow("Generation service unavailable")

    const controller = new AbortController()
    await expect(
      executeCanvasCardGeneration({
        generate: async () => {
          controller.abort(new DOMException("Cancelled", "AbortError"))
          throw controller.signal.reason
        },
        request: generationRequest(controller.signal),
      }),
    ).rejects.toThrow("Cancelled")
  })

  test("shows the bounded tool diagnostic before Electron's generation IPC wrapper", () => {
    const wrapped = new Error(
      "Error invoking remote method 'generation:generate': GenerationToolReportedError: Generation tool failed: XiaoYunque accepted the generation, but repeated status checks were rejected.",
    )

    expect(generationErrorMessage(wrapped)).toBe(
      "Generation tool failed: XiaoYunque accepted the generation, but repeated status checks were rejected.",
    )
  })

  test("does not rewrite ordinary errors or errors from another IPC channel", () => {
    for (const message of [
      "Error invoking remote method 'generation:generate': Error: Generation service unavailable",
      "Error invoking remote method 'plugin-service:status': GenerationToolReportedError: Generation tool failed",
    ]) {
      expect(generationErrorMessage(new Error(message))).toBe(message)
    }
  })

  test("keeps the file owner in Agent context without turning it into a generation mention", () => {
    expect(canvasCardAgentContextNodeIds({ mode: "file", ownerNodeId: "managed-image" })).toEqual(["managed-image"])
    expect(
      canvasCardAgentContextNodeIds({
        mode: "agent",
        ownerNodeId: "agent-card",
      }),
    ).toEqual([])
    expect(
      canvasCardAgentInitialMentionNodeIds({
        mentionedNodeIds: ["connected-image", "connected-video", "connected-image"],
      }),
    ).toEqual(["connected-image", "connected-video"])
  })

  test("invalidates stale catalog and description responses after scope changes", () => {
    const tracker = new CanvasCardGenerationCatalogRequestTracker()
    const first = tracker.begin("canvas:node:catalog-1")
    expect(first()).toBeTrue()
    const second = tracker.begin("canvas:node:catalog-2")
    expect(first()).toBeFalse()
    expect(second()).toBeTrue()
    tracker.invalidate()
    expect(second()).toBeFalse()
  })

  test("does not render an implicit owner mention in the generation composer", () => {
    const owner = imageNode()
    const markup = renderToStaticMarkup(
      <CanvasCardConversationPanel
        agent={<div data-agent-panel>Agent conversation</div>}
        request={assistantRequest(owner)}
        service={{
          describeTool: async (toolId) => ({ fields: [], toolId }),
          generate: async () => ({ createdNodeIds: [], revision: 8, toolId: "tools/image", warnings: [] }),
          listTools: async () => [],
        }}
      />,
    )

    expect(markup).not.toContain("@ reference.png")
  })

  test("restores the failed generation prompt into the explicit retry composer", () => {
    const owner = imageNode()
    const request = assistantRequest(owner)
    const markup = renderToStaticMarkup(
      <CanvasCardConversationPanel
        agent={<div data-agent-panel>Agent conversation</div>}
        request={{
          ...request,
          generation: { ...request.generation!, initialPrompt: "A small rabbit" },
        }}
        service={{
          describeTool: async (toolId) => ({ fields: [], toolId }),
          generate: async () => ({ createdNodeIds: [], revision: 8, toolId: "tools/image", warnings: [] }),
          listTools: async () => [],
        }}
      />,
    )

    expect(markup).toContain(">A small rabbit</textarea>")
  })

  test("keeps image generation and Agent modes inside one large unfocused composer surface", () => {
    const service: CanvasGenerateService = {
      describeTool: async (toolId) => ({ fields: [], toolId }),
      generate: async () => ({ createdNodeIds: ["generated"], revision: 8, toolId: "tools/image", warnings: [] }),
      listTools: async () => [],
    }
    const owner = imageNode()
    const markup = renderToStaticMarkup(
      <CanvasCardConversationPanel
        agent={<div data-agent-panel>Agent conversation</div>}
        request={assistantRequest(owner, [owner], [owner.id])}
        service={service}
      />,
    )

    expect(markup).toContain('data-canvas-card-conversation-panel="true"')
    expect(markup).toContain('aria-label="卡片对话模式"')
    expect(markup).toContain("inline-grid w-fit")
    expect(markup).toContain("rounded-[28px]")
    expect(markup).toContain(">生成<")
    expect(markup).toContain(">Agent<")
    expect(markup.match(/role="tab"/g)).toHaveLength(2)
    expect(markup).not.toContain('aria-label="生成类型"')
    expect(markup).toContain('aria-label="Generation prompt"')
    expect(markup).not.toContain('autofocus=""')
    expect(markup).toContain('data-canvas-card-generation-surface="single"')
    expect(markup).toContain("min-h-28 max-h-48 flex-1 resize-none")
    expect(markup).not.toContain("rounded-2xl border border-border/60 bg-card shadow-sm")
    expect(markup).not.toContain("Auto")
    expect(markup).not.toContain("自动")
    expect(markup).not.toContain("跟随 Agent")
    expect(markup).toContain("正在加载模型…")
    expect(markup).toContain("items-center gap-1 pt-1")
    expect(markup).toContain('aria-label="Generate"')
    const generateButton = markup.match(/<button[^>]*aria-label="Generate"[^>]*>/)?.[0] ?? ""
    expect(generateButton).toContain("size-8")
    expect(generateButton).toContain("rounded-md")
    expect(generateButton).not.toContain("rounded-full")
    expect(markup).toContain('data-agent-composer-token=""')
    expect(markup).toContain(">reference.png</span>")
    expect(markup).toContain('aria-label="Remove Canvas reference: reference.png"')
    expect(markup).not.toContain("reference_image 参考输入")
    expect(markup).toContain("data-agent-panel")
    expect(markup.match(/hidden=""/g)).toHaveLength(1)
    expect(markup).not.toContain("h-[380px]")
  })

  test("shows every incoming card as a removable @ and flags unsupported generation inputs", () => {
    const owner = imageNode()
    const folder = createFolderNode({
      id: "folder-input",
      position: { x: -320, y: 0 },
      resource: {
        id: "folder-resource",
        kind: "folder",
        metadata: {},
        name: "Source folder",
        state: { status: "ready" },
      },
    })
    const request = assistantRequest(owner, [owner, folder], [folder.id])
    const markup = renderToStaticMarkup(
      <CanvasCardConversationPanel
        agent={<div>Agent</div>}
        request={request}
        service={{
          describeTool: async (toolId) => ({ fields: [], toolId }),
          generate: async () => ({ createdNodeIds: [], revision: 8, toolId: "tools/image", warnings: [] }),
          listTools: async () => [],
        }}
      />,
    )

    expect(markup).toContain('data-agent-composer-token=""')
    expect(markup).toContain(">Source folder</span>")
    expect(markup).toContain("border-amber-500/35 bg-amber-500/10")
    expect(markup).toContain('aria-label="Remove Canvas reference: Source folder"')
  })

  test("renders only Agent for text, audio, folder, and plugin cards", () => {
    const service: CanvasGenerateService = {
      describeTool: async (toolId) => ({ fields: [], toolId }),
      generate: async () => ({ createdNodeIds: [], revision: 8, toolId: "tools/image", warnings: [] }),
      listTools: async () => [],
    }
    const nodes: CanvasNode[] = [
      createTextNode({
        id: "text",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/notes.md" } },
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "notes" },
      }),
      createMediaNode({
        id: "audio",
        position: { x: 0, y: 0 },
        resource: {
          id: "audio-resource",
          kind: "audio",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/audio.mp3" } },
          state: { status: "ready", url: "asset://audio" },
        },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: {
          id: "folder-resource",
          kind: "folder",
          metadata: { [projectResourceReferenceKey]: { kind: "project-directory", path: "Media" } },
          name: "Folder",
          state: { status: "ready" },
        },
      }),
      {
        data: { kind: "plugin.example", label: "Plugin" },
        id: "plugin",
        position: { x: 0, y: 0 },
        type: "file",
      },
    ]

    for (const owner of nodes) {
      const markup = renderToStaticMarkup(
        <CanvasCardConversationPanel
          agent={<div data-agent-panel>Agent conversation</div>}
          request={assistantRequest(owner)}
          service={service}
        />,
      )
      expect(markup).toContain('data-canvas-card-agent-only="true"')
      expect(markup).toContain("data-agent-panel")
      expect(markup).not.toContain('aria-label="卡片对话模式"')
      expect(markup).not.toContain('aria-label="Generation prompt"')
      expect(markup).not.toContain('aria-label="Model"')
    }
  })
})
