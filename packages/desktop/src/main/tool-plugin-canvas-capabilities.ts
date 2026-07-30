import {
  getPluginApiDefinition,
  isPluginApiId,
  isPluginApiDeclared,
  parsePluginApiCall,
  pluginApiCatalog,
  pluginApiContractIds,
  type PluginApiDefinition,
  type PluginApiId,
} from "@convax/plugin-api"

import type { InstalledPlugin } from "../plugin-api"
import type {
  PluginHostApiMainConnection,
  PluginHostInvocationLease,
  PluginHostInvocationLeaseClaims,
} from "../plugin-host-api-main-contracts"
import type {
  PluginCanvasChangeEvent,
  PluginPrincipal,
  PluginProjectScope,
} from "../plugin-capability-contracts"
import type { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import type { StdioMcpServerRequestContext, StdioMcpServerRequestHandler } from "./stdio-mcp-client"

const companionMcpPrefix = "convax/plugin-capability/"

export const toolPluginCanvasMcpNotifications = {
  documentChanged: "notifications/convax/plugin-capability/canvas.document.changed",
} as const

export interface ToolPluginCompanionApiExclusion {
  readonly reason: string
}

/**
 * A companion Catalog API that cannot use the generic Main route must be
 * recorded here with a reviewable reason. The completeness check rejects a
 * companion API that has neither a generated typed contract nor an exclusion.
 */
export const toolPluginCompanionApiExclusions = Object.freeze(
  {} satisfies Partial<Record<PluginApiId, ToolPluginCompanionApiExclusion>>,
)

export interface ToolPluginCompanionApiRoute {
  readonly host: PluginApiId
  readonly mcp: string
}

export function deriveToolPluginCompanionApiRoutes(
  definitions: readonly PluginApiDefinition[] = pluginApiCatalog.apis,
): readonly ToolPluginCompanionApiRoute[] {
  const contracts = new Set<string>(pluginApiContractIds)
  return definitions
    .filter((definition) => definition.audience.includes("companion"))
    .flatMap((definition) => {
      if (contracts.has(definition.id)) {
        if (!isPluginApiId(definition.id)) {
          throw new Error(`Companion Host API contract is absent from the Catalog: ${definition.id}`)
        }
        const host = definition.id
        return [{ host, mcp: toolPluginCompanionMcpMethod(host) }]
      }
      if (definition.id in toolPluginCompanionApiExclusions) return []
      throw new Error(`Companion Host API has no generic route or explicit exclusion: ${definition.id}`)
    })
}

const companionApiRoutes = deriveToolPluginCompanionApiRoutes()

export function toolPluginCompanionMcpMethod(apiId: PluginApiId) {
  return `${companionMcpPrefix}${apiId}`
}

export interface ToolPluginHostApiCapabilityHost {
  connect(input: {
    invocationLease?: PluginHostInvocationLease
    onCanvasEvent(input: { event: PluginCanvasChangeEvent; subscriptionId: string }): void
    principal: PluginPrincipal
    scope: PluginProjectScope
  }): Promise<PluginHostApiMainConnection>
  principals: Pick<InstalledPluginPrincipalResolver, "issue">
}

export interface ToolPluginCanvasMcpBridge {
  close(): void
  handler: StdioMcpServerRequestHandler
}

/**
 * Thin reverse-MCP edge for one exact verified Tool runtime. Parameter/result
 * validation, declaration/grant checks, cancellation, irreversible boundaries,
 * subscriptions and domain routing all remain owned by PluginHostApiService.
 */
export async function createToolPluginCanvasMcpBridge(
  plugin: InstalledPlugin,
  host: ToolPluginHostApiCapabilityHost | undefined,
  invocationLease?: PluginHostInvocationLease,
): Promise<ToolPluginCanvasMcpBridge | undefined> {
  if (!host) return undefined
  const routes = toolPluginCompanionApiDefinitions(plugin)
  if (routes.length === 0) return undefined
  const principal = invocationLease?.principal ?? (await host.principals.issue(plugin.id, "tool", plugin))
  if (principal.pluginVersion !== plugin.version) {
    throw new Error(`Tool Plugin changed before its Host API connection was established: ${plugin.id}`)
  }
  const events: {
    send?: (input: { event: PluginCanvasChangeEvent; subscriptionId: string }) => void
  } = {}
  const connection = await host.connect({
    ...(invocationLease ? { invocationLease } : {}),
    onCanvasEvent: (input) => events.send?.(input),
    principal,
    scope: { kind: "all-bound-projects" },
  })
  return new ToolPluginHostApiMcpConnection(connection, routes, events, invocationLease?.claims)
}

function toolPluginCompanionApiDefinitions(plugin: InstalledPlugin) {
  if (
    plugin.schema !== "convax.plugin/8" ||
    !plugin.hostApi ||
    plugin.runtime?.type !== "mcp-stdio" ||
    (!plugin.contributes.generation?.tools.length &&
      plugin.contributes.service === undefined &&
      !plugin.contributes.capabilities?.exports.length) ||
    !plugin.capabilities.includes("projects.read")
  ) {
    return []
  }
  return companionApiRoutes.filter(({ host: apiId }) => declaresAuthorizedApi(plugin, apiId))
}

export function toolPluginCanvasMcpMethodNames(plugin: InstalledPlugin): readonly string[] {
  return toolPluginCompanionApiDefinitions(plugin).map(({ mcp }) => mcp)
}

function declaresAuthorizedApi(plugin: InstalledPlugin, apiId: PluginApiId) {
  if (!plugin.hostApi || !isPluginApiDeclared(plugin.hostApi, apiId)) return false
  const grant = getPluginApiDefinition(apiId).grant
  return grant === null || plugin.capabilities.includes(grant as InstalledPlugin["capabilities"][number])
}

class ToolPluginHostApiMcpConnection implements ToolPluginCanvasMcpBridge {
  readonly handler: StdioMcpServerRequestHandler
  readonly #connection: PluginHostApiMainConnection
  readonly #events: {
    send?: (input: { event: PluginCanvasChangeEvent; subscriptionId: string }) => void
  }
  readonly #methods: ReadonlyMap<string, PluginApiId>
  readonly #operationId?: string
  #closed = false
  #nextRequestId = 1
  #sendNotification?: StdioMcpServerRequestContext["sendNotification"]

  constructor(
    connection: PluginHostApiMainConnection,
    routes: readonly ToolPluginCompanionApiRoute[],
    events: {
      send?: (input: { event: PluginCanvasChangeEvent; subscriptionId: string }) => void
    },
    invocationClaims?: PluginHostInvocationLeaseClaims,
  ) {
    this.#connection = connection
    this.#events = events
    this.#operationId = invocationClaims?.operationId
    this.#methods = new Map(
      routes.filter(({ host }) => connection.supports(host)).map(({ host, mcp }) => [mcp, host]),
    )
    events.send = ({ event, subscriptionId }) => {
      if (this.#closed) return
      try {
        this.#sendNotification?.(toolPluginCanvasMcpNotifications.documentChanged, {
          event,
          subscriptionId,
        })
      } catch {
        this.close()
      }
    }
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
    this.#events.send = undefined
    this.#connection.close()
  }

  async #handle(method: string, params: unknown, context: StdioMcpServerRequestContext) {
    if (this.#closed) throw new Error("Tool Plugin Host API connection is closed")
    throwIfAborted(context.signal)
    const hostMethod = this.#methods.get(method)
    if (!hostMethod) throw new Error("Tool Plugin Host API method is not available")
    this.#sendNotification = (notificationMethod, notificationParams) =>
      context.sendNotification(notificationMethod, notificationParams)
    const call = parsePluginApiCall({
      method: hostMethod,
      ...(params === undefined ? {} : { params }),
    })
    return this.#connection.execute(call, {
      operationId: this.#operationId ?? `tool-request-${this.#nextRequestId++}`,
      signal: context.signal,
    })
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Tool Plugin Host API request was canceled", "AbortError")
}
