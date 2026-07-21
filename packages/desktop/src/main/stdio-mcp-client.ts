import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process"
import path from "node:path"

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export type McpToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource_link"
      name: string
      uri: string
      description?: string
      mimeType?: string
      size?: number
    }

export interface McpToolCallResult {
  content: McpToolContent[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

interface JsonRpcMessage {
  id?: number | string | null
  jsonrpc?: string
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

interface PendingRequest {
  cleanup(): void
  reject(error: unknown): void
  resolve(value: unknown): void
}

export interface StdioMcpServerRequest {
  method: string
  params?: unknown
}

export interface StdioMcpServerRequestContext {
  /** Aborted when the sidecar cancels this request or the process lifecycle closes. */
  signal: AbortSignal
  /** Transport primitive. Capability adapters must keep their notification names fixed. */
  sendNotification(method: string, params?: unknown): void
}

/**
 * Optional, explicitly allowlisted server-to-client request surface. Methods not
 * listed here retain the MCP client's default JSON-RPC -32601 response.
 */
export interface StdioMcpServerRequestHandler {
  close?(): void
  handle(request: StdioMcpServerRequest, context: StdioMcpServerRequestContext): Promise<unknown>
  methods: readonly string[]
}

export interface StdioMcpClientOptions {
  args?: readonly string[]
  command: string
  cwd: string
  env?: Readonly<Record<string, string | undefined>>
  maxConcurrentServerRequests?: number
  maxMessageBytes?: number
  requestTimeoutMs?: number
  serverRequestHandler?: StdioMcpServerRequestHandler
  shutdownGraceMs?: number
  spawn?: typeof spawn
}

const defaultMaxMessageBytes = 64 * 1024 * 1024
const defaultMaxConcurrentServerRequests = 8
const defaultRequestTimeoutMs = 60 * 60_000
const defaultShutdownGraceMs = 2_000
const maximumToolResultContentItems = 1_024
const supportedMcpProtocolVersion = "2025-03-26"
const maximumServerRequestMethods = 64
const maximumServerErrorBytes = 512

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function abortError(reason?: unknown) {
  const message =
    typeof reason === "string" || typeof reason === "number" || typeof reason === "boolean"
      ? String(reason)
      : "Operation was canceled"
  const error = reason instanceof Error ? reason : new Error(message)
  error.name = "AbortError"
  return error
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortError(signal.reason))
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`)
  return value
}

function normalizeTool(value: unknown): McpToolDefinition {
  const input = requireRecord(value, "MCP tool")
  const inputSchema = requireRecord(input.inputSchema, "MCP tool input schema")
  return {
    description: typeof input.description === "string" ? input.description : undefined,
    inputSchema,
    name: requireString(input.name, "MCP tool name"),
  }
}

function normalizeContent(value: unknown): McpToolContent {
  const input = requireRecord(value, "MCP tool content")
  if (input.type === "text") return { text: typeof input.text === "string" ? input.text : "", type: "text" }
  if (input.type === "image" || input.type === "audio") {
    return {
      data: requireString(input.data, `MCP ${input.type} data`),
      mimeType: requireString(input.mimeType, `MCP ${input.type} MIME type`),
      type: input.type,
    }
  }
  if (input.type === "resource_link") {
    return {
      description: typeof input.description === "string" ? input.description : undefined,
      mimeType: typeof input.mimeType === "string" ? input.mimeType : undefined,
      name: requireString(input.name, "MCP resource link name"),
      size:
        typeof input.size === "number" && Number.isSafeInteger(input.size) && input.size >= 0 ? input.size : undefined,
      type: "resource_link",
      uri: requireString(input.uri, "MCP resource link URI"),
    }
  }
  throw new Error(`Unsupported MCP tool content: ${String(input.type)}`)
}

function normalizeToolResult(value: unknown): McpToolCallResult {
  const input = requireRecord(value, "MCP tool result")
  if (!Array.isArray(input.content)) throw new Error("MCP tool result content must be an array")
  if (input.content.length > maximumToolResultContentItems) {
    throw new Error("MCP tool result contained too many content items")
  }
  if (input.isError !== undefined && typeof input.isError !== "boolean") {
    throw new Error("MCP tool result isError must be a boolean")
  }
  return {
    content: input.content.map(normalizeContent),
    ...(input.isError === undefined ? {} : { isError: input.isError }),
    ...(isRecord(input.structuredContent) ? { structuredContent: input.structuredContent } : {}),
  }
}

function serverRequestKey(id: number | string) {
  return `${typeof id}:${id}`
}

function validServerRequestId(value: unknown): value is number | string {
  return (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length > 0 && value.length <= 128)
  )
}

function boundedServerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Host request failed"
  let bytes = 0
  let result = ""
  for (const character of (message || "Host request failed").slice(0, maximumServerErrorBytes)) {
    const size = Buffer.byteLength(character, "utf8")
    if (bytes + size > maximumServerErrorBytes) break
    bytes += size
    result += character
  }
  return result.trim() || "Host request failed"
}

function requireServerRequestMethods(handler: StdioMcpServerRequestHandler | undefined) {
  if (!handler) return new Set<string>()
  if (!Array.isArray(handler.methods) || handler.methods.length > maximumServerRequestMethods) {
    throw new Error(`MCP server request handler may expose at most ${maximumServerRequestMethods} methods`)
  }
  const methods = handler.methods.map((method) => {
    if (
      typeof method !== "string" ||
      !method.trim() ||
      method !== method.trim() ||
      method.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(method)
    ) {
      throw new Error("MCP server request handler contains an invalid method")
    }
    return method
  })
  if (new Set(methods).size !== methods.length) {
    throw new Error("MCP server request handler contains duplicate methods")
  }
  return new Set(methods)
}

/**
 * Small stdio MCP client for explicitly installed external commands. Beyond
 * initialize and tools/list|call, server requests remain disabled unless the
 * host installs one bounded explicit-method handler.
 */
export class StdioMcpClient {
  readonly #options: Required<
    Pick<
      StdioMcpClientOptions,
      "maxConcurrentServerRequests" | "maxMessageBytes" | "requestTimeoutMs" | "shutdownGraceMs"
    >
  > &
    Omit<
      StdioMcpClientOptions,
      "maxConcurrentServerRequests" | "maxMessageBytes" | "requestTimeoutMs" | "shutdownGraceMs"
    >
  readonly #serverRequestMethods: ReadonlySet<string>
  readonly #serverRequests = new Map<string, { controller: AbortController; id: number | string }>()
  readonly #pending = new Map<number, PendingRequest>()
  #buffer = Buffer.alloc(0)
  #child?: ChildProcessWithoutNullStreams
  #closed = false
  #connecting?: Promise<void>
  #nextId = 1
  #shutdownChild?: ChildProcessWithoutNullStreams
  #serverRequestHandlerClosed = false
  #shutdownTimer?: ReturnType<typeof setTimeout>

  constructor(options: StdioMcpClientOptions) {
    if (!options.command.trim()) throw new Error("MCP command is required")
    if (!options.cwd.trim()) throw new Error("MCP working directory is required")
    const maxConcurrentServerRequests = options.maxConcurrentServerRequests ?? defaultMaxConcurrentServerRequests
    if (
      !Number.isSafeInteger(maxConcurrentServerRequests) ||
      maxConcurrentServerRequests < 1 ||
      maxConcurrentServerRequests > 64
    ) {
      throw new Error("MCP concurrent server request limit must be an integer between 1 and 64")
    }
    this.#serverRequestMethods = requireServerRequestMethods(options.serverRequestHandler)
    this.#options = {
      ...options,
      maxConcurrentServerRequests,
      maxMessageBytes: options.maxMessageBytes ?? defaultMaxMessageBytes,
      requestTimeoutMs: options.requestTimeoutMs ?? defaultRequestTimeoutMs,
      shutdownGraceMs: options.shutdownGraceMs ?? defaultShutdownGraceMs,
    }
  }

  async connect(signal?: AbortSignal) {
    if (this.#closed) throw new Error("MCP client is closed")
    if (signal?.aborted) throw abortError(signal.reason)
    if (!this.#connecting) {
      // Initialization belongs to the shared process, not to whichever caller
      // happened to arrive first. A caller may stop waiting without tearing down
      // concurrent work that uses the same installed Tool Plugin.
      this.#connecting = (async () => {
        this.#start()
        const response = requireRecord(
          await this.#request(
            "initialize",
            {
              capabilities: {},
              clientInfo: { name: "convax", version: "0.0.0" },
              protocolVersion: supportedMcpProtocolVersion,
            },
            undefined,
            30_000,
          ),
          "MCP initialize result",
        )
        if (requireString(response.protocolVersion, "MCP protocol version") !== supportedMcpProtocolVersion) {
          throw new Error(`MCP server selected an unsupported protocol version: ${String(response.protocolVersion)}`)
        }
        this.#notify("notifications/initialized", {})
      })().catch((error) => {
        this.close()
        throw error
      })
    }
    return waitForSignal(this.#connecting, signal)
  }

  async listTools(signal?: AbortSignal): Promise<readonly McpToolDefinition[]> {
    await this.connect(signal)
    const tools: McpToolDefinition[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const result = requireRecord(
        await this.#request("tools/list", cursor ? { cursor } : {}, signal, 30_000),
        "MCP tools/list result",
      )
      if (!Array.isArray(result.tools)) throw new Error("MCP tools/list result must contain a tool array")
      tools.push(...result.tools.map(normalizeTool))
      if (tools.length > 1_000) throw new Error("MCP server exposed too many tools")
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined
      if (!cursor) return tools
    }
    throw new Error("MCP tools/list pagination did not terminate")
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onRequestStart?: () => void,
    requestTimeoutMs: number | false = this.#options.requestTimeoutMs,
  ) {
    await this.connect(signal)
    if (signal?.aborted) throw abortError(signal.reason)
    onRequestStart?.()
    return normalizeToolResult(
      await this.#request(
        "tools/call",
        { arguments: input, name: requireString(name, "MCP tool name") },
        signal,
        requestTimeoutMs,
      ),
    )
  }

  #start() {
    if (this.#child) return
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: this.#options.cwd,
      env: { ...this.#options.env },
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
    }
    const child = (this.#options.spawn ?? spawn)(this.#options.command, [...(this.#options.args ?? [])], {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.#child = child
    const streamFailed = (error: Error) => {
      if (!this.#closed) this.#fail(error)
    }
    child.stdin.on("error", streamFailed)
    child.stdout.on("error", streamFailed)
    child.stderr.on("error", streamFailed)
    child.stdout.on("data", (chunk: Buffer | string) =>
      this.#consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    )
    // Always drain stderr so a verbose sidecar cannot block on a full pipe, but
    // never copy untrusted output into errors returned to Agent or UI callers.
    child.stderr.on("data", () => undefined)
    child.once("error", (error) => this.#fail(error))
    child.once("exit", (code, signal) => {
      if (this.#closed) return
      this.#fail(
        new Error(`MCP command exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`),
        process.platform !== "win32",
      )
    })
  }

  #consume(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    if (this.#buffer.byteLength > this.#options.maxMessageBytes) {
      this.#fail(new Error("MCP response exceeded the message size limit"))
      return
    }
    while (true) {
      const newline = this.#buffer.indexOf(0x0a)
      if (newline < 0) return
      const line = this.#buffer.subarray(0, newline).toString("utf8").trim()
      this.#buffer = this.#buffer.subarray(newline + 1)
      if (!line) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line) as unknown
      } catch (error) {
        this.#fail(new Error("MCP command wrote invalid JSON to stdout", { cause: error }))
        return
      }
      if (!isRecord(parsed)) {
        this.#fail(new Error("MCP command wrote a non-object JSON-RPC message to stdout"))
        return
      }
      this.#handle(parsed as JsonRpcMessage)
    }
  }

  #handle(message: JsonRpcMessage) {
    if (message.jsonrpc !== "2.0") {
      this.#fail(new Error("MCP response used an unsupported JSON-RPC version"))
      return
    }
    if (message.method !== undefined) {
      if (typeof message.method !== "string" || !message.method) {
        if (message.id !== undefined && message.id !== null) {
          this.#write({ error: { code: -32600, message: "Invalid request" }, id: null, jsonrpc: "2.0" })
        }
        return
      }
      if (message.id === undefined || message.id === null) {
        this.#handleServerNotification(message.method, message.params)
        return
      }
      if (message.result !== undefined || message.error !== undefined) {
        this.#write({ error: { code: -32600, message: "Invalid request" }, id: null, jsonrpc: "2.0" })
        return
      }
      this.#handleServerRequest(message)
      return
    }
    if (message.id === undefined || message.id === null) return
    if (typeof message.id !== "number") {
      this.#write({ error: { code: -32600, message: "Unsupported response id" }, id: null, jsonrpc: "2.0" })
      return
    }
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    pending.cleanup()
    if (message.error) {
      pending.reject(
        new Error(
          `MCP request failed${typeof message.error.code === "number" ? ` (${message.error.code})` : ""}: ${message.error.message ?? "Unknown error"}`,
        ),
      )
      return
    }
    pending.resolve(message.result)
  }

  #handleServerNotification(method: string, params: unknown) {
    if (method !== "notifications/cancelled" || !isRecord(params)) return
    const requestId = params.requestId
    if (!validServerRequestId(requestId)) return
    this.#serverRequests.get(serverRequestKey(requestId))?.controller.abort("MCP server canceled the host request")
  }

  #handleServerRequest(message: JsonRpcMessage) {
    const id = message.id
    if (!validServerRequestId(id)) {
      this.#write({ error: { code: -32600, message: "Unsupported request id" }, id: null, jsonrpc: "2.0" })
      return
    }
    const method = message.method!
    const handler = this.#options.serverRequestHandler
    if (!handler || !this.#serverRequestMethods.has(method)) {
      this.#write({ error: { code: -32601, message: "Method not found" }, id, jsonrpc: "2.0" })
      return
    }
    const key = serverRequestKey(id)
    if (this.#serverRequests.has(key)) {
      this.#write({ error: { code: -32600, message: "Duplicate request id" }, id, jsonrpc: "2.0" })
      return
    }
    if (this.#serverRequests.size >= this.#options.maxConcurrentServerRequests) {
      this.#write({ error: { code: -32000, message: "Too many concurrent host requests" }, id, jsonrpc: "2.0" })
      return
    }
    const controller = new AbortController()
    const active = { controller, id }
    this.#serverRequests.set(key, active)
    const context: StdioMcpServerRequestContext = {
      sendNotification: (notificationMethod, params) => {
        if (this.#closed) throw new Error("MCP client is closed")
        this.#notify(notificationMethod, params ?? {})
      },
      signal: controller.signal,
    }
    void Promise.resolve()
      .then(() =>
        handler.handle({ method, ...(message.params === undefined ? {} : { params: message.params }) }, context),
      )
      .then(
        (result) => this.#completeServerRequest(key, active, { result: result ?? null }),
        (error) =>
          this.#completeServerRequest(key, active, {
            error: controller.signal.aborted
              ? { code: -32800, message: "Request canceled" }
              : { code: -32603, message: boundedServerError(error) },
          }),
      )
  }

  #completeServerRequest(
    key: string,
    active: { controller: AbortController; id: number | string },
    outcome: { error: { code: number; message: string } } | { result: unknown },
  ) {
    if (this.#closed || this.#serverRequests.get(key) !== active) return
    this.#serverRequests.delete(key)
    try {
      this.#write({ ...outcome, id: active.id, jsonrpc: "2.0" })
    } catch (error) {
      this.#fail(error)
    }
  }

  #request(
    method: string,
    params: unknown,
    signal?: AbortSignal,
    timeoutMs: number | false = this.#options.requestTimeoutMs,
  ) {
    if (this.#closed || !this.#child) return Promise.reject(new Error("MCP client is not connected"))
    if (signal?.aborted) return Promise.reject(abortError(signal.reason))
    const id = this.#nextId++
    return new Promise<unknown>((resolve, reject) => {
      const cancel = (reason: unknown, aborted: boolean) => {
        if (!this.#pending.delete(id)) return
        cleanup()
        try {
          this.#notify("notifications/cancelled", {
            reason: reason instanceof Error ? reason.message : String(reason),
            requestId: id,
          })
        } catch {
          // The request still has to settle even if the child closed its stdin.
        }
        reject(aborted ? abortError(reason) : reason instanceof Error ? reason : new Error(String(reason)))
      }
      const onAbort = () => cancel(signal?.reason, true)
      const timeout =
        timeoutMs === false
          ? undefined
          : setTimeout(() => cancel(new Error(`MCP request timed out: ${method}`), false), timeoutMs)
      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        signal?.removeEventListener("abort", onAbort)
      }
      this.#pending.set(id, { cleanup, reject, resolve })
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        this.#write({ id, jsonrpc: "2.0", method, params })
      } catch (error) {
        if (this.#pending.delete(id)) {
          cleanup()
          reject(error)
        }
      }
    })
  }

  #notify(method: string, params: unknown) {
    if (!this.#closed && this.#child) this.#write({ jsonrpc: "2.0", method, params })
  }

  #write(value: unknown) {
    const child = this.#child
    if (!child || !child.stdin.writable) throw new Error("MCP command stdin is not writable")
    child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  #fail(error: unknown, forceTree = false) {
    const failure = error instanceof Error ? error : new Error(String(error))
    for (const pending of this.#pending.values()) {
      pending.cleanup()
      pending.reject(failure)
    }
    this.#pending.clear()
    this.close(forceTree)
  }

  close(force = false) {
    if (this.#closed) {
      if (force) this.#forceShutdown()
      return
    }
    this.#closed = true
    for (const request of this.#serverRequests.values()) request.controller.abort("MCP client was closed")
    this.#serverRequests.clear()
    if (!this.#serverRequestHandlerClosed) {
      this.#serverRequestHandlerClosed = true
      try {
        this.#options.serverRequestHandler?.close?.()
      } catch {
        // Handler disposal must not prevent process-tree termination.
      }
    }
    const child = this.#child
    this.#child = undefined
    for (const pending of this.#pending.values()) {
      pending.cleanup()
      pending.reject(new Error("MCP client was closed"))
    }
    this.#pending.clear()
    child?.stdin.destroy()
    child?.stdout.destroy()
    child?.stderr.destroy()
    if (child) {
      this.#shutdownChild = child
      if (force) {
        this.#forceShutdown()
      } else if (child.exitCode !== null || child.signalCode !== null) {
        // An exited Unix leader may still own a live process group, so kill it
        // immediately. Windows execution is disabled by GenerationPluginRuntime;
        // never retain an exited PID for a delayed taskkill because it can be reused.
        if (process.platform === "win32") this.#shutdownChild = undefined
        else this.#forceShutdown()
      } else {
        child.once("exit", () => {
          if (this.#shutdownChild !== child) return
          if (process.platform === "win32") {
            if (this.#shutdownTimer) clearTimeout(this.#shutdownTimer)
            this.#shutdownTimer = undefined
            this.#shutdownChild = undefined
          } else {
            // Do not leave a stale PGID alive for the grace period. Once the
            // MCP leader exits, any remaining group members are orphan helpers.
            this.#forceShutdown()
          }
        })
        this.#kill(child, "SIGTERM")
        this.#shutdownTimer = setTimeout(() => {
          this.#shutdownTimer = undefined
          this.#forceShutdown()
        }, this.#options.shutdownGraceMs)
        this.#shutdownTimer.unref()
      }
    }
  }

  #forceShutdown() {
    if (this.#shutdownTimer) clearTimeout(this.#shutdownTimer)
    this.#shutdownTimer = undefined
    const child = this.#shutdownChild
    this.#shutdownChild = undefined
    if (child) this.#kill(child, "SIGKILL")
  }

  #kill(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
    if (process.platform === "win32" && child.pid) {
      const systemRoot = this.#options.env?.SystemRoot ?? process.env.SystemRoot
      const taskkill =
        systemRoot && path.isAbsolute(systemRoot) ? path.join(systemRoot, "System32", "taskkill.exe") : "taskkill.exe"
      try {
        const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], {
          stdio: "ignore",
          windowsHide: true,
        })
        killer.once("error", () => {
          try {
            child.kill(signal)
          } catch {
            // The process already exited.
          }
        })
        killer.once("exit", (code) => {
          if (code === 0 || child.exitCode !== null || child.signalCode !== null) return
          try {
            child.kill(signal)
          } catch {
            // The process exited while taskkill was running.
          }
        })
        killer.unref()
        return
      } catch {
        // Direct termination remains the fail-closed fallback when taskkill is unavailable.
      }
    }
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
        // The child may not have reached its process group yet; direct kill is the fallback.
      }
    }
    try {
      child.kill(signal)
    } catch {
      // The child already exited.
    }
  }
}
