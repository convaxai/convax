import { describe, expect, test } from "bun:test"
import type { GenerationToolSummary } from "../generation-contracts"
import {
  AgentGenerationCatalogRequestTracker,
  agentGenerationToolsForOutput,
  createAgentPromptInstructions,
  findAgentGenerationTool,
  reconcileAgentGenerationToolSelection,
} from "./agent-generation-models"

function tool(overrides: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return {
    acceptedInputs: [],
    description: "Generate an image",
    id: "plugin.example:image.generate",
    output: "image",
    pluginId: "plugin.example",
    pluginName: "Example Plugin",
    title: "Example Image Model",
    toolId: "image.generate",
    ...overrides,
  }
}

describe("Agent generation models", () => {
  test("groups installed tools by media output without inventing text models", () => {
    const tools = [
      tool(),
      tool({ id: "plugin.example:video.generate", output: "video", title: "Example Video Model" }),
      tool({ id: "plugin.example:text.generate", output: "text", title: "Text Tool" }),
    ]

    expect(agentGenerationToolsForOutput(tools, "image").map((item) => item.title)).toEqual(["Example Image Model"])
    expect(agentGenerationToolsForOutput(tools, "video").map((item) => item.title)).toEqual(["Example Video Model"])
    expect(agentGenerationToolsForOutput(tools, "audio")).toEqual([])
  })

  test("keeps FFmpeg direct Plugin tools out of the generation-model preference menu", () => {
    const ffmpeg = tool({
      id: "ffmpeg-tools/run.video",
      output: "video",
      pluginId: "ffmpeg-tools",
      toolId: "run.video",
    })
    expect(agentGenerationToolsForOutput([ffmpeg], "video")).toEqual([])
    expect(findAgentGenerationTool({ id: ffmpeg.id, output: "video" }, [ffmpeg])).toBeUndefined()
  })

  test("fails a remembered choice closed when its installed id or output changes", () => {
    const selection = { id: "plugin.example:image.generate", output: "image" as const }
    expect(findAgentGenerationTool(selection, [tool()])?.title).toBe("Example Image Model")
    expect(reconcileAgentGenerationToolSelection(selection, [])).toBeUndefined()
    expect(reconcileAgentGenerationToolSelection(selection, [tool({ output: "video" })])).toBeUndefined()
    expect(reconcileAgentGenerationToolSelection(selection, [tool(), tool()])).toBeUndefined()
  })

  test("adds only a freshly validated stable tool id and output to Desktop Canvas instructions", () => {
    const installed = tool({
      pluginName: "Vendor name must not steer the prompt",
      title: "Untrusted display title",
    })
    const instructions = createAgentPromptInstructions({
      activeCanvas: { id: "canvas-main", name: "Main" },
      generationSelection: { id: installed.id, output: "image" },
      generationToolInput: { aspect_ratio: "16:9", steps: 20 },
      generationTools: [installed],
      resources: [],
    }).join("\n")

    expect(instructions).toContain("Convax generation preference (host-validated")
    expect(instructions).toContain(`Preferred installed tool ID: ${JSON.stringify(installed.id)}`)
    expect(instructions).toContain('Required output modality: "image"')
    expect(instructions).toContain('Host-validated model input: {"aspect_ratio":"16:9","steps":20}')
    expect(instructions).toContain("pass exactly this object as toolInput")
    expect(instructions).toContain("canvas_generate")
    expect(instructions).not.toContain(installed.pluginName)
    expect(instructions).not.toContain(installed.title)

    const stale = createAgentPromptInstructions({
      activeCanvas: { id: "canvas-main" },
      generationSelection: { id: installed.id, output: "image" },
      generationTools: [],
      resources: [],
    }).join("\n")
    expect(stale).not.toContain("generation preference")
  })

  test("instructs the Agent to omit toolInput when the selected tool has no configured fields", () => {
    const installed = tool()
    const instructions = createAgentPromptInstructions({
      activeCanvas: { id: "canvas-main" },
      generationSelection: { id: installed.id, output: "image" },
      generationToolInput: {},
      generationTools: [installed],
      resources: [],
    }).join("\n")

    expect(instructions).toContain("Omit toolInput")
  })

  test("does not turn a model choice into an instruction outside Canvas context", () => {
    const installed = tool()
    expect(
      createAgentPromptInstructions({
        generationSelection: { id: installed.id, output: "image" },
        generationTools: [installed],
        resources: [],
      }),
    ).toEqual([])
  })

  test("invalidates late catalog responses after Project or catalog changes", () => {
    const tracker = new AgentGenerationCatalogRequestTracker()
    const first = tracker.begin("project-a:catalog-1")
    expect(first()).toBeTrue()
    const second = tracker.begin("project-a:catalog-2")
    expect(first()).toBeFalse()
    expect(second()).toBeTrue()
    tracker.invalidate()
    expect(second()).toBeFalse()
  })
})
