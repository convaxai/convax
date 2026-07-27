import { describe, expect, test } from "bun:test"

import type { GenerationCanvasRequest, GenerationCanvasResult, GenerationToolSummary } from "../generation-contracts"
import { createGenerationAgentToolProvider, type GenerationCanvasAgentPort } from "./generation-agent-tools"
import { GenerationToolReportedError } from "./generation-canvas-service"

const scope = { directory: "/project/a", scopeId: "project-a" }

function generationTool(input: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return {
    acceptedInputs: ["reference_image", "text"],
    description: "Do not leak this implementation description",
    id: "image-tools/generate.image",
    kind: "model",
    output: "image",
    pluginId: "image-tools",
    pluginName: "Do not leak this implementation name",
    title: "Do not leak this implementation title",
    toolId: "generate.image",
    ...input,
  }
}

class FakeGenerationService implements GenerationCanvasAgentPort {
  cancels: Array<{ actor: { id: string; kind: "agent" }; operationId: string }> = []
  calls: Array<{
    actor: { id: string; kind: "agent" }
    request: GenerationCanvasRequest
    signal?: AbortSignal
  }> = []
  tools: readonly GenerationToolSummary[]

  constructor(tools: readonly GenerationToolSummary[] = [generationTool()]) {
    this.tools = tools
  }

  async listTools() {
    return this.tools
  }

  async cancel(operationId: string, actor: { id: string; kind: "agent" }) {
    this.cancels.push({ actor, operationId })
  }

  async generate(
    request: GenerationCanvasRequest,
    actor: { id: string; kind: "agent" },
    signal?: AbortSignal,
  ): Promise<GenerationCanvasResult> {
    this.calls.push({ actor, request, signal })
    return {
      createdNodeIds: ["generated-1"],
      revision: request.expectedRevision + 1,
      toolId: request.toolId ?? "image-tools/generate.image",
      warnings: ["view refresh was skipped"],
    }
  }
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    anchor: { x: 320, y: 180 },
    canvasId: "canvas-main",
    commandId: "generate-1",
    expectedRevision: 4,
    output: "image",
    prompt: "Create a quiet landscape",
    promptContextNodeIds: [],
    references: [{ nodeId: "reference-1", role: "reference_image" }],
    toolId: "image-tools/generate.image",
    ...overrides,
  }
}

