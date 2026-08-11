import { describe, expect, test } from "bun:test"

import { comparePortablePluginVersions, parsePortablePluginManifestV8, type PortablePluginManifestV8 } from "./manifest"

function webManifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["canvas.connectedInputs.read"],
    contributes: {
      canvas: {
        renderer: { create: true, extensions: [".TIMELINE"], width: 960 },
      },
    },
    description: "A sandboxed timeline surface",
    entry: "web/index.html",
    hostApi: { major: 3, optional: [], required: ["host.context.get"] },
    id: "timeline-tools",
    name: "Timeline Tools",
    schema: "convax.plugin/8",
    version: "1.0.0",
    ...overrides,
  }
}

function toolManifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: [],
    contributes: {
      agent: {
        mcp: { oauth: "auto", type: "remote", url: "https://tools.example.com/mcp" },
        tools: [{ id: "caption_video", tool: "video.caption" }],
      },
      capabilities: {
        exports: [
          {
            docs: {
              request: "One bounded timeline request.",
              response: "One bounded timeline result.",
              summary: "Inspect timeline",
            },
            id: "media.timeline.inspect",
            inputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" },
            operation: "timeline.inspect",
            outputSchema: {
              additionalProperties: false,
              properties: { duration: { maximum: 86_400, minimum: 0, type: "number" } },
              required: ["duration"],
              type: "object",
            },
            sideEffect: "read",
            version: "1.0.0",
          },
        ],
        imports: {
          optional: [
            {
              id: "media.thumbnail.create",
              inputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" },
              outputSchema: {
                additionalProperties: false,
                properties: { duration: { maximum: 86_400, minimum: 0, type: "number" } },
                required: ["duration"],
                type: "object",
              },
              version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
            },
          ],
          required: [],
        },
      },
      canvas: {
        commands: [
          {
            icon: "play",
            id: "preview.play",
            target: { message: "preview.play", type: "renderer-message" },
            title: { default: "Play preview", "zh-CN": "播放预览" },
          },
        ],
        renderer: { create: true, mimeTypes: ["Application/X-Timeline"] },
        selectionActions: [
          {
            description: { default: "Caption selected video" },
            editor: "confirmation",
            id: "caption",
            steps: [{ tool: "video.caption" }],
            target: "video",
            title: { default: "Caption" },
          },
        ],
        toolbar: [{ command: "preview.play", id: "preview-toolbar" }],
      },
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: ["reference_video"],
            delivery: "return",
            description: "Caption one selected video",
            id: "video.caption",
            output: "text",
            recovery: { mode: "long-running-operation", schema: "convax.generation-lro/1" },
            title: "Caption video",
          },
        ],
      },
      llm: {
        models: [{ id: "fallback-model", name: "Fallback Model" }],
        provider: { id: "example-provider", name: "Example Provider", protocol: "openai" },
      },
      service: { actions: ["authorize", "checkout", "sign_out"] },
      skills: [
        {
          name: "timeline-director",
          path: "skills/timeline-director",
          uses: { pluginTools: ["caption_video"] },
        },
      ],
    },
    description: "A complete portable Plugin",
    entry: "web/index.html",
    hooks: "agent/hooks.mjs",
    hostApi: {
      major: 3,
      optional: [],
      required: ["agent.prompt", "host.context.get"],
    },
    id: "complete-plugin",
    name: "Complete Plugin",
    runtime: {
      args: ["serve", "--transport=stdio", "--endpoint=https://example.invalid/mcp"],
      command: "complete-plugin-mcp",
      type: "mcp-stdio",
    },
    schema: "convax.plugin/8",
    version: "1.2.3-beta.1+build.7",
    ...overrides,
  }
}

