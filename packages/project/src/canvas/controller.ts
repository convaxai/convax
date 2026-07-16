import type { ProjectCanvasCatalog, ProjectCanvasClient, ProjectCanvas } from "./contracts"

export interface ProjectCanvasControllerSnapshot {
  busy: boolean
  canvases: ProjectCanvas[]
  error: string | null
  projectId: string | null
  workbenchPreferenceMigration: ProjectCanvasCatalog["workbenchPreferenceMigration"] | null
}

const initialSnapshot: ProjectCanvasControllerSnapshot = {
  busy: false,
  canvases: [],
  error: null,
  projectId: null,
  workbenchPreferenceMigration: null,
}

export class ProjectCanvasController {
  private snapshot = initialSnapshot
  private readonly listeners = new Set<() => void>()
  private activity: "load" | "mutation" | "refresh" | null = null
  private generation = 0
  private request = 0
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private readonly stopChanges: () => void

  constructor(private readonly client: ProjectCanvasClient) {
    this.stopChanges = client.onDidChange((event) => {
      if (event.projectId !== this.snapshot.projectId) return
      this.scheduleRefresh()
    })
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setProject(projectId: string | null) {
    if (projectId === this.snapshot.projectId && !this.snapshot.error) return
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    const generation = ++this.generation
    const request = ++this.request
    this.activity = projectId ? "load" : null
    this.update({
      busy: Boolean(projectId),
      canvases: [],
      error: null,
      projectId,
      workbenchPreferenceMigration: null,
    })
    if (!projectId) return
    try {
      const catalog = await this.client.getCanvasCatalog({ projectId })
      if (!this.isCurrent(projectId, generation, request)) return
      this.applyCatalog(catalog, projectId, generation)
      this.activity = null
      this.update({ busy: false, error: null })
    } catch (error) {
      if (this.isCurrent(projectId, generation, request)) {
        this.activity = null
        this.update({ busy: false, error: errorMessage(error) })
      }
    }
  }

  async refresh() {
    const projectId = this.snapshot.projectId
    if (!projectId || this.activity) return
    const generation = this.generation
    const request = ++this.request
    this.activity = "refresh"
    this.update({ busy: true, error: null })
    try {
      const catalog = await this.client.getCanvasCatalog({ projectId })
      if (!this.isCurrent(projectId, generation, request)) return
      this.applyCatalog(catalog, projectId, generation)
      this.activity = null
      this.update({ busy: false, error: null })
    } catch (error) {
      if (this.isCurrent(projectId, generation, request)) {
        this.activity = null
        this.update({ busy: false, error: errorMessage(error) })
      }
    }
  }

  async createCanvas(name?: string) {
    const projectId = this.snapshot.projectId
    if (!projectId || (this.activity && this.activity !== "refresh")) return
    const generation = this.generation
    const request = ++this.request
    this.activity = "mutation"
    this.update({ busy: true, error: null })
    try {
      const result = await this.client.createCanvas({ name: name?.trim() || undefined, projectId })
      if (!this.isCurrent(projectId, generation, request)) return
      this.applyCatalog(result.catalog, projectId, generation)
      this.activity = null
      this.update({ busy: false, error: null })
      return result.canvas
    } catch (error) {
      if (this.isCurrent(projectId, generation, request)) {
        this.activity = null
        this.update({ busy: false, error: errorMessage(error) })
      }
    }
  }

  async renameCanvas(canvasId: string, name: string) {
    const projectId = this.snapshot.projectId
    const trimmedName = name.trim()
    if (!projectId || !trimmedName || (this.activity && this.activity !== "refresh")) return
    if (!this.snapshot.canvases.some((canvas) => canvas.id === canvasId)) {
      this.update({ error: "Canvas was not found." })
      return
    }
    const generation = this.generation
    const request = ++this.request
    this.activity = "mutation"
    this.update({ busy: true, error: null })
    try {
      const result = await this.client.renameCanvas({ canvasId, name: trimmedName, projectId })
      if (!this.isCurrent(projectId, generation, request)) return
      this.applyCatalog(result.catalog, projectId, generation)
      this.activity = null
      this.update({ busy: false, error: null })
      return result.canvas
    } catch (error) {
      if (this.isCurrent(projectId, generation, request)) {
        this.activity = null
        this.update({ busy: false, error: errorMessage(error) })
      }
    }
  }

  async deleteCanvas(canvasId: string) {
    const projectId = this.snapshot.projectId
    if (!projectId || (this.activity && this.activity !== "refresh")) return
    if (!this.snapshot.canvases.some((canvas) => canvas.id === canvasId)) {
      this.update({ error: "Canvas was not found." })
      return
    }
    const generation = this.generation
    const request = ++this.request
    this.activity = "mutation"
    this.update({ busy: true, error: null })
    try {
      const result = await this.client.deleteCanvas({ canvasId, projectId })
      if (!this.isCurrent(projectId, generation, request)) return
      this.applyCatalog(result.catalog, projectId, generation)
      this.activity = null
      this.update({ busy: false, error: null })
      return result.deleted
    } catch (error) {
      if (this.isCurrent(projectId, generation, request)) {
        this.activity = null
        this.update({ busy: false, error: errorMessage(error) })
      }
    }
  }

  clearError() {
    this.update({ error: null })
  }

  dispose() {
    this.activity = null
    this.generation += 1
    this.request += 1
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.stopChanges()
    this.listeners.clear()
  }

  private isActive(projectId: string, generation: number) {
    return projectId === this.snapshot.projectId && generation === this.generation
  }

  private isCurrent(projectId: string, generation: number, request: number) {
    return this.isActive(projectId, generation) && request === this.request
  }

  private applyCatalog(catalog: ProjectCanvasCatalog, projectId: string, generation: number) {
    if (!this.isActive(projectId, generation) || catalog.projectId !== projectId) {
      throw new Error("Project Canvas catalog response did not match the active project.")
    }
    const migration = catalog.workbenchPreferenceMigration ?? this.snapshot.workbenchPreferenceMigration
    this.update({
      canvases: catalog.canvases,
      workbenchPreferenceMigration: migration
        && catalog.canvases.some((canvas) => canvas.id === migration.canvasId)
        ? migration
        : null,
    })
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      if (this.snapshot.busy) {
        this.scheduleRefresh()
        return
      }
      void this.refresh()
    }, 120)
  }

  private update(patch: Partial<ProjectCanvasControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
