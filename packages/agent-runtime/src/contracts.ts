export type AgentRuntimeStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "ready" }
  | { state: "error"; error: string }

export interface AgentSession {
  id: string
  title: string
  directory: string
  createdAt: number
  updatedAt: number
}

export type AgentToolState =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | {
      status: "completed"
      input: Record<string, unknown>
      title: string
      output: string
    }
  | { status: "error"; input: Record<string, unknown>; error: string }

export type AgentMessagePart =
  | { id: string; type: "text"; text: string; synthetic?: boolean }
  | { id: string; type: "skill"; name: string }
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "file"; filename?: string; mime: string; url: string }
  | { id: string; type: "tool"; tool: string; callId: string; state: AgentToolState }
  | { id: string; type: "step-start"; snapshot?: string }
  | { id: string; type: "step-finish"; reason: string; cost: number }
  | { id: string; type: "unknown"; partType: string }

export interface AgentMessage {
  id: string
  sessionId: string
  role: "user" | "assistant"
  /** Exact provider/model recorded by OpenCode for this message. */
  model?: AgentModel
  createdAt: number
  completedAt?: number
  error?: string
  parts: AgentMessagePart[]
}

export type AgentSessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | {
      type: "retry"
      attempt: number
      message: string
      next: number
    }

export interface AgentPermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

export interface AgentQuestionOption {
  label: string
  description: string
}

