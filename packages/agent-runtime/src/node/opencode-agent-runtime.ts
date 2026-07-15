import { randomBytes } from "node:crypto"
import { open, realpath, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

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
  type ToolState,
} from "@opencode-ai/sdk/v2"

import type {
  AgentCapabilities,
  AgentCanvasContext,
  AgentMessage,
  AgentMessagePart,
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
  AgentToolState,
  AgentToolProvider,
} from "../contracts"
import { AgentLocalToolServer } from "./local-tool-server"

type OpenCodeClient = ReturnType<typeof createOpencodeClient>
type OpenCodeServer = Awaited<ReturnType<typeof createOpencodeServer>>

export interface OpenCodeAgentRuntimeOptions {
  binaryDirectory?: string
  hostname?: string
  port?: number
  timeout?: number
  config?: ServerOptions["config"]
  toolProvider?: AgentToolProvider
}

interface SdkResult<T> {
  data?: T
  error?: unknown
  response?: Response
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
const convaxPrivatePatterns = [".convax", ".convax/**", "**/.convax", "**/.convax/**"] as const

type OpenCodeConfig = NonNullable<ServerOptions["config"]>
type OpenCodePermission = NonNullable<OpenCodeConfig["permission"]>
type OpenCodePermissionObject = Exclude<OpenCodePermission, string>
type OpenCodePermissionRule = NonNullable<OpenCodePermissionObject["read"]>
type OpenCodePermissionAction = Extract<OpenCodePermission, string>

function protectPrivatePattern(rule: OpenCodePermissionRule | undefined, fallback?: OpenCodePermissionAction) {
  const existing = typeof rule === "string"
    ? { "*": rule }
    : rule ?? (fallback ? { "*": fallback } : {})
  const protectedRule: Record<string, OpenCodePermissionAction> = { ...existing }
  for (const pattern of convaxPrivatePatterns) protectedRule[pattern] = "deny"
  return protectedRule
}

/** Merge Convax's private-storage guard without mutating caller-owned config. */
export function withConvaxPrivateStoragePermissions(config?: ServerOptions["config"]): OpenCodeConfig {
  const permission = config?.permission
  if (permission === "deny") return { ...config, permission }
  const fallback = typeof permission === "string" ? permission : undefined
  const existing = typeof permission === "object" && permission ? permission : {}
  return {
    ...config,
    permission: {
      ...(fallback ? { "*": fallback } : {}),
      ...existing,
      edit: protectPrivatePattern(existing.edit, fallback),
      read: protectPrivatePattern(existing.read, fallback),
    },
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

function startAuthenticatedServer(options: ServerOptions, username: string, password: string) {
  const previousUsername = process.env.OPENCODE_SERVER_USERNAME
  const previousPassword = process.env.OPENCODE_SERVER_PASSWORD
  const previousDisableProjectConfig = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
  process.env.OPENCODE_SERVER_USERNAME = username
  process.env.OPENCODE_SERVER_PASSWORD = password
  // Convax owns executable host capabilities through its scoped MCP server. Keep
  // global OpenCode provider/auth config, but do not import executable extensions
  // or instructions from an opened project's .opencode directory.
  process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
  try {
    // createOpencodeServer launches the child synchronously before returning its startup promise,
    // so the child receives the private credentials and project boundary while the parent environment is restored immediately.
    return createOpencodeServer(options)
  } finally {
    restoreEnvironment("OPENCODE_SERVER_USERNAME", previousUsername)
    restoreEnvironment("OPENCODE_SERVER_PASSWORD", previousPassword)
    restoreEnvironment("OPENCODE_DISABLE_PROJECT_CONFIG", previousDisableProjectConfig)
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

function projectDirectory(directory: string): string {
  if (!directory.trim()) throw new Error("Project directory is required")
  return resolve(directory)
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

function mapPart(part: Part): AgentMessagePart {
  switch (part.type) {
    case "text":
      return { id: part.id, type: "text", text: part.text, synthetic: part.synthetic }
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
  return mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/javascript"
    || mime === "application/xml"
    || mime === "application/yaml"
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
  if (mime === "application/octet-stream" && size <= textFileLimit && await looksLikeText(file)) mime = "text/plain"

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

function canvasPart(resource: Extract<AgentRuntimeResource, { kind: "canvas" }>): FilePartInput {
  const size = Buffer.byteLength(resource.content, "utf8")
  if (size > textFileLimit) throw new Error(`Canvas snapshot is larger than 5 MB: ${resource.canvasId}`)
  const label = resource.name?.trim() || resource.canvasId
  return {
    type: "file",
    mime: "application/json",
    filename: `${label}.canvas.json`,
    url: `data:application/json;base64,${Buffer.from(resource.content, "utf8").toString("base64")}`,
  }
}

export async function prepareAgentResourceParts(
  directory: string,
  resources: AgentRuntimeResource[],
): Promise<FilePartInput[]> {
  const result: FilePartInput[] = []
  let projectRoot: string | undefined

  for (const resource of resources) {
    if (resource.kind === "skill") continue
    if (resource.kind === "canvas") {
      result.push(canvasPart(resource))
      continue
    }

    projectRoot ??= await realpath(directory)
    const requested = resolve(projectRoot, resource.path)
    const absolute = await realpath(requested)
    if (isOutside(projectRoot, absolute)) {
      throw new Error(`Resource is outside the project directory: ${resource.path}`)
    }

    const info = await stat(absolute)
    if (resource.kind === "directory" && !info.isDirectory()) {
      throw new Error(`Expected a directory resource: ${resource.path}`)
    }
    if (resource.kind !== "directory" && !info.isFile()) {
      throw new Error(`Expected a file resource: ${resource.path}`)
    }

    const pathFromRoot = relative(projectRoot, absolute) || "."
    const displayPath = pathFromRoot.split(sep).join("/")
    const sourceText = `@${displayPath}`
    const mime = resource.kind === "directory"
      ? "application/x-directory"
      : await inlineMime(absolute, resource.mime, info.size)

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

export function buildCanvasPromptNote(input: {
  activeCanvas?: AgentCanvasContext
  canvasAttached: boolean
  canvasToolsAvailable: boolean
}) {
  const context = input.activeCanvas
    ? [
        "Convax host context (authoritative):",
        `- Active Canvas ID: ${JSON.stringify(input.activeCanvas.canvasId)}`,
        ...(input.activeCanvas.name ? [`- Active Canvas name: ${JSON.stringify(input.activeCanvas.name)}`] : []),
        "When a Convax Canvas tool needs the active canvas, pass exactly this Canvas ID. Do not guess it from the Canvas name, project ID, or view ID.",
      ].join("\n")
    : ""
  const guidance = input.canvasAttached
    ? "Convax Canvas attachments are read-only snapshots. Use Convax Canvas tools for changes, selection, and viewport actions; do not read or edit files under .convax directly."
    : input.canvasToolsAvailable
      ? "Use Convax Canvas tools—not private .convax files—when the request involves a canvas. Prefer business tools; use primitive tools only for precise low-level edits."
      : ""
  return [context, guidance].filter(Boolean).join("\n\n")
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
  private readonly toolRegistrations = new Map<string, Promise<void>>()

  constructor(options: OpenCodeAgentRuntimeOptions = {}) {
    this.options = {
      ...options,
      config: withConvaxPrivateStoragePermissions(options.config),
    }
    if (options.toolProvider) this.toolServer = new AgentLocalToolServer(options.toolProvider)
  }

  async getStatus(): Promise<AgentRuntimeStatus> {
    return this.lifecycle
  }

  private async getClient(): Promise<OpenCodeClient> {
    if (this.disposed) throw new Error("OpenCode agent runtime has been disposed")
    if (this.client) return this.client
    if (this.startup) return this.startup

    this.lifecycle = { state: "starting" }
    ensurePackageBinaryOnPath(this.options.binaryDirectory)
    const generation = ++this.connectionGeneration
    this.toolRegistrations.clear()
    const username = `convax-${randomBytes(8).toString("hex")}`
    const password = randomBytes(32).toString("base64url")
    this.startup = startAuthenticatedServer({
      hostname: this.options.hostname ?? "127.0.0.1",
      port: this.options.port ?? 0,
      timeout: this.options.timeout ?? 10_000,
      config: this.options.config,
      signal: this.controller.signal,
    }, username, password)
      .then((server) => {
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
      })
      .catch((error: unknown) => {
        this.lifecycle = this.disposed ? { state: "stopped" } : { state: "error", error: errorText(error) }
        throw error
      })
      .finally(() => {
        this.startup = undefined
      })

    return this.startup
  }

  private invalidateConnection(generation: number, error: unknown) {
    if (this.disposed || generation !== this.connectionGeneration) return
    this.connectionGeneration += 1
    const server = this.server
    this.client = undefined
    this.server = undefined
    this.toolRegistrations.clear()
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
      const statuses = unwrap(await client.mcp.add({
        config: {
          enabled: true,
          headers: endpoint.headers,
          oauth: false,
          timeout: this.options.timeout ?? 10_000,
          type: "remote",
          url: endpoint.url,
        },
        directory,
        name: "convax",
      }), "Register Convax tools")
      const status = statuses.convax
      if (status?.status === "failed") throw new Error(`Register Convax tools: ${status.error}`)
    })()
    this.toolRegistrations.set(key, registration)
    void registration.catch(() => {
      if (this.toolRegistrations.get(key) === registration) this.toolRegistrations.delete(key)
    })
    return registration
  }

  async listSessions(input: AgentRuntimeListSessionsInput): Promise<AgentSession[]> {
    const directory = projectDirectory(input.directory)
    const client = await this.getClient()
    const sessions = unwrap(
      await client.session.list({ directory, scope: "project", roots: true, limit: input.limit }),
      "List OpenCode sessions",
    )
    return sessions.filter((session) => !session.time.archived).map(mapSession)
  }

  async createSession(input: AgentRuntimeCreateSessionInput): Promise<AgentSession> {
    const directory = projectDirectory(input.directory)
    const client = await this.getClient()
    const session = unwrap(await client.session.create({ directory, title: input.title }), "Create OpenCode session")
    return mapSession(session)
  }

  async getSessionState(input: AgentRuntimeGetSessionStateInput): Promise<AgentSessionState> {
    const directory = projectDirectory(input.directory)
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
    const directory = projectDirectory(input.directory)
    const resources = input.resources ?? []
    const selectedSkills = resources.filter((item) => item.kind === "skill").map((item) => item.name.trim())
    if (selectedSkills.some((name) => !name)) throw new Error("Skill name is required")
    if (!input.text.trim() && resources.every((item) => item.kind === "skill") && selectedSkills.length === 0) {
      throw new Error("A message or resource is required")
    }

    const client = await this.getClient()
    await this.ensureToolScope(client, directory, input.scopeId)
    const attachments = await prepareAgentResourceParts(directory, resources)
    const skills = [...new Set(selectedSkills)].filter(Boolean)
    const canvasNote = buildCanvasPromptNote({
      activeCanvas: input.activeCanvas,
      canvasAttached: resources.some((item) => item.kind === "canvas"),
      canvasToolsAvailable: Boolean(this.toolServer),
    })

    let useSkillTool = skills.length > 1
    if (skills.length === 1) {
      const commands = unwrap(await client.command.list({ directory }), "List OpenCode commands")
      const matchingCommand = commands.find((command) => command.name === skills[0])
      useSkillTool = matchingCommand !== undefined && matchingCommand.source !== "skill"

      if (!useSkillTool) {
        const response = unwrap(
          await client.session.command({
            directory,
            sessionID: input.sessionId,
            command: skills[0],
            arguments: [input.text, canvasNote].filter(Boolean).join("\n\n"),
            parts: attachments,
            agent: input.agent,
            model: input.model ? `${input.model.providerId}/${input.model.modelId}` : undefined,
            variant: input.variant,
          }),
          `Run OpenCode skill ${skills[0]}`,
        )
        return mapMessage(response)
      }
    }

    const parts: Array<{ type: "text"; text: string; synthetic?: boolean } | FilePartInput> = []
    if (useSkillTool) {
      parts.push({
        type: "text",
        synthetic: true,
        text: `Use the skill tool to load each of these skills before handling the request: ${skills.join(", ")}.`,
      })
    }
    if (canvasNote) parts.push({ type: "text", text: canvasNote, synthetic: true })
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
  }

  async abort(input: AgentRuntimeSessionInput): Promise<void> {
    const directory = projectDirectory(input.directory)
    const client = await this.getClient()
    unwrap(await client.session.abort({ directory, sessionID: input.sessionId }), "Abort OpenCode session")
  }

  async listCapabilities(input: AgentRuntimeDirectoryInput): Promise<AgentCapabilities> {
    const directory = projectDirectory(input.directory)
    const client = await this.getClient()
    await this.ensureToolScope(client, directory, input.scopeId)
    const [skillsResult, toolsResult] = await Promise.all([
      client.app.skills({ directory }),
      client.tool.ids({ directory }),
    ])
    const skills = unwrap(skillsResult, "List OpenCode skills")
    const toolIds = unwrap(toolsResult, "List OpenCode tools")
    const hostToolIds = this.options.toolProvider && input.scopeId
      ? (await this.options.toolProvider.listTools({ directory, scopeId: input.scopeId })).map((tool) => `convax_${tool.name}`)
      : []
    return {
      skills: skills.map((skill) => ({ name: skill.name, description: skill.description })),
      toolIds: [...new Set([...toolIds, ...hostToolIds])],
    }
  }

  async replyPermission(input: AgentRuntimeReplyPermissionInput): Promise<void> {
    const directory = projectDirectory(input.directory)
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
    const directory = projectDirectory(input.directory)
    const client = await this.getClient()
    unwrap(
      await client.question.reply({ directory, requestID: input.requestId, answers: input.answers }),
      "Reply to OpenCode question",
    )
  }

  async rejectQuestion(input: AgentRuntimeRejectQuestionInput): Promise<void> {
    const directory = projectDirectory(input.directory)
    const client = await this.getClient()
    unwrap(
      await client.question.reject({ directory, requestID: input.requestId }),
      "Reject OpenCode question",
    )
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort(new Error("OpenCode agent runtime disposed"))
    await this.startup?.catch(() => undefined)
    this.server?.close()
    this.server = undefined
    this.client = undefined
    this.toolRegistrations.clear()
    await this.toolServer?.close()
    this.lifecycle = { state: "stopped" }
  }
}
