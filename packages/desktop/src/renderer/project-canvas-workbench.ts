import type { ProjectCanvas, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import type { WorkbenchCanvasInput, WorkbenchInput, WorkbenchSnapshot } from "@convax/workbench"

export interface ProjectCanvasCatalogControllerPort {
  createCanvas(name?: string): Promise<ProjectCanvas | undefined>
  deleteCanvas(canvasId: string): Promise<boolean | undefined>
  getSnapshot(): ProjectCanvasControllerSnapshot
}

export interface ProjectCanvasWorkbenchPort {
  close(input?: WorkbenchInput): Promise<boolean>
  getSnapshot(): WorkbenchSnapshot
  open(input: WorkbenchInput): Promise<boolean>
}

export function projectCanvasInput(projectId: string, canvasId: string): WorkbenchCanvasInput {
  return { canvasId, kind: "canvas", projectId }
}

/** Coordinates catalog mutations with the user-owned Workbench input without merging either domain. */
export class ProjectCanvasWorkbenchCoordinator {
  constructor(
    private readonly catalog: ProjectCanvasCatalogControllerPort,
    private readonly workbench: ProjectCanvasWorkbenchPort,
  ) {}

  async reconcile(projectId: string, preferredCanvasId?: string) {
    const catalog = this.catalog.getSnapshot()
    const workbench = this.workbench.getSnapshot()
    if (catalog.projectId !== projectId
      || workbench.projectId !== projectId
      || catalog.busy
      || workbench.changingInput
      || workbench.error) {
      return false
    }
    const activeInput = workbench.activeInput
    if (activeInput?.kind === "file") return true
    if (activeInput?.kind === "canvas"
      && catalog.canvases.some((canvas) => canvas.id === activeInput.canvasId)) {
      return true
    }
    const next = catalog.canvases.find((canvas) => canvas.id === preferredCanvasId) ?? catalog.canvases[0]
    if (next) return this.workbench.open(projectCanvasInput(projectId, next.id))
    return workbench.activeInput ? this.workbench.close(workbench.activeInput) : true
  }

  async openCanvas(projectId: string, canvasId: string) {
    const catalog = this.catalog.getSnapshot()
    if (catalog.projectId !== projectId || !catalog.canvases.some((canvas) => canvas.id === canvasId)) return false
    if (this.workbench.getSnapshot().projectId !== projectId) return false
    return this.workbench.open(projectCanvasInput(projectId, canvasId))
  }

  async createCanvas(projectId: string, name?: string) {
    if (this.catalog.getSnapshot().projectId !== projectId || this.workbench.getSnapshot().projectId !== projectId) return
    const created = await this.catalog.createCanvas(name)
    if (!created) return
    if (await this.openCanvas(projectId, created.id)) return created
    await this.catalog.deleteCanvas(created.id)
  }

  async deleteCanvas(projectId: string, canvasId: string) {
    const catalog = this.catalog.getSnapshot()
    if (catalog.projectId !== projectId || catalog.canvases.length <= 1) return false
    const workbench = this.workbench.getSnapshot()
    const deletesActiveCanvas = workbench.activeInput?.kind === "canvas"
      && workbench.activeInput.projectId === projectId
      && workbench.activeInput.canvasId === canvasId
    if (deletesActiveCanvas) {
      const fallback = catalog.canvases.find((canvas) => canvas.id !== canvasId)
      if (!fallback || !await this.openCanvas(projectId, fallback.id)) return false
    }
    return await this.catalog.deleteCanvas(canvasId) === true
  }
}
