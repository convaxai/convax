export class CanvasTextResourceConflictError extends Error {
  constructor(
    readonly expectedContentRevision: string,
    readonly actualContentRevision: string | null,
  ) {
    super("Canvas text resource changed outside Convax")
    this.name = "CanvasTextResourceConflictError"
  }
}
