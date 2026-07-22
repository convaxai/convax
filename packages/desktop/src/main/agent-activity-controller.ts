import { randomUUID } from "node:crypto"

import {
  agentActivityPriority,
  type AgentActivityState,
  type AgentRuntime,
  type AgentSessionState,
  projectAgentActivity,
} from "@convax/agent-runtime"
import type { ProjectRecord } from "@convax/project"

import type {
  PetActivitySnapshot,
  PetActivitySummary,
  PetActivityTarget,
  PetVisibleActivityState,
} from "../pet-contracts"

export interface AgentActivityClock {
  clearTimeout(handle: unknown): void
  now(): number
  setTimeout(handler: () => void, delay: number): unknown
}

export interface AgentActivityProjectProvider {
  list(): Promise<ProjectRecord[]>
  resolveEntryPath(input: { projectId: string }): Promise<string>
}

export interface AgentActivityControllerOptions {
  clock?: AgentActivityClock
  createId?: () => string
  maxActivities?: number
  pollMs?: number
  recoveryPollLimit?: number
  projects: AgentActivityProjectProvider
  runtime: Pick<AgentRuntime, "getSessionState" | "listSessions">
  watermarks?: AgentActivityWatermarkStore
}

export interface AgentActivityWatermarkStore {
  loadSeen(): Promise<Record<string, number>>
  markSeen(key: string, timestamp: number): Promise<void>
}

export interface AgentActivityMutationSink {
  aborted(projectId: string, sessionId: string): Promise<void>
  permissionReplied(projectId: string, requestId: string): Promise<void>
  promptSettled(projectId: string, sessionId: string, options?: { failed?: boolean }): Promise<void>
  promptStarted(projectId: string, sessionId: string): Promise<void>
  questionReplied(projectId: string, requestId: string): Promise<void>
}

interface ActivityRecord extends PetActivityTarget {
  canceled: boolean
  id: string
  projectName: string
  sessionName: string
  state: AgentActivityState
  updatedAt: number
}

interface ActivityRecoveryCandidate {
  directory: string
  project: ProjectRecord
  session: AgentSessionState["session"]
}

const defaultClock: AgentActivityClock = {
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  setTimeout: (handler, delay) => setTimeout(handler, delay),
}

const visibleStates = new Set<AgentActivityState["state"]>(["needs-input", "blocked", "ready", "running"])

function activityKey(projectId: string, sessionId: string) {
  return `${projectId}\u0000${sessionId}`
}

function compareRecords(left: ActivityRecord, right: ActivityRecord) {
  return (
    agentActivityPriority[left.state.state] - agentActivityPriority[right.state.state] ||
    right.updatedAt - left.updatedAt ||
    left.projectId.localeCompare(right.projectId) ||
    left.sessionId.localeCompare(right.sessionId)
  )
}

function toSummary(record: ActivityRecord): PetActivitySummary | null {
  if (!visibleStates.has(record.state.state)) return null
  const state = record.state.state as PetVisibleActivityState
  return {
    id: record.id,
    ...(record.state.state === "needs-input" ? { input: record.state.input } : {}),
    projectId: record.projectId,
    projectName: record.projectName,
    sessionId: record.sessionId,
    sessionName: record.sessionName,
    state,
    updatedAt: record.updatedAt,
  }
}

