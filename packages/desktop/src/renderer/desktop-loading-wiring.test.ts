import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const indexSource = readFileSync(fileURLToPath(new URL("./index.tsx", import.meta.url)), "utf8")
const projectHomeSource = readFileSync(fileURLToPath(new URL("./project-home.tsx", import.meta.url)), "utf8")

describe("Desktop loading adoption wiring", () => {
  test("routes appearance reducedMotion into Desktop-owned loading gates without changing gate predicates", () => {
    expect(indexSource).toContain(
      'workbenchSnapshot.surface.kind === "empty" && workbenchSnapshot.surface.reason === "no-project"',
    )
    expect(indexSource).toContain("!initialDocument")
    expect(indexSource).toContain("<ProjectEmptyState")
    expect(indexSource).toContain("<ProjectLoadingState")
    expect(indexSource).toContain("reducedMotion={appearancePreferences.reducedMotion}")
    expect(indexSource).toContain("<ProjectHome")
    expect(indexSource).toContain("onEnterProject={enterHomeProject}")
  })

  test("ProjectHome registry wait uses the shared Loading status primitive", () => {
    expect(projectHomeSource).toContain("!model.initialized")
    expect(projectHomeSource).toContain("<Loading")
    expect(projectHomeSource).toContain("label={labels.loading}")
    expect(projectHomeSource).toContain("LoadingSpinner")
    expect(projectHomeSource).not.toContain("LoaderCircle")
  })
})
