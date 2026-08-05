import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const indexSource = readFileSync(fileURLToPath(new URL("./index.tsx", import.meta.url)), "utf8")

describe("Desktop → Canvas motion preference wiring", () => {
  test("passes appearance reducedMotion into CanvasEditor without changing mount gates", () => {
    expect(indexSource).toContain("<CanvasEditor")
    expect(indexSource).toContain("reducedMotion={appearancePreferences.reducedMotion}")
    expect(indexSource).toContain("viewportInsets={canvasViewportInsets}")
    expect(indexSource).toContain('viewId="desktop-main"')
    expect(indexSource).toContain("viewScopeId={activeProject.id}")
    expect(indexSource).toContain("key={`${activeProject.id}:${activeCanvasId}`}")
    expect(indexSource).toContain("workbenchSnapshot.changingInput ||")
    expect(indexSource).toContain("projectCanvasSnapshot.busy ||")
    expect(indexSource).toContain("projectSnapshot.changingActiveProject")
    expect(indexSource).not.toContain("localStorage.getItem")
    expect(indexSource).not.toContain('document.documentElement.getAttribute("data-reduced-motion")')
  })
})
