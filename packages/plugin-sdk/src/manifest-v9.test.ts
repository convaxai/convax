import { describe, expect, test } from "bun:test"

import {
  parsePluginManifest,
  parsePortablePluginManifest,
  parsePortablePluginManifestV8,
  parsePortablePluginManifestV9,
  type PortablePluginManifest,
  type PortablePluginManifestV9,
} from "./manifest"

function generation(toolId = "image.generate") {
  return {
    models: [{ name: "Image Model", tool: toolId }],
    tools: [
      {
        acceptedInputs: [],
        description: "Generate an image",
        id: toolId,
        output: "image",
        title: "Generate image",
      },
    ],
  }
}

function service(id: string, overrides: Record<string, unknown> = {}) {
  return {
    actions: [],
    description: `${id} service`,
    generation: generation(),
    id,
    name: id,
    runtime: { args: [`--provider=${id}`] },
    ...overrides,
  }
}

function manifestV9(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: [],
    contributes: {
      services: [
        service("service-one"),
        service("service-two", {
          actions: ["authorize", "sign_out"],
          llm: {
            models: [{ id: "chat-model", name: "Chat Model" }],
            provider: { id: "service-two", name: "Service Two", protocol: "openai" },
          },
        }),
      ],
    },
    description: "One Plugin with isolated services",
    hostApi: { major: 3, optional: [], required: [] },
    id: "multi-service-plugin",
    name: "Multi Service Plugin",
    runtime: {
      args: ["serve"],
      command: "multi-service-mcp",
      type: "mcp-stdio",
    },
    schema: "convax.plugin/9",
    version: "1.0.0",
    ...overrides,
  }
}

