import { expect, mock, test } from "bun:test"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import { authorizeMarketplacePluginSetup } from "./marketplace-plugin-setup-authorization"

function plugin(overrides: Partial<InstalledWebPluginSummary> = {}): InstalledWebPluginSummary {
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

test("automatic product-lock setup admits a Service projection without performing a Service action", async () => {
  const authorizeTool = mock(async () => "a".repeat(64))
  const authorizeHook = mock(async () => "b".repeat(64))

  await expect(
    authorizeMarketplacePluginSetup(
      plugin({
        contributes: {
          ...plugin().contributes,
          service: { actions: ["authorize", "checkout"] },
        },
      }),
      "automatic-product-lock",
      { authorizeHook, authorizeTool },
    ),
  ).resolves.toMatch(/^[a-f0-9]{64}$/)
  expect(authorizeTool).toHaveBeenCalledWith(expect.anything(), { requireManaged: true })
  expect(authorizeHook).not.toHaveBeenCalled()
})

test("automatic product-lock setup rejects Hook and extra Plugin authority", async () => {
  const dependencies = {
    authorizeHook: async () => null,
    authorizeTool: async () => "a".repeat(64),
  }
  await expect(
    authorizeMarketplacePluginSetup(plugin({ hooks: "hook.mjs" }), "automatic-product-lock", dependencies),
  ).rejects.toThrow("Hook")
  await expect(
    authorizeMarketplacePluginSetup(
      plugin({ capabilities: ["canvas.document.read"] }),
      "automatic-product-lock",
      dependencies,
    ),
  ).rejects.toThrow("capabilities")
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
