import { projectAssetGcMinimumIntervalMs, projectAssetGcOpenDelayMs, projectAssetGcRetryMs } from "@convax/project/node"

interface ProjectAssetGcPort {
  scan(projectId: string): Promise<void>
}

type ScheduleTimeout = (callback: () => void, delayMs: number) => () => void

interface ProjectAssetGcSchedulerOptions {
  gc: ProjectAssetGcPort
  scheduleTimeout?: ScheduleTimeout
}

interface ProjectSchedule {
  cancelTimer?: () => void
  inFlight?: Promise<void>
  projectId: string
}

export class ProjectAssetGcScheduler {
  readonly #gc: ProjectAssetGcPort
  readonly #projectGenerations = new Map<string, number>()
  readonly #projects = new Map<string, ProjectSchedule>()
  readonly #scheduleTimeout: ScheduleTimeout
  #disposed = false
  #globalGeneration = 0
  #globalTail: Promise<void> = Promise.resolve()

  constructor(options: ProjectAssetGcSchedulerOptions) {
    this.#gc = options.gc
    this.#scheduleTimeout = options.scheduleTimeout ?? scheduleRealTimeout
  }

  prepareOpen(projectId: string) {
    this.#assertActive()
    requireProjectId(projectId)
    const globalGeneration = this.#globalGeneration
    const projectGeneration = this.#projectGenerations.get(projectId) ?? 0
    let completed = false
    return () => {
      if (completed) return
      completed = true
      if (
        this.#disposed ||
        this.#globalGeneration !== globalGeneration ||
        (this.#projectGenerations.get(projectId) ?? 0) !== projectGeneration
      ) {
        return
      }
      this.open(projectId)
    }
  }

  open(projectId: string) {
    this.#assertActive()
    requireProjectId(projectId)
    if (this.#projects.has(projectId)) return
    const state = { projectId }
    this.#projects.set(projectId, state)
    this.#schedule(state, projectAssetGcOpenDelayMs)
  }

  request(projectId: string) {
    this.#assertActive()
    requireProjectId(projectId)
    const state = this.#projects.get(projectId)
    if (!state || state.inFlight) return
    state.cancelTimer?.()
    state.cancelTimer = undefined
    this.#schedule(state, 0)
  }

  close(projectId: string) {
    requireProjectId(projectId)
    this.#projectGenerations.set(projectId, (this.#projectGenerations.get(projectId) ?? 0) + 1)
    const state = this.#projects.get(projectId)
    if (!state) return
    this.#projects.delete(projectId)
    state.cancelTimer?.()
    state.cancelTimer = undefined
  }

  closeAll() {
    this.#globalGeneration += 1
    for (const state of this.#projects.values()) {
      state.cancelTimer?.()
      state.cancelTimer = undefined
    }
    this.#projects.clear()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.closeAll()
  }

  #schedule(state: ProjectSchedule, delayMs: number) {
    state.cancelTimer = this.#scheduleTimeout(() => {
      state.cancelTimer = undefined
      this.#start(state)
    }, delayMs)
  }

  #start(state: ProjectSchedule) {
    if (this.#projects.get(state.projectId) !== state || state.inFlight) return
    const scan = this.#globalTail
      .catch(() => undefined)
      .then(async () => {
        if (this.#projects.get(state.projectId) !== state) return
        let nextDelay = projectAssetGcMinimumIntervalMs
        try {
          await this.#gc.scan(state.projectId)
        } catch {
          nextDelay = projectAssetGcRetryMs
        }
        if (this.#projects.get(state.projectId) === state) this.#schedule(state, nextDelay)
      })
    const inFlight = scan.finally(() => {
      if (state.inFlight === inFlight) state.inFlight = undefined
    })
    state.inFlight = inFlight
    this.#globalTail = state.inFlight.catch(() => undefined)
  }

  #assertActive() {
    if (this.#disposed) throw new Error("Project asset GC scheduler is disposed")
  }
}

function scheduleRealTimeout(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs)
  timer.unref()
  return () => clearTimeout(timer)
}

function requireProjectId(projectId: string) {
  if (typeof projectId !== "string" || !projectId) throw new Error("Project id is required")
}
