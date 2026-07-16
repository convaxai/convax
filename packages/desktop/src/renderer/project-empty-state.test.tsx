import type { ProjectController } from "@convax/project"
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectEmptyState, ProjectLoadingState } from "./project-empty-state"

const controller = {} as ProjectController

describe("ProjectEmptyState", () => {
  test("shows a loading state while projects initialize", () => {
    const markup = renderToStaticMarkup(<ProjectEmptyState controller={controller} initialized={false} />)

    expect(markup).toContain("Loading projects")
    expect(markup).not.toContain("Create project")
  })

  test("offers create and open actions when there is no active project", () => {
    const markup = renderToStaticMarkup(<ProjectEmptyState controller={controller} initialized />)

    expect(markup).toContain("Create or open a project")
    expect(markup).toContain("Create project")
    expect(markup).toContain("Open project")
  })
})

describe("ProjectLoadingState", () => {
  test("identifies the project whose resources are opening", () => {
    const markup = renderToStaticMarkup(<ProjectLoadingState projectName="Storyboard" />)

    expect(markup).toContain("Opening Storyboard…")
    expect(markup).toContain("Loading canvases and project files")
    expect(markup).not.toContain("Create project")
  })
})
