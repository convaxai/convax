import { expect, test } from "bun:test"
import { adaptCanvasApplicationCommandV2 } from "@convax/canvas/collaboration"
import { createProductionCanvasApplicationCommandAdapterV2 } from "./canvas-application-command-adapter"

test("Desktop composes the exact Canvas-owned application command adapter", () => {
  const adapter = createProductionCanvasApplicationCommandAdapterV2()
  expect(Object.isFrozen(adapter)).toBeTrue()
  expect(adapter.construct).toBe(adaptCanvasApplicationCommandV2)
})