describe("convax.plugin/9 multi-Service ABI", () => {
  test("parses isolated services that reuse a local tool id and do not require LLM", () => {
    const manifest = parsePortablePluginManifestV9(manifestV9())

    expect(manifest.schema).toBe("convax.plugin/9")
    expect(manifest.contributes.services?.map(({ id }) => id)).toEqual(["service-one", "service-two"])
    expect(manifest.contributes.services?.[0]?.generation?.tools[0]?.id).toBe("image.generate")
    expect(manifest.contributes.services?.[1]?.generation?.tools[0]?.id).toBe("image.generate")
    expect(manifest.contributes.services?.[0]?.llm).toBeUndefined()
    expect(manifest.contributes.services?.[1]?.llm?.provider.protocol).toBe("openai")
    expect(manifest.contributes.services?.[0]?.actions).toEqual([])
    expect(Object.isFrozen(manifest.contributes.services?.[0]?.runtime.args)).toBeTrue()
  })

  test("allows a Service to expose status and actions without generation or LLM", () => {
    const manifest = parsePortablePluginManifestV9({
      ...manifestV9(),
      contributes: {
        services: [
          {
            actions: [],
            description: "Status-only account",
            id: "status-only",
            name: "Status Only",
            runtime: {},
          },
        ],
      },
    })

    expect(manifest.contributes.services).toEqual([
      {
        actions: [],
        description: "Status-only account",
        id: "status-only",
        name: "Status Only",
        runtime: {},
      },
    ])
  })

  test("keeps v9 closed and bounds service identities", () => {
    const current = manifestV9()
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: { ...current.contributes, service: { actions: [] } },
      }),
    ).toThrow("unsupported field: service")
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: {
          services: [{ ...service("service-one"), privateBridge: true }],
        },
      }),
    ).toThrow("unsupported field: privateBridge")
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: { services: [service("duplicate"), service("duplicate")] },
      }),
    ).toThrow("duplicate ids")
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: { services: [service("Invalid_Service")] },
      }),
    ).toThrow("must use kebab-case")
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: { services: [service("multi-service-plugin")] },
      }),
    ).toThrow("must differ from the Plugin id")
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: {
          services: Array.from({ length: 17 }, (_, index) => service(`service-${index}`)),
        },
      }),
    ).toThrow("at most 16 items")
  })

  test("bounds and validates the effective base plus service runtime arguments", () => {
    const current = manifestV9({
      runtime: {
        args: Array.from({ length: 63 }, (_, index) => `base-${index}`),
        command: "multi-service-mcp",
        type: "mcp-stdio",
      },
    })
    expect(() =>
      parsePortablePluginManifestV9({
        ...current,
        contributes: {
          services: [service("service-one", { runtime: { args: ["profile-one", "profile-two"] } })],
        },
      }),
    ).toThrow("effective args must contain at most 64 items")
    expect(() =>
      parsePortablePluginManifestV9({
        ...manifestV9(),
        contributes: {
          services: [service("service-one", { runtime: { args: ["../escape"] } })],
        },
      }),
    ).toThrow("without code, native paths, or traversal")
  })

  test("rejects duplicate or cross-Service generation references inside one service", () => {
    const duplicateGeneration = generation()
    duplicateGeneration.tools.push({ ...duplicateGeneration.tools[0]! })
    expect(() =>
      parsePortablePluginManifestV9({
        ...manifestV9(),
        contributes: { services: [service("service-one", { generation: duplicateGeneration })] },
      }),
    ).toThrow("Generation tools contain duplicate ids")

    expect(() =>
      parsePortablePluginManifestV9({
        ...manifestV9(),
        contributes: {
          services: [
            service("service-one", {
              generation: {
                models: [{ name: "Cross-service model", tool: "video.generate" }],
                tools: generation().tools,
              },
            }),
            service("service-two", { generation: generation("video.generate") }),
          ],
        },
      }),
    ).toThrow("Generation model references an unknown tool: video.generate")
  })

  test("keeps Agent and Canvas tool references in the top-level generation namespace", () => {
    expect(() =>
      parsePortablePluginManifestV9({
        ...manifestV9(),
        contributes: {
          ...manifestV9().contributes,
          agent: { tools: [{ id: "generate_image", tool: "image.generate" }] },
        },
      }),
    ).toThrow("Agent tool references an unknown generation tool")
  })

  test("requires one shared runtime exactly when executable contributions exist", () => {
    expect(() => parsePortablePluginManifestV9({ ...manifestV9(), runtime: undefined })).toThrow(
      "convax.plugin/9 runtime and executable contribution must appear together",
    )
    expect(() =>
      parsePortablePluginManifestV9({
        ...manifestV9(),
        contributes: { services: [] },
      }),
    ).toThrow("a non-empty bounded array")
  })

  test("dispatches v8 and v9 explicitly without changing normalized v8 bytes", () => {
    const v8Input = {
      capabilities: [],
      contributes: { service: { actions: [] } },
      description: "Singleton service",
      hostApi: { major: 3, optional: [], required: [] },
      id: "singleton-service",
      name: "Singleton Service",
      runtime: { args: ["serve"], command: "singleton-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/8",
      version: "1.0.0",
    }
    const directV8 = parsePortablePluginManifestV8(v8Input)
    const dispatchedV8 = parsePortablePluginManifest(v8Input)
    expect(JSON.stringify(dispatchedV8)).toBe(JSON.stringify(directV8))
    expect(dispatchedV8).toEqual({
      capabilities: [],
      contributes: { service: { actions: [] } },
      description: "Singleton service",
      hostApi: { major: 3, optional: [], required: [] },
      id: "singleton-service",
      name: "Singleton Service",
      runtime: { args: ["serve"], command: "singleton-mcp", type: "mcp-stdio" },
      schema: "convax.plugin/8",
      version: "1.0.0",
    })
    expect(() =>
      parsePortablePluginManifestV8({
        ...v8Input,
        contributes: { services: [service("not-v8")] },
      }),
    ).toThrow("unsupported field: services")

    const dispatchedV9: PortablePluginManifest = parsePortablePluginManifest(manifestV9())
    expect(dispatchedV9.schema).toBe("convax.plugin/9")
    const authored: PortablePluginManifestV9 = parsePluginManifest(manifestV9() as PortablePluginManifestV9)
    expect(authored.schema).toBe("convax.plugin/9")
    expect(() => parsePortablePluginManifest({ ...manifestV9(), schema: "convax.plugin/10" })).toThrow(
      "convax.plugin/8 or convax.plugin/9",
    )
  })
})
