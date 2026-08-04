import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
  CanvasCollaborationApplicationPort,
  CanvasDocumentRef,
  CanvasNodeQuery,
} from "@convax/canvas/application"

/**
 * Compatibility-named thin client around the Main-owned Canvas application port.
 * It has no repository, save/load, revision, JSON codec or retry authority.
 */
export class ProjectCanvasDocumentService implements CanvasCollaborationApplicationPort {
  constructor(private readonly collaboration: CanvasCollaborationApplicationPort) {}

  query(ref: CanvasDocumentRef, query?: CanvasNodeQuery): Promise<CanvasApplicationQueryResult> {
    return this.collaboration.query(ref, query)
  }

  submit(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    return this.collaboration.submit(request)
  }
}
