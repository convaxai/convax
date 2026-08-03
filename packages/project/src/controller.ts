import type {
  ProjectLifecycleClient,
  ProjectRecord,
  ProjectSelectionResult,
} from "./contracts"

export interface ProjectControllerSnapshot {
  activeProjectId: string | null
  changingActiveProject: boolean
  error: string | null
  initialized: boolean
  /** Renderer-session selection only; never persisted or treated as Project authority. */
  pendingRecoveryProjectId: string | null
  projects: ProjectRecord[]
}

const initialSnapshot: ProjectControllerSnapshot = {
  activeProjectId: null,
  changingActiveProject: false,
  error: null,
  initialized: false,
  pendingRecoveryProjectId: null,
  projects: [],
}

export interface ProjectControllerOptions {
  beforeActiveProjectChange?: (
    currentProjectId: string | null,
    nextProjectId: string | null,
  ) => Promise<boolean | void> | boolean | void
  onActiveProjectChangeCanceled?: () => void
}

export class ProjectController {
  private snapshot = initialSnapshot
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private selectionRequest = 0
  private transitionRequest = 0
  private initializing: Promise<void> | null = null
  private readonly forgettingProjectIds = new Set<string>()

  constructor(
    private readonly client: ProjectLifecycleClient,
    private readonly options: ProjectControllerOptions = {},
  ) {}

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize() {
    if (this.initializing) return this.initializing
    this.initializing = this.runInitialize().finally(() => {
      this.initializing = null
    })
    return this.initializing
  }

  private async runInitialize() {
    const generation = ++this.generation
    try {
      const { projects } = await this.client.listProjects()
      if (generation !== this.generation) return
      const activeProjectId = this.snapshot.activeProjectId && projects.some(
        (project) => project.id === this.snapshot.activeProjectId && isOpenableProject(project),
      )
        ? this.snapshot.activeProjectId
        : (projects.find(isOpenableProject)?.id ?? null)
      if (activeProjectId === null) {
        const pendingRecoveryProjectId = selectStartupRecoveryProjectId(projects)
        if (this.snapshot.activeProjectId !== null) {
          this.applyActiveProject(null, { initialized: true, projects }, pendingRecoveryProjectId)
        } else {
          this.update({
            changingActiveProject: false,
            error: null,
            initialized: true,
            pendingRecoveryProjectId,
            projects,
          })
        }
        return
      }
      // Listing is discovery only. A restored Project must cross the same Main
      // activation/touch barrier as an explicit selection before renderer state
      // starts addressing its Canvas routes.
      this.update({ changingActiveProject: true, error: null, pendingRecoveryProjectId: null, projects })
      const activated = await this.client.touchProject({ projectId: activeProjectId })
      if (generation !== this.generation) return
      this.applyActiveProject(activeProjectId, { initialized: true, projects: activated.projects })
    } catch (error) {
      if (generation !== this.generation) return
      this.update({ changingActiveProject: false, error: errorMessage(error), initialized: true })
    }
  }

  async activate(projectId: string) {
    if (this.snapshot.changingActiveProject) return
    const project = this.snapshot.projects.find((candidate) => candidate.id === projectId)
    if (!project) return this.update({ error: "Project was not found." })
    if (project.missing) return this.update({ error: `Project folder is unavailable: ${project.rootPath}` })
    if (this.forgettingProjectIds.has(projectId)) return this.update({ error: "This project is being removed." })
    const request = ++this.transitionRequest
    if (projectId === this.snapshot.activeProjectId) {
      try {
        const result = await this.client.touchProject({ projectId })
        if (request !== this.transitionRequest) return
        this.update({ error: null, projects: result.projects })
      } catch (error) {
        if (request === this.transitionRequest) this.update({ error: errorMessage(error) })
      }
      return
    }
    this.update({ changingActiveProject: true, error: null })
    try {
      const proceed = await this.options.beforeActiveProjectChange?.(this.snapshot.activeProjectId, projectId)
      if (request !== this.transitionRequest) return
      if (proceed === false) {
        this.options.onActiveProjectChangeCanceled?.()
        this.update({ changingActiveProject: false, error: null })
        return
      }
      const result = await this.client.touchProject({ projectId })
      if (request !== this.transitionRequest) return
      this.update({ projects: result.projects })
      this.applyActiveProject(projectId)
    } catch (error) {
      if (request === this.transitionRequest) {
        this.options.onActiveProjectChangeCanceled?.()
        this.update({ changingActiveProject: false, error: errorMessage(error) })
      }
    }
  }

  async openProject() {
    if (this.snapshot.changingActiveProject) return false
    return this.selectProject(() => this.client.openProject())
  }

  async createProject(name: string) {
    if (this.snapshot.changingActiveProject || !name.trim()) return false
    return this.selectProject(() => this.client.createProject({ name: name.trim() }))
  }

