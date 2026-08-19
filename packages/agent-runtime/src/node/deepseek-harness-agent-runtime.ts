import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { type Context } from "@deepseek-ai/cordis"
import { boot, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot"
import { CredentialProvider, type CredentialInfo, type CredentialRef } from "@deepseek-ai/dsh-credentials"
import {
  createApiProxy,
  InProcessApiClient,
  RpcId,
  toFetchHandler,
  type ApiProxy,
  type ClientResponse,
  type HostFrame,
  type MuxFrame,
  type PromptContentPart,
  type RpcError,
  type RpcResponse,
} from "@deepseek-ai/dsh-host-apiproxy"
import type { Message } from "@deepseek-ai/dsh-llm/types"
import { deriveEventMessage, foldSurface } from "@deepseek-ai/dsh-session/surface"
import type { SessionEvent } from "@deepseek-ai/dsh-session/types"

import {
  type AgentCapabilities,
  type AgentMessage,
  type AgentMessagePart,
  type AgentModelCatalog,
  type AgentPermissionRequest,
  type AgentQuestionRequest,
  type AgentRuntime,
  type AgentRuntimeCreateSessionInput,
  type AgentRuntimeDirectoryInput,
  type AgentRuntimeGetSessionStateInput,
  type AgentRuntimeListSessionsInput,
  type AgentRuntimePromptInput,
  type AgentRuntimeRejectQuestionInput,
  type AgentRuntimeReplyPermissionInput,
  type AgentRuntimeReplyQuestionInput,
  type AgentRuntimeSessionInput,
  type AgentRuntimeStatus,
  type AgentSession,
  type AgentSessionState,
  type AgentToolProvider,
} from "../contracts"
import { AgentLocalToolServer } from "./local-tool-server"
import { ManagedAgentSkillStore } from "./managed-skill-store"

export interface AgentRuntimeProfileConfig {
  description?: string
  prompt: string
}

export interface DeepSeekHarnessProviderConfig {
  models: Readonly<Record<string, { name?: string }>>
  name: string
  options: {
    apiKey: string
    baseURL: string
  }
}

export interface AgentRemoteMcpOAuthConfig {
  callbackPort?: number
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scope?: string
}

export interface AgentRemoteMcpServerConfig {
  enabled?: boolean
  headers?: Readonly<Record<string, string>>
  networkBoundary: "host-authenticated-loopback" | "host-validated-https"
  oauth?: AgentRemoteMcpOAuthConfig | false
  timeout?: number
  type: "remote"
  url: string
}

export interface AgentHookModule {
  /** Legacy immutable hook location retained only so the DSH cutover can reject it explicitly. */
  readonly fileUrl: string
}

export interface AgentPluginConfiguration {
  readonly hookModules?: readonly AgentHookModule[]
  readonly mcpServers?: Readonly<Record<string, AgentRemoteMcpServerConfig>>
  readonly skillPaths?: readonly string[]
}

export type AgentMcpServerStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

export interface DeepSeekHarnessAgentRuntimeOptions {
  configDirectory: string
  /** Optional packaged node_modules root used by Cordis Loader inside a utility process. */
  moduleDirectory?: string
  /** Project-scoped persona content composed into DSH's official persona Plugin. */
  persona?: string
  /** Desktop authorization policy composed as a generic DSH tools/pre-execute Plugin. */
  approvalRequiredToolPrefixes?: readonly string[]
  resolveAgentProfiles?: () => Promise<Readonly<Record<string, AgentRuntimeProfileConfig>>>
  /** Legacy executable hooks are rejected until a DSH-native Hook ABI is admitted. */
  resolveHookModules?: () => Promise<ReadonlyArray<{ fileUrl: string }>>
  resolveMcpServers?: () => Promise<Readonly<Record<string, AgentRemoteMcpServerConfig>>>
  resolveProviders?: () => Promise<Readonly<Record<string, DeepSeekHarnessProviderConfig>>>
  /** Host-resolved Plugin Skill directories mounted into this Project runtime. */
  skillDirectories?: readonly string[]
  protectedPathPatterns?: readonly string[]
  protectedPaths?: readonly string[]
  toolCallTimeout?: number
  toolProvider?: AgentToolProvider
  toolServerName?: string
}

interface RuntimeHost {
  api: ApiProxy
  client: InProcessApiClient
  context: Context
}

interface PendingApproval {
  approvalId: string
  request: AgentPermissionRequest
  rpcId: string
}

interface PendingQuestion {
  request: AgentQuestionRequest
  rpcId: string
  source: MuxFrame & { type: "question/requested" }
}

interface TurnWaiter {
  reject(error: unknown): void
  resolve(): void
}

const sourceRequire = createRequire(import.meta.url)
const disabledAgentPlaneRows = [
  "tool-bash",
  "tool-pwsh",
  "tool-jobs",
  "tool-fs",
  "tool-fs-search",
  "tool-str-replace-editor",
  "skill-filesystem",
  "tool-skill",
  "tool-goal",
  "plan-mode",
  "compaction-basic",
  "command-compact",
  "tool-result-pruner",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
  "workflow-worker-thread",
  "tool-workflow",
  "tool-ralph",
  "agent-instructions",
  "tool-todo",
  "tool-web",
] as const
const maxPromptResourceBytes = 8 * 1024 * 1024
const maxPromptFileBytes = 5 * 1024 * 1024
const imageMimes = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
])

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function unwrap<T>(response: RpcResponse<T>, operation: string): T {
  if (response.result.ok) return response.result.value
  throw rpcError(operation, response.result.error)
}

