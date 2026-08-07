import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
  CanvasCollaborationApplicationPort,
  CanvasDocumentRef,
  CanvasNodeQuery,
  CanvasSubmitDiagnosticsPort,
} from "@convax/canvas/application"

/**
 * Compatibility-named thin client around the Main-owned Canvas application port.
 * It has no repository, save/load, revision, JSON codec or retry authority.
 */
export class ProjectCanvasDocumentService implements CanvasCollaborationApplicationPort {
  constructor(
    private readonly collaboration: CanvasCollaborationApplicationPort,
    private readonly diagnostics?: CanvasSubmitDiagnosticsPort,
  ) {}

  query(ref: CanvasDocumentRef, query?: CanvasNodeQuery): Promise<CanvasApplicationQueryResult> {
    return this.collaboration.query(ref, query)
  }

  async submit(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    if (!this.diagnostics) return this.collaboration.submit(request)
    const startedAt = performance.now()
    try {
      return await this.collaboration.submit(request)
    } finally {
      try {
        this.diagnostics.record({
          callCount: 1,
          durationMs: performance.now() - startedAt,
          stage: "document-service-submit",
        })
      } catch {}
    }
  }
}
