import { randomBytes } from "node:crypto"
import { mkdtemp, open, realpath, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  createOpencodeClient,
  createOpencodeServer,
  type FilePartInput,
  type Message,
  type Part,
  type PermissionRequest,
  type QuestionRequest,
  type ServerOptions,
  type Session,
  type SessionStatus,
  type TextPartInput,
  type ToolState,
} from "@opencode-ai/sdk/v2"

import type {
  AgentCapabilities,
  AgentMessage,
  AgentMessagePart,
  AgentModelCatalog,
  AgentPermissionRequest,
  AgentQuestionRequest,
  AgentRuntime,
  AgentRuntimeCreateSessionInput,
  AgentRuntimeDirectoryInput,
  AgentRuntimeGetSessionStateInput,
  AgentRuntimeListSessionsInput,
  AgentRuntimePromptInput,
  AgentRuntimeRejectQuestionInput,
  AgentRuntimeReplyPermissionInput,
  AgentRuntimeReplyQuestionInput,
  AgentRuntimeResource,
  AgentRuntimeSessionInput,
  AgentRuntimeStatus,
  AgentSession,
  AgentSessionState,
  AgentSessionStatus,
  AgentSkill,
  AgentToolState,
  AgentToolProvider,
} from "../contracts"
import { AgentLocalToolServer } from "./local-tool-server"
import protectedPathPlugin from "./protected-path-plugin"

type OpenCodeClient = ReturnType<typeof createOpencodeClient>
type OpenCodeServer = Awaited<ReturnType<typeof createOpencodeServer>>

export interface OpenCodeAgentRuntimeOptions {
  binaryDirectory?: string
  /** Host-managed OpenCode config root used for installed Skills. */
  configDirectory?: string
  hostname?: string
  port?: number
  /** Maximum time to wait for the OpenCode server process to start. */
  timeout?: number
  config?: ServerOptions["config"]
  /** Lexical OpenCode permission patterns. These are not a filesystem sandbox. */
  protectedPathPatterns?: readonly string[]
  /**
   * Concrete workspace-relative or absolute paths guarded before built-in tool execution.
   * Enabling this strong guard intentionally disables OpenCode's shell and LSP tools.
   */
  protectedPaths?: readonly string[]
  /**
   * OpenCode remote MCP inactivity timeout for injected host tools. The local
   * transport emits progress heartbeats while a call remains active, so this is
   * not an overall long-running tool deadline.
   */
  toolCallTimeout?: number
  toolProvider?: AgentToolProvider
  toolServerName?: string
}

interface SdkResult<T> {
  data?: T
  error?: unknown
  response?: Response
}

interface SkillRefreshWaiter {
  resolve: () => void
  reject: (error: unknown) => void
}

const textExtensions = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
])

const binaryMimeByExtension: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
}

const supportedBinaryMimes = new Set(Object.values(binaryMimeByExtension))
const textFileLimit = 5 * 1024 * 1024
const binaryFileLimit = 20 * 1024 * 1024
const skillPartMetadataKey = "convax.agent.skill"
const defaultHostToolCallTimeout = 30_000

type OpenCodeConfig = NonNullable<ServerOptions["config"]>
type OpenCodePermission = NonNullable<OpenCodeConfig["permission"]>
type OpenCodePermissionObject = Exclude<OpenCodePermission, string>
type OpenCodePermissionRule = NonNullable<OpenCodePermissionObject["read"]>
type OpenCodePermissionAction = Extract<OpenCodePermission, string>
const defaultProtectedPathMarker = ".agent-runtime-protected-path-guard"

function withSkillDiscoveryBoundary(config: ServerOptions["config"] | undefined): OpenCodeConfig {
  return {
    ...config,
    skills: {
      ...config?.skills,
      // Remote Skill indexes are not a runtime discovery mechanism. The host
      // installs reviewed content into its managed config directory instead.
      urls: [],
    },
  }
}

function protectPathPatterns(
  rule: OpenCodePermissionRule | undefined,
  patterns: readonly string[],
  fallback?: OpenCodePermissionAction,
) {
  const existing = typeof rule === "string" ? { "*": rule } : (rule ?? (fallback ? { "*": fallback } : {}))
  const protectedRule: Record<string, OpenCodePermissionAction> = { ...existing }
  for (const pattern of patterns) protectedRule[pattern] = "deny"
  return protectedRule
}

