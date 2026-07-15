import type {
  ProjectCanvas,
  ProjectClient,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectEntryKind,
  ProjectRecord,
  ProjectSelectionResult,
  ProjectTextPreviewContents,
  ProjectWorkspace,
} from "./contracts"

export interface ProjectSelectionIntent {
  range: boolean
  toggle: boolean
}

export interface ProjectControllerSnapshot {
  activeCanvasId: string | null
  activeProjectId: string | null
  canvases: ProjectCanvas[]
  changingActiveCanvas: boolean
  changingActiveProject: boolean
  error: string | null
  expandedPaths: string[]
  initialized: boolean
  listings: Record<string, ProjectDirectoryListing>
  loadingPaths: string[]
  projects: ProjectRecord[]
  selectedPaths: string[]
}

const initialSnapshot: ProjectControllerSnapshot = {
  activeCanvasId: null,
  activeProjectId: null,
  canvases: [],
  changingActiveCanvas: false,
  changingActiveProject: false,
  error: null,
  expandedPaths: [],
  initialized: false,
  listings: {},
  loadingPaths: [],
  projects: [],
  selectedPaths: [],
}

export interface ProjectControllerOptions {
  beforeActiveCanvasChange?: (
    projectId: string,
    currentCanvasId: string | null,
    nextCanvasId: string | null,
  ) => Promise<void> | void
  beforeActiveProjectChange?: (currentProjectId: string | null, nextProjectId: string | null) => Promise<void> | void
  onActiveCanvasChangeCanceled?: () => void
  onActiveProjectChangeCanceled?: () => void
}

export class ProjectController {
  private snapshot = initialSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly directoryRequests = new Map<string, number>()
  private generation = 0
  private selectionRequest = 0
  private transitionRequest = 0
  private canvasTransitionRequest = 0
  private workspaceRequest = 0
  private initializing: Promise<void> | null = null
  private changeTimer: ReturnType<typeof setTimeout> | undefined
  private pendingDirectoryRefresh = false
  private pendingWorkspaceRefresh = false
  private readonly forgettingProjectIds = new Set<string>()
  private readonly stopChanges: () => void

