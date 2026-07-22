import {
  createCanvasDocument,
  createFolderNode,
  createGroupNode,
  createMediaNode,
  createTextNode,
  type CanvasAssistantRequest,
  type CanvasAssistantGenerationActivity,
  type CanvasGenerateRequest,
  type CanvasGenerateResult,
  type CanvasGenerateService,
  type CanvasGenerationToolDescription,
  type CanvasGenerationToolSummary,
  type CanvasNode,
} from "@convax/canvas"
import { projectFileReferenceKey } from "@convax/project/canvas"
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  CanvasCardConversationPanel,
  CanvasCardGenerationCatalogRequestTracker,
  canvasCardAgentContextNodeIds,
  canvasCardGenerationOutput,
  canvasCardGenerationReferences,
  compatibleCanvasCardGenerationTools,
  createCanvasCardGenerationRequest,
  executeCanvasCardGeneration,
  resolveCanvasCardGenerationTool,
  validateCanvasCardGenerationToolInput,
} from "./canvas-card-conversation-panel"

function imageNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    ...createMediaNode({
      id: "image-card",
      position: { x: 10, y: 20 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/reference.png" } },
        mimeType: "image/png",
        name: "reference.png",
        url: "convax-asset://project/image",
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
  test("inherits the Agent model until this node stores its own override", () => {
    const first = tool()
    const second = tool({ id: "tools/other", title: "Other image" })
    const third = tool({ id: "tools/third", title: "Third image" })

    expect(resolveCanvasCardGenerationTool(undefined, [first, second], { id: first.id, output: "image" })).toBe(first)
    expect(resolveCanvasCardGenerationTool(undefined, [first, second], { id: second.id, output: "image" })).toBe(second)
    expect(resolveCanvasCardGenerationTool(second.id, [first, second], { id: first.id, output: "image" })).toBe(second)
    expect(resolveCanvasCardGenerationTool(second.id, [second, third], { id: third.id, output: "image" })).toBe(second)
  })

  test("replaces a stale persisted id only with an unambiguous same-output fallback", () => {
    const staleId = "xiaoyunque-generation/image.nova2"
    const image = tool()
    const otherImage = tool({ id: "tools/other-image", title: "Other image" })
    const video = tool({ id: "tools/video", output: "video", title: "Video" })
    const agentVideo = { id: video.id, output: "video" as const }

    const fallback = resolveCanvasCardGenerationTool(staleId, [image, video], agentVideo, "image")
    expect(fallback).toBe(image)
    expect(resolveCanvasCardGenerationTool(staleId, [image, otherImage, video], agentVideo, "image")).toBeUndefined()
    expect(resolveCanvasCardGenerationTool(video.id, [image, video], agentVideo, "image")).toBeUndefined()

    const request = createCanvasCardGenerationRequest({
      description: { fields: [], toolId: fallback!.id },
      prompt: "A small rabbit",
      request: assistantRequest(imageNode()),
      signal: new AbortController().signal,
      tool: fallback!,
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
    const emptyImage = imageNode({ data: { kind: "image", label: "Image", url: "" } })
    const ownerOutput = canvasCardGenerationOutput(assistantRequest(emptyImage))

    expect(ownerOutput).toBe("image")
    expect(resolveCanvasCardGenerationTool(undefined, [image, video], agentVideo, ownerOutput)).toBe(image)
    expect(
      resolveCanvasCardGenerationTool(undefined, [image, otherImage, video], agentVideo, ownerOutput),
    ).toBeUndefined()
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
      output: "image",
      prompt: "Turn this into a poster",
      references: [{ nodeId: "image-card", role: "reference_image" }],
      resultMode: { nodeId: "image-card", type: "replace-node" },
      signal: controller.signal,
      toolId: "creative-tools/image.generate",
      toolInput: { aspect_ratio: "16:9", steps: 24 },
    })
  })

  test("rejects direct generation for generic and non-visual media cards", () => {
    const folder = createFolderNode({
      id: "folder",
      position: { x: 3, y: 4 },
      resource: { id: "folder-resource", kind: "folder", name: "Folder" },
    })
    const audio = createMediaNode({
      id: "audio",
      position: { x: 3, y: 4 },
      resource: { id: "audio-resource", kind: "audio", url: "asset://audio" },
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
        url: "",
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

  test("infers explicitly mentioned text, image, video, and audio references but leaves other cards prompt-only", () => {
    const nodes = [
      createTextNode({ id: "text", position: { x: 0, y: 0 }, text: "notes" }),
      imageNode({ id: "image" }),
      createMediaNode({
        id: "video",
        position: { x: 0, y: 0 },
        resource: { id: "video-resource", kind: "video", url: "asset://video" },
      }),
      createMediaNode({
        id: "audio",
        position: { x: 0, y: 0 },
        resource: { id: "audio-resource", kind: "audio", url: "asset://audio" },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: { id: "folder-resource", kind: "folder", name: "Folder" },
      }),
      {
        data: { kind: "plugin.example", label: "Plugin" },
        id: "plugin",
        position: { x: 0, y: 0 },
        type: "file" as const,
      },
    ]

    expect(nodes.map((node) => canvasCardGenerationReferences(assistantRequest(node, nodes, [node.id])))).toEqual([
      [{ nodeId: "text", role: "text" }],
      [{ nodeId: "image", role: "reference_image" }],
      [{ nodeId: "video", role: "reference_video" }],
      [{ nodeId: "audio", role: "audio" }],
      [],
      [],
    ])
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

  test("closes the composer into card pending state immediately and completes it only after generation", async () => {
    const activities: CanvasAssistantGenerationActivity[] = []
    let cancelled = false
    let resolveGeneration!: (result: CanvasGenerateResult) => void
    const generate: CanvasGenerateService["generate"] = () =>
      new Promise((resolve) => {
        resolveGeneration = resolve
      })
    const pending = executeCanvasCardGeneration({
      cancel: () => {
        cancelled = true
      },
      generate,
      onActivityChange: (activity) => activities.push(activity),
      request: generationRequest(),
    })

    expect(activities.map((activity) => activity.status)).toEqual(["pending"])
    expect(activities[0]?.status === "pending" && activities[0].cancel).toBeFunction()
    expect(activities[0]?.status === "pending" && activities[0].prompt).toBe("A small rabbit")
    resolveGeneration({
      createdNodeIds: ["generated"],
      revision: 8,
      toolId: "creative-tools/image.generate",
      warnings: [],
    })
    await expect(pending).resolves.toMatchObject({ createdNodeIds: ["generated"] })
    expect(activities.map((activity) => activity.status)).toEqual(["pending", "complete"])
    expect(cancelled).toBeFalse()
  })

  test("turns a terminal failure into a recoverable card error but does not surface cancellation as failure", async () => {
    const failureActivities: CanvasAssistantGenerationActivity[] = []
    await expect(
      executeCanvasCardGeneration({
        cancel: () => undefined,
        generate: async () => {
          throw new Error("Generation service unavailable")
        },
        onActivityChange: (activity) => failureActivities.push(activity),
        request: generationRequest(),
      }),
    ).rejects.toThrow("Generation service unavailable")
    expect(
      failureActivities.map((activity) => (activity.status === "error" ? activity : { status: activity.status })),
    ).toEqual([
      { status: "pending" },
      { message: "Generation service unavailable", prompt: "A small rabbit", status: "error" },
    ])

    const controller = new AbortController()
    const cancellationActivities: CanvasAssistantGenerationActivity[] = []
    await expect(
      executeCanvasCardGeneration({
        cancel: () => controller.abort(new DOMException("Disposed", "AbortError")),
        generate: async () => {
          controller.abort(new DOMException("Cancelled", "AbortError"))
          throw controller.signal.reason
        },
        onActivityChange: (activity) => cancellationActivities.push(activity),
        request: generationRequest(controller.signal),
      }),
    ).rejects.toThrow("Cancelled")
    expect(cancellationActivities.map((activity) => activity.status)).toEqual(["pending"])
  })

  test("shows the bounded tool diagnostic before Electron's generation IPC wrapper", async () => {
    const activities: CanvasAssistantGenerationActivity[] = []
    const wrapped = new Error(
      "Error invoking remote method 'generation:generate': GenerationToolReportedError: Generation tool failed: XiaoYunque accepted the generation, but repeated status checks were rejected.",
    )

    await expect(
      executeCanvasCardGeneration({
        cancel: () => undefined,
        generate: async () => {
          throw wrapped
        },
        onActivityChange: (activity) => activities.push(activity),
        request: generationRequest(),
      }),
    ).rejects.toBe(wrapped)
    expect(activities.at(-1)).toEqual({
      message: "Generation tool failed: XiaoYunque accepted the generation, but repeated status checks were rejected.",
      prompt: "A small rabbit",
      status: "error",
    })
  })

  test("does not rewrite ordinary errors or errors from another IPC channel", async () => {
    for (const message of [
      "Error invoking remote method 'generation:generate': Error: Generation service unavailable",
      "Error invoking remote method 'plugin-service:status': GenerationToolReportedError: Generation tool failed",
    ]) {
      const activities: CanvasAssistantGenerationActivity[] = []
      await expect(
        executeCanvasCardGeneration({
          cancel: () => undefined,
          generate: async () => {
            throw new Error(message)
          },
          onActivityChange: (activity) => activities.push(activity),
          request: generationRequest(),
        }),
      ).rejects.toThrow(message)
      expect(activities.at(-1)).toMatchObject({ message, status: "error" })
    }
  })

  test("keeps the file owner in Agent context without turning it into a generation mention", () => {
    expect(canvasCardAgentContextNodeIds({ mentionedNodeIds: [], mode: "file", ownerNodeId: "managed-image" })).toEqual(
      ["managed-image"],
    )
    expect(
      canvasCardAgentContextNodeIds({
        mentionedNodeIds: ["connected-image", "connected-video"],
        mode: "agent",
        ownerNodeId: "agent-card",
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
    expect(markup).toContain('aria-label="Model"')
    expect(markup).toContain(">Models</span>")
    expect(markup).toContain("justify-start gap-1 border-0 bg-transparent")
    expect(markup).not.toContain("rounded-full border-border/60 bg-muted/60")
    expect(markup).toContain("items-center gap-1 pt-1")
    expect(markup).toContain('aria-label="Generate"')
    const generateButton = markup.match(/<button[^>]*aria-label="Generate"[^>]*>/)?.[0] ?? ""
    expect(generateButton).toContain("size-8")
    expect(generateButton).toContain("rounded-md")
    expect(generateButton).not.toContain("rounded-full")
    expect(markup).toContain("@ reference.png")
    expect(markup).not.toContain("reference_image 参考输入")
    expect(markup).toContain("data-agent-panel")
    expect(markup.match(/hidden=""/g)).toHaveLength(1)
    expect(markup).not.toContain("h-[380px]")
  })

  test("renders only Agent for text, audio, folder, and plugin cards", () => {
    const service: CanvasGenerateService = {
      describeTool: async (toolId) => ({ fields: [], toolId }),
      generate: async () => ({ createdNodeIds: [], revision: 8, toolId: "tools/image", warnings: [] }),
      listTools: async () => [],
    }
    const nodes: CanvasNode[] = [
      createTextNode({ id: "text", position: { x: 0, y: 0 }, text: "notes" }),
      createMediaNode({
        id: "audio",
        position: { x: 0, y: 0 },
        resource: { id: "audio-resource", kind: "audio", url: "asset://audio" },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: { id: "folder-resource", kind: "folder", name: "Folder" },
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
