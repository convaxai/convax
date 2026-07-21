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
  projects: ProjectRecord[]
}

const initialSnapshot: ProjectControllerSnapshot = {
  activeProjectId: null,
  changingActiveProject: false,
  error: null,
  initialized: false,
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
      const activeProjectId = this.snapshot.activeProjectId && projects.some((project) => project.id === this.snapshot.activeProjectId)
        ? this.snapshot.activeProjectId
        : (projects.find((project) => !project.missing)?.id ?? null)
      this.update({ changingActiveProject: false, error: null, initialized: true, projects })
      if (activeProjectId !== this.snapshot.activeProjectId) this.applyActiveProject(activeProjectId)
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
    if (projectId === this.snapshot.activeProjectId) return
    const request = ++this.transitionRequest
    this.update({ changingActiveProject: true, error: null })
    try {
      const proceed = await this.options.beforeActiveProjectChange?.(this.snapshot.activeProjectId, projectId)
      if (request !== this.transitionRequest) return
      if (proceed === false) {
        this.options.onActiveProjectChangeCanceled?.()
        this.update({ changingActiveProject: false, error: null })
        return
      }
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
      await this.activate(result.project.id)
      return true
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
      const next = result.projects.find((project) => !project.missing)
      this.update({ projects: result.projects })
      this.applyActiveProject(next?.id ?? null)
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

  dispose() {
    this.generation += 1
    this.selectionRequest += 1
    this.transitionRequest += 1
    this.listeners.clear()
  }

  private applyActiveProject(projectId: string | null) {
    this.generation += 1
    this.update({
      activeProjectId: projectId,
      changingActiveProject: false,
      error: null,
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
