import { describe, expect, test } from "bun:test"

import {
  maximumPluginApiConnectedImageBytes,
  maximumPluginApiConnectedImageDimension,
  maximumPluginApiConnectedImagePixels,
  parsePluginApiCall,
  parsePluginApiParams,
  parsePluginApiRemoteFailure,
  parsePluginApiResult,
  pluginApiCatalog,
  pluginApiContractIds,
  pluginApiMethodContracts,
  pluginApiWireContracts,
  pluginApiWireSchemaDialect,
  type PluginApiCall,
  type PluginApiParams,
  type PluginApiResult,
} from "./index"

const typedPromptParams: PluginApiParams<"agent.prompt"> = { text: "hello" }
const typedPromptResult: PluginApiResult<"agent.prompt"> = { text: "accepted" }
const typedImageOpenResult: PluginApiResult<"canvas.inputs.image.open"> = {
  probe: {
    contentRevision: "a".repeat(64),
    height: 1,
    kind: "image",
    mimeType: "image/png",
    size: 3,
    width: 1,
  },
  sessionId: "session",
  url: "convax-connected-media://session",
}
const typedNoParamsCall: PluginApiCall<"host.context.get"> = { method: "host.context.get" }
const parseRemoteFailure = parsePluginApiRemoteFailure as (
  id: (typeof pluginApiContractIds)[number],
  value: unknown,
) => unknown
void [typedPromptParams, typedPromptResult, typedImageOpenResult, typedNoParamsCall]