describe("complete convax.plugin/8 portable ABI", () => {
  test("normalizes every contribution family through one deeply frozen parser", () => {
    const manifest = parsePortablePluginManifestV8(toolManifest())

    expect(manifest.schema).toBe("convax.plugin/8")
    expect(manifest.runtime).toEqual({
      args: ["serve", "--transport=stdio", "--endpoint=https://example.invalid/mcp"],
      command: "complete-plugin-mcp",
      type: "mcp-stdio",
    })
    expect(manifest.contributes.agent?.mcp?.oauth).toBe("auto")
    expect(manifest.contributes.canvas?.commands?.[0]?.target).toEqual({
      message: "preview.play",
      type: "renderer-message",
    })
    expect(manifest.contributes.capabilities?.exports[0]?.id).toBe("media.timeline.inspect")
    expect(manifest.contributes.generation?.tools[0]?.recovery?.schema).toBe("convax.generation-lro/1")
    expect(manifest.contributes.skills?.[0]?.uses?.pluginTools).toEqual(["caption_video"])
    expect(manifest.contributes.llm?.provider.id).toBe("example-provider")
    expect(manifest.contributes.service?.actions).toEqual(["authorize", "checkout", "sign_out"])
    expect(Object.isFrozen(manifest)).toBeTrue()
    expect(Object.isFrozen(manifest.contributes.canvas?.commands?.[0]?.target)).toBeTrue()
  })

  test("keeps Host API authoring and runtime negotiation modes distinct", () => {
    const candidate = webManifest({
      hostApi: {
        major: 3,
        optional: ["future.timeline.inspect"],
        required: ["host.context.get"],
      },
    })
    expect(parsePortablePluginManifestV8(candidate).hostApi.optional).toEqual(["future.timeline.inspect"])
    expect(() => parsePortablePluginManifestV8(candidate, { hostApiMode: "authoring" })).toThrow("unknown Plugin API")
    expect(() =>
      parsePortablePluginManifestV8(
        webManifest({
          hostApi: { major: 3, optional: ["Future.timeline.inspect"], required: ["host.context.get"] },
        }),
      ),
    ).toThrow("invalid Plugin API id")
  })

  test("rejects LLM contributions without the current explicit provider protocol", () => {
    const current = toolManifest()
    const legacy = {
      ...current,
      contributes: {
        ...current.contributes,
        llm: {
          modelCatalog: "runtime",
          models: [{ id: "model-1", name: "Model 1" }],
          provider: { id: "example-provider", name: "Example Provider" },
        },
      },
    }

    expect(() => parsePortablePluginManifestV8(legacy)).toThrow("unsupported field: modelCatalog")
    expect(() => parsePortablePluginManifestV8(legacy, { hostApiMode: "authoring" })).toThrow(
      "unsupported field: modelCatalog",
    )

    const { modelCatalog: _retiredModelCatalog, ...missingProtocolLlm } = legacy.contributes.llm
    const missingProtocol = {
      ...legacy,
      contributes: { ...legacy.contributes, llm: missingProtocolLlm },
    }
    expect(() => parsePortablePluginManifestV8(missingProtocol)).toThrow(
      "LLM provider protocol must be openai or openrouter",
    )
    expect(() => parsePortablePluginManifestV8(missingProtocol, { hostApiMode: "authoring" })).toThrow(
      "LLM provider protocol must be openai or openrouter",
    )
  })

  test("rejects the retired Host API major in both authoring and runtime modes", () => {
    const legacy = webManifest({
      hostApi: { major: 1, optional: [], required: ["host.context.get"] },
    })

    expect(() => parsePortablePluginManifestV8(legacy)).toThrow("major must be 3")
    expect(() => parsePortablePluginManifestV8(legacy, { hostApiMode: "authoring" })).toThrow("major must be 3")
  })

  test("rejects every retired manifest schema and unknown portable fields", () => {
    for (let version = 1; version <= 7; version += 1) {
      expect(() => parsePortablePluginManifestV8({ ...webManifest(), schema: `convax.plugin/${version}` })).toThrow(
        "must use convax.plugin/8",
      )
    }
    expect(() => parsePortablePluginManifestV8({ ...webManifest(), hidden: true })).toThrow("unsupported field: hidden")
    expect(() =>
      parsePortablePluginManifestV8({
        ...webManifest(),
        contributes: { canvas: { renderer: { create: true }, secretBridge: true } },
      }),
    ).toThrow("unsupported field: secretBridge")
    expect(() =>
      parsePortablePluginManifestV8({
        ...toolManifest(),
        runtime: { command: "tool", environment: {}, type: "mcp-stdio" },
      }),
    ).toThrow("unsupported field: environment")
  })

  test("rejects duplicate identities and bounded-array overflow", () => {
    expect(() =>
      parsePortablePluginManifestV8({
        ...toolManifest(),
        contributes: {
          ...toolManifest().contributes,
          service: { actions: ["authorize", "authorize"] },
        },
      }),
    ).toThrow("unsupported or duplicate action")
    expect(() =>
      parsePortablePluginManifestV8({
        ...toolManifest(),
        contributes: {
          ...toolManifest().contributes,
          generation: {
            models: [],
            tools: Array.from({ length: 65 }, (_, index) => ({
              acceptedInputs: [],
              description: "tool",
              id: `tool-${index}`,
              output: "text",
              title: "Tool",
            })),
          },
        },
      }),
    ).toThrow("at most 64 items")
    expect(() =>
      parsePortablePluginManifestV8({
        ...webManifest(),
        capabilities: ["canvas.node.read", "canvas.node.read"],
      }),
    ).toThrow("unsupported or duplicate capability")
  })

  test("enforces Web entry, renderer, Host API, UI, and portable path invariants", () => {
    expect(() => parsePortablePluginManifestV8({ ...webManifest(), entry: undefined })).toThrow(
      "entry and Canvas renderer must appear together",
    )
    expect(() =>
      parsePortablePluginManifestV8({
        ...webManifest(),
        hostApi: { major: 3, optional: [], required: [] },
      }),
    ).toThrow("must require host.context.get")
    expect(() =>
      parsePortablePluginManifestV8({
        ...webManifest(),
        contributes: {
          canvas: {
            commands: [],
            menus: [{ command: "missing.command", id: "missing", placement: "overflow" }],
            renderer: { create: true },
          },
        },
      }),
    ).toThrow("unknown command")
    expect(() => parsePortablePluginManifestV8({ ...webManifest(), entry: "web/CON.html" })).toThrow(
      "invalid Windows filename",
    )
    expect(() => parsePortablePluginManifestV8({ ...webManifest(), hooks: "../hooks.mjs" })).toThrow(
      "portable relative path",
    )
  })

  test("enforces runtime, generation, Agent, Skill, and selection-action references", () => {
    expect(() => parsePortablePluginManifestV8({ ...toolManifest(), runtime: undefined })).toThrow(
      "capability exports require a verified mcp-stdio runtime",
    )
    const capabilityOnly = toolManifest({
      contributes: { capabilities: toolManifest().contributes.capabilities },
      entry: undefined,
      hooks: undefined,
      hostApi: { major: 3, optional: [], required: [] },
    })
    expect(parsePortablePluginManifestV8(capabilityOnly).contributes.capabilities?.exports[0]?.operation).toBe(
      "timeline.inspect",
    )
    expect(() => parsePortablePluginManifestV8({ ...capabilityOnly, runtime: undefined })).toThrow(
      "capability exports require a verified mcp-stdio runtime",
    )
    expect(() =>
      parsePortablePluginManifestV8({
        ...toolManifest(),
        contributes: {
          ...toolManifest().contributes,
          agent: { tools: [{ id: "missing_tool", tool: "missing.tool" }] },
        },
      }),
    ).toThrow("unknown generation tool")
    expect(() =>
      parsePortablePluginManifestV8({
        ...toolManifest(),
        contributes: {
          ...toolManifest().contributes,
          skills: [
            {
              name: "timeline-director",
              path: "skills/timeline-director",
              uses: { pluginTools: ["missing_tool"] },
            },
          ],
        },
      }),
    ).toThrow("unknown Agent tool")
    expect(() =>
      parsePortablePluginManifestV8({
        ...toolManifest(),
        contributes: {
          ...toolManifest().contributes,
          canvas: {
            renderer: { create: true },
            selectionActions: [
              {
                description: { default: "Bad reference" },
                editor: "confirmation",
                id: "bad-reference",
                steps: [{ tool: "missing.tool" }],
                target: "video",
                title: { default: "Bad" },
              },
            ],
          },
        },
      }),
    ).toThrow("unknown generation tool")
  })

  test("admits the exact Pet capability envelope and rejects mixed authority", () => {
    const pet = parsePortablePluginManifestV8({
      capabilities: ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
      contributes: {
        pet: {
          library: "pets/library.json",
          overlay: "pets/overlay.html",
          protocol: "convax.pet-host/1",
          settings: "pets/settings.html",
        },
      },
      description: "Pet provider",
      hostApi: { major: 3, optional: [], required: [] },
      id: "pet-provider",
      name: "Pet Provider",
      schema: "convax.plugin/8",
      version: "1.0.0",
    })
    expect(pet.contributes.pet?.protocol).toBe("convax.pet-host/1")
    expect(() =>
      parsePortablePluginManifestV8({
        ...pet,
        capabilities: [...pet.capabilities, "canvas.node.read"],
      }),
    ).toThrow("Pet capabilities must include")
  })

  test("rejects empty or Skill-only packages without an executable Plugin capability", () => {
    const empty = {
      capabilities: [],
      contributes: {},
      description: "Empty",
      hostApi: { major: 3, optional: [], required: [] },
      id: "empty-plugin",
      name: "Empty Plugin",
      schema: "convax.plugin/8",
      version: "1.0.0",
    }
    expect(() => parsePortablePluginManifestV8(empty)).toThrow("beyond owned Skills")
    expect(() =>
      parsePortablePluginManifestV8({
        ...empty,
        contributes: {
          skills: [{ name: "only-skill", path: "skills/only-skill" }],
        },
      }),
    ).toThrow("beyond owned Skills")
  })

  test("exports a complete typed manifest and SemVer comparator", () => {
    const manifest: PortablePluginManifestV8 = parsePortablePluginManifestV8(webManifest())
    expect(manifest.schema).toBe("convax.plugin/8")
    expect(comparePortablePluginVersions("1.0.0", "1.0.0-beta.2")).toBeGreaterThan(0)
    expect(comparePortablePluginVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBeLessThan(0)
  })
})
