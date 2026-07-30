import type { PluginCapabilityNestedCall } from "./plugin-capability-broker"
import { pluginCapabilityBrokerRemoteFailure } from "./plugin-capability-remote-errors"
import type {
  StdioMcpServerRequest,
  StdioMcpServerRequestContext,
  StdioMcpServerRequestHandler,
} from "./stdio-mcp-client"
import { StdioMcpServerRequestError } from "./stdio-mcp-client"

export const pluginCapabilityNestedInvokeMcpMethod = "convax/plugin-capability/invoke" as const
export const pluginCapabilityInvocationAuthoritySchema = "convax.plugin-capability-authority/1" as const
export const pluginCapabilityNestedFailureSchema = "convax.plugin-capability-failure/1" as const

const digestPattern = /^[a-f0-9]{64}$/u
const authorityTokenPattern = /^[A-Za-z0-9_-]{43}$/u
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u

export interface PluginCapabilityNestedOperation {
  readonly host?: StdioMcpServerRequestHandler
  readonly invoke: (call: PluginCapabilityNestedCall) => Promise<unknown>
  readonly operationId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function abortError(reason?: unknown) {
  const error = reason instanceof Error ? reason : new Error("Plugin capability call was canceled")
  error.name = "AbortError"
  return error
}

function invocationAuthority(value: unknown) {
  if (!isRecord(value)) throw new Error("Plugin capability invocation authority is invalid")
  const expected = ["authorityToken", "operationId", "schema"].sort()
  const actual = Object.keys(value).sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    value.schema !== pluginCapabilityInvocationAuthoritySchema ||
    typeof value.operationId !== "string" ||
    !digestPattern.test(value.operationId) ||
    typeof value.authorityToken !== "string" ||
    !authorityTokenPattern.test(value.authorityToken)
  ) {
    throw new Error("Plugin capability invocation authority is invalid")
  }
  return { authorityToken: value.authorityToken, operationId: value.operationId }
}

function requestAuthority(value: unknown) {
  if (!isRecord(value)) throw new Error("Plugin capability Host request is invalid")
  const metadata = value._meta
  if (!isRecord(metadata) || Object.keys(metadata).length !== 1) {
    throw new Error("Plugin capability Host request metadata is invalid")
  }
  return invocationAuthority(metadata.convaxPluginCapability)
}

function nestedCall(value: unknown): {
  authorityToken: string
  parentOperationId: string
  call: PluginCapabilityNestedCall
} {
  if (!isRecord(value)) throw new Error("Plugin nested capability request is invalid")
  const expected = ["_meta", "capabilityId", "input", "parentOperationId", "requestId"].sort()
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Plugin nested capability request contains unsupported fields")
  }
  if (
    typeof value.parentOperationId !== "string" ||
    !digestPattern.test(value.parentOperationId) ||
    typeof value.capabilityId !== "string" ||
    value.capabilityId.length < 1 ||
    value.capabilityId.length > 160 ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId)
  ) {
    throw new Error("Plugin nested capability request identity is invalid")
  }
  const authority = requestAuthority(value)
  return {
    authorityToken: authority.authorityToken,
    parentOperationId: value.parentOperationId,
    call: {
      capabilityId: value.capabilityId,
      input: value.input,
      requestId: value.requestId,
    },
  }
}

export function createPluginCapabilityNestedMcpHandler(
  operations: Map<string, PluginCapabilityNestedOperation>,
  hostMethods: readonly string[] = [],
  fallback?: StdioMcpServerRequestHandler,
): StdioMcpServerRequestHandler {
  const methods = [...new Set([pluginCapabilityNestedInvokeMcpMethod, ...hostMethods, ...(fallback?.methods ?? [])])]
  return {
    close() {
      fallback?.close?.()
    },
    methods,
    async handle(request, context) {
      if (context.signal.aborted) throw abortError(context.signal.reason)
      if (request.method === pluginCapabilityNestedInvokeMcpMethod) {
        const parsed = nestedCall(request.params)
        const operation = operations.get(parsed.authorityToken)
        if (!operation || operation.operationId !== parsed.parentOperationId) {
          throw new Error("Plugin nested capability parent operation is not active")
        }
        let result: unknown
        try {
          result = await operation.invoke({ ...parsed.call, signal: context.signal })
        } catch (error) {
          throw new StdioMcpServerRequestError(
            -32_010,
            "Plugin capability call failed",
            Object.freeze({
              failure: pluginCapabilityBrokerRemoteFailure(error),
              schema: pluginCapabilityNestedFailureSchema,
            }),
            { cause: error },
          )
        }
        if (context.signal.aborted) throw abortError(context.signal.reason)
        return result
      }
      if (!isRecord(request.params) || !Object.prototype.hasOwnProperty.call(request.params, "_meta")) {
        if (!fallback?.methods.includes(request.method)) {
          throw new Error("Plugin capability Host method is unavailable")
        }
        return fallback.handle(request, context)
      }
      const paramsWithAuthority = request.params
      const authority = requestAuthority(paramsWithAuthority)
      const operation = operations.get(authority.authorityToken)
      if (!operation || operation.operationId !== authority.operationId || !operation.host) {
        throw new Error("Plugin capability Host invocation is not active")
      }
      if (!operation.host.methods.includes(request.method)) {
        throw new Error("Plugin capability Host method is unavailable")
      }
      const { _meta: _, ...params } = paramsWithAuthority
      const result = await operation.host.handle(
        {
          method: request.method,
          ...(Object.keys(params).length === 0 ? {} : { params }),
        },
        context,
      )
      if (context.signal.aborted) throw abortError(context.signal.reason)
      return result
    },
  }
}

export function combineStdioMcpServerRequestHandlers(
  handlers: readonly (StdioMcpServerRequestHandler | undefined)[],
): StdioMcpServerRequestHandler | undefined {
  const active = handlers.filter((handler): handler is StdioMcpServerRequestHandler => handler !== undefined)
  if (active.length === 0) return undefined
  const byMethod = new Map<string, StdioMcpServerRequestHandler>()
  for (const handler of active) {
    for (const method of handler.methods) {
      if (byMethod.has(method)) throw new Error(`Duplicate MCP Host request method: ${method}`)
      byMethod.set(method, handler)
    }
  }
  return {
    close() {
      for (const handler of active) handler.close?.()
    },
    handle(request: StdioMcpServerRequest, context: StdioMcpServerRequestContext) {
      const handler = byMethod.get(request.method)
      if (!handler) throw new Error("MCP Host request method is unavailable")
      return handler.handle(request, context)
    },
    methods: [...byMethod.keys()],
  }
}