/** Merge host-owned path guards without mutating caller-owned config. */
export function withProtectedPathPermissions(
  config: ServerOptions["config"] | undefined,
  patterns: readonly string[],
): OpenCodeConfig {
  const protectedPatterns = [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))]
  if (protectedPatterns.length === 0) return { ...config }
  const permission = config?.permission
  if (permission === "deny") return { ...config, permission }
  const fallback = typeof permission === "string" ? permission : undefined
  const existing = typeof permission === "object" && permission ? permission : {}
  return {
    ...config,
    permission: {
      ...(fallback ? { "*": fallback } : {}),
      ...existing,
      edit: protectPathPatterns(existing.edit, protectedPatterns, fallback),
      read: protectPathPatterns(existing.read, protectedPatterns, fallback),
    },
  }
}

function normalizeProtectedPaths(paths: readonly string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))].map((path) => {
    if (path.includes("\0")) throw new Error("Protected paths cannot contain null bytes")
    if (/[*?\[\]{}]/.test(path)) {
      throw new Error("Protected paths must be concrete paths; use protectedPathPatterns for glob rules")
    }
    return path
  })
}

function protectedPathPluginSpecifier() {
  try {
    const entry = createRequire(import.meta.url).resolve("@convax/agent-runtime/node/protected-path-plugin")
    return pathToFileURL(entry).href
  } catch {
    // Source-tree tests can run before package build output exists. Published and
    // bundled consumers resolve the exported package entry above.
  }
  const extension = extname(fileURLToPath(import.meta.url))
  return pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), `protected-path-plugin${extension}`)).href
}

/** Add the runtime's strong, symlink-aware protected-path plugin without mutating caller-owned config. */
export function withProtectedPathGuard(
  config: ServerOptions["config"] | undefined,
  paths: readonly string[],
  pluginSpecifier = protectedPathPluginSpecifier(),
  marker = defaultProtectedPathMarker,
): OpenCodeConfig {
  const protectedPaths = normalizeProtectedPaths(paths)
  if (protectedPaths.length === 0) return { ...config }

  const plugins = (config?.plugin ?? []).filter((plugin) => {
    const specifier = typeof plugin === "string" ? plugin : plugin[0]
    return specifier !== pluginSpecifier
  })
  const permission = config?.permission
  const guardedPermission =
    permission === "deny"
      ? permission
      : {
          ...(typeof permission === "string" ? { "*": permission } : (permission ?? {})),
          bash: "deny" as const,
          lsp: "deny" as const,
        }

  return {
    ...config,
    permission: guardedPermission,
    plugin: [...plugins, [pluginSpecifier, { marker, paths: protectedPaths }]],
  }
}