function rpcError(operation: string, error: RpcError) {
  const failure = new Error(`${operation}: ${error.message}`)
  Object.assign(failure, { code: error.code, details: error.details })
  return failure
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizedDirectory(value: string) {
  if (!value.trim()) throw new Error("Agent runtime directory is required")
  return resolve(value)
}

function presetId(directory: string, scopeId: string) {
  return `convax-${sha256(`${directory}\0${scopeId}`).slice(0, 24)}`
}

function providerCredentialRef(providerId: string) {
  return `CONVAX_DSH_PROVIDER_${sha256(providerId).slice(0, 24).toUpperCase()}`
}

function providerConfig(providers: Readonly<Record<string, DeepSeekHarnessProviderConfig>>) {
  return Object.fromEntries(
    Object.entries(providers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, provider]) => [
        id,
        {
          api: "openai-completions",
          apiKeyEnv: providerCredentialRef(id),
          baseURL: provider.options.baseURL,
          displayName: provider.name,
          models: Object.entries(provider.models)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([modelId, model]) => ({ id: modelId, name: model.name ?? modelId })),
        },
      ]),
  )
}

function defaultModel(providers: Readonly<Record<string, DeepSeekHarnessProviderConfig>>) {
  for (const [provider, config] of Object.entries(providers).sort(([left], [right]) => left.localeCompare(right))) {
    const model = Object.keys(config.models).sort()[0]
    if (model) return { model, provider }
  }
  return { model: "unconfigured", provider: "unconfigured" }
}

class HostCredentialProvider extends CredentialProvider {
  constructor(
    ctx: Context,
    private readonly values: Map<string, string>,
  ) {
    super(ctx)
  }

  async resolve(ref: CredentialRef) {
    const value = this.values.get(String(ref))
    return value ? { source: "convax-host", value } : undefined
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: this.values.has(String(ref)), source: "convax-host", writable: false }
  }

  async set(): Promise<void> {
    throw new Error("Host-injected provider credentials are read-only")
  }

  async unset(): Promise<void> {
    throw new Error("Host-injected provider credentials are read-only")
  }
}

function blockParts(message: Message, event: SessionEvent): AgentMessagePart[] {
  const parts: AgentMessagePart[] = []
  let index = 0
  for (const block of message.content) {
    const id = `${message.id}:${index++}`
    if (block.type === "text") parts.push({ id, text: block.text, type: "text" })
    else if (block.type === "reasoning") parts.push({ id, text: block.text, type: "reasoning" })
    else if (block.type === "image") {
      parts.push({
        id,
        mime: block.attachment.mediaType,
        type: "file",
        url: `dsh-attachment:${block.attachment.attachmentId}`,
      })
    } else if (block.type === "tool-call") {
      let input: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(block.arguments) as unknown
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>
      } catch {
        input = { raw: block.arguments }
      }
      parts.push({ callId: block.id, id, state: { input, status: "running" }, tool: block.name, type: "tool" })
    } else {
      parts.push({ id, partType: block.type, type: "unknown" })
    }
  }
  if (event.type === "assistant/message") {
    parts.push({ cost: 0, id: `${message.id}:finish`, reason: "completed", type: "step-finish" })
  }
  return parts
}

function mapMessages(events: readonly SessionEvent[], sessionId: string): AgentMessage[] {
  const surface = new Set(foldSurface(events).nodes)
  const messages: AgentMessage[] = []
  for (const event of events) {
    if (!surface.has(event.seq)) continue
    const message = deriveEventMessage(event)
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue
    if (message.role === "user" && message.source.kind !== "user") continue
    messages.push({
      createdAt: event.time,
      id: String(message.id),
      parts: blockParts(message, event),
      role: message.role,
      sessionId,
    })
  }
  return messages
}

function sessionTitle(events: readonly SessionEvent[], fallback: string) {
  const title = [...events].reverse().find((event) => event.type === "session/title") as
    | (SessionEvent & { data: { title?: unknown } })
    | undefined
  return typeof title?.data.title === "string" && title.data.title.trim() ? title.data.title : fallback
}