function sameActivities(left: readonly PetActivitySummary[], right: readonly PetActivitySummary[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class AgentActivityController {
  readonly #clock: AgentActivityClock
  readonly #createId: () => string
  readonly #listeners = new Set<(snapshot: PetActivitySnapshot) => void>()
  readonly #maxActivities: number
  readonly #pollMs: number
  readonly #recoveryPollLimit: number
  readonly #projects: AgentActivityProjectProvider
  readonly #records = new Map<string, ActivityRecord>()
  readonly #runtime: AgentActivityControllerOptions["runtime"]
  readonly #watermarks?: AgentActivityWatermarkStore
  readonly #seenAfter = new Map<string, number>()
  readonly #sessionGenerations = new Map<string, number>()
  #activeRecoveryCursor = 0
  #discoveryRecoveryCursor = 0
  #failureCount = 0
  #initialRecoveryComplete = false
  #snapshot: PetActivitySnapshot = { activities: [], revision: 0 }
  #started = false
  #timer: unknown

  constructor(options: AgentActivityControllerOptions) {
    this.#clock = options.clock ?? defaultClock
    this.#createId = options.createId ?? randomUUID
    this.#maxActivities = options.maxActivities ?? 256
    this.#pollMs = options.pollMs ?? 1_000
    this.#recoveryPollLimit = options.recoveryPollLimit ?? 16
    if (!Number.isSafeInteger(this.#maxActivities) || this.#maxActivities < 1 || this.#maxActivities > 256) {
      throw new Error("Agent activity maxActivities must be between 1 and 256")
    }
    if (!Number.isSafeInteger(this.#pollMs) || this.#pollMs < 100) {
      throw new Error("Agent activity pollMs must be at least 100 milliseconds")
    }
    if (!Number.isSafeInteger(this.#recoveryPollLimit) || this.#recoveryPollLimit < 1 || this.#recoveryPollLimit > 64) {
      throw new Error("Agent activity recoveryPollLimit must be between 1 and 64")
    }
    this.#projects = options.projects
    this.#runtime = options.runtime
    this.#watermarks = options.watermarks
  }

  getSnapshot(): PetActivitySnapshot {
    return {
      activities: this.#snapshot.activities.map((activity) => ({ ...activity })),
      revision: this.#snapshot.revision,
    }
  }

  subscribe(listener: (snapshot: PetActivitySnapshot) => void) {
    this.#listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.#listeners.delete(listener)
  }

  resolveActivity(activityId: string): PetActivityTarget | null {
    const record = [...this.#records.values()].find((candidate) => candidate.id === activityId)
    return record ? { projectId: record.projectId, sessionId: record.sessionId } : null
  }

  async start() {
    if (this.#started) return
    this.#started = true
    try {
      const seen = await this.#watermarks?.loadSeen()
      for (const [key, timestamp] of Object.entries(seen ?? {})) this.#rememberSeen(key, timestamp)
    } catch {
      // Activity remains available when local watermark persistence is temporarily unavailable.
    }
    await this.#poll()
  }

  stop() {
    this.#started = false
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer)
    this.#timer = undefined
  }

  async refresh() {
    const failed = await this.#refreshAll()
    if (!failed) this.#initialRecoveryComplete = true
    this.#failureCount = failed ? Math.min(this.#failureCount + 1, 6) : 0
  }

  async promptStarted(projectId: string, sessionId: string) {
    const key = activityKey(projectId, sessionId)
    const generation = this.#nextSessionGeneration(key)
    const record = await this.#ensureRecord(projectId, sessionId, generation)
    if (!record || !this.#isCurrentGeneration(key, generation)) return
    record.canceled = false
    record.state = { state: "running" }
    record.updatedAt = this.#clock.now()
    this.#publish()
  }

  async promptSettled(projectId: string, sessionId: string, options: { failed?: boolean } = {}) {
    const key = activityKey(projectId, sessionId)
    const generation = this.#nextSessionGeneration(key)
    const refreshed = await this.#refreshOne(projectId, sessionId, generation)
    if (!this.#isCurrentGeneration(key, generation)) return
    if (!refreshed) {
      const record = await this.#ensureRecord(projectId, sessionId, generation, false)
      if (!record || !this.#isCurrentGeneration(key, generation)) return
      record.state = options.failed ? { state: "blocked" } : { state: "ready" }
      record.updatedAt = this.#clock.now()
      this.#publish()
      return
    }
    if (options.failed && refreshed.state.state !== "blocked") refreshed.state = { state: "blocked" }
    this.#publish()
  }

  async aborted(projectId: string, sessionId: string) {
    const key = activityKey(projectId, sessionId)
    this.#nextSessionGeneration(key)
    const record = this.#records.get(key)
    if (!record) return
    record.canceled = true
    record.state = { state: "idle" }
    record.updatedAt = this.#clock.now()
    this.#publish()
  }

  async permissionReplied(projectId: string, _requestId: string) {
    await this.#refreshProject(projectId)
  }

  async questionReplied(projectId: string, _requestId: string) {
    await this.#refreshProject(projectId)
  }

  async projectChanged(_projectId?: string) {
    await this.refresh()
  }

  async markSeen(activityId: string, expectedRevision: number) {
    if (expectedRevision !== this.#snapshot.revision) throw new Error("Agent activity revision is stale")
    const record = [...this.#records.values()].find((candidate) => candidate.id === activityId)
    if (!record) throw new Error("Agent activity is no longer available")
    const key = activityKey(record.projectId, record.sessionId)
    const generation = this.#nextSessionGeneration(key)
    await this.#watermarks?.markSeen(key, record.updatedAt)
    this.#rememberSeen(key, record.updatedAt)
    if (!this.#isCurrentGeneration(key, generation)) return
    if (record.state.state === "ready" || record.state.state === "blocked") record.state = { state: "idle" }
    this.#publish(true)
  }

  async #poll() {
    await this.refresh()
    if (!this.#started) return
    const multiplier = 2 ** this.#failureCount
    const delay = Math.min(this.#pollMs * multiplier, 30_000)
    this.#timer = this.#clock.setTimeout(() => {
      void this.#poll()
    }, delay)
  }

  async #refreshAll() {
    let projects: ProjectRecord[]
    try {
      projects = (await this.#projects.list()).filter((project) => !project.missing)
    } catch {
      return true
    }
    const currentProjectIds = new Set(projects.map((project) => project.id))
    for (const [key, record] of this.#records) {
      if (!currentProjectIds.has(record.projectId)) this.#records.delete(key)
    }

    let runtimeFailed = false
    const candidates: ActivityRecoveryCandidate[] = []
    const listedSessions = new Map<string, Set<string>>()
    const orderedProjects = [...projects].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    for (const project of orderedProjects) {
      let directory: string
      try {
        directory = await this.#projects.resolveEntryPath({ projectId: project.id })
      } catch {
        continue
      }
      try {
        const sessions = (await this.#runtime.listSessions({ directory, limit: this.#maxActivities }))
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, this.#maxActivities)
        listedSessions.set(project.id, new Set(sessions.map((session) => activityKey(project.id, session.id))))
        for (const session of sessions) candidates.push({ directory, project, session })
      } catch {
        runtimeFailed = true
      }
    }

    for (const [key, record] of this.#records) {
      const seen = listedSessions.get(record.projectId)
      if (seen && !seen.has(key)) this.#records.delete(key)
    }

    const budget = this.#initialRecoveryComplete
      ? Math.min(this.#maxActivities, this.#recoveryPollLimit)
      : this.#maxActivities
    const orderedCandidates = candidates.sort(
      (left, right) =>
        right.session.updatedAt - left.session.updatedAt ||
        left.project.id.localeCompare(right.project.id) ||
        left.session.id.localeCompare(right.session.id),
    )
    const active = orderedCandidates.filter((candidate) => {
      const state = this.#records.get(activityKey(candidate.project.id, candidate.session.id))?.state.state
      return state === "running" || state === "needs-input"
    })
    active.sort((left, right) => {
      const leftState = this.#records.get(activityKey(left.project.id, left.session.id))!.state
      const rightState = this.#records.get(activityKey(right.project.id, right.session.id))!.state
      return (
        agentActivityPriority[leftState.state] - agentActivityPriority[rightState.state] ||
        right.session.updatedAt - left.session.updatedAt
      )
    })
    const activeKeys = new Set(active.map((candidate) => activityKey(candidate.project.id, candidate.session.id)))
    const discovery = orderedCandidates.filter(
      (candidate) => !activeKeys.has(activityKey(candidate.project.id, candidate.session.id)),
    )
    const selectedActive = this.#takeRecoveryCandidates(active, budget, true)
    const selected = [
      ...selectedActive,
      ...this.#takeRecoveryCandidates(discovery, budget - selectedActive.length, false),
    ].map((candidate) => ({
      ...candidate,
      generation: this.#nextSessionGeneration(activityKey(candidate.project.id, candidate.session.id)),
    }))

    for (const candidate of selected) {
      try {
        const sessionState = await this.#runtime.getSessionState({
          directory: candidate.directory,
          limit: 1,
          sessionId: candidate.session.id,
        })
        this.#upsert(candidate.project, sessionState, candidate.generation)
      } catch {
        runtimeFailed = true
      }
    }
    this.#trim()
    this.#publish()
    return runtimeFailed
  }

  #takeRecoveryCandidates(candidates: ActivityRecoveryCandidate[], count: number, active: boolean) {
    if (count <= 0 || candidates.length === 0) return []
    const cursor = (active ? this.#activeRecoveryCursor : this.#discoveryRecoveryCursor) % candidates.length
    const selected = Array.from(
      { length: Math.min(count, candidates.length) },
      (_, index) => candidates[(cursor + index) % candidates.length]!,
    )
    const next = (cursor + selected.length) % candidates.length
    if (active) this.#activeRecoveryCursor = next
    else this.#discoveryRecoveryCursor = next
    return selected
  }

  async #refreshProject(projectId: string, knownProject?: ProjectRecord, limit = this.#maxActivities) {
    const project = knownProject ?? (await this.#projects.list()).find((candidate) => candidate.id === projectId)
    if (!project || project.missing) return { failed: false, sessionCount: 0 }
    let directory: string
    try {
      directory = await this.#projects.resolveEntryPath({ projectId })
    } catch {
      return { failed: false, sessionCount: 0 }
    }
    try {
      const sessions = (await this.#runtime.listSessions({ directory, limit: this.#maxActivities }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, this.#maxActivities)
      const seen = new Set(sessions.map((session) => activityKey(project.id, session.id)))
      const selected = [...sessions]
        .sort((left, right) => {
          const leftState = this.#records.get(activityKey(project.id, left.id))?.state.state
          const rightState = this.#records.get(activityKey(project.id, right.id))?.state.state
          const leftActive = leftState === "running" || leftState === "needs-input" ? 0 : 1
          const rightActive = rightState === "running" || rightState === "needs-input" ? 0 : 1
          return leftActive - rightActive || right.updatedAt - left.updatedAt
        })
        .slice(0, limit)
      let failed = false
      for (const session of selected) {
        const key = activityKey(project.id, session.id)
        const generation = this.#nextSessionGeneration(key)
        try {
          const sessionState = await this.#runtime.getSessionState({ directory, limit: 1, sessionId: session.id })
          this.#upsert(project, sessionState, generation)
        } catch {
          failed = true
        }
      }
      if (!failed) {
        for (const [key, record] of this.#records) {
          if (record.projectId === project.id && !seen.has(key)) this.#records.delete(key)
        }
      }
      this.#trim()
      this.#publish()
      return { failed, sessionCount: selected.length }
    } catch {
      return { failed: true, sessionCount: 0 }
    }
  }

  async #refreshOne(projectId: string, sessionId: string, expectedGeneration?: number) {
    const project = (await this.#projects.list()).find((candidate) => candidate.id === projectId && !candidate.missing)
    if (!project) return null
    try {
      const directory = await this.#projects.resolveEntryPath({ projectId })
      const key = activityKey(projectId, sessionId)
      const generation = expectedGeneration ?? this.#nextSessionGeneration(key)
      const sessionState = await this.#runtime.getSessionState({ directory, limit: 1, sessionId })
      return this.#upsert(project, sessionState, generation)
    } catch {
      return null
    }
  }

  async #ensureRecord(projectId: string, sessionId: string, generation: number, refresh = true) {
    const current = this.#records.get(activityKey(projectId, sessionId))
    if (current) return current
    const refreshed = refresh ? await this.#refreshOne(projectId, sessionId, generation) : null
    if (refreshed) return refreshed
    if (!this.#isCurrentGeneration(activityKey(projectId, sessionId), generation)) return null
    const project = (await this.#projects.list()).find((candidate) => candidate.id === projectId && !candidate.missing)
    if (!project) return null
    const record: ActivityRecord = {
      canceled: false,
      id: this.#createId(),
      projectId,
      projectName: project.name,
      sessionId,
      sessionName: sessionId,
      state: { state: "idle" },
      updatedAt: this.#clock.now(),
    }
    this.#records.set(activityKey(projectId, sessionId), record)
    this.#trim()
    return record
  }

  #upsert(project: ProjectRecord, sessionState: AgentSessionState, generation: number) {
    const key = activityKey(project.id, sessionState.session.id)
    if (!this.#isCurrentGeneration(key, generation)) return null
    const existing = this.#records.get(key)
    const state = projectAgentActivity(sessionState, {
      canceled: existing?.canceled,
      seenAfter: this.#seenAfter.get(key),
    })
    const record: ActivityRecord = existing ?? {
      canceled: false,
      id: this.#createId(),
      projectId: project.id,
      projectName: project.name,
      sessionId: sessionState.session.id,
      sessionName: sessionState.session.title,
      state,
      updatedAt: sessionState.session.updatedAt,
    }
    record.projectName = project.name
    record.sessionName = sessionState.session.title
    record.state = state
    record.updatedAt = sessionState.session.updatedAt
    this.#records.set(key, record)
    return record
  }

  #nextSessionGeneration(key: string) {
    const generation = (this.#sessionGenerations.get(key) ?? 0) + 1
    this.#sessionGenerations.delete(key)
    this.#sessionGenerations.set(key, generation)
    while (this.#sessionGenerations.size > 512) {
      const oldest = this.#sessionGenerations.keys().next().value
      if (oldest === undefined) break
      this.#sessionGenerations.delete(oldest)
    }
    return generation
  }

  #isCurrentGeneration(key: string, generation: number) {
    return this.#sessionGenerations.get(key) === generation
  }

  #rememberSeen(key: string, value: number) {
    this.#seenAfter.delete(key)
    this.#seenAfter.set(key, value)
    while (this.#seenAfter.size > 256) {
      const oldest = this.#seenAfter.keys().next().value
      if (oldest === undefined) break
      this.#seenAfter.delete(oldest)
    }
  }

  #trim() {
    const ordered = [...this.#records.values()].sort(compareRecords)
    const retained = new Set(
      ordered.slice(0, this.#maxActivities).map((record) => activityKey(record.projectId, record.sessionId)),
    )
    for (const key of this.#records.keys()) {
      if (!retained.has(key)) this.#records.delete(key)
    }
  }

  #publish(force = false) {
    const activities = [...this.#records.values()]
      .sort(compareRecords)
      .map(toSummary)
      .filter((activity): activity is PetActivitySummary => activity !== null)
      .slice(0, this.#maxActivities)
    if (!force && sameActivities(activities, this.#snapshot.activities)) return
    this.#snapshot = { activities, revision: this.#snapshot.revision + 1 }
    const snapshot = this.getSnapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
