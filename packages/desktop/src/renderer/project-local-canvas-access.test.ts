import { describe, expect, test } from "bun:test"

import { resolveProjectLocalCanvasSurfaceAccess } from "./project-local-canvas-access"

describe("local Project Canvas surface access", () => {
  test("keeps an existing selected Canvas visible when only creation authority is unavailable", () => {
    expect(resolveProjectLocalCanvasSurfaceAccess({
      activeCanvasId: "canvas-main",
      creationAvailability: "local-authority-unavailable",
    })).toBe("existing-selection")
  })

  test("does not invent a Canvas when creation authority is unavailable", () => {
    expect(resolveProjectLocalCanvasSurfaceAccess({
      creationAvailability: "local-authority-unavailable",
    })).toBe("blocked")
  })

  test("keeps recovery-required Projects blocked even with a stale selection", () => {
    expect(resolveProjectLocalCanvasSurfaceAccess({
      activeCanvasId: "canvas-main",
      creationAvailability: "read-only-recovery-required",
    })).toBe("blocked")
  })
})
