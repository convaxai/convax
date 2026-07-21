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
  test("renders media tabs and only the active installed-tool group", () => {
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeOutput="image"
        loading={false}
        onClose={mock(() => undefined)}
        onOutputChange={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[tool(), tool({ id: "plugin.example:video.generate", output: "video", title: "Video Model" })]}
      />,
    )

    expect(markup).toContain("Models")
    expect(markup).toContain("Image")
    expect(markup).toContain("Video")
    expect(markup).toContain("Audio")
    expect(markup).toContain('aria-label="Generation media type"')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tabpanel"')
    expect(markup).toMatch(/aria-labelledby="[^"]+-agent-generation-model-tab-image"/)
    expect(markup).toMatch(/id="[^"]+-agent-generation-model-tab-image"[^>]*role="tab"[^>]*tabindex="0"/)
    expect(markup).toMatch(/id="[^"]+-agent-generation-model-tab-video"[^>]*role="tab"[^>]*tabindex="-1"/)
    expect(markup).toContain("Auto")
    expect(markup).toContain("Image Model")
    expect(markup).toContain("Generation services")
    expect(markup).toContain("Example Plugin")
    expect(markup).not.toContain("Video Model")
  })

  test("marks the exact host-stable selection and reports empty installed categories", () => {
    const installed = tool()
    const selected = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeOutput="image"
        loading={false}
        onClose={mock(() => undefined)}
        onOutputChange={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        selected={{ id: installed.id, output: "image" }}
        toolInput={{}}
        tools={[installed]}
      />,
    )
    expect(selected).toMatch(/aria-checked="true" aria-label="Image Model by Example Plugin"/)

    const empty = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeOutput="audio"
        loading={false}
        onClose={mock(() => undefined)}
        onOutputChange={mock(() => undefined)}
        onSelect={mock(() => undefined)}
        onToolInputChange={mock(() => undefined)}
        toolInput={{}}
        tools={[installed]}
      />,
    )
    expect(empty).toContain("No installed audio generation services.")
  })

  test("renders services as the first level and their supported models as the second level", () => {
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeOutput="image"
        loading={false}
        onClose={mock(() => undefined)}
        onOutputChange={mock(() => undefined)}
        onSelect={mock(() => undefined)}
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
    expect(markup).toContain("小云雀生成")
    expect(markup).toContain("即梦")
    expect(markup).toContain("GPT Image 2")
    expect(markup).toContain("Nano Banana Pro 1")
    expect(markup).not.toContain("Image Model</span>")
  })

  test("uses instance-scoped tab relationships when multiple pickers are mounted", () => {
    const picker = (key: string) => (
      <AgentGenerationModelPicker
        activeOutput="image"
        key={key}
        loading={false}
        onClose={mock(() => undefined)}
        onOutputChange={mock(() => undefined)}
        onSelect={mock(() => undefined)}
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
    expect(markup.match(/role="dialog" tabindex="-1"/g)).toHaveLength(2)
  })

  test("reuses the shared host-rendered form for the selected model description", () => {
    const installed = tool()
    const markup = renderToStaticMarkup(
      <AgentGenerationModelPicker
        activeOutput="image"
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
        onOutputChange={mock(() => undefined)}
        onSelect={mock(() => undefined)}
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
})