function latestTurnReason(events: readonly SessionEvent[]) {
  const event = [...events].reverse().find((candidate) => candidate.type === "turn/end")
  if (!event || event.type !== "turn/end") return undefined
  const reason = event.data.reason
  if (reason.kind === "completed") return undefined
  if ("failure" in reason && reason.failure && typeof reason.failure === "object" && "message" in reason.failure) {
    return String(reason.failure.message)
  }
  return `Agent turn ended: ${reason.kind}`
}

function findLastAssistant(messages: readonly AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") return message
  }
  return undefined
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  const staging = `${path}.${randomUUID()}.tmp`
  await writeFile(staging, content, { encoding: "utf8", flag: "wx" })
  try {
    await rename(staging, path)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

function validateRemoteMcp(name: string, config: AgentRemoteMcpServerConfig) {
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name)) throw new Error(`Invalid MCP server name: ${name}`)
  if (config.type !== "remote") throw new Error(`DSH supports only remote MCP configuration: ${name}`)
  const url = new URL(config.url)
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  if (!loopback && url.protocol !== "https:")
    throw new Error(`MCP server must use HTTPS or exact loopback HTTP: ${name}`)
  if (loopback !== (config.networkBoundary === "host-authenticated-loopback")) {
    throw new Error(`MCP server URL does not match its validated transport boundary: ${name}`)
  }
  if (!loopback) {
    throw new Error(`Remote MCP requires a DSH-native guarded HTTPS transport: ${name}`)
  }
  if (config.oauth !== false) throw new Error(`MCP OAuth is unavailable in the current DSH release: ${name}`)
  return {
    failOnStartupError: true,
    headers: { ...config.headers },
    serverName: name,
    toolCallTimeoutMs: config.timeout ?? 60_000,
    transport: "streamable-http",
    url: url.toString(),
  }
}

export class DeepSeekHarnessAgentRuntime implements AgentRuntime {
  private readonly configDirectory: string
  private readonly presetRoot: string
  private readonly rootConfig: string
  private readonly moduleRequire: NodeJS.Require
  private readonly skillStore: ManagedAgentSkillStore
  private readonly credentials = new Map<string, string>()
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly questions = new Map<string, PendingQuestion>()
  private readonly turnWaiters = new Map<string, Set<TurnWaiter>>()
  private readonly agentErrors = new Map<string, string>()
  private readonly eventAbort = new AbortController()
  private readonly toolServer?: AgentLocalToolServer
  private host?: RuntimeHost
  private eventReady?: Promise<void>
  private startup?: Promise<RuntimeHost>
  private status: AgentRuntimeStatus = { state: "stopped" }
  private disposed = false
  private currentProviders: Readonly<Record<string, DeepSeekHarnessProviderConfig>> = {}
  private currentMcpServers: Readonly<Record<string, AgentRemoteMcpServerConfig>> = {}
  private currentProfiles: Readonly<Record<string, AgentRuntimeProfileConfig>> = {}

  constructor(private readonly options: DeepSeekHarnessAgentRuntimeOptions) {
    this.configDirectory = normalizedDirectory(options.configDirectory)
    this.presetRoot = join(this.configDirectory, "presets")
    this.rootConfig = join(this.configDirectory, "runtime", "cordis.yml")
    this.moduleRequire = options.moduleDirectory
      ? createRequire(join(resolve(options.moduleDirectory), "package.json"))
      : sourceRequire
    this.skillStore = new ManagedAgentSkillStore(this.configDirectory)
    if (options.toolProvider) {
      this.toolServer = new AgentLocalToolServer(options.toolProvider, options.toolServerName ?? "convax")
    }
  }

  private async ensureHost() {
    if (this.disposed) throw new Error("DeepSeek Harness agent runtime has been disposed")
    if (this.host) return this.host
    this.startup ??= this.start()
    return this.startup
  }

