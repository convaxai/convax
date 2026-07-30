import type { ProjectController, ProjectControllerSnapshot } from "@convax/project"
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectEmptyState, ProjectLoadingState } from "./project-empty-state"

function controller(snapshot: ProjectControllerSnapshot): ProjectController {
  return {
    clearError: () => undefined,
    getSnapshot: () => snapshot,
    initialize: async () => undefined,
    subscribe: () => () => undefined,
  } as unknown as ProjectController
}

const emptySnapshot: ProjectControllerSnapshot = {
  activeProjectId: null,
  changingActiveProject: false,
  error: null,
  initialized: true,
  projects: [],
}

describe("ProjectEmptyState", () => {
  test("shows a loading state while projects initialize", () => {
    const markup = renderToStaticMarkup(
      <ProjectEmptyState
        controller={controller({ ...emptySnapshot, initialized: false })}
        initialized={false}
      />,
    )

    expect(markup).toContain("Loading projects")
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('data-slot="loading"')
    expect(markup).toContain('data-slot="loading-spinner"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain("Create project")
  })

  test("honors reduced motion on the registry loading surface", () => {
    const markup = renderToStaticMarkup(
      <ProjectEmptyState
        controller={controller({ ...emptySnapshot, initialized: false })}
        initialized={false}
        reducedMotion
      />,
    )

    expect(markup).toContain('data-ui-loading-motion="reduce"')
  })

  test("offers create and open actions when there is no active project", () => {
    const markup = renderToStaticMarkup(
      <ProjectEmptyState controller={controller(emptySnapshot)} initialized />,
    )

    expect(markup).toContain('data-project-home="true"')
    expect(markup).toContain("Your next workspace starts here")
    expect(markup).toContain("Create a project")
    expect(markup).toContain("Open project")
    expect(markup).not.toContain("Choose a location")
  })
})

describe("ProjectLoadingState", () => {
  test("identifies the project whose resources are opening", () => {
    const markup = renderToStaticMarkup(<ProjectLoadingState projectName="Storyboard" />)

    expect(markup).toContain("Opening Storyboard…")
    expect(markup).toContain("Loading canvases and project files")
    expect(markup).toContain('role="status"')
    expect(markup).toContain('data-ui-loading-layout="surface"')
    expect(markup).toContain('data-slot="loading"')
    expect(markup.match(/role="status"/g)?.length).toBe(1)
    expect(markup).not.toContain("Create project")
  })

  test("keeps a single status region under reduced motion", () => {
    const markup = renderToStaticMarkup(
      <ProjectLoadingState projectName="Storyboard" reducedMotion />,
    )

    expect(markup).toContain('data-ui-loading-motion="reduce"')
    expect(markup).toContain("Opening Storyboard…")
    expect(markup.match(/role="status"/g)?.length).toBe(1)
  })
})
