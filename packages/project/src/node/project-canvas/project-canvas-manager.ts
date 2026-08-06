import { parseCanvasId, parseProjectId } from "@convax/collaboration"
import {
  parseProjectCanvasCatalogProjection,
  validateProjectCanvasTitle,
  type ProjectCanvasCatalogProjection,
  type ProjectCanvasRouteCommandResult,
  type ProjectCanvasRouteCommand,
  type ProjectIndexCanvasApplicationPort,
} from "../../canvas/application"

export type {
  ProjectCanvasCatalogProjection,
  ProjectCanvasRouteCommandResult,
  ProjectCanvasRouteCommand,
  ProjectIndexCanvasApplicationPort,
} from "../../canvas/application"

/**
 * Injected Main application boundary. The implementation allocates operation and
 * route identities, builds the exact ProjectIndex typed intent and commits it via
 * the collaboration kernel. NodeProjectCanvasManager never receives a Y.Doc or a
 * raw update and owns no catalog persistence.
 */
export class ProjectCanvasRouteCommandRejectedErrorV2 extends Error {
  constructor(readonly code: Extract<ProjectCanvasRouteCommandResult, { status: "rejected" }>["code"]) {
    super(`Project Canvas route command was rejected: ${code}`)
    this.name = "ProjectCanvasRouteCommandRejectedErrorV2"
  }
}

/** Thin query/command facade; never a catalog cache or native-storage adapter. */
export class NodeProjectCanvasManager {
  constructor(private readonly application: ProjectIndexCanvasApplicationPort) {}

  async getCanvasCatalog(input: { readonly projectId: string }): Promise<ProjectCanvasCatalogProjection> {
    const projectId = parseProjectId(input.projectId)
    return parseProjectCanvasCatalogProjection(await this.application.queryCatalog({ projectId }), projectId)
  }

  createCanvas(input: { readonly projectId: string; readonly name?: string; readonly signal?: AbortSignal }) {
    return this.submit(
      input.projectId,
      {
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.create",
        title: validateProjectCanvasTitle(input.name ?? "Canvas"),
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
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.rename",
        canvasId: parseCanvasId(input.canvasId),
        title: validateProjectCanvasTitle(input.name),
      },
      input.signal,
    )
  }

  deleteCanvas(input: { readonly projectId: string; readonly canvasId: string; readonly signal?: AbortSignal }) {
    return this.submit(
      input.projectId,
      {
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.tombstone",
        canvasId: parseCanvasId(input.canvasId),
      },
      input.signal,
    )
  }

  private async submit(projectIdInput: string, command: ProjectCanvasRouteCommand, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const projectId = parseProjectId(projectIdInput)
    const result = await this.application.submitRouteCommand({ projectId, command, signal })
    signal?.throwIfAborted()
    if (result.status === "rejected") throw new ProjectCanvasRouteCommandRejectedErrorV2(result.code)
    return Object.freeze({
      canvasId: parseCanvasId(result.canvasId),
      catalog: parseProjectCanvasCatalogProjection(result.catalog, projectId),
    })
  }
}
