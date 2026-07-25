import type { InstalledPlugin, PluginCapability } from "../plugin-api"
import type { PluginCanvasCapabilityClient } from "../plugin-capability-contracts"
import { PluginCapabilityConnection } from "../plugin-capability-dispatch"
import {
  pluginCanvasDocumentChangedCommand,
  pluginCapabilityProtocolV1,
  type DesktopPluginHostMethod,
} from "../plugin-host-protocol"
import type { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import type { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import type { StdioMcpServerRequestContext, StdioMcpServerRequestHandler } from "./stdio-mcp-client"

export const toolPluginCanvasMcpMethods = {
  executeTransaction: "convax/plugin-capability/canvas.transaction.execute",
  getDocument: "convax/plugin-capability/canvas.document.get",
  listCanvases: "convax/plugin-capability/canvas.catalog.list",
  listProjects: "convax/plugin-capability/projects.list",
  queryNodes: "convax/plugin-capability/canvas.nodes.query",
  subscribeEvents: "convax/plugin-capability/canvas.events.subscribe",
  unsubscribeEvents: "convax/plugin-capability/canvas.events.unsubscribe",
} as const

export const toolPluginCanvasMcpNotifications = {
  documentChanged: "notifications/convax/plugin-capability/canvas.document.changed",
} as const

const methodDefinitions = [
  { capability: "projects.read", host: "projects.list", mcp: toolPluginCanvasMcpMethods.listProjects },
  { capability: "canvas.catalog.read", host: "canvas.catalog.list", mcp: toolPluginCanvasMcpMethods.listCanvases },
  { capability: "canvas.document.read", host: "canvas.document.get", mcp: toolPluginCanvasMcpMethods.getDocument },
  { capability: "canvas.document.read", host: "canvas.nodes.query", mcp: toolPluginCanvasMcpMethods.queryNodes },
  {
    capability: "canvas.document.write",
    host: "canvas.transaction.execute",
    mcp: toolPluginCanvasMcpMethods.executeTransaction,
  },
  {
    capability: "canvas.events.subscribe",
    host: "canvas.events.subscribe",
    mcp: toolPluginCanvasMcpMethods.subscribeEvents,
  },
  {
    capability: "canvas.events.subscribe",
    host: "canvas.events.unsubscribe",
    mcp: toolPluginCanvasMcpMethods.unsubscribeEvents,
  },
] as const satisfies readonly {
  capability: PluginCapability
  host: DesktopPluginHostMethod
  mcp: string
}[]

export interface ToolPluginCanvasCapabilityHost {
  broker: Pick<PluginCanvasCapabilityService, "connect">
  principals: Pick<InstalledPluginPrincipalResolver, "issue">
}

export interface ToolPluginCanvasMcpBridge {
  close(): void
  handler: StdioMcpServerRequestHandler
}

/**
 * Creates the fixed reverse-MCP adapter for one exact, already verified Tool
 * Plugin runtime. A sidecar has no presentation Project, so no connection is
 * issued unless `projects.read` explicitly grants an all-bound-Projects scope.
 */
export async function createToolPluginCanvasMcpBridge(
  plugin: InstalledPlugin,
  host: ToolPluginCanvasCapabilityHost | undefined,
): Promise<ToolPluginCanvasMcpBridge | undefined> {
  if (
    !host ||
    (plugin.schema !== "convax.plugin/5" && plugin.schema !== "convax.plugin/6") ||
    plugin.runtime?.type !== "mcp-stdio" ||
    (!plugin.contributes.generation?.tools.length && plugin.contributes.service === undefined) ||
    !plugin.capabilities.includes("projects.read")
  ) {
    return undefined
  }
  const definitions = methodDefinitions.filter(({ capability }) => plugin.capabilities.includes(capability))
  if (definitions.length === 0) return undefined
  const principal = await host.principals.issue(plugin.id, "tool", plugin)
  if (principal.pluginVersion !== plugin.version) {
    throw new Error(`Tool Plugin changed before its Canvas capability connection was established: ${plugin.id}`)
  }
  const client = await host.broker.connect({ principal, scope: { kind: "all-bound-projects" } })
  return new ToolPluginCanvasConnection(client, definitions)
}

class ToolPluginCanvasConnection implements ToolPluginCanvasMcpBridge {
  readonly handler: StdioMcpServerRequestHandler
  readonly #connection: PluginCapabilityConnection
  readonly #methods: ReadonlyMap<string, DesktopPluginHostMethod>
  #closed = false
  #nextRequestId = 1
  #sendNotification?: StdioMcpServerRequestContext["sendNotification"]

  constructor(
    client: PluginCanvasCapabilityClient,
    definitions: readonly { host: DesktopPluginHostMethod; mcp: string }[],
  ) {
    this.#methods = new Map(definitions.map(({ host, mcp }) => [mcp, host]))
    this.#connection = new PluginCapabilityConnection(client, {
      send: (command) => {
        if (this.#closed || command.command !== pluginCanvasDocumentChangedCommand) return
        try {
          this.#sendNotification?.(toolPluginCanvasMcpNotifications.documentChanged, command.params)
        } catch {
          this.close()
        }
      },
    })
    this.handler = {
      close: () => this.close(),
      handle: (request, context) => this.#handle(request.method, request.params, context),
      methods: [...this.#methods.keys()],
    }
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#sendNotification = undefined
    this.#connection.close()
  }

  async #handle(method: string, params: unknown, context: StdioMcpServerRequestContext) {
    if (this.#closed) throw new Error("Tool Plugin Canvas capability connection is closed")
    if (context.signal.aborted) throw new Error("Tool Plugin Canvas capability request was canceled")
    const hostMethod = this.#methods.get(method)
    if (!hostMethod) throw new Error("Tool Plugin Canvas capability method is not available")
    this.#sendNotification = (notificationMethod, notificationParams) =>
      context.sendNotification(notificationMethod, notificationParams)
    const response = await this.#connection.dispatch(
      {
        id: `tool-request-${this.#nextRequestId++}`,
        method: hostMethod,
        ...(params === undefined ? {} : { params }),
        protocol: pluginCapabilityProtocolV1,
        type: "request",
      },
      context.signal,
    )
    if (context.signal.aborted && !(hostMethod === "canvas.transaction.execute" && response?.ok)) {
      if (hostMethod === "canvas.events.subscribe" && response?.ok) {
        const subscriptionId = subscriptionIdFrom(response.result)
        if (subscriptionId) {
          await this.#connection.dispatch({
            id: `tool-request-${this.#nextRequestId++}`,
            method: "canvas.events.unsubscribe",
            params: { subscriptionId },
            protocol: pluginCapabilityProtocolV1,
            type: "request",
          })
        }
      }
      throw new Error("Tool Plugin Canvas capability request was canceled")
    }
    if (this.#closed && !(hostMethod === "canvas.transaction.execute" && response?.ok)) {
      throw new Error("Tool Plugin Canvas capability connection is closed")
    }
    if (!response) throw new Error("Tool Plugin Canvas capability request was invalid")
    if (!response.ok) throw new Error(response.error)
    return response.result
  }
}

function subscriptionIdFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const subscriptionId = Reflect.get(value, "subscriptionId")
  return typeof subscriptionId === "string" ? subscriptionId : undefined
}
