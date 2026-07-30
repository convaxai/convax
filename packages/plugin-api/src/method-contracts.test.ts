import { describe, expect, test } from "bun:test"

import {
  parsePluginApiCall,
  parsePluginApiParams,
  parsePluginApiRemoteFailure,
  parsePluginApiResult,
  pluginApiCatalog,
  pluginApiContractIds,
  pluginApiMethodContracts,
  type PluginApiCall,
  type PluginApiParams,
  type PluginApiResult,
} from "./index"

const typedPromptParams: PluginApiParams<"agent.prompt"> = { text: "hello" }
const typedPromptResult: PluginApiResult<"agent.prompt"> = { text: "accepted" }
const typedNoParamsCall: PluginApiCall<"host.context.get"> = { method: "host.context.get" }
const parseRemoteFailure = parsePluginApiRemoteFailure as (
  id: (typeof pluginApiContractIds)[number],
  value: unknown,
) => unknown
void [typedPromptParams, typedPromptResult, typedNoParamsCall]

describe("portable Plugin Host API method contracts", () => {
  test("binds every Catalog id to one request/result contract", () => {
    expect(pluginApiContractIds).toEqual(pluginApiCatalog.apis.map(({ id }) => id).sort())
    expect(Object.keys(pluginApiMethodContracts)).toHaveLength(18)
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