  private async start(): Promise<RuntimeHost> {
    this.status = { state: "starting" }
    try {
      await mkdir(this.configDirectory, { recursive: true })
      await atomicWrite(this.rootConfig, "[]\n")
      await this.resolveConfiguration()
      const patches = [
        ...loadOverlayPatches("convax-dsh", this.moduleRequire.resolve("@deepseek-ai/dsh-base/cordis.patch.yml")),
        ...disabledAgentPlaneRows.map((id) => ({ disabled: true, id })),
        { disabled: true, id: "hmr" },
        { disabled: true, id: "credentials" },
        { disabled: true, id: "llm-deepseek" },
        { config: { dshHome: this.configDirectory, watch: false }, id: "settings" },
        { config: { dshHome: this.configDirectory }, id: "attachment-local" },
        { config: { root: join(this.configDirectory, "sessions") }, id: "session-persistence-jsonl" },
        { config: { mode: "read-only", workspaceRoot: this.configDirectory }, id: "sandbox-policy" },
        { config: { providers: providerConfig(this.currentProviders) }, id: "llm-pi-ai" },
        { config: defaultModel(this.currentProviders), id: "agent-default-model" },
        {
          insert: [
            {
              config: {
                default: "convax-unconfigured",
                includeUserRoot: false,
                roots: [{ path: this.presetRoot, trust: "system" }],
              },
              id: "agent-presets",
              name: "@deepseek-ai/dsh-agent-presets",
            },
          ],
        },
      ]
      const context = await boot(
        "convax-dsh",
        this.rootConfig,
        patches,
        (ctx) => {
          void new HostCredentialProvider(ctx, this.credentials)
        },
        this.moduleRequire.resolve("@deepseek-ai/dsh-base/package.json"),
      )
      // Agent Presets intentionally resolve their official plugin rows from
      // the installed DSH bundle rather than from the writable Project preset.
      context.baseUrl = `${pathToFileURL(dirname(this.moduleRequire.resolve("@deepseek-ai/dsh-base/package.json"))).href}/`
      const api = createApiProxy(context, {
        cwd: this.configDirectory,
        defaultModelSelection: () => defaultModel(this.currentProviders),
      })
      const host = { api, client: new InProcessApiClient(toFetchHandler(api)), context }
      this.host = host
      this.status = { state: "ready" }
      this.startEventPumps(host.client)
      return host
    } catch (error) {
      this.status = { error: errorText(error), state: "error" }
      this.startup = undefined
      throw error
    }
  }

  private async resolveConfiguration() {
    const providers: Readonly<Record<string, DeepSeekHarnessProviderConfig>> = this.options.resolveProviders
      ? await this.options.resolveProviders()
      : {}
    const mcpServers: Readonly<Record<string, AgentRemoteMcpServerConfig>> = this.options.resolveMcpServers
      ? await this.options.resolveMcpServers()
      : {}
    const profiles: Readonly<Record<string, AgentRuntimeProfileConfig>> = this.options.resolveAgentProfiles
      ? await this.options.resolveAgentProfiles()
      : {}
    const hooks = this.options.resolveHookModules ? await this.options.resolveHookModules() : []
    if (hooks.length > 0) {
      throw new Error("Installed OpenCode Hook modules are not compatible with the DSH runtime and were rejected")
    }
    this.currentProviders = providers
    this.currentMcpServers = mcpServers
    this.currentProfiles = profiles
    this.credentials.clear()
    for (const [id, provider] of Object.entries(providers)) {
      this.credentials.set(providerCredentialRef(id), provider.options.apiKey)
    }
  }

  private startEventPumps(client: InProcessApiClient) {
    let resolveReady!: () => void
    let rejectReady!: (error: unknown) => void
    this.eventReady = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void this.consumeMux(client, resolveReady).catch((error) => {
      rejectReady(error)
      if (!this.eventAbort.signal.aborted) console.warn("DSH mux event stream failed", error)
    })
  }

  private async consumeMux(client: InProcessApiClient, onOpen: () => void) {
    for await (const envelope of client.events.mux({}, this.eventAbort.signal, onOpen)) {
      const frame = envelope.payload
      if (frame.type === "approval/requested") {
        this.approvals.set(String(envelope.rpcId), {
          approvalId: String(frame.approvalId),
          request: {
            always: [],
            id: String(envelope.rpcId),
            metadata: frame.reason ? { reason: frame.reason } : {},
            patterns: [],
            permission: frame.toolName,
            sessionID: String(frame.sessionId),
            ...(frame.callId ? { tool: { callID: String(frame.callId), messageID: "" } } : {}),
          },
          rpcId: String(envelope.rpcId),
        })
      } else if (frame.type === "approval/resolved") {
        for (const [id, pending] of this.approvals) {
          if (pending.approvalId === String(frame.approvalId)) this.approvals.delete(id)
        }
      } else if (frame.type === "question/requested") {
        this.questions.set(String(envelope.rpcId), {
          request: {
            id: String(envelope.rpcId),
            questions: frame.questions.map((question) => ({
              custom: question.options === undefined,
              header: question.header ?? "Question",
              multiple: question.multiSelect,
              options: (question.options ?? []).map((option) => ({
                description: option.description ?? "",
                label: option.label,
              })),
              question: question.detail ? `${question.question}\n${question.detail}` : question.question,
            })),
            sessionID: String(frame.sessionId),
          },
          rpcId: String(envelope.rpcId),
          source: frame,
        })
      } else if (frame.type === "question/resolved") {
        this.questions.delete(String(frame.questionRpcId))
      } else if (frame.type === "session/event" && frame.event.type === "turn/end") {
        this.resolveTurnWaiters(String(frame.sessionId))
      }
    }
  }