  constructor(
    private readonly client: ProjectClient,
    private readonly options: ProjectControllerOptions = {},
  ) {
    this.stopChanges = client.onDidChange((event) => {
      if (event.projectId !== this.snapshot.activeProjectId) return
      if (event.kind === "workspace") this.pendingWorkspaceRefresh = true
      else this.pendingDirectoryRefresh = true
      if (this.changeTimer) clearTimeout(this.changeTimer)
      this.changeTimer = setTimeout(() => {
        this.changeTimer = undefined
        const refreshDirectories = this.pendingDirectoryRefresh
        const refreshWorkspace = this.pendingWorkspaceRefresh
        this.pendingDirectoryRefresh = false
        this.pendingWorkspaceRefresh = false
        void Promise.all([
          refreshDirectories ? this.refreshVisibleDirectories() : Promise.resolve(),
          refreshWorkspace ? this.loadWorkspace() : Promise.resolve(),
        ])
      }, 120)
    })
  }

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
      this.update({ initialized: true, projects })
      if (activeProjectId === this.snapshot.activeProjectId) {
        if (activeProjectId) {
          await Promise.all([
            this.loadDirectory("", generation),
            this.loadWorkspace(generation),
          ])
        }
      } else if (activeProjectId) {
        await this.activate(activeProjectId)
      } else {
        await this.applyActiveProject(null)
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.update({ changingActiveProject: false, error: errorMessage(error), initialized: true })
    }
  }

  async activate(projectId: string) {
    if (this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas) return
    const project = this.snapshot.projects.find((candidate) => candidate.id === projectId)
    if (!project) return this.update({ error: "Project was not found." })
    if (project.missing) return this.update({ error: `Project folder is unavailable: ${project.rootPath}` })
    if (this.forgettingProjectIds.has(projectId)) return this.update({ error: "This project is being removed." })
    if (projectId === this.snapshot.activeProjectId) return
    const request = ++this.transitionRequest
    this.update({ changingActiveProject: true, error: null })
    try {
      await this.options.beforeActiveProjectChange?.(this.snapshot.activeProjectId, projectId)
      if (request !== this.transitionRequest) return
      await this.applyActiveProject(projectId)
    } catch (error) {
      if (request === this.transitionRequest) {
        this.options.onActiveProjectChangeCanceled?.()
        this.update({ changingActiveProject: false, error: errorMessage(error) })
      }
    }
  }

  async activateCanvas(canvasId: string) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId || this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas) return
    if (!this.snapshot.canvases.some((canvas) => canvas.id === canvasId)) {
      this.update({ error: "Canvas was not found." })
      return
    }
    const currentCanvasId = this.snapshot.activeCanvasId
    if (canvasId === currentCanvasId) return
    const generation = this.generation
    const request = ++this.canvasTransitionRequest
    this.workspaceRequest += 1
    this.update({ changingActiveCanvas: true, error: null })
    try {
      await this.options.beforeActiveCanvasChange?.(projectId, currentCanvasId, canvasId)
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      const workspace = await this.client.activateCanvas({ canvasId, projectId })
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      if (!this.applyWorkspace(workspace, projectId, generation)) throw new Error("Workspace response did not match the active project.")
      this.update({ changingActiveCanvas: false, error: null })
    } catch (error) {
      this.cancelCanvasTransition(projectId, generation, request, error)
    }
  }

  async createCanvas(name?: string) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId || this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas) return
    const generation = this.generation
    const currentCanvasId = this.snapshot.activeCanvasId
    const request = ++this.canvasTransitionRequest
    this.workspaceRequest += 1
    this.update({ changingActiveCanvas: true, error: null })
    let createdWorkspace: ProjectWorkspace | undefined
    let createdCanvasId: string | undefined
    try {
      const result = await this.client.createCanvas({
        name: name?.trim() || undefined,
        projectId,
      })
      createdWorkspace = result.workspace
      createdCanvasId = result.canvas.id
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      await this.options.beforeActiveCanvasChange?.(projectId, currentCanvasId, result.canvas.id)
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      const workspace = await this.client.activateCanvas({ canvasId: result.canvas.id, projectId })
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      if (!this.applyWorkspace(workspace, projectId, generation)) throw new Error("Workspace response did not match the active project.")
      this.update({ changingActiveCanvas: false, error: null })
      return result.canvas
    } catch (error) {
      if (createdCanvasId && this.isCurrentCanvasTransition(projectId, generation, request)) {
        try {
          const rollback = await this.client.deleteCanvas({ canvasId: createdCanvasId, projectId })
          if (this.isCurrentCanvasTransition(projectId, generation, request)) createdWorkspace = rollback.workspace
        } catch {
          // Keep the durable canvas visible when rollback cannot be completed.
        }
      }
      if (createdWorkspace && this.isCurrentCanvasTransition(projectId, generation, request)) {
        this.applyWorkspace(createdWorkspace, projectId, generation, currentCanvasId)
      }
      this.cancelCanvasTransition(projectId, generation, request, error)
    }
  }

  async renameCanvas(canvasId: string, name: string) {
    const projectId = this.snapshot.activeProjectId
    const trimmedName = name.trim()
    if (!projectId || !trimmedName || this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas) return
    if (!this.snapshot.canvases.some((canvas) => canvas.id === canvasId)) {
      this.update({ error: "Canvas was not found." })
      return
    }
    const generation = this.generation
    this.workspaceRequest += 1
    try {
      const result = await this.client.renameCanvas({ canvasId, name: trimmedName, projectId })
      if (!this.isActive(projectId, generation)) return
      if (!this.applyWorkspace(result.workspace, projectId, generation)) throw new Error("Workspace response did not match the active project.")
      this.update({ error: null })
      return result.canvas
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async deleteCanvas(canvasId: string) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId || this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas) return
    if (!this.snapshot.canvases.some((canvas) => canvas.id === canvasId)) {
      this.update({ error: "Canvas was not found." })
      return
    }
    const generation = this.generation
    const removesActiveCanvas = canvasId === this.snapshot.activeCanvasId
    if (!removesActiveCanvas) {
      this.workspaceRequest += 1
      try {
        const result = await this.client.deleteCanvas({ canvasId, projectId })
        if (!this.isActive(projectId, generation)) return
        if (!this.applyWorkspace(result.workspace, projectId, generation)) throw new Error("Workspace response did not match the active project.")
        this.update({ error: null })
        return result.deleted
      } catch (error) {
        if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
        return
      }
    }

    const currentCanvasId = this.snapshot.activeCanvasId
    const nextCanvasId = this.snapshot.canvases.find((canvas) => canvas.id !== canvasId)?.id ?? null
    const request = ++this.canvasTransitionRequest
    this.workspaceRequest += 1
    this.update({ changingActiveCanvas: true, error: null })
    try {
      await this.options.beforeActiveCanvasChange?.(projectId, currentCanvasId, nextCanvasId)
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      const result = await this.client.deleteCanvas({ canvasId, projectId })
      if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
      if (!this.applyWorkspace(result.workspace, projectId, generation)) throw new Error("Workspace response did not match the active project.")
      if (!result.deleted) throw new Error("Canvas could not be deleted.")
      this.update({ changingActiveCanvas: false, error: null })
      return result.deleted
    } catch (error) {
      this.cancelCanvasTransition(projectId, generation, request, error)
    }
  }

  async readTextPreview(path: string): Promise<ProjectTextPreviewContents | undefined> {
    const projectId = this.snapshot.activeProjectId
    if (!projectId) return
    const generation = this.generation
    try {
      const preview = await this.client.readTextPreview({ path, projectId })
      return this.isActive(projectId, generation) ? preview : undefined
    } catch {
      return
    }
  }

  async openProject() {
    if (this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas) return
    await this.selectProject(() => this.client.openProject())
  }

  async createProject(name: string) {
    if (this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas || !name.trim()) return
    await this.selectProject(() => this.client.createProject({ name: name.trim() }))
  }

  private async selectProject(select: () => Promise<ProjectSelectionResult>) {
    const request = ++this.selectionRequest
    try {
      const result = await select()
      if (request !== this.selectionRequest) return
      this.update({ error: null, initialized: true, projects: result.projects })
      if (!result.canceled && result.project) await this.activate(result.project.id)
    } catch (error) {
      if (request === this.selectionRequest) this.update({ error: errorMessage(error) })
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
    if (this.snapshot.changingActiveProject || this.snapshot.changingActiveCanvas || this.forgettingProjectIds.has(projectId)) return
    const removesActiveProject = projectId === this.snapshot.activeProjectId
    const request = removesActiveProject ? ++this.transitionRequest : null
    if (removesActiveProject) {
      this.update({ changingActiveProject: true, error: null })
      try {
        await this.options.beforeActiveProjectChange?.(projectId, null)
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
      await this.applyActiveProject(next?.id ?? null)
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

  async loadDirectory(path = "", expectedGeneration = this.generation) {
    if (expectedGeneration !== this.generation) return
    const projectId = this.snapshot.activeProjectId
    if (!projectId) return
    const requestId = (this.directoryRequests.get(path) ?? 0) + 1
    this.directoryRequests.set(path, requestId)
    this.update({ loadingPaths: addUnique(this.snapshot.loadingPaths, path) })
    try {
      const listing = await this.client.listDirectory({ path, projectId })
      if (!this.isCurrentDirectoryRequest(projectId, path, requestId, expectedGeneration)) return
      this.update({
        error: null,
        listings: { ...this.snapshot.listings, [path]: listing },
      })
    } catch (error) {
      if (this.isCurrentDirectoryRequest(projectId, path, requestId, expectedGeneration)) {
        this.update({ error: errorMessage(error) })
      }
    } finally {
      if (this.isCurrentDirectoryRequest(projectId, path, requestId, expectedGeneration)) {
        this.update({ loadingPaths: this.snapshot.loadingPaths.filter((candidate) => candidate !== path) })
      }
    }
  }

  private async loadWorkspace(expectedGeneration = this.generation) {
    if (expectedGeneration !== this.generation) return
    const projectId = this.snapshot.activeProjectId
    if (!projectId) return
    const request = ++this.workspaceRequest
    try {
      const workspace = await this.client.getWorkspace({ projectId })
      if (!this.isCurrentWorkspaceRequest(projectId, expectedGeneration, request)) return
      if (!this.applyWorkspace(workspace, projectId, expectedGeneration)) {
        this.update({ error: "Workspace response did not match the active project." })
        return
      }
      this.update({ error: null })
    } catch (error) {
      if (this.isCurrentWorkspaceRequest(projectId, expectedGeneration, request)) {
        this.update({ error: errorMessage(error) })
      }
    }
  }

  private isCurrentDirectoryRequest(projectId: string, path: string, requestId: number, generation: number) {
    return generation === this.generation
      && projectId === this.snapshot.activeProjectId
      && this.directoryRequests.get(path) === requestId
  }

  private isCurrentWorkspaceRequest(projectId: string, generation: number, request: number) {
    return this.isActive(projectId, generation) && request === this.workspaceRequest
  }

  async toggleDirectory(path: string) {
    if (this.snapshot.expandedPaths.includes(path)) {
      this.update({ expandedPaths: this.snapshot.expandedPaths.filter((candidate) => candidate !== path) })
      return
    }
    this.update({ expandedPaths: [...this.snapshot.expandedPaths, path] })
    await this.loadDirectory(path)
  }

  async refreshVisibleDirectories() {
    if (!this.snapshot.activeProjectId) return
    const paths = ["", ...this.snapshot.expandedPaths.filter((path) => this.snapshot.listings[path])]
    await Promise.all(paths.map((path) => this.loadDirectory(path)))
  }

  selectEntry(path: string, intent: ProjectSelectionIntent) {
    const visiblePaths = this.getVisibleEntries().map((entry) => entry.path)
    if (intent.range && this.snapshot.selectedPaths.length > 0) {
      const anchorIndex = visiblePaths.indexOf(this.snapshot.selectedPaths[0])
      const targetIndex = visiblePaths.indexOf(path)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        this.update({ selectedPaths: visiblePaths.slice(start, end + 1) })
        return
      }
    }
    if (intent.toggle) {
      const selected = new Set(this.snapshot.selectedPaths)
      if (selected.has(path)) selected.delete(path)
      else selected.add(path)
      this.update({ selectedPaths: visiblePaths.filter((candidate) => selected.has(candidate)) })
      return
    }
    this.update({ selectedPaths: [path] })
  }

  clearSelection() {
    this.update({ selectedPaths: [] })
  }

  clearError() {
    this.update({ error: null })
  }

  async createEntry(input: { content?: string; kind: ProjectEntryKind; name: string; parentPath?: string }) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId) return
    const generation = this.generation
    try {
      const result = await this.client.createEntry({ ...input, parentPath: input.parentPath ?? "", projectId })
      if (!this.isActive(projectId, generation)) return
      await this.loadDirectory(input.parentPath ?? "", generation)
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths?.slice(-1) ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async renameEntry(path: string, name: string) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId || !name.trim()) return
    const generation = this.generation
    try {
      const result = await this.client.renameEntry({ name: name.trim(), path, projectId })
      if (!this.isActive(projectId, generation)) return
      const parentPath = parentOf(path)
      this.pruneSubtrees([path])
      await this.loadDirectory(parentPath, generation)
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths?.slice(-1) ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async moveEntries(paths: string[], destinationPath = "") {
    const projectId = this.snapshot.activeProjectId
    const roots = normalizeSelectionRoots(paths)
    if (!projectId || roots.length === 0) return
    const generation = this.generation
    try {
      const result = await this.client.moveEntries({ destinationPath, paths: roots, projectId })
      if (!this.isActive(projectId, generation)) return
      const parents = new Set([destinationPath, ...roots.map(parentOf)])
      this.pruneSubtrees(roots)
      await Promise.all([...parents].map((path) => this.loadDirectory(path, generation)))
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async deleteEntries(paths: string[]) {
    const projectId = this.snapshot.activeProjectId
    const roots = normalizeSelectionRoots(paths)
    if (!projectId || roots.length === 0) return
    const generation = this.generation
    try {
      await this.client.deleteEntries({ paths: roots, projectId })
      if (!this.isActive(projectId, generation)) return
      const parents = new Set(roots.map(parentOf))
      this.pruneSubtrees(roots)
      await Promise.all([...parents].map((path) => this.loadDirectory(path, generation)))
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async importEntries(sourceTokens: string[], destinationPath = "") {
    const projectId = this.snapshot.activeProjectId
    const tokens = [...new Set(sourceTokens.filter(Boolean))]
    if (!projectId || tokens.length === 0) return
    const generation = this.generation
    try {
      const result = await this.client.importEntries({ destinationPath, projectId, sourceTokens: tokens })
      if (!this.isActive(projectId, generation)) return
      await this.loadDirectory(destinationPath, generation)
      if (!this.isActive(projectId, generation)) return
      this.update({ error: null, selectedPaths: result.targetPaths ?? [] })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async importDroppedFiles(files: readonly File[], destinationPath = "") {
    await this.importEntries(files.map((file) => this.client.createImportToken(file)).filter(Boolean), destinationPath)
  }

  async revealEntry(path?: string) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId) return
    const generation = this.generation
    try {
      await this.client.revealEntry({ path, projectId })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  async openEntry(path: string) {
    const projectId = this.snapshot.activeProjectId
    if (!projectId) return
    const generation = this.generation
    try {
      const result = await this.client.openEntry({ path, projectId })
      if (result.error && this.isActive(projectId, generation)) this.update({ error: result.error })
    } catch (error) {
      if (this.isActive(projectId, generation)) this.update({ error: errorMessage(error) })
    }
  }

  dispose() {
    this.generation += 1
    this.selectionRequest += 1
    this.transitionRequest += 1
    this.canvasTransitionRequest += 1
    this.workspaceRequest += 1
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.pendingDirectoryRefresh = false
    this.pendingWorkspaceRefresh = false
    this.stopChanges()
    this.listeners.clear()
  }

  private getVisibleEntries() {
    const entries: ProjectEntry[] = []
    const visit = (path: string) => {
      for (const entry of this.snapshot.listings[path]?.entries ?? []) {
        entries.push(entry)
        if (entry.kind === "directory" && this.snapshot.expandedPaths.includes(entry.path)) visit(entry.path)
      }
    }
    visit("")
    return entries
  }

  private isActive(projectId: string, generation: number) {
    return projectId === this.snapshot.activeProjectId && generation === this.generation
  }

  private isCurrentCanvasTransition(projectId: string, generation: number, request: number) {
    return this.isActive(projectId, generation) && request === this.canvasTransitionRequest
  }

  private applyWorkspace(
    workspace: ProjectWorkspace,
    projectId: string,
    generation: number,
    preferredActiveCanvasId?: string | null,
  ) {
    if (!this.isActive(projectId, generation) || workspace.projectId !== projectId) return false
    const activeCanvasId = preferredActiveCanvasId && workspace.canvases.some((canvas) => canvas.id === preferredActiveCanvasId)
      ? preferredActiveCanvasId
      : workspace.canvases.some((canvas) => canvas.id === workspace.activeCanvasId)
        ? workspace.activeCanvasId
        : (workspace.canvases[0]?.id ?? null)
    this.update({ activeCanvasId, canvases: workspace.canvases })
    return true
  }

  private cancelCanvasTransition(projectId: string, generation: number, request: number, error: unknown) {
    if (!this.isCurrentCanvasTransition(projectId, generation, request)) return
    this.options.onActiveCanvasChangeCanceled?.()
    this.update({ changingActiveCanvas: false, error: errorMessage(error) })
  }

  private async applyActiveProject(projectId: string | null) {
    const generation = ++this.generation
    this.canvasTransitionRequest += 1
    this.workspaceRequest += 1
    this.directoryRequests.clear()
    this.update({
      activeCanvasId: null,
      activeProjectId: projectId,
      canvases: [],
      changingActiveCanvas: false,
      changingActiveProject: false,
      error: null,
      expandedPaths: [],
      listings: {},
      loadingPaths: [],
      selectedPaths: [],
    })
    if (projectId) {
      await Promise.all([
        this.loadDirectory("", generation),
        this.loadWorkspace(generation),
      ])
    }
  }

  private pruneSubtrees(paths: string[]) {
    const isPruned = (candidate: string) => paths.some((path) => candidate === path || candidate.startsWith(`${path}/`))
    this.update({
      expandedPaths: this.snapshot.expandedPaths.filter((path) => !isPruned(path)),
      listings: Object.fromEntries(Object.entries(this.snapshot.listings).filter(([path]) => !isPruned(path))),
      loadingPaths: this.snapshot.loadingPaths.filter((path) => !isPruned(path)),
      selectedPaths: this.snapshot.selectedPaths.filter((path) => !isPruned(path)),
    })
  }

  private update(patch: Partial<ProjectControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function addUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value]
}

function parentOf(path: string) {
  const index = path.lastIndexOf("/")
  return index < 0 ? "" : path.slice(0, index)
}

function normalizeSelectionRoots(paths: readonly string[]) {
  const selected = new Set(paths)
  return [...selected].filter((path) => {
    const segments = path.split("/")
    return !segments.slice(0, -1).some((_, index) => selected.has(segments.slice(0, index + 1).join("/")))
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
