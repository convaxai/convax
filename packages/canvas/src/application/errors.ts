export class CanvasTextResourceConflictError extends Error {
  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string | null,
  ) {
    super("Canvas text resource changed outside Convax")
    this.name = "CanvasTextResourceConflictError"
  }
}