function ensurePackageBinaryOnPath(binaryDirectory?: string) {
  const require = createRequire(import.meta.url)
  const runtimeEntry = require.resolve("@convax/agent-runtime")
  const packageJson = createRequire(runtimeEntry).resolve("opencode-ai/package.json")
  const binaryDirectories = [
    binaryDirectory,
    resolve(dirname(runtimeEntry), "../node_modules/.bin"),
    join(dirname(dirname(packageJson)), ".bin"),
  ].filter((directory): directory is string => Boolean(directory))
  const current = process.env.PATH ?? ""
  const missing = binaryDirectories.filter((directory) => !current.split(delimiter).includes(directory))
  if (missing.length === 0) return
  process.env.PATH = [...missing, current].filter(Boolean).join(delimiter)
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function withOpenCodeSkillEnvironment<T>(configDirectory: string | undefined, launch: () => T): T {
  const previousDisableExternalSkills = process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS
  const previousConfigDirectory = process.env.OPENCODE_CONFIG_DIR
  // Skills are installed into host-controlled config roots. Do not discover
  // ambient ~/.agents, ~/.claude, or project-local external Skill directories.
  process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1"
  if (configDirectory) process.env.OPENCODE_CONFIG_DIR = configDirectory
  try {
    return launch()
  } finally {
    restoreEnvironment("OPENCODE_DISABLE_EXTERNAL_SKILLS", previousDisableExternalSkills)
    restoreEnvironment("OPENCODE_CONFIG_DIR", previousConfigDirectory)
  }
}

function startAuthenticatedServer(
  options: ServerOptions,
  username: string,
  password: string,
  configDirectory?: string,
) {
  const previousUsername = process.env.OPENCODE_SERVER_USERNAME
  const previousPassword = process.env.OPENCODE_SERVER_PASSWORD
  const previousDisableDirectoryConfig = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
  process.env.OPENCODE_SERVER_USERNAME = username
  process.env.OPENCODE_SERVER_PASSWORD = password
  // The host owns executable capabilities through its scoped MCP server. Keep
  // global OpenCode provider/auth config, but do not import executable extensions
  // or instructions from an opened workspace's .opencode directory.
  process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
  try {
    // createOpencodeServer launches the child synchronously before returning its startup promise,
    // so the child receives the private credentials and execution boundary while the parent environment is restored immediately.
    return withOpenCodeSkillEnvironment(configDirectory, () => createOpencodeServer(options))
  } finally {
    restoreEnvironment("OPENCODE_SERVER_USERNAME", previousUsername)
    restoreEnvironment("OPENCODE_SERVER_PASSWORD", previousPassword)
    restoreEnvironment("OPENCODE_DISABLE_PROJECT_CONFIG", previousDisableDirectoryConfig)
  }
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    if (record.data && typeof record.data === "object") {
      const message = (record.data as Record<string, unknown>).message
      if (typeof message === "string") return message
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function unwrap<T>(result: SdkResult<T>, operation: string): T {
  if (result.error !== undefined) throw new Error(`${operation}: ${errorText(result.error)}`)
  if (result.data === undefined) {
    const status = result.response?.status
    throw new Error(`${operation} returned no data${status ? ` (HTTP ${status})` : ""}`)
  }
  return result.data
}

function workspaceDirectory(directory: string): string {
  if (!directory.trim()) throw new Error("Workspace directory is required")
  return resolve(directory)
}

export function isAgentSessionInDirectory(sessionDirectory: string, directory: string) {
  return resolve(sessionDirectory) === resolve(directory)
}

function mapSession(session: Session): AgentSession {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
  }
}

function mapToolState(state: ToolState): AgentToolState {
  switch (state.status) {
    case "pending":
      return { status: "pending", input: state.input }
    case "running":
      return { status: "running", input: state.input, title: state.title }
    case "completed":
      return {
        status: "completed",
        input: state.input,
        title: state.title,
        output: state.output,
      }
    case "error":
      return { status: "error", input: state.input, error: state.error }
  }
}

function skillNameFromPart(part: Extract<Part, { type: "text" }>) {
  const name = part.metadata?.[skillPartMetadataKey]
  return typeof name === "string" && name.trim() ? name.trim() : undefined
}

function mapPart(part: Part): AgentMessagePart {
  switch (part.type) {
    case "text": {
      const skillName = skillNameFromPart(part)
      if (skillName) return { id: part.id, type: "skill", name: skillName }
      return { id: part.id, type: "text", text: part.text, synthetic: part.synthetic }
    }
    case "reasoning":
      return { id: part.id, type: "reasoning", text: part.text }
    case "file":
      return {
        id: part.id,
        type: "file",
        filename: part.filename,
        mime: part.mime,
        url: part.url,
      }
    case "tool":
      return {
        id: part.id,
        type: "tool",
        tool: part.tool,
        callId: part.callID,
        state: mapToolState(part.state),
      }
    case "step-start":
      return { id: part.id, type: "step-start", snapshot: part.snapshot }
    case "step-finish":
      return { id: part.id, type: "step-finish", reason: part.reason, cost: part.cost }
    default:
      return { id: part.id, type: "unknown", partType: part.type }
  }
}

function messageError(info: Message): string | undefined {
  if (info.role !== "assistant" || !info.error) return undefined
  const detail = errorText(info.error)
  return detail === "{}" ? info.error.name : detail
}

function mapMessage(message: { info: Message; parts: Part[] }): AgentMessage {
  return {
    id: message.info.id,
    sessionId: message.info.sessionID,
    role: message.info.role,
    createdAt: message.info.time.created,
    completedAt: message.info.role === "assistant" ? message.info.time.completed : undefined,
    error: messageError(message.info),
    parts: message.parts.map(mapPart),
  }
}

function mapSessionStatus(status: SessionStatus | undefined): AgentSessionStatus {
  if (!status || status.type === "idle") return { type: "idle" }
  if (status.type === "busy") return { type: "busy" }
  return {
    type: "retry",
    attempt: status.attempt,
    message: status.message,
    next: status.next,
  }
}

function mapPermission(request: PermissionRequest): AgentPermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.permission,
    patterns: request.patterns,
    metadata: request.metadata,
    always: request.always,
    tool: request.tool,
  }
}

function mapQuestion(request: QuestionRequest): AgentQuestionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    questions: request.questions.map((question) => ({
      question: question.question,
      header: question.header,
      options: question.options,
      multiple: question.multiple,
      custom: question.custom,
    })),
    tool: request.tool,
  }
}

