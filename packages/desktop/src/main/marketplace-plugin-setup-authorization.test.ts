import { expect, mock, test } from "bun:test"

import { parseWebPluginManifest, type InstalledWebPluginSummary, type WebPluginManifestV8 } from "../plugin-contracts"
import { authorizeMarketplacePluginSetup } from "./marketplace-plugin-setup-authorization"

function plugin(overrides: Partial<WebPluginManifestV8> = {}): WebPluginManifestV8 {
  return {
    capabilities: [],
    contributes: {
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: ["reference_video"],
            description: "Extract one frame",
            id: "frame.extract",
            output: "image",
            title: "Extract frame",
          },
        ],
      },
    },
    description: "Local transforms",
    hostApi: { major: 3, optional: [], required: [] },
    id: "media-tools",
    name: "Media Tools",
    runtime: { command: "media-tools", type: "mcp-stdio" },
    schema: "convax.plugin/8",
    version: "1.0.0",
    ...overrides,
  }
}

function v9ServicePlugin(): InstalledWebPluginSummary {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      services: [
        {
          actions: ["authorize", "checkout"],
          description: "Product account",
          id: "account",
          name: "Account",
          runtime: {},
        },
      ],
    },
    description: "Product account service",
    hostApi: { major: 3, optional: [], required: [] },
    id: "account-service",
    name: "Account Service",
    runtime: { command: "account-service", type: "mcp-stdio" },
    schema: "convax.plugin/9",
    version: "1.0.0",
  })
}

test("automatic product-lock setup authorizes only an exact managed Tool companion", async () => {
  const authorizeTool = mock(async () => "a".repeat(64))
  const authorizeHook = mock(async () => "b".repeat(64))

  const digest = await authorizeMarketplacePluginSetup(plugin(), "automatic-product-lock", {
    authorizeHook,
    authorizeTool,
  })

  expect(digest).toMatch(/^[a-f0-9]{64}$/)
  expect(authorizeTool).toHaveBeenCalledWith(expect.anything(), { requireManaged: true })
  expect(authorizeHook).not.toHaveBeenCalled()
})

test("automatic product-lock setup admits v8 and v9 Service projections without performing Service actions", async () => {
  const authorizeTool = mock(async () => "a".repeat(64))
  const authorizeHook = mock(async () => "b".repeat(64))

  for (const candidate of [
    plugin({
      contributes: {
        ...plugin().contributes,
        service: { actions: ["authorize", "checkout"] },
      },
    }),
    v9ServicePlugin(),
  ]) {
    await expect(
      authorizeMarketplacePluginSetup(candidate, "automatic-product-lock", {
        authorizeHook,
        authorizeTool,
      }),
    ).resolves.toMatch(/^[a-f0-9]{64}$/)
  }
  expect(authorizeTool).toHaveBeenCalledTimes(2)
  expect(authorizeHook).not.toHaveBeenCalled()
})

test("automatic product-lock setup preserves the exact manifest Host capability contract", async () => {
  const authorizeTool = mock(async () => "a".repeat(64))

  await expect(
    authorizeMarketplacePluginSetup(plugin({ capabilities: ["canvas.document.read"] }), "automatic-product-lock", {
      authorizeHook: async () => null,
      authorizeTool,
    }),
  ).resolves.toMatch(/^[a-f0-9]{64}$/)
  expect(authorizeTool).toHaveBeenCalledWith(expect.anything(), { requireManaged: true })
})

test("automatic product-lock setup rejects Hook and inter-Plugin authority", async () => {
  const dependencies = {
    authorizeHook: async () => null,
    authorizeTool: async () => "a".repeat(64),
  }
  await expect(
    authorizeMarketplacePluginSetup(plugin({ hooks: "hook.mjs" }), "automatic-product-lock", dependencies),
  ).rejects.toThrow("Hook")
  await expect(
    authorizeMarketplacePluginSetup(
      plugin({
        contributes: {
          ...plugin().contributes,
          capabilities: {
            exports: [
              {
                docs: {
                  request: "One bounded request.",
                  response: "One bounded response.",
                  summary: "Read example",
                },
                id: "example.read",
                inputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" },
                operation: "example.read",
                outputSchema: { additionalProperties: false, properties: {}, required: [], type: "object" },
                sideEffect: "read",
                version: "1.0.0",
              },
            ],
            imports: { optional: [], required: [] },
          },
        },
      }),
      "automatic-product-lock",
      dependencies,
    ),
  ).rejects.toThrow("capabilities")
})

test("explicit setup preserves existing Tool plus Hook authorization composition", async () => {
  const authorizeTool = mock(async () => "a".repeat(64))
  const authorizeHook = mock(async () => "b".repeat(64))

  await expect(
    authorizeMarketplacePluginSetup(plugin({ hooks: "hook.mjs" }), "explicit", {
      authorizeHook,
      authorizeTool,
    }),
  ).resolves.toMatch(/^[a-f0-9]{64}$/)
  expect(authorizeTool).toHaveBeenCalledWith(expect.anything(), {})
  expect(authorizeHook).toHaveBeenCalledTimes(1)
})
