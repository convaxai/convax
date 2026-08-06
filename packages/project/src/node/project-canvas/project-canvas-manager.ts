import { parseCanvasId, parseProjectId } from "@convax/collaboration"
import {
  parseProjectCanvasCatalogProjectionV2,
  validateProjectCanvasTitleV2,
  type ProjectCanvasCatalogProjectionV2,
  type ProjectCanvasRouteCommandResultV2,
  type ProjectCanvasRouteCommandV2,
  type ProjectIndexCanvasApplicationPortV2,
} from "../../canvas/application"

export type {
  ProjectCanvasCatalogProjectionV2,
  ProjectCanvasRouteCommandResultV2,
  ProjectCanvasRouteCommandV2,
  ProjectIndexCanvasApplicationPortV2,
} from "../../canvas/application"

/**
 * Injected Main application boundary. The implementation allocates operation and
 * route identities, builds the exact ProjectIndex typed intent and commits it via
 * the collaboration kernel. NodeProjectCanvasManager never receives a Y.Doc or a
 * raw update and owns no catalog persistence.
 */
export class ProjectCanvasRouteCommandRejectedErrorV2 extends Error {
  constructor(readonly code: Extract<ProjectCanvasRouteCommandResultV2, { status: "rejected" }>["code"]) {
    super(`Project Canvas route command was rejected: ${code}`)
    this.name = "ProjectCanvasRouteCommandRejectedErrorV2"
  }
}

/** Thin query/command facade; never a catalog cache or native-storage adapter. */
export class NodeProjectCanvasManager {
  constructor(private readonly application: ProjectIndexCanvasApplicationPortV2) {}

  async getCanvasCatalog(input: { readonly projectId: string }): Promise<ProjectCanvasCatalogProjectionV2> {
    const projectId = parseProjectId(input.projectId)
    return parseProjectCanvasCatalogProjectionV2(await this.application.queryCatalog({ projectId }), projectId)
  }

  createCanvas(input: { readonly projectId: string; readonly name?: string; readonly signal?: AbortSignal }) {
    return this.submit(
      input.projectId,
      {
        format: "convax.project-canvas-route-command/2",
        kind: "project.canvas.route.create/2",
        title: validateProjectCanvasTitleV2(input.name ?? "Canvas"),
      },
      input.signal,
    )
  }

  renameCanvas(input: {
    readonly projectId: string
    readonly canvasId: string
    readonly name: string
    readonly signal?: AbortSignal
  }) {
    return this.submit(
      input.projectId,
      {
        format: "convax.project-canvas-route-command/2",
        kind: "project.canvas.route.rename/2",
        canvasId: parseCanvasId(input.canvasId),
        title: validateProjectCanvasTitleV2(input.name),
      },
      input.signal,
    )
  }

  deleteCanvas(input: { readonly projectId: string; readonly canvasId: string; readonly signal?: AbortSignal }) {
    return this.submit(
      input.projectId,
      {
        format: "convax.project-canvas-route-command/2",
        kind: "project.canvas.route.tombstone/2",
        canvasId: parseCanvasId(input.canvasId),
      },
      input.signal,
    )
  }

  private async submit(projectIdInput: string, command: ProjectCanvasRouteCommandV2, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const projectId = parseProjectId(projectIdInput)
    const result = await this.application.submitRouteCommand({ projectId, command, signal })
    signal?.throwIfAborted()
    if (result.status === "rejected") throw new ProjectCanvasRouteCommandRejectedErrorV2(result.code)
    return Object.freeze({
      canvasId: parseCanvasId(result.canvasId),
      catalog: parseProjectCanvasCatalogProjectionV2(result.catalog, projectId),
    })
  }
}