function inferMime(file: string): string {
  const extension = extname(file).toLowerCase()
  if (textExtensions.has(extension)) return "text/plain"
  return binaryMimeByExtension[extension] ?? "application/octet-stream"
}

function isTextMime(mime: string) {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "application/yaml"
  )
}

async function looksLikeText(file: string) {
  const handle = await open(file, "r")
  try {
    const sample = Buffer.alloc(8 * 1024)
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    return !sample.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

async function inlineMime(file: string, requestedMime: string | undefined, size: number) {
  let mime = (requestedMime ?? inferMime(file)).trim().toLowerCase()
  if (mime === "application/octet-stream" && size <= textFileLimit && (await looksLikeText(file))) mime = "text/plain"

  if (isTextMime(mime)) {
    if (size > textFileLimit) {
      throw new Error(`Text attachment is larger than 5 MB: ${basename(file)}`)
    }
    return "text/plain"
  }
  if (!supportedBinaryMimes.has(mime)) {
    throw new Error(`Unsupported binary attachment type (${mime}): ${basename(file)}`)
  }
  if (size > binaryFileLimit) {
    throw new Error(`Binary attachment is larger than 20 MB: ${basename(file)}`)
  }
  return mime
}

function isOutside(directory: string, file: string): boolean {
  const pathFromRoot = relative(directory, file)
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)
}

function structuredResourcePart(resource: Extract<AgentRuntimeResource, { kind: "resource" }>): FilePartInput {
  const clientName = resource.clientName.trim()
  const uri = resource.uri.trim()
  const mime = resource.mime.trim().toLowerCase()
  const name = resource.name?.trim()
  if (!clientName) throw new Error("Structured resource client name is required")
  if (!uri) throw new Error("Structured resource URI is required")
  if (!mime || /[\r\n,]/.test(mime)) throw new Error("Structured resource MIME type is invalid")
  try {
    new URL(uri)
  } catch {
    throw new Error("Structured resource URI is invalid")
  }
  const size = Buffer.byteLength(resource.content, "utf8")
  if (size > textFileLimit) throw new Error(`Structured resource is larger than 5 MB: ${name || uri}`)
  const label = name || uri
  // The host already resolved this resource. A resource source would make
  // OpenCode ask an MCP server to resolve the same URI again.
  return {
    type: "file",
    mime: "text/plain",
    filename: label,
    url: `data:text/plain;base64,${Buffer.from(resource.content, "utf8").toString("base64")}`,
  }
}

export async function prepareAgentResourceParts(
  directory: string,
  resources: AgentRuntimeResource[],
): Promise<FilePartInput[]> {
  const result: FilePartInput[] = []
  let workspaceRoot: string | undefined

  for (const resource of resources) {
    if (resource.kind === "skill") continue
    if (resource.kind === "resource") {
      result.push(structuredResourcePart(resource))
      continue
    }

    workspaceRoot ??= await realpath(directory)
    const requested = resolve(workspaceRoot, resource.path)
    const absolute = await realpath(requested)
    if (isOutside(workspaceRoot, absolute)) {
      throw new Error(`Resource is outside the workspace directory: ${resource.path}`)
    }

    const info = await stat(absolute)
    if (resource.kind === "directory" && !info.isDirectory()) {
      throw new Error(`Expected a directory resource: ${resource.path}`)
    }
    if (resource.kind !== "directory" && !info.isFile()) {
      throw new Error(`Expected a file resource: ${resource.path}`)
    }

    const pathFromRoot = relative(workspaceRoot, absolute) || "."
    const displayPath = pathFromRoot.split(sep).join("/")
    const sourceText = `@${displayPath}`
    const mime =
      resource.kind === "directory" ? "application/x-directory" : await inlineMime(absolute, resource.mime, info.size)

    result.push({
      type: "file",
      mime,
      filename: resource.name ?? basename(absolute),
      url: pathToFileURL(absolute).href,
      source: {
        type: "file",
        path: displayPath,
        text: {
          value: sourceText,
          start: 0,
          end: sourceText.length,
        },
      },
    })
  }

  return result
}

export class OpenCodeAgentRuntime implements AgentRuntime {
  private readonly controller = new AbortController()
  private readonly options: OpenCodeAgentRuntimeOptions
  private lifecycle: AgentRuntimeStatus = { state: "stopped" }
  private startup?: Promise<OpenCodeClient>
  private client?: OpenCodeClient
  private server?: OpenCodeServer
  private connectionGeneration = 0
  private disposed = false
  private readonly toolServer?: AgentLocalToolServer
  private readonly toolServerName: string
  private readonly toolRegistrations = new Map<string, Promise<void>>()
  private readonly protectedPathRegistrations = new Map<string, Promise<void>>()
  private protectedPathArtifact?: Promise<{ directory: string; marker: string; specifier: string }>
  private activePromptCount = 0
  private skillRefreshRequested = false
  private skillRefreshInFlight?: Promise<void>
  private readonly skillRefreshWaiters: SkillRefreshWaiter[] = []

  constructor(options: OpenCodeAgentRuntimeOptions = {}) {
    const toolServerName = options.toolServerName?.trim() || "host"
    if (!/^[A-Za-z0-9_-]+$/.test(toolServerName)) {
      throw new Error("Tool server name may only contain letters, numbers, underscores, and hyphens")
    }
    this.toolServerName = toolServerName
    const permissionConfig = withProtectedPathPermissions(options.config, options.protectedPathPatterns ?? [])
    const config = withSkillDiscoveryBoundary(permissionConfig)
    const toolCallTimeout = options.toolCallTimeout ?? defaultHostToolCallTimeout
    if (!Number.isSafeInteger(toolCallTimeout) || toolCallTimeout <= 0) {
      throw new Error("Host tool call timeout must be a positive integer")
    }
    if (options.configDirectory !== undefined && !options.configDirectory.trim()) {
      throw new Error("OpenCode config directory is required")
    }
    const configDirectory = options.configDirectory === undefined ? undefined : resolve(options.configDirectory.trim())
    this.options = {
      ...options,
      config,
      configDirectory,
      protectedPaths: normalizeProtectedPaths(options.protectedPaths ?? []),
      toolCallTimeout,
      toolServerName,
    }
    if (options.toolProvider) this.toolServer = new AgentLocalToolServer(options.toolProvider, toolServerName)
  }

  async getStatus(): Promise<AgentRuntimeStatus> {
    return this.lifecycle
  }

  private async enterPrompt() {
    while (this.skillRefreshInFlight) await this.skillRefreshInFlight
    if (this.disposed) throw new Error("OpenCode agent runtime has been disposed")
    this.activePromptCount += 1
  }

  private leavePrompt() {
    this.activePromptCount = Math.max(0, this.activePromptCount - 1)
    if (this.activePromptCount === 0) this.drainSkillRefresh()
  }

  private drainSkillRefresh() {
    if (this.disposed || this.activePromptCount > 0 || this.skillRefreshInFlight || !this.skillRefreshRequested) return

    this.skillRefreshRequested = false
    const waiters = this.skillRefreshWaiters.splice(0)
    const refresh = (async () => {
      try {
        const client = await this.getClient()
        unwrap(await client.global.dispose(), "Refresh OpenCode skills")
      } finally {
        // Global disposal invalidates per-directory instances, including their
        // MCP tool and strong path-guard initialization.
        this.toolRegistrations.clear()
        this.protectedPathRegistrations.clear()
      }
    })()
    this.skillRefreshInFlight = refresh
    void refresh
      .then(
        () => waiters.forEach((waiter) => waiter.resolve()),
        (error) => waiters.forEach((waiter) => waiter.reject(error)),
      )
      .finally(() => {
        if (this.skillRefreshInFlight === refresh) this.skillRefreshInFlight = undefined
        this.drainSkillRefresh()
      })
  }

  /** Rebuild OpenCode's discovered Skills and host-tool connections without replacing durable sessions. */
  refreshCapabilities(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("OpenCode agent runtime has been disposed"))
    this.skillRefreshRequested = true
    const result = new Promise<void>((resolve, reject) => {
      this.skillRefreshWaiters.push({ resolve, reject })
    })
    this.drainSkillRefresh()
    return result
  }

  /** Backward-compatible Skill lifecycle name used by the managed Skill store. */
  refreshSkills(): Promise<void> {
    return this.refreshCapabilities()
  }

  /** Refresh dynamic host tools, but do not launch an otherwise unused OpenCode server. */
  refreshHostTools(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("OpenCode agent runtime has been disposed"))
    this.toolRegistrations.clear()
    if (!this.client && !this.startup && !this.server) return Promise.resolve()
    return this.refreshCapabilities()
  }

  private materializeProtectedPathPlugin() {
    if (this.protectedPathArtifact) return this.protectedPathArtifact
    this.protectedPathArtifact = (async () => {
      const directory = await mkdtemp(join(tmpdir(), "agent-runtime-protected-path-"))
      try {
        const file = join(directory, "plugin.mjs")
        const factory = protectedPathPlugin.toString()
        if (!factory.includes("tool.execute.before")) {
          throw new Error("Protected path plugin could not be serialized")
        }
        await writeFile(file, `export default ${factory}\n`, { encoding: "utf8", mode: 0o600 })
        return {
          directory,
          marker: `.agent-runtime-protected-path-guard-${randomBytes(16).toString("hex")}`,
          specifier: pathToFileURL(file).href,
        }
      } catch (error) {
        await rm(directory, { force: true, recursive: true })
        throw error
      }
    })()
    return this.protectedPathArtifact
  }

  private async serverConfig() {
    const paths = this.options.protectedPaths ?? []
    if (paths.length === 0) return this.options.config
    const plugin = await this.materializeProtectedPathPlugin()
    return withProtectedPathGuard(this.options.config, paths, plugin.specifier, plugin.marker)
  }

  private async getClient(): Promise<OpenCodeClient> {
    if (this.disposed) throw new Error("OpenCode agent runtime has been disposed")
    if (this.client) return this.client
    if (this.startup) return this.startup

    this.lifecycle = { state: "starting" }
    ensurePackageBinaryOnPath(this.options.binaryDirectory)
    const generation = ++this.connectionGeneration
    this.toolRegistrations.clear()
    this.protectedPathRegistrations.clear()
    const username = `agent-runtime-${randomBytes(8).toString("hex")}`
    const password = randomBytes(32).toString("base64url")
    this.startup = (async () => {
      const config = await this.serverConfig()
      const server = await startAuthenticatedServer(
        {
          hostname: this.options.hostname ?? "127.0.0.1",
          port: this.options.port ?? 0,
          timeout: this.options.timeout ?? 10_000,
          config,
          signal: this.controller.signal,
        },
        username,
        password,
        this.options.configDirectory,
      )
      if (this.disposed || generation !== this.connectionGeneration) {
        server.close()
        throw new Error("OpenCode agent runtime was disposed while starting")
      }
      const client = createOpencodeClient({
        baseUrl: server.url,
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        },
        fetch: (async (request: RequestInfo | URL, init?: RequestInit) => {
          if (request instanceof Request) (request as Request & { timeout?: boolean }).timeout = false
          try {
            return await globalThis.fetch(request, init)
          } catch (error) {
            this.invalidateConnection(generation, error)
            throw error
          }
        }) as typeof globalThis.fetch,
      })
      this.client = client
      this.server = server
      this.lifecycle = { state: "ready" }
      return client
    })()
      .catch((error: unknown) => {
        this.lifecycle = this.disposed ? { state: "stopped" } : { state: "error", error: errorText(error) }
        throw error
      })
      .finally(() => {
        this.startup = undefined
      })

    return this.startup
  }

  private ensureProtectedPathGuard(client: OpenCodeClient, directory: string) {
    if ((this.options.protectedPaths?.length ?? 0) === 0) return Promise.resolve()
    const key = JSON.stringify([this.connectionGeneration, directory])
    const existing = this.protectedPathRegistrations.get(key)
    if (existing) return existing
    const registration = (async () => {
      const plugin = await this.materializeProtectedPathPlugin()
      unwrap(await client.tool.ids({ directory }), "Initialize protected path guard")
      const config = unwrap(await client.config.get({ directory }), "Verify protected path guard")
      if (!config.watcher?.ignore?.includes(plugin.marker)) {
        throw new Error("OpenCode did not load the protected path guard; refusing tool execution")
      }
    })()
    this.protectedPathRegistrations.set(key, registration)
    void registration.catch(() => {
      if (this.protectedPathRegistrations.get(key) === registration) this.protectedPathRegistrations.delete(key)
    })
    return registration
  }

  private invalidateConnection(generation: number, error: unknown) {
    if (this.disposed || generation !== this.connectionGeneration) return
    this.connectionGeneration += 1
    const server = this.server
    this.client = undefined
    this.server = undefined
    this.toolRegistrations.clear()
    this.protectedPathRegistrations.clear()
    this.lifecycle = { state: "error", error: `OpenCode connection failed: ${errorText(error)}` }
    try {
      server?.close()
    } catch {
      // The transport is already unusable; the next call will start a fresh server.
    }
  }

  private ensureToolScope(client: OpenCodeClient, directory: string, scopeId?: string) {
    if (!this.toolServer) return Promise.resolve()
    if (!scopeId?.trim()) return Promise.reject(new Error("Agent tool scope is required"))
    const key = JSON.stringify([directory, scopeId])
    const existing = this.toolRegistrations.get(key)
    if (existing) return existing
    const registration = (async () => {
      const endpoint = await this.toolServer!.registerScope({ directory, scopeId })
      const operation = `Register ${this.toolServerName} tools`
      const statuses = unwrap(
        await client.mcp.add({
          config: {
            enabled: true,
            headers: endpoint.headers,
            oauth: false,
            // OpenCode applies this timeout to tools/call and resets it whenever
            // AgentLocalToolServer emits progress. Keep it independent from the
            // child-process startup deadline: host tools may run for hours while
            // still retaining a bounded inactivity/transport failure guard.
            timeout: this.options.toolCallTimeout,
            type: "remote",
            url: endpoint.url,
          },
          directory,
          name: this.toolServerName,
        }),
        operation,
      )
      const status = statuses[this.toolServerName]
      if (status?.status === "failed") throw new Error(`${operation}: ${status.error}`)
    })()
    this.toolRegistrations.set(key, registration)
    void registration.catch(() => {
      if (this.toolRegistrations.get(key) === registration) this.toolRegistrations.delete(key)
    })
    return registration
  }

  async listSessions(input: AgentRuntimeListSessionsInput): Promise<AgentSession[]> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    const sessions = unwrap(
      await client.session.list({ directory, scope: "project", roots: true, limit: input.limit }),
      "List OpenCode sessions",
    )
    return sessions
      .filter((session) => !session.time.archived && isAgentSessionInDirectory(session.directory, directory))
      .map(mapSession)
  }

  async createSession(input: AgentRuntimeCreateSessionInput): Promise<AgentSession> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    await this.ensureProtectedPathGuard(client, directory)
    const session = unwrap(await client.session.create({ directory, title: input.title }), "Create OpenCode session")
    return mapSession(session)
  }

  async getSessionState(input: AgentRuntimeGetSessionStateInput): Promise<AgentSessionState> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    const [sessionResult, statusResult, messagesResult, permissionsResult, questionsResult] = await Promise.all([
      client.session.get({ directory, sessionID: input.sessionId }),
      client.session.status({ directory }),
      client.session.messages({ directory, sessionID: input.sessionId, limit: input.limit }),
      client.permission.list({ directory }),
      client.question.list({ directory }),
    ])

    const session = unwrap(sessionResult, "Get OpenCode session")
    const statuses = unwrap(statusResult, "Get OpenCode session status")
    const messages = unwrap(messagesResult, "Get OpenCode messages")
    const permissions = unwrap(permissionsResult, "List OpenCode permissions")
    const questions = unwrap(questionsResult, "List OpenCode questions")

    return {
      session: mapSession(session),
      status: mapSessionStatus(statuses[input.sessionId]),
      messages: messages.map(mapMessage),
      pendingPermissions: permissions.filter((item) => item.sessionID === input.sessionId).map(mapPermission),
      pendingQuestions: questions.filter((item) => item.sessionID === input.sessionId).map(mapQuestion),
    }
  }

  async prompt(input: AgentRuntimePromptInput): Promise<AgentMessage> {
    const directory = workspaceDirectory(input.directory)
    const resources = input.resources ?? []
    const selectedSkills = resources.filter((item) => item.kind === "skill").map((item) => item.name.trim())
    const instructions = (input.instructions ?? []).map((instruction) => instruction.trim()).filter(Boolean)
    if (selectedSkills.some((name) => !name)) throw new Error("Skill name is required")
    if (!input.text.trim() && resources.every((item) => item.kind === "skill") && selectedSkills.length === 0) {
      throw new Error("A message or resource is required")
    }

    await this.enterPrompt()
    try {
      const client = await this.getClient()
      await this.ensureProtectedPathGuard(client, directory)
      await this.ensureToolScope(client, directory, input.scopeId)
      const attachments = await prepareAgentResourceParts(directory, resources)
      const skills = [...new Set(selectedSkills)].filter(Boolean)

      if (skills.length > 0) {
        const discovered = unwrap(await client.app.skills({ directory }), "List OpenCode skills")
        const available = new Set(discovered.map((skill) => skill.name))
        const missing = skills.filter((skill) => !available.has(skill))
        if (missing.length > 0) throw new Error(`OpenCode skill was not found: ${missing.join(", ")}`)
      }

      const parts: Array<TextPartInput | FilePartInput> = []
      for (const skill of skills) {
        parts.push({
          type: "text",
          synthetic: true,
          text: `Use the skill tool to load the Skill named ${JSON.stringify(skill)} before handling the request.`,
          metadata: { [skillPartMetadataKey]: skill },
        })
      }
      for (const instruction of instructions) {
        parts.push({ type: "text", text: instruction, synthetic: true })
      }
      if (input.text.trim()) parts.push({ type: "text", text: input.text })
      parts.push(...attachments)

      const response = unwrap(
        await client.session.prompt({
          directory,
          sessionID: input.sessionId,
          parts,
          agent: input.agent,
          model: input.model
            ? {
                providerID: input.model.providerId,
                modelID: input.model.modelId,
              }
            : undefined,
          variant: input.variant,
        }),
        "Prompt OpenCode session",
      )
      return mapMessage(response)
    } finally {
      this.leavePrompt()
    }
  }

  async abort(input: AgentRuntimeSessionInput): Promise<void> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    unwrap(await client.session.abort({ directory, sessionID: input.sessionId }), "Abort OpenCode session")
  }

  async listSkills(input: AgentRuntimeDirectoryInput): Promise<AgentSkill[]> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    const skills = unwrap(await client.app.skills({ directory }), "List OpenCode skills")
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location,
    }))
  }

  async listModels(input: AgentRuntimeDirectoryInput): Promise<AgentModelCatalog> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    const catalog = unwrap(await client.provider.list({ directory }), "List OpenCode models")
    const connectedProviderIds = new Set(catalog.connected)

    return {
      providers: catalog.all.map((provider) => {
        const defaultModelId = catalog.default[provider.id]
        return {
          connected: connectedProviderIds.has(provider.id),
          defaultModelId,
          models: Object.values(provider.models).map((model) => ({
            default: model.id === defaultModelId,
            modelId: model.id,
            modelName: model.name,
          })),
          providerId: provider.id,
          providerName: provider.name,
        }
      }),
    }
  }

  async listCapabilities(input: AgentRuntimeDirectoryInput): Promise<AgentCapabilities> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    await this.ensureProtectedPathGuard(client, directory)
    await this.ensureToolScope(client, directory, input.scopeId)
    const [skills, toolsResult] = await Promise.all([this.listSkills({ directory }), client.tool.ids({ directory })])
    const toolIds = unwrap(toolsResult, "List OpenCode tools")
    const visibleToolIds =
      (this.options.protectedPaths?.length ?? 0) > 0
        ? toolIds.filter((tool) => tool !== "bash" && tool !== "shell" && tool !== "lsp")
        : toolIds
    const hostToolIds =
      this.options.toolProvider && input.scopeId
        ? (await this.options.toolProvider.listTools({ directory, scopeId: input.scopeId })).map(
            (tool) => `${this.toolServerName}_${tool.name}`,
          )
        : []
    return {
      skills,
      toolIds: [...new Set([...visibleToolIds, ...hostToolIds])],
    }
  }

  async replyPermission(input: AgentRuntimeReplyPermissionInput): Promise<void> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    unwrap(
      await client.permission.reply({
        directory,
        requestID: input.requestId,
        reply: input.reply,
        message: input.message,
      }),
      "Reply to OpenCode permission",
    )
  }

  async replyQuestion(input: AgentRuntimeReplyQuestionInput): Promise<void> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    unwrap(
      await client.question.reply({ directory, requestID: input.requestId, answers: input.answers }),
      "Reply to OpenCode question",
    )
  }

  async rejectQuestion(input: AgentRuntimeRejectQuestionInput): Promise<void> {
    const directory = workspaceDirectory(input.directory)
    const client = await this.getClient()
    unwrap(await client.question.reject({ directory, requestID: input.requestId }), "Reject OpenCode question")
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const disposalError = new Error("OpenCode agent runtime disposed")
    this.skillRefreshRequested = false
    for (const waiter of this.skillRefreshWaiters.splice(0)) waiter.reject(disposalError)
    this.controller.abort(disposalError)
    await this.startup?.catch(() => undefined)
    this.server?.close()
    this.server = undefined
    this.client = undefined
    this.toolRegistrations.clear()
    this.protectedPathRegistrations.clear()
    await this.toolServer?.close()
    const protectedPathArtifact = await this.protectedPathArtifact?.catch(() => undefined)
    if (protectedPathArtifact) await rm(protectedPathArtifact.directory, { force: true, recursive: true })
    this.lifecycle = { state: "stopped" }
  }
}
