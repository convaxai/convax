import { describe, expect, test } from "bun:test"

import { hasWebPluginCanvasSurface, parseWebPluginManifest, webPluginManifestSchemaV8 } from "./plugin-contracts"

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: [],
    contributes: {
      canvas: { renderer: { create: true } },
    },
    description: "Desktop adapter fixture",
    entry: "web/index.html",
    hostApi: { major: 3, optional: [], required: ["host.context.get"] },
    id: "desktop-adapter",
    name: "Desktop Adapter",
    schema: "convax.plugin/8",
    version: "1.0.0",
    ...overrides,
  }
}

describe("Desktop Plugin contract adapter", () => {
  test("delegates the complete runtime manifest parse to @convax/plugin-sdk", () => {
    const parsed = parseWebPluginManifest(
      manifest({
        hostApi: {
          major: 3,
          optional: ["future.timeline.inspect"],
          required: ["host.context.get"],
        },
      }),
    )

    expect(parsed.schema).toBe(webPluginManifestSchemaV8)
    expect(parsed.hostApi.optional).toEqual(["future.timeline.inspect"])
    expect(Object.isFrozen(parsed)).toBeTrue()
    expect(hasWebPluginCanvasSurface(parsed)).toBeTrue()
  })

  test("does not retain a v1-v7 runtime parser", () => {
    for (let version = 1; version <= 7; version += 1) {
      expect(() => parseWebPluginManifest({ ...manifest(), schema: `convax.plugin/${version}` })).toThrow(
        "must use convax.plugin/8",
      )
    }
  })

  test("does not add Desktop-specific portable syntax or cross-field acceptance", () => {
    expect(() => parseWebPluginManifest({ ...manifest(), desktopTrusted: true })).toThrow(
      "unsupported field: desktopTrusted",
    )
    expect(() =>
      parseWebPluginManifest({
        ...manifest(),
        hostApi: { major: 3, optional: [], required: [] },
      }),
    ).toThrow("must require host.context.get")
  })

  test("reuses the SDK-owned immediate image contribution without a Desktop parser", () => {
    const parsed = parseWebPluginManifest({
      capabilities: [],
      contributes: {
        canvas: {
          selectionActions: [
            {
              description: {
                default: "Create an adjacent transparent image",
                "zh-CN": "在旁边创建透明图片",
              },
              editor: "immediate",
              id: "remove-background",
              presentation: "cutout-scan",
              steps: [{ tool: "image.background-remove" }],
              target: "image",
              title: { default: "Remove background", "zh-CN": "抠图" },
            },
          ],
        },
        generation: {
          models: [],
          tools: [
            {
              acceptedInputs: ["reference_image"],
              description: "Remove an image background",
              id: "image.background-remove",
              output: "image",
              title: "Remove background",
            },
          ],
        },
      },
      description: "Generic immediate image operation",
      hostApi: { major: 3, optional: [], required: [] },
      id: "image-operation-fixture",
      name: "Image Operation Fixture",
      runtime: { command: "image-operation-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/8",
      version: "1.0.0",
    })

    expect(parsed.contributes.canvas?.selectionActions?.[0]).toMatchObject({
      editor: "immediate",
      presentation: "cutout-scan",
      title: { default: "Remove background", "zh-CN": "抠图" },
    })
  })
})
