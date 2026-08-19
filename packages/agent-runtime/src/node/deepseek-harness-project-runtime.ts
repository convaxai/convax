import { readFile } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"

import {
  type ClientResponse,
  type IApiClient,
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
  type AgentSkill,
  type AgentToolProvider,
} from "../contracts"
import type {
  AgentMcpServerStatus,
  AgentRemoteMcpServerConfig,
  AgentRuntimeProfileConfig,
  DeepSeekHarnessProviderConfig,
} from "./deepseek-harness-agent-runtime"
import { ManagedAgentSkillStore } from "./managed-skill-store"

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

function rpcError(operation: string, error: RpcError) {
  const failure = new Error(`${operation}: ${error.message}`)
  Object.assign(failure, { code: error.code, details: error.details })
  return failure
}

function unwrap<T>(response: RpcResponse<T>, operation: string): T {
  if (response.result.ok) return response.result.value
  throw rpcError(operation, response.result.error)
}

function normalizedDirectory(value: string) {
  if (!value.trim()) throw new Error("Agent runtime directory is required")
  return resolve(value)
}

function defaultModel(providers: Readonly<Record<string, DeepSeekHarnessProviderConfig>>) {
  for (const [provider, config] of Object.entries(providers).sort(([left], [right]) => left.localeCompare(right))) {
    const model = Object.keys(config.models).sort()[0]
    if (model) return { model, provider }
  }
  return { model: "unconfigured", provider: "unconfigured" }
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

export interface DeepSeekHarnessProjectConnection {
  readonly agentPreset: string
  readonly client: IApiClient
  close(): Promise<void>
}

export interface DeepSeekHarnessProjectRuntimeOptions {
  /** Global Host-managed Skill store. Project children mount its user directory read-only. */
  configDirectory: string
  connectProject(input: { directory: string; scopeId: string }): Promise<DeepSeekHarnessProjectConnection>
  closeProject(scopeId: string): Promise<void>
  closeConnections(): Promise<void>
  protectedPaths?: readonly string[]
  resolveAgentProfiles?: () => Promise<Readonly<Record<string, AgentRuntimeProfileConfig>>>
  resolveMcpServers?: () => Promise<Readonly<Record<string, AgentRemoteMcpServerConfig>>>
  resolveProviders?: () => Promise<Readonly<Record<string, DeepSeekHarnessProviderConfig>>>
  toolProvider?: AgentToolProvider
}

interface DeepSeekHarnessRemoteProjectState {
  activePrompts: number
  agentErrors: Map<string, string>
  approvals: Map<string, PendingApproval>
  connection: DeepSeekHarnessProjectConnection
  directory: string
  eventAbort: AbortController
  eventReady: Promise<void>
  questions: Map<string, PendingQuestion>
  quiescenceWaiters: Set<() => void>
  retirement?: Promise<void>
  scopeId: string
  stale: boolean
  turnWaiters: Map<string, Set<TurnWaiter>>
}

/**
 * Host-neutral product facade over one official DSH Host ApiProxy connection per
 * Project. Electron owns the concrete child process registry; this class owns only
 * AgentRuntime projection, event correlation and quiescent configuration refresh.
 */
export class DeepSeekHarnessProjectRuntime implements AgentRuntime {
  private readonly skillStore: ManagedAgentSkillStore
  private readonly projects = new Map<string, Promise<DeepSeekHarnessRemoteProjectState>>()
  private disposed = false
  private lastError?: string

  constructor(private readonly options: DeepSeekHarnessProjectRuntimeOptions) {
    this.skillStore = new ManagedAgentSkillStore(normalizedDirectory(options.configDirectory))
  }

  private binding(input: { directory: string; scopeId?: string }) {
    const scopeId = input.scopeId?.trim()
    if (!scopeId) throw new Error("DSH Project scope id is required")
    return { directory: normalizedDirectory(input.directory), scopeId }
  }

  private async ensureProject(input: { directory: string; scopeId?: string }) {
    if (this.disposed) throw new Error("DeepSeek Harness Project runtime has been disposed")
    const binding = this.binding(input)
    const current = this.projects.get(binding.scopeId)
    if (current) {
      const state = await current
      if (state.directory !== binding.directory) throw new Error(`DSH Project ${binding.scopeId} changed directory`)
      if (!state.stale || state.activePrompts > 0) return state
      await this.retire(state)
    }
    const pending = this.startProject(binding).catch((error) => {
      if (this.projects.get(binding.scopeId) === pending) this.projects.delete(binding.scopeId)
      this.lastError = errorText(error)
      throw error
    })
    this.projects.set(binding.scopeId, pending)
    return pending
  }

  private async startProject(binding: { directory: string; scopeId: string }) {
    const connection = await this.options.connectProject(binding)
    const eventAbort = new AbortController()
    const state: DeepSeekHarnessRemoteProjectState = {
      activePrompts: 0,
      agentErrors: new Map(),
      approvals: new Map(),
      connection,
      directory: binding.directory,
      eventAbort,
      eventReady: Promise.resolve(),
      questions: new Map(),
      quiescenceWaiters: new Set(),
      scopeId: binding.scopeId,
      stale: false,
      turnWaiters: new Map(),
    }
    state.eventReady = new Promise<void>((resolveReady, rejectReady) => {
      void this.consumeEvents(state, resolveReady).catch((error) => {
        rejectReady(error)
        if (!eventAbort.signal.aborted) {
          this.lastError = errorText(error)
          this.rejectAllWaiters(state, error)
        }
      })
    })
    this.lastError = undefined
    return state
  }

  private async consumeEvents(state: DeepSeekHarnessRemoteProjectState, onOpen: () => void) {
    for await (const envelope of state.connection.client.events.mux({}, state.eventAbort.signal, onOpen)) {
      const frame = envelope.payload
      if (frame.type === "approval/requested") {
        state.approvals.set(String(envelope.rpcId), {
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
        for (const [id, pending] of state.approvals) {
          if (pending.approvalId === String(frame.approvalId)) state.approvals.delete(id)
        }
      } else if (frame.type === "question/requested") {
        state.questions.set(String(envelope.rpcId), {
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
        state.questions.delete(String(frame.questionRpcId))
      } else if (frame.type === "session/event" && frame.event.type === "turn/end") {
        this.resolveWaiters(state, String(frame.sessionId))
      }
    }
  }

  private resolveWaiters(state: DeepSeekHarnessRemoteProjectState, sessionId: string) {
    const waiters = state.turnWaiters.get(sessionId)
    if (!waiters) return
    state.turnWaiters.delete(sessionId)
    for (const waiter of waiters) waiter.resolve()
  }

  private rejectWaiters(state: DeepSeekHarnessRemoteProjectState, sessionId: string, error: unknown) {
    const waiters = state.turnWaiters.get(sessionId)
    if (!waiters) return
    state.turnWaiters.delete(sessionId)
    for (const waiter of waiters) waiter.reject(error)
  }

  private rejectAllWaiters(state: DeepSeekHarnessRemoteProjectState, error: unknown) {
    for (const sessionId of state.turnWaiters.keys()) this.rejectWaiters(state, sessionId, error)
  }

  private waitForTurn(state: DeepSeekHarnessRemoteProjectState, sessionId: string) {
    return new Promise<void>((resolveWaiter, rejectWaiter) => {
      const waiters = state.turnWaiters.get(sessionId) ?? new Set<TurnWaiter>()
      waiters.add({ reject: rejectWaiter, resolve: resolveWaiter })
      state.turnWaiters.set(sessionId, waiters)
    })
  }

  private waitForQuiescence(state: DeepSeekHarnessRemoteProjectState) {
    if (state.activePrompts === 0) return Promise.resolve()
    return new Promise<void>((resolveWaiter) => state.quiescenceWaiters.add(resolveWaiter))
  }

  private retire(state: DeepSeekHarnessRemoteProjectState) {
    state.retirement ??= (async () => {
      await this.waitForQuiescence(state)
      const current = this.projects.get(state.scopeId)
      if ((await current?.catch(() => undefined)) === state) this.projects.delete(state.scopeId)
      state.eventAbort.abort(new Error("DSH Project connection retired"))
      this.rejectAllWaiters(state, new Error("DSH Project connection retired"))
      await this.options.closeProject(state.scopeId)
    })()
    return state.retirement
  }

  /** Quiesces one forgotten Project without affecting any other Project process. */
  async closeProject(scopeId: string): Promise<void> {
    const current = this.projects.get(scopeId)
    this.projects.delete(scopeId)
    const state = await current?.catch(() => undefined)
    if (state) await this.retire(state)
    else await this.options.closeProject(scopeId)
  }

  private async summaries(state: DeepSeekHarnessRemoteProjectState) {
    const listed = unwrap(await state.connection.client.sessions.list({}), "List DSH sessions")
    return listed.items.filter((item) => item.cwd === state.directory)
  }

  private async mapSession(state: DeepSeekHarnessRemoteProjectState, sessionId: string, updatedAt?: number) {
    const history = unwrap(
      await state.connection.client.sessions.history({ maxMessages: 1, sessionId: sessionId as never }),
      "Read DSH session title",
    )
    const createdAt = history.events[0]?.event.time ?? updatedAt ?? Date.now()
    const lastEventAt = history.events.at(-1)?.event.time ?? createdAt
    return {
      createdAt,
      directory: state.directory,
      id: sessionId,
      title: sessionTitle(
        history.events.map((entry) => entry.event),
        "New session",
      ),
      updatedAt: Math.max(updatedAt ?? 0, lastEventAt),
    }
  }

  async getStatus(): Promise<AgentRuntimeStatus> {
    if (this.disposed) return { state: "stopped" }
    return this.lastError ? { error: this.lastError, state: "error" } : { state: "ready" }
  }

  async listSkills(): Promise<AgentSkill[]> {
    return (await this.skillStore.list()).map((skill) => ({
      description: skill.description,
      location: skill.skillFile,
      name: skill.name,
    }))
  }

  async listSessions(input: AgentRuntimeListSessionsInput): Promise<AgentSession[]> {
    const state = await this.ensureProject(input)
    const items = await this.summaries(state)
    const limited = input.limit === undefined ? items : items.slice(0, Math.max(0, input.limit))
    return Promise.all(limited.map((item) => this.mapSession(state, String(item.sessionId), item.updatedAt)))
  }

  async createSession(input: AgentRuntimeCreateSessionInput): Promise<AgentSession> {
    const state = await this.ensureProject(input)
    const created = unwrap(
      await state.connection.client.sessions.create({
        agentPreset: state.connection.agentPreset,
        cwd: state.directory,
      }),
      "Create DSH session",
    )
    if (input.title?.trim()) {
      unwrap(
        await state.connection.client.sessions.rename({ sessionId: created.sessionId, title: input.title.trim() }),
        "Name DSH session",
      )
    }
    return this.mapSession(state, String(created.sessionId))
  }

  async getSessionState(input: AgentRuntimeGetSessionStateInput): Promise<AgentSessionState> {
    const state = await this.ensureProject(input)
    const history = unwrap(
      await state.connection.client.sessions.history({
        ...(input.limit === undefined ? {} : { maxMessages: input.limit }),
        sessionId: input.sessionId as never,
      }),
      "Read DSH session",
    )
    const events = history.events.map((entry) => entry.event)
    const summary = (await this.summaries(state)).find((item) => String(item.sessionId) === input.sessionId)
    if (!summary) throw new Error(`DSH session is outside the requested Project: ${input.sessionId}`)
    const messages = mapMessages(events, input.sessionId)
    const error = state.agentErrors.get(input.sessionId) ?? latestTurnReason(events)
    if (error) {
      const last = findLastAssistant(messages)
      if (last) last.error = error
    }
    return {
      messages,
      pendingPermissions: [...state.approvals.values()]
        .map((pending) => pending.request)
        .filter((request) => request.sessionID === input.sessionId),
      pendingQuestions: [...state.questions.values()]
        .map((pending) => pending.request)
        .filter((request) => request.sessionID === input.sessionId),
      session: await this.mapSession(state, input.sessionId, summary.updatedAt),
      status: summary.running ? { type: "busy" } : { type: "idle" },
    }
  }

  private async promptContent(input: AgentRuntimePromptInput) {
    const profiles = this.options.resolveAgentProfiles ? await this.options.resolveAgentProfiles() : {}
    const instructions = [...(input.instructions ?? [])]
    if (input.agent) {
      const profile = profiles[input.agent]
      if (!profile) throw new Error(`Unknown Agent Profile: ${input.agent}`)
      instructions.unshift(profile.prompt)
    }
    const content: PromptContentPart[] = []
    const context = [...instructions]
    const skills: string[] = []
    let resourceBytes = 0
    for (const resource of input.resources ?? []) {
      if (resource.kind === "skill") {
        skills.push(resource.name)
      } else if (resource.kind === "resource") {
        resourceBytes += Buffer.byteLength(resource.content, "utf8")
        if (resourceBytes > maxPromptResourceBytes) throw new Error("Agent resources exceed the prompt byte limit")
        context.push(
          `<convax_resource uri=${JSON.stringify(resource.uri)} mime=${JSON.stringify(resource.mime)} client=${JSON.stringify(resource.clientName)}>\n${resource.content}\n</convax_resource>`,
        )
      } else if (resource.kind === "directory") {
        this.assertUnprotectedPath(resource.path)
        context.push(
          `The host attached directory ${JSON.stringify(resource.name ?? basename(resource.path))} at ${resource.path}.`,
        )
      } else {
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
    const hit = resolve(path)
      .split(/[\\/]+/u)
      .find((segment) => protectedNames.has(segment))
    if (hit) throw new Error(`Agent resource path is protected by the host: ${hit}`)
  }

  async prompt(input: AgentRuntimePromptInput): Promise<AgentMessage> {
    const state = await this.ensureProject(input)
    const summary = (await this.summaries(state)).find((item) => String(item.sessionId) === input.sessionId)
    if (!summary) throw new Error(`DSH session is outside the requested Project: ${input.sessionId}`)
    if (input.model) {
      unwrap(
        await state.connection.client.sessions.selectModel({
          model: input.model.modelId,
          provider: input.model.providerId,
          ...(input.variant ? { reasoningEffort: input.variant } : {}),
          sessionId: input.sessionId as never,
        }),
        "Select DSH model",
      )
    }
    const content = await this.promptContent(input)
    await state.eventReady
    const wait = this.waitForTurn(state, input.sessionId)
    state.activePrompts += 1
    try {
      unwrap(
        await state.connection.client.sessions.prompt({
          content,
          mode: "queue",
          sessionId: input.sessionId as never,
        }),
        "Submit DSH prompt",
      )
      await wait
      const sessionState = await this.getSessionState(input)
      return (
        findLastAssistant(sessionState.messages) ?? {
          createdAt: Date.now(),
          id: `${input.sessionId}:completed`,
          parts: [],
          role: "assistant",
          sessionId: input.sessionId,
        }
      )
    } catch (error) {
      this.rejectWaiters(state, input.sessionId, error)
      await wait.catch(() => undefined)
      throw error
    } finally {
      state.activePrompts -= 1
      if (state.activePrompts === 0) {
        for (const resolveWaiter of state.quiescenceWaiters) resolveWaiter()
        state.quiescenceWaiters.clear()
      }
      if (state.stale && state.activePrompts === 0) await this.retire(state)
    }
  }

  async abort(input: AgentRuntimeSessionInput): Promise<void> {
    const state = await this.ensureProject(input)
    unwrap(await state.connection.client.sessions.cancel({ sessionId: input.sessionId as never }), "Cancel DSH session")
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

  async listModels(input: AgentRuntimeDirectoryInput): Promise<AgentModelCatalog> {
    const state = await this.ensureProject(input)
    const [models, providers, configuredProviders] = await Promise.all([
      state.connection.client.llm.models({}),
      state.connection.client.llm.providers({}),
      this.options.resolveProviders?.() ?? Promise.resolve({}),
    ])
    const groups = unwrap(models, "List DSH models").groups
    const active = new Set(
      unwrap(providers, "List DSH providers")
        .providers.filter((provider) => provider.active)
        .map((provider) => provider.provider),
    )
    const selected = defaultModel(configuredProviders)
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
    const state = await this.ensureProject(input)
    const pending = state.approvals.get(input.requestId)
    if (!pending) throw new Error(`DSH approval request is no longer pending: ${input.requestId}`)
    const receipt = await state.connection.client.respond({
      result: {
        ok: true,
        value: {
          approvalId: pending.approvalId,
          outcome: input.reply === "reject" ? "rejected" : "allowed-once",
          sessionId: pending.request.sessionID,
        },
      },
      rpcId: pending.rpcId as never,
      type: "client-response",
    })
    if (!receipt.accepted) throw new Error(`DSH approval response was not accepted: ${receipt.reason}`)
  }

  async replyQuestion(input: AgentRuntimeReplyQuestionInput): Promise<void> {
    const state = await this.ensureProject(input)
    const pending = state.questions.get(input.requestId)
    if (!pending) throw new Error(`DSH question request is no longer pending: ${input.requestId}`)
    const answers = pending.source.questions.map((question, index) => ({
      id: question.id,
      selected: input.answers[index] ?? [],
    }))
    await this.respondQuestion(state, pending, {
      ok: true,
      value: { answer: { answers }, sessionId: pending.request.sessionID },
    })
  }

  async rejectQuestion(input: AgentRuntimeRejectQuestionInput): Promise<void> {
    const state = await this.ensureProject(input)
    const pending = state.questions.get(input.requestId)
    if (!pending) throw new Error(`DSH question request is no longer pending: ${input.requestId}`)
    await this.respondQuestion(state, pending, {
      error: { code: "cancelled", details: {}, message: "Question rejected by the user" },
      ok: false,
    })
  }

  private async respondQuestion(
    state: DeepSeekHarnessRemoteProjectState,
    pending: PendingQuestion,
    result: ClientResponse["result"],
  ) {
    const receipt = await state.connection.client.respond({
      result,
      rpcId: pending.rpcId as never,
      type: "client-response",
    })
    if (!receipt.accepted) throw new Error(`DSH question response was not accepted: ${receipt.reason}`)
  }

  async refreshCapabilities(): Promise<void> {
    const states = await Promise.all([...this.projects.values()].map((project) => project.catch(() => undefined)))
    await Promise.all(
      states.map(async (state) => {
        if (!state) return
        state.stale = true
        await this.retire(state)
      }),
    )
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

  async listMcpStatuses(): Promise<Record<string, AgentMcpServerStatus>> {
    const servers = this.options.resolveMcpServers ? await this.options.resolveMcpServers() : {}
    return Object.fromEntries(
      Object.entries(servers).map(([name, config]) => [
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
    return status.status === "needs_auth"
      ? { error: "MCP OAuth requires a DSH-native Plugin and is not configured", status: "failed" }
      : status
  }

  async connectMcp(input: { name: string }): Promise<void> {
    const status = await this.authenticateMcp(input)
    if (status.status !== "connected") throw new Error(`DSH MCP server is not connected: ${input.name}`)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const states = await Promise.all([...this.projects.values()].map((project) => project.catch(() => undefined)))
    this.projects.clear()
    for (const state of states) {
      if (!state) continue
      state.eventAbort.abort(new Error("DeepSeek Harness Project runtime disposed"))
      this.rejectAllWaiters(state, new Error("DeepSeek Harness Project runtime disposed"))
    }
    await this.options.closeConnections()
  }
}
