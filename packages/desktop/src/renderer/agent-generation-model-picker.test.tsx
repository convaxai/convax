import { describe, expect, mock, test } from "bun:test"
import { Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { GenerationToolSummary } from "../generation-contracts"
import { AgentGenerationModelPicker } from "./agent-generation-model-picker"

function tool(overrides: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return {
    acceptedInputs: [],
    description: "Generate media",
    id: "plugin.example:image.generate",
    kind: "model",
    modelName: "Image Model",
    output: "image",
    pluginId: "plugin.example",
    pluginName: "Example Plugin",
    title: "Image Model",
    toolId: "image.generate",
    ...overrides,
  }
}

describe("Agent generation model picker", () => {
  test("renders media tabs and only the active available-tool group", () => {
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="image"
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[tool(), tool({ id: "plugin.example:video.generate", output: "video", title: "Video Model" })]}
      />,
    )

    expect(markup).toContain("Agent models")
    expect(markup).toContain("w-[min(22rem,calc(100vw-1rem))]")
    expect(markup).toContain("height:448px")
    expect(markup).toContain("min-h-0 flex-1")
    expect(markup).toContain("Image")
    expect(markup).toContain("Video")
    expect(markup).toContain("Audio")
    expect(markup).toContain("LLM")
    expect(markup.indexOf(">LLM<")).toBeLessThan(markup.indexOf(">Image<"))
    expect(markup).toContain('aria-label="Model type"')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tabpanel"')
    expect(markup).toMatch(/aria-labelledby="[^"]+-agent-generation-model-tab-image"/)
    expect(markup).toMatch(/id="[^"]+-agent-generation-model-tab-image"[^>]*role="tab"[^>]*tabindex="0"/)
    expect(markup).toMatch(/id="[^"]+-agent-generation-model-tab-video"[^>]*role="tab"[^>]*tabindex="-1"/)
    expect(markup).not.toContain("Auto")
    expect(markup).toContain("Image Model")
    expect(markup).toContain("Generation services")
    expect(markup).toContain("Example Plugin")
    expect(markup).not.toContain("Video Model")
  })

  test("marks the exact host-stable selection and reports empty available categories", () => {
    const installed = tool()
    const selected = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="image"
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        selected={{ id: installed.id, output: "image" }}
        toolInput={{}}
        tools={[installed]}
      />,
    )
    expect(selected).toMatch(/aria-checked="true" aria-label="Image Model by Example Plugin"/)

    const empty = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="audio"
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[installed]}
      />,
    )
    expect(empty).toContain("No available audio generation service provides a model.")
    expect(empty).toContain("Open Services")
  })

  test("renders generation services at the first level and their models underneath", () => {
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="image"
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[
          tool({ modelName: "GPT Image 2", pluginId: "skylark", pluginName: "小云雀生成" }),
          tool({
            id: "skylark:nano",
            modelName: "Nano Banana Pro 1",
            pluginId: "skylark",
            pluginName: "小云雀生成",
          }),
          tool({ id: "dreamina:seedream", modelName: "Seedream 4", pluginId: "dreamina", pluginName: "即梦" }),
        ]}
      />,
    )

    expect(markup.match(/<details/g)).toHaveLength(2)
    expect(markup.match(/<summary/g)).toHaveLength(2)
    expect(markup.match(/role="radio"/g)).toHaveLength(3)
    expect(markup).toContain("小云雀生成")
    expect(markup).toContain("即梦")
    expect(markup).toContain("GPT Image 2")
    expect(markup).toContain("Nano Banana Pro 1")
    expect(markup).toContain('aria-label="Seedream 4 by 即梦"')
    expect(markup).not.toContain("Image Model</span>")
  })

  test("uses instance-scoped tab relationships when multiple pickers are mounted", () => {
    const picker = (key: string) => (
      <AgentGenerationModelPicker
        activeTab="image"
        key={key}
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[tool()]}
      />
    )
    const markup = renderToStaticMarkup(
      <Fragment>
        {picker("first")}
        {picker("second")}
      </Fragment>,
    )
    const imageIds = [...markup.matchAll(/id="([^"]+-agent-generation-model-(?:tab|panel)-image)"/g)].map(
      (match) => match[1],
    )

    expect(imageIds).toHaveLength(4)
    expect(new Set(imageIds).size).toBe(4)
    expect(markup.match(/role="dialog"[^>]*tabindex="-1"/g)).toHaveLength(2)
  })

  test("reuses the shared host-rendered form for the selected model description", () => {
    const installed = tool()
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="image"
        description={{
          fields: [
            {
              choices: [
                { label: "Natural", value: "natural" },
                { label: "Cinematic", value: "cinematic" },
              ],
              id: "style",
              kind: "select",
              label: "Style",
              required: true,
            },
          ],
          toolId: installed.id,
        }}
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        selected={{ id: installed.id, output: "image" }}
        toolInput={{ style: "cinematic" }}
        tools={[installed]}
      />,
    )

    expect(markup).toContain('data-tool-input-form="true"')
    expect(markup).toContain("Style")
    expect(markup).toContain("Cinematic")
  })

  test("does not create a second model-selection row while description metadata loads or is empty", () => {
    const installed = tool()
    const render = (description?: { fields: []; toolId: string }) =>
      renderToStaticMarkup(
        <AgentGenerationModelPicker
          activeTab="image"
          description={description}
          descriptionLoading={!description}
          loading={false}
          onClose={mock(() => undefined)}
          onLlmSelect={mock(() => undefined)}
          onOpenServices={mock(() => undefined)}
          onSelect={mock(() => undefined)}
          onTabChange={mock(() => undefined)}
          onToolInputChange={mock(() => undefined)}
          selected={{ id: installed.id, output: "image" }}
          toolInput={{}}
          tools={[installed]}
        />,
      )

    expect(render()).not.toContain("Loading model options")
    expect(render({ fields: [], toolId: installed.id })).not.toContain("no additional options")
  })

  test("renders connected OpenCode providers and selects a concrete LLM model", () => {
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="llm"
        llmCatalog={{
          providers: [
            {
              connected: true,
              defaultModelId: "main",
              models: [{ default: true, modelId: "main", modelName: "Pippit GLM Main" }],
              providerId: "plugin-xiaoyunque-generation-pippit-glm",
              providerName: "小云雀生成",
            },
            {
              connected: false,
              models: [{ default: false, modelId: "offline", modelName: "Offline model" }],
              providerId: "offline",
              providerName: "Offline provider",
            },
          ],
        }}
        llmSelected={{ modelId: "main", providerId: "plugin-xiaoyunque-generation-pippit-glm" }}
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[]}
      />,
    )

    expect(markup).toContain("Agent runtime")
    expect(markup).not.toContain("Auto")
    expect(markup.match(/<details/g)).toHaveLength(1)
    expect(markup).toContain("<summary")
    expect(markup).toContain("小云雀生成")
    expect(markup).toMatch(/aria-checked="true" aria-label="Pippit GLM Main by 小云雀生成"/)
    expect(markup).not.toContain("Offline model")
  })

  test("treats disconnected and model-less LLM providers as unavailable services", () => {
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeTab="llm"
        llmCatalog={{
          providers: [
            {
              connected: true,
              models: [],
              providerId: "empty",
              providerName: "Empty provider",
            },
            {
              connected: false,
              models: [{ default: true, modelId: "offline", modelName: "Offline model" }],
              providerId: "offline",
              providerName: "Offline provider",
            },
          ],
        }}
        loading={false}
        onClose={mock(() => undefined)}
        onLlmSelect={mock(() => undefined)}
        onOpenServices={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onTabChange={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[]}
      />,
    )

    expect(markup).toContain("No LLM service with an available model is connected.")
    expect(markup).toContain("Open Services")
    expect(markup).not.toContain("Auto")
    expect(markup).not.toContain("Empty provider")
    expect(markup).not.toContain("Offline model")
  })
})