export interface AgentQuestionInfo {
  question: string
  header: string
  options: AgentQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface AgentQuestionRequest {
  id: string
  sessionID: string
  questions: AgentQuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

export interface AgentSessionState {
  session: AgentSession
  status: AgentSessionStatus
  messages: AgentMessage[]
  pendingPermissions: AgentPermissionRequest[]
  pendingQuestions: AgentQuestionRequest[]
}

/** Content-free session activity safe to aggregate and display outside the Agent surface. */
export type AgentActivityState =
  | { state: "needs-input"; input: "permission" | "question" }
  | { state: "blocked" }
  | { state: "ready" }
  | { state: "running" }
  | { state: "idle" }

export interface AgentActivityProjectionContext {
  canceled?: boolean
  seenAfter?: number
}

export interface AgentSkill {
  name: string
  description?: string
  /** Native OpenCode source location. Hosts may use it to distinguish managed and external Skills. */
  location?: string
}

export interface AgentCapabilities {
  skills: AgentSkill[]
  toolIds: string[]
}

interface AgentPathResource {
  path: string
  name?: string
  mime?: string
}

/** A host-owned resource identified by a stable URI. */
export interface AgentStructuredResource {
  kind: "resource"
  uri: string
  name?: string
}

export type AgentResource =
  | (AgentPathResource & { kind: "file" })
  | (AgentPathResource & { kind: "directory" })
  | AgentStructuredResource
  | { kind: "skill"; name: string }

/** Host-prepared resources accepted by the Node runtime. */
export type AgentRuntimeResource =
  | (AgentPathResource & { kind: "file" })
  | (AgentPathResource & { kind: "directory" })
  | {
      kind: "resource"
      clientName: string
      content: string
      mime: string
      name?: string
      uri: string
    }
  | { kind: "skill"; name: string }

export interface AgentModel {
  providerId: string
  modelId: string
}

/** A display-only OpenCode model projection. Provider configuration stays inside the runtime. */
export interface AgentModelCatalogModel {
  modelId: string
  modelName: string
  default: boolean
}

/** A display-only OpenCode provider projection with no credentials or provider options. */
export interface AgentModelCatalogProvider {
  providerId: string
  providerName: string
  connected: boolean
  defaultModelId?: string
  models: AgentModelCatalogModel[]
}

/** OpenCode's currently available LLM providers and models for one host-resolved directory. */
export interface AgentModelCatalog {
  providers: AgentModelCatalogProvider[]
}

interface AgentPromptFields<Resource> {
  sessionId: string
  text: string
  resources?: Resource[]
  instructions?: string[]
  agent?: string
  model?: AgentModel
  variant?: string
}

export interface AgentListSessionsRequest {
  scopeId: string
  limit?: number
}

export interface AgentCreateSessionRequest {
  scopeId: string
  title?: string
}

export interface AgentGetSessionStateRequest {
  scopeId: string
  sessionId: string
  limit?: number
}

export interface AgentPromptRequest extends AgentPromptFields<AgentResource> {
  scopeId: string
}

export interface AgentAbortRequest {
  scopeId: string
  sessionId: string
}

export interface AgentListCapabilitiesRequest {
  scopeId: string
}

export interface AgentListModelsRequest {
  scopeId: string
}

export interface AgentReplyPermissionRequest {
  scopeId: string
  requestId: string
  reply: "once" | "always" | "reject"
  message?: string
}

export interface AgentReplyQuestionRequest {
  scopeId: string
  requestId: string
  answers: string[][]
}

export interface AgentRejectQuestionRequest {
  scopeId: string
  requestId: string
}

/** Host-facing API safe to expose across a serialization boundary. */
export interface AgentClient {
  getStatus(): Promise<AgentRuntimeStatus>
  listSessions(request: AgentListSessionsRequest): Promise<AgentSession[]>
  createSession(request: AgentCreateSessionRequest): Promise<AgentSession>
  getSessionState(request: AgentGetSessionStateRequest): Promise<AgentSessionState>
  prompt(request: AgentPromptRequest): Promise<AgentMessage>
  abort(request: AgentAbortRequest): Promise<void>
  listCapabilities(request: AgentListCapabilitiesRequest): Promise<AgentCapabilities>
  listModels(request: AgentListModelsRequest): Promise<AgentModelCatalog>
  replyPermission(request: AgentReplyPermissionRequest): Promise<void>
  replyQuestion(request: AgentReplyQuestionRequest): Promise<void>
  rejectQuestion(request: AgentRejectQuestionRequest): Promise<void>
}

export interface AgentRuntimeListSessionsInput {
  directory: string
  limit?: number
}

export interface AgentRuntimeCreateSessionInput {
  directory: string
  title?: string
}

export interface AgentRuntimeGetSessionStateInput {
  directory: string
  sessionId: string
  limit?: number
}

export interface AgentRuntimePromptInput extends AgentPromptFields<AgentRuntimeResource> {
  directory: string
  scopeId?: string
}

export interface AgentRuntimeSessionInput {
  directory: string
  sessionId: string
}

export interface AgentRuntimeDirectoryInput {
  directory: string
  scopeId?: string
}

export interface AgentToolDefinition {
  description: string
  inputSchema: Record<string, unknown>
  name: string
}

export interface AgentToolScope {
  directory: string
  scopeId: string
}

export interface AgentToolCallContext {
  /** Aborted when the caller disconnects or the runtime transport shuts down. */
  signal?: AbortSignal
}

/** Host-owned tools exposed to OpenCode through the runtime boundary. */
export interface AgentToolProvider {
  callTool(
    scope: AgentToolScope,
    name: string,
    input: Record<string, unknown>,
    context?: AgentToolCallContext,
  ): Promise<unknown>
  listTools(scope: AgentToolScope): Promise<readonly AgentToolDefinition[]> | readonly AgentToolDefinition[]
}

export interface AgentRuntimeReplyPermissionInput {
  directory: string
  requestId: string
  reply: "once" | "always" | "reject"
  message?: string
}

export interface AgentRuntimeReplyQuestionInput {
  directory: string
  requestId: string
  answers: string[][]
}

export interface AgentRuntimeRejectQuestionInput {
  directory: string
  requestId: string
}

export interface AgentRuntime {
  getStatus(): Promise<AgentRuntimeStatus>
  /** List OpenCode-native Skills without requiring a host tool scope. */
  listSkills(input: AgentRuntimeDirectoryInput): Promise<AgentSkill[]>
  listSessions(input: AgentRuntimeListSessionsInput): Promise<AgentSession[]>
  createSession(input: AgentRuntimeCreateSessionInput): Promise<AgentSession>
  getSessionState(input: AgentRuntimeGetSessionStateInput): Promise<AgentSessionState>
  prompt(input: AgentRuntimePromptInput): Promise<AgentMessage>
  abort(input: AgentRuntimeSessionInput): Promise<void>
  listCapabilities(input: AgentRuntimeDirectoryInput): Promise<AgentCapabilities>
  listModels(input: AgentRuntimeDirectoryInput): Promise<AgentModelCatalog>
  replyPermission(input: AgentRuntimeReplyPermissionInput): Promise<void>
  replyQuestion(input: AgentRuntimeReplyQuestionInput): Promise<void>
  rejectQuestion(input: AgentRuntimeRejectQuestionInput): Promise<void>
  dispose(): Promise<void>
}
