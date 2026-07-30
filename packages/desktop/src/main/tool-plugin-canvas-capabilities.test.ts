/* oxlint-disable typescript-eslint/await-thenable -- Bun's async matchers are thenable at runtime. */
import { describe, expect, mock, test } from "bun:test"
import {
  pluginApiCatalog,
  type PluginApiDefinition,
  type PluginApiId,
} from "@convax/plugin-api"

import type { InstalledPlugin } from "../plugin-api"
import type {
  PluginCanvasChangeEvent,
  PluginPrincipal,
} from "../plugin-capability-contracts"
import type {
  PluginHostApiMainConnection,
  PluginHostInvocationLease,
} from "../plugin-host-api-main-contracts"
import {
  createToolPluginCanvasMcpBridge,
  deriveToolPluginCompanionApiRoutes,
  toolPluginCanvasMcpNotifications,
  toolPluginCompanionApiExclusions,
  toolPluginCompanionMcpMethod,
  type ToolPluginHostApiCapabilityHost,
} from "./tool-plugin-canvas-capabilities"

function plugin(
  capabilities: InstalledPlugin["capabilities"],
  hostApis: readonly PluginApiId[],
): InstalledPlugin {
  return {
    capabilities,
    contributes: { service: { actions: [] } },
    description: "Host API sidecar",
    hostApi: { major: 2, optional: [], required: hostApis },
    id: "host-api-sidecar",
    name: "Host API Sidecar",
    runtime: { command: "host-api-sidecar-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/8",
    version: "1.0.0",
  }
}

function principal(): PluginPrincipal {
  return {
    activeRevision: 7,
    activeSetDigest: "b".repeat(64),
    manifestDigest: "a".repeat(64),
    pluginId: "host-api-sidecar",
    pluginVersion: "1.0.0",
    runtime: "tool",
    snapshotDigest: "c".repeat(64),
  }
}

function fixture(supported: readonly PluginApiId[]) {
  let emit: ((input: { event: PluginCanvasChangeEvent; subscriptionId: string }) => void) | undefined
  const close = mock(() => undefined)
  const execute = mock(async (call: { method: PluginApiId }) => {
    if (call.method === "projects.list") return { projects: [] }
    if (call.method === "canvas.events.subscribe") return { subscriptionId: "subscription-one" }
    return {}
  })
  const connection: PluginHostApiMainConnection = {
    close,
    execute,
    supports: (method) => supported.includes(method),
  }
  const issue = mock(async () => principal())
  const connect: ToolPluginHostApiCapabilityHost["connect"] = mock(async (input) => {
    emit = input.onCanvasEvent
    return connection
  })
  return {
    close,
    connect,
    emit: (input: { event: PluginCanvasChangeEvent; subscriptionId: string }) => emit?.(input),
    execute,
    host: { connect, principals: { issue } } satisfies ToolPluginHostApiCapabilityHost,
    issue,
  }
}

function context(sendNotification = mock(() => undefined), signal = new AbortController().signal) {
  return { sendNotification, signal }
}

describe("Tool Plugin reverse Host API MCP adapter", () => {
  test("derives exposed methods from companion Catalog entries, declarations, grants, and Main support", async () => {
    const installed = plugin(
      ["projects.read", "canvas.document.read"],
      ["projects.list", "canvas.document.get", "canvas.nodes.query"],
    )
    const { connect, execute, host, issue } = fixture([
      "projects.list",
      "canvas.document.get",
      "canvas.nodes.query",
    ])
    const bridge = await createToolPluginCanvasMcpBridge(installed, host)

    expect(issue).toHaveBeenCalledWith("host-api-sidecar", "tool", installed)
    expect(connect).toHaveBeenCalledWith({
      onCanvasEvent: expect.any(Function),
      principal: expect.objectContaining({ pluginId: "host-api-sidecar", runtime: "tool" }),
      scope: { kind: "all-bound-projects" },
    })
    expect(bridge?.handler.methods).toEqual([
      toolPluginCompanionMcpMethod("projects.list"),
      toolPluginCompanionMcpMethod("canvas.document.get"),
      toolPluginCompanionMcpMethod("canvas.nodes.query"),
    ])

    const requestContext = context()
    await expect(
      bridge!.handler.handle({ method: toolPluginCompanionMcpMethod("projects.list") }, requestContext),
    ).resolves.toEqual({ projects: [] })
    expect(execute).toHaveBeenCalledWith(
      { method: "projects.list" },
      { operationId: "tool-request-1", signal: requestContext.signal },
    )
    bridge?.close()
  })

  test("does not make projects.list declaration a hidden prerequisite for another declared API", async () => {
    const installed = plugin(["projects.read", "canvas.document.read"], ["canvas.document.get"])
    const { host, issue } = fixture(["canvas.document.get"])
    const bridge = await createToolPluginCanvasMcpBridge(installed, host)

    expect(issue).toHaveBeenCalledTimes(1)
    expect(bridge?.handler.methods).toEqual([toolPluginCompanionMcpMethod("canvas.document.get")])
    bridge?.close()
  })

  test("requires the explicit projects.read grant for an all-bound-projects connection", async () => {
    const installed = plugin(["canvas.document.read"], ["canvas.document.get"])
    const { connect, host, issue } = fixture(["canvas.document.get"])

    await expect(createToolPluginCanvasMcpBridge(installed, host)).resolves.toBeUndefined()
    expect(issue).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  test("filters APIs omitted by the manifest or by their Catalog grant", async () => {
    const installed = plugin(
      ["projects.read"],
      ["projects.list", "canvas.document.get", "canvas.transaction.execute"],
    )
    const { host } = fixture([
      "projects.list",
      "canvas.document.get",
      "canvas.nodes.query",
      "canvas.transaction.execute",
    ])
    const bridge = await createToolPluginCanvasMcpBridge(installed, host)

    expect(bridge?.handler.methods).toEqual([toolPluginCompanionMcpMethod("projects.list")])
    bridge?.close()
  })

  test("forwards generated call parsing and cancellation to the one Main connection", async () => {
    const installed = plugin(["projects.read"], ["projects.list"])
    const { execute, host } = fixture(["projects.list"])
    const bridge = await createToolPluginCanvasMcpBridge(installed, host)
    const controller = new AbortController()

    await bridge!.handler.handle(
      { method: toolPluginCompanionMcpMethod("projects.list") },
      context(undefined, controller.signal),
    )
    expect(execute).toHaveBeenCalledWith(
      { method: "projects.list" },
      { operationId: "tool-request-1", signal: controller.signal },
    )
    await expect(
      bridge!.handler.handle(
        { method: toolPluginCompanionMcpMethod("projects.list"), params: { unexpected: true } },
        context(),
      ),
    ).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
    bridge?.close()
  })

  test("uses the historical invocation operation id and does not issue a current principal", async () => {
    const installed = plugin(["projects.read"], ["projects.list"])
    const { connect, execute, host, issue } = fixture(["projects.list"])
    const invocationPrincipal = principal()
    const invocationLease: PluginHostInvocationLease = {
      assertActive: mock(async () => undefined),
      claims: {
        consumerPluginId: "consumer",
        operationId: "capability-operation",
        providerPluginId: installed.id,
      },
      principal: invocationPrincipal,
      resolved: {
        ...invocationPrincipal,
        capabilities: installed.capabilities,
        hostApi: installed.hostApi,
        pluginName: installed.name,
      },
      signal: new AbortController().signal,
    }
    const bridge = await createToolPluginCanvasMcpBridge(installed, host, invocationLease)
    const requestContext = context()

    await bridge!.handler.handle(
      { method: toolPluginCompanionMcpMethod("projects.list") },
      requestContext,
    )
    expect(issue).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ invocationLease }))
    expect(execute).toHaveBeenCalledWith(
      { method: "projects.list" },
      { operationId: "capability-operation", signal: requestContext.signal },
    )
    bridge?.close()
  })

  test("keeps document-change notification delivery as a fixed transport edge", async () => {
    const installed = plugin(
      ["projects.read", "canvas.events.subscribe"],
      ["canvas.events.subscribe", "canvas.events.unsubscribe"],
    )
    const { close, emit, host } = fixture(["canvas.events.subscribe", "canvas.events.unsubscribe"])
    const bridge = await createToolPluginCanvasMcpBridge(installed, host)
    const sendNotification = mock(() => undefined)

    await bridge!.handler.handle(
      {
        method: toolPluginCompanionMcpMethod("canvas.events.subscribe"),
        params: { ref: { projectId: "project-one" } },
      },
      context(sendNotification),
    )
    emit({
      event: {
        ref: { canvasId: "main", projectId: "project-one" },
        revision: 2,
        source: "host",
      },
      subscriptionId: "subscription-one",
    })
    expect(sendNotification).toHaveBeenCalledWith(toolPluginCanvasMcpNotifications.documentChanged, {
      event: {
        ref: { canvasId: "main", projectId: "project-one" },
        revision: 2,
        source: "host",
      },
      subscriptionId: "subscription-one",
    })

    bridge?.close()
    bridge?.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  test("fails completeness when a companion Catalog API has neither a generated route nor an exclusion", () => {
    const companionIds = pluginApiCatalog.apis
      .filter((definition) => definition.audience.includes("companion"))
      .map(({ id }) => id)
      .sort()
    const routedIds = deriveToolPluginCompanionApiRoutes()
      .map(({ host }) => host)
      .sort()
    const excludedIds = Object.keys(toolPluginCompanionApiExclusions).sort()

    expect(new Set(routedIds.filter((id) => excludedIds.includes(id)))).toEqual(new Set())
    expect([...routedIds, ...excludedIds].sort()).toEqual(companionIds)
    const futureDefinition: PluginApiDefinition = {
      ...pluginApiCatalog.apis[0],
      audience: ["companion"],
      id: "future.companion.api",
    }
    expect(() => deriveToolPluginCompanionApiRoutes([futureDefinition])).toThrow(
      "Companion Host API has no generic route or explicit exclusion: future.companion.api",
    )
  })
})
