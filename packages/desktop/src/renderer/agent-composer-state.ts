import type { AgentResource, AgentSkill } from "@convax/agent-runtime"

export type AgentComposerSegment = { type: "text"; text: string } | { type: "skill"; name: string }

export interface AgentComposerDraft {
  segments: AgentComposerSegment[]
}

export interface AgentSkillSlashQuery {
  end: number
  query: string
  start: number
}

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

export type AgentResourcePickerSection = "skills" | "project" | "canvases"

export interface AgentResourcePickerOption {
  active?: boolean
  description?: string
  id: string
  label: string
  resource: AgentResource
  section: AgentResourcePickerSection
}

export const emptyAgentComposerDraft = (): AgentComposerDraft => ({ segments: [] })

export function normalizeAgentComposerDraft(draft: AgentComposerDraft): AgentComposerDraft {
  const segments: AgentComposerSegment[] = []
  for (const segment of draft.segments) {
    if (segment.type === "skill") {
      const name = segment.name.trim()
      if (name) segments.push({ name, type: "skill" })
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

export function agentComposerSkills(draft: AgentComposerDraft): AgentResource[] {
  const seen = new Set<string>()
  return normalizeAgentComposerDraft(draft).segments.flatMap((segment) => {
    if (segment.type !== "skill" || seen.has(segment.name)) return []
    seen.add(segment.name)
    return [{ kind: "skill" as const, name: segment.name }]
  })
}

export function hasAgentComposerContent(draft: AgentComposerDraft) {
  return Boolean(agentComposerText(draft).trim() || agentComposerSkills(draft).length)
}

export function shouldShowAgentComposerPlaceholder(draft: AgentComposerDraft, focused: boolean) {
  return !focused && !hasAgentComposerContent(draft)
}

/**
 * Detects a Skill slash query immediately before the caret. Slash commands are
 * only recognized at the start of a text run or after whitespace, so URLs and
 * ordinary division expressions do not unexpectedly open the picker.
 */
export function findAgentSkillSlashQuery(text: string, caret: number): AgentSkillSlashQuery | undefined {
  if (!Number.isSafeInteger(caret) || caret < 0 || caret > text.length) return undefined
  const beforeCaret = text.slice(0, caret)
  const match = /(?:^|\s)\/([\p{L}\p{N}._-]*)$/u.exec(beforeCaret)
  if (!match) return undefined
  const query = match[1] ?? ""
  const start = caret - query.length - 1
  return { end: caret, query, start }
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
  return { ...state, activeId: options[0]?.id }
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

export function filterAgentResourcePickerOptions(options: readonly AgentResourcePickerOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...options]
  return options.filter((option) =>
    `${option.label} ${option.description ?? ""}`.toLocaleLowerCase().includes(normalized),
  )
}

export function selectableAgentResourcePickerOptions(
  options: readonly AgentResourcePickerOption[],
  loading: { project: boolean; skills: boolean },
) {
  return options.filter(
    (option) => !(loading.project && option.section === "project") && !(loading.skills && option.section === "skills"),
  )
}

export function shouldDismissAgentResourcePicker<T>(
  surface: { contains(target: T): boolean } | null,
  target: T | null,
) {
  return !surface || target === null || !surface.contains(target)
}
