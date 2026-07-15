import { randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
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

export interface AgentLocalToolRegistration {
  headers: Record<string, string>
  url: string
}

const bodyLimit = 1024 * 1024

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
 * bearer-authenticated, and gives every project an unguessable scope URL.
 */
export class AgentLocalToolServer {
  private readonly authorization = `Bearer ${randomBytes(32).toString("base64url")}`
  private readonly byScope = new Map<string, RegisteredScope>()
  private readonly byToken = new Map<string, RegisteredScope>()
  private server?: Server
  private starting?: Promise<void>

  constructor(private readonly provider: AgentToolProvider) {}

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
    if (!address) throw new Error("Agent tool server is not listening")
    return {
      headers: { Authorization: this.authorization },
      url: `http://127.0.0.1:${address.port}/mcp/${registration.token}`,
    }
  }

  private start() {
    if (this.server?.listening) return Promise.resolve()
    if (this.starting) return this.starting
    const server = createServer((request, response) => void this.handle(request, response))
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
    }).finally(() => { this.starting = undefined })
    return this.starting
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const address = this.server?.address() as AddressInfo | null
      const allowedHosts = address ? new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`]) : new Set<string>()
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
        response.writeHead(202, { "Cache-Control": "no-store" })
        response.end()
        return
      }
      if (rpc.method === "initialize") {
        const params = isRecord(rpc.params) ? rpc.params : {}
        json(response, 200, rpcResult(rpc.id, {
          capabilities: { tools: { listChanged: false } },
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26",
          serverInfo: { name: "convax", version: "0.0.0" },
        }))
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
        const tools = await this.provider.listTools(registration.scope)
        if (!tools.some((tool) => tool.name === name)) {
          json(response, 200, rpcResult(rpc.id, {
            content: [{ text: `Unknown Convax tool: ${name}`, type: "text" }],
            isError: true,
          }))
          return
        }
        try {
          const result = await this.provider.callTool(registration.scope, name, input)
          json(response, 200, rpcResult(rpc.id, { content: [{ text: toolText(result), type: "text" }] }))
        } catch (error) {
          json(response, 200, rpcResult(rpc.id, {
            content: [{ text: error instanceof Error ? error.message : String(error), type: "text" }],
            isError: true,
          }))
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
    const server = this.server
    this.server = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
