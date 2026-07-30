import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ProjectLoadingState,
  ProjectRecoveryState,
  ProjectRegistryLoadingState,
} from "./project-empty-state"

describe("ProjectRegistryLoadingState", () => {
  test("keeps startup in an accessible loading state without onboarding actions", () => {
    const markup = renderToStaticMarkup(<ProjectRegistryLoadingState />)

    expect(markup).toContain("Loading Projects")
    expect(markup).toContain("Restoring your workspace")
    expect(markup).toContain('role="status"')
    expect(markup).not.toContain("Create a project")
    expect(markup).not.toContain("Open a Project")
  })

  test("honors reduced motion", () => {
    const markup = renderToStaticMarkup(<ProjectRegistryLoadingState reducedMotion />)
    expect(markup).toContain('data-ui-loading-motion="reduce"')
  })
})

describe("ProjectRecoveryState", () => {
  test("separates unavailable registered Projects from first-run onboarding", () => {
    const markup = renderToStaticMarkup(
      <ProjectRecoveryState
        error="Folder unavailable"
        onOpenProject={() => undefined}
        onRetry={() => undefined}
      />,
    )

    expect(markup).toContain('data-project-recovery="true"')
    expect(markup).toContain("Your last Project could not be restored")
    expect(markup).toContain("Folder unavailable")
    expect(markup).toContain("Open a Project")
    expect(markup).toContain("Try again")
    expect(markup).not.toContain('data-project-home="true"')
    expect(markup).not.toContain("Recent work")
  })

  test("shows static busy indicators when reduced motion is enabled", () => {
    const markup = renderToStaticMarkup(
      <ProjectRecoveryState
        onOpenProject={() => undefined}
        onRetry={() => undefined}
        opening
        reducedMotion
      />,
    )
    expect(markup).toContain('data-ui-loading-motion="reduce"')
  })
})

describe("ProjectLoadingState", () => {
  test("identifies the project whose resources are opening", () => {
    const markup = renderToStaticMarkup(<ProjectLoadingState projectName="Storyboard" />)

    expect(markup).toContain("Opening Storyboard…")
    expect(markup).toContain("Loading canvases and project files")
    expect(markup).toContain('role="status"')
    expect(markup).toContain('data-ui-loading-layout="surface"')
    expect(markup.match(/role="status"/g)?.length).toBe(1)
    expect(markup).not.toContain("Create project")
  })

  test("keeps a single status region under reduced motion", () => {
    const markup = renderToStaticMarkup(
      <ProjectLoadingState projectName="Storyboard" reducedMotion />,
    )

    expect(markup).toContain('data-ui-loading-motion="reduce"')
    expect(markup.match(/role="status"/g)?.length).toBe(1)
  })
})