  private async consumeHost(client: InProcessApiClient) {
    for await (const envelope of client.events.host({}, this.eventAbort.signal)) {
      const frame: HostFrame = envelope.payload
      if (frame.type === "host/agent-error") {
        this.agentErrors.set(String(frame.sessionId), frame.message)
        this.rejectTurnWaiters(String(frame.sessionId), new Error(frame.message))
      } else if (frame.type === "host/session-removed") {
        this.agentErrors.delete(String(frame.sessionId))
        this.rejectTurnWaiters(String(frame.sessionId), new Error("Agent session was removed"))
      }
    }
  }

  private resolveTurnWaiters(sessionId: string) {
    const waiters = this.turnWaiters.get(sessionId)
    if (!waiters) return
    this.turnWaiters.delete(sessionId)
    for (const waiter of waiters) waiter.resolve()
  }

  private rejectTurnWaiters(sessionId: string, error: unknown) {
    const waiters = this.turnWaiters.get(sessionId)
    if (!waiters) return
    this.turnWaiters.delete(sessionId)
    for (const waiter of waiters) waiter.reject(error)
  }

  private waitForTurn(sessionId: string, signal?: AbortSignal) {
    return new Promise<void>((resolveWaiter, rejectWaiter) => {
      const waiters = this.turnWaiters.get(sessionId) ?? new Set<TurnWaiter>()
      const waiter: TurnWaiter = { reject: rejectWaiter, resolve: resolveWaiter }
      waiters.add(waiter)
      this.turnWaiters.set(sessionId, waiters)
      const abort = () => {
        waiters.delete(waiter)
        if (waiters.size === 0) this.turnWaiters.delete(sessionId)
        rejectWaiter(signal?.reason ?? new Error("Agent prompt was cancelled"))
      }
      if (signal?.aborted) abort()
      else signal?.addEventListener("abort", abort, { once: true })
    })
  }

  private async ensurePreset(directory: string, scopeId: string) {
    const id = presetId(directory, scopeId)
    const rows: Array<Record<string, unknown>> = [
      {
        id: "persona",
        name: this.officialPlugin("@deepseek-ai/dsh-persona"),
        config: {
          text:
            this.options.persona ??
            "You are Convax's project-scoped assistant. Use only the tools and Skills exposed by the authenticated host for the current Project.",
        },
      },
      {
        id: "skill-filesystem",
        name: this.officialPlugin("@deepseek-ai/dsh-skill-filesystem"),
        config: {
          customSkillDirs: [
            ...new Set(
              [...(this.options.skillDirectories ?? []), this.skillStore.userDirectory].map(normalizedDirectory),
            ),
          ],
          includeDefaultRoots: false,
          watch: true,
        },
      },
      { id: "tool-skill", name: this.officialPlugin("@deepseek-ai/dsh-tool-skill") },
    ]
    if (this.options.approvalRequiredToolPrefixes?.length) {
      const pluginDirectory = this.options.moduleDirectory
        ? join(resolve(this.options.moduleDirectory), "@convax", "agent-runtime", "dist", "node")
        : dirname(fileURLToPath(import.meta.url))
      rows.push({
        config: { prefixes: [...this.options.approvalRequiredToolPrefixes] },
        id: "convax-tool-approval-policy",
        name: pathToFileURL(join(pluginDirectory, "project-tool-approval-plugin.js")).href,
      })
    }
    if (this.toolServer) {
      const registration = await this.toolServer.registerScope({ directory, scopeId })
      rows.push({
        id: "mcp-convax",
        name: this.officialPlugin("@deepseek-ai/dsh-mcp-client"),
        config: {
          failOnStartupError: true,
          headers: registration.headers,
          serverName: "convax",
          toolCallTimeoutMs: this.options.toolCallTimeout ?? 60_000,
          transport: "streamable-http",
          url: registration.url,
        },
      })
    }
    for (const [name, config] of Object.entries(this.currentMcpServers).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (config.enabled === false) continue
      rows.push({
        id: `mcp-${name}`,
        name: this.officialPlugin("@deepseek-ai/dsh-mcp-client"),
        config: validateRemoteMcp(name, config),
      })
    }
    await atomicWrite(join(this.presetRoot, id, "agent.cordis.yml"), `${JSON.stringify(rows, null, 2)}\n`)
    return id
  }

  private officialPlugin(packageName: string) {
    return pathToFileURL(this.moduleRequire.resolve(packageName)).href
  }

  async getStatus(): Promise<AgentRuntimeStatus> {
    if (this.status.state === "stopped" && !this.disposed) {
      try {
        await this.ensureHost()
      } catch {
        // status already contains the startup diagnostic.
      }
    }
    return { ...this.status }
  }

  async listSkills(
    _input?: AgentRuntimeDirectoryInput,
  ): Promise<{ name: string; description?: string; location?: string }[]> {
    return (await this.skillStore.list()).map((skill) => ({
      description: skill.description,
      location: skill.skillFile,
      name: skill.name,
    }))
  }