describe("portable Plugin Host API method contracts", () => {
  test("binds every Catalog id to one request/result contract", () => {
    expect(pluginApiContractIds).toEqual(pluginApiCatalog.apis.map(({ id }) => id).sort())
    expect(Object.keys(pluginApiMethodContracts)).toHaveLength(20)
  })

  test("assigns the current wire-schema dialect to every contract", () => {
    expect(pluginApiMethodContracts["canvas.inputs.image.open"].dialect).toBe(pluginApiWireSchemaDialect)
    expect(
      pluginApiContractIds.every((id) => pluginApiMethodContracts[id].dialect === pluginApiWireSchemaDialect),
    ).toBe(true)
  })

  test("gives no-params APIs a real absent-params contract", () => {
    expect(parsePluginApiParams("host.context.get", undefined)).toBeUndefined()
    expect(() => parsePluginApiParams("host.context.get", {})).toThrow("does not accept a value")
    expect(parsePluginApiCall({ method: "host.context.get" })).toEqual({ method: "host.context.get" })
  })

  test("strictly parses method-correlated request and result shapes", () => {
    expect(parsePluginApiParams("agent.prompt", { text: "hello" })).toEqual({ text: "hello" })
    expect(() => parsePluginApiParams("agent.prompt", { text: "hello", toolId: "escape" })).toThrow("unsupported")
    expect(parsePluginApiResult("agent.prompt", { text: "accepted" })).toEqual({ text: "accepted" })
    expect(() => parsePluginApiResult("agent.prompt", { text: 42 })).toThrow("bounded string")
  })

  test("validates bounded Host-owned connected-image sessions with dialect 3", () => {
    const imageProbeSchema = pluginApiWireContracts["canvas.inputs.image.open"].result.schema
    if (!("properties" in imageProbeSchema) || !("properties" in imageProbeSchema.properties.probe)) {
      throw new Error("expected connected image probe object schema")
    }
    expect(imageProbeSchema.properties.probe.products).toEqual([
      { fields: ["width", "height"], maximum: maximumPluginApiConnectedImagePixels },
    ])
    expect(parsePluginApiParams("canvas.inputs.image.open", { inputKey: "opaque-input-key" })).toEqual({
      inputKey: "opaque-input-key",
    })
    const result = {
      probe: {
        contentRevision: "a".repeat(64),
        height: 4_096,
        kind: "image",
        mimeType: "image/webp",
        size: maximumPluginApiConnectedImageBytes,
        width: 8_192,
      },
      sessionId: "image-session",
      url: "convax-connected-media://image-session",
    } as const
    expect(parsePluginApiResult("canvas.inputs.image.open", result)).toEqual(result)
    expect(parsePluginApiParams("canvas.inputs.image.close", { sessionId: "image-session" })).toEqual({
      sessionId: "image-session",
    })
    expect(parsePluginApiResult("canvas.inputs.image.close", { closed: true })).toEqual({ closed: true })

    for (const invalidProbe of [
      { ...result.probe, contentRevision: "A".repeat(64) },
      { ...result.probe, contentRevision: "a".repeat(63) },
      { ...result.probe, size: maximumPluginApiConnectedImageBytes + 1 },
      { ...result.probe, width: maximumPluginApiConnectedImageDimension + 1 },
      { ...result.probe, height: 0 },
    ]) {
      expect(() =>
        parsePluginApiResult("canvas.inputs.image.open", {
          ...result,
          probe: invalidProbe,
        }),
      ).toThrow()
    }
    expect(() =>
      parsePluginApiResult("canvas.inputs.image.open", {
        ...result,
        url: "https://example.com/image.png",
      }),
    ).toThrow("bounded string")
    expect(() =>
      parsePluginApiResult("canvas.inputs.image.open", {
        ...result,
        probe: {
          ...result.probe,
          mimeType: "image/svg+xml",
        },
      }),
    ).toThrow("bounded string")
    expect(() =>
      parsePluginApiResult("canvas.inputs.image.open", {
        ...result,
        probe: {
          ...result.probe,
          height: 4_097,
          width: 8_192,
        },
      }),
    ).toThrow("numeric product limits")
  })

  test("interprets portable semantic refinements and field-local byte limits from the schema", () => {
    expect(parsePluginApiParams("project.file.text.read", { path: "Notes/input.md" })).toEqual({
      path: "Notes/input.md",
    })
    for (const path of ["../secret.txt", ".convax/project.json", "CON/report.txt", " Notes/input.md "]) {
      expect(() => parsePluginApiParams("project.file.text.read", { path })).toThrow("bounded string")
    }

    expect(
      parsePluginApiParams("canvas.resource.image.create", {
        dataUrl: "data:image/png;base64,AAAA",
        name: "capture.png",
      }),
    ).toMatchObject({ name: "capture.png" })
    for (const name of ["CON.png", "../capture.png", "capture.png ", "capture.jpg"]) {
      expect(() =>
        parsePluginApiParams("canvas.resource.image.create", {
          dataUrl: "data:image/png;base64,AAAA",
          name,
        }),
      ).toThrow("bounded string")
    }

    expect(parsePluginApiParams("agent.prompt", { text: "Create a scene" })).toEqual({
      text: "Create a scene",
    })
    expect(() => parsePluginApiParams("agent.prompt", { text: " padded " })).toThrow("bounded string")
    expect(() => parsePluginApiParams("generation.execute", { prompt: "\ncreate a scene" })).toThrow("bounded string")
    expect(
      parsePluginApiParams("generation.execute", {
        prompt: "create a scene",
        references: [{ inputKey: "opaque-input-key", role: "reference_image" }],
      }),
    ).toEqual({
      prompt: "create a scene",
      references: [{ inputKey: "opaque-input-key", role: "reference_image" }],
    })
    expect(() =>
      parsePluginApiParams("generation.execute", {
        prompt: "create a scene",
        references: [{ nodeId: "must-not-cross-wire", role: "reference_image" }],
      }),
    ).toThrow("unsupported")

    expect(() =>
      parsePluginApiParams("canvas.node.state.replace", {
        state: { payload: "x".repeat(300 * 1024) },
      }),
    ).toThrow("exceeds 262144 bytes")
  })

  test("admits only the author-callable Canvas transaction command subset", () => {
    expect(
      parsePluginApiParams("canvas.transaction.execute", {
        commands: [{ delta: { x: 1, y: -2 }, nodeIds: ["node-1"], type: "nodes.move" }],
        expectedRevision: 4,
        ref: { canvasId: "canvas-1", projectId: "project-1" },
        transactionId: "tx-1",
      }),
    ).toMatchObject({ expectedRevision: 4, transactionId: "tx-1" })
    expect(() =>
      parsePluginApiParams("canvas.transaction.execute", {
        commands: [{ type: "resources.add" }],
        expectedRevision: 4,
        ref: { canvasId: "canvas-1", projectId: "project-1" },
        transactionId: "tx-2",
      }),
    ).toThrow("must match exactly one schema variant")
  })

  test("validates deep portable results rather than trusting a typed cast", () => {
    expect(() =>
      parsePluginApiResult("canvas.inputs.list", {
        inputs: [{ inputKey: "node-1", kind: "video", label: "Input", nativePath: "/tmp/private" }],
      }),
    ).toThrow("unsupported")
    expect(() =>
      parsePluginApiResult("canvas.document.get", {
        document: {
          edges: [],
          id: "canvas-1",
          nodes: [
            {
              id: "node-1",
              kind: "video",
              label: "Video",
              position: { x: 0, y: 0 },
              size: { height: "invalid", width: 320 },
            },
          ],
          revision: 1,
          title: "Canvas",
        },
        projection: "geometry",
        ref: { canvasId: "canvas-1", projectId: "project-1" },
        storageVersion: "v1",
      }),
    ).toThrow("must match exactly one schema variant")
  })

  test("binds structured failures to the exact Catalog method and recoverability", () => {
    expect(
      parsePluginApiRemoteFailure("canvas.inputs.open", {
        code: "resource-unavailable",
        kind: "api",
        message: "Input changed.",
        recoverable: true,
      }),
    ).toEqual({
      code: "resource-unavailable",
      kind: "api",
      message: "Input changed.",
      recoverable: true,
    })
    expect(() =>
      parseRemoteFailure("projects.list", {
        code: "stale-context",
        kind: "api",
        message: "Wrong allowlist.",
        recoverable: true,
      }),
    ).toThrow("invalid")
    expect(() =>
      parsePluginApiRemoteFailure("canvas.inputs.open", {
        code: "resource-unavailable",
        kind: "api",
        message: "Wrong recovery metadata.",
        recoverable: false,
      }),
    ).toThrow("recoverability")
  })
})
