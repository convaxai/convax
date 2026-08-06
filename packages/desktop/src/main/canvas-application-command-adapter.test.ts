import { expect, test } from "bun:test"
import { adaptCanvasApplicationCommand } from "@convax/canvas/collaboration"
import { createProductionCanvasApplicationCommandAdapter } from "./canvas-application-command-adapter"

test("Desktop composes the exact Canvas-owned application command adapter", () => {
  const adapter = createProductionCanvasApplicationCommandAdapter()
  expect(Object.isFrozen(adapter)).toBeTrue()
  expect(adapter.construct).toBe(adaptCanvasApplicationCommand)
})