  private async summaries(directory: string) {
    const { client } = await this.ensureHost()
    const listed = unwrap(await client.sessions.list({}), "List DSH sessions")
    return listed.items.filter((item) => item.cwd === directory)
  }

  async listSessions(input: AgentRuntimeListSessionsInput): Promise<AgentSession[]> {
    const directory = normalizedDirectory(input.directory)
    const items = await this.summaries(directory)
    const limited = input.limit === undefined ? items : items.slice(0, Math.max(0, input.limit))
    return Promise.all(limited.map((item) => this.mapSession(directory, String(item.sessionId), item.updatedAt)))
  }

  private async mapSession(directory: string, sessionId: string, updatedAt?: number): Promise<AgentSession> {
    const { client } = await this.ensureHost()
    const history = unwrap(
      await client.sessions.history({ maxMessages: 1, sessionId: sessionId as never }),
      "Read DSH session title",
    )
    const createdAt = history.events[0]?.event.time ?? updatedAt ?? Date.now()
    const lastEventAt = history.events.at(-1)?.event.time ?? createdAt
    return {
      createdAt,
      directory,
      id: sessionId,
      title: sessionTitle(
        history.events.map((entry) => entry.event),
        "New session",
      ),
      updatedAt: Math.max(updatedAt ?? 0, lastEventAt),
    }
  }

  async createSession(input: AgentRuntimeCreateSessionInput): Promise<AgentSession> {
    const directory = normalizedDirectory(input.directory)
    const { client } = await this.ensureHost()
    const preset = await this.ensurePreset(directory, directory)
    const created = unwrap(await client.sessions.create({ agentPreset: preset, cwd: directory }), "Create DSH session")
    if (input.title?.trim()) {
      unwrap(
        await client.sessions.rename({ sessionId: created.sessionId, title: input.title.trim() }),
        "Name DSH session",
      )
    }
    return this.mapSession(directory, String(created.sessionId))
  }

  /** Utility-process boot seam: exposes only DSH's official fetch-shaped Host control plane. */
  async openProjectHost(input: { directory: string; scopeId: string }) {
    const directory = normalizedDirectory(input.directory)
    const { api } = await this.ensureHost()
    const agentPreset = await this.ensurePreset(directory, input.scopeId)
    return { agentPreset, fetch: toFetchHandler(api).fetch }
  }

  async getSessionState(input: AgentRuntimeGetSessionStateInput): Promise<AgentSessionState> {
    const directory = normalizedDirectory(input.directory)
    const { client } = await this.ensureHost()
    const history = unwrap(
      await client.sessions.history({
        ...(input.limit === undefined ? {} : { maxMessages: input.limit }),
        sessionId: input.sessionId as never,
      }),
      "Read DSH session",
    )
    const events = history.events.map((entry) => entry.event)
    const summary = (await this.summaries(directory)).find((item) => String(item.sessionId) === input.sessionId)
    if (!summary) throw new Error(`DSH session is outside the requested Project: ${input.sessionId}`)
    const messages = mapMessages(events, input.sessionId)
    const error = this.agentErrors.get(input.sessionId) ?? latestTurnReason(events)
    if (error) {
      const last = findLastAssistant(messages)
      if (last) last.error = error
    }
    return {
      messages,
      pendingPermissions: [...this.approvals.values()]
        .map((pending) => pending.request)
        .filter((request) => request.sessionID === input.sessionId),
      pendingQuestions: [...this.questions.values()]
        .map((pending) => pending.request)
        .filter((request) => request.sessionID === input.sessionId),
      session: await this.mapSession(directory, input.sessionId, summary.updatedAt),
      status: summary.running ? { type: "busy" } : { type: "idle" },
    }
  }

  private profileInstructions(input: AgentRuntimePromptInput) {
    const instructions = [...(input.instructions ?? [])]
    if (input.agent) {
      const profile = this.currentProfiles[input.agent]
      if (!profile) throw new Error(`Unknown Agent Profile: ${input.agent}`)
      instructions.unshift(profile.prompt)
    }
    return instructions
  }

