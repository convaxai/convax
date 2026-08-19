import { randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "../contracts"

interface JsonRpcRequest {
  id?: number | string | null
  jsonrpc?: string
  method?: string
  params?: unknown
}

interface RegisteredScope {
  scope: AgentToolScope
  token: string
}

export interface AgentLocalToolServerOptions {
  progressHeartbeatMs?: number
}

export interface AgentLocalToolRegistration {
  headers: Record<string, string>
  url: string
}

const bodyLimit = 1024 * 1024
const defaultProgressHeartbeatMs = 15_000
const maxTimerMs = 2_147_483_647
const maxProgressTokenLength = 256

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(value))
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { error: { code, message }, id: id ?? null, jsonrpc: "2.0" }
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { id: id ?? null, jsonrpc: "2.0", result }
}

function acceptsEventStream(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value.join(",") : value
  if (!header) return false
  return header.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.split(";")
    if (mediaType?.trim().toLowerCase() !== "text/event-stream") return false
    const quality = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="))
    if (!quality) return true
    const value = Number(quality.slice(2))
    return Number.isFinite(value) && value > 0
  })
}

function requestedProgressToken(params: Record<string, unknown>) {
  const meta = isRecord(params._meta) ? params._meta : undefined
  const token = meta?.progressToken
  if (typeof token === "string" && token.length > 0 && token.length <= maxProgressTokenLength) return token
  if (typeof token === "number" && Number.isSafeInteger(token)) return token
  return undefined
}

function beginEventStream(response: ServerResponse) {
  response.writeHead(200, {
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
  })
  response.flushHeaders()
}

