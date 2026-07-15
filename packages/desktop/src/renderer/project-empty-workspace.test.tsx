import type { ProjectController } from "@convax/project"
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectEmptyWorkspace, ProjectWorkspaceLoading } from "./project-empty-workspace"

const controller = {} as ProjectController

describe("ProjectEmptyWorkspace", () => {
  test("shows a loading state while projects initialize", () => {
    const markup = renderToStaticMarkup(<ProjectEmptyWorkspace controller={controller} initialized={false} />)

    expect(markup).toContain("Loading projects")
    expect(markup).not.toContain("Create project")
  })

  test("offers create and open actions when there is no active project", () => {
    const markup = renderToStaticMarkup(<ProjectEmptyWorkspace controller={controller} initialized />)

    expect(markup).toContain("Create or open a project")
    expect(markup).toContain("Create project")
    expect(markup).toContain("Open project")
  })
})

describe("ProjectWorkspaceLoading", () => {
  test("identifies the project whose workspace is opening", () => {
    const markup = renderToStaticMarkup(<ProjectWorkspaceLoading projectName="Storyboard" />)

    expect(markup).toContain("Opening Storyboard…")
    expect(markup).toContain("Loading canvases and project files")
    expect(markup).not.toContain("Create project")
  })
})