describe("generation Agent tool", () => {
  test("is advertised only when an installed generation tool exists", async () => {
    const service = new FakeGenerationService([])
    const provider = createGenerationAgentToolProvider(service)

    await expect(provider.listTools(scope)).resolves.toEqual([])
    await expect(provider.callTool(scope, "canvas_generate", validInput())).rejects.toThrow(
      "No generation Tool Plugin is installed",
    )
    expect(service.calls).toEqual([])

    service.tools = [generationTool()]
    expect((await provider.listTools(scope)).map((tool) => tool.name)).toEqual(["canvas_generate"])
  })

  test("exposes only declared models and never accepts operation tool ids", async () => {
    const service = new FakeGenerationService([
      generationTool({
        agentId: "transform_video",
        id: "media-operations/transform.video",
        kind: "operation",
        pluginId: "media-operations",
        toolId: "transform.video",
      }),
      generationTool(),
    ])
    const provider = createGenerationAgentToolProvider(service)
    const [definition] = await provider.listTools(scope)
    const schema = definition?.inputSchema as { properties: { toolId: { enum: string[] } } }
    expect(schema.properties.toolId.enum).toEqual(["image-tools/generate.image"])

    service.tools = [
      generationTool({
        agentId: "transform_video",
        id: "media-operations/transform.video",
        kind: "operation",
        pluginId: "media-operations",
        toolId: "transform.video",
      }),
    ]
    await expect(provider.listTools(scope)).resolves.toEqual([])
    await expect(provider.callTool(scope, "canvas_generate", validInput())).rejects.toThrow(
      "No generation Tool Plugin is installed",
    )
  })

  test("builds a dynamic schema from stable host tool ids without implementation labels", async () => {
    const service = new FakeGenerationService([
      generationTool({
        acceptedInputs: ["reference_video", "audio"],
        id: "motion-tools/generate.video",
        output: "video",
        pluginId: "motion-tools",
        pluginName: "Secret Company",
        title: "Secret Model Name",
        toolId: "generate.video",
      }),
      generationTool(),
    ])
    const provider = createGenerationAgentToolProvider(service)

    const [definition] = await provider.listTools(scope)
    expect(definition?.description).toContain("image-tools/generate.image")
    expect(definition?.description).toContain("motion-tools/generate.video")
    expect(definition?.description).toContain("reference_video, audio")
    expect(definition?.description).not.toContain("Secret Company")
    expect(definition?.description).not.toContain("Secret Model Name")
    expect(definition?.description).not.toContain("Do not leak this implementation")

    const schema = definition?.inputSchema as {
      additionalProperties: boolean
      properties: {
        output: { enum: string[] }
        promptContextNodeIds: { description: string; uniqueItems: boolean }
        references: { description: string }
        toolId: { enum: string[] }
        toolInput: { maxProperties: number; type: string }
      }
      required: string[]
    }
    expect(schema.additionalProperties).toBeFalse()
    expect(schema.properties.toolId.enum).toEqual(["image-tools/generate.image", "motion-tools/generate.video"])
    expect(schema.properties.output.enum).toEqual(["image", "video"])
    expect(schema.properties.toolInput).toMatchObject({ maxProperties: 32, type: "object" })
    expect(schema.properties.promptContextNodeIds).toMatchObject({ uniqueItems: true })
    expect(schema.properties.promptContextNodeIds.description).toContain("authoritative content Main appends")
    expect(schema.properties.references.description).toContain(
      "Use reference_image for ordinary single-image-to-video input",
    )
    expect(schema.properties.references.description).toContain("text references are never accepted")
    expect(schema.properties.references.description).toContain("first_frame may be used alone")
    expect(schema.properties.references.description).toContain("first_frame plus last_frame")
    expect(schema.required).toEqual([
      "anchor",
      "canvasId",
      "commandId",
      "expectedRevision",
      "prompt",
      "promptContextNodeIds",
      "references",
    ])
  })

  test("injects the authoritative Agent scope and actor and propagates cancellation context", async () => {
    const service = new FakeGenerationService()
    const provider = createGenerationAgentToolProvider(service)
    const cancellation = new AbortController()

    await expect(
      provider.callTool(scope, "canvas_generate", validInput(), {
        signal: cancellation.signal,
      }),
    ).resolves.toEqual({
      changed: true,
      createdNodeIds: ["generated-1"],
      revision: 5,
      toolId: "image-tools/generate.image",
      warnings: ["view refresh was skipped"],
    })

    expect(service.calls).toEqual([
      {
        actor: { id: "opencode:project-a", kind: "agent" },
        request: {
          anchor: { x: 320, y: 180 },
          expectedOutputCount: 1,
          expectedRevision: 4,
          operationId: "generate-1",
          output: "image",
          prompt: "Create a quiet landscape",
          promptContextNodeIds: [],
          ref: { canvasId: "canvas-main", scopeId: "project-a" },
          references: [{ nodeId: "reference-1", role: "reference_image" }],
          resultMode: { type: "create-pending-node" },
          toolId: "image-tools/generate.image",
        },
        signal: cancellation.signal,
      },
    ])
  })

  test("uses the stable commandId as the external operation id", async () => {
    const service = new FakeGenerationService()
    const provider = createGenerationAgentToolProvider(service)

    await provider.callTool(scope, "canvas_generate", validInput({ commandId: "agent-command-2" }))

    expect(service.calls[0]?.request.operationId).toBe("agent-command-2")
  })

  test("turns an OpenCode Stop into explicit Main cancellation for the same operation", async () => {
    const service = new FakeGenerationService()
    const cancellation = new AbortController()
    let reportEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      reportEntered = resolve
    })
    service.generate = (_request, _actor, signal) =>
      new Promise((_resolve, reject) => {
        reportEntered()
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    const pending = providerCall()
    await entered
    cancellation.abort(new DOMException("Stopped", "AbortError"))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(service.cancels).toEqual([{ actor: { id: "opencode:project-a", kind: "agent" }, operationId: "generate-1" }])

    function providerCall() {
      return createGenerationAgentToolProvider(service).callTool(scope, "canvas_generate", validInput(), {
        signal: cancellation.signal,
      })
    }
  })

  test("passes Canvas text as prompt context without requiring a text-capable model", async () => {
    const service = new FakeGenerationService([generationTool({ acceptedInputs: [] })])
    const provider = createGenerationAgentToolProvider(service)

    await provider.callTool(
      scope,
      "canvas_generate",
      validInput({ prompt: "", promptContextNodeIds: ["brief"], references: [] }),
    )

    expect(service.calls[0]?.request).toMatchObject({
      prompt: "",
      promptContextNodeIds: ["brief"],
      references: [],
      toolId: "image-tools/generate.image",
    })
  })

  test("passes only bounded scalar tool input through for Main to validate against the selected sidecar schema", async () => {
    const service = new FakeGenerationService()
    const provider = createGenerationAgentToolProvider(service)

    await provider.callTool(
      scope,
      "canvas_generate",
      validInput({ toolInput: { enhance: true, quality: "high", seed: 42, suffix: "" } }),
    )
    expect(service.calls[0]?.request.toolInput).toEqual({
      enhance: true,
      quality: "high",
      seed: 42,
      suffix: "",
    })

    for (const toolInput of [
      { prompt: "override" },
      { nested: { provider: "hidden" } },
      { seed: Number.POSITIVE_INFINITY },
    ]) {
      const isolated = new FakeGenerationService()
      await expect(
        createGenerationAgentToolProvider(isolated).callTool(scope, "canvas_generate", validInput({ toolInput })),
      ).rejects.toThrow()
      expect(isolated.calls).toEqual([])
    }
  })

  test("does not expose native or sidecar failure details to OpenCode", async () => {
    const service = new FakeGenerationService()
    service.generate = async () => {
      throw new Error("cookie=secret-value at /private/tmp/generated.png")
    }
    const provider = createGenerationAgentToolProvider(service)

    const error = await provider.callTool(scope, "canvas_generate", validInput()).catch((failure) => failure)
    if (!(error instanceof Error)) throw new Error("Expected generation to reject with an Error")
    expect(error).toMatchObject({
      message:
        "Canvas generation could not be completed; refresh the Canvas state before retrying with a new commandId",
    })
    expect(error.message).not.toContain("secret-value")
    expect(error.message).not.toContain("/private/tmp")
  })

  test("preserves only explicitly normalized generation tool failures for OpenCode", async () => {
    const service = new FakeGenerationService()
    service.generate = async () => {
      throw new GenerationToolReportedError([{ text: "First frame can be used without a last frame", type: "text" }])
    }
    const provider = createGenerationAgentToolProvider(service)

    await expect(provider.callTool(scope, "canvas_generate", validInput())).rejects.toMatchObject({
      message: "Generation tool failed: First frame can be used without a last frame",
      name: "GenerationToolReportedError",
    })
  })

  test("preserves cancellation errors from the shared generation operation", async () => {
    const service = new FakeGenerationService()
    service.generate = async () => {
      const error = new Error("stopped")
      error.name = "AbortError"
      throw error
    }
    const provider = createGenerationAgentToolProvider(service)

    await expect(provider.callTool(scope, "canvas_generate", validInput())).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  test("rejects caller attempts to widen scope or pass paths before invoking the service", async () => {
    const attempts = [
      validInput({ scopeId: "project-b" }),
      validInput({ ref: { canvasId: "canvas-other", scopeId: "project-b" } }),
      validInput({ projectPath: "/project/b" }),
      validInput({ references: [{ nodeId: "reference-1", path: "/tmp/input.png", role: "reference_image" }] }),
    ]

    for (const input of attempts) {
      const service = new FakeGenerationService()
      const provider = createGenerationAgentToolProvider(service)
      await expect(provider.callTool(scope, "canvas_generate", input)).rejects.toThrow("unsupported field")
      expect(service.calls).toEqual([])
    }
  })

  test("strictly validates ids, revisions, prompts, references, and capability selection", async () => {
    const invalidInputs: Array<[Record<string, unknown>, string]> = [
      [validInput({ canvasId: " canvas-main" }), "canvasId"],
      [validInput({ commandId: "" }), "commandId"],
      [validInput({ expectedRevision: 1.5 }), "expectedRevision"],
      [validInput({ prompt: "   " }), "prompt"],
      [validInput({ anchor: { x: Number.POSITIVE_INFINITY, y: 0 } }), "anchor.x"],
      [validInput({ anchor: { z: 1, x: 0, y: 0 } }), "unsupported field"],
      [validInput({ output: "document" }), "output"],
      [validInput({ toolId: "missing/generate" }), "not installed"],
      [validInput({ output: "video" }), "does not produce video"],
      [validInput({ references: [{ nodeId: "reference-1", role: "reference_video" }] }), "does not accept"],
      [validInput({ references: [{ nodeId: "reference-1", role: "text" }] }), "references[0].role"],
      [validInput({ references: [{ nodeId: "reference-1", role: "mask" }] }), "references[0].role"],
      [validInput({ promptContextNodeIds: ["brief", "brief"] }), "duplicate Canvas node"],
      [
        validInput({
          promptContextNodeIds: ["reference-1"],
          references: [{ nodeId: "reference-1", role: "reference_image" }],
        }),
        "same Canvas node",
      ],
      [
        validInput({
          promptContextNodeIds: Array.from({ length: 16 }, (_, index) => `brief-${index}`),
          references: Array.from({ length: 17 }, (_, index) => ({
            nodeId: `reference-${index}`,
            role: "reference_image",
          })),
        }),
        "32 total items",
      ],
      [
        validInput({
          references: [
            { nodeId: "reference-1", role: "reference_image" },
            { nodeId: "reference-1", role: "reference_image" },
          ],
        }),
        "duplicate",
      ],
    ]

    for (const [input, message] of invalidInputs) {
      const service = new FakeGenerationService()
      const provider = createGenerationAgentToolProvider(service)
      await expect(provider.callTool(scope, "canvas_generate", input)).rejects.toThrow(message)
      expect(service.calls).toEqual([])
    }
  })

  test("rejects unknown Agent tool names and malformed installed declarations", async () => {
    const service = new FakeGenerationService()
    const provider = createGenerationAgentToolProvider(service)
    await expect(provider.callTool(scope, "image_generate", validInput())).rejects.toThrow("Unknown generation tool")

    service.tools = [generationTool(), generationTool()]
    await expect(provider.listTools(scope)).rejects.toThrow("duplicated")
    expect(service.calls).toEqual([])
  })
})
