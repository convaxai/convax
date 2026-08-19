import type { AgentResource, AgentSession, AgentSessionState } from "@convax/agent-runtime"
import { agentCanvasResourceUri } from "../agent-canvas-context"

const embeddedConversationStorageKey = "convax:agent:embedded-conversations:v1"

export const embeddedConversationTitlePrefix = "[Convax embedded] "

export interface StorageLike {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export type AgentCompactStatusKind = "failed" | "idle" | "needs-approval" | "pending-changes" | "working"

export interface AgentCompactStatus {
  detail?: string
  kind: AgentCompactStatusKind
  label: string
}

export interface AgentCompactStatusInput {
  failed?: boolean
  interaction?: "permission" | "question"
  /**
   * Reserved for a provenance-safe review capability. A completed response alone
   * must never be presented as pending changes.
   */
  pendingChanges?: boolean
  working?: boolean
}

/**
 * Produces the small, text-readable status used outside the drawer. Priority is
 * intentionally actionable-first and does not inspect human-readable logs.
 */
export function resolveAgentCompactStatus(input: AgentCompactStatusInput): AgentCompactStatus {
  if (input.interaction) {
    return {
      detail: input.interaction === "permission" ? "Permission required" : "Answer required",
      kind: "needs-approval",
      label: "Needs approval",
    }
  }
  if (input.working) return { kind: "working", label: "Working" }
  if (input.failed) return { kind: "failed", label: "Failed" }
  if (input.pendingChanges) return { kind: "pending-changes", label: "Changes ready" }
  return { kind: "idle", label: "Idle" }
}

interface StoredEmbeddedConversations {
  conversations: Record<string, string>
  sessionIds: string[]
  version: 1
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readStoredConversations(storage: StorageLike | undefined, storageKey: string) {
  const empty = {
    conversations: new Map<string, string>(),
    sessionIds: new Set<string>(),
  }
  if (!storage) return empty
  try {
    const value = storage.getItem(storageKey)
    if (!value) return empty
    const parsed = JSON.parse(value) as Partial<StoredEmbeddedConversations>
    if (parsed.version !== 1 || !parsed.conversations || !Array.isArray(parsed.sessionIds)) return empty
    const conversations = new Map(
      Object.entries(parsed.conversations).filter(
        (entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1]),
      ),
    )
    const sessionIds = new Set(
      parsed.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string" && Boolean(sessionId)),
    )
    for (const sessionId of conversations.values()) sessionIds.add(sessionId)
    return { conversations, sessionIds }
  } catch {
    return empty
  }
}

export function agentResourceKey(resource: AgentResource) {
  if (resource.kind === "skill") return `skill:${resource.name}`
  if (resource.kind === "resource") return `resource:${resource.uri}`
  return `${resource.kind}:${resource.path}`
}

/**
 * Merges resource groups in priority order. The first resource with a given
 * identity wins, which lets callers put locked context before user attachments.
 */
export function mergeAgentResources(...groups: readonly (readonly AgentResource[])[]) {
  const seen = new Set<string>()
  const merged: AgentResource[] = []
  for (const group of groups) {
    for (const resource of group) {
      const key = agentResourceKey(resource)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(resource)
    }
  }
  return merged
}

export function canvasAgentResource(canvas: { id: string; name?: string }): AgentResource {
  return {
    kind: "resource",
    name: canvas.name,
    uri: agentCanvasResourceUri(canvas.id),
  }
}

export function containEmbeddedResourceDrag(embedded: boolean, event: Pick<Event, "stopPropagation">) {
  if (embedded) event.stopPropagation()
}

export function embeddedConversationSessionKey(scopeId?: string, conversationKey?: string) {
  if (!scopeId || conversationKey === undefined) return undefined
  return JSON.stringify([scopeId, conversationKey])
}

export function embeddedConversationTitle(conversationKey?: string) {
  const context = conversationKey?.trim() || "context"
  return `${embeddedConversationTitlePrefix}${context}`.slice(0, 240)
}

export class EmbeddedConversationSessionCache {
  readonly #conversations: Map<string, string>
  readonly #sessionIds: Set<string>
  readonly #storage: StorageLike | undefined
  readonly #storageKey: string

  constructor(storage?: StorageLike, storageKey = embeddedConversationStorageKey) {
    this.#storage = storage
    this.#storageKey = storageKey
    const stored = readStoredConversations(storage, storageKey)
    this.#conversations = stored.conversations
    this.#sessionIds = stored.sessionIds
  }

  get(scopeId?: string, conversationKey?: string) {
    const key = embeddedConversationSessionKey(scopeId, conversationKey)
    return key ? this.#conversations.get(key) : undefined
  }

