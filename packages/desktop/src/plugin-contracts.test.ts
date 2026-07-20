import { describe, expect, test } from "bun:test"

import { type WebPluginGenerationContribution, parseWebPluginManifest } from "./plugin-contracts"

function staticManifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["canvas.node.read"],
    contributes: {
      canvas: {
        renderer: {
          create: true,
          extensions: [".PROMPT"],
          mimeTypes: ["Application/X-Convax-Prompt"],
        },
      },
    },
    description: "A generation surface",
    entry: "web/index.html",
    id: "generation-tools",
    name: "Generation Tools",
    schema: "convax.plugin/1",
    version: "1.0.0",
    ...overrides,
  }
}

function generationContribution(): WebPluginGenerationContribution {
  return {
    tools: [
      {
        acceptedInputs: ["text", "reference_image", "first_frame", "last_frame"],
        description: "Generate an image from a prompt and optional visual references",
        id: "image.generate",
        output: "image",
        title: "Generate image",
      },
      {
        acceptedInputs: ["reference_video", "audio", "text"],
        description: "Generate a video with optional reference video and audio",
        id: "video.generate",
        output: "video",
        title: "Generate video",
      },
    ],
  }
}

function executableManifest(overrides: Record<string, unknown> = {}) {
  const base = staticManifest()
  return {
    ...base,
    contributes: {
      ...base.contributes,
      generation: generationContribution(),
    },
    runtime: {
      args: ["serve", "--transport=stdio", "--endpoint=https://example.invalid/mcp"],
      command: "convax-generation-mcp",
      type: "mcp-stdio",
    },
    schema: "convax.plugin/2",
    ...overrides,
  }
}

