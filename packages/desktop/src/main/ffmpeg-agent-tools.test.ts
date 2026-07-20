import { describe, expect, test } from "bun:test"
import type { GenerationCanvasRequest, GenerationCanvasResult, GenerationToolSummary } from "../generation-contracts"
import { GenerationToolReportedError } from "./generation-canvas-service"
import { createFfmpegAgentToolProvider } from "./ffmpeg-agent-tools"
import type { GenerationCanvasAgentPort } from "./generation-agent-tools"

const scope = { directory: "/project", scopeId: "project-one" }

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error("Expected an Error rejection", { cause: error })
  }
  throw new Error("Expected operation to reject")
}

function ffmpegTool(toolId: "run.audio" | "run.image" | "run.video"): GenerationToolSummary {
  const outputByToolId = {
    "run.audio": "audio",
    "run.image": "image",
    "run.video": "video",
  } as const
  const output = outputByToolId[toolId]
  return {
    acceptedInputs: ["reference_image", "reference_video", "audio"],
    description: `Run FFmpeg for ${output}`,
    id: `ffmpeg-tools/${toolId}`,
    output,
    pluginId: "ffmpeg-tools",
    pluginName: "FFmpeg Tools",
    title: `FFmpeg ${output}`,
    toolId,
  }
}

class FakeFfmpegService implements GenerationCanvasAgentPort {
  calls: Array<{
    actor: { id: string; kind: "agent" }
    request: GenerationCanvasRequest
    signal?: AbortSignal
  }> = []
  tools: readonly GenerationToolSummary[] = [ffmpegTool("run.image"), ffmpegTool("run.video"), ffmpegTool("run.audio")]

  async listTools() {
    return this.tools
  }

  async generate(
    request: GenerationCanvasRequest,
    actor: { id: string; kind: "agent" },
    signal?: AbortSignal,
  ): Promise<GenerationCanvasResult> {
    this.calls.push({ actor, request, signal })
    return {
      createdNodeIds: ["ffmpeg-result"],
      revision: request.expectedRevision + 1,
      toolId: request.toolId ?? "",
      warnings: [],
    }
  }
}

function provider(service: FakeFfmpegService, scopeId = "project-one") {
  return createFfmpegAgentToolProvider(service, {
    async resolveActiveCanvas() {
      return { canvasId: "canvas-main", revision: 9, scopeId }
    },
  })
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    arguments: ["-ss", "3", "-i", "{{input:0}}", "-t", "2", "{{output}}"],
    outputName: "trimmed.mp4",
    references: [{ nodeId: "video-one", role: "reference_video" }],
    ...overrides,
  }
}

