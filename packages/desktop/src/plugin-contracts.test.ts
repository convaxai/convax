import { describe, expect, test } from "bun:test"

import {
  type WebPluginGenerationContribution,
  type WebPluginServiceContribution,
  parseWebPluginManifest,
} from "./plugin-contracts"

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

function serviceContribution(
  actions: WebPluginServiceContribution["actions"] = ["reauthorize", "sign_out"],
): WebPluginServiceContribution {
  return { actions }
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

function executableManifestV3(overrides: Record<string, unknown> = {}) {
  const generation = generationContribution()
  return {
    capabilities: [],
    contributes: {
      agent: { tools: [{ id: "transform_video", tool: "video.generate" }] },
      canvas: {
        selectionActions: [
          {
            description: { default: "Create a transformed video", "zh-CN": "创建处理后的视频" },
            editor: "time-range",
            id: "trim",
            steps: [{ tool: "video.generate" }],
            target: "video",
            title: { default: "Trim", "zh-CN": "截取" },
          },
        ],
      },
      generation: {
        models: [{ name: "Example Image 1", tool: "image.generate" }],
        tools: generation.tools,
      },
    },
    description: "Declarative models and media operations",
    id: "declarative-tools",
    name: "Declarative Tools",
    runtime: { command: "declarative-tools-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/3",
    version: "1.0.0",
    ...overrides,
  }
}

function ownedSkillsManifest(overrides: Record<string, unknown> = {}) {
  const base = staticManifest()
  return {
    ...base,
    contributes: {
      ...base.contributes,
      skills: [
        { name: "canvas-director", path: "skills/canvas-director" },
        { name: "asset-reviewer", path: "skills/asset-reviewer" },
      ],
    },
    schema: "convax.plugin/4",
    ...overrides,
  }
}

function petManifest(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
    contributes: {
      pet: {
        library: "pet-library.json",
        overlay: "pet/index.html",
        protocol: "convax.pet-host/1",
        settings: "settings/index.html",
      },
    },
    description: "A local desktop companion and pet library.",
    id: "convax-pet",
    name: "Convax Pet",
    schema: "convax.plugin/5",
    version: "0.2.0",
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
    expect(parsed.contributes.canvas!.renderer?.extensions).toEqual([".prompt"])
    expect(parsed.runtime).toEqual({
      args: ["serve", "--transport=stdio", "--endpoint=https://example.invalid/mcp"],
      command: "convax-generation-mcp",
      type: "mcp-stdio",
    })
    expect(parsed.contributes.generation?.tools).toEqual(generationContribution().tools)
    expect(parsed.contributes.generation?.tools[1]?.acceptedInputs).toEqual(["reference_video", "audio", "text"])
  })

  test("parses explicit v3 models, Agent operations, and host-rendered selection actions", () => {
    const parsed = parseWebPluginManifest(executableManifestV3())

    expect(parsed.schema).toBe("convax.plugin/3")
    expect(parsed.entry).toBeUndefined()
    expect(parsed.contributes.generation?.models).toEqual([{ name: "Example Image 1", tool: "image.generate" }])
    expect(parsed.contributes.agent).toEqual({ tools: [{ id: "transform_video", tool: "video.generate" }] })
    expect(parsed.contributes.canvas?.renderer).toBeUndefined()
    expect(parsed.contributes.canvas?.selectionActions).toEqual([
      {
        description: { default: "Create a transformed video", "zh-CN": "创建处理后的视频" },
        editor: "time-range",
        id: "trim",
        steps: [{ tool: "video.generate" }],
        target: "video",
        title: { default: "Trim", "zh-CN": "截取" },
      },
    ])
  })

  test("parses v4 Plugin-owned Skill directories without changing legacy companion semantics", () => {
    const parsed = parseWebPluginManifest(ownedSkillsManifest())

    expect(parsed.schema).toBe("convax.plugin/4")
    expect(parsed.contributes.skills).toEqual([
      { name: "canvas-director", path: "skills/canvas-director" },
      { name: "asset-reviewer", path: "skills/asset-reviewer" },
    ])
    expect(parsed.skill).toBeUndefined()

    expect(() => parseWebPluginManifest({ ...ownedSkillsManifest(), skill: "skills/legacy/SKILL.md" })).toThrow(
      "unsupported field",
    )
    expect(() => {
      const v3 = executableManifestV3()
      return parseWebPluginManifest({
        ...v3,
        contributes: { ...v3.contributes, skills: [{ name: "canvas-director", path: "skills/canvas-director" }] },
      })
    }).toThrow("unsupported field")
  })

  test("parses v5 transport-neutral Project and Canvas grants without requiring a Web surface", () => {
    const manifest = {
      capabilities: [
        "projects.read",
        "canvas.catalog.read",
        "canvas.document.read",
        "canvas.document.write",
        "canvas.events.subscribe",
      ],
      contributes: {},
      description: "Automates bound Project Canvases",
      id: "canvas-automation",
      name: "Canvas Automation",
      schema: "convax.plugin/5",
      version: "1.0.0",
    }

    expect(parseWebPluginManifest(manifest)).toMatchObject({
      capabilities: manifest.capabilities,
      contributes: {},
      schema: "convax.plugin/5",
    })
    expect(() => parseWebPluginManifest({ ...manifest, schema: "convax.plugin/4" })).toThrow(
      "available only to convax.plugin/5",
    )

    expect(() =>
      parseWebPluginManifest({
        ...manifest,
        runtime: { command: "canvas-automation-mcp", type: "mcp-stdio" },
      }),
    ).toThrow("runtime and executable contribution must appear together")

    expect(
      parseWebPluginManifest({
        ...manifest,
        contributes: { service: { actions: [] } },
        runtime: { command: "canvas-automation-mcp", type: "mcp-stdio" },
      }),
    ).toMatchObject({
      capabilities: manifest.capabilities,
      contributes: { service: { actions: [] } },
      runtime: { command: "canvas-automation-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/5",
    })
  })

  test("parses a v5 LLM contribution without accepting connection or credential fields", () => {
    const parsed = parseWebPluginManifest({
      capabilities: [],
      contributes: {
        llm: {
          models: [{ id: "pippit-glm-main", name: "Pippit GLM Main" }],
          provider: { id: "pippit-glm", name: "Pippit GLM" },
        },
      },
      description: "External LLM provider",
      id: "xiaoyunque-generation",
      name: "XiaoYunque",
      runtime: { command: "convax-xiaoyunque-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/5",
      version: "0.4.0",
    })
    expect(parsed.contributes.llm).toEqual({
      models: [{ id: "pippit-glm-main", name: "Pippit GLM Main" }],
      provider: { id: "pippit-glm", name: "Pippit GLM" },
    })
    expect(() =>
      parseWebPluginManifest({
        ...parsed,
        contributes: {
          ...parsed.contributes,
          llm: { ...parsed.contributes.llm, baseUrl: "https://xyq.jianying.com" },
        },
      }),
    ).toThrow("unsupported field")
  })

  test("parses a v5 Pet feature provider with exact capabilities", () => {
    const parsed = parseWebPluginManifest(petManifest())

    expect(parsed.contributes.pet).toEqual({
      library: "pet-library.json",
      overlay: "pet/index.html",
      protocol: "convax.pet-host/1",
      settings: "settings/index.html",
    })
    expect(parsed.capabilities).toEqual(["pet.activity.read", "pet.activity.open", "pet.preferences.write"])
    expect(parsed.entry).toBeUndefined()
    expect(parsed.runtime).toBeUndefined()
    expect(() => parseWebPluginManifest({ ...petManifest(), schema: "convax.plugin/4" })).toThrow()
    expect(() =>
      parseWebPluginManifest({
        ...petManifest(),
        runtime: { command: "pet-runtime", type: "mcp-stdio" },
      }),
    ).toThrow()
  })

  test.each([
    ["remote library URL", { library: "https://example.invalid/pet-library.json" }],
    ["library traversal", { library: "../pet-library.json" }],
    ["non-JSON library", { library: "pet-library.txt" }],
    ["non-HTML overlay", { overlay: "pet/app.js" }],
    ["settings traversal", { settings: "../settings/index.html" }],
    ["unsupported protocol", { protocol: "convax.pet-host/2" }],
    ["unknown fields", { source: "remote" }],
  ])("rejects a Pet feature with %s", (_label, override) => {
    const manifest = petManifest()
    const pet = manifest.contributes.pet
    expect(() =>
      parseWebPluginManifest({
        ...manifest,
        contributes: { pet: { ...pet, ...override } },
      }),
    ).toThrow()
  })

  test("rejects the old spritesheet contribution and non-exact Pet capabilities", () => {
    const manifest = petManifest()
    expect(() =>
      parseWebPluginManifest({
        ...manifest,
        contributes: {
          pet: {
            alt: "Legacy pet",
            description: "Legacy one-atlas contribution",
            name: "Legacy",
            spritesheet: "assets/legacy.webp",
            spriteVersion: 2,
          },
        },
      }),
    ).toThrow()
    expect(() => parseWebPluginManifest({ ...manifest, capabilities: ["pet.activity.read"] })).toThrow()
    expect(() =>
      parseWebPluginManifest({
        ...manifest,
        capabilities: [...manifest.capabilities, "canvas.document.read"],
      }),
    ).toThrow()
  })

  test("rejects ambiguous, unsafe, or standalone v4 Skill contributions", () => {
    const withSkills = (skills: unknown) => {
      const manifest = ownedSkillsManifest()
      return parseWebPluginManifest({ ...manifest, contributes: { ...manifest.contributes, skills } })
    }

    expect(() => withSkills([])).toThrow("non-empty array")
    expect(() => withSkills([{ name: "Bad_Name", path: "skills/Bad_Name" }])).toThrow("kebab-case")
    expect(() => withSkills([{ name: "canvas-director", path: "skills/other" }])).toThrow(
      "must name its Skill directory",
    )
    expect(() =>
      withSkills([
        { name: "canvas-director", path: "skills/canvas-director" },
        { name: "canvas-director", path: "other/canvas-director" },
      ]),
    ).toThrow("duplicate names")
    expect(() =>
      withSkills([
        { name: "canvas-director", path: "skills/canvas-director" },
        { name: "asset-reviewer", path: "skills/canvas-director" },
      ]),
    ).toThrow()
    expect(() =>
      parseWebPluginManifest({
        capabilities: [],
        contributes: { skills: [{ name: "canvas-director", path: "skills/canvas-director" }] },
        description: "Only a Skill",
        id: "skill-wrapper",
        name: "Skill Wrapper",
        schema: "convax.plugin/4",
        version: "1.0.0",
      }),
    ).toThrow("beyond owned Skills")
  })

  test("rejects ambiguous v3 model, Agent, and selection-action references", () => {
    const base = executableManifestV3()
    const generation = base.contributes.generation
    const withContributions = (contributes: Record<string, unknown>) => ({ ...base, contributes })

    expect(() => parseWebPluginManifest(withContributions({ generation: { tools: generation.tools } }))).toThrow(
      "models must be declared explicitly",
    )
    expect(() =>
      parseWebPluginManifest(
        withContributions({
          generation: { ...generation, models: [{ name: "Missing", tool: "missing.tool" }] },
        }),
      ),
    ).toThrow("unknown tool")
    expect(() =>
      parseWebPluginManifest(
        withContributions({
          agent: { tools: [{ id: "generate_image", tool: "image.generate" }] },
          generation,
        }),
      ),
    ).toThrow("operation, not a generation model")
    expect(() =>
      parseWebPluginManifest(
        withContributions({
          agent: { tools: [{ id: "Bad-Name", tool: "video.generate" }] },
          generation,
        }),
      ),
    ).toThrow("lower snake_case")
    expect(() => {
      const action = base.contributes.canvas.selectionActions[0]
      return parseWebPluginManifest(
        withContributions({
          canvas: { selectionActions: [{ ...action, steps: [{ tool: "image.generate" }] }] },
          generation,
        }),
      )
    }).toThrow("operation, not a generation model")
    expect(() => {
      const action = base.contributes.canvas.selectionActions[0]
      return parseWebPluginManifest(
        withContributions({
          canvas: { selectionActions: [{ ...action, steps: [{ tool: "missing.tool" }] }] },
          generation,
        }),
      )
    }).toThrow("unknown generation tool")
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

  test("allows a headless service-only Tool Plugin and keeps actions fixed and optional", () => {
    const parsed = parseWebPluginManifest({
      capabilities: [],
      contributes: { service: serviceContribution(["sign_out"]) },
      description: "Account service",
      id: "account-service",
      name: "Account Service",
      runtime: { command: "account-service-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/2",
      version: "1.0.0",
    })

    expect(parsed.entry).toBeUndefined()
    expect(parsed.contributes.generation).toBeUndefined()
    expect(parsed.contributes.service).toEqual({ actions: ["sign_out"] })

    const statusOnly = parseWebPluginManifest({
      ...parsed,
      contributes: { service: serviceContribution([]) },
    })
    expect(statusOnly.contributes.service?.actions).toEqual([])
  })

  test("lets generation and service contributions share exactly one runtime", () => {
    const manifest = executableManifest()
    const parsed = parseWebPluginManifest({
      ...manifest,
      contributes: { ...manifest.contributes, service: serviceContribution() },
    })
    expect(parsed.contributes.generation?.tools).toHaveLength(2)
    expect(parsed.contributes.service?.actions).toEqual(["reauthorize", "sign_out"])
    expect(parsed.runtime?.command).toBe("convax-generation-mcp")
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
      "only to executable Plugin manifests",
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

  test("rejects arbitrary service methods, fields, and duplicate actions", () => {
    const manifest = executableManifest()
    const withService = (service: unknown) => ({
      ...manifest,
      contributes: { ...manifest.contributes, service },
    })
    expect(() => parseWebPluginManifest(withService({ actions: ["open_browser"] }))).toThrow("unsupported")
    expect(() => parseWebPluginManifest(withService({ actions: ["sign_out", "sign_out"] }))).toThrow("duplicate")
    expect(() => parseWebPluginManifest(withService({ actions: [], statusTool: "arbitrary.call" }))).toThrow(
      "unsupported field",
    )
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
