import { describe, expect, test } from "bun:test"

import type { GenerationCanvasRequest, GenerationCanvasResult, GenerationToolSummary } from "../generation-contracts"
import type { GenerationCanvasAgentPort } from "./generation-agent-tools"
import { GenerationToolReportedError } from "./generation-canvas-service"
import {
  createPluginOperationAgentToolProvider,
  type PluginOperationAgentActiveCanvas,
} from "./plugin-operation-agent-tools"

const scope = { directory: "/project/a", scopeId: "project-a" }
const activeCanvas: PluginOperationAgentActiveCanvas = {
  canvasId: "canvas-main",
  revision: 7,
  scopeId: "project-a",
}

function operationTool(input: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return {
    acceptedInputs: ["reference_video", "audio"],
    agentId: "transform_media",
    description: "Transform selected media with the installed operation.",
    id: "media-operations/transform.media",
    kind: "operation",
    output: "video",
    pluginId: "media-operations",
    pluginName: "Media Operations",
    title: "Transform media",
    toolId: "transform.media",
    ...input,
  }
}

function modelTool(): GenerationToolSummary {
  return {
    ...operationTool(),
    agentId: undefined,
    id: "image-service/generate.image",
    kind: "model",
    output: "image",
    pluginId: "image-service",
    toolId: "generate.image",
  }
}

function returnOperationTool(input: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return operationTool({
    acceptedInputs: ["reference_video", "reference_image"],
    agentId: "import_media",
    delivery: "return",
    description: "Import connected media into an external editing project.",
    id: "media-operations/import.media",
    inputBinding: "direct-incoming",
    output: "text",
    title: "Import media",
    toolId: "import.media",
    ...input,
  })
}

class FakeGenerationService implements GenerationCanvasAgentPort {
  calls: Array<{
    actor: { id: string; kind: "agent" }
    request: GenerationCanvasRequest
    signal?: AbortSignal
  }> = []

  constructor(public tools: readonly GenerationToolSummary[] = [operationTool()]) {}

  async listTools() {
    return this.tools
  }

  async generate(
    request: GenerationCanvasRequest,
    actor: { id: string; kind: "agent" },
    signal?: AbortSignal,
  ): Promise<GenerationCanvasResult> {
    this.calls.push({ actor, request, signal })
    if (request.resultMode?.type === "return") {
      return {
        createdNodeIds: [],
        outputText: '{"assetIds":["asset-one"]}',
        revision: request.expectedRevision,
        toolId: request.toolId ?? "missing",
        warnings: [],
      }
    }
    return {
      createdNodeIds: ["operation-result"],
      revision: request.expectedRevision + 1,
      toolId: request.toolId ?? "missing",
      warnings: ["view refresh was skipped"],
    }
  }
}

function provider(service: FakeGenerationService, active: PluginOperationAgentActiveCanvas | null = activeCanvas) {
  return createPluginOperationAgentToolProvider(service, {
    resolveActiveCanvas: async () => active,
  })
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    anchor: { x: 420, y: 240 },
    references: [{ nodeId: "video-source", role: "reference_video" }],
    relationNodeIds: ["related-card"],
    toolInput: { mode: "fast", preserveAudio: true, quality: 80 },
    ...overrides,
  }
}

