import { describe, expect, test } from "bun:test"

import {
  parsePortablePluginAgentContribution,
  parsePortablePluginGenerationContribution,
  validatePortableToolReferences,
} from "./generation"
import { parsePortablePluginCanvasContribution } from "./canvas"

describe("portable generation and Agent contributions", () => {
  test("parses tools and validates Agent references against operations", () => {
    const generation = parsePortablePluginGenerationContribution({
      models: [],
      tools: [
        {
          acceptedInputs: ["reference_video"],
          delivery: "return",
          description: "Inspect",
          id: "video.inspect",
          output: "text",
          title: "Inspect",
        },
      ],
    })
    const agent = parsePortablePluginAgentContribution({
      tools: [{ id: "inspect_video", tool: "video.inspect" }],
    })
    expect(() => validatePortableToolReferences({ agent, generation })).not.toThrow()
  })

  test("rejects unknown fields, duplicate roles, and dangling Agent tools", () => {
    expect(() =>
      parsePortablePluginGenerationContribution({
        models: [],
        tools: [
          {
            acceptedInputs: ["text", "text"],
            description: "Duplicate role",
            id: "text.inspect",
            output: "text",
            title: "Inspect",
          },
        ],
      }),
    ).toThrow("unsupported or duplicate role")
    const agent = parsePortablePluginAgentContribution({
      tools: [{ id: "missing_tool", tool: "missing.tool" }],
    })
    expect(() => validatePortableToolReferences({ agent })).toThrow("unknown generation tool")
  })

  test("binds an immediate image action to one non-model image operation", () => {
    const selectionActions = parsePortablePluginCanvasContribution({
      selectionActions: [
        {
          description: { default: "Create an adjacent transparent image" },
          editor: "immediate",
          id: "remove-background",
          presentation: "cutout-scan",
          steps: [{ tool: "image.background-remove" }],
          target: "image",
          title: { default: "Remove background" },
        },
      ],
    }).selectionActions
    const generation = (overrides: Record<string, unknown> = {}) =>
      parsePortablePluginGenerationContribution({
        models: [],
        tools: [
          {
            acceptedInputs: ["reference_image"],
            description: "Remove an image background",
            id: "image.background-remove",
            output: "image",
            title: "Remove background",
            ...overrides,
          },
        ],
      })

    expect(() => validatePortableToolReferences({ generation: generation(), selectionActions })).not.toThrow()
    expect(() =>
      validatePortableToolReferences({
        generation: generation({ output: "video" }),
        selectionActions,
      }),
    ).toThrow("one immediate image operation")
    expect(() =>
      validatePortableToolReferences({
        generation: generation({ acceptedInputs: ["reference_video"] }),
        selectionActions,
      }),
    ).toThrow("must accept reference_image")
    expect(() =>
      validatePortableToolReferences({
        generation: parsePortablePluginGenerationContribution({
          models: [{ name: "Background removal", tool: "image.background-remove" }],
          tools: generation().tools,
        }),
        selectionActions,
      }),
    ).toThrow("operation, not a generation model")
  })
})