  private async promptContent(input: AgentRuntimePromptInput) {
    const content: PromptContentPart[] = []
    const context: string[] = [...this.profileInstructions(input)]
    const skills: string[] = []
    let resourceBytes = 0
    for (const resource of input.resources ?? []) {
      if (resource.kind === "skill") {
        skills.push(resource.name)
        continue
      }
      if (resource.kind === "resource") {
        resourceBytes += Buffer.byteLength(resource.content, "utf8")
        if (resourceBytes > maxPromptResourceBytes) throw new Error("Agent resources exceed the prompt byte limit")
        context.push(
          `<convax_resource uri=${JSON.stringify(resource.uri)} mime=${JSON.stringify(resource.mime)} client=${JSON.stringify(resource.clientName)}>\n${resource.content}\n</convax_resource>`,
        )
        continue
      }
      if (resource.kind === "directory") {
        this.assertUnprotectedPath(resource.path)
        context.push(
          `The host attached directory ${JSON.stringify(resource.name ?? basename(resource.path))} at ${resource.path}.`,
        )
        continue
      }
      const path = resolve(resource.path)
      this.assertUnprotectedPath(path)
      const bytes = await readFile(path)
      if (bytes.byteLength > maxPromptFileBytes) throw new Error(`Agent file resource is too large: ${path}`)
      resourceBytes += bytes.byteLength
      if (resourceBytes > maxPromptResourceBytes) throw new Error("Agent resources exceed the prompt byte limit")
      const mime = resource.mime ?? imageMimes.get(extname(path).toLowerCase())
      if (mime && [...imageMimes.values()].includes(mime)) {
        content.push({
          data: bytes.toString("base64"),
          mediaType: mime as Extract<PromptContentPart, { type: "image" }>["mediaType"],
          name: resource.name ?? basename(path),
          type: "image",
        })
      } else {
        context.push(
          `<convax_file path=${JSON.stringify(path)} name=${JSON.stringify(resource.name ?? basename(path))}>\n${bytes.toString("utf8")}\n</convax_file>`,
        )
      }
    }
    const instructionText =
      context.length > 0 ? `<system-reminder>\n${context.join("\n\n")}\n</system-reminder>\n\n` : ""
    const skillPrefix = skills[0] ? `/${skills[0]} ` : ""
    const additionalSkills = skills
      .slice(1)
      .map((skill) => `Use the native Skill ${JSON.stringify(skill)}.`)
      .join("\n")
    content.unshift({
      text: `${skillPrefix}${instructionText}${additionalSkills}${additionalSkills ? "\n\n" : ""}${input.text}`,
      type: "text",
    })
    return content
  }

  private assertUnprotectedPath(path: string) {
    const protectedNames = new Set((this.options.protectedPaths ?? []).map((name) => name.trim()).filter(Boolean))
    if (protectedNames.size === 0) return
    const segments = resolve(path).split(/[\\/]+/u)
    const hit = segments.find((segment) => protectedNames.has(segment))
    if (hit) throw new Error(`Agent resource path is protected by the host: ${hit}`)
  }

  private async selectModel(input: AgentRuntimePromptInput) {
    if (!input.model) return
    const { client } = await this.ensureHost()
    unwrap(
      await client.sessions.selectModel({
        model: input.model.modelId,
        provider: input.model.providerId,
        ...(input.variant ? { reasoningEffort: input.variant } : {}),
        sessionId: input.sessionId as never,
      }),
      "Select DSH model",
    )
  }

  async prompt(input: AgentRuntimePromptInput): Promise<AgentMessage> {
    const directory = normalizedDirectory(input.directory)
    const summary = (await this.summaries(directory)).find((item) => String(item.sessionId) === input.sessionId)
    if (!summary) throw new Error(`DSH session is outside the requested Project: ${input.sessionId}`)
    await this.selectModel(input)
    const content = await this.promptContent(input)
    const { api } = await this.ensureHost()
    await this.eventReady
    const wait = this.waitForTurn(input.sessionId)
    try {
      const response = await api.sessions.prompt({
        payload: { content, mode: "queue", sessionId: input.sessionId as never },
        rpcId: RpcId(randomUUID()),
      })
      unwrap(response, "Submit DSH prompt")
    } catch (error) {
      this.rejectTurnWaiters(input.sessionId, error)
      await wait.catch(() => undefined)
      throw error
    }
    await wait
    const state = await this.getSessionState({ directory: input.directory, sessionId: input.sessionId })
    return (
      findLastAssistant(state.messages) ?? {
        createdAt: Date.now(),
        id: `${input.sessionId}:completed`,
        parts: [],
        role: "assistant",
        sessionId: input.sessionId,
      }
    )
  }

  async abort(input: AgentRuntimeSessionInput): Promise<void> {
    const { client } = await this.ensureHost()
    unwrap(await client.sessions.cancel({ sessionId: input.sessionId as never }), "Cancel DSH session")
  }

  async listCapabilities(input: AgentRuntimeDirectoryInput): Promise<AgentCapabilities> {
    const skills = await this.listSkills()
    const toolIds =
      this.options.toolProvider && input.scopeId
        ? (
            await this.options.toolProvider.listTools({
              directory: normalizedDirectory(input.directory),
              scopeId: input.scopeId,
            })
          ).map((tool) => tool.name)
        : []
    return { skills, toolIds: [...new Set(toolIds)].sort() }
  }

