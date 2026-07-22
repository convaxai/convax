export interface ProjectCanvas {
  createdAt: number
  id: string
  name: string
  updatedAt: number
}

export interface ProjectCanvasCatalog {
  canvases: ProjectCanvas[]
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
