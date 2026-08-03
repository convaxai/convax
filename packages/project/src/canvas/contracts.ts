export interface ProjectCanvas {
  /** Legacy display metadata; ProjectIndex route identity does not authorize by wall time. */
  createdAt?: number
  id: string
  name: string
  /** Legacy display metadata; ProjectIndex route identity does not authorize by wall time. */
  updatedAt?: number
}

export interface ProjectCanvasCatalog {
  canvases: ProjectCanvas[]
  creationAvailability: "available" | "team-authority-pending" | "read-only-recovery-required"
  projectId: string
}

export interface ProjectCanvasChangeEvent {
  projectId: string
}

export interface ProjectCanvasClient {
  createCanvas(input: {
    name?: string
    projectId: string
  }): Promise<{ canvas: ProjectCanvas; catalog: ProjectCanvasCatalog }>
  deleteCanvas(input: {
    canvasId: string
    projectId: string
  }): Promise<{ deleted: boolean; catalog: ProjectCanvasCatalog }>
  getCanvasCatalog(input: { projectId: string }): Promise<ProjectCanvasCatalog>
  onDidChange(listener: (event: ProjectCanvasChangeEvent) => void): () => void
  renameCanvas(input: {
    canvasId: string
    name: string
    projectId: string
  }): Promise<{ canvas: ProjectCanvas; catalog: ProjectCanvasCatalog }>
}