  async listModels(_input?: AgentRuntimeDirectoryInput): Promise<AgentModelCatalog> {
    const { client } = await this.ensureHost()
    const [models, providers] = await Promise.all([client.llm.models({}), client.llm.providers({})])
    const groups = unwrap(models, "List DSH models").groups
    const active = new Set(
      unwrap(providers, "List DSH providers")
        .providers.filter((provider) => provider.active)
        .map((provider) => provider.provider),
    )
    const selected = defaultModel(this.currentProviders)
    return {
      providers: groups.map((group) => ({
        connected: active.has(group.id),
        defaultModelId: group.id === selected.provider ? selected.model : undefined,
        models: group.models.map((model) => ({
          default: group.id === selected.provider && model.id === selected.model,
          modelId: model.id,
          modelName: model.name,
        })),
        providerId: group.id,
        providerName: group.name,
      })),
    }
  }

  async replyPermission(input: AgentRuntimeReplyPermissionInput): Promise<void> {
    const pending = this.approvals.get(input.requestId)
    if (!pending) throw new Error(`DSH approval request is no longer pending: ${input.requestId}`)
    const { client } = await this.ensureHost()
    const message: ClientResponse = {
      result: {
        ok: true,
        value: {
          approvalId: pending.approvalId,
          outcome: input.reply === "reject" ? "rejected" : "allowed-once",
          sessionId: pending.request.sessionID,
        },
      },
      rpcId: RpcId(pending.rpcId),
      type: "client-response",
    }
    const receipt = await client.respond(message)
    if (!receipt.accepted) throw new Error(`DSH approval response was not accepted: ${receipt.reason}`)
  }

  async replyQuestion(input: AgentRuntimeReplyQuestionInput): Promise<void> {
    const pending = this.questions.get(input.requestId)
    if (!pending) throw new Error(`DSH question request is no longer pending: ${input.requestId}`)
    const answers = pending.source.questions.map((question, index) => ({
      id: question.id,
      selected: input.answers[index] ?? [],
    }))
    await this.respondQuestion(pending, {
      ok: true,
      value: { answer: { answers }, sessionId: pending.request.sessionID },
    })
  }

  async rejectQuestion(input: AgentRuntimeRejectQuestionInput): Promise<void> {
    const pending = this.questions.get(input.requestId)
    if (!pending) throw new Error(`DSH question request is no longer pending: ${input.requestId}`)
    await this.respondQuestion(pending, {
      error: { code: "cancelled", details: {}, message: "Question rejected by the user" },
      ok: false,
    })
  }

  private async respondQuestion(pending: PendingQuestion, result: ClientResponse["result"]) {
    const { client } = await this.ensureHost()
    const receipt = await client.respond({
      result,
      rpcId: RpcId(pending.rpcId),
      type: "client-response",
    })
    if (!receipt.accepted) throw new Error(`DSH question response was not accepted: ${receipt.reason}`)
  }

  async refreshCapabilities(): Promise<void> {
    if (this.disposed) throw new Error("DeepSeek Harness agent runtime has been disposed")
    await this.resolveConfiguration()
  }

  refreshSkills() {
    return this.refreshCapabilities()
  }

  refreshHostTools() {
    return this.refreshCapabilities()
  }

  refreshConfiguration() {
    return this.refreshCapabilities()
  }

  async listMcpStatuses(_input?: AgentRuntimeDirectoryInput): Promise<Record<string, AgentMcpServerStatus>> {
    await this.resolveConfiguration()
    return Object.fromEntries(
      Object.entries(this.currentMcpServers).map(([name, config]) => [
        name,
        config.enabled === false
          ? { status: "disabled" as const }
          : config.networkBoundary === "host-validated-https" && config.oauth === false
            ? {
                error: "Remote MCP requires a DSH-native guarded HTTPS transport",
                status: "failed" as const,
              }
            : config.oauth === false
              ? { status: "connected" as const }
              : { status: "needs_auth" as const },
      ]),
    )
  }

  async authenticateMcp(input: { name: string }): Promise<AgentMcpServerStatus> {
    const status = (await this.listMcpStatuses())[input.name]
    if (!status) throw new Error(`Unknown DSH MCP server: ${input.name}`)
    if (status.status === "needs_auth") {
      return { status: "failed", error: "MCP OAuth is unavailable in the current DSH release" }
    }
    return status
  }

  async connectMcp(input: { name: string }): Promise<void> {
    const status = await this.authenticateMcp(input)
    if (status.status !== "connected") throw new Error(`DSH MCP server is not statically connectable: ${input.name}`)
  }

  async disconnectMcp(): Promise<void> {
    throw new Error("DSH owns MCP lifecycle through the selected Agent Preset")
  }

  async removeMcpAuth(): Promise<void> {
    throw new Error("MCP OAuth is unavailable in the current DSH release")
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.eventAbort.abort(new Error("DeepSeek Harness agent runtime disposed"))
    for (const sessionId of this.turnWaiters.keys()) {
      this.rejectTurnWaiters(sessionId, new Error("DeepSeek Harness agent runtime disposed"))
    }
    await this.toolServer?.close()
    await this.host?.context.fiber.dispose()
    this.host = undefined
    this.status = { state: "stopped" }
  }
}
