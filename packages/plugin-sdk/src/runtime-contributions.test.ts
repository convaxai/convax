import { describe, expect, test } from "bun:test"

import {
  parsePortablePluginLlmContribution,
  parsePortablePluginPetContribution,
  parsePortablePluginRuntime,
  parsePortablePluginServiceContribution,
} from "./runtime-contributions"

describe("portable runtime, service, LLM, and Pet contributions", () => {
  test("parses the bounded runtime families", () => {
    expect(
      parsePortablePluginRuntime({
        args: ["serve", "--transport=stdio"],
        command: "timeline-mcp",
        type: "mcp-stdio",
      }),
    ).toMatchObject({ command: "timeline-mcp", type: "mcp-stdio" })
    expect(
      parsePortablePluginLlmContribution({
        models: [{ id: "model-1", name: "Model 1" }],
        provider: { id: "provider-one", name: "Provider One" },
      }).provider.id,
    ).toBe("provider-one")
    expect(
      parsePortablePluginPetContribution({
        library: "pet/library.json",
        overlay: "pet/overlay.html",
        protocol: "convax.pet-host/1",
        settings: "pet/settings.html",
      }).protocol,
    ).toBe("convax.pet-host/1")
  })

  test("rejects duplicate service actions and executable runtime tokens", () => {
    expect(() =>
      parsePortablePluginServiceContribution({
        actions: ["authorize", "authorize"],
      }),
    ).toThrow("unsupported or duplicate action")
    expect(() =>
      parsePortablePluginRuntime({
        args: ["../escape"],
        command: "timeline-mcp",
        type: "mcp-stdio",
      }),
    ).toThrow("without code, native paths, or traversal")
  })
})
