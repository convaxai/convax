import type { ProjectCanvasCatalogProjection } from "@convax/project/canvas"

export type ProjectLocalCanvasSurfaceAccess = "available" | "existing-selection" | "blocked"

/**
 * Canvas creation authority and access to an already selected Canvas are
 * separate concerns. Missing creation authority must not hide durable content;
 * explicit recovery-required state still blocks every Canvas surface.
 */
export function resolveProjectLocalCanvasSurfaceAccess(input: {
  readonly activeCanvasId?: string
  readonly creationAvailability: ProjectCanvasCatalogProjection["creationAvailability"]
}): ProjectLocalCanvasSurfaceAccess {
  if (input.creationAvailability === "available") return "available"
  if (input.creationAvailability === "read-only-recovery-required") return "blocked"
  return input.activeCanvasId ? "existing-selection" : "blocked"
}