function eventStreamMessage(response: ServerResponse, value: unknown) {
  if (response.destroyed || response.writableEnded) return
  response.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`)
}

function endEventStream(response: ServerResponse, value: unknown) {
  if (response.destroyed || response.writableEnded) return
  eventStreamMessage(response, value)
  response.end()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > bodyLimit) throw new Error("Agent tool request is too large")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function toolText(value: unknown) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

function toolList(tools: readonly AgentToolDefinition[]) {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
  }))
}

/**
 * Minimal stateless Streamable HTTP MCP transport. It is loopback-only,
 * bearer-authenticated, and gives every registered scope an unguessable URL.
 */
export class AgentLocalToolServer {
  private readonly authorization = `Bearer ${randomBytes(32).toString("base64url")}`
  private readonly activeCalls = new Set<AbortController>()
  private readonly activeCallsByScope = new Map<string, Map<number | string, AbortController>>()
  private readonly byScope = new Map<string, RegisteredScope>()
  private readonly byToken = new Map<string, RegisteredScope>()
  private readonly sockets = new Set<Socket>()
  private server?: Server
  private starting?: Promise<void>

  constructor(
    private readonly provider: AgentToolProvider,
    private readonly serverName = "host",
    options: AgentLocalToolServerOptions = {},
  ) {
    const progressHeartbeatMs = options.progressHeartbeatMs ?? defaultProgressHeartbeatMs
    if (!Number.isSafeInteger(progressHeartbeatMs) || progressHeartbeatMs <= 0 || progressHeartbeatMs > maxTimerMs) {
      throw new Error("Agent tool progress heartbeat interval must be a positive safe timer interval")
    }
    this.progressHeartbeatMs = progressHeartbeatMs
  }

  private readonly progressHeartbeatMs: number

  async registerScope(scope: AgentToolScope): Promise<AgentLocalToolRegistration> {
    await this.start()
    const key = JSON.stringify([scope.directory, scope.scopeId])
    let registration = this.byScope.get(key)
    if (!registration) {
      registration = { scope, token: randomBytes(24).toString("base64url") }
      this.byScope.set(key, registration)
      this.byToken.set(registration.token, registration)
    }
    const address = this.server?.address() as AddressInfo | null
    if (!address) throw new Error("Tool server is not listening")
    return {
      headers: { Authorization: this.authorization },
      url: `http://127.0.0.1:${address.port}/mcp/${registration.token}`,
    }
  }

  private start() {
    if (this.server?.listening) return Promise.resolve()
    if (this.starting) return this.starting
    const server = createServer((request, response) => void this.handle(request, response))
    server.on("connection", (socket) => {
      this.sockets.add(socket)
      socket.once("close", () => this.sockets.delete(socket))
    })
    this.server = server
    this.starting = new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        server.off("error", onError)
        resolve()
      }
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(0, "127.0.0.1")
    }).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const address = this.server?.address() as AddressInfo | null
      const allowedHosts = address
        ? new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`])
        : new Set<string>()
      if (!request.headers.host || !allowedHosts.has(request.headers.host.toLowerCase())) {
        json(response, 403, rpcError(null, -32000, "Forbidden host"))
        return
      }
      if (request.headers.authorization !== this.authorization) {
        response.setHeader("WWW-Authenticate", "Bearer")
        json(response, 401, rpcError(null, -32001, "Unauthorized"))
        return
      }
      const token = request.url?.match(/^\/mcp\/([A-Za-z0-9_-]+)$/)?.[1]
      const registration = token ? this.byToken.get(token) : undefined
      if (!registration) {
        json(response, 404, rpcError(null, -32002, "Unknown tool scope"))
        return
      }
      if (request.method === "GET") {
        response.setHeader("Allow", "POST")
        json(response, 405, rpcError(null, -32003, "SSE is not available for this stateless server"))
        return
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST")
        json(response, 405, rpcError(null, -32600, "Method not allowed"))
        return
      }
      const value = await readJsonBody(request)
      if (!isRecord(value) || Array.isArray(value)) {
        json(response, 400, rpcError(null, -32600, "Invalid JSON-RPC request"))
        return
      }
      const rpc = value as JsonRpcRequest
      if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
        json(response, 400, rpcError(rpc.id, -32600, "Invalid JSON-RPC request"))
        return
      }
      if (rpc.id === undefined || rpc.id === null) {
        if (rpc.method === "notifications/cancelled") {
          const params = isRecord(rpc.params) ? rpc.params : {}
          const requestId = params.requestId
          if (typeof requestId === "number" || typeof requestId === "string") {
            this.activeCallsByScope
              .get(registration.token)
              ?.get(requestId)
              ?.abort(new Error("Agent tool request was cancelled"))
          }
        }
        response.writeHead(202, { "Cache-Control": "no-store" })
        response.end()
        return
      }
      if (typeof rpc.id !== "number" && typeof rpc.id !== "string") {
        json(response, 400, rpcError(null, -32600, "Invalid JSON-RPC request id"))
        return
      }
      if (rpc.method === "initialize") {
        const params = isRecord(rpc.params) ? rpc.params : {}
        json(
          response,
          200,
          rpcResult(rpc.id, {
            capabilities: { tools: { listChanged: false } },
            protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26",
            serverInfo: { name: this.serverName, version: "0.0.0" },
          }),
        )
        return
      }
      if (rpc.method === "ping") {
        json(response, 200, rpcResult(rpc.id, {}))
        return
      }
      if (rpc.method === "tools/list") {
        const tools = await this.provider.listTools(registration.scope)
        json(response, 200, rpcResult(rpc.id, { tools: toolList(tools) }))
        return
      }
      if (rpc.method === "tools/call") {
        const params = isRecord(rpc.params) ? rpc.params : {}
        const name = typeof params.name === "string" ? params.name : ""
        const input = isRecord(params.arguments) ? params.arguments : {}
        const progressToken = requestedProgressToken(params)
        const streamProgress = progressToken !== undefined && acceptsEventStream(request.headers.accept)
        let callsForScope = this.activeCallsByScope.get(registration.token)
        if (!callsForScope) {
          callsForScope = new Map()
          this.activeCallsByScope.set(registration.token, callsForScope)
        }
        if (callsForScope.has(rpc.id)) {
          json(response, 400, rpcError(rpc.id, -32600, "Duplicate active JSON-RPC request id"))
          return
        }
        const controller = new AbortController()
        const abort = () => controller.abort(new Error("Agent tool request was aborted"))
        const abortOnResponseClose = () => {
          if (!response.writableFinished) abort()
        }
        request.once("aborted", abort)
        request.socket.once("close", abort)
        request.socket.once("end", abort)
        request.socket.once("error", abort)
        response.once("close", abortOnResponseClose)
        response.once("error", abort)
        if (request.aborted || request.socket.destroyed || response.destroyed) abort()
        this.activeCalls.add(controller)
        callsForScope.set(rpc.id, controller)
        let heartbeat: ReturnType<typeof setInterval> | undefined
        let progress = 0
        const finish = (value: unknown) => {
          if (streamProgress) endEventStream(response, value)
          else json(response, 200, value)
        }
        try {
          controller.signal.throwIfAborted()
          if (streamProgress) {
            beginEventStream(response)
            heartbeat = setInterval(() => {
              if (controller.signal.aborted || response.destroyed || response.writableEnded) return
              progress += 1
              eventStreamMessage(response, {
                jsonrpc: "2.0",
                method: "notifications/progress",
                params: { progress, progressToken },
              })
            }, this.progressHeartbeatMs)
            heartbeat.unref()
          }
          const tools = await this.provider.listTools(registration.scope)
          controller.signal.throwIfAborted()
          if (!tools.some((tool) => tool.name === name)) {
            finish(
              rpcResult(rpc.id, {
                content: [{ text: `Unknown tool: ${name}`, type: "text" }],
                isError: true,
              }),
            )
            return
          }
          const result = await this.provider.callTool(registration.scope, name, input, {
            signal: controller.signal,
          })
          controller.signal.throwIfAborted()
          finish(rpcResult(rpc.id, { content: [{ text: toolText(result), type: "text" }] }))
        } catch (error) {
          if (controller.signal.aborted && !response.destroyed && !response.writableEnded) {
            finish(rpcError(rpc.id, -32800, "Request cancelled"))
          } else if (!controller.signal.aborted && !response.destroyed) {
            finish(
              rpcResult(rpc.id, {
                content: [{ text: error instanceof Error ? error.message : String(error), type: "text" }],
                isError: true,
              }),
            )
          }
        } finally {
          request.off("aborted", abort)
          request.socket.off("close", abort)
          request.socket.off("end", abort)
          request.socket.off("error", abort)
          response.off("close", abortOnResponseClose)
          response.off("error", abort)
          if (heartbeat) clearInterval(heartbeat)
          this.activeCalls.delete(controller)
          callsForScope.delete(rpc.id)
          if (callsForScope.size === 0) this.activeCallsByScope.delete(registration.token)
        }
        return
      }
      json(response, 200, rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`))
    } catch (error) {
      json(response, 500, rpcError(null, -32603, error instanceof Error ? error.message : String(error)))
    }
  }

  async close() {
    this.byScope.clear()
    this.byToken.clear()
    for (const controller of this.activeCalls) {
      controller.abort(new Error("Agent tool server was closed"))
    }
    this.activeCalls.clear()
    this.activeCallsByScope.clear()
    const server = this.server
    this.server = undefined
    if (!server) return
    server.close()
    // DSH may still have an MCP request in flight while the desktop is
    // quitting. Waiting for that request would keep the Electron main process
    // alive indefinitely and allow a new renderer to run against stale IPC.
    server.closeAllConnections()
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
  }
}
