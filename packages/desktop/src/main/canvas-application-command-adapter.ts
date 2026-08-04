import { adaptCanvasApplicationCommandV2 } from "@convax/canvas/collaboration"
import type { CanvasApplicationCommandAdapterV2 } from "./canvas-collaboration-session-owner"

/** Desktop composition seam; all command semantics remain in @convax/canvas. */
export function createProductionCanvasApplicationCommandAdapterV2(): CanvasApplicationCommandAdapterV2 {
  return Object.freeze({
    construct: adaptCanvasApplicationCommandV2,
  })
}