  private async selectProject(select: () => Promise<ProjectSelectionResult>) {
    const request = ++this.selectionRequest
    try {
      const result = await select()
      if (request !== this.selectionRequest) return false
      this.update({ error: null, initialized: true, projects: result.projects })
      if (result.canceled || !result.project) return false
      if (result.project.recovery && result.project.recovery.status !== "current") {
        this.update({ pendingRecoveryProjectId: result.project.id })
        return false
      }
      this.update({ pendingRecoveryProjectId: null })
      await this.activate(result.project.id)
      return this.snapshot.activeProjectId === result.project.id && this.snapshot.error === null
    } catch (error) {
      if (request === this.selectionRequest) this.update({ error: errorMessage(error) })
      return false
    }
  }

  async renameProject(projectId: string, name: string) {
    if (!name.trim()) return
    const generation = this.generation
    try {
      const result = await this.client.renameProject({ name: name.trim(), projectId })
      if (generation === this.generation) this.update({ error: null, projects: result.projects })
    } catch (error) {
      if (generation === this.generation) this.update({ error: errorMessage(error) })
    }
  }

  async forgetProject(projectId: string) {
    if (this.snapshot.changingActiveProject || this.forgettingProjectIds.has(projectId)) return
    const removesActiveProject = projectId === this.snapshot.activeProjectId
    const request = removesActiveProject ? ++this.transitionRequest : null
    if (removesActiveProject) {
      this.update({ changingActiveProject: true, error: null })
      try {
        const proceed = await this.options.beforeActiveProjectChange?.(projectId, null)
        if (request !== this.transitionRequest) return
        if (proceed === false) {
          this.options.onActiveProjectChangeCanceled?.()
          this.update({ changingActiveProject: false, error: null })
          return
        }
      } catch (error) {
        if (request === this.transitionRequest) {
          this.options.onActiveProjectChangeCanceled?.()
          this.update({ changingActiveProject: false, error: errorMessage(error) })
        }
        return
      }
      if (request !== this.transitionRequest) return
    }
    this.forgettingProjectIds.add(projectId)
    try {
      const result = await this.client.forgetProject({ projectId })
      const activeProjectId = this.snapshot.activeProjectId
      if (activeProjectId && result.projects.some((project) => project.id === activeProjectId)) {
        if (removesActiveProject) this.options.onActiveProjectChangeCanceled?.()
        return this.update({
          changingActiveProject: request === this.transitionRequest ? false : this.snapshot.changingActiveProject,
          error: null,
          projects: result.projects,
        })
      }
      // Forgetting while no Project is active is inventory-only. It must not
      // implicitly select a fallback or enter an activation lane without a
      // transition request that can prove currentness.
      if (!removesActiveProject) {
        this.update({
          changingActiveProject: false,
          error: null,
          pendingRecoveryProjectId:
            this.snapshot.pendingRecoveryProjectId === projectId
              ? selectStartupRecoveryProjectId(result.projects)
              : this.snapshot.pendingRecoveryProjectId,
          projects: result.projects,
        })
        return
      }
      const next = result.projects.find(isOpenableProject)
      const pendingRecoveryProjectId = next ? null : selectStartupRecoveryProjectId(result.projects)
      // Main has already quiesced the removed Project before publishing this
      // result. Clear the renderer authority immediately, then cross the same
      // touch/activation barrier before exposing any fallback Project.
      this.generation += 1
      this.update({
        activeProjectId: null,
        changingActiveProject: Boolean(next),
        error: null,
        pendingRecoveryProjectId,
        projects: result.projects,
      })
      if (!next) return
      try {
        const activated = await this.client.touchProject({ projectId: next.id })
        if (request !== this.transitionRequest) return
        this.applyActiveProject(next.id, { projects: activated.projects })
      } catch (error) {
        if (request === this.transitionRequest) {
          this.update({ changingActiveProject: false, error: errorMessage(error) })
        }
      }
    } catch (error) {
      if (removesActiveProject && request === this.transitionRequest) {
        this.options.onActiveProjectChangeCanceled?.()
      }
      this.update({
        changingActiveProject: request === this.transitionRequest ? false : this.snapshot.changingActiveProject,
        error: errorMessage(error),
      })
    } finally {
      this.forgettingProjectIds.delete(projectId)
    }
  }

  clearError() {
    this.update({ error: null })
  }

  dismissPendingRecoveryProject(projectId: string) {
    if (this.snapshot.pendingRecoveryProjectId === projectId) {
      this.update({ pendingRecoveryProjectId: null })
    }
  }

  dispose() {
    this.generation += 1
    this.selectionRequest += 1
    this.transitionRequest += 1
    this.listeners.clear()
  }

  private applyActiveProject(
    projectId: string | null,
    patch: Pick<Partial<ProjectControllerSnapshot>, "initialized" | "projects"> = {},
    pendingRecoveryProjectId: string | null = null,
  ) {
    this.generation += 1
    this.update({
      ...patch,
      activeProjectId: projectId,
      changingActiveProject: false,
      error: null,
      pendingRecoveryProjectId,
    })
  }

  private update(patch: Partial<ProjectControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isOpenableProject(project: ProjectRecord) {
  return !project.missing && (!project.recovery || project.recovery.status === "current")
}

function selectStartupRecoveryProjectId(projects: readonly ProjectRecord[]) {
  return projects
    .filter(
      (project) =>
        !project.missing &&
        project.recovery?.status === "unsupported-portable-project-version",
    )
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt || left.id.localeCompare(right.id))[0]?.id ?? null
}
