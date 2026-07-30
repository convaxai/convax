import { describe, expect, test } from "bun:test"

import { generationModelIdRole, projectGenerationToolInputSchema } from "./generation-tool-input-schema"

function selector(overrides: Record<string, unknown> = {}) {
  return {
    "x-convax-role": generationModelIdRole,
    oneOf: [
      { const: "vendor/alpha:image", title: "Alpha Image" },
      { const: "vendor/beta:image", title: "Beta Image" },
    ],
    type: "string",
    ...overrides,
  }
}

describe("generation model input selector", () => {
  test("projects one explicitly marked required select outside renderer-owned fields", () => {
    expect(
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: {
          engine: selector(),
          quality: { enum: ["standard", "high"], title: "Quality", type: "string" },
        },
        required: ["engine"],
        type: "object",
      }),
    ).toEqual({
      description: {
        fields: [
          {
            choices: [
              { label: "standard", value: "standard" },
              { label: "high", value: "high" },
            ],
            id: "quality",
            kind: "select",
            label: "Quality",
            required: false,
          },
        ],
        toolId: "image-tools/generate.image",
      },
      modelSelector: {
        choices: [
          { label: "Alpha Image", value: "vendor/alpha:image" },
          { label: "Beta Image", value: "vendor/beta:image" },
        ],
        fieldId: "engine",
      },
    })
  })

  test("rejects optional, non-select, duplicate, and multiple selectors", () => {
    expect(() =>
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: { engine: selector() },
        type: "object",
      }),
    ).toThrow("must be required")

    expect(() =>
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: { engine: selector({ oneOf: undefined }) },
        required: ["engine"],
        type: "object",
      }),
    ).toThrow("bounded string select")

    expect(() =>
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: {
          engine: selector({
            oneOf: [{ const: "vendor/alpha:image" }, { const: "vendor/alpha:image" }],
          }),
        },
        required: ["engine"],
        type: "object",
      }),
    ).toThrow("duplicate choices")

    expect(() =>
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: { engine: selector(), renderer: selector() },
        required: ["engine", "renderer"],
        type: "object",
      }),
    ).toThrow("more than one")
  })

  test("rejects selector roles on host-reserved fields and unknown role values", () => {
    expect(() =>
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: { prompt: selector() },
        required: ["prompt"],
        type: "object",
      }),
    ).toThrow("cannot use host field")

    expect(() =>
      projectGenerationToolInputSchema("image-tools/generate.image", {
        properties: {
          engine: {
            "x-convax-role": "provider-specific-model",
            enum: ["alpha"],
            type: "string",
          },
        },
        required: ["engine"],
        type: "object",
      }),
    ).toThrow("unsupported Convax role")
  })
})
