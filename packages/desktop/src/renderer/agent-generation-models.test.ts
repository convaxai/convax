import { describe, expect, test } from "bun:test"
import type { GenerationToolSummary } from "../generation-contracts"
import {
  AgentGenerationCatalogRequestTracker,
  agentGenerationModelDisplayTitle,
  agentGenerationModelSelectionTitle,
  agentGenerationToolsForOutput,
  createAgentPromptInstructions,
  findAgentGenerationTool,
  groupAgentGenerationToolsByService,
  reconcileAgentGenerationToolPreference,
  reconcileAgentGenerationToolSelection,
} from "./agent-generation-models"

function tool(overrides: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return {
    acceptedInputs: [],
    description: "Generate an image",
    id: "plugin.example:image.generate",
    kind: "model",
    modelName: "Example Image Model",
    output: "image",
    pluginId: "plugin.example",
    pluginName: "Example Plugin",
    serviceId: "plugin-example",
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

  test("keeps operation plugins out of model preferences", () => {
    const operation = tool({
      id: "media-tools/transform.video",
      kind: "operation",
      modelName: undefined,
      output: "video",
      pluginId: "media-tools",
      pluginName: "Media Tools",
      serviceId: "media-tools",
      title: "Transform video",
      toolId: "transform.video",
    })
    expect(agentGenerationToolsForOutput([operation], "video")).toEqual([])
    expect(findAgentGenerationTool({ id: operation.id, output: "video" }, [operation])).toBeUndefined()
  })

  test("groups declaratively named models under their generation service", () => {
    const tools = [
      tool({ modelName: "GPT Image 2", pluginId: "skylark", pluginName: "小云雀生成", serviceId: "skylark" }),
      tool({
        id: "skylark:nano",
        modelName: "Nano Banana Pro 1",
        pluginId: "skylark",
        pluginName: "小云雀生成",
        serviceId: "skylark",
      }),
      tool({
        id: "dreamina:seedream",
        modelName: "Seedream 4",
        pluginId: "dreamina",
        pluginName: "即梦",
        serviceId: "dreamina",
      }),
    ]

    const services = groupAgentGenerationToolsByService(tools, "image")
    expect(services.map(({ id, models, name }) => ({ id, modelIds: models.map((model) => model.id), name }))).toEqual([
      {
        id: "skylark",
        modelIds: ["plugin.example:image.generate", "skylark:nano"],
        name: "小云雀生成",
      },
      { id: "dreamina", modelIds: ["dreamina:seedream"], name: "即梦" },
    ])
    expect(agentGenerationModelDisplayTitle(services[0].models[0])).toBe("GPT Image 2")
    expect(agentGenerationModelDisplayTitle(services[1].models[0])).toBe("Seedream 4")
    expect(agentGenerationModelSelectionTitle(services[0].models[0])).toBe("小云雀生成 · GPT Image 2")
    expect(
      agentGenerationModelSelectionTitle(
        tool({ modelName: undefined, pluginName: "小云雀生成", title: "小云雀生成 · Seedream 5" }),
      ),
    ).toBe("小云雀生成 · Seedream 5")
  })

  test("keeps sibling Services from one Plugin in independent model groups", () => {
    const services = groupAgentGenerationToolsByService(
      [
        tool({ pluginId: "shortdrama", pluginName: "小云雀", serviceId: "xiaoyunque" }),
        tool({ id: "shortdrama/libtv/image", pluginId: "shortdrama", pluginName: "LibTV", serviceId: "libtv" }),
      ],
      "image",
    )

    expect(services.map(({ models, name, target }) => ({ ids: models.map(({ id }) => id), name, target }))).toEqual([
      {
        ids: ["plugin.example:image.generate"],
        name: "小云雀",
        target: { pluginId: "shortdrama", serviceId: "xiaoyunque" },
      },
      {
        ids: ["shortdrama/libtv/image"],
        name: "LibTV",
        target: { pluginId: "shortdrama", serviceId: "libtv" },
      },
    ])
  })

  test("fails a remembered choice closed when its installed id or output changes", () => {
    const selection = { id: "plugin.example:image.generate", output: "image" as const }
    expect(findAgentGenerationTool(selection, [tool()])?.title).toBe("Example Image Model")
    expect(reconcileAgentGenerationToolSelection(selection, [])).toBeUndefined()
    expect(reconcileAgentGenerationToolSelection(selection, [tool({ output: "video" })])).toBeUndefined()
    expect(reconcileAgentGenerationToolSelection(selection, [tool(), tool()])).toBeUndefined()
  })

  test("replaces an unavailable saved preference with the first concrete model of the same output", () => {
    const first = tool({ id: "plugin.example:image.first" })
    const second = tool({ id: "plugin.example:image.second" })
    expect(
      reconcileAgentGenerationToolPreference({ id: "plugin.example:image.removed", output: "image" }, [
        first,
        second,
        tool({ id: "plugin.example:video.first", output: "video" }),
      ]),
    ).toEqual({ id: first.id, output: "image" })
    expect(reconcileAgentGenerationToolPreference(undefined, [first])).toBeUndefined()
    expect(
      reconcileAgentGenerationToolPreference({ id: "plugin.example:image.removed", output: "image" }, [
        tool({ output: "video" }),
      ]),
    ).toBeUndefined()
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
