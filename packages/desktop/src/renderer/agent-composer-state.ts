import type { AgentResource, AgentSkill } from "@convax/agent-runtime"

export interface AgentComposerDraft {
  segments: AgentComposerSegment[]
}

export type AgentComposerSegment = { type: "text"; text: string } | { type: "resource"; resource: AgentResource }

export type AgentComposerQueryTrigger = "reference" | "skill"

export interface AgentComposerQuery {
  end: number
  query: string
  start: number
  trigger: AgentComposerQueryTrigger
}

export interface AgentComposerSuggestionOptionLike {
  id: string
}

export type AgentComposerSuggestionAnchor = { kind: "caret" } | { kind: "token"; tokenId: string }

export interface OpenAgentComposerSuggestionState {
  activeId?: string
  anchor: AgentComposerSuggestionAnchor
  hoveredId?: string
  mode: "edit" | "query"
  open: true
  trigger: AgentComposerQueryTrigger
}

export type AgentComposerSuggestionState = { open: false } | OpenAgentComposerSuggestionState

export const emptyAgentComposerDraft = (): AgentComposerDraft => ({ segments: [] })

export function normalizeAgentComposerDraft(draft: AgentComposerDraft): AgentComposerDraft {
  const segments: AgentComposerSegment[] = []
  for (const segment of draft.segments) {
    if (segment.type === "resource") {
      const resource = normalizeAgentComposerResource(segment.resource)
      if (resource) segments.push({ resource, type: "resource" })
      continue
    }
    if (!segment.text) continue
    const previous = segments.at(-1)
    if (previous?.type === "text") previous.text += segment.text
    else segments.push({ text: segment.text, type: "text" })
  }
  return { segments }
}

export function agentComposerText(draft: AgentComposerDraft) {
  return normalizeAgentComposerDraft(draft)
    .segments.filter((segment): segment is Extract<AgentComposerSegment, { type: "text" }> => segment.type === "text")
    .map((segment) => segment.text.replaceAll("\u00a0", " "))
    .join("")
}

export function agentComposerResources(draft: AgentComposerDraft): AgentResource[] {
  return normalizeAgentComposerDraft(draft).segments.flatMap((segment) => {
    return segment.type === "resource" ? [segment.resource] : []
  })
}

export function hasAgentComposerContent(draft: AgentComposerDraft) {
  return Boolean(agentComposerText(draft).trim() || agentComposerResources(draft).length)
}

export function shouldShowAgentComposerPlaceholder(draft: AgentComposerDraft, focused: boolean) {
  return !focused && !hasAgentComposerContent(draft)
}

export function findAgentComposerQuery(text: string, caret: number): AgentComposerQuery | undefined {
  if (!Number.isSafeInteger(caret) || caret < 0 || caret > text.length) return undefined
  const match = /(?:^|\s)([@$])([\p{L}\p{N}._-]*)$/u.exec(text.slice(0, caret))
  if (!match) return undefined
  const query = match[2] ?? ""
  return {
    end: caret,
    query,
    start: caret - query.length - 1,
    trigger: match[1] === "@" ? "reference" : "skill",
  }
}

export function openAgentComposerSuggestion(
  trigger: AgentComposerQueryTrigger,
  options: readonly AgentComposerSuggestionOptionLike[],
  anchor: AgentComposerSuggestionAnchor,
): OpenAgentComposerSuggestionState {
  return {
    activeId: options[0]?.id,
    anchor,
    mode: anchor.kind === "token" ? "edit" : "query",
    open: true,
    trigger,
  }
}

export function moveAgentComposerSuggestion(
  state: OpenAgentComposerSuggestionState,
  direction: number,
  options: readonly AgentComposerSuggestionOptionLike[],
): OpenAgentComposerSuggestionState {
  if (!direction) return state
  if (!options.length) return state
  const current = state.activeId ? options.findIndex((option) => option.id === state.activeId) : -1
  const step = direction > 0 ? 1 : -1
  const next = current < 0 ? (step > 0 ? 0 : options.length - 1) : (current + step + options.length) % options.length
  return { ...state, activeId: options[next]?.id }
}

export function reconcileAgentComposerSuggestionOptions(
  state: OpenAgentComposerSuggestionState,
  options: readonly AgentComposerSuggestionOptionLike[],
): OpenAgentComposerSuggestionState {
  if (state.activeId && options.some((option) => option.id === state.activeId)) return state
  const activeId = options[0]?.id
  return state.activeId === activeId ? state : { ...state, activeId }
}

export function resolveAgentComposerSuggestionOption<T extends AgentComposerSuggestionOptionLike>(
  state: OpenAgentComposerSuggestionState,
  options: readonly T[],
) {
  return state.activeId ? options.find((option) => option.id === state.activeId) : undefined
}

export function setAgentComposerSuggestionHover(
  state: OpenAgentComposerSuggestionState,
  hoveredId?: string,
): OpenAgentComposerSuggestionState {
  return { ...state, hoveredId }
}

export function closeAgentComposerSuggestion(): AgentComposerSuggestionState {
  return { open: false }
}

export class AgentComposerCompositionController {
  #composing = false
  #cancelScheduledRefresh?: () => void

  start() {
    this.#composing = true
    this.#cancelScheduledRefresh?.()
    this.#cancelScheduledRefresh = undefined
  }

  runWhenIdle(refresh: () => void) {
    if (this.#composing || this.#cancelScheduledRefresh) return false
    refresh()
    return true
  }

  finish(refresh: () => void, schedule: (callback: () => void) => () => void) {
    if (!this.#composing) return
    this.#composing = false
    let completed = false
    const cancel = schedule(() => {
      completed = true
      this.#cancelScheduledRefresh = undefined
      if (!this.#composing) refresh()
    })
    if (!completed) this.#cancelScheduledRefresh = cancel
  }

  dispose() {
    this.#composing = false
    this.#cancelScheduledRefresh?.()
    this.#cancelScheduledRefresh = undefined
  }
}

export class AgentComposerRequestTracker {
  readonly #requests = new Map<string, number>()
  #generation = 0

  begin(scope: string, key: string) {
    const requestKey = JSON.stringify([scope, key])
    const generation = ++this.#generation
    this.#requests.set(requestKey, generation)
    return () => this.#requests.get(requestKey) === generation
  }

  invalidate() {
    this.#requests.clear()
  }
}

export function filterAgentSkills(skills: readonly AgentSkill[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...skills]
  return skills.filter((skill) => `${skill.name} ${skill.description ?? ""}`.toLocaleLowerCase().includes(normalized))
}

export function shouldDismissAgentResourcePicker<T>(
  surface: { contains(target: T): boolean } | null,
  target: T | null,
) {
  return !surface || target === null || !surface.contains(target)
}

function normalizeAgentComposerResource(resource: AgentResource): AgentResource | undefined {
  const name = resource.name?.trim()
  if (resource.kind === "skill") return name ? { kind: "skill", name } : undefined
  if (resource.kind === "resource") {
    const uri = resource.uri.trim()
    return uri ? { kind: "resource", ...(name ? { name } : {}), uri } : undefined
  }
  const path = resource.path.trim()
  if (!path) return undefined
  const mime = resource.mime?.trim()
  return {
    kind: resource.kind,
    ...(mime ? { mime } : {}),
    ...(name ? { name } : {}),
    path,
  }
}