describe("direct FFmpeg Agent tools", () => {
  test("advertises one direct Agent tool per installed FFmpeg output without generation bookkeeping fields", async () => {
    const service = new FakeFfmpegService()
    const tools = await provider(service).listTools(scope)
    expect(tools.map((tool) => tool.name)).toEqual(["ffmpeg_run_image", "ffmpeg_run_video", "ffmpeg_run_audio"])
    const schema = tools[1]?.inputSchema
    if (!schema || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
      throw new Error("Expected the FFmpeg video tool to expose object properties")
    }
    expect(Object.keys(schema.properties).sort()).toEqual(["anchor", "arguments", "outputName", "references"])
    expect(schema.required).toEqual(["arguments", "outputName", "references"])
    expect(schema.properties).toMatchObject({
      arguments: { items: { maxLength: 1_024 }, maxItems: 256 },
      outputName: { maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
      references: { maxItems: 16 },
    })
    expect(tools[1]?.description).toContain("FFmpeg Tools Plugin directly")
    expect(tools[1]?.description).toContain("host derives the active Canvas and revision")

    service.tools = [ffmpegTool("run.audio")]
    expect((await provider(service).listTools(scope)).map((tool) => tool.name)).toEqual(["ffmpeg_run_audio"])
  })

  test("derives scope, Canvas revision, and operation id while forwarding only tokenized Plugin input", async () => {
    const service = new FakeFfmpegService()
    const cancellation = new AbortController()
    const result = await provider(service).callTool(
      scope,
      "ffmpeg_run_video",
      validInput({ anchor: { x: 640, y: 200 } }),
      { signal: cancellation.signal },
    )

    expect(result).toEqual({
      changed: true,
      createdNodeIds: ["ffmpeg-result"],
      revision: 10,
      toolId: "ffmpeg-tools/run.video",
      warnings: [],
    })
    expect(service.calls).toHaveLength(1)
    expect(service.calls[0]).toMatchObject({
      actor: { id: "opencode:project-one", kind: "agent" },
      request: {
        anchor: { x: 640, y: 200 },
        expectedRevision: 9,
        output: "video",
        ref: { canvasId: "canvas-main", scopeId: "project-one" },
        references: [{ nodeId: "video-one", role: "reference_video" }],
        toolId: "ffmpeg-tools/run.video",
        toolInput: {
          arguments_json: JSON.stringify(validInput().arguments),
          output_name: "trimmed.mp4",
        },
      },
      signal: cancellation.signal,
    })
    expect(service.calls[0]?.request.operationId).toMatch(/^ffmpeg-[0-9a-f-]{36}$/u)
  })

  test("fails closed for stale scope, missing declarations, paths, malformed placeholders, and unused references", async () => {
    const service = new FakeFfmpegService()
    expect(
      (await rejection(provider(service, "other-project").callTool(scope, "ffmpeg_run_video", validInput()))).message,
    ).toContain("active Agent Project")
    expect(service.calls).toEqual([])

    service.tools = []
    expect((await rejection(provider(service).callTool(scope, "ffmpeg_run_video", validInput()))).message).toContain(
      "not installed",
    )

    const prototypeReference = {}
    Object.defineProperty(prototypeReference, "__proto__", {
      enumerable: true,
      value: { nodeId: "video-one", role: "reference_video" },
    })
    for (const input of [
      validInput({ outputName: "../trimmed.mp4" }),
      validInput({ outputName: "裁剪.mp4" }),
      validInput({ outputName: "trimmed.avi" }),
      validInput({ outputName: `${"a".repeat(125)}.mp4` }),
      validInput({ arguments: ["-i", "{{input:0}}", "out.mp4"] }),
      validInput({ arguments: ["-i", "{{input:0}}", "{{output}}", "{{output}}"] }),
      validInput({ arguments: ["-i", "{{input:0}}", "x".repeat(1_025), "{{output}}"] }),
      validInput({
        arguments: ["-i", "{{input:0}}", ...Array.from({ length: 5 }, () => "x".repeat(900)), "{{output}}"],
      }),
      validInput({
        arguments: [...Array.from({ length: 256 }, () => "-v"), "{{output}}"],
      }),
      validInput({
        references: [
          { nodeId: "video-one", role: "reference_video" },
          { nodeId: "audio-one", role: "audio" },
        ],
      }),
      validInput({
        arguments: [...Array.from({ length: 17 }, (_, index) => ["-i", `{{input:${index}}}`]).flat(), "{{output}}"],
        references: Array.from({ length: 17 }, (_, index) => ({
          nodeId: `video-${index}`,
          role: "reference_video",
        })),
      }),
      validInput({ references: [prototypeReference] }),
      validInput({ expectedRevision: 9 }),
    ]) {
      const isolated = new FakeFfmpegService()
      await rejection(provider(isolated).callTool(scope, "ffmpeg_run_video", input))
      expect(isolated.calls).toEqual([])
    }
  })

  test("keeps normalized Plugin failures useful while hiding arbitrary native diagnostics", async () => {
    const reported = new FakeFfmpegService()
    reported.generate = async () => {
      throw new GenerationToolReportedError([{ text: "Input video has no audio stream", type: "text" }])
    }
    expect(
      (await rejection(provider(reported).callTool(scope, "ffmpeg_run_audio", validInput({ outputName: "audio.m4a" }))))
        .message,
    ).toContain("FFmpeg Plugin failed: Input video has no audio stream")

    const unsafe = new FakeFfmpegService()
    unsafe.generate = async () => {
      throw new Error("/private/tmp/input.mp4 token=secret")
    }
    const error = await provider(unsafe)
      .callTool(scope, "ffmpeg_run_video", validInput())
      .catch((failure) => failure)
    expect(error).toMatchObject({
      message: "FFmpeg Plugin operation could not be completed because the Canvas or input state changed",
    })
    expect(String(error)).not.toContain("/private/tmp")
    expect(String(error)).not.toContain("secret")
  })
})
