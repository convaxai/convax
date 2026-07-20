import { describe, expect, test } from "bun:test"
import { createAgentNode, createFolderNode, createGroupNode, createMediaNode, createTextNode } from "./document"
import {
  getCompatibleCanvasGenerationTools,
  getCanvasGenerationReferenceError,
  inferCanvasGenerationReferences,
  type CanvasGenerateService,
  type CanvasGenerationReference,
  type CanvasGenerationToolSummary,
} from "./services"

describe("Canvas generation services", () => {
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
      generate: async () => ({ createdNodeIds: [], revision: 1, toolId: "tools/image", warnings: [] }),
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

  test("infers semantic roles for supported selected file nodes", () => {
    const nodes = [
      createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "A lighthouse" }),
      createMediaNode({
        id: "image",
        position: { x: 0, y: 0 },
        resource: { id: "image-resource", kind: "image", url: "asset://image" },
      }),
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
      createMediaNode({
        id: "file",
        position: { x: 0, y: 0 },
        resource: { id: "file-resource", kind: "file", url: "asset://file" },
      }),
      createFolderNode({
        id: "folder",
        position: { x: 0, y: 0 },
        resource: { id: "folder-resource", kind: "folder", name: "Folder" },
      }),
      createAgentNode({ id: "agent", position: { x: 0, y: 0 } }),
      createGroupNode({ id: "group", height: 100, position: { x: 0, y: 0 }, width: 100 }),
    ]

    expect(
      inferCanvasGenerationReferences(nodes, [
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
    ).toEqual([
      { nodeId: "audio", role: "audio" },
      { nodeId: "brief", role: "text" },
      { nodeId: "image", role: "reference_image" },
      { nodeId: "video", role: "reference_video" },
    ])
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
  })
})
