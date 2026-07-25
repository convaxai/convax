import type { CanvasResourceMutationService } from "@convax/canvas"
import type { ProjectCanvas, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import type { ProjectFilesControllerSnapshot } from "@convax/project-files"
import type { WorkbenchCanvasInput, WorkbenchInput, WorkbenchSnapshot } from "@convax/workbench"
import type { CanvasResourceClient } from "../desktop-protocol"

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

export function resolveSelectedProjectCanvasRelinkSource(input: {
  activeProjectId: string
  projectFiles: { getSnapshot(): ProjectFilesControllerSnapshot }
}): { kind: "host-directory" | "host-file"; path: string } {
  const snapshot = input.projectFiles.getSnapshot()
  if (snapshot.projectId !== input.activeProjectId) {
    throw new Error("Project Files selection does not belong to the active Project")
  }
  if (snapshot.selectedPaths.length !== 1) {
    throw new Error("Select exactly one Project file or directory before relinking")
  }
  const selectedPath = snapshot.selectedPaths[0]
  const matches = Object.values(snapshot.listings)
    .flatMap((listing) => listing.entries)
    .filter((entry) => entry.path === selectedPath)
  if (matches.length !== 1) throw new Error("The selected Project resource is no longer available")
  const entry = matches[0]
  return { kind: entry.kind === "directory" ? "host-directory" : "host-file", path: entry.path }
}

type ProjectCanvasResourceRelinkRequest = Parameters<NonNullable<CanvasResourceMutationService["relink"]>>[0]

export async function runProjectCanvasResourceRelink(input: {
  activeCanvasId: string | null | undefined
  activeProjectId: string | null | undefined
  createCommandId(): string
  flush(): Promise<void>
  projectFiles: { getSnapshot(): ProjectFilesControllerSnapshot }
  request: ProjectCanvasResourceRelinkRequest
  resources: Pick<CanvasResourceClient, "createLocalFileToken" | "relink">
}) {
  if (input.request.signal.aborted) throw input.request.signal.reason
  if (!input.activeProjectId || !input.activeCanvasId) {
    throw new Error("Open a Project Canvas before relinking resources")
  }
  const capturedSource = input.request.file
    ? { file: input.request.file, kind: "external-file" as const }
    : input.request.source
      ? { kind: input.request.source.kind, path: input.request.source.path }
      : resolveSelectedProjectCanvasRelinkSource({
          activeProjectId: input.activeProjectId,
          projectFiles: input.projectFiles,
        })

  await input.flush()
  if (input.request.signal.aborted) throw input.request.signal.reason
  const source =
    capturedSource.kind === "external-file"
      ? localFileRelinkSource(input.resources, capturedSource.file)
      : capturedSource
  return input.resources.relink({
    canvasId: input.activeCanvasId,
    commandId: input.createCommandId(),
    expectedRevision: input.request.expectedRevision,
    nodeId: input.request.nodeId,
    source,
  })
}

function localFileRelinkSource(
  resources: Pick<CanvasResourceClient, "createLocalFileToken">,
  file: File,
) {
  const sourceToken = resources.createLocalFileToken(file)
  if (!sourceToken) throw new Error("Only files from the local disk can relink a Project Canvas resource")
  return {
    kind: "local-file" as const,
    ...(file.type ? { mediaType: file.type } : {}),
    name: file.name,
    sourceToken,
  }
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
    if (
      catalog.projectId !== projectId ||
      workbench.projectId !== projectId ||
      catalog.busy ||
      workbench.changingInput ||
      workbench.error
    ) {
      return false
    }
    const activeInput = workbench.activeInput
    if (activeInput?.kind === "file") return true
    if (activeInput?.kind === "canvas" && catalog.canvases.some((canvas) => canvas.id === activeInput.canvasId)) {
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
    if (this.catalog.getSnapshot().projectId !== projectId || this.workbench.getSnapshot().projectId !== projectId)
      return
    const created = await this.catalog.createCanvas(name)
    if (!created) return
    if (await this.openCanvas(projectId, created.id)) return created
    await this.catalog.deleteCanvas(created.id)
  }

  async deleteCanvas(projectId: string, canvasId: string) {
    const catalog = this.catalog.getSnapshot()
    if (catalog.projectId !== projectId || catalog.canvases.length <= 1) return false
    const workbench = this.workbench.getSnapshot()
    const deletesActiveCanvas =
      workbench.activeInput?.kind === "canvas" &&
      workbench.activeInput.projectId === projectId &&
      workbench.activeInput.canvasId === canvasId
    if (deletesActiveCanvas) {
      const fallback = catalog.canvases.find((canvas) => canvas.id !== canvasId)
      if (!fallback || !(await this.openCanvas(projectId, fallback.id))) return false
    }
    return (await this.catalog.deleteCanvas(canvasId)) === true
  }
}