  hasSessionId(sessionId: string) {
    return this.#sessionIds.has(sessionId)
  }

  remember(scopeId: string | undefined, conversationKey: string | undefined, sessionId: string) {
    const key = embeddedConversationSessionKey(scopeId, conversationKey)
    if (!key || !sessionId) return
    this.#conversations.set(key, sessionId)
    this.#sessionIds.add(sessionId)
    this.#persist()
  }

  /**
   * Drops the active mapping after a stale-session failure. The id remains in
   * the embedded-id set so it can never leak into the standalone history.
   */
  forget(scopeId?: string, conversationKey?: string) {
    const key = embeddedConversationSessionKey(scopeId, conversationKey)
    if (!key || !this.#conversations.delete(key)) return
    this.#persist()
  }

  clear() {
    this.#conversations.clear()
    this.#sessionIds.clear()
    try {
      this.#storage?.removeItem(this.#storageKey)
    } catch {
      // Storage can be disabled or full; the in-memory cache still works.
    }
  }

  #persist() {
    if (!this.#storage) return
    const value: StoredEmbeddedConversations = {
      conversations: Object.fromEntries(this.#conversations),
      sessionIds: [...this.#sessionIds],
      version: 1,
    }
    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify(value))
    } catch {
      // Storage can be disabled or full; the in-memory cache still works.
    }
  }
}

export function isEmbeddedConversationSession(
  session: Pick<AgentSession, "id" | "title">,
  cache: EmbeddedConversationSessionCache = embeddedConversationSessions,
) {
  return cache.hasSessionId(session.id) || session.title.startsWith(embeddedConversationTitlePrefix)
}

export function filterStandaloneAgentSessions(
  sessions: readonly AgentSession[],
  cache: EmbeddedConversationSessionCache = embeddedConversationSessions,
) {
  return sessions.filter((session) => !isEmbeddedConversationSession(session, cache))
}

/** Preserve an explicit current selection when a background session refresh completes. */
export function selectAgentSessionAfterRefresh(
  sessions: readonly AgentSession[],
  currentSessionId?: string,
  preferredSessionId?: string,
) {
  if (currentSessionId && sessions.some((session) => session.id === currentSessionId)) return currentSessionId
  if (preferredSessionId && sessions.some((session) => session.id === preferredSessionId)) return preferredSessionId
  return sessions[0]?.id
}

export function isAgentScrollNearBottom(
  metrics: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
  threshold = 16,
) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

/**
 * Owns the short-lived renderer-only stopping indicator and guarantees that
 * it settles after either a successful or failed abort request.
 */
export async function withAgentStoppingState<T>(
  setStopping: (stopping: boolean) => void,
  abortRequest: () => Promise<T>,
  shouldSettle: () => boolean = () => true,
) {
  setStopping(true)
  try {
    return await abortRequest()
  } finally {
    if (shouldSettle()) setStopping(false)
  }
}

/**
 * Agent polling returns fresh arrays even when nothing changed. A stable
 * content key prevents those no-op polls from repeatedly forcing scroll work.
 */
export function agentSessionContentKey(state: AgentSessionState | undefined) {
  if (!state) return ""
  return JSON.stringify({
    messages: state.messages,
    permissions: state.pendingPermissions,
    questions: state.pendingQuestions,
    status: state.status,
  })
}

export function displayedAgentSession(input: {
  documentVisible: boolean
  historyVisible: boolean
  open: boolean
  projectId?: string
  selectedSessionId?: string
  stateSessionId?: string
}) {
  if (
    !input.documentVisible ||
    !input.open ||
    input.historyVisible ||
    !input.projectId ||
    !input.selectedSessionId ||
    input.stateSessionId !== input.selectedSessionId
  )
    return undefined
  return {
    projectId: input.projectId,
    sessionId: input.selectedSessionId,
  }
}

export class AgentSessionStateRequestTracker {
  readonly #generations = new Map<string, number>()
  #nextGeneration = 0

  begin(scope: string, sessionId: string) {
    const key = JSON.stringify([scope, sessionId])
    const generation = ++this.#nextGeneration
    this.#generations.set(key, generation)
    return () => this.#generations.get(key) === generation
  }

  clear() {
    this.#generations.clear()
  }
}

/** Returns true only when the failed session is still the cached session. */
export function forgetStaleEmbeddedConversation(
  cache: EmbeddedConversationSessionCache,
  scopeId: string | undefined,
  conversationKey: string | undefined,
  failedSessionId: string,
) {
  if (cache.get(scopeId, conversationKey) !== failedSessionId) return false
  cache.forget(scopeId, conversationKey)
  return true
}

/** Survives both React unmounts and renderer restarts. */
export const embeddedConversationSessions = new EmbeddedConversationSessionCache(browserStorage())
