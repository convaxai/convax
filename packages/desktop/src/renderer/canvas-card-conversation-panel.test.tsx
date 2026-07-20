import {
  createCanvasDocument,
  createFolderNode,
  createGroupNode,
  createMediaNode,
  createTextNode,
  type CanvasAssistantRequest,
  type CanvasGenerateService,
  type CanvasGenerationToolDescription,
  type CanvasGenerationToolSummary,
  type CanvasNode,
} from "@convax/canvas"
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  CanvasCardConversationPanel,
  CanvasCardGenerationCatalogRequestTracker,
  canvasCardGenerationOutput,
  canvasCardGenerationReferences,
  compatibleCanvasCardGenerationTools,
  createCanvasCardGenerationRequest,
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
        mimeType: "image/png",
        name: "reference.png",
        url: "convax-asset://project/image",
      },
    }),
    style: { height: 320, width: 480 },
    ...overrides,
  }
}

function assistantRequest(node: CanvasNode, nodes: CanvasNode[] = [node]): CanvasAssistantRequest {
  return {
    document: {
      ...createCanvasDocument({ id: "canvas-one", nodes }),
      revision: 7,
    },
    mentionedNodeIds: [node.id],
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
  test("derives text and media output from the owner without rendering modality tabs", () => {
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

    expect(nodes.map((node) => canvasCardGenerationOutput(assistantRequest(node, nodes)))).toEqual([
      "text",
      "image",
      "video",
      "audio",
      undefined,
      undefined,
    ])
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

  test("fails closed for a stale node override and otherwise keeps the unique-tool Auto fallback", () => {
    const only = tool()

    expect(
      resolveCanvasCardGenerationTool("tools/uninstalled", [only], { id: only.id, output: "image" }),
    ).toBeUndefined()
    expect(resolveCanvasCardGenerationTool(undefined, [only])).toBe(only)
    expect(resolveCanvasCardGenerationTool(undefined, [only, tool({ id: "tools/other" })])).toBeUndefined()
    expect(resolveCanvasCardGenerationTool(undefined, [only], { id: only.id, output: "video" })).toBe(only)
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
    const request = assistantRequest(node, [group, node])
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
      signal: controller.signal,
      toolId: "creative-tools/image.generate",
      toolInput: { aspect_ratio: "16:9", steps: 24 },
    })
  })

  test("uses the selected model output for generic cards and omits empty tool input", () => {
    const node = createFolderNode({
      id: "folder",
      position: { x: 3, y: 4 },
      resource: { id: "folder-resource", kind: "folder", name: "Folder" },
    })
    const selected = tool({ acceptedInputs: [], id: "sound/audio.generate", output: "audio" })
    const emptyDescription = { fields: [], toolId: selected.id } satisfies CanvasGenerationToolDescription

    expect(
      createCanvasCardGenerationRequest({
        description: emptyDescription,
        prompt: "A soft opening",
        request: assistantRequest(node),
        signal: new AbortController().signal,
        tool: selected,
        toolInput: {},
      }),
    ).toMatchObject({
      output: "audio",
      prompt: "A soft opening",
      toolId: selected.id,
    })
    expect(
      createCanvasCardGenerationRequest({
        description: emptyDescription,
        prompt: "A soft opening",
        request: assistantRequest(node),
        signal: new AbortController().signal,
        tool: selected,
        toolInput: {},
      }),
    ).not.toHaveProperty("toolInput")
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

  test("infers text, image, video, and audio references but leaves folder and Plugin cards prompt-only", () => {
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

    expect(nodes.map((node) => canvasCardGenerationReferences(assistantRequest(node, nodes)))).toEqual([
      [{ nodeId: "text", role: "text" }],
      [{ nodeId: "image", role: "reference_image" }],
      [{ nodeId: "video", role: "reference_video" }],
      [{ nodeId: "audio", role: "audio" }],
      [],
      [],
    ])
  })

  test("filters known owner output but lets a generic card choose across compatible modalities", () => {
    const references = [{ nodeId: "image-card", role: "reference_image" as const }]
    const tools = [
      tool(),
      tool({ id: "tools/prompt-image", acceptedInputs: [] }),
      tool({ id: "tools/video-with-reference", output: "video" }),
    ]

    expect(compatibleCanvasCardGenerationTools(tools, "image", references).map((item) => item.id)).toEqual([
      "creative-tools/image.generate",
    ])
    expect(compatibleCanvasCardGenerationTools(tools, undefined, references).map((item) => item.id)).toEqual([
      "creative-tools/image.generate",
      "tools/video-with-reference",
    ])
  })
})

describe("Canvas card generation lifecycle", () => {
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

  test("keeps both panels mounted with compact top-level tabs and one composer toolbar", () => {
    const service: CanvasGenerateService = {
      describeTool: async (toolId) => ({ fields: [], toolId }),
      generate: async () => ({ createdNodeIds: ["generated"], revision: 8, toolId: "tools/image", warnings: [] }),
      listTools: async () => [],
    }
    const markup = renderToStaticMarkup(
      <CanvasCardConversationPanel
        agent={<div data-agent-panel>Agent conversation</div>}
        request={assistantRequest(imageNode())}
        service={service}
      />,
    )

    expect(markup).toContain('data-canvas-card-conversation-panel="true"')
    expect(markup).toContain('aria-label="卡片对话模式"')
    expect(markup).toContain("inline-grid w-fit")
    expect(markup).toContain(">生成<")
    expect(markup).toContain(">Agent<")
    expect(markup.match(/role="tab"/g)).toHaveLength(2)
    expect(markup).not.toContain('aria-label="生成类型"')
    expect(markup).toContain('aria-label="Generation prompt"')
    expect(markup).toContain("min-h-16 max-h-24")
    expect(markup).not.toContain("min-h-28 flex-1 resize-none")
    expect(markup).toContain('aria-label="Model"')
    expect(markup).toContain('aria-label="Generate"')
    expect(markup).toContain("@ reference.png")
    expect(markup).not.toContain("reference_image 参考输入")
    expect(markup).toContain("data-agent-panel")
    expect(markup.match(/hidden=""/g)).toHaveLength(1)
    expect(markup).not.toContain("h-[380px]")
  })
})
