import { adaptCanvasApplicationCommand } from "@convax/canvas/collaboration"
import type { CanvasApplicationCommandAdapter } from "./canvas-collaboration-session-owner"

/** Desktop composition seam; all command semantics remain in @convax/canvas. */
export function createProductionCanvasApplicationCommandAdapter(): CanvasApplicationCommandAdapter {
  return Object.freeze({
    construct: adaptCanvasApplicationCommand,
  })
}
