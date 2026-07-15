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

export interface AgentSkill {
  name: string
  description?: string
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

export interface AgentCanvasResource {
  kind: "canvas"
  canvasId: string
  name?: string
}

export type AgentResource =
  | (AgentPathResource & { kind: "file" })
  | (AgentPathResource & { kind: "directory" })
  | AgentCanvasResource
  | { kind: "skill"; name: string }

/** Host-prepared resources accepted by the Node runtime. */
export type AgentRuntimeResource =
  | (AgentPathResource & { kind: "file" })
  | (AgentPathResource & { kind: "directory" })
  | {
      kind: "canvas"
      canvasId: string
      content: string
      mime: "application/json"
      name?: string
    }
  | { kind: "skill"; name: string }

export interface AgentModel {
  providerId: string
  modelId: string
}

interface AgentPromptFields<Resource> {
  sessionId: string
  text: string
  resources?: Resource[]
  agent?: string
  model?: AgentModel
  variant?: string
}

export interface AgentListSessionsRequest {
  projectId: string
  limit?: number
}

export interface AgentCreateSessionRequest {
  projectId: string
  title?: string
}

export interface AgentGetSessionStateRequest {
  projectId: string
  sessionId: string
  limit?: number
}

export interface AgentPromptRequest extends AgentPromptFields<AgentResource> {
  projectId: string
}

export interface AgentAbortRequest {
  projectId: string
  sessionId: string
}

export interface AgentListCapabilitiesRequest {
  projectId: string
}

export interface AgentReplyPermissionRequest {
  projectId: string
  requestId: string
  reply: "once" | "always" | "reject"
  message?: string
}

export interface AgentReplyQuestionRequest {
  projectId: string
  requestId: string
  answers: string[][]
}

export interface AgentRejectQuestionRequest {
  projectId: string
  requestId: string
}

/** Renderer-safe API exposed by the desktop preload. */
export interface AgentClient {
  getStatus(): Promise<AgentRuntimeStatus>
  listSessions(request: AgentListSessionsRequest): Promise<AgentSession[]>
  createSession(request: AgentCreateSessionRequest): Promise<AgentSession>
  getSessionState(request: AgentGetSessionStateRequest): Promise<AgentSessionState>
  prompt(request: AgentPromptRequest): Promise<AgentMessage>
  abort(request: AgentAbortRequest): Promise<void>
  listCapabilities(request: AgentListCapabilitiesRequest): Promise<AgentCapabilities>
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

/** Host-owned tools exposed to OpenCode through the runtime boundary. */
export interface AgentToolProvider {
  callTool(scope: AgentToolScope, name: string, input: Record<string, unknown>): Promise<unknown>
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
  listSessions(input: AgentRuntimeListSessionsInput): Promise<AgentSession[]>
  createSession(input: AgentRuntimeCreateSessionInput): Promise<AgentSession>
  getSessionState(input: AgentRuntimeGetSessionStateInput): Promise<AgentSessionState>
  prompt(input: AgentRuntimePromptInput): Promise<AgentMessage>
  abort(input: AgentRuntimeSessionInput): Promise<void>
  listCapabilities(input: AgentRuntimeDirectoryInput): Promise<AgentCapabilities>
  replyPermission(input: AgentRuntimeReplyPermissionInput): Promise<void>
  replyQuestion(input: AgentRuntimeReplyQuestionInput): Promise<void>
  rejectQuestion(input: AgentRuntimeRejectQuestionInput): Promise<void>
  dispose(): Promise<void>
}
