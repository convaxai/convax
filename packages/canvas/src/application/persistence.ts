/**
 * Host-neutral Canvas scope only. Persistence itself belongs to the Main-owned
 * collaboration binary store; Canvas intentionally exports no JSON repository,
 * whole-document save request, storage version, or CAS conflict type.
 */
export interface CanvasDocumentRef {
  canvasId: string
  /** Host-defined isolation boundary (for example a Project id/epoch binding). */
  scopeId: string
}

/**
 * Legacy JSON Canvas bytes are an unsupported portable format at the breaking
 * Yjs cutover. Project/node owns detection, preservation, and explicit reset;
 * Canvas must never parse or serialize those bytes as live state.
 */
export class UnsupportedLegacyCanvasPersistenceError extends Error {
  constructor() {
    super("Legacy JSON Canvas persistence is unsupported; explicit Project reset is required")
    this.name = "UnsupportedLegacyCanvasPersistenceError"
  }
}