describe("Plugin operation Agent tools", () => {
  test("derives tools from operation metadata without knowing any concrete Plugin id", async () => {
    const service = new FakeGenerationService([
      modelTool(),
      operationTool({
        agentId: undefined,
        id: "hidden-operations/hidden",
        pluginId: "hidden-operations",
        toolId: "hidden",
      }),
      operationTool(),
      operationTool({
        acceptedInputs: [],
        agentId: "inspect",
        description: "Inspect managed media.",
        id: "asset-inspector/inspect",
        output: "text",
        pluginId: "asset-inspector",
        toolId: "inspect",
      }),
    ])

    const definitions = await provider(service).listTools(scope)

    expect(definitions.map((definition) => definition.name)).toEqual([
      "plugin_asset_inspector_inspect",
      "plugin_media_operations_transform_media",
    ])
    expect(definitions.map((definition) => definition.description)).toEqual([
      expect.stringContaining("asset-inspector/inspect"),
      expect.stringContaining("media-operations/transform.media"),
    ])
    expect(definitions.map((definition) => definition.description).join(" ")).not.toContain("image-service")
    expect(definitions.map((definition) => definition.description).join(" ")).not.toContain("hidden-operations")
  })

  test("publishes only the fixed host-scoped input envelope", async () => {
    const [definition] = await provider(new FakeGenerationService()).listTools(scope)
    const schema = definition?.inputSchema as {
      additionalProperties: boolean
      properties: {
        anchor: { type: string }
        references: { items: { properties: { role: { enum: string[] } } }; maxItems: number }
        relationNodeIds: { maxItems: number; uniqueItems: boolean }
        toolInput: { maxProperties: number }
      }
      required: string[]
    }

    expect(schema.additionalProperties).toBeFalse()
    expect(Object.keys(schema.properties)).toEqual(["anchor", "references", "relationNodeIds", "toolInput"])
    expect(schema.properties.references.items.properties.role.enum).toEqual(["reference_video", "audio"])
    expect(schema.properties.references.maxItems).toBe(32)
    expect(schema.properties.relationNodeIds).toMatchObject({ maxItems: 32, uniqueItems: true })
    expect(schema.properties.toolInput.maxProperties).toBe(32)
    expect(schema.required).toEqual(["references"])
  })

  test("publishes a sink schema and returns operation text without exposing Canvas output controls", async () => {
    const service = new FakeGenerationService([returnOperationTool()])
    const operationProvider = provider(service)
    const [definition] = await operationProvider.listTools(scope)
    const schema = definition?.inputSchema as {
      additionalProperties: boolean
      properties: {
        ownerNodeId: { type: string }
        references: { items: { properties: { role: { enum: string[] } } } }
        toolInput: { maxProperties: number }
      }
      required: string[]
    }

    expect(definition?.description).toContain("without creating a Canvas node")
    expect(schema.additionalProperties).toBeFalse()
    expect(Object.keys(schema.properties)).toEqual(["ownerNodeId", "references", "toolInput"])
    expect(schema.properties.references.items.properties.role.enum).toEqual(["reference_video", "reference_image"])
    expect(schema.required).toEqual(["ownerNodeId", "references"])

    await expect(
      operationProvider.callTool(
        scope,
        "plugin_media_operations_import_media",
        {
          ownerNodeId: "plugin-card",
          references: [{ nodeId: "video-source", role: "reference_video" }],
          toolInput: { endpoint: "https://upload.invalid", token: "short-lived" },
        },
        {},
      ),
    ).resolves.toEqual({
      changed: false,
      createdNodeIds: [],
      outputText: '{"assetIds":["asset-one"]}',
      revision: 7,
      toolId: "media-operations/import.media",
      warnings: [],
    })

    expect(service.calls[0]?.request).toMatchObject({
      anchor: { x: 0, y: 0 },
      expectedOutputCount: 1,
      expectedRevision: 7,
      output: "text",
      referenceConstraint: {
        ownerNodeId: "plugin-card",
        ownerPluginId: "media-operations",
        type: "direct-incoming",
      },
      references: [{ nodeId: "video-source", role: "reference_video" }],
      resultMode: { type: "return" },
      toolId: "media-operations/import.media",
      toolInput: { endpoint: "https://upload.invalid", token: "short-lived" },
    })
    expect(service.calls[0]?.request).not.toHaveProperty("relationAnchorNodeIds")

    for (const input of [
      {
        anchor: { x: 10, y: 20 },
        ownerNodeId: "plugin-card",
        references: [{ nodeId: "video-source", role: "reference_video" }],
      },
      {
        ownerNodeId: "plugin-card",
        references: [{ nodeId: "video-source", role: "reference_video" }],
        relationNodeIds: ["video-source"],
      },
      {
        ownerNodeId: "plugin-card",
        ownerPluginId: "caller-selected",
        references: [{ nodeId: "video-source", role: "reference_video" }],
      },
    ]) {
      await expect(operationProvider.callTool(scope, "plugin_media_operations_import_media", input)).rejects.toThrow(
        "unsupported field",
      )
    }
    expect(service.calls).toHaveLength(1)

    await expect(
      operationProvider.callTool(scope, "plugin_media_operations_import_media", {
        references: [{ nodeId: "video-source", role: "reference_video" }],
      }),
    ).rejects.toThrow("ownerNodeId")
    expect(service.calls).toHaveLength(1)
  })

  test("derives Canvas authority and operation identity from the host", async () => {
    const service = new FakeGenerationService()
    const cancellation = new AbortController()

    await expect(
      provider(service).callTool(scope, "plugin_media_operations_transform_media", validInput(), {
        signal: cancellation.signal,
      }),
    ).resolves.toEqual({
      changed: true,
      createdNodeIds: ["operation-result"],
      revision: 8,
      toolId: "media-operations/transform.media",
      warnings: ["view refresh was skipped"],
    })

    expect(service.calls).toHaveLength(1)
    const call = service.calls[0]!
    expect(call.actor).toEqual({ id: "opencode:project-a", kind: "agent" })
    expect(call.signal).toBe(cancellation.signal)
    expect(call.request).toMatchObject({
      anchor: { x: 420, y: 240 },
      expectedOutputCount: 1,
      expectedRevision: 7,
      output: "video",
      prompt: "Run installed Plugin operation media-operations/transform.media.",
      ref: { canvasId: "canvas-main", scopeId: "project-a" },
      references: [{ nodeId: "video-source", role: "reference_video" }],
      relationAnchorNodeIds: ["related-card"],
      toolId: "media-operations/transform.media",
      toolInput: { mode: "fast", preserveAudio: true, quality: 80 },
    })
    expect(call.request.operationId).toMatch(/^plugin-operation-[0-9a-f-]{36}$/u)
  })

  test("uses safe defaults for optional operation input", async () => {
    const service = new FakeGenerationService()

    await provider(service).callTool(scope, "plugin_media_operations_transform_media", { references: [] })

    expect(service.calls[0]?.request).toMatchObject({
      anchor: { x: 0, y: 0 },
      references: [],
    })
    expect(service.calls[0]?.request).not.toHaveProperty("relationAnchorNodeIds")
    expect(service.calls[0]?.request).not.toHaveProperty("toolInput")
  })

  test("rejects caller-selected scope, paths, roles and unbounded input before execution", async () => {
    const attempts: Array<[Record<string, unknown>, string]> = [
      [validInput({ canvasId: "other-canvas" }), "unsupported field"],
      [validInput({ expectedRevision: 99 }), "unsupported field"],
      [validInput({ operationId: "chosen-by-agent" }), "unsupported field"],
      [
        validInput({ references: [{ nodeId: "video-source", path: "/tmp/secret", role: "reference_video" }] }),
        "unsupported field",
      ],
      [validInput({ references: [{ nodeId: "/tmp/secret", role: "reference_video" }] }), "Canvas node id"],
      [validInput({ references: [{ nodeId: "video-source", role: "reference_image" }] }), "not accepted"],
      [validInput({ relationNodeIds: ["related-card", "related-card"] }), "duplicate"],
      [validInput({ relationNodeIds: ["../private"] }), "Canvas node id"],
      [validInput({ anchor: { x: Number.POSITIVE_INFINITY, y: 0 } }), "anchor.x"],
      [validInput({ toolInput: { nested: { command: "hidden" } } }), "value is invalid"],
      [validInput({ toolInput: { prompt: "override" } }), "cannot override host field"],
    ]

    for (const [input, message] of attempts) {
      const service = new FakeGenerationService()
      await expect(provider(service).callTool(scope, "plugin_media_operations_transform_media", input)).rejects.toThrow(
        message,
      )
      expect(service.calls).toEqual([])
    }
  })

  test("requires a live Canvas in the authoritative Agent scope", async () => {
    const service = new FakeGenerationService()

    await expect(
      provider(service, null).callTool(scope, "plugin_media_operations_transform_media", validInput()),
    ).rejects.toThrow("Open a Canvas")
    await expect(
      provider(service, { ...activeCanvas, scopeId: "project-b" }).callTool(
        scope,
        "plugin_media_operations_transform_media",
        validInput(),
      ),
    ).rejects.toThrow("Open a Canvas")
    await expect(
      provider(service, { ...activeCanvas, revision: -1 }).callTool(
        scope,
        "plugin_media_operations_transform_media",
        validInput(),
      ),
    ).rejects.toThrow("revision")
    expect(service.calls).toEqual([])
  })

  test("fails closed for unknown, removed, malformed or colliding declarations", async () => {
    const service = new FakeGenerationService()
    const operationProvider = provider(service)
    await expect(operationProvider.callTool(scope, "plugin_missing_run", validInput())).rejects.toThrow("not installed")

    service.tools = []
    await expect(
      operationProvider.callTool(scope, "plugin_media_operations_transform_media", validInput()),
    ).rejects.toThrow("not installed")

    const malformed = [
      operationTool({ pluginId: "Media-Operations" }),
      operationTool({ agentId: "Transform-Media" }),
      operationTool({ id: "other/transform.media" }),
      operationTool({ acceptedInputs: ["reference_video", "reference_video"] }),
      returnOperationTool({ delivery: "unsupported" as "return" }),
      returnOperationTool({ inputBinding: "unsupported" as "direct-incoming" }),
      returnOperationTool({ acceptedInputs: [] }),
      returnOperationTool({ output: "video" }),
    ]
    for (const tool of malformed) {
      await expect(provider(new FakeGenerationService([tool])).listTools(scope)).rejects.toThrow()
    }

    await expect(
      provider(
        new FakeGenerationService([
          operationTool(),
          operationTool({ id: "media-operations/transform.other", toolId: "transform.other" }),
        ]),
      ).listTools(scope),
    ).rejects.toThrow("name is duplicated")
  })

  test("propagates cancellation and normalized Plugin failures while sanitizing internal errors", async () => {
    const preCanceledService = new FakeGenerationService()
    const canceled = new AbortController()
    canceled.abort()
    await expect(
      provider(preCanceledService).callTool(scope, "plugin_media_operations_transform_media", validInput(), {
        signal: canceled.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(preCanceledService.calls).toEqual([])

    const reportedService = new FakeGenerationService()
    reportedService.generate = async () => {
      throw new GenerationToolReportedError([{ text: "The selected range is empty", type: "text" }])
    }
    await expect(
      provider(reportedService).callTool(scope, "plugin_media_operations_transform_media", validInput()),
    ).rejects.toMatchObject({
      message: "Generation tool failed: The selected range is empty",
      name: "GenerationToolReportedError",
    })

    const internalService = new FakeGenerationService()
    internalService.generate = async () => {
      throw new Error("cookie=secret at /private/tmp/output.mp4")
    }
    const error = await provider(internalService)
      .callTool(scope, "plugin_media_operations_transform_media", validInput())
      .catch((failure) => failure)
    if (!(error instanceof Error)) throw new Error("Expected Plugin operation to reject with an Error")
    expect(error).toMatchObject({
      message: "Plugin operation could not be completed; refresh the Canvas state before retrying",
    })
    expect(error.message).not.toContain("secret")
    expect(error.message).not.toContain("/private/tmp")
  })

  test("fails closed when a return operation violates the service result contract", async () => {
    const service = new FakeGenerationService([returnOperationTool()])
    service.generate = async (request) => ({
      createdNodeIds: ["unexpected-node"],
      revision: request.expectedRevision + 1,
      toolId: request.toolId ?? "missing",
      warnings: [],
    })

    await expect(
      provider(service).callTool(scope, "plugin_media_operations_import_media", {
        ownerNodeId: "plugin-card",
        references: [{ nodeId: "video-source", role: "reference_video" }],
      }),
    ).rejects.toThrow("Plugin operation could not be completed")
  })
})