describe("versioned Plugin manifest generation declarations", () => {
  test("keeps convax.plugin/1 static-only", () => {
    const parsed = parseWebPluginManifest(staticManifest())
    expect(parsed.schema).toBe("convax.plugin/1")
    expect(parsed.entry).toBe("web/index.html")
    expect(parsed.contributes).toEqual({
      canvas: {
        renderer: {
          create: true,
          extensions: [".prompt"],
          mimeTypes: ["application/x-convax-prompt"],
        },
      },
    })
    expect(parsed.runtime).toBeUndefined()
    expect(() =>
      parseWebPluginManifest(staticManifest({ runtime: { command: "generation-mcp", type: "mcp-stdio" } })),
    ).toThrow("unsupported field")
    expect(() =>
      parseWebPluginManifest(
        staticManifest({
          contributes: {
            ...staticManifest().contributes,
            generation: generationContribution(),
          },
        }),
      ),
    ).toThrow("unsupported field")
  })

  test("parses a v2 external MCP runtime and preserves declared input order", () => {
    const parsed = parseWebPluginManifest(executableManifest())

    expect(parsed.schema).toBe("convax.plugin/2")
    expect(parsed.entry).toBe("web/index.html")
    expect(parsed.contributes.canvas!.renderer.extensions).toEqual([".prompt"])
    expect(parsed.runtime).toEqual({
      args: ["serve", "--transport=stdio", "--endpoint=https://example.invalid/mcp"],
      command: "convax-generation-mcp",
      type: "mcp-stdio",
    })
    expect(parsed.contributes.generation?.tools).toEqual(generationContribution().tools)
    expect(parsed.contributes.generation?.tools[1]?.acceptedInputs).toEqual(["reference_video", "audio", "text"])
  })

  test("allows prompt-only tools with no optional Canvas reference roles", () => {
    const manifest = executableManifest()
    const parsed = parseWebPluginManifest({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        generation: {
          tools: [{ ...generationContribution().tools[0], acceptedInputs: [] }],
        },
      },
    })

    expect(parsed.contributes.generation?.tools[0]?.acceptedInputs).toEqual([])
  })

  test("allows a headless v2 Tool Plugin without a fake HTML or Canvas contribution", () => {
    const manifest = executableManifest()
    const parsed = parseWebPluginManifest({
      ...manifest,
      contributes: { generation: generationContribution() },
      entry: undefined,
    })

    expect(parsed.entry).toBeUndefined()
    expect(parsed.contributes.canvas).toBeUndefined()
    expect(parsed.contributes.generation?.tools).toHaveLength(2)
  })

  test("requires v2 runtime and generation contributions as one declaration", () => {
    expect(() => parseWebPluginManifest(staticManifest({ schema: "convax.plugin/2" }))).toThrow(
      "must declare an executable contribution or request generation.execute",
    )
    expect(() =>
      parseWebPluginManifest(
        staticManifest({
          runtime: { command: "generation-mcp", type: "mcp-stdio" },
          schema: "convax.plugin/2",
        }),
      ),
    ).toThrow("runtime and executable contribution must appear together")
    expect(() => {
      const base = staticManifest()
      return parseWebPluginManifest({
        ...base,
        contributes: { ...base.contributes, generation: generationContribution() },
        schema: "convax.plugin/2",
      })
    }).toThrow("runtime and executable contribution must appear together")
  })

  test("allows a static v2 caller but keeps generation.execute out of v1", () => {
    const caller = parseWebPluginManifest(
      staticManifest({ capabilities: ["canvas.node.read", "generation.execute"], schema: "convax.plugin/2" }),
    )
    expect(caller.schema).toBe("convax.plugin/2")
    expect(caller.capabilities).toContain("generation.execute")
    expect(caller.runtime).toBeUndefined()
    expect(caller.contributes.generation).toBeUndefined()

    expect(() => parseWebPluginManifest(staticManifest({ capabilities: ["generation.execute"] }))).toThrow(
      "only to convax.plugin/2",
    )
    expect(() =>
      parseWebPluginManifest(staticManifest({ capabilities: ["canvas.node.read"], schema: "convax.plugin/2" })),
    ).toThrow("must declare an executable contribution or request generation.execute")
    expect(() => {
      const manifest = staticManifest({ capabilities: ["generation.execute"], schema: "convax.plugin/2" })
      return parseWebPluginManifest({ ...manifest, contributes: {}, entry: undefined })
    }).toThrow("requires a sandboxed Canvas surface")
  })

  test("rejects provider fields and unknown runtime, generation, or tool fields", () => {
    expect(() => parseWebPluginManifest({ ...executableManifest(), provider: "example" })).toThrow("unsupported field")
    expect(() =>
      parseWebPluginManifest({
        ...executableManifest(),
        runtime: { command: "generation-mcp", cwd: ".", type: "mcp-stdio" },
      }),
    ).toThrow("unsupported field")
    expect(() => {
      const manifest = executableManifest()
      return parseWebPluginManifest({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          generation: { ...generationContribution(), provider: "example" },
        },
      })
    }).toThrow("unsupported field")
    expect(() => {
      const manifest = executableManifest()
      const generation = generationContribution()
      return parseWebPluginManifest({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          generation: {
            tools: [{ ...generation.tools[0], model: "example/image" }],
          },
        },
      })
    }).toThrow("unsupported field")
  })

  test("requires a bounded portable bare executable and bounded portable args", () => {
    for (const command of [
      "./generation-mcp",
      "bin/generation-mcp",
      "/usr/bin/generation-mcp",
      "C:\\bin\\mcp.exe",
      "CON",
    ]) {
      expect(() =>
        parseWebPluginManifest({
          ...executableManifest(),
          runtime: { command, type: "mcp-stdio" },
        }),
      ).toThrow()
    }
    for (const argument of [
      "../config.json",
      "/etc/config.json",
      "C:\\config.json",
      "--config=../config.json",
      "--config=/etc/config.json",
      "--config=C:/config.json",
      "console.log('downloaded code')",
      "echo payload | sh",
      "$(run-payload)",
    ]) {
      expect(() =>
        parseWebPluginManifest({
          ...executableManifest(),
          runtime: { args: [argument], command: "generation-mcp", type: "mcp-stdio" },
        }),
      ).toThrow("static CLI token")
    }
    expect(() =>
      parseWebPluginManifest({
        ...executableManifest(),
        runtime: {
          args: Array.from({ length: 65 }, (_, index) => `--arg=${index}`),
          command: "generation-mcp",
          type: "mcp-stdio",
        },
      }),
    ).toThrow("at most 64")
  })

  test("rejects ambiguous or unbounded generation tool declarations", () => {
    const first = generationContribution().tools[0]
    const withTools = (tools: unknown[]) => {
      const manifest = executableManifest()
      return {
        ...manifest,
        contributes: { ...manifest.contributes, generation: { tools } },
      }
    }

    expect(() => parseWebPluginManifest(withTools([]))).toThrow("non-empty")
    expect(() => parseWebPluginManifest(withTools([{ ...first, output: "binary" }]))).toThrow("output")
    expect(() => parseWebPluginManifest(withTools([{ ...first, acceptedInputs: ["text", "text"] }]))).toThrow(
      "duplicate role",
    )
    expect(() => parseWebPluginManifest(withTools([{ ...first, acceptedInputs: ["mask"] }]))).toThrow("unsupported")
    expect(() => parseWebPluginManifest(withTools([first, { ...first }]))).toThrow("duplicate ids")
    expect(() => parseWebPluginManifest(withTools(Array.from({ length: 65 }, () => first)))).toThrow("at most 64")
  })
})
